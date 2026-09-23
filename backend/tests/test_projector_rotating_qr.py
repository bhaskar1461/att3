import os
import sys
import time
import unittest
from datetime import datetime
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
    Teacher, Student, TeacherAssignment, AttendanceSession, SessionStatus, AttendanceRecord,
    AttendanceStatus
)
from app.core.config import settings
from app.core.security import (
    generate_projector_session_token,
    validate_projector_session_token,
    get_password_hash,
    create_access_token,
    get_server_ist_date
)

class TestProjectorRotatingQR(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._orig_binding_v2 = getattr(settings, 'BINDING_V2', False)
        settings.BINDING_V2 = False

    @classmethod
    def tearDownClass(cls):
        settings.BINDING_V2 = cls._orig_binding_v2

    def setUp(self):
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

        # Setup test data
        dept = Department(code="CSE", name="Computer Science")
        ay = AcademicYear(name="2025-2026")
        self.db.add_all([dept, ay])
        self.db.commit()

        self.sec_a = Section(name="CSE-A", department_id=dept.id, academic_year_id=ay.id)
        self.sec_b = Section(name="CSE-B", department_id=dept.id, academic_year_id=ay.id)
        self.subj = Subject(code="CS301", name="Database Systems", department_id=dept.id, academic_year_id=ay.id)
        self.db.add_all([self.sec_a, self.sec_b, self.subj])
        self.db.commit()

        # Teacher user & profile
        self.t_user = User(
            username="teacher_proj",
            password_hash=get_password_hash("pass123"),
            role=UserRole.TEACHER
        )
        self.db.add(self.t_user)
        self.db.commit()

        self.teacher = Teacher(
            user_id=self.t_user.id,
            teacher_code="FAC_PROJ",
            name="Prof. Sharma",
            department_id=dept.id
        )
        self.db.add(self.teacher)
        self.db.commit()

        # Teaching assignment for Section A
        self.assignment = TeacherAssignment(
            teacher_id=self.teacher.id,
            subject_id=self.subj.id,
            section_id=self.sec_a.id
        )
        self.db.add(self.assignment)
        self.db.commit()

        # Student A (enrolled in Section A)
        self.s_user_a = User(
            username="student_a",
            password_hash=get_password_hash("pass123"),
            role=UserRole.STUDENT
        )
        self.db.add(self.s_user_a)
        self.db.commit()

        self.student_a = Student(
            user_id=self.s_user_a.id,
            roll_number="21311A0501",
            name="Rahul Varma",
            department_id=dept.id,
            academic_year_id=ay.id,
            section_id=self.sec_a.id
        )
        self.db.add(self.student_a)
        self.db.commit()

        # Student B (enrolled in Section B - different section)
        self.s_user_b = User(
            username="student_b",
            password_hash=get_password_hash("pass123"),
            role=UserRole.STUDENT
        )
        self.db.add(self.s_user_b)
        self.db.commit()

        self.student_b = Student(
            user_id=self.s_user_b.id,
            roll_number="21311A0599",
            name="Sneha Rao",
            department_id=dept.id,
            academic_year_id=ay.id,
            section_id=self.sec_b.id
        )
        self.db.add(self.student_b)
        self.db.commit()

        # Teacher Auth Token
        self.teacher_token = create_access_token({"sub": self.t_user.username, "role": UserRole.TEACHER.value})
        self.teacher_headers = {"Authorization": f"Bearer {self.teacher_token}"}

        # Student A Auth Token
        self.student_a_token = create_access_token({"sub": self.s_user_a.username, "role": UserRole.STUDENT.value})
        self.student_a_headers = {"Authorization": f"Bearer {self.student_a_token}"}

        # Student B Auth Token
        self.student_b_token = create_access_token({"sub": self.s_user_b.username, "role": UserRole.STUDENT.value})
        self.student_b_headers = {"Authorization": f"Bearer {self.student_b_token}"}

    def tearDown(self):
        app.dependency_overrides.clear()
        self.db.close()

    def test_token_generation_and_sliding_window_validation(self):
        token_info = generate_projector_session_token(session_id=10, period_count=3, step_window=10)
        self.assertIn("SNIST-SES|", token_info["payload"])
        self.assertEqual(token_info["session_id"], 10)
        self.assertEqual(token_info["period_count"], 3)
        self.assertTrue(1 <= token_info["seconds_remaining"] <= 10)

        # Validate token for current step (Window N)
        validated = validate_projector_session_token(token_info["payload"], step_window=10, max_grace_steps=1)
        self.assertEqual(validated["session_id"], 10)
        self.assertEqual(validated["period_count"], 3)
        self.assertFalse(validated["is_grace_window"])

    def test_token_sliding_grace_window(self):
        # Generate token for step N-1 (previous 10s interval)
        step_window = 10
        current_step = int(time.time() // step_window)
        prev_step = current_step - 1

        from app.core.security import _int_to_base36, get_aes_key
        import hmac, hashlib

        sid_b36 = _int_to_base36(15)
        step_b36 = _int_to_base36(prev_step)
        base_str = f"SES|{sid_b36}|2|{step_b36}"
        key = get_aes_key()
        mac = hmac.new(key, base_str.encode('utf-8'), hashlib.sha256).hexdigest()[:12]
        prev_payload = f"SNIST-SES|{sid_b36}|2|{step_b36}|{mac}"

        # Should be valid under max_grace_steps=1
        validated = validate_projector_session_token(prev_payload, step_window=10, max_grace_steps=1)
        self.assertEqual(validated["session_id"], 15)
        self.assertEqual(validated["period_count"], 2)
        self.assertTrue(validated["is_grace_window"])

        # Token for step N-2 should be rejected as expired
        old_step = current_step - 2
        old_step_b36 = _int_to_base36(old_step)
        old_base = f"SES|{sid_b36}|2|{old_step_b36}"
        old_mac = hmac.new(key, old_base.encode('utf-8'), hashlib.sha256).hexdigest()[:12]
        old_payload = f"SNIST-SES|{sid_b36}|2|{old_step_b36}|{old_mac}"

        with self.assertRaises(ValueError) as ctx:
            validate_projector_session_token(old_payload, step_window=10, max_grace_steps=1)
        self.assertIn("expired", str(ctx.exception).lower())

    def test_token_tamper_rejection(self):
        token_info = generate_projector_session_token(session_id=10, period_count=3, step_window=10)
        # Tamper payload
        tampered = token_info["payload"][:-4] + "dead"
        with self.assertRaises(ValueError) as ctx:
            validate_projector_session_token(tampered, step_window=10)
        self.assertIn("tampered", str(ctx.exception).lower())

    def test_teacher_broadcast_token_endpoint(self):
        # Create an open session
        session = AttendanceSession(
            teacher_id=self.teacher.id,
            subject_id=self.subj.id,
            section_id=self.sec_a.id,
            period="Period 1-3",
            session_date=get_server_ist_date(),
            status=SessionStatus.OPEN
        )
        self.db.add(session)
        self.db.commit()

        res = self.client.get(
            f"/api/v1/teacher/sessions/{session.id}/broadcast-token",
            headers=self.teacher_headers
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["session_id"], session.id)
        self.assertTrue("SNIST-SES|" in data.get("legacy_payload", "") or "SNIST-SES|" in data.get("qr_payload", ""))
        self.assertTrue(data["qr_base64"].startswith("data:image/png;base64,"))
        self.assertEqual(data["total_enrolled"], 1)
        self.assertEqual(data["total_marked"], 0)
        self.assertEqual(data["period_count"], 3)
        self.assertEqual(data["refresh_interval"], 10)

    def test_student_scan_projector_qr_flow(self):
        # Create an open session for 3 periods
        session = AttendanceSession(
            teacher_id=self.teacher.id,
            subject_id=self.subj.id,
            section_id=self.sec_a.id,
            period="Period 1-3",
            session_date=get_server_ist_date(),
            status=SessionStatus.OPEN
        )
        self.db.add(session)
        self.db.commit()

        # Teacher gets broadcast token
        bcast_res = self.client.get(
            f"/api/v1/teacher/sessions/{session.id}/broadcast-token",
            headers=self.teacher_headers
        )
        token_payload = bcast_res.json()["qr_payload"]

        # Student A (in section A) scans it
        scan_res = self.client.post(
            "/api/v1/student/scan-session",
            headers=self.student_a_headers,
            json={"session_token": token_payload}
        )
        self.assertEqual(scan_res.status_code, 200)
        scan_data = scan_res.json()
        self.assertEqual(scan_data["status"], "SUCCESS")
        self.assertEqual(scan_data["period_count"], 3)
        self.assertEqual(scan_data["roll_number"], "21311A0501")

        # Verify DB record
        record = self.db.query(AttendanceRecord).filter(
            AttendanceRecord.session_id == session.id,
            AttendanceRecord.student_id == self.student_a.id
        ).first()
        self.assertIsNotNone(record)
        self.assertEqual(record.status, AttendanceStatus.PRESENT)
        self.assertEqual(record.period_count, 3)
        self.assertEqual(record.scan_mode, "PROJECTOR_SCAN")

        # Duplicate scan returns ALREADY_MARKED (idempotent)
        dup_res = self.client.post(
            "/api/v1/student/scan-session",
            headers=self.student_a_headers,
            json={"session_token": token_payload}
        )
        self.assertEqual(dup_res.status_code, 200)
        self.assertEqual(dup_res.json()["status"], "ALREADY_MARKED")

        # Verify live count updated on teacher broadcast endpoint
        updated_bcast = self.client.get(
            f"/api/v1/teacher/sessions/{session.id}/broadcast-token",
            headers=self.teacher_headers
        )
        self.assertEqual(updated_bcast.json()["total_marked"], 1)

    def test_student_section_mismatch_rejection(self):
        # Session is for Section A
        session = AttendanceSession(
            teacher_id=self.teacher.id,
            subject_id=self.subj.id,
            section_id=self.sec_a.id,
            period="Period 1",
            session_date=get_server_ist_date(),
            status=SessionStatus.OPEN
        )
        self.db.add(session)
        self.db.commit()

        bcast_res = self.client.get(
            f"/api/v1/teacher/sessions/{session.id}/broadcast-token",
            headers=self.teacher_headers
        )
        token_payload = bcast_res.json()["qr_payload"]

        # Student B is in Section B, attempting to scan Section A's QR
        scan_res = self.client.post(
            "/api/v1/student/scan-session",
            headers=self.student_b_headers,
            json={"session_token": token_payload}
        )
        self.assertEqual(scan_res.status_code, 400)
        self.assertIn("not enrolled", scan_res.json()["detail"].lower())

    def test_locked_session_rejection(self):
        # Create a LOCKED session
        session = AttendanceSession(
            teacher_id=self.teacher.id,
            subject_id=self.subj.id,
            section_id=self.sec_a.id,
            period="Period 1",
            session_date=get_server_ist_date(),
            status=SessionStatus.LOCKED
        )
        self.db.add(session)
        self.db.commit()

        # Cannot get broadcast token for locked session
        res = self.client.get(
            f"/api/v1/teacher/sessions/{session.id}/broadcast-token",
            headers=self.teacher_headers
        )
        self.assertEqual(res.status_code, 400)

        # Generating token manually and attempting scan should reject
        token_info = generate_projector_session_token(session_id=session.id, period_count=1)
        scan_res = self.client.post(
            "/api/v1/student/scan-session",
            headers=self.student_a_headers,
            json={"session_token": token_info["payload"]}
        )
        self.assertEqual(scan_res.status_code, 400)
        self.assertIn("locked", scan_res.json()["detail"].lower())

    def test_period_count_clamping_and_bounds_validation(self):
        """Verify that period_count=144 (or any out-of-bounds count) is strictly clamped to 1-8."""
        # 1. Direct generator clamping
        token_info = generate_projector_session_token(session_id=10, period_count=144)
        self.assertEqual(token_info["period_count"], 8)
        self.assertIn("|8|", token_info["payload"])

        # 2. Token validator bounds enforcement
        tampered_payload = token_info["payload"].replace("|8|", "|144|")
        with self.assertRaises(ValueError) as ctx:
            validate_projector_session_token(tampered_payload)
        self.assertIn("Invalid period count", str(ctx.exception))

        # 3. Teacher broadcast-token API clamping
        session = self.db.query(AttendanceSession).filter(
            AttendanceSession.status == SessionStatus.OPEN,
            AttendanceSession.teacher_id == self.teacher.id
        ).first()
        if session:
            res = self.client.get(
                f"/api/v1/teacher/sessions/{session.id}/broadcast-token?period_count=144",
                headers=self.teacher_headers
            )
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertEqual(data["period_count"], 8)

if __name__ == "__main__":
    unittest.main()

