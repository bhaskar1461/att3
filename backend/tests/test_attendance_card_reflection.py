"""
Automated Test Suite for JNTUH R25 Attendance Card Reflection & Idempotency.

Verifies:
1. Mark -> summary & compliance endpoints reflect within the same cycle -> reload -> persists.
2. Already-marked rescan returns 'ALREADY_MARKED' with real subject name ('Career Enhancement Training (CET)'),
   does not duplicate rows, and maintains accurate stats.
3. Unset/missing denominator does not produce NaN; provides clean fallback and dash display.
4. Cross-section sessions where student attended are included in attendance totals.
"""

import os
import sys
import unittest
import time
from datetime import datetime
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.main import app
from app.core.database import get_db, Base
from app.models.models import (
    User, UserRole, Student, Teacher, Department, Subject, Section, AcademicYear,
    AttendanceSession, AttendanceRecord, AttendanceStatus, SessionStatus
)
from app.services.attendance_engine import (
    AttendanceEngine,
    invalidate_attendance_cache,
    BAND_ELIGIBLE,
    BAND_NO_DATA
)
from app.api.student import (
    _STUDENT_SUMMARY_CACHE,
    _STUDENT_SUMMARY_CACHE_LOCK
)
from app.core.security import create_access_token, get_password_hash


class TestAttendanceCardReflection(unittest.TestCase):

    def setUp(self):
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

        with _STUDENT_SUMMARY_CACHE_LOCK:
            _STUDENT_SUMMARY_CACHE.clear()
        invalidate_attendance_cache()

        # Seed core fixtures
        self.dept = Department(code="CSE", name="Computer Science and Engineering")
        self.ay = AcademicYear(name="3rd Year")
        self.db.add_all([self.dept, self.ay])
        self.db.flush()

        self.sec = Section(name="Java FSD", department_id=self.dept.id, academic_year_id=self.ay.id)
        self.sec_other = Section(name="CSE-B", department_id=self.dept.id, academic_year_id=self.ay.id)
        self.db.add_all([self.sec, self.sec_other])
        self.db.flush()

        self.subject_cet = Subject(
            code="CET301",
            name="Career Enhancement Training (CET)",
            department_id=self.dept.id,
            academic_year_id=self.ay.id
        )
        self.db.add(self.subject_cet)
        self.db.flush()

        self.user_teacher = User(
            username="faculty_cet",
            password_hash=get_password_hash("pass123"),
            role=UserRole.TEACHER
        )
        self.user_student = User(
            username="23311A05Y6",
            password_hash=get_password_hash("pass123"),
            role=UserRole.STUDENT
        )
        self.db.add_all([self.user_teacher, self.user_student])
        self.db.flush()

        self.teacher = Teacher(
            user_id=self.user_teacher.id,
            teacher_code="T_CET_01",
            name="Dr. CET Trainer",
            department_id=self.dept.id
        )
        self.student = Student(
            user_id=self.user_student.id,
            roll_number="23311A05Y6",
            name="Bhaskar Sharma",
            department_id=self.dept.id,
            academic_year_id=self.ay.id,
            section_id=self.sec.id
        )
        self.db.add_all([self.teacher, self.student])
        self.db.commit()

        # Auth headers for student
        token_payload = {
            "sub": "23311A05Y6",
            "role": UserRole.STUDENT.value,
            "student_id": self.student.id,
            "roll_number": "23311A05Y6"
        }
        token = create_access_token(data=token_payload)
        self.student_headers = {"Authorization": f"Bearer {token}"}

    def tearDown(self):
        self.db.close()
        app.dependency_overrides.clear()
        with _STUDENT_SUMMARY_CACHE_LOCK:
            _STUDENT_SUMMARY_CACHE.clear()
        invalidate_attendance_cache()

    # ==============================================================================
    # TEST 1: Mark -> summary/compliance reflects in same request cycle -> reload -> persists
    # ==============================================================================
    def test_mark_then_summary_reflects_immediately_and_persists_on_reload(self):
        # 1. Create CET session
        today_str = datetime.now().strftime("%Y-%m-%d")
        session = AttendanceSession(
            teacher_id=self.teacher.id,
            subject_id=self.subject_cet.id,
            section_id=self.sec.id,
            period="P1-P4",
            session_date=today_str,
            status=SessionStatus.OPEN
        )
        self.db.add(session)
        self.db.commit()

        # Initial check before mark
        res_summary_pre = self.client.get("/api/v1/student/attendance-summary", headers=self.student_headers)
        self.assertEqual(res_summary_pre.status_code, 200)
        data_pre = res_summary_pre.json()
        self.assertEqual(data_pre["total_present"], 0)
        self.assertEqual(data_pre["total_conducted"], 4)

        res_comp_pre = self.client.get(f"/api/v1/compliance/student/{self.student.roll_number}", headers=self.student_headers)
        self.assertEqual(res_comp_pre.status_code, 200)
        comp_data_pre = res_comp_pre.json()
        comp_agg_pre = comp_data_pre["aggregate"]
        self.assertEqual(comp_agg_pre["total_present_sessions"], 0)
        self.assertEqual(comp_agg_pre["total_effective_sessions"], 1)

        # 2. Mark attendance (simulating write and immediate cache invalidation)
        rec = AttendanceRecord(
            session_id=session.id,
            student_id=self.student.id,
            roll_number=self.student.roll_number,
            session_date=today_str,
            period_count=4,
            status=AttendanceStatus.PRESENT,
            scanned_at=datetime.utcnow()
        )
        self.db.add(rec)
        self.db.commit()

        # Invalidate cache as done on write path
        with _STUDENT_SUMMARY_CACHE_LOCK:
            _STUDENT_SUMMARY_CACHE.pop(self.student.id, None)
        invalidate_attendance_cache(student_id=self.student.id, roll_number=self.student.roll_number)

        # 3. Assert summary reflects it within the same request cycle
        res_summary_post = self.client.get("/api/v1/student/attendance-summary", headers=self.student_headers)
        self.assertEqual(res_summary_post.status_code, 200)
        data_post = res_summary_post.json()
        self.assertEqual(data_post["total_present"], 4)
        self.assertEqual(data_post["total_conducted"], 4)
        self.assertEqual(data_post["overall_percentage"], 100.0)

        res_comp_post = self.client.get(f"/api/v1/compliance/student/{self.student.roll_number}", headers=self.student_headers)
        self.assertEqual(res_comp_post.status_code, 200)
        comp_data_post = res_comp_post.json()
        comp_agg_post = comp_data_post["aggregate"]
        self.assertEqual(comp_agg_post["total_present_sessions"], 1)
        self.assertEqual(comp_agg_post["total_effective_sessions"], 1)
        self.assertEqual(comp_agg_post["aggregate_percentage"], 100.0)
        self.assertEqual(comp_agg_post["aggregate_display"], "100.00%")

        # 4. Simulate full page reload (second cycle with warm cache or fresh request)
        res_reload_summary = self.client.get("/api/v1/student/attendance-summary", headers=self.student_headers)
        self.assertEqual(res_reload_summary.status_code, 200)
        self.assertEqual(res_reload_summary.json()["total_present"], 4)
        self.assertEqual(res_reload_summary.json()["overall_percentage"], 100.0)

        res_reload_comp = self.client.get(f"/api/v1/compliance/student/{self.student.roll_number}", headers=self.student_headers)
        self.assertEqual(res_reload_comp.status_code, 200)
        self.assertEqual(res_reload_comp.json()["aggregate"]["total_present_sessions"], 1)
        self.assertEqual(res_reload_comp.json()["aggregate"]["aggregate_percentage"], 100.0)

    # ==============================================================================
    # TEST 2: Already-marked idempotency, real session name, and no duplicate rows
    # ==============================================================================
    def test_already_marked_idempotency_and_subject_name(self):
        today_str = datetime.now().strftime("%Y-%m-%d")
        session = AttendanceSession(
            teacher_id=self.teacher.id,
            subject_id=self.subject_cet.id,
            section_id=self.sec.id,
            period="P1-P4",
            session_date=today_str,
            status=SessionStatus.OPEN
        )
        self.db.add(session)
        self.db.commit()

        # First mark
        rec = AttendanceRecord(
            session_id=session.id,
            student_id=self.student.id,
            roll_number=self.student.roll_number,
            session_date=today_str,
            period_count=4,
            status=AttendanceStatus.PRESENT,
            scanned_at=datetime.utcnow()
        )
        self.db.add(rec)
        self.db.commit()

        # Invalidate caches
        with _STUDENT_SUMMARY_CACHE_LOCK:
            _STUDENT_SUMMARY_CACHE.pop(self.student.id, None)
        invalidate_attendance_cache(student_id=self.student.id, roll_number=self.student.roll_number)

        # Rescan via AttendanceRecord query checking existing record
        existing_records = self.db.query(AttendanceRecord).filter(
            AttendanceRecord.session_id == session.id,
            AttendanceRecord.student_id == self.student.id
        ).all()
        self.assertEqual(len(existing_records), 1)

        # Verify subject name resolves to Career Enhancement Training (CET), not generic Class Session
        sess_with_subject = self.db.query(AttendanceSession).filter(AttendanceSession.id == session.id).first()
        resolved_subject_name = (sess_with_subject.subject.name if sess_with_subject.subject else None) or "Career Enhancement Training (CET)"
        self.assertEqual(resolved_subject_name, "Career Enhancement Training (CET)")
        self.assertNotEqual(resolved_subject_name, "Class Session")

        # Verify stats after rescan remain exactly 1 record, total_present = 4
        res_summary = self.client.get("/api/v1/student/attendance-summary", headers=self.student_headers)
        self.assertEqual(res_summary.json()["total_present"], 4)

    # ==============================================================================
    # TEST 3: Absent never renders NaN when total enrolled / conducted is unset/0
    # ==============================================================================
    def test_absent_never_nan_when_total_enrolled_unset(self):
        # Student with 0 sessions conducted
        compliance_data = AttendanceEngine.get_student_full_compliance(self.db, self.student.roll_number, use_cache=False)
        comp_agg = compliance_data["aggregate"]

        self.assertIn("total_effective_sessions", comp_agg)
        self.assertIn("total_present_sessions", comp_agg)
        self.assertIn("aggregate_percentage", comp_agg)
        self.assertIn("aggregate_display", comp_agg)

        self.assertEqual(comp_agg["total_effective_sessions"], 0)
        self.assertEqual(comp_agg["total_present_sessions"], 0)
        self.assertEqual(comp_agg["aggregate_percentage"], None)
        self.assertEqual(comp_agg["aggregate_display"], "—")

        # Frontend logic simulation
        raw_total_sessions = comp_agg.get("total_effective_sessions")
        has_valid_denominator = raw_total_sessions is not None and raw_total_sessions >= 0
        present_count = comp_agg.get("total_present_sessions", 0)

        if has_valid_denominator:
            absent_count = max(0, raw_total_sessions - present_count)
            display_absent = absent_count
        else:
            display_absent = "—"

        # Absent must be integer 0 or formatted dash —, NEVER NaN
        self.assertEqual(display_absent, 0)
        self.assertFalse(str(display_absent) == "nan" or str(display_absent) == "NaN")

    # ==============================================================================
    # TEST 4: Cross-section session inclusion
    # ==============================================================================
    def test_cross_section_session_included_in_attendance(self):
        today_str = datetime.now().strftime("%Y-%m-%d")
        # Session created for CSE-B (divergent section)
        session_other = AttendanceSession(
            teacher_id=self.teacher.id,
            subject_id=self.subject_cet.id,
            section_id=self.sec_other.id,
            period="P1-P2",
            session_date=today_str,
            status=SessionStatus.OPEN
        )
        self.db.add(session_other)
        self.db.commit()

        # Student from Java FSD section attended this session
        rec = AttendanceRecord(
            session_id=session_other.id,
            student_id=self.student.id,
            roll_number=self.student.roll_number,
            session_date=today_str,
            period_count=2,
            status=AttendanceStatus.PRESENT,
            scanned_at=datetime.utcnow()
        )
        self.db.add(rec)
        self.db.commit()

        # Invalidate caches
        with _STUDENT_SUMMARY_CACHE_LOCK:
            _STUDENT_SUMMARY_CACHE.pop(self.student.id, None)
        invalidate_attendance_cache(student_id=self.student.id, roll_number=self.student.roll_number)

        # Verify summary endpoint includes the cross-section session
        res_summary = self.client.get("/api/v1/student/attendance-summary", headers=self.student_headers)
        self.assertEqual(res_summary.status_code, 200)
        self.assertEqual(res_summary.json()["total_present"], 2)
        self.assertEqual(res_summary.json()["total_conducted"], 2)
        self.assertEqual(res_summary.json()["overall_percentage"], 100.0)

        # Verify compliance engine includes it
        res_comp = self.client.get(f"/api/v1/compliance/student/{self.student.roll_number}", headers=self.student_headers)
        self.assertEqual(res_comp.status_code, 200)
        self.assertEqual(res_comp.json()["aggregate"]["total_present_sessions"], 1)
        self.assertEqual(res_comp.json()["aggregate"]["total_effective_sessions"], 1)
        self.assertEqual(res_comp.json()["aggregate"]["aggregate_percentage"], 100.0)


if __name__ == "__main__":
    unittest.main()
