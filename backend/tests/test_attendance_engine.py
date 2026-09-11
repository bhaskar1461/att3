"""
Acceptance Test Suite for JNTUH R25 Attendance Engine & Compliance Endpoints
Isolated In-Memory SQLite Testing Suite.

Validates:
1. Band boundaries: 64.99 -> DETAINED, 65.0 -> CONDONABLE, 74.99 -> CONDONABLE, 75.0 -> ELIGIBLE
2. Approved-absence exclusion changes denominator correctly
3. Late-join proration (sessions prior to join date excluded)
4. Zero-session course -> "—" not 0%
5. Cache invalidates after a new attendance write
6. Role scoping: student can't fetch another student's %; faculty can't fetch other departments
7. Unassigned department reconciliation rule
"""

import os
import sys
import unittest
import math
from datetime import datetime, timedelta
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
    TeacherAssignment, StudentCondonation
)
from app.services.attendance_engine import (
    determine_jntuh_band,
    calculate_projected_classes_needed,
    AttendanceEngine,
    invalidate_attendance_cache,
    BAND_ELIGIBLE,
    BAND_CONDONABLE,
    BAND_DETAINED,
    BAND_NO_DATA
)
from app.core.security import create_access_token, get_password_hash


class TestAttendanceEngineSuite(unittest.TestCase):

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
        invalidate_attendance_cache()

    def tearDown(self):
        self.db.close()
        app.dependency_overrides.clear()
        invalidate_attendance_cache()

    # ==============================================================================
    # 1. BAND BOUNDARY UNIT TESTS
    # ==============================================================================
    def test_band_boundaries(self):
        """
        Verify exact JNTUH R25 band boundaries:
        - 64.99% -> DETAINED
        - 65.00% -> CONDONABLE
        - 74.99% -> CONDONABLE
        - 75.00% -> ELIGIBLE
        """
        self.assertEqual(determine_jntuh_band(64.99), BAND_DETAINED)
        self.assertEqual(determine_jntuh_band(64.994), BAND_DETAINED)
        self.assertEqual(determine_jntuh_band(65.0), BAND_CONDONABLE)
        self.assertEqual(determine_jntuh_band(65.00), BAND_CONDONABLE)
        self.assertEqual(determine_jntuh_band(70.0), BAND_CONDONABLE)
        self.assertEqual(determine_jntuh_band(74.99), BAND_CONDONABLE)
        self.assertEqual(determine_jntuh_band(75.0), BAND_ELIGIBLE)
        self.assertEqual(determine_jntuh_band(75.01), BAND_ELIGIBLE)
        self.assertEqual(determine_jntuh_band(100.0), BAND_ELIGIBLE)
        self.assertEqual(determine_jntuh_band(None), BAND_NO_DATA)

    # ==============================================================================
    # 2. ZERO-SESSION COURSE EDGE CASE
    # ==============================================================================
    def test_zero_session_course(self):
        """
        Verify student enrolled in course with zero sessions displays '—' and not 0%.
        """
        dept = Department(code="CSE", name="Computer Science")
        ay = AcademicYear(name="3rd Year")
        self.db.add_all([dept, ay])
        self.db.flush()

        sec = Section(name="CSE-A", department_id=dept.id, academic_year_id=ay.id)
        self.db.add(sec)
        self.db.flush()

        student = Student(
            roll_number="23311A0501",
            name="Alice Smith",
            department_id=dept.id,
            section_id=sec.id,
            academic_year_id=ay.id
        )
        course = Subject(
            code="CS301",
            name="Data Structures",
            department_id=dept.id,
            academic_year_id=ay.id
        )
        self.db.add_all([student, course])
        self.db.commit()

        result = AttendanceEngine.get_student_course_attendance(
            db=self.db,
            student=student,
            course=course,
            use_cache=False
        )

        self.assertEqual(result["sessions_conducted"], 0)
        self.assertEqual(result["effective_denominator"], 0)
        self.assertIsNone(result["percentage"])
        self.assertEqual(result["percentage_display"], "—")
        self.assertEqual(result["band"], BAND_NO_DATA)
        self.assertFalse(result["has_records"])

    # ==============================================================================
    # 3. APPROVED-ABSENCE EXCLUSION TESTS
    # ==============================================================================
    def test_approved_absence_exclusion(self):
        """
        Verify approved absences (medical/sports) are excluded from the denominator.
        Scenario:
        - 10 sessions total
        - 6 present
        - 2 absent (unapproved)
        - 2 absent (approved medical)
        Without exclusion: 6 / 10 = 60.0% -> DETAINED (<65%)
        With exclusion: 6 / (10 - 2) = 6 / 8 = 75.0% -> ELIGIBLE (>=75%)
        """
        dept = Department(code="ECE", name="Electronics")
        ay = AcademicYear(name="2nd Year")
        self.db.add_all([dept, ay])
        self.db.flush()

        sec = Section(name="ECE-A", department_id=dept.id, academic_year_id=ay.id)
        self.db.add(sec)
        self.db.flush()

        student = Student(
            roll_number="23311A0401",
            name="Bob Jones",
            department_id=dept.id,
            section_id=sec.id,
            academic_year_id=ay.id
        )
        course = Subject(
            code="EC201",
            name="Digital Signals",
            department_id=dept.id,
            academic_year_id=ay.id
        )
        self.db.add_all([student, course])
        self.db.flush()

        sessions = []
        for i in range(10):
            s_date = f"2026-08-{10+i:02d}"
            sess = AttendanceSession(
                teacher_id=1,
                subject_id=course.id,
                section_id=sec.id,
                period=f"Period {i+1}",
                session_date=s_date,
                status=SessionStatus.LOCKED
            )
            self.db.add(sess)
            sessions.append(sess)
        self.db.flush()

        # 6 Present records
        for i in range(6):
            rec = AttendanceRecord(
                session_id=sessions[i].id,
                student_id=student.id,
                roll_number=student.roll_number,
                session_date=sessions[i].session_date,
                status=AttendanceStatus.PRESENT,
                is_approved_absence=False
            )
            self.db.add(rec)

        # 2 Unapproved Absent records
        for i in range(6, 8):
            rec = AttendanceRecord(
                session_id=sessions[i].id,
                student_id=student.id,
                roll_number=student.roll_number,
                session_date=sessions[i].session_date,
                status=AttendanceStatus.ABSENT,
                is_approved_absence=False
            )
            self.db.add(rec)

        # 2 Approved Medical Absences
        for i in range(8, 10):
            rec = AttendanceRecord(
                session_id=sessions[i].id,
                student_id=student.id,
                roll_number=student.roll_number,
                session_date=sessions[i].session_date,
                status=AttendanceStatus.ABSENT,
                is_approved_absence=True,
                approved_absence_reason="MEDICAL"
            )
            self.db.add(rec)

        self.db.commit()

        # Calculation WITH approved absence exclusion (Default / Policy ON)
        res_with_policy = AttendanceEngine.get_student_course_attendance(
            db=self.db,
            student=student,
            course=course,
            include_approved_absences=True,
            use_cache=False
        )
        self.assertEqual(res_with_policy["sessions_conducted"], 10)
        self.assertEqual(res_with_policy["sessions_present"], 6)
        self.assertEqual(res_with_policy["approved_absences"], 2)
        self.assertEqual(res_with_policy["effective_denominator"], 8)
        self.assertEqual(res_with_policy["percentage"], 75.0)
        self.assertEqual(res_with_policy["band"], BAND_ELIGIBLE)

        # Calculation WITHOUT approved absence exclusion (Policy OFF)
        res_without_policy = AttendanceEngine.get_student_course_attendance(
            db=self.db,
            student=student,
            course=course,
            include_approved_absences=False,
            use_cache=False
        )
        self.assertEqual(res_without_policy["sessions_conducted"], 10)
        self.assertEqual(res_without_policy["sessions_present"], 6)
        self.assertEqual(res_without_policy["effective_denominator"], 10)
        self.assertEqual(res_without_policy["percentage"], 60.0)
        self.assertEqual(res_without_policy["band"], BAND_DETAINED)

    # ==============================================================================
    # 4. LATE-JOIN PRORATION TESTS
    # ==============================================================================
    def test_late_join_proration(self):
        """
        Verify late-join students are evaluated only from their join date onward.
        Scenario:
        - 10 sessions total conducted between 2026-08-01 and 2026-08-10.
        - Student join_date is 2026-08-05.
        - Sessions conducted before 2026-08-05: 4 sessions (excluded).
        - Sessions conducted on/after 2026-08-05: 6 sessions.
        - Student attended 5 of the 6 sessions.
        Without proration: 5 / 10 = 50.0% -> DETAINED.
        With proration: 5 / 6 = 83.33% -> ELIGIBLE.
        """
        dept = Department(code="MECH", name="Mechanical")
        ay = AcademicYear(name="1st Year")
        self.db.add_all([dept, ay])
        self.db.flush()

        sec = Section(name="MECH-A", department_id=dept.id, academic_year_id=ay.id)
        self.db.add(sec)
        self.db.flush()

        student = Student(
            roll_number="23311A0301",
            name="Charlie Brown",
            department_id=dept.id,
            section_id=sec.id,
            academic_year_id=ay.id,
            join_date="2026-08-05"
        )
        course = Subject(
            code="ME101",
            name="Thermodynamics",
            department_id=dept.id,
            academic_year_id=ay.id
        )
        self.db.add_all([student, course])
        self.db.flush()

        sessions = []
        for i in range(10):
            day = i + 1
            s_date = f"2026-08-{day:02d}"
            sess = AttendanceSession(
                teacher_id=1,
                subject_id=course.id,
                section_id=sec.id,
                period="Period 1",
                session_date=s_date,
                status=SessionStatus.LOCKED
            )
            self.db.add(sess)
            sessions.append(sess)
        self.db.flush()

        for i in range(4, 9):
            rec = AttendanceRecord(
                session_id=sessions[i].id,
                student_id=student.id,
                roll_number=student.roll_number,
                session_date=sessions[i].session_date,
                status=AttendanceStatus.PRESENT
            )
            self.db.add(rec)
        self.db.commit()

        res = AttendanceEngine.get_student_course_attendance(
            db=self.db,
            student=student,
            course=course,
            use_cache=False
        )

        self.assertEqual(res["sessions_conducted"], 6)
        self.assertEqual(res["sessions_present"], 5)
        self.assertEqual(res["effective_denominator"], 6)
        self.assertEqual(res["percentage"], 83.33)
        self.assertEqual(res["band"], BAND_ELIGIBLE)

    # ==============================================================================
    # 5. CACHE INVALIDATION TEST
    # ==============================================================================
    def test_cache_invalidation(self):
        """
        Verify in-process cache returns cached result until invalidated.
        """
        dept = Department(code="IT", name="Information Tech")
        ay = AcademicYear(name="4th Year")
        self.db.add_all([dept, ay])
        self.db.flush()

        sec = Section(name="IT-A", department_id=dept.id, academic_year_id=ay.id)
        self.db.add(sec)
        self.db.flush()

        student = Student(
            roll_number="23311A1201",
            name="David Miller",
            department_id=dept.id,
            section_id=sec.id,
            academic_year_id=ay.id
        )
        course = Subject(
            code="IT401",
            name="Cloud Computing",
            department_id=dept.id,
            academic_year_id=ay.id
        )
        self.db.add_all([student, course])
        self.db.flush()

        sess1 = AttendanceSession(
            teacher_id=1, subject_id=course.id, section_id=sec.id,
            period="P1", session_date="2026-08-01", status=SessionStatus.LOCKED
        )
        self.db.add(sess1)
        self.db.flush()

        rec1 = AttendanceRecord(
            session_id=sess1.id, student_id=student.id, roll_number=student.roll_number,
            session_date=sess1.session_date, status=AttendanceStatus.PRESENT
        )
        self.db.add(rec1)
        self.db.commit()

        # Cached evaluation: 100%
        res1 = AttendanceEngine.get_student_course_attendance(self.db, student, course, use_cache=True)
        self.assertEqual(res1["percentage"], 100.0)

        # Add absent records without invalidating cache
        sess2 = AttendanceSession(
            teacher_id=1, subject_id=course.id, section_id=sec.id,
            period="P2", session_date="2026-08-02", status=SessionStatus.LOCKED
        )
        sess3 = AttendanceSession(
            teacher_id=1, subject_id=course.id, section_id=sec.id,
            period="P3", session_date="2026-08-03", status=SessionStatus.LOCKED
        )
        self.db.add_all([sess2, sess3])
        self.db.flush()
        rec2 = AttendanceRecord(
            session_id=sess2.id, student_id=student.id, roll_number=student.roll_number,
            session_date=sess2.session_date, status=AttendanceStatus.ABSENT
        )
        rec3 = AttendanceRecord(
            session_id=sess3.id, student_id=student.id, roll_number=student.roll_number,
            session_date=sess3.session_date, status=AttendanceStatus.ABSENT
        )
        self.db.add_all([rec2, rec3])
        self.db.commit()

        # Cache returns 100%
        res_cached = AttendanceEngine.get_student_course_attendance(self.db, student, course, use_cache=True)
        self.assertEqual(res_cached["percentage"], 100.0)

        # Invalidate cache
        invalidate_attendance_cache(student_id=student.id)

        # Fresh evaluation: 1/3 = 33.33% (>= 3 sessions held triggers band evaluation)
        res_fresh = AttendanceEngine.get_student_course_attendance(self.db, student, course, use_cache=True)
        self.assertEqual(res_fresh["percentage"], 33.33)
        self.assertEqual(res_fresh["band"], BAND_DETAINED)

    # ==============================================================================
    # 6. ROLE SCOPING & AUTHENTICATION ENDPOINT TESTS
    # ==============================================================================
    def test_role_scoping_student_isolation(self):
        """
        Verify role scoping on GET /api/v1/analytics/student/{roll}/attendance:
        - Student A cannot access Student B's attendance (HTTP 403)
        - Student A can access own attendance (HTTP 200)
        - Admin can access any student (HTTP 200)
        """
        dept = Department(code="CSE", name="Computer Science")
        ay = AcademicYear(name="1st Year")
        self.db.add_all([dept, ay])
        self.db.flush()

        sec = Section(name="CSE-A", department_id=dept.id, academic_year_id=ay.id)
        self.db.add(sec)
        self.db.flush()

        user_a = User(username="23311A0501", password_hash=get_password_hash("pass123"), role=UserRole.STUDENT)
        user_b = User(username="23311A0502", password_hash=get_password_hash("pass123"), role=UserRole.STUDENT)
        admin_u = User(username="admin_test", password_hash=get_password_hash("admin123"), role=UserRole.SUPER_ADMIN)
        self.db.add_all([user_a, user_b, admin_u])
        self.db.flush()

        student_a = Student(user_id=user_a.id, roll_number="23311A0501", name="Student Alpha", department_id=dept.id, academic_year_id=ay.id, section_id=sec.id)
        student_b = Student(user_id=user_b.id, roll_number="23311A0502", name="Student Beta", department_id=dept.id, academic_year_id=ay.id, section_id=sec.id)
        self.db.add_all([student_a, student_b])
        self.db.commit()

        token_a = create_access_token({"sub": user_a.username, "role": user_a.role.value})
        token_admin = create_access_token({"sub": admin_u.username, "role": admin_u.role.value})

        # 1. Student A fetching Student A's own record -> 200 OK
        resp_own = self.client.get(
            f"/api/v1/analytics/student/{user_a.username}/attendance",
            headers={"Authorization": f"Bearer {token_a}"}
        )
        self.assertEqual(resp_own.status_code, 200)
        self.assertEqual(resp_own.json()["roll_number"], user_a.username)

        # 2. Student A attempting to fetch Student B's record -> 403 FORBIDDEN
        resp_forbidden = self.client.get(
            f"/api/v1/analytics/student/{user_b.username}/attendance",
            headers={"Authorization": f"Bearer {token_a}"}
        )
        self.assertEqual(resp_forbidden.status_code, 403)
        self.assertIn("Access denied", resp_forbidden.json()["detail"])

        # 3. Admin fetching Student B's record -> 200 OK
        resp_admin = self.client.get(
            f"/api/v1/analytics/student/{user_b.username}/attendance",
            headers={"Authorization": f"Bearer {token_admin}"}
        )
        self.assertEqual(resp_admin.status_code, 200)
        self.assertEqual(resp_admin.json()["roll_number"], user_b.username)

    def test_role_scoping_faculty_and_hod(self):
        """
        Verify faculty and HOD scoping:
        - Faculty cannot fetch department analytics for another department (HTTP 403)
        - Faculty cannot fetch analytics for course not assigned to them (HTTP 403)
        - Faculty can fetch their own assigned course and department (HTTP 200)
        """
        cse_dept = Department(code="CSE", name="CSE Test Dept")
        ece_dept = Department(code="ECE", name="ECE Test Dept")
        ay = AcademicYear(name="1st Year")
        self.db.add_all([cse_dept, ece_dept, ay])
        self.db.flush()

        course_cse = Subject(code="CS101", name="Intro CS", department_id=cse_dept.id, academic_year_id=ay.id)
        course_ece = Subject(code="EC101", name="Intro EC", department_id=ece_dept.id, academic_year_id=ay.id)
        self.db.add_all([course_cse, course_ece])
        self.db.flush()

        user_teacher = User(username="prof_cse", password_hash=get_password_hash("teach123"), role=UserRole.TEACHER)
        self.db.add(user_teacher)
        self.db.flush()

        teacher_profile = Teacher(
            user_id=user_teacher.id,
            teacher_code="T_CSE_01",
            name="Prof CSE",
            department_id=cse_dept.id
        )
        self.db.add(teacher_profile)
        self.db.commit()

        token_teacher = create_access_token({"sub": user_teacher.username, "role": user_teacher.role.value})

        # 1. Teacher in CSE requesting CSE department -> 200 OK
        resp_cse = self.client.get(
            f"/api/v1/hod/analytics/department/{cse_dept.code}",
            headers={"Authorization": f"Bearer {token_teacher}"}
        )
        self.assertEqual(resp_cse.status_code, 200)

        # 2. Teacher in CSE requesting ECE department -> 403 FORBIDDEN
        resp_ece = self.client.get(
            f"/api/v1/hod/analytics/department/{ece_dept.code}",
            headers={"Authorization": f"Bearer {token_teacher}"}
        )
        self.assertEqual(resp_ece.status_code, 403)
        self.assertIn("Access denied", resp_ece.json()["detail"])

        # 3. Teacher accessing unassigned ECE course -> 403 FORBIDDEN
        resp_course_forbidden = self.client.get(
            f"/api/v1/faculty/analytics/course/{course_ece.id}",
            headers={"Authorization": f"Bearer {token_teacher}"}
        )
        self.assertEqual(resp_course_forbidden.status_code, 403)

        # 4. Teacher accessing CSE course in their department -> 200 OK
        resp_course_ok = self.client.get(
            f"/api/v1/faculty/analytics/course/{course_cse.id}",
            headers={"Authorization": f"Bearer {token_teacher}"}
        )
        self.assertEqual(resp_course_ok.status_code, 200)

    # ==============================================================================
    # 7. UNASSIGNED DEPARTMENT RECONCILIATION TEST
    # ==============================================================================
    def test_unassigned_department_reconciliation(self):
        """
        Verify students with unassigned department appear in the 'Unassigned' bucket
        in the department compliance summary and are never dropped.
        """
        dept = Department(code="CIVIL", name="Civil Engineering")
        self.db.add(dept)
        self.db.flush()

        normal_student = Student(
            roll_number="CIVIL_01",
            name="Civil Student",
            department_id=dept.id,
            academic_year_id=1,
            section_id=1
        )
        unassigned_student = Student(
            roll_number="UNASSIGNED_01",
            name="Orphan Student",
            department_id=None,
            academic_year_id=None,
            section_id=None
        )
        self.db.add_all([normal_student, unassigned_student])
        self.db.commit()

        summary = AttendanceEngine.get_department_compliance_summary(db=self.db, use_cache=False)
        dept_codes = [d["department_code"] for d in summary["departments"]]
        self.assertIn("Unassigned", dept_codes)

        unassigned_dept = next(d for d in summary["departments"] if d["department_code"] == "Unassigned")
        self.assertEqual(unassigned_dept["total_enrolled"], 1)
        self.assertEqual(summary["total_students"], 2)


if __name__ == "__main__":
    unittest.main()
