"""
test_week8_ladder_and_manual_guardrails.py — Week 8 Automated Test Suite

Validates:
1. Reason enum validation on manual attendance marking (scanner_failed, device_lost, late_join, other).
2. Missing or invalid manual reason rejection with HTTP 422.
3. High-volume manual mark session rate-limit cap (HTTP 428 Precondition Required without confirmation).
4. Role scoping and authorization on manual marks (cross-teacher rejection with HTTP 403).
5. Institutional Security Audit Log generation for all manual marks tagged with [M].
6. (M) flag formatting in reports and registers for manual attendance.
7. Ladder rung telemetry ingestion and aggregation in scanner-health (Rungs 1 to 5).
8. New error types acceptance (camera_in_use, insecure_origin).
9. Scanner default engine configuration returning 'wasm'.
10. Anomaly status calculation (NORMAL, AMBER at >=15%, RED at >=30%).
"""

import sys
import os
import unittest
from datetime import datetime, date
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.main import app
from app.core.database import get_db, Base
from app.core.config import settings
from app.models.models import (
    User, UserRole, Student, Teacher, Department, Subject, Section, AcademicYear,
    AttendanceSession, AttendanceRecord, AttendanceStatus, SessionStatus,
    AuditLog, ScanTelemetryEvent
)
from app.core.security import create_access_token, get_password_hash


class TestWeek8LadderAndManualGuardrails(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        cls.TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=cls.engine, expire_on_commit=False)
        Base.metadata.create_all(bind=cls.engine)

        def override_get_db():
            db = cls.TestingSessionLocal()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_get_db
        cls.client = TestClient(app)

        # Seed fundamental data
        db = cls.TestingSessionLocal()
        cls.dept = Department(name="Computer Science", code="CSE")
        cls.year = AcademicYear(name="IV Year")
        db.add_all([cls.dept, cls.year])
        db.commit()

        cls.section = Section(name="CSE-A", department_id=cls.dept.id, academic_year_id=cls.year.id)
        cls.subject = Subject(name="Cloud Computing", code="CS401", department_id=cls.dept.id, academic_year_id=cls.year.id)
        db.add_all([cls.section, cls.subject])
        db.commit()

        cls.subject_id = cls.subject.id
        cls.section_id = cls.section.id

        # Admin user
        cls.admin_user = User(
            username="admin_w8",
            email="admin_w8@snist.edu.in",
            password_hash=get_password_hash("pass123"),
            role=UserRole.SUPER_ADMIN,
            is_active=True
        )
        db.add(cls.admin_user)
        db.commit()
        cls.admin_token = create_access_token({"sub": "admin_w8", "role": "SUPER_ADMIN"})

        # Teacher 1 (Owner)
        cls.teacher1_user = User(
            username="prof_sharma_w8",
            email="sharma_w8@snist.edu.in",
            password_hash=get_password_hash("pass123"),
            role=UserRole.TEACHER,
            is_active=True
        )
        db.add(cls.teacher1_user)
        db.commit()
        cls.teacher1 = Teacher(
            user_id=cls.teacher1_user.id,
            teacher_code="T-CSE-001",
            name="Prof. Sharma",
            department_id=cls.dept.id
        )
        db.add(cls.teacher1)
        db.commit()
        cls.teacher1_id = cls.teacher1.id
        cls.teacher1_token = create_access_token({"sub": "prof_sharma_w8", "role": "TEACHER"})

        # Teacher 2 (Unrelated)
        cls.teacher2_user = User(
            username="prof_verma_w8",
            email="verma_w8@snist.edu.in",
            password_hash=get_password_hash("pass123"),
            role=UserRole.TEACHER,
            is_active=True
        )
        db.add(cls.teacher2_user)
        db.commit()
        cls.teacher2 = Teacher(
            user_id=cls.teacher2_user.id,
            teacher_code="T-CSE-002",
            name="Prof. Verma",
            department_id=cls.dept.id
        )
        db.add(cls.teacher2)
        db.commit()
        cls.teacher2_id = cls.teacher2.id
        cls.teacher2_token = create_access_token({"sub": "prof_verma_w8", "role": "TEACHER"})

        # Seed 30 students
        cls.students = []
        for i in range(1, 31):
            roll = f"21SN1A05{i:02d}"
            u = User(
                username=f"s_w8_{i}",
                email=f"s_w8_{i}@snist.edu.in",
                password_hash=get_password_hash("pass123"),
                role=UserRole.STUDENT,
                is_active=True
            )
            db.add(u)
            db.commit()
            s = Student(
                user_id=u.id,
                roll_number=roll,
                name=f"Student {i:02d}",
                department_id=cls.dept.id,
                academic_year_id=cls.year.id,
                section_id=cls.section.id
            )
            db.add(s)
            cls.students.append(s)
        db.commit()
        cls.student_rolls = [s.roll_number for s in cls.students]
        cls.student_token = create_access_token({"sub": "s_w8_1", "role": "STUDENT"})
        db.close()

    def setUp(self):
        from unittest.mock import patch
        self.db = self.TestingSessionLocal()
        self.patcher = patch("app.api.attendance._async_post_scan_tasks")
        self.mock_post_tasks = self.patcher.start()

    def tearDown(self):
        self.patcher.stop()
        self.db.close()

    def _create_session(self, teacher_id: int) -> AttendanceSession:
        sess = AttendanceSession(
            teacher_id=teacher_id,
            subject_id=self.subject_id,
            section_id=self.section_id,
            session_date=date.today().isoformat(),
            period="Period 1",
            status=SessionStatus.OPEN
        )
        self.db.add(sess)
        self.db.commit()
        self.db.refresh(sess)
        return sess

    # -------------------------------------------------------------------------
    # PART C: REASON ENUM VALIDATION
    # -------------------------------------------------------------------------
    def test_manual_mark_reason_enum_validation(self):
        sess = self._create_session(self.teacher1.id)
        student = self.students[0]

        valid_reasons = ["scanner_failed", "device_lost", "late_join", "other"]
        for idx, reason in enumerate(valid_reasons):
            s = self.students[idx]
            res = self.client.post(
                "/api/v1/attendance/manual-mark",
                headers={"Authorization": f"Bearer {self.teacher1_token}"},
                json={
                    "session_id": sess.id,
                    "roll_number": s.roll_number,
                    "status": "PRESENT",
                    "reason": reason,
                    "reason_detail": f"Testing reason {reason}"
                }
            )
            self.assertEqual(res.status_code, 200, f"Reason {reason} failed: {res.text}")
            data = res.json()
            self.assertEqual(data["manual_reason"], reason)

    def test_manual_mark_missing_reason_rejected_422(self):
        sess = self._create_session(self.teacher1.id)
        student = self.students[5]

        res = self.client.post(
            "/api/v1/attendance/manual-mark",
            headers={"Authorization": f"Bearer {self.teacher1_token}"},
            json={
                "session_id": sess.id,
                "roll_number": student.roll_number,
                "status": "PRESENT"
                # missing reason
            }
        )
        self.assertEqual(res.status_code, 422)

    def test_manual_mark_invalid_reason_rejected_422(self):
        sess = self._create_session(self.teacher1.id)
        student = self.students[6]

        res = self.client.post(
            "/api/v1/attendance/manual-mark",
            headers={"Authorization": f"Bearer {self.teacher1_token}"},
            json={
                "session_id": sess.id,
                "roll_number": student.roll_number,
                "status": "PRESENT",
                "reason": "forgot_to_wake_up"
            }
        )
        self.assertEqual(res.status_code, 422)
        self.assertIn("Invalid manual mark reason", res.text)

    # -------------------------------------------------------------------------
    # PART C: AUDIT LOG CREATION
    # -------------------------------------------------------------------------
    def test_manual_mark_audit_log_created(self):
        sess = self._create_session(self.teacher1_id)
        student_roll = self.student_rolls[7]

        res = self.client.post(
            "/api/v1/attendance/manual-mark",
            headers={"Authorization": f"Bearer {self.teacher1_token}"},
            json={
                "session_id": sess.id,
                "roll_number": student_roll,
                "status": "PRESENT",
                "reason": "scanner_failed",
                "reason_detail": "Low light back-row camera timeout"
            }
        )
        self.assertEqual(res.status_code, 200)

        # Verify AuditLog row exists
        log = self.db.query(AuditLog).filter(
            AuditLog.action == "MANUAL_MARK_VERIFIED",
            AuditLog.user_id == self.teacher1_user.id
        ).order_by(AuditLog.id.desc()).first()

        self.assertIsNotNone(log)
        self.assertIn(student_roll, log.details)
        self.assertIn("MANUAL_MARK [M]", log.details)
        self.assertIn("scanner_failed", log.details)

    # -------------------------------------------------------------------------
    # PART C: RATE LIMIT / VOLUME CAP (HTTP 428)
    # -------------------------------------------------------------------------
    def test_manual_mark_volume_cap_enforcement(self):
        sess = self._create_session(self.teacher1_id)
        cap = settings.MANUAL_MARK_MAX_PER_SESSION_CAP  # 25

        # Mark 25 students manually
        for i in range(cap):
            roll = self.student_rolls[i]
            res = self.client.post(
                "/api/v1/attendance/manual-mark",
                headers={"Authorization": f"Bearer {self.teacher1_token}"},
                json={
                    "session_id": sess.id,
                    "roll_number": roll,
                    "status": "PRESENT",
                    "reason": "scanner_failed",
                    "confirm_high_volume": False
                }
            )
            self.assertEqual(res.status_code, 200, f"Mark {i+1} failed: {res.text}")

        # Attempt mark 26 without confirm_high_volume -> 428 Precondition Required
        s26_roll = self.student_rolls[cap]
        res428 = self.client.post(
            "/api/v1/attendance/manual-mark",
            headers={"Authorization": f"Bearer {self.teacher1_token}"},
            json={
                "session_id": sess.id,
                "roll_number": s26_roll,
                "status": "PRESENT",
                "reason": "scanner_failed",
                "confirm_high_volume": False
            }
        )
        self.assertEqual(res428.status_code, 428)
        self.assertIn("Session manual mark limit", str(res428.json()["detail"]))

        # Now mark with confirm_high_volume: true -> 200 OK
        res_ok = self.client.post(
            "/api/v1/attendance/manual-mark",
            headers={"Authorization": f"Bearer {self.teacher1_token}"},
            json={
                "session_id": sess.id,
                "roll_number": s26_roll,
                "status": "PRESENT",
                "reason": "scanner_failed",
                "confirm_high_volume": True
            }
        )
        self.assertEqual(res_ok.status_code, 200)

    # -------------------------------------------------------------------------
    # PART C: ROLE SCOPING & CROSS-TEACHER REJECTION
    # -------------------------------------------------------------------------
    def test_manual_mark_cross_teacher_forbidden(self):
        # Teacher 1 owns session; Teacher 2 attempts mark -> 403
        sess = self._create_session(self.teacher1.id)
        student = self.students[0]

        res = self.client.post(
            "/api/v1/attendance/manual-mark",
            headers={"Authorization": f"Bearer {self.teacher2_token}"},
            json={
                "session_id": sess.id,
                "roll_number": student.roll_number,
                "status": "PRESENT",
                "reason": "scanner_failed"
            }
        )
        self.assertEqual(res.status_code, 403)

    def test_manual_mark_admin_override_permitted(self):
        # Admin can mark on any session
        sess = self._create_session(self.teacher1.id)
        student = self.students[0]

        res = self.client.post(
            "/api/v1/attendance/manual-mark",
            headers={"Authorization": f"Bearer {self.admin_token}"},
            json={
                "session_id": sess.id,
                "roll_number": student.roll_number,
                "status": "PRESENT",
                "reason": "other",
                "reason_detail": "Admin institutional correction"
            }
        )
        self.assertEqual(res.status_code, 200)

    # -------------------------------------------------------------------------
    # PART C: REPORTS & EXPORTS (M) FLAG
    # -------------------------------------------------------------------------
    def test_attendance_report_flags_manual_record_with_m(self):
        sess = self._create_session(self.teacher1_id)
        student_roll = self.student_rolls[0]

        self.client.post(
            "/api/v1/attendance/manual-mark",
            headers={"Authorization": f"Bearer {self.teacher1_token}"},
            json={
                "session_id": sess.id,
                "roll_number": student_roll,
                "status": "PRESENT",
                "reason": "scanner_failed"
            }
        )

        res = self.client.get(
            f"/api/v1/reports/session/{sess.id}",
            headers={"Authorization": f"Bearer {self.teacher1_token}"}
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        rec = next((r for r in data["attendance_records"] if r["roll_number"] == student_roll), None)
        self.assertIsNotNone(rec)
        self.assertIn("(M)", rec["status"])
        self.assertTrue(rec["is_manual"])

    # -------------------------------------------------------------------------
    # PART A & B: TELEMETRY INGESTION & LADDER AGGREGATION
    # -------------------------------------------------------------------------
    def test_ladder_telemetry_ingestion_and_health_aggregation(self):
        # Ingest ladder transition event
        payload = {
            "events": [
                {
                    "event_type": "ladder_rung_transition",
                    "stage": "camera_opened",
                    "ladder_rung": 2,
                    "from_rung": 1,
                    "engine": "wasm",
                    "device_bucket": "mid"
                },
                {
                    "event_type": "scan_failed",
                    "stage": "camera_opened",
                    "error_type": "camera_in_use",
                    "ladder_rung": 4,
                    "device_bucket": "old"
                },
                {
                    "event_type": "scan_failed",
                    "stage": "camera_opened",
                    "error_type": "insecure_origin",
                    "ladder_rung": 4,
                    "device_bucket": "mid"
                }
            ]
        }
        res = self.client.post(
            "/api/v1/telemetry/scan-events", 
            headers={"Authorization": f"Bearer {self.student_token}"},
            json=payload
        )
        self.assertEqual(res.status_code, 202)
        self.assertEqual(res.json()["ingested"], 3)

        # Query /scanner-health
        health_res = self.client.get(
            "/api/v1/telemetry/scanner-health?days=1",
            headers={"Authorization": f"Bearer {self.admin_token}"}
        )
        self.assertEqual(health_res.status_code, 200)
        health_data = health_res.json()
        self.assertIn("ladder_usage", health_data)
        self.assertGreaterEqual(health_data["ladder_usage"]["rung_2_engine_fallback"], 1)

    # -------------------------------------------------------------------------
    # PART D: SCANNER ENGINE DEFAULT FLIP TO WASM
    # -------------------------------------------------------------------------
    def test_scanner_config_default_engine_wasm(self):
        res = self.client.get("/api/v1/telemetry/scanner-config")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["default_engine"], "wasm")
        self.assertIn("wasm", data["available_engines"])
        self.assertIn("jsqr", data["available_engines"])

    # -------------------------------------------------------------------------
    # ANOMALY THRESHOLDS (15% Amber, 30% Red)
    # -------------------------------------------------------------------------
    def test_teacher_session_anomaly_thresholds(self):
        sess = self._create_session(self.teacher1_id)

        # 1. Zero manual marks -> NORMAL
        det1 = self.client.get(
            f"/api/v1/teacher/sessions/{sess.id}",
            headers={"Authorization": f"Bearer {self.teacher1_token}"}
        ).json()
        self.assertEqual(det1["anomaly_status"], "NORMAL")

        # 2. Mark 1 manual out of 5 present -> 20% (AMBER)
        # Mark 4 students via regular scan simulation
        for i in range(4):
            rec = AttendanceRecord(
                session_id=sess.id,
                student_id=self.students[i].id,
                roll_number=self.student_rolls[i],
                session_date=sess.session_date,
                status=AttendanceStatus.PRESENT,
                scan_mode="QR"
            )
            self.db.add(rec)
        self.db.commit()

        # Mark 1 student via manual mark
        self.client.post(
            "/api/v1/attendance/manual-mark",
            headers={"Authorization": f"Bearer {self.teacher1_token}"},
            json={
                "session_id": sess.id,
                "roll_number": self.student_rolls[4],
                "status": "PRESENT",
                "reason": "scanner_failed"
            }
        )

        det2 = self.client.get(
            f"/api/v1/teacher/sessions/{sess.id}",
            headers={"Authorization": f"Bearer {self.teacher1_token}"}
        ).json()
        # 1 manual out of 5 total present = 20% -> AMBER
        self.assertEqual(det2["manual_count"], 1)
        self.assertEqual(det2["manual_pct"], 20.0)
        self.assertEqual(det2["anomaly_status"], "AMBER")


if __name__ == "__main__":
    unittest.main()
