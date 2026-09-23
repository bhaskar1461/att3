"""
SNIST ERP — Week 9 Acceptance & Verification Test Suite
Tests:
1. Retry storm idempotency (10 rapid submissions -> exactly 1 DB record, HTTP 200 ALREADY_MARKED)
2. Bounded submit-grace window (locked + 5m accepted, locked + 15m rejected with HTTP 400)
3. Offline queued submission sync (sets scan_mode='QR_OFFLINE_SYNC')
4. Historical sessions pagination (limit=5, offset=0/5/10)
5. Streaming CSV export with O(1) memory
6. Hourly & HOD Daily Digest window deduplication (DIGEST_{date}_{hour} & HOD_DIGEST_{dept}_{date})
7. Scanner health rollup query optimization for days > 1
"""

import os
import sys
import json
import unittest
import time
from datetime import datetime, timedelta
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# Ensure backend directory is in sys.path
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.main import app
from app.core.database import get_db, Base
from app.models.models import (
    User, UserRole, Student, Teacher, Department, Subject, Section, AcademicYear,
    AttendanceSession, AttendanceRecord, AttendanceStatus, SessionStatus,
    ScanTelemetryDailyRollup, AuditLog
)
from app.core.security import create_access_token, get_password_hash
from app.services.qr_token import ShortTokenService
from app.services.report_service import ReportService
from app.services.security_alert_service import SecurityAlertService
from app.core.config import settings
from app.api.student import student_scan_limiter, failed_token_tracker


class TestWeek9ScaleAndOfflineSuite(unittest.TestCase):

    def setUp(self):
        # Create an isolated in-memory SQLite database
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool
        )
        Base.metadata.create_all(bind=self.engine)
        self.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)
        self.db = self.SessionLocal()

        def override_get_db():
            try:
                yield self.db
            finally:
                pass

        app.dependency_overrides[get_db] = override_get_db
        self.client = TestClient(app)

        # Populate baseline institutional data
        self.dept = Department(code="CSE", name="Computer Science and Engineering")
        self.ay = AcademicYear(name="4th Year")
        self.db.add_all([self.dept, self.ay])
        self.db.flush()

        self.sec = Section(name="CSE-A", department_id=self.dept.id, academic_year_id=self.ay.id)
        self.subj = Subject(name="Distributed Systems", code="CS401", department_id=self.dept.id, academic_year_id=self.ay.id)
        self.db.add_all([self.sec, self.subj])
        self.db.flush()


        # Create Teacher
        self.teacher_user = User(
            username="faculty_w9",
            email="faculty_w9@snist.edu.in",
            password_hash=get_password_hash("FacultyPass123!"),
            role=UserRole.TEACHER,
            is_active=True
        )
        self.db.add(self.teacher_user)
        self.db.flush()

        self.teacher = Teacher(
            user_id=self.teacher_user.id,
            teacher_code="T-W9-001",
            name="Dr. Scalability Faculty",
            department_id=self.dept.id
        )
        self.db.add(self.teacher)

        # Create Student
        self.student_user = User(
            username="24311A6201",
            email="24311a6201@cse.sreenidhi.edu.in",
            password_hash=get_password_hash("StudentPass123!"),
            role=UserRole.STUDENT,
            is_active=True
        )
        self.db.add(self.student_user)
        self.db.flush()

        self.student = Student(
            user_id=self.student_user.id,
            name="Alice Scale Student",
            roll_number="24311A6201",
            department_id=self.dept.id,
            academic_year_id=self.ay.id,
            section_id=self.sec.id
        )
        self.db.add(self.student)
        self.db.commit()

        # Phase 5 Cutover: Enroll DeviceBinding for Alice
        from app.models.models import DeviceBinding
        from app.core.binding_crypto import generate_test_p256_keypair, create_test_binding_proof
        self.priv_alice, spki_alice, kid_alice = generate_test_p256_keypair()
        self.binding_alice = DeviceBinding(
            student_id=self.student.id,
            public_key=spki_alice,
            key_id=kid_alice,
            enrolled_at=datetime.utcnow()
        )
        self.db.add(self.binding_alice)
        self.db.commit()

        # Auth tokens & headers
        self.teacher_token = create_access_token({"sub": self.teacher_user.username, "role": "TEACHER"})
        self.teacher_headers = {"Authorization": f"Bearer {self.teacher_token}"}

        self.student_token = create_access_token({"sub": self.student_user.username, "role": "STUDENT"})
        self.student_headers = {
            "Authorization": f"Bearer {self.student_token}",
            "x-device-public-id": "DEV-W9-TEST-ALICE-PHONE",
            "x-device-secret": "DEV-W9-TEST-ALICE-PHONE_SECRET_SALT_2026"
        }

        # Clear rate limiters
        student_scan_limiter._attempts.clear()
        failed_token_tracker._failures.clear()
        failed_token_tracker._cooldowns.clear()

    def tearDown(self):
        self.db.close()
        app.dependency_overrides.clear()

    # ==============================================================================
    # 1. RETRY STORM IDEMPOTENCY TEST
    # ==============================================================================
    def test_retry_storm_idempotency(self):
        """
        Submitting the same valid token 10 times in rapid succession MUST:
        1. Result in exactly ONE attendance record in the database.
        2. Return HTTP 200 for all 10 calls.
        3. 1st call returns SUCCESS, calls 2-10 return ALREADY_MARKED.
        """
        # Create an OPEN session
        session = AttendanceSession(
            teacher_id=self.teacher.id,
            subject_id=self.subj.id,
            section_id=self.sec.id,
            period="1 Period",
            session_date=datetime.utcnow().strftime("%Y-%m-%d"),
            status=SessionStatus.OPEN
        )
        self.db.add(session)
        self.db.commit()

        # Generate a valid short token
        token_info = ShortTokenService.issue_or_get_short_code(
            db=self.db,
            session_id=session.id,
            period_count=1,
            step_window=10
        )
        payload = token_info["payload"]


        scan_body = {
            "session_token": payload,
            "token_format": "short",
            "device_uuid": "DEV-W9-TEST-ALICE-PHONE",
            "is_offline_submission": True
        }

        # Rapidly submit 10 times (simulating client retry storm)
        responses = []
        with patch.object(student_scan_limiter, "max_attempts", 20), \
             patch("app.api.student._async_post_scan_tasks"):
            for i in range(10):
                res = self.client.post(
                    "/api/v1/student/scan-session",
                    json=scan_body,
                    headers=self.student_headers
                )
                responses.append(res)

        # All 10 must succeed with HTTP 200 (no 400 / 500 crashes)
        for idx, res in enumerate(responses):
            self.assertEqual(res.status_code, 200, f"Attempt {idx+1} failed with {res.status_code}: {res.text}")

        # 1st must be SUCCESS
        self.assertEqual(responses[0].json()["status"], "SUCCESS")

        # 2nd through 10th must be ALREADY_MARKED (server-side idempotency)
        for idx in range(1, 10):
            data = responses[idx].json()
            self.assertEqual(data["status"], "ALREADY_MARKED", f"Attempt {idx+1} did not return ALREADY_MARKED")

        # Verify DB contains exactly 1 attendance record
        records = self.db.query(AttendanceRecord).filter(
            AttendanceRecord.session_id == session.id,
            AttendanceRecord.student_id == self.student.id
        ).all()
        self.assertEqual(len(records), 1, f"Expected exactly 1 record, found {len(records)}")
        self.assertEqual(records[0].status, AttendanceStatus.PRESENT)

    # ==============================================================================
    # 2. SUBMIT GRACE WINDOW TESTS
    # ==============================================================================
    def test_submit_grace_window_accepted(self):
        """
        When session is locked, offline queued submission within SUBMIT_GRACE_MINUTES (10m)
        must be accepted and recorded with scan_mode='QR_OFFLINE_SYNC'.
        """
        # Session locked 5 minutes ago (within 10m grace)
        locked_time = datetime.utcnow() - timedelta(minutes=5)
        session = AttendanceSession(
            teacher_id=self.teacher.id,
            subject_id=self.subj.id,
            section_id=self.sec.id,
            period="1 Period",
            session_date=datetime.utcnow().strftime("%Y-%m-%d"),
            status=SessionStatus.LOCKED,
            locked_at=locked_time
        )
        self.db.add(session)
        self.db.commit()

        token_info = ShortTokenService.issue_or_get_short_code(
            db=self.db,
            session_id=session.id,
            period_count=1,
            step_window=10
        )
        payload = token_info["payload"]

        # Submit offline submission queued during class
        with patch("app.api.student._async_post_scan_tasks"):
            res = self.client.post(
                "/api/v1/student/scan-session",
                json={
                    "session_token": payload,
                    "token_format": "short",
                    "device_uuid": "DEV-W9-TEST-ALICE-PHONE",
                    "is_offline_submission": True,
                    "queued_at": (datetime.utcnow() - timedelta(minutes=6)).isoformat()
                },
                headers=self.student_headers
            )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "SUCCESS")

        # Verify record has scan_mode = 'QR_OFFLINE_SYNC'
        record = self.db.query(AttendanceRecord).filter(
            AttendanceRecord.session_id == session.id,
            AttendanceRecord.student_id == self.student.id
        ).first()
        self.assertIsNotNone(record)
        self.assertEqual(record.scan_mode, "QR_OFFLINE_SYNC")

    def test_submit_grace_window_expired(self):
        """
        When session is locked, offline queued submission past SUBMIT_GRACE_MINUTES (10m)
        must be REJECTED with HTTP 400.
        """
        # Session locked 15 minutes ago (exceeds 10m grace)
        locked_time = datetime.utcnow() - timedelta(minutes=15)
        session = AttendanceSession(
            teacher_id=self.teacher.id,
            subject_id=self.subj.id,
            section_id=self.sec.id,
            period="1 Period",
            session_date=datetime.utcnow().strftime("%Y-%m-%d"),
            status=SessionStatus.LOCKED,
            locked_at=locked_time
        )
        self.db.add(session)
        self.db.commit()

        token_info = ShortTokenService.issue_or_get_short_code(
            db=self.db,
            session_id=session.id,
            period_count=1,
            step_window=10
        )
        payload = token_info["payload"]

        with patch("app.api.student._async_post_scan_tasks"):
            res = self.client.post(
                "/api/v1/student/scan-session",
                json={
                    "session_token": payload,
                    "token_format": "short",
                    "device_uuid": "DEV-W9-TEST-ALICE-PHONE",
                    "is_offline_submission": True,
                    "queued_at": (datetime.utcnow() - timedelta(minutes=16)).isoformat()
                },
                headers=self.student_headers
            )

        self.assertEqual(res.status_code, 400)
        self.assertIn("grace window", res.json()["detail"].lower())

        # Assert no attendance record was created
        record = self.db.query(AttendanceRecord).filter(
            AttendanceRecord.session_id == session.id,
            AttendanceRecord.student_id == self.student.id
        ).first()
        self.assertIsNone(record)

    # ==============================================================================
    # 3. HISTORICAL SESSIONS PAGINATION TEST
    # ==============================================================================
    def test_historical_sessions_pagination(self):
        """
        Verifies /api/v1/teacher/historical-sessions supports limit and offset parameters
        to prevent unbounded table scans.
        """
        # Seed 12 sessions for this teacher
        created_ids = []
        for i in range(12):
            s = AttendanceSession(
                teacher_id=self.teacher.id,
                subject_id=self.subj.id,
                section_id=self.sec.id,
                period=f"Period {i+1}",
                session_date=datetime.utcnow().strftime("%Y-%m-%d"),
                status=SessionStatus.LOCKED,
                created_at=datetime.utcnow() - timedelta(hours=12 - i)
            )
            self.db.add(s)
            self.db.flush()
            created_ids.append(s.id)
        self.db.commit()

        # Fetch page 1 (limit=5, offset=0)
        res_p1 = self.client.get(
            "/api/v1/teacher/historical-sessions?limit=5&offset=0",
            headers=self.teacher_headers
        )
        self.assertEqual(res_p1.status_code, 200)
        page1 = res_p1.json()
        self.assertEqual(len(page1), 5)

        # Fetch page 2 (limit=5, offset=5)
        res_p2 = self.client.get(
            "/api/v1/teacher/historical-sessions?limit=5&offset=5",
            headers=self.teacher_headers
        )
        self.assertEqual(res_p2.status_code, 200)
        page2 = res_p2.json()
        self.assertEqual(len(page2), 5)

        # Page 1 and Page 2 session IDs must be completely disjoint
        p1_ids = {s["session_id"] for s in page1}
        p2_ids = {s["session_id"] for s in page2}
        self.assertEqual(len(p1_ids.intersection(p2_ids)), 0)

        # Fetch page 3 (limit=5, offset=10) -> Should return remaining 2
        res_p3 = self.client.get(
            "/api/v1/teacher/historical-sessions?limit=5&offset=10",
            headers=self.teacher_headers
        )
        self.assertEqual(res_p3.status_code, 200)
        page3 = res_p3.json()
        self.assertEqual(len(page3), 2)

    # ==============================================================================
    # 4. STREAMING CSV EXPORT TEST
    # ==============================================================================
    def test_streaming_csv_export(self):
        """
        Verifies ReportService.stream_csv_report yields valid CSV rows without holding
        all objects in memory simultaneously.
        """
        mock_data = [
            {
                "roll_number": f"24311A620{i}",
                "student_name": f"Student {i}",
                "department": "CSE",
                "section": "CSE-A",
                "subject": "Distributed Systems",
                "status": "PRESENT",
                "date": "2026-09-11"
            }
            for i in range(1, 6)
        ]

        generator = ReportService.stream_csv_report(mock_data)
        chunks = list(generator)
        full_csv = "".join(chunks)

        self.assertIn("S.No,Roll Number,Student Name,Department,Section,Subject,Status,Date", full_csv)
        self.assertIn("24311A6201", full_csv)
        self.assertIn("24311A6205", full_csv)
        self.assertEqual(len(chunks), 6) # 1 header + 5 rows

        # Test API endpoint returns StreamingResponse
        res = self.client.get("/api/v1/reports/export/csv", headers=self.teacher_headers)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.headers.get("content-type"), "text/csv; charset=utf-8")
        self.assertIn("attachment; filename=Attendance_Export_", res.headers.get("content-disposition", ""))

    # ==============================================================================
    # 5. DIGEST DEDUPLICATION TEST
    # ==============================================================================
    def test_digest_deduplication(self):
        """
        Verifies hourly and HOD daily digests use database-backed audit keys
        to prevent duplicate emails when invoked multiple times in the same window.
        """
        # Patch email sender to record dispatches and patch DB session/config
        with patch.object(settings, "SECURITY_DIGEST_ENABLED", True), \
             patch("app.core.database.SessionLocal", self.SessionLocal), \
             patch("app.services.email_service.send_single_email") as mock_send:
            mock_send.return_value = {"status": "SUCCESS", "message_id": "test_msg_001"}

            # Insert a dummy security audit event so there is activity to report
            dummy_sec_event = AuditLog(
                user_id=None,
                roll_number="24311A6201",
                event_type="ACCOUNT_SWITCH_ATTEMPT",
                action="TEST_SEC_EVENT",
                details="Test event for digest",
                ip_address="127.0.0.1",
                created_at=datetime.utcnow()
            )
            self.db.add(dummy_sec_event)
            self.db.commit()

            # 1. Trigger Hourly Digest First Time (force_window=True, force_send=True to establish initial digest)
            res1 = SecurityAlertService.generate_and_send_hourly_digest(force_window=True, force_send=True)
            self.assertEqual(res1["status"], "SENT")
            self.assertIn("digest_key", res1)

            # 2. Trigger Hourly Digest Second Time (force_window=True, force_send=False) -> MUST DEDUP AND SKIP
            res2 = SecurityAlertService.generate_and_send_hourly_digest(force_window=True, force_send=False)
            self.assertEqual(res2["status"], "SKIPPED")
            self.assertEqual(res2["reason"], "ALREADY_SENT_FOR_WINDOW")

            # 3. Test HOD Daily Digest Deduplication
            res_hod1 = SecurityAlertService.generate_and_send_hod_daily_digest("CSE", force_send=True)
            self.assertEqual(res_hod1["status"], "SENT")

            res_hod2 = SecurityAlertService.generate_and_send_hod_daily_digest("CSE", force_send=False)
            self.assertEqual(res_hod2["status"], "SKIPPED")
            self.assertEqual(res_hod2["reason"], "ALREADY_SENT_FOR_DAY")

    # ==============================================================================
    # 6. SCANNER HEALTH ROLLUP OPTIMIZATION TEST
    # ==============================================================================
    def test_scanner_health_rollup_optimization(self):
        """
        Verifies /api/v1/telemetry/scanner-health when days > 1 leverages
        ScanTelemetryDailyRollup without crashing and combines headline statistics.
        """
        past_date = (datetime.utcnow() - timedelta(days=2)).strftime("%Y-%m-%d")
        rollup = ScanTelemetryDailyRollup(
            date=past_date,
            device_bucket="all",
            total_scans_started=150,
            total_scans_confirmed=145,
            first_attempt_success_rate=96.7,
            stage_dropoffs_json=json.dumps({
                "scan_page_opened": 150,
                "camera_opened": 149,
                "first_frame_captured": 148,
                "frame_decoded": 147,
                "token_submitted": 146,
                "attendance_confirmed": 145
            }),
            failure_counts_json=json.dumps({"token_expired": 3, "camera_denied": 2}),
            manual_searches_count=4,
            manual_marks_count=2
        )
        self.db.add(rollup)
        self.db.commit()

        # Query scanner health for days=7 with teacher token
        res = self.client.get("/api/v1/telemetry/scanner-health?days=7", headers=self.teacher_headers)
        self.assertEqual(res.status_code, 200)
        data = res.json()

        self.assertIn("headline", data)
        self.assertIn("funnel", data)
        # Verify total_scans_started aggregated from rollup
        self.assertGreaterEqual(data["headline"]["total_scans_started"], 150)
        self.assertGreaterEqual(data["headline"]["total_scans_confirmed"], 145)


if __name__ == "__main__":
    unittest.main()
