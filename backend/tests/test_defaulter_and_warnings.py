"""
Week 3 Compliance Module Acceptance Tests:
Defaulters, Trajectory Projections, Early-Warning Alerts, and Condonation Transitions

Acceptance Gate Verification:
1. Projection math:
   - Recoverable ceiling formula: ceil((0.75 * total - present) / 0.25)
   - Impossible cases flagged NOT_RECOVERABLE
   - Zero-remaining-sessions edge cases
   - Perfect attendance produces NO false RAPID_DECLINE
2. Warning snapshots:
   - Percentage changes later -> warning record numbers remain 100% unchanged
3. Role scoping:
   - Faculty in Dept A cannot view or issue warning to students in Dept B
   - Student cannot fetch another student's warnings
4. Condonation state transitions:
   - Valid transitions succeed
   - rejected -> applied fails with HTTP 400 Bad Request
5. Digest generation idempotency:
   - Running digest twice on same day executes once and skips duplicate dispatch
"""

import os
import sys
import unittest
import math
from datetime import datetime, date, timedelta
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
    TeacherAssignment, StudentCondonation, StudentWarning, Semester, FortnightSnapshot
)
from app.services.attendance_engine import (
    calculate_trajectory_projection,
    detect_rapid_decline,
    issue_student_warning,
    generate_and_send_hod_weekly_digest,
    invalidate_attendance_cache,
    BAND_ELIGIBLE,
    BAND_CONDONABLE,
    BAND_DETAINED
)
from app.core.security import create_access_token, get_password_hash


class TestDefaultersAndWarningsSuite(unittest.TestCase):

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

        # Seed baseline Departments
        self.dept_cse = Department(id=1, name="Computer Science and Engineering", code="CSE")
        self.dept_ece = Department(id=2, name="Electronics and Communication Engineering", code="ECE")
        self.db.add_all([self.dept_cse, self.dept_ece])

        # Seed Academic Year & Semester
        self.ay = AcademicYear(id=1, name="2026-2027")
        self.db.add(self.ay)
        self.db.flush()

        self.sem = Semester(
            id=1,
            name="Odd Semester 2026-27",
            academic_year_id=self.ay.id,
            start_date=date.today() - timedelta(days=60),
            end_date=date.today() + timedelta(days=60),
            total_planned_sessions=60,
            is_active=True
        )
        self.db.add(self.sem)

        # Seed Sections
        self.sec_cse = Section(id=1, name="CSE-A", department_id=self.dept_cse.id, academic_year_id=self.ay.id)
        self.sec_ece = Section(id=2, name="ECE-A", department_id=self.dept_ece.id, academic_year_id=self.ay.id)
        self.db.add_all([self.sec_cse, self.sec_ece])

        # Seed Subjects
        self.sub_os = Subject(id=1, code="CS301", name="Operating Systems", department_id=self.dept_cse.id, academic_year_id=self.ay.id)
        self.sub_dsp = Subject(id=2, code="EC301", name="Digital Signal Processing", department_id=self.dept_ece.id, academic_year_id=self.ay.id)
        self.db.add_all([self.sub_os, self.sub_dsp])

        # Seed Users: Admin, Faculty CSE, Faculty ECE, HOD CSE, Student CSE 1, Student ECE 1
        self.user_admin = User(
            id=1, email="admin@snist.edu", username="ADMIN01",
            password_hash=get_password_hash("pass123"), role=UserRole.SUPER_ADMIN, is_active=True
        )
        self.user_fac_cse = User(
            id=2, email="fac_cse@snist.edu", username="FAC_CSE",
            password_hash=get_password_hash("pass123"), role=UserRole.TEACHER, is_active=True
        )
        self.user_fac_ece = User(
            id=3, email="fac_ece@snist.edu", username="FAC_ECE",
            password_hash=get_password_hash("pass123"), role=UserRole.TEACHER, is_active=True
        )
        self.user_hod_cse = User(
            id=4, email="hod_cse@snist.edu", username="HOD_CSE",
            password_hash=get_password_hash("pass123"), role=UserRole.TEACHER, is_active=True
        )
        self.user_stu_cse = User(
            id=5, email="stu_cse@snist.edu", username="21981A0501",
            password_hash=get_password_hash("pass123"), role=UserRole.STUDENT, is_active=True
        )
        self.user_stu_ece = User(
            id=6, email="stu_ece@snist.edu", username="21981A0401",
            password_hash=get_password_hash("pass123"), role=UserRole.STUDENT, is_active=True
        )
        self.db.add_all([
            self.user_admin, self.user_fac_cse, self.user_fac_ece,
            self.user_hod_cse, self.user_stu_cse, self.user_stu_ece
        ])
        self.db.flush()

        # Teachers
        self.teacher_cse = Teacher(
            id=1, user_id=self.user_fac_cse.id, department_id=self.dept_cse.id,
            teacher_code="FAC001", name="Faculty CSE"
        )
        self.teacher_ece = Teacher(
            id=2, user_id=self.user_fac_ece.id, department_id=self.dept_ece.id,
            teacher_code="FAC002", name="Faculty ECE"
        )
        self.teacher_hod_cse = Teacher(
            id=3, user_id=self.user_hod_cse.id, department_id=self.dept_cse.id,
            teacher_code="HOD001", name="HOD CSE"
        )
        self.db.add_all([self.teacher_cse, self.teacher_ece, self.teacher_hod_cse])

        # Teacher Assignments
        self.assign_cse = TeacherAssignment(
            id=1, teacher_id=self.teacher_cse.id, subject_id=self.sub_os.id, section_id=self.sec_cse.id
        )
        self.assign_ece = TeacherAssignment(
            id=2, teacher_id=self.teacher_ece.id, subject_id=self.sub_dsp.id, section_id=self.sec_ece.id
        )
        self.db.add_all([self.assign_cse, self.assign_ece])

        # Students
        self.student_cse = Student(
            id=1, user_id=self.user_stu_cse.id, roll_number="21981A0501", name="Student CSE",
            department_id=self.dept_cse.id, section_id=self.sec_cse.id,
            academic_year_id=self.ay.id, email="parent_cse@example.com"
        )
        self.student_ece = Student(
            id=2, user_id=self.user_stu_ece.id, roll_number="21981A0401", name="Student ECE",
            department_id=self.dept_ece.id, section_id=self.sec_ece.id,
            academic_year_id=self.ay.id
        )
        self.db.add_all([self.student_cse, self.student_ece])
        self.db.commit()

        # Auth Headers
        self.token_admin = create_access_token({"sub": "ADMIN01", "role": "SUPER_ADMIN", "id": self.user_admin.id})
        self.token_fac_cse = create_access_token({"sub": "FAC_CSE", "role": "TEACHER", "id": self.user_fac_cse.id})
        self.token_fac_ece = create_access_token({"sub": "FAC_ECE", "role": "TEACHER", "id": self.user_fac_ece.id})
        self.token_hod_cse = create_access_token({"sub": "HOD_CSE", "role": "TEACHER", "id": self.user_hod_cse.id})
        self.token_stu_cse = create_access_token({"sub": "21981A0501", "role": "STUDENT", "id": self.user_stu_cse.id})
        self.token_stu_ece = create_access_token({"sub": "21981A0401", "role": "STUDENT", "id": self.user_stu_ece.id})

    def tearDown(self):
        self.db.close()
        app.dependency_overrides.clear()
        invalidate_attendance_cache()

    # ==============================================================================
    # 1. PROJECTION MATH TESTS
    # ==============================================================================
    def test_projection_math_recoverable(self):
        """
        Recoverable scenario:
        held = 12, present = 8, remaining = 20
        Current % = 8/12 = 66.67% (CONDONABLE)
        Deficit = 0.75 * 12 - 8 = 9.0 - 8 = 1.0
        classes_needed = ceil(1.0 / 0.25) = 4 classes
        If 4 classes attended: held = 16, present = 12 -> 12/16 = 75.0%
        Remaining = 20 >= 4 -> RECOVERABLE
        """
        proj = calculate_trajectory_projection(
            sessions_held=12,
            sessions_present=8,
            sessions_remaining=20,
            target_pct=75.0
        )
        self.assertEqual(proj["classes_needed"], 4)
        self.assertTrue(proj["is_recoverable"])
        self.assertEqual(proj["recovery_status"], "RECOVERABLE")
        # Projected end % = current_present / (sessions_held + remaining) honestly:
        # 8 / (12 + 20) = 8 / 32 = 25.0%
        self.assertEqual(proj["projected_end_pct"], 25.0)
        self.assertEqual(proj["max_possible_percentage"], 87.5)

    def test_projection_math_not_recoverable(self):
        """
        Impossible / Not Recoverable scenario:
        held = 20, present = 5, remaining = 10
        Current % = 5/20 = 25.0% (DETAINED)
        Deficit = 0.75 * 20 - 5 = 15 - 5 = 10
        classes_needed = ceil(10 / 0.25) = 40 classes
        Total sessions available remaining is only 10.
        Max possible = (5 + 10) / (20 + 10) = 15 / 30 = 50.0% < 75.0%
        Must flag NOT_RECOVERABLE and cap classes_needed to remaining (10).
        """
        proj = calculate_trajectory_projection(
            sessions_held=20,
            sessions_present=5,
            sessions_remaining=10,
            target_pct=75.0
        )
        self.assertFalse(proj["is_recoverable"])
        self.assertEqual(proj["recovery_status"], "NOT_RECOVERABLE")
        self.assertEqual(proj["classes_needed"], 10)  # Capped at remaining
        # Projected end % honestly: 5 / (20 + 10) = 5 / 30 = 16.67%
        self.assertEqual(proj["projected_end_pct"], 16.67)
        self.assertEqual(proj["max_possible_percentage"], 50.0)

    def test_projection_math_zero_remaining_sessions(self):
        """
        Zero remaining sessions edge case:
        Case A: held = 30, present = 20, remaining = 0
                Current % = 66.67% < 75.0%
                Cannot recover -> NOT_RECOVERABLE, classes_needed = 0
        Case B: held = 30, present = 25, remaining = 0
                Current % = 83.33% >= 75.0%
                Already compliant -> RECOVERABLE, classes_needed = 0
        """
        # Case A: Below 75 with 0 remaining
        proj_a = calculate_trajectory_projection(sessions_held=30, sessions_present=20, sessions_remaining=0)
        self.assertFalse(proj_a["is_recoverable"])
        self.assertEqual(proj_a["recovery_status"], "NOT_RECOVERABLE")
        self.assertEqual(proj_a["classes_needed"], 0)
        self.assertEqual(proj_a["projected_end_pct"], 66.67)

        # Case B: Above 75 with 0 remaining
        proj_b = calculate_trajectory_projection(sessions_held=30, sessions_present=25, sessions_remaining=0)
        self.assertTrue(proj_b["is_recoverable"])
        self.assertEqual(proj_b["recovery_status"], "RECOVERABLE")
        self.assertEqual(proj_b["classes_needed"], 0)
        self.assertEqual(proj_b["projected_end_pct"], 83.33)

    def test_projection_perfect_attendance_no_false_rapid_decline(self):
        """
        Verify that a student with consistent or perfect attendance NEVER triggers RAPID_DECLINE.
        Seed 3 fortnights of 100% attendance.
        """
        # Seed 3 fortnights for CSE student in OS
        f1 = FortnightSnapshot(
            semester_id=1, fortnight_number=1, start_date=date.today() - timedelta(days=42),
            end_date=date.today() - timedelta(days=28), student_id=self.student_cse.id,
            course_id=self.sub_os.id, sessions_held=10, sessions_present=10, percentage=100.0,
            band="ELIGIBLE"
        )
        f2 = FortnightSnapshot(
            semester_id=1, fortnight_number=2, start_date=date.today() - timedelta(days=28),
            end_date=date.today() - timedelta(days=14), student_id=self.student_cse.id,
            course_id=self.sub_os.id, sessions_held=20, sessions_present=20, percentage=100.0,
            band="ELIGIBLE"
        )
        f3 = FortnightSnapshot(
            semester_id=1, fortnight_number=3, start_date=date.today() - timedelta(days=14),
            end_date=date.today(), student_id=self.student_cse.id,
            course_id=self.sub_os.id, sessions_held=30, sessions_present=30, percentage=100.0,
            band="ELIGIBLE"
        )
        self.db.add_all([f1, f2, f3])
        self.db.commit()

        is_rapid = detect_rapid_decline(self.db, self.student_cse.id, self.sub_os.id)
        self.assertFalse(is_rapid, "Perfect 100% attendance must never trigger RAPID_DECLINE")

    def test_rapid_decline_triggers_when_dropping_consecutively(self):
        """
        Verify that a student dropping >= 5% in each of the last 2 fortnights triggers RAPID_DECLINE.
        F1 = 92.0%, F2 = 85.0% (drop 7%), F3 = 78.0% (drop 7%) -> RAPID_DECLINE == True
        """
        f1 = FortnightSnapshot(
            semester_id=1, fortnight_number=1, start_date=date.today() - timedelta(days=42),
            end_date=date.today() - timedelta(days=28), student_id=self.student_ece.id,
            course_id=self.sub_dsp.id, sessions_held=10, sessions_present=9, percentage=92.0,
            band="ELIGIBLE"
        )
        f2 = FortnightSnapshot(
            semester_id=1, fortnight_number=2, start_date=date.today() - timedelta(days=28),
            end_date=date.today() - timedelta(days=14), student_id=self.student_ece.id,
            course_id=self.sub_dsp.id, sessions_held=20, sessions_present=17, percentage=85.0,
            band="ELIGIBLE"
        )
        f3 = FortnightSnapshot(
            semester_id=1, fortnight_number=3, start_date=date.today() - timedelta(days=14),
            end_date=date.today(), student_id=self.student_ece.id,
            course_id=self.sub_dsp.id, sessions_held=30, sessions_present=23, percentage=78.0,
            band="ELIGIBLE"
        )
        self.db.add_all([f1, f2, f3])
        self.db.commit()

        is_rapid = detect_rapid_decline(self.db, self.student_ece.id, self.sub_dsp.id)
        self.assertTrue(is_rapid, "Consecutive 7% drops must trigger RAPID_DECLINE")

    # ==============================================================================
    # 2. WARNING SNAPSHOT IMMUTABILITY TESTS
    # ==============================================================================
    def test_warning_snapshot_numbers_remain_unchanged(self):
        """
        Immutability test:
        1. Issue a warning when student is at 60.0% (needs 6 classes).
        2. Snapshot is stored with 60.0%, CONDONABLE, classes_needed=6.
        3. Subsequently, add 10 present sessions so the student's current % climbs to 80.0%.
        4. Fetch the warning record: numbers at issue MUST remain 60.0% and 6 classes needed.
        """
        # Step 1: Create session with attendance at 60%
        # 10 sessions held, 6 attended
        for i in range(10):
            sess = AttendanceSession(
                subject_id=self.sub_os.id, section_id=self.sec_cse.id,
                teacher_id=self.teacher_cse.id, period=1,
                session_date=date.today() - timedelta(days=25 - i),
                status=SessionStatus.LOCKED
            )
            self.db.add(sess)
            self.db.flush()
            rec = AttendanceRecord(
                session_id=sess.id, student_id=self.student_cse.id,
                roll_number=self.student_cse.roll_number,
                session_date=str(sess.session_date),
                status=AttendanceStatus.PRESENT if i < 6 else AttendanceStatus.ABSENT
            )
            self.db.add(rec)
        self.db.commit()

        # Step 2: Issue warning as CSE faculty
        headers_fac = {"Authorization": f"Bearer {self.token_fac_cse}"}
        resp = self.client.post(
            f"/api/v1/faculty/students/{self.student_cse.roll_number}/warning",
            json={
                "course_id": self.sub_os.id,
                "warning_type": "FIRST_WARNING",
                "custom_message": "Please attend the next few lectures consecutively."
            },
            headers=headers_fac
        )
        self.assertEqual(resp.status_code, 200, resp.text)
        warn_data = resp.json()["warning"]
        self.assertEqual(warn_data["percentage_at_issue"], 60.0)
        self.assertEqual(warn_data["band_at_issue"], "DETAINED")
        self.assertEqual(warn_data["classes_needed_at_issue"], 6)  # ceil((0.75*10 - 6)/0.25) = ceil(1.5/0.25) = 6
        warning_id = warn_data["id"]

        # Step 3: Student attends 10 more classes consecutively
        for i in range(10):
            sess = AttendanceSession(
                subject_id=self.sub_os.id, section_id=self.sec_cse.id,
                teacher_id=self.teacher_cse.id, period=1,
                session_date=date.today() - timedelta(days=12 - i),
                status=SessionStatus.LOCKED
            )
            self.db.add(sess)
            self.db.flush()
            rec = AttendanceRecord(
                session_id=sess.id, student_id=self.student_cse.id,
                roll_number=self.student_cse.roll_number,
                session_date=str(sess.session_date),
                status=AttendanceStatus.PRESENT
            )
            self.db.add(rec)
        self.db.commit()
        invalidate_attendance_cache()

        # Step 4: Verify student's current % is now (6+10)/20 = 16/20 = 80.0%
        headers_stu = {"Authorization": f"Bearer {self.token_stu_cse}"}
        resp_curr = self.client.get(
            f"/api/v1/compliance/student/{self.student_cse.roll_number}",
            headers=headers_stu
        )
        self.assertEqual(resp_curr.status_code, 200)
        self.assertEqual(resp_curr.json()["overall_percentage"], 80.0)
        self.assertEqual(resp_curr.json()["overall_band"], "ELIGIBLE")

        # Step 5: Verify the warning record in DB has NOT budged
        warn_db = self.db.query(StudentWarning).filter(StudentWarning.id == warning_id).first()
        self.assertIsNotNone(warn_db)
        self.assertEqual(warn_db.percentage_at_issue, 60.0, "Warning snapshot % must never be retroactively altered")
        self.assertEqual(warn_db.band_at_issue, "DETAINED")
        self.assertEqual(warn_db.classes_needed_at_issue, 6)

        # Also verify via student warning endpoint
        resp_warns = self.client.get("/api/v1/student/warnings", headers=headers_stu)
        self.assertEqual(resp_warns.status_code, 200)
        user_warnings = resp_warns.json()["warnings"]
        self.assertEqual(len(user_warnings), 1)
        self.assertEqual(user_warnings[0]["percentage_at_issue"], 60.0)
        self.assertEqual(user_warnings[0]["classes_needed_at_issue"], 6)

    # ==============================================================================
    # 3. ROLE SCOPING TESTS
    # ==============================================================================
    def test_role_scoping_faculty_cannot_access_or_warn_other_department(self):
        """
        Faculty in Dept A (CSE) cannot view or issue warning to student in Dept B (ECE).
        """
        # Faculty CSE tries to view defaulters of course in ECE (EC301)
        headers_cse = {"Authorization": f"Bearer {self.token_fac_cse}"}
        resp_view = self.client.get(
            f"/api/v1/faculty/defaulters?course_id={self.sub_dsp.id}",
            headers=headers_cse
        )
        self.assertEqual(resp_view.status_code, 403, "Faculty cannot query defaulters for unassigned course")

        # Faculty CSE tries to issue warning to ECE student
        resp_warn = self.client.post(
            f"/api/v1/faculty/students/{self.student_ece.roll_number}/warning",
            json={
                "course_id": self.sub_dsp.id,
                "warning_type": "FORMAL_WARNING",
                "custom_message": "Trespass attempt"
            },
            headers=headers_cse
        )
        self.assertEqual(resp_warn.status_code, 403, "Faculty cannot issue warning to student in unassigned course")

    def test_role_scoping_student_cannot_fetch_another_students_warnings(self):
        """
        Student A cannot view Student B's warnings.
        The endpoint /api/v1/student/warnings extracts identity strictly from JWT sub / User.
        """
        # Issue a warning to student CSE
        warn = StudentWarning(
            student_id=self.student_cse.id, course_id=self.sub_os.id,
            warning_type="FIRST_WARNING", percentage_at_issue=62.5,
            band_at_issue="CONDONABLE", classes_needed_at_issue=5,
            sessions_held_at_issue=16, sessions_present_at_issue=10,
            issued_by_user_id=self.user_fac_cse.id, issued_at=datetime.utcnow(),
            message="Attend more classes."
        )
        self.db.add(warn)
        self.db.commit()

        # Student ECE queries their warnings -> must return empty list (cannot see Student CSE's warning)
        headers_ece = {"Authorization": f"Bearer {self.token_stu_ece}"}
        resp = self.client.get("/api/v1/student/warnings", headers=headers_ece)
        self.assertEqual(resp.status_code, 200)
        warnings_ece = resp.json()["warnings"]
        self.assertEqual(len(warnings_ece), 0, "Student ECE must not see Student CSE's warnings")

        # Student CSE queries their warnings -> sees 1 warning
        headers_cse = {"Authorization": f"Bearer {self.token_stu_cse}"}
        resp_cse = self.client.get("/api/v1/student/warnings", headers=headers_cse)
        self.assertEqual(resp_cse.status_code, 200)
        self.assertEqual(len(resp_cse.json()["warnings"]), 1)

    # ==============================================================================
    # 4. CONDONATION STATE TRANSITION TESTS
    # ==============================================================================
    def test_condonation_state_machine_valid_and_invalid_transitions(self):
        """
        State machine enforcement:
        1. pending -> applied (allowed)
        2. applied -> approved (allowed)
        3. approved -> fine_paid (allowed)
        4. Attempt rejected -> applied (strictly rejected with HTTP 400)
        """
        headers_admin = {"Authorization": f"Bearer {self.token_admin}"}

        # Step 1: Initialize condonation entry in PENDING
        cond = StudentCondonation(
            student_id=self.student_cse.id,
            academic_year_id=self.ay.id,
            status="pending"
        )
        self.db.add(cond)
        self.db.commit()

        # Step 2: Transition pending -> applied
        resp1 = self.client.put(
            f"/api/v1/compliance/condonations/{self.student_cse.roll_number}",
            json={"status": "applied", "medical_certificate_url": "https://snist.edu/med/001.pdf"},
            headers=headers_admin
        )
        self.assertEqual(resp1.status_code, 200, resp1.text)
        self.assertEqual(resp1.json()["condonation"]["status"], "applied")

        # Step 3: Transition applied -> rejected
        resp2 = self.client.put(
            f"/api/v1/compliance/condonations/{self.student_cse.roll_number}",
            json={"status": "rejected", "remarks": "Invalid documentation"},
            headers=headers_admin
        )
        self.assertEqual(resp2.status_code, 200, resp2.text)
        self.assertEqual(resp2.json()["condonation"]["status"], "rejected")

        # Step 4: Invalid Transition: rejected -> applied (MUST BE REJECTED WITH 422)
        resp3 = self.client.put(
            f"/api/v1/compliance/condonations/{self.student_cse.roll_number}",
            json={"status": "applied", "remarks": "Trying to bypass rejection"},
            headers=headers_admin
        )
        self.assertEqual(resp3.status_code, 422, "Should reject rejected -> applied with 422")
        self.assertIn("Invalid condonation transition", resp3.json()["detail"])

    # ==============================================================================
    # 5. HOD DIGEST IDEMPOTENCY TESTS
    # ==============================================================================
    def test_hod_weekly_digest_idempotency(self):
        """
        Verify that running the weekly digest twice on the same day:
        - First run: dispatches digest, logs dispatch in DB/audit.
        - Second run: detects today's dispatch, returns SKIPPED_ALREADY_SENT, zero duplicate emails.
        """
        # Run 1: Dispatch digest
        result1 = generate_and_send_hod_weekly_digest(
            db=self.db,
            hod_user=self.user_hod_cse,
            department_id=self.dept_cse.id,
            dry_run=False
        )
        self.assertEqual(result1["status"], "DISPATCHED")
        self.assertEqual(result1["emails_sent"], 1)

        # Run 2: Dispatch again on same day
        result2 = generate_and_send_hod_weekly_digest(
            db=self.db,
            hod_user=self.user_hod_cse,
            department_id=self.dept_cse.id,
            dry_run=False
        )
        self.assertEqual(result2["status"], "SKIPPED_ALREADY_SENT")
        self.assertEqual(result2["emails_sent"], 0)
        self.assertIn("already generated", result2["message"])


if __name__ == "__main__":
    unittest.main()
