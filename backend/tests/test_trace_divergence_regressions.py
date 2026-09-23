import os
import sys
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch, MagicMock
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
    Teacher, Student, TeacherAssignment, AttendanceSession, SessionStatus, AttendanceRecord
)
from app.core.security import (
    generate_encrypted_qr_payload_v2,
    get_password_hash,
    get_server_ist_date,
    get_server_ist_datetime,
    TokenValidationError
)
from app.services.qr_token import ShortTokenService, _SHORT_CODE_CACHE, _SESSION_SHORT_CODE
from app.services.launch_token import generate_launch_token

class TestTraceDivergenceRegressions(unittest.TestCase):
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

        self.today = get_server_ist_date()

        dept = Department(code="CSE", name="Computer Science")
        ay = AcademicYear(name="2025-2026")
        self.db.add_all([dept, ay])
        self.db.commit()

        self.sec = Section(name="CSE-A", department_id=dept.id, academic_year_id=ay.id)
        self.subj1 = Subject(code="CS301", name="Data Structures", department_id=dept.id, academic_year_id=ay.id)
        self.subj2 = Subject(code="CS302", name="Operating Systems", department_id=dept.id, academic_year_id=ay.id)
        self.db.add_all([self.sec, self.subj1, self.subj2])
        self.db.commit()

        # Teacher setup
        u_t = User(username="T1001", password_hash=get_password_hash("pass123"), role=UserRole.TEACHER)
        self.db.add(u_t)
        self.db.commit()

        self.teacher = Teacher(user_id=u_t.id, teacher_code="T1001", name="Dr. Faculty", department_id=dept.id, google_sheet_id="GSHEET_T1")
        self.db.add(self.teacher)
        self.db.commit()

        # Students setup
        self.student1_user = User(username="21311A0501", password_hash=get_password_hash("pass123"), role=UserRole.STUDENT)
        self.student2_user = User(username="21311A0502", password_hash=get_password_hash("pass123"), role=UserRole.STUDENT)
        self.db.add_all([self.student1_user, self.student2_user])
        self.db.commit()

        self.student1 = Student(user_id=self.student1_user.id, roll_number="21311A0501", name="Student One", department_id=dept.id, academic_year_id=ay.id, section_id=self.sec.id)
        self.student2 = Student(user_id=self.student2_user.id, roll_number="21311A0502", name="Student Two", department_id=dept.id, academic_year_id=ay.id, section_id=self.sec.id)
        self.db.add_all([self.student1, self.student2])
        self.db.commit()

        # Login teacher
        res = self.client.post("/api/v1/auth/login", data={"username": "T1001", "password": "pass123"})
        self.assertEqual(res.status_code, 200)
        self.teacher_token = res.json()["access_token"]
        self.teacher_headers = {"Authorization": f"Bearer {self.teacher_token}"}

    def tearDown(self):
        app.dependency_overrides.clear()
        self.db.close()
        Base.metadata.drop_all(bind=self.engine)

    def test_bug_e_batch_scan_persists_period_count_on_create_and_update(self):
        """BUG E: Verify batch-scan persists period_count in AttendanceRecord row instead of defaulting to 4."""
        sess = AttendanceSession(
            teacher_id=self.teacher.id,
            subject_id=self.subj1.id,
            section_id=self.sec.id,
            period="Period 1 (1 Period)",
            session_date=self.today,
            status=SessionStatus.OPEN
        )
        self.db.add(sess)
        self.db.commit()

        qr1 = generate_encrypted_qr_payload_v2(student_id=self.student1.id, roll_number=self.student1.roll_number, attendance_date=self.today)

        # Batch scan with explicit period_count = 1
        resp = self.client.post(
            "/api/v1/attendance/batch-scan",
            headers=self.teacher_headers,
            json={
                "scans": [
                    {"session_id": sess.id, "qr_payload": qr1, "period_count": 1}
                ]
            }
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["status"], "SUCCESS")

        # Verify DB row has period_count = 1 (NOT default 4)
        rec = self.db.query(AttendanceRecord).filter(
            AttendanceRecord.session_id == sess.id,
            AttendanceRecord.student_id == self.student1.id
        ).first()
        self.assertIsNotNone(rec)
        self.assertEqual(rec.period_count, 1, f"Expected period_count 1, got {rec.period_count}")

        # Update via batch scan with period_count = 3
        resp_update = self.client.post(
            "/api/v1/attendance/batch-scan",
            headers=self.teacher_headers,
            json={
                "scans": [
                    {"session_id": sess.id, "qr_payload": qr1, "period_count": 3}
                ]
            }
        )
        self.assertEqual(resp_update.status_code, 200)

        self.db.refresh(rec)
        self.assertEqual(rec.period_count, 3, f"Expected updated period_count 3, got {rec.period_count}")

    def test_bug_f_batch_scan_uses_server_authoritative_ist_date(self):
        """BUG F: Verify batch-scan uses get_server_ist_datetime for date_formatted."""
        sess = AttendanceSession(
            teacher_id=self.teacher.id,
            subject_id=self.subj1.id,
            section_id=self.sec.id,
            period="Period 1",
            session_date=self.today,
            status=SessionStatus.OPEN
        )
        self.db.add(sess)
        self.db.commit()

        qr1 = generate_encrypted_qr_payload_v2(student_id=self.student1.id, roll_number=self.student1.roll_number, attendance_date=self.today)

        with patch("app.api.attendance._async_post_scan_tasks") as mock_post_tasks:
            resp = self.client.post(
                "/api/v1/attendance/batch-scan",
                headers=self.teacher_headers,
                json={
                    "scans": [
                        {"session_id": sess.id, "qr_payload": qr1, "period_count": 1}
                    ]
                }
            )
            self.assertEqual(resp.status_code, 200)
            self.assertTrue(mock_post_tasks.called)
            expected_ist_date = get_server_ist_datetime().strftime("%d/%m/%Y")
            call_kwargs = mock_post_tasks.call_args[1]
            self.assertEqual(call_kwargs.get("date_formatted"), expected_ist_date)

    def test_bug_g_batch_scan_invalidates_all_distinct_subjects_in_batch(self):
        """BUG G: Verify batch-scan invalidates attendance cache for all distinct courses, not just the last one."""
        sess1 = AttendanceSession(
            teacher_id=self.teacher.id,
            subject_id=self.subj1.id,
            section_id=self.sec.id,
            period="Period 1",
            session_date=self.today,
            status=SessionStatus.OPEN
        )
        sess2 = AttendanceSession(
            teacher_id=self.teacher.id,
            subject_id=self.subj2.id,
            section_id=self.sec.id,
            period="Period 2",
            session_date=self.today,
            status=SessionStatus.OPEN
        )
        self.db.add_all([sess1, sess2])
        self.db.commit()

        qr1 = generate_encrypted_qr_payload_v2(student_id=self.student1.id, roll_number=self.student1.roll_number, attendance_date=self.today)
        qr2 = generate_encrypted_qr_payload_v2(student_id=self.student2.id, roll_number=self.student2.roll_number, attendance_date=self.today)

        with patch("app.services.attendance_engine.invalidate_attendance_cache") as mock_inval:
            resp = self.client.post(
                "/api/v1/attendance/batch-scan",
                headers=self.teacher_headers,
                json={
                    "scans": [
                        {"session_id": sess1.id, "qr_payload": qr1, "period_count": 1},
                        {"session_id": sess2.id, "qr_payload": qr2, "period_count": 1}
                    ]
                }
            )
            self.assertEqual(resp.status_code, 200)
            called_course_ids = {call.kwargs.get("course_id") for call in mock_inval.call_args_list}
            self.assertIn(self.subj1.id, called_course_ids)
            self.assertIn(self.subj2.id, called_course_ids)

    def test_bug_c_launch_token_and_claim_rejected_on_locked_session(self):
        """BUG C: Verify launch token validation and /claim endpoint reject locked sessions."""
        sess = AttendanceSession(
            teacher_id=self.teacher.id,
            subject_id=self.subj1.id,
            section_id=self.sec.id,
            period="Period 1",
            session_date=self.today,
            status=SessionStatus.OPEN
        )
        self.db.add(sess)
        self.db.commit()

        short_info = ShortTokenService.issue_or_get_short_code(db=self.db, session_id=sess.id)
        launch_tok = generate_launch_token(session_id=sess.id, short_code=short_info["short_code"], v=short_info["v"])

        # Lock the session
        sess.status = SessionStatus.LOCKED
        self.db.commit()
        ShortTokenService.purge_session_tokens(db=self.db, session_id=sess.id)

        # 1. Direct ShortTokenService validation rejects with expired
        with self.assertRaises(TokenValidationError) as ctx:
            ShortTokenService.validate_attendance_token(
                db=self.db,
                payload_or_code=launch_tok
            )
        self.assertEqual(ctx.exception.code, "expired")

        # 2. Public /claim endpoint rejects locked session with 400
        claim_resp = self.client.post("/api/v1/launch/claim", json={"launch_token": launch_tok})
        self.assertEqual(claim_resp.status_code, 400)
        # Custom HTTPException handler in main.py flattens dict detail to top-level keys
        resp_body = claim_resp.json()
        self.assertEqual(resp_body.get("code"), "expired", f"Expected code='expired', got body: {resp_body}")

    def test_bug_b_period_count_consistency_across_cache_and_db_fallback(self):
        """BUG B: Verify issue_or_get_short_code and DB fallback resolve period_count consistently from session."""
        sess = AttendanceSession(
            teacher_id=self.teacher.id,
            subject_id=self.subj1.id,
            section_id=self.sec.id,
            period="Period 1-3 (3 Periods)",
            session_date=self.today,
            status=SessionStatus.OPEN
        )
        self.db.add(sess)
        self.db.commit()

        # 1. Initial issuance derives period_count=3 from session.period
        short_info = ShortTokenService.issue_or_get_short_code(db=self.db, session_id=sess.id, period_count=1)
        self.assertEqual(short_info["period_count"], 3)

        # 2. Validation from in-memory cache
        val_cached = ShortTokenService.validate_attendance_token(
            db=self.db,
            payload_or_code=short_info["payload"],
            v=short_info["v"]
        )
        self.assertEqual(val_cached["period_count"], 3)

        # 3. Simulate process restart by evicting in-memory cache
        ShortTokenService.clear_cache()

        # 4. Validation via DB fallback on fresh worker/process
        val_db = ShortTokenService.validate_attendance_token(
            db=self.db,
            payload_or_code=short_info["payload"],
            v=short_info["v"]
        )
        self.assertEqual(val_db["period_count"], 3, f"Expected 3 from DB fallback, got {val_db['period_count']}")

if __name__ == "__main__":
    unittest.main()
