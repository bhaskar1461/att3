"""
SNIST ERP - Phase 9 Security, Authorization & Attendance Integrity Verification Suite
Audits threat vectors, authorization boundaries, IDOR defenses, and session integrity.
"""

import os
import sys
import unittest
import time
from datetime import datetime, timedelta
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
root_dir = os.path.dirname(backend_dir)
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)

from app.main import app
from app.core.database import get_db, Base
from app.models.models import (
    User, UserRole, Department, AcademicYear, Section, Subject,
    Teacher, Student, TeacherAssignment, AttendanceSession, SessionStatus,
    AttendanceRecord, AttendanceStatus, DeviceRegistration, DeviceAccountBinding,
    BindingStatus
)
from app.core.security import (
    get_password_hash, create_access_token, get_server_ist_date,
    generate_projector_session_token, get_aes_key
)
import hmac
import hashlib

class TestPhase9SecurityAndIntegrity(unittest.TestCase):
    def setUp(self):
        # Isolated in-memory SQLite database
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(bind=self.engine)
        SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)
        self.db = SessionLocal()

        def override_get_db():
            try:
                yield self.db
            finally:
                pass

        app.dependency_overrides[get_db] = override_get_db
        self.client = TestClient(app)

        self.today = get_server_ist_date()
        today_dt = datetime.strptime(self.today, "%Y-%m-%d")
        self.tomorrow = (today_dt + timedelta(days=1)).strftime("%Y-%m-%d")
        self.yesterday = (today_dt - timedelta(days=1)).strftime("%Y-%m-%d")

        # Provision institutional metadata
        dept = Department(code="CSE", name="Computer Science")
        ay = AcademicYear(name="3rd Year")
        self.db.add_all([dept, ay])
        self.db.commit()

        sec_a = Section(name="CSE-A", department_id=dept.id, academic_year_id=ay.id)
        sec_b = Section(name="CSE-B", department_id=dept.id, academic_year_id=ay.id)
        subj_ds = Subject(code="CS301", name="Data Structures", department_id=dept.id, academic_year_id=ay.id)
        subj_algo = Subject(code="CS302", name="Algorithms", department_id=dept.id, academic_year_id=ay.id)
        self.db.add_all([sec_a, sec_b, subj_ds, subj_algo])
        self.db.commit()

        # Users: Teacher 1 (CSE-A), Teacher 2 (CSE-B), Student 1 (CSE-A), Student 2 (CSE-B), Admin
        u_t1 = User(username="FAC101", password_hash=get_password_hash("pass123"), role=UserRole.TEACHER)
        u_t2 = User(username="FAC102", password_hash=get_password_hash("pass123"), role=UserRole.TEACHER)
        u_s1 = User(username="21CS001", password_hash=get_password_hash("pass123"), role=UserRole.STUDENT)
        u_s2 = User(username="21CS002", password_hash=get_password_hash("pass123"), role=UserRole.STUDENT)
        u_adm = User(username="ADMIN01", password_hash=get_password_hash("pass123"), role=UserRole.SUPER_ADMIN)
        self.db.add_all([u_t1, u_t2, u_s1, u_s2, u_adm])
        self.db.commit()

        t1 = Teacher(user_id=u_t1.id, teacher_code="FAC101", name="Dr. Sharma", department_id=dept.id)
        t2 = Teacher(user_id=u_t2.id, teacher_code="FAC102", name="Prof. Rao", department_id=dept.id)
        s1 = Student(user_id=u_s1.id, roll_number="21CS001", name="Alice", department_id=dept.id, academic_year_id=ay.id, section_id=sec_a.id)
        s2 = Student(user_id=u_s2.id, roll_number="21CS002", name="Bob", department_id=dept.id, academic_year_id=ay.id, section_id=sec_b.id)
        self.db.add_all([t1, t2, s1, s2])
        self.db.commit()

        # Assignments: T1 -> CS301 / CSE-A, T2 -> CS302 / CSE-B
        assign1 = TeacherAssignment(teacher_id=t1.id, subject_id=subj_ds.id, section_id=sec_a.id)
        assign2 = TeacherAssignment(teacher_id=t2.id, subject_id=subj_algo.id, section_id=sec_b.id)
        self.db.add_all([assign1, assign2])
        self.db.commit()

        self.t1 = t1
        self.t2 = t2
        self.s1 = s1
        self.s2 = s2
        self.sec_a = sec_a
        self.sec_b = sec_b
        self.subj_ds = subj_ds
        self.subj_algo = subj_algo

        # Tokens
        self.token_t1 = create_access_token({"sub": "FAC101", "role": UserRole.TEACHER.value, "user_id": u_t1.id})
        self.token_t2 = create_access_token({"sub": "FAC102", "role": UserRole.TEACHER.value, "user_id": u_t2.id})
        self.token_s1 = create_access_token({"sub": "21CS001", "role": UserRole.STUDENT.value, "user_id": u_s1.id})
        self.token_s2 = create_access_token({"sub": "21CS002", "role": UserRole.STUDENT.value, "user_id": u_s2.id})
        self.token_adm = create_access_token({"sub": "ADMIN01", "role": UserRole.SUPER_ADMIN.value, "user_id": u_adm.id})

        self.h_t1 = {"Authorization": f"Bearer {self.token_t1}"}
        self.h_t2 = {"Authorization": f"Bearer {self.token_t2}"}
        self.h_s1 = {"Authorization": f"Bearer {self.token_s1}"}
        self.h_s2 = {"Authorization": f"Bearer {self.token_s2}"}
        self.h_adm = {"Authorization": f"Bearer {self.token_adm}"}

        # Clear in-memory scan rate limiters for isolated tests
        try:
            from app.api.student import student_scan_limiter, failed_token_tracker
            student_scan_limiter._attempts.clear()
            failed_token_tracker._failures.clear()
            failed_token_tracker._cooldowns.clear()
        except Exception:
            pass

    def tearDown(self):
        try:
            from app.api.student import student_scan_limiter, failed_token_tracker
            student_scan_limiter._attempts.clear()
            failed_token_tracker._failures.clear()
            failed_token_tracker._cooldowns.clear()
        except Exception:
            pass
        app.dependency_overrides.clear()
        self.db.close()

    def _create_session_t1(self, status=SessionStatus.OPEN, date=None):
        sess = AttendanceSession(
            teacher_id=self.t1.id,
            subject_id=self.subj_ds.id,
            section_id=self.sec_a.id,
            period="Period 2",
            session_date=date or self.today,
            status=status,
            display_type="projector"
        )
        self.db.add(sess)
        self.db.commit()
        self.db.refresh(sess)
        return sess

    # -------------------------------------------------------------------------
    # TEST 1: Unauthorized Teacher Session Access
    # -------------------------------------------------------------------------
    def test_01_unauthorized_teacher_session_access(self):
        """Teacher B cannot access Teacher A's session details or reports."""
        sess = self._create_session_t1()
        res_view = self.client.get(f"/api/v1/teacher/sessions/{sess.id}", headers=self.h_t2)
        self.assertEqual(res_view.status_code, 403)
        self.assertIn("not authorized", res_view.json()["detail"].lower())

        res_rep = self.client.get(f"/api/v1/reports/session/{sess.id}", headers=self.h_t2)
        self.assertEqual(res_rep.status_code, 403)
        self.assertIn("not authorized", res_rep.json()["detail"].lower())

    # -------------------------------------------------------------------------
    # TEST 2: Unauthorized Teacher Attendance Submission
    # -------------------------------------------------------------------------
    def test_02_unauthorized_teacher_attendance_submission(self):
        """Teacher B cannot submit manual attendance or batch-mark Teacher A's session."""
        sess = self._create_session_t1()
        res_manual = self.client.post(
            "/api/v1/attendance/manual-mark",
            headers=self.h_t2,
            json={"session_id": sess.id, "roll_number": "21CS001", "status": "PRESENT", "reason": "scanner_failed"}
        )
        self.assertEqual(res_manual.status_code, 403)

        res_batch = self.client.post(
            f"/api/v1/attendance/session/{sess.id}/batch-mark",
            headers=self.h_t2,
            json={"status": "PRESENT", "roll_numbers": ["21CS001"]}
        )
        self.assertEqual(res_batch.status_code, 403)

    # -------------------------------------------------------------------------
    # TEST 3: Cross-Section Student Submission
    # -------------------------------------------------------------------------
    def test_03_cross_section_student_submission(self):
        """Student from Section B cannot be marked in Section A session (manual or student scan)."""
        sess = self._create_session_t1()
        # Teacher attempts manual mark with Section B student (21CS002)
        res_manual = self.client.post(
            "/api/v1/attendance/manual-mark",
            headers=self.h_t1,
            json={"session_id": sess.id, "roll_number": "21CS002", "status": "PRESENT", "reason": "scanner_failed"}
        )
        self.assertEqual(res_manual.status_code, 400)
        self.assertTrue(
            any(m in res_manual.json()["detail"].lower() for m in ["does not belong", "not enrolled in this section"])
        )

        # Student 2 (CSE-B) attempts to scan rotating token from Section A
        bcast = self.client.get(f"/api/v1/teacher/sessions/{sess.id}/broadcast-token", headers=self.h_t1)
        token_payload = bcast.json()["qr_payload"]

        res_scan = self.client.post(
            "/api/v1/student/scan-session",
            headers=self.h_s2,
            json={"session_token": token_payload, "is_offline_submission": True}
        )
        self.assertEqual(res_scan.status_code, 400)
        self.assertIn("not enrolled in this section", res_scan.json()["detail"].lower())

    # -------------------------------------------------------------------------
    # TEST 4: Locked Session Modification Blocked
    # -------------------------------------------------------------------------
    def test_04_locked_session_modification_blocked(self):
        """Locked sessions reject manual marks, batch marks, token broadcasts, and student scans."""
        sess = self._create_session_t1(status=SessionStatus.LOCKED)
        sess.locked_at = datetime.utcnow() - timedelta(minutes=20)
        self.db.commit()

        res_manual = self.client.post(
            "/api/v1/attendance/manual-mark",
            headers=self.h_t1,
            json={"session_id": sess.id, "roll_number": "21CS001", "status": "PRESENT", "reason": "scanner_failed"}
        )
        self.assertEqual(res_manual.status_code, 400)
        self.assertIn("locked", res_manual.json()["detail"].lower())

        res_batch = self.client.post(
            f"/api/v1/attendance/session/{sess.id}/batch-mark",
            headers=self.h_t1,
            json={"status": "PRESENT", "roll_numbers": ["21CS001"]}
        )
        self.assertEqual(res_batch.status_code, 400)
        self.assertIn("locked", res_batch.json()["detail"].lower())

        res_bcast = self.client.get(f"/api/v1/teacher/sessions/{sess.id}/broadcast-token", headers=self.h_t1)
        self.assertEqual(res_bcast.status_code, 400)
        self.assertIn("locked", res_bcast.json()["detail"].lower())

    # -------------------------------------------------------------------------
    # TEST 5: Duplicate Session Creation Prevention
    # -------------------------------------------------------------------------
    def test_05_duplicate_session_creation_prevention(self):
        """Concurrent or repeated session start requests converge onto the identical session ID."""
        payload = {
            "subject_id": self.subj_ds.id,
            "section_id": self.sec_a.id,
            "period": "Period 2",
            "date": self.today
        }
        res1 = self.client.post("/api/v1/teacher/sessions/start", json=payload, headers=self.h_t1)
        self.assertEqual(res1.status_code, 200)
        sid1 = res1.json()["session_id"]

        res2 = self.client.post("/api/v1/teacher/sessions/start", json=payload, headers=self.h_t1)
        self.assertEqual(res2.status_code, 200)
        sid2 = res2.json()["session_id"]

        self.assertEqual(sid1, sid2)
        count = self.db.query(AttendanceSession).filter(
            AttendanceSession.teacher_id == self.t1.id,
            AttendanceSession.subject_id == self.subj_ds.id,
            AttendanceSession.section_id == self.sec_a.id,
            AttendanceSession.session_date == self.today
        ).count()
        self.assertEqual(count, 1)

    # -------------------------------------------------------------------------
    # TEST 6: Duplicate Attendance Submission Integrity
    # -------------------------------------------------------------------------
    def test_06_duplicate_attendance_submission_integrity(self):
        """Scanning twice returns ALREADY_MARKED and maintains exactly 1 database record."""
        sess = self._create_session_t1()
        bcast = self.client.get(f"/api/v1/teacher/sessions/{sess.id}/broadcast-token", headers=self.h_t1)
        token_payload = bcast.json()["qr_payload"]

        # Scan 1
        res1 = self.client.post(
            "/api/v1/student/scan-session",
            headers=self.h_s1,
            json={"session_token": token_payload, "is_offline_submission": True}
        )
        self.assertEqual(res1.status_code, 200)
        self.assertEqual(res1.json()["status"], "SUCCESS")

        # Scan 2
        res2 = self.client.post(
            "/api/v1/student/scan-session",
            headers=self.h_s1,
            json={"session_token": token_payload, "is_offline_submission": True}
        )
        self.assertEqual(res2.status_code, 200)
        self.assertEqual(res2.json()["status"], "ALREADY_MARKED")

        # DB record count check
        recs = self.db.query(AttendanceRecord).filter(
            AttendanceRecord.session_id == sess.id,
            AttendanceRecord.student_id == self.s1.id
        ).all()
        self.assertEqual(len(recs), 1)

    # -------------------------------------------------------------------------
    # TEST 7: Invalid Attendance Status Validation
    # -------------------------------------------------------------------------
    def test_07_invalid_attendance_status_rejection(self):
        """Manual mark endpoint strictly validates reason enum."""
        sess = self._create_session_t1()
        res = self.client.post(
            "/api/v1/attendance/manual-mark",
            headers=self.h_t1,
            json={"session_id": sess.id, "roll_number": "21CS001", "status": "PRESENT", "reason": "INVALID_REASON"}
        )
        self.assertEqual(res.status_code, 422)
        self.assertIn("invalid manual mark reason", res.json()["detail"].lower())

    # -------------------------------------------------------------------------
    # TEST 8: Invalid and Expired QR Rejection
    # -------------------------------------------------------------------------
    def test_08_invalid_and_expired_qr_rejection(self):
        """Tokens with expired steps or malformed prefixes are strictly rejected."""
        # Malformed prefix
        res_mal = self.client.post(
            "/api/v1/student/scan-session",
            headers=self.h_s1,
            json={"session_token": "MALFORMED|123|ABC", "is_offline_submission": True}
        )
        self.assertEqual(res_mal.status_code, 400)

        # Expired token from past step
        expired_token = generate_projector_session_token(session_id=1, period_count=1, step_window=10)
        # Shift step far into past
        parts = expired_token["payload"].split("|")
        # parts: ['SNIST-SES', sid_b36, period_count, step_b36, mac]
        key = get_aes_key()
        old_step_b36 = "1"  # Epoch step 1
        base_str = f"SES|{parts[1]}|{parts[2]}|{old_step_b36}"
        old_mac = hmac.new(key, base_str.encode('utf-8'), hashlib.sha256).hexdigest()[:12]
        expired_payload = f"SNIST-SES|{parts[1]}|{parts[2]}|{old_step_b36}|{old_mac}"

        res_exp = self.client.post(
            "/api/v1/student/scan-session",
            headers=self.h_s1,
            json={"session_token": expired_payload, "is_offline_submission": False}
        )
        self.assertEqual(res_exp.status_code, 400)
        self.assertIn("expired", res_exp.json()["detail"].lower())

    # -------------------------------------------------------------------------
    # TEST 9: Tampered QR Rejection
    # -------------------------------------------------------------------------
    def test_09_tampered_qr_rejection(self):
        """Tampering with token payload HMAC signature or short code is detected and rejected."""
        sess = self._create_session_t1()
        bcast = self.client.get(f"/api/v1/teacher/sessions/{sess.id}/broadcast-token", headers=self.h_t1)
        
        # 1. Tamper legacy token HMAC signature
        legacy_token = bcast.json()["legacy_payload"]
        tampered_legacy = legacy_token[:-4] + "DEAD"
        res_leg = self.client.post(
            "/api/v1/student/scan-session",
            headers=self.h_s1,
            json={"session_token": tampered_legacy, "is_offline_submission": True}
        )
        self.assertEqual(res_leg.status_code, 400)
        self.assertIn("tampered", res_leg.json()["detail"].lower())

        # 2. Tampered short token code
        res_short = self.client.post(
            "/api/v1/student/scan-session",
            headers=self.h_s1,
            json={"session_token": "?s=INVALIDCODE99&v=1000", "is_offline_submission": True}
        )
        self.assertEqual(res_short.status_code, 400)
        self.assertTrue(any(k in res_short.json()["detail"].lower() for k in ["unknown", "expired", "invalid", "tampered"]))

    # -------------------------------------------------------------------------
    # TEST 10: Cross-Session QR
    # -------------------------------------------------------------------------
    def test_10_cross_session_qr(self):
        """Token generated for Session A does not mark attendance for Session B."""
        sess_a = self._create_session_t1()
        # Session B belongs to CSE-B
        sess_b = AttendanceSession(
            teacher_id=self.t2.id,
            subject_id=self.subj_algo.id,
            section_id=self.sec_b.id,
            period="Period 3",
            session_date=self.today,
            status=SessionStatus.OPEN
        )
        self.db.add(sess_b)
        self.db.commit()

        bcast_a = self.client.get(f"/api/v1/teacher/sessions/{sess_a.id}/broadcast-token", headers=self.h_t1)
        token_a = bcast_a.json()["qr_payload"]

        # Student 1 scans Token A -> marks in Session A
        res = self.client.post(
            "/api/v1/student/scan-session",
            headers=self.h_s1,
            json={"session_token": token_a, "is_offline_submission": True}
        )
        self.assertEqual(res.status_code, 200)

        # Check DB: record exists in Session A, not Session B
        rec_a = self.db.query(AttendanceRecord).filter(AttendanceRecord.session_id == sess_a.id).first()
        self.assertIsNotNone(rec_a)
        rec_b = self.db.query(AttendanceRecord).filter(AttendanceRecord.session_id == sess_b.id).first()
        self.assertIsNone(rec_b)

    # -------------------------------------------------------------------------
    # TEST 11: Future-Date Attendance Rejection
    # -------------------------------------------------------------------------
    def test_11_future_date_attendance_rejection(self):
        """Attempting to create a session or retrieve QR for a future date is rejected."""
        res_sess = self.client.post(
            "/api/v1/teacher/sessions/start",
            headers=self.h_t1,
            json={
                "subject_id": self.subj_ds.id,
                "section_id": self.sec_a.id,
                "period": "Period 1",
                "date": self.tomorrow
            }
        )
        self.assertEqual(res_sess.status_code, 400)
        self.assertIn("future dates", res_sess.json()["detail"].lower())

        res_qr = self.client.get(f"/api/v1/student/qr-code?date={self.tomorrow}", headers=self.h_s1)
        self.assertEqual(res_qr.status_code, 400)
        self.assertIn("future date", res_qr.json()["detail"].lower())

    # -------------------------------------------------------------------------
    # TEST 12: Student Device Binding Violation
    # -------------------------------------------------------------------------
    def test_12_student_device_binding_violation(self):
        """A device bound to Student 1 cannot authenticate as Student 2 during the lock window."""
        now = datetime.utcnow()
        dev = DeviceRegistration(
            device_public_id="DEVICE_SHARED_01",
            device_credential_hash=hashlib.sha256(b"SECRET_SHARED_01").hexdigest(),
            is_active=True,
            created_at=now,
            updated_at=now
        )
        self.db.add(dev)
        self.db.commit()

        # Bind device to 21CS001
        binding = DeviceAccountBinding(
            device_id=dev.id,
            roll_number="21CS001",
            status=BindingStatus.ACTIVE,
            attempt_count=1,
            created_at=now,
            last_authentication_at=now,
            expires_at=now + timedelta(minutes=30)
        )
        self.db.add(binding)
        self.db.commit()

        # Attempt login as 21CS002 from DEVICE_SHARED_01
        res = self.client.post("/api/v1/auth/login", json={
            "username": "21CS002",
            "password": "pass123",
            "device_public_id": "DEVICE_SHARED_01",
            "device_secret": "SECRET_SHARED_01"
        })
        self.assertEqual(res.status_code, 403)
        self.assertIn("another student", res.json()["detail"].lower())

    # -------------------------------------------------------------------------
    # TEST 13: Protected Endpoints Without Authentication
    # -------------------------------------------------------------------------
    def test_13_protected_endpoints_without_authentication(self):
        """Unauthenticated requests to protected endpoints return 401 Unauthorized."""
        endpoints = [
            ("GET", "/api/v1/teacher/current-class"),
            ("POST", "/api/v1/teacher/sessions/start"),
            ("GET", "/api/v1/student/profile"),
            ("GET", "/api/v1/admin/teachers"),
            ("POST", "/api/v1/attendance/manual-mark")
        ]
        for method, path in endpoints:
            if method == "GET":
                r = self.client.get(path)
            else:
                r = self.client.post(path, json={})
            self.assertEqual(r.status_code, 401, f"Path {path} should be 401, got {r.status_code}")

    # -------------------------------------------------------------------------
    # TEST 14: Wrong-Role Endpoint Access
    # -------------------------------------------------------------------------
    def test_14_wrong_role_endpoint_access(self):
        """Students cannot hit teacher/admin endpoints; Teachers cannot hit admin endpoints."""
        # Student hitting teacher endpoint
        res1 = self.client.get("/api/v1/teacher/current-class", headers=self.h_s1)
        self.assertEqual(res1.status_code, 403)

        # Student hitting admin endpoint
        res2 = self.client.get("/api/v1/admin/teachers", headers=self.h_s1)
        self.assertEqual(res2.status_code, 403)

        # Teacher hitting admin endpoint
        res3 = self.client.get("/api/v1/admin/teachers", headers=self.h_t1)
        self.assertEqual(res3.status_code, 403)

    # -------------------------------------------------------------------------
    # TEST 15: Session ID Manipulation (IDOR)
    # -------------------------------------------------------------------------
    def test_15_session_id_manipulation_idor(self):
        """Tampering with numeric session_id to access another teacher's session is blocked."""
        sess_t1 = self._create_session_t1()
        
        # Teacher 2 attempts actions on Teacher 1's session ID
        r1 = self.client.get(f"/api/v1/teacher/sessions/{sess_t1.id}", headers=self.h_t2)
        self.assertEqual(r1.status_code, 403)

        r2 = self.client.post(f"/api/v1/teacher/sessions/{sess_t1.id}/lock", headers=self.h_t2)
        self.assertEqual(r2.status_code, 403)

        r3 = self.client.get(f"/api/v1/teacher/sessions/{sess_t1.id}/broadcast-token", headers=self.h_t2)
        self.assertEqual(r3.status_code, 403)

        r4 = self.client.get(f"/api/v1/reports/session/{sess_t1.id}", headers=self.h_t2)
        self.assertEqual(r4.status_code, 403)

if __name__ == "__main__":
    unittest.main()
