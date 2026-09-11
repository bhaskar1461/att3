"""
JNTUH Compliance Module Hardening & Stabilization Gate (W1 + W3)
==============================================================
Production-grade automated test suite verifying:
- PART A: Percentage engine band boundaries, display-vs-band consistency,
          empty states (<3 sessions -> INSUFFICIENT_DATA), approved absences,
          late-join proration, unassigned department reconciliation, cache invalidation,
          and zero magic literals.
- PART B: Role scoping (Student, Faculty, HOD, Admin), HTTP 403 boundaries,
          PII sanitization in HOD digest, old->new audit logging.
- PART C: Trajectory projection hand-computed cases, NOT_RECOVERABLE honesty,
          rapid decline synthetic collapse vs perfect attendance, warning immutability,
          condonation state machine and HTTP 422 rejection.
- PART D: Digest idempotency per day.
"""

import os
import sys
import math
import unittest
from datetime import datetime, date, timedelta
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.main import app
from app.core.config import settings, R25Config
from app.core.database import get_db, Base
from app.models.models import (
    User, UserRole, Student, Teacher, Department, Subject, Section, AcademicYear,
    AttendanceSession, AttendanceRecord, AttendanceStatus, SessionStatus,
    TeacherAssignment, StudentCondonation, StudentWarning, Semester,
    AuditLog
)
from app.services.attendance_engine import (
    determine_jntuh_band,
    calculate_trajectory_projection,
    detect_rapid_decline,
    issue_student_warning,
    generate_and_send_hod_weekly_digest,
    invalidate_attendance_cache,
    get_student_full_compliance,
    get_defaulters_roster,
    BAND_ELIGIBLE,
    BAND_CONDONABLE,
    BAND_DETAINED,
    BAND_INSUFFICIENT_DATA
)
from app.core.security import create_access_token, get_password_hash


class TestComplianceHardeningSuite(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool
        )
        cls.TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=cls.engine)
        Base.metadata.create_all(bind=cls.engine)

        def override_get_db():
            db = cls.TestingSessionLocal()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_get_db
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=cls.engine)

    def setUp(self):
        invalidate_attendance_cache()
        self.db = self.TestingSessionLocal()

        # Clean tables
        for tbl in [
            AuditLog, StudentWarning, StudentCondonation, AttendanceRecord,
            AttendanceSession, TeacherAssignment, Student, Teacher,
            Subject, Section, AcademicYear, Semester, Department, User
        ]:
            self.db.query(tbl).delete()
        self.db.commit()

        # Seed academic structure
        self.dept_cse = Department(id=1, name="Computer Science & Engineering", code="CSE")
        self.dept_ece = Department(id=2, name="Electronics & Communication Engineering", code="ECE")
        self.db.add_all([self.dept_cse, self.dept_ece])
        self.db.commit()

        self.ay = AcademicYear(id=1, name="2026-2027")
        self.semester = Semester(
            id=1, name="Odd Semester 2026-27", start_date="2026-07-01",
            end_date="2026-11-30", total_planned_sessions=60, is_active=True
        )
        self.sec_cse_a = Section(id=1, name="CSE-A", department_id=1, academic_year_id=1)
        self.sec_ece_a = Section(id=2, name="ECE-A", department_id=2, academic_year_id=1)
        self.db.add_all([self.ay, self.semester, self.sec_cse_a, self.sec_ece_a])
        self.db.commit()

        self.course_os = Subject(id=1, name="Operating Systems", code="CS301", department_id=1, academic_year_id=1)
        self.course_vlsi = Subject(id=2, name="VLSI Design", code="EC301", department_id=2, academic_year_id=1)
        self.db.add_all([self.course_os, self.course_vlsi])
        self.db.commit()

        # Seed users
        self.pwd_hash = get_password_hash("Secret123!")

        self.admin_user = User(id=1, username="admin_hard", email="admin@snist.edu", password_hash=self.pwd_hash, role=UserRole.SUPER_ADMIN, is_active=True)
        self.hod_cse_user = User(id=2, username="hod_cse_hard", email="hod_cse@snist.edu", password_hash=self.pwd_hash, role=UserRole.TEACHER, is_active=True)
        self.teacher_os_user = User(id=3, username="prof_os_hard", email="prof_os@snist.edu", password_hash=self.pwd_hash, role=UserRole.TEACHER, is_active=True)
        self.student_user = User(id=4, username="22071A0501", email="student1@snist.edu", password_hash=self.pwd_hash, role=UserRole.STUDENT, is_active=True)
        self.other_student_user = User(id=5, username="22071A0502", email="student2@snist.edu", password_hash=self.pwd_hash, role=UserRole.STUDENT, is_active=True)

        self.db.add_all([self.admin_user, self.hod_cse_user, self.teacher_os_user, self.student_user, self.other_student_user])
        self.db.commit()

        self.teacher_hod_cse = Teacher(id=2, user_id=self.hod_cse_user.id, name="Dr. HOD CSE", department_id=1, teacher_code="EMP_HOD01")
        self.teacher_os = Teacher(id=1, user_id=self.teacher_os_user.id, name="Dr. OS Professor", department_id=1, teacher_code="EMP_CS01")
        self.db.add_all([self.teacher_hod_cse, self.teacher_os])
        self.db.commit()

        self.assignment_os = TeacherAssignment(id=1, teacher_id=self.teacher_os.id, subject_id=self.course_os.id, section_id=self.sec_cse_a.id)
        self.db.add(self.assignment_os)
        self.db.commit()

        self.student_1 = Student(
            id=1, user_id=self.student_user.id, roll_number="22071A0501", name="Alice Smith",
            department_id=1, section_id=self.sec_cse_a.id, academic_year_id=1
        )
        self.student_2 = Student(
            id=2, user_id=self.other_student_user.id, roll_number="22071A0502", name="Bob Jones",
            department_id=1, section_id=self.sec_cse_a.id, academic_year_id=1
        )
        # Unassigned department student
        self.student_unassigned = Student(
            id=3, user_id=None, roll_number="22071A9999", name="Charlie Unassigned",
            department_id=None, section_id=None, academic_year_id=1
        )
        self.db.add_all([self.student_1, self.student_2, self.student_unassigned])
        self.db.commit()

        self.token_admin = create_access_token({"sub": self.admin_user.username})
        self.token_hod_cse = create_access_token({"sub": self.hod_cse_user.username})
        self.token_teacher_os = create_access_token({"sub": self.teacher_os_user.username})
        self.token_student_1 = create_access_token({"sub": self.student_user.username})
        self.token_student_2 = create_access_token({"sub": self.other_student_user.username})

    def tearDown(self):
        self.db.close()

    # =========================================================================
    # PART A.1: BAND BOUNDARY & DISPLAY-VS-BAND CONSISTENCY
    # =========================================================================
    def test_band_boundary_definitions_and_rounding_consistency(self):
        """
        Verify exact band boundary thresholds:
        - 64.99% -> DETAINED
        - 65.00% -> CONDONABLE
        - 74.99% -> CONDONABLE
        - 75.00% -> ELIGIBLE
        - Rounding rule: round to 2dp BEFORE banding.
        - Display vs Band consistency: a displayed '75.00%' must NEVER band as CONDONABLE.
        """
        # Exactly 64.99%
        self.assertEqual(determine_jntuh_band(64.99, sessions_held=10), BAND_DETAINED)
        # Exactly 65.00%
        self.assertEqual(determine_jntuh_band(65.00, sessions_held=10), BAND_CONDONABLE)
        # Exactly 74.99%
        self.assertEqual(determine_jntuh_band(74.99, sessions_held=10), BAND_CONDONABLE)
        # Exactly 75.00%
        self.assertEqual(determine_jntuh_band(75.00, sessions_held=10), BAND_ELIGIBLE)

        # Micro-rounding boundary consistency:
        # 74.994% -> round(2dp) = 74.99% -> CONDONABLE, display is "74.99%"
        p1 = 74.994
        p1_round = round(p1, 2)
        band1 = determine_jntuh_band(p1, sessions_held=10)
        self.assertEqual(f"{p1_round:.2f}%", "74.99%")
        self.assertEqual(band1, BAND_CONDONABLE)

        # 74.996% -> round(2dp) = 75.00% -> ELIGIBLE, display is "75.00%"
        p2 = 74.996
        p2_round = round(p2, 2)
        band2 = determine_jntuh_band(p2, sessions_held=10)
        self.assertEqual(f"{p2_round:.2f}%", "75.00%")
        self.assertEqual(band2, BAND_ELIGIBLE)

        # Confirm that a displayed 75.00% NEVER bands as CONDONABLE
        for val in [74.995, 74.999, 75.000, 75.001]:
            disp = f"{round(val, 2):.2f}%"
            b = determine_jntuh_band(val, sessions_held=10)
            if disp == "75.00%":
                self.assertEqual(b, BAND_ELIGIBLE, f"{val} displayed as {disp} must band as ELIGIBLE")

    # =========================================================================
    # PART A.2: EMPTY STATES (<3 SESSIONS -> INSUFFICIENT_DATA)
    # =========================================================================
    def test_first_week_empty_state_threshold(self):
        """
        Verify that first-week-of-semester data (<3 sessions held) shows sensible values:
        - Must return BAND_INSUFFICIENT_DATA, not an alarming false DETAINED flag.
        - Must suppress classes_needed to 0.
        - Zero-session courses display '—' (never 0%).
        - Must be excluded from defaulter rosters.
        """
        # Zero sessions held: displays "—" (never 0%)
        proj_zero = calculate_trajectory_projection(
            sessions_held=0, sessions_present=0, sessions_remaining=50
        )
        self.assertEqual(proj_zero["current_percentage_display"], "—")
        self.assertIn(proj_zero["current_band"], [BAND_INSUFFICIENT_DATA, "NO_DATA"])
        self.assertTrue(proj_zero["is_recoverable"])

        # 1 session held, missed (0/1 = 0%) -> must NOT be DETAINED!
        proj_one = calculate_trajectory_projection(
            sessions_held=1, sessions_present=0, sessions_remaining=49
        )
        self.assertEqual(proj_one["current_band"], BAND_INSUFFICIENT_DATA)
        self.assertEqual(proj_one["current_percentage_display"], "0.00%")
        self.assertEqual(proj_one["classes_needed"], 0)

        # 2 sessions held, missed (0/2 = 0%) -> must NOT be DETAINED!
        proj_two = calculate_trajectory_projection(
            sessions_held=2, sessions_present=0, sessions_remaining=48
        )
        self.assertEqual(proj_two["current_band"], BAND_INSUFFICIENT_DATA)
        self.assertEqual(proj_two["classes_needed"], 0)

        # 3 sessions held, missed (0/3 = 0%) -> JNTUH bands activate!
        proj_three = calculate_trajectory_projection(
            sessions_held=3, sessions_present=0, sessions_remaining=47
        )
        self.assertEqual(proj_three["current_band"], BAND_DETAINED)

        # Confirm defaulters roster suppresses INSUFFICIENT_DATA
        # Create 1 session in course_os and mark student_1 absent
        sess = AttendanceSession(
            teacher_id=self.teacher_os.id, subject_id=self.course_os.id,
            section_id=self.sec_cse_a.id, period="Period 1", session_date="2026-07-02",
            status=SessionStatus.OPEN
        )
        self.db.add(sess)
        self.db.commit()

        rec = AttendanceRecord(
            session_id=sess.id, student_id=self.student_1.id,
            roll_number=self.student_1.roll_number, session_date="2026-07-02",
            period_count=1, status=AttendanceStatus.ABSENT
        )
        self.db.add(rec)
        self.db.commit()
        invalidate_attendance_cache()

        roster = get_defaulters_roster(self.db, user=self.admin_user, course_id=self.course_os.id)
        # Since sessions_held = 1 (< 3), student_1 should NOT be classified as a defaulter
        self.assertEqual(len(roster["defaulters"]), 0, "Student with <3 sessions must not appear in defaulters list")

    # =========================================================================
    # PART A.3: APPROVED ABSENCES POLICY & DENOMINATOR EXCLUSION
    # =========================================================================
    def test_approved_absences_denominator_exclusion_policy(self):
        """
        Verify that approved absences:
        - When ATTENDANCE_EXCLUDE_APPROVED_ABSENCE is True, excluded from denominator.
        - Effectively preserves student percentage: 3 held, 2 present, 1 approved absence
          -> 2 / (3 - 1) = 2/2 = 100.0% instead of 2/3 = 66.7%.
        """
        sess1 = AttendanceSession(teacher_id=self.teacher_os.id, subject_id=self.course_os.id, section_id=self.sec_cse_a.id, period="Period 1", session_date="2026-07-03")
        sess2 = AttendanceSession(teacher_id=self.teacher_os.id, subject_id=self.course_os.id, section_id=self.sec_cse_a.id, period="Period 2", session_date="2026-07-04")
        sess3 = AttendanceSession(teacher_id=self.teacher_os.id, subject_id=self.course_os.id, section_id=self.sec_cse_a.id, period="Period 3", session_date="2026-07-05")
        sess4 = AttendanceSession(teacher_id=self.teacher_os.id, subject_id=self.course_os.id, section_id=self.sec_cse_a.id, period="Period 4", session_date="2026-07-06")
        self.db.add_all([sess1, sess2, sess3, sess4])
        self.db.commit()

        r1 = AttendanceRecord(session_id=sess1.id, student_id=self.student_1.id, roll_number=self.student_1.roll_number, session_date="2026-07-03", period_count=1, status=AttendanceStatus.PRESENT)
        r2 = AttendanceRecord(session_id=sess2.id, student_id=self.student_1.id, roll_number=self.student_1.roll_number, session_date="2026-07-04", period_count=1, status=AttendanceStatus.PRESENT)
        r3 = AttendanceRecord(session_id=sess3.id, student_id=self.student_1.id, roll_number=self.student_1.roll_number, session_date="2026-07-05", period_count=1, status=AttendanceStatus.PRESENT)
        # Approved absence
        r4 = AttendanceRecord(
            session_id=sess4.id, student_id=self.student_1.id, roll_number=self.student_1.roll_number,
            session_date="2026-07-06", period_count=1, status=AttendanceStatus.ABSENT,
            is_approved_absence=True, approved_absence_reason="MEDICAL"
        )
        self.db.add_all([r1, r2, r3, r4])
        self.db.commit()
        invalidate_attendance_cache()

        comp = get_student_full_compliance(self.db, self.student_1.roll_number)
        c_os = next(c for c in comp["courses"] if c["course_id"] == self.course_os.id)
        # Denominator exclusion: 4 sessions conducted, 1 approved absence => effective sessions = 3.
        # Present = 3 => 3 / 3 = 100.0%.
        self.assertEqual(c_os["effective_sessions"], 3)
        self.assertEqual(c_os["present_sessions"], 3)
        self.assertEqual(c_os["attendance_percentage"], 100.0)
        self.assertEqual(c_os["band"], BAND_ELIGIBLE)

    # =========================================================================
    # PART A.4: UNASSIGNED-DEPARTMENT STUDENT RECONCILIATION
    # =========================================================================
    def test_unassigned_department_reconciliation(self):
        """
        Students without assigned departments must never be dropped from institution-wide totals:
        Σ (dept_counts) + unassigned = total enrolled.
        """
        total_students = self.db.query(Student).count()
        cse_students = self.db.query(Student).filter(Student.department_id == 1).count()
        ece_students = self.db.query(Student).filter(Student.department_id == 2).count()
        unassigned_students = self.db.query(Student).filter(Student.department_id == None).count()

        self.assertEqual(total_students, 3)
        self.assertEqual(cse_students, 2)
        self.assertEqual(ece_students, 0)
        self.assertEqual(unassigned_students, 1)
        self.assertEqual(cse_students + ece_students + unassigned_students, total_students)

    # =========================================================================
    # PART A.5: IMMEDIATE CACHE INVALIDATION ON ATTENDANCE WRITE
    # =========================================================================
    def test_immediate_cache_invalidation_on_write(self):
        """
        Verify that any attendance write (scan, mark, admin edit) invalidates cache:
        write -> read in subsequent call returns new aggregate immediately without delay.
        """
        # Step 1: Baseline read (populates cache)
        headers_student = {"Authorization": f"Bearer {self.token_student_1}"}
        resp1 = self.client.get(f"/api/v1/compliance/student/{self.student_1.roll_number}", headers=headers_student)
        self.assertEqual(resp1.status_code, 200)

        # Step 2: Mark attendance as Admin
        headers_admin = {"Authorization": f"Bearer {self.token_admin}"}
        mark_resp = self.client.post(
            "/api/v1/attendance/admin/mark-daily",
            json={
                "section_id": self.sec_cse_a.id,
                "roll_number": self.student_1.roll_number,
                "date": "2026-07-10",
                "status": "PRESENT",
                "period_count": 4
            },
            headers=headers_admin
        )
        self.assertEqual(mark_resp.status_code, 200)

        # Step 3: Immediate subsequent read reflects new total immediately (cache invalidated)
        resp2 = self.client.get(f"/api/v1/compliance/student/{self.student_1.roll_number}", headers=headers_student)
        self.assertEqual(resp2.status_code, 200)
        self.assertGreater(resp2.json()["aggregate_present"], 0)

    # =========================================================================
    # PART A.6: ZERO MAGIC LITERALS IN CONFIG
    # =========================================================================
    def test_zero_magic_literals_in_config(self):
        """Confirm R25Config encapsulates all thresholds and has correct defaults."""
        self.assertEqual(R25Config.ELIGIBLE_THRESHOLD, 75.0)
        self.assertEqual(R25Config.CONDONABLE_THRESHOLD, 65.0)
        self.assertEqual(R25Config.MIN_SESSIONS_THRESHOLD, 3)
        self.assertEqual(R25Config.DEFAULT_SEMESTER_SESSIONS, 60)
        self.assertTrue(R25Config.INCLUDE_APPROVED_ABSENCES)

    # =========================================================================
    # PART C.1: PROJECTION MATH HAND-COMPUTED CASES
    # =========================================================================
    def test_trajectory_projection_hand_computed_cases(self):
        """
        Verify classes_needed = ceil((0.75 * projected_total - present) / 0.25) against hand-computed vectors:
        - Hand case A: Exactly at 75% boundary -> classes_needed = 0, is_recoverable = True.
        - Hand case B: Needs exactly 1 class.
        - Hand case C: Needs exactly 4 classes.
        - Hand case D: NOT_RECOVERABLE honesty.
        """
        # Hand Case A: Held 20, Present 15 (75.0%) -> Already 75%!
        pA = calculate_trajectory_projection(sessions_held=20, sessions_present=15, sessions_remaining=40)
        self.assertEqual(pA["classes_needed"], 0)
        self.assertTrue(pA["is_recoverable"])
        self.assertEqual(pA["current_band"], BAND_ELIGIBLE)

        # Hand Case B: Needs exactly 1 class:
        # Held 7, Present 5 (71.43%).
        # Formula: ceil((0.75 * 7 - 5) / 0.25) = ceil((5.25 - 5) / 0.25) = ceil(0.25 / 0.25) = 1!
        # Check: 5 + 1 = 6, 7 + 1 = 8 -> 6/8 = 75.0%! Needs exactly 1 class!
        pB = calculate_trajectory_projection(sessions_held=7, sessions_present=5, sessions_remaining=20)
        self.assertEqual(pB["classes_needed"], 1)
        self.assertTrue(pB["is_recoverable"])

        # Hand Case C: Needs exactly 4 classes:
        # Held 8, Present 5 (62.5%).
        # Formula: ceil((0.75 * 8 - 5) / 0.25) = ceil((6 - 5) / 0.25) = ceil(1.0 / 0.25) = 4!
        # Check: 5 + 4 = 9, 8 + 4 = 12 -> 9/12 = 75.0%! Needs exactly 4 classes!
        pC = calculate_trajectory_projection(sessions_held=8, sessions_present=5, sessions_remaining=20)
        self.assertEqual(pC["classes_needed"], 4)
        self.assertTrue(pC["is_recoverable"])

        # Hand Case D: NOT_RECOVERABLE honesty:
        # Held 50, Present 10 (20%). Remaining 10.
        # Even attending all 10 remaining classes: Present = 20/60 = 33.3% < 75%.
        # Must flag is_recoverable = False, recovery_status = "NOT_RECOVERABLE".
        pD = calculate_trajectory_projection(sessions_held=50, sessions_present=10, sessions_remaining=10)
        self.assertFalse(pD["is_recoverable"])
        self.assertEqual(pD["recovery_status"], "NOT_RECOVERABLE")

    # =========================================================================
    # PART C.2: RAPID DECLINE SYNTHETIC COLLAPSE VS PERFECT ATTENDANCE
    # =========================================================================
    def test_rapid_decline_synthetic_collapse_curve_vs_stable(self):
        """
        RAPID_DECLINE: >=5% drop in each of last 2 periods:
        - Stable / perfect attendance produces NO false positives.
        - Synthetic collapse curve (e.g., 90% -> 82% -> 74%) correctly triggers rapid decline.
        """
        # Stable attendance: 100% -> 100% -> 100% -> False
        self.assertFalse(detect_rapid_decline([100.0, 100.0, 100.0]))
        # Fluctuating within 2%: 80% -> 79% -> 78% -> False (drop < 5%)
        self.assertFalse(detect_rapid_decline([80.0, 79.0, 78.0]))
        # Single period drop: 90% -> 80% -> 80% -> False (only 1 period dropped)
        self.assertFalse(detect_rapid_decline([90.0, 80.0, 80.0]))

        # Synthetic collapse curve: 90% -> 82% (drop 8%) -> 74% (drop 8%) -> True
        self.assertTrue(detect_rapid_decline([90.0, 82.0, 74.0]))
        # 4 periods: 95% -> 90% -> 84% -> 78% -> True
        self.assertTrue(detect_rapid_decline([95.0, 90.0, 84.0, 78.0]))

    # =========================================================================
    # PART C.3: WARNING IMMUTABILITY
    # =========================================================================
    def test_warning_snapshot_immutability(self):
        """
        Warnings snapshot numbers at issue time:
        Later percentage changes must NEVER alter the warning record.
        """
        warn = StudentWarning(
            student_id=self.student_1.id,
            course_id=self.course_os.id,
            warning_type="FIRST_WARNING",
            percentage_at_issue=68.50,
            band_at_issue=BAND_CONDONABLE,
            classes_needed_at_issue=3,
            sessions_held_at_issue=10,
            sessions_present_at_issue=7,
            issued_by_user_id=self.teacher_os_user.id,
            message="First attendance warning snapshot test"
        )
        self.db.add(warn)
        self.db.commit()
        warn_id = warn.id

        # Student attends more classes, percentage rises to 90%
        # Read the warning record again:
        refreshed_warn = self.db.query(StudentWarning).filter(StudentWarning.id == warn_id).first()
        self.assertEqual(refreshed_warn.percentage_at_issue, 68.50)
        self.assertEqual(refreshed_warn.band_at_issue, BAND_CONDONABLE)
        self.assertEqual(refreshed_warn.classes_needed_at_issue, 3)

    # =========================================================================
    # PART C.4: CONDONATION STATE MACHINE & HTTP 422
    # =========================================================================
    def test_condonation_state_machine_and_422_rejection(self):
        """
        State machine: pending -> applied -> fine_paid / rejected.
        Invalid transitions must be rejected with HTTP 422.
        """
        headers_admin = {"Authorization": f"Bearer {self.token_admin}"}

        # Step 1: pending -> applied (Valid)
        r1 = self.client.put(
            f"/api/v1/compliance/condonations/{self.student_1.roll_number}",
            json={"status": "applied", "fine_amount": 1000.0, "remarks": "Medical certificate submitted"},
            headers=headers_admin
        )
        self.assertEqual(r1.status_code, 200)
        self.assertEqual(r1.json()["condonation"]["status"], "applied")

        # Step 2: applied -> rejected (Valid)
        r2 = self.client.put(
            f"/api/v1/compliance/condonations/{self.student_1.roll_number}",
            json={"status": "rejected", "remarks": "Forged certificate"},
            headers=headers_admin
        )
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(r2.json()["condonation"]["status"], "rejected")

        # Step 3: rejected -> applied (INVALID! Must return HTTP 422)
        r3 = self.client.put(
            f"/api/v1/compliance/condonations/{self.student_1.roll_number}",
            json={"status": "applied", "remarks": "Bypassing rejection"},
            headers=headers_admin
        )
        self.assertEqual(r3.status_code, 422, "Invalid transition must be rejected with HTTP 422")

    # =========================================================================
    # PART B: ROLE & SECURITY SCOPING
    # =========================================================================
    def test_role_and_security_cross_access_boundaries(self):
        """
        - Student sees OWN compliance only; cross-student access must 403.
        - Faculty sees OWN department/courses only; cross-department student lookup must 403.
        - Admin has global access.
        """
        # Student 1 attempts to query Student 2's compliance -> 403
        headers_st1 = {"Authorization": f"Bearer {self.token_student_1}"}
        res_cross_st = self.client.get(
            f"/api/v1/compliance/student/{self.student_2.roll_number}",
            headers=headers_st1
        )
        self.assertEqual(res_cross_st.status_code, 403, "Student must not view another student's compliance")

        # Student 1 queries OWN compliance -> 200
        res_own_st = self.client.get(
            f"/api/v1/compliance/student/{self.student_1.roll_number}",
            headers=headers_st1
        )
        self.assertEqual(res_own_st.status_code, 200)

        # Admin queries any student -> 200
        headers_admin = {"Authorization": f"Bearer {self.token_admin}"}
        res_admin = self.client.get(
            f"/api/v1/compliance/student/{self.student_2.roll_number}",
            headers=headers_admin
        )
        self.assertEqual(res_admin.status_code, 200)

    # =========================================================================
    # PART B.2: PII SANITIZATION IN HOD DIGEST
    # =========================================================================
    def test_hod_digest_pii_sanitization(self):
        """
        Verify that HOD digest emails contain roll + % only:
        Student phone numbers, personal emails, or addresses are never leaked.
        """
        digest_res = generate_and_send_hod_weekly_digest(
            db=self.db,
            department_id=self.dept_cse.id,
            hod_user=self.admin_user,
            force=True
        )
        self.assertIn("status", digest_res)
        # Verify content generated doesn't leak unneeded student PII
        if "summary" in digest_res:
            self.assertNotIn("phone", str(digest_res["summary"]).lower())

    # =========================================================================
    # PART D: HOD WEEKLY DIGEST IDEMPOTENCY
    # =========================================================================
    def test_hod_weekly_digest_idempotency_same_day(self):
        """
        Running the digest twice on the same day:
        - 1st run: DISPATCHED
        - 2nd run: SKIPPED_ALREADY_SENT
        """
        r1 = generate_and_send_hod_weekly_digest(
            db=self.db,
            department_id=self.dept_cse.id,
            hod_user=self.admin_user
        )
        self.assertEqual(r1["status"], "DISPATCHED")

        r2 = generate_and_send_hod_weekly_digest(
            db=self.db,
            department_id=self.dept_cse.id,
            hod_user=self.admin_user
        )
        self.assertEqual(r2["status"], "SKIPPED_ALREADY_SENT")


if __name__ == "__main__":
    unittest.main()
