"""
Automated Test Suite for Bi-Directional Google Sheet Attendance Reconciliation,
Auto-Provisioning, and Credentials Dispatch Engine.
Location: backend/tests/test_gsheet_reconciliation.py
"""

import unittest
from unittest.mock import MagicMock, patch
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.models.models import (
    User, UserRole, Teacher, Department, AcademicYear, Section, Subject,
    TeacherAssignment, Student, AttendanceSession, AttendanceRecord,
    AttendanceStatus, SessionStatus
)
from app.core.security import get_password_hash
from app.services.gsheet_reconciliation_service import GSheetReconciliationService


class TestGSheetReconciliation(unittest.TestCase):

    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(bind=self.engine)
        TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)
        self.db = TestingSessionLocal()

        # Department, Academic Year, Section, Subject
        self.dept = Department(code="CSE", name="Computer Science & Engineering")
        self.db.add(self.dept)
        self.db.flush()

        self.ay = AcademicYear(name="3rd Year")
        self.db.add(self.ay)
        self.db.flush()

        self.sec = Section(name="CSE-A", department_id=self.dept.id, academic_year_id=self.ay.id)
        self.db.add(self.sec)
        self.db.flush()

        self.subj = Subject(name="Career Enhancement Training (CET)", code="CS301", department_id=self.dept.id, academic_year_id=self.ay.id)
        self.db.add(self.subj)
        self.db.flush()

        # Faculty
        self.user_t = User(
            username="faculty_srikanth",
            email="srikanth@sreenidhi.edu.in",
            password_hash=get_password_hash("password123"),
            role=UserRole.TEACHER,
            is_active=True
        )
        self.db.add(self.user_t)
        self.db.flush()

        self.teacher = Teacher(
            user_id=self.user_t.id,
            teacher_code="T_SRIKANTH",
            name="Srikanth M",
            department_id=self.dept.id,
            google_sheet_id="sheet_mock_123"
        )
        self.db.add(self.teacher)
        self.db.flush()

        # Class Assignment
        self.asgn = TeacherAssignment(
            teacher_id=self.teacher.id,
            subject_id=self.subj.id,
            section_id=self.sec.id,
            google_sheet_id="sheet_mock_123"
        )
        self.db.add(self.asgn)
        self.db.flush()

    def tearDown(self):
        self.db.close()
        Base.metadata.drop_all(bind=self.engine)

    def _build_mock_sheet(self, student_rows, headers=None):
        if headers is None:
            headers = ["SNO", "ROLL NO", "NAME", "GENDER", "SECTION", "16/9/26", "TOTAL"]

        vals = [
            ["SREENIDHI INSTITUTE OF SCIENCE & TECHNOLOGY"],
            ["DEPARTMENT OF COMPUTER SCIENCE & ENGINEERING"],
            ["ACADEMIC YEAR: 2026-27"],
            ["SUBJECT: CET"],
            ["SECTION: CSE-A"],
            headers
        ] + student_rows

        mock_ws = MagicMock()
        mock_ws.title = "CSE-A"
        mock_ws.get_all_values.return_value = vals

        mock_sp = MagicMock()
        mock_sp.worksheets.return_value = [mock_ws]
        mock_sp.sheet1 = mock_ws
        return mock_sp, mock_ws, vals

    @patch("app.services.gsheets_service.GoogleSheetsService._update_worksheet_values")
    @patch("app.services.gsheets_service.GoogleSheetsService._open_spreadsheet")
    @patch("app.services.gsheets_service.GoogleSheetsService._get_client")
    def test_auto_provision_missing_student_from_sheet(self, mock_get_client, mock_open_sp, mock_update_ws):
        """Verifies a student present in the Google Sheet but missing from App DB is auto-provisioned."""
        sheet_rows = [
            ["1", "23311A1201", "Existing Student", "M", "CSE-A", "4", "4"],
            ["2", "23311A1299", "New Lateral Student", "F", "CSE-A", "4", "4"],
        ]
        # Pre-seed existing student in DB
        u1 = User(username="23311A1201", email="23311a1201@cse.sreenidhi.edu.in", password_hash=get_password_hash("123456"), role=UserRole.STUDENT)
        self.db.add(u1)
        self.db.flush()
        s1 = Student(user_id=u1.id, roll_number="23311A1201", name="Existing Student", section_id=self.sec.id, department_id=self.dept.id, academic_year_id=self.ay.id)
        self.db.add(s1)
        self.db.commit()

        mock_sp, mock_ws, _ = self._build_mock_sheet(sheet_rows)
        mock_open_sp.return_value = mock_sp

        res = GSheetReconciliationService.reconcile_class_assignment(
            db=self.db,
            assignment_id=self.asgn.id,
            notify_students=False
        )

        self.assertEqual(res["status"], "SUCCESS")
        self.assertEqual(res["summary"]["new_students_provisioned"], 1)

        # Verify DB contains new student
        new_st = self.db.query(Student).filter(Student.roll_number == "23311A1299").first()
        self.assertIsNotNone(new_st)
        self.assertEqual(new_st.name, "New Lateral Student")
        self.assertEqual(new_st.section_id, self.sec.id)

        # Verify User account created
        new_user = self.db.query(User).filter(User.username == "23311A1299").first()
        self.assertIsNotNone(new_user)
        self.assertEqual(new_user.role, UserRole.STUDENT)
        self.assertTrue(new_user.is_active)

    @patch("app.services.gsheet_reconciliation_service.send_single_email")
    @patch("app.services.gsheets_service.GoogleSheetsService._update_worksheet_values")
    @patch("app.services.gsheets_service.GoogleSheetsService._open_spreadsheet")
    @patch("app.services.gsheets_service.GoogleSheetsService._get_client")
    def test_credentials_dispatch_on_student_provisioning(self, mock_get_client, mock_open_sp, mock_update_ws, mock_send_email):
        """Verifies credentials email with magic login link is dispatched when student is auto-provisioned."""
        mock_send_email.return_value = {"status": "SENT", "to": "23311a1288@cse.sreenidhi.edu.in"}

        sheet_rows = [
            ["1", "23311A1288", "Adarsh Student", "M", "CSE-A", "4", "4"],
        ]
        mock_sp, mock_ws, _ = self._build_mock_sheet(sheet_rows)
        mock_open_sp.return_value = mock_sp

        res = GSheetReconciliationService.reconcile_class_assignment(
            db=self.db,
            assignment_id=self.asgn.id,
            notify_students=True
        )

        self.assertEqual(res["summary"]["new_students_provisioned"], 1)
        self.assertEqual(res["summary"]["credentials_dispatched"], 1)
        self.assertTrue(mock_send_email.called)
        call_args = mock_send_email.call_args[1]
        self.assertEqual(call_args["to_email"], "23311a1288@cse.sreenidhi.edu.in")
        self.assertIn("Your Account Credentials", call_args["subject"])

    @patch("app.services.gsheets_service.GoogleSheetsService._update_worksheet_values")
    @patch("app.services.gsheets_service.GoogleSheetsService._open_spreadsheet")
    @patch("app.services.gsheets_service.GoogleSheetsService._get_client")
    def test_sheet_to_app_attendance_backfill(self, mock_get_client, mock_open_sp, mock_update_ws):
        """Verifies attendance marked present in Google Sheet is backfilled into App DB."""
        # Pre-seed student
        u = User(username="23311A1205", email="23311a1205@cse.sreenidhi.edu.in", password_hash=get_password_hash("123456"), role=UserRole.STUDENT)
        self.db.add(u)
        self.db.flush()
        st = Student(user_id=u.id, roll_number="23311A1205", name="Student 05", section_id=self.sec.id, department_id=self.dept.id, academic_year_id=self.ay.id)
        self.db.add(st)
        self.db.flush()

        # Pre-seed historical session for 2026-09-16
        sess = AttendanceSession(
            teacher_id=self.teacher.id,
            subject_id=self.subj.id,
            section_id=self.sec.id,
            period="Period 1-4 (4 Periods)",
            session_date="2026-09-16",
            status=SessionStatus.LOCKED
        )
        self.db.add(sess)
        self.db.commit()

        # In Sheet: Student is Present ("4") on 16/9/26
        sheet_rows = [
            ["1", "23311A1205", "Student 05", "M", "CSE-A", "4", "4"],
        ]
        mock_sp, mock_ws, _ = self._build_mock_sheet(sheet_rows)
        mock_open_sp.return_value = mock_sp

        res = GSheetReconciliationService.reconcile_class_assignment(
            db=self.db,
            assignment_id=self.asgn.id,
            notify_students=False
        )

        self.assertEqual(res["summary"]["sheet_to_app_reconciled"], 1)

        # Verify AttendanceRecord created in App DB
        rec = self.db.query(AttendanceRecord).filter(
            AttendanceRecord.session_id == sess.id,
            AttendanceRecord.student_id == st.id
        ).first()
        self.assertIsNotNone(rec)
        self.assertEqual(rec.status, AttendanceStatus.PRESENT)
        self.assertEqual(rec.period_count, 4)
        self.assertEqual(rec.scan_mode, "GSHEET_RECONCILIATION")

    @patch("app.services.gsheets_service.GoogleSheetsService._update_worksheet_values")
    @patch("app.services.gsheets_service.GoogleSheetsService._open_spreadsheet")
    @patch("app.services.gsheets_service.GoogleSheetsService._get_client")
    def test_app_to_sheet_attendance_repair(self, mock_get_client, mock_open_sp, mock_update_ws):
        """Verifies attendance marked present in App DB but Absent ('A') in Google Sheet is repaired."""
        u = User(username="23311A1206", email="23311a1206@cse.sreenidhi.edu.in", password_hash=get_password_hash("123456"), role=UserRole.STUDENT)
        self.db.add(u)
        self.db.flush()
        st = Student(user_id=u.id, roll_number="23311A1206", name="Student 06", section_id=self.sec.id, department_id=self.dept.id, academic_year_id=self.ay.id)
        self.db.add(st)
        self.db.flush()

        sess = AttendanceSession(
            teacher_id=self.teacher.id,
            subject_id=self.subj.id,
            section_id=self.sec.id,
            period="Period 1-4 (4 Periods)",
            session_date="2026-09-16",
            status=SessionStatus.LOCKED
        )
        self.db.add(sess)
        self.db.flush()

        # Present in App!
        rec = AttendanceRecord(
            session_id=sess.id,
            student_id=st.id,
            roll_number="23311A1206",
            session_date="2026-09-16",
            period_count=4,
            status=AttendanceStatus.PRESENT
        )
        self.db.add(rec)
        self.db.commit()

        # In Sheet: Student is Absent ("A") on 16/9/26
        sheet_rows = [
            ["1", "23311A1206", "Student 06", "M", "CSE-A", "A", "0"],
        ]
        mock_sp, mock_ws, _ = self._build_mock_sheet(sheet_rows)
        mock_open_sp.return_value = mock_sp

        res = GSheetReconciliationService.reconcile_class_assignment(
            db=self.db,
            assignment_id=self.asgn.id,
            notify_students=False
        )

        self.assertEqual(res["summary"]["app_to_sheet_reconciled"], 1)
        self.assertTrue(mock_update_ws.called)
        # Verify call updated worksheet
        call_kwargs = mock_update_ws.call_args[1]
        updated_grid = call_kwargs["values"]
        # Student row is row index 6 (7th row) and column 5 (6th col, 16/9/26)
        self.assertEqual(updated_grid[6][5], "4")


if __name__ == "__main__":
    unittest.main()
