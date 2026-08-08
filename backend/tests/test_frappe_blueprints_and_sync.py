import os
import json
import unittest
from datetime import date
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models.models import (
    Base, User, UserRole, Department, AcademicYear, Section, Subject,
    Teacher, Student, AttendanceSession, AttendanceRecord, SessionStatus, AttendanceStatus
)
from app.core.frappe_sync import sync_session_to_frappe
from snist_erp.snist_erp.api import sync_attendance_session

class TestFrappeBlueprintsAndSync(unittest.TestCase):
    def setUp(self):
        # Create shared SQLite memory DB
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(bind=self.engine)
        SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)
        self.db = SessionLocal()

        # Seed sample data
        dept = Department(code="CSE", name="Computer Science")
        ay = AcademicYear(name="2025-2026")
        self.db.add_all([dept, ay])
        self.db.commit()

        sec = Section(name="3A", department_id=dept.id, academic_year_id=ay.id)
        subj = Subject(code="CS301", name="Data Structures", department_id=dept.id, academic_year_id=ay.id)
        self.db.add_all([sec, subj])
        self.db.commit()

        u_teacher = User(username="fac101", email="fac101@sreenidhi.edu.in", password_hash="hash", role=UserRole.TEACHER)
        u_student = User(username="21CS001", email="21cs001@sreenidhi.edu.in", password_hash="hash", role=UserRole.STUDENT)
        self.db.add_all([u_teacher, u_student])
        self.db.commit()

        teacher = Teacher(user_id=u_teacher.id, teacher_code="EMP101", name="John Doe", department_id=dept.id)
        student = Student(user_id=u_student.id, roll_number="21CS001", name="Alice Smith", department_id=dept.id, academic_year_id=ay.id, section_id=sec.id)
        self.db.add_all([teacher, student])
        self.db.commit()

        session = AttendanceSession(
            teacher_id=teacher.id,
            subject_id=subj.id,
            section_id=sec.id,
            period="Period 1",
            session_date=str(date.today()),
            status=SessionStatus.LOCKED
        )
        self.db.add(session)
        self.db.commit()

        att = AttendanceRecord(
            session_id=session.id,
            student_id=student.id,
            roll_number="21CS001",
            session_date=str(date.today()),
            status=AttendanceStatus.PRESENT
        )
        self.db.add(att)
        self.db.commit()
        self.session_id = session.id

    def tearDown(self):
        self.db.close()

    def test_01_doctype_json_blueprints_exist_and_valid(self):
        """Test 1 — DocType JSON Blueprint validation"""
        base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../snist_erp/snist_erp/doctype"))
        doctypes = ["snist_teaching_assignment", "snist_period", "snist_attendance_session"]

        for dt in doctypes:
            path = os.path.join(base_dir, dt, f"{dt}.json")
            self.assertTrue(os.path.exists(path), f"Missing DocType JSON blueprint at {path}")
            with open(path, "r") as f:
                data = json.load(f)
                self.assertEqual(data["doctype"], "DocType")
                self.assertIn("fields", data)
                self.assertTrue(len(data["fields"]) > 0)

    def test_02_custom_fields_blueprints_exist_and_valid(self):
        """Test 2 — Custom Fields Blueprint validation"""
        base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../snist_erp/snist_erp/custom_fields"))
        custom_fields = ["student.json", "instructor.json", "student_attendance.json"]

        for cf in custom_fields:
            path = os.path.join(base_dir, cf)
            self.assertTrue(os.path.exists(path), f"Missing Custom Field blueprint at {path}")
            with open(path, "r") as f:
                data = json.load(f)
                self.assertIsInstance(data, list)
                self.assertTrue(len(data) > 0)

    def test_03_frappe_sync_api_missing_payload(self):
        """Test 3 — Frappe REST API Handles Missing Payload Gracefully"""
        res = sync_attendance_session(None)
        self.assertEqual(res["status"], "ERROR")
        self.assertIn("Missing", res["detail"])

    def test_04_fastapi_sync_client_network_fallback(self):
        """Test 4 — FastAPI Sync Client Gracefully Handles Offline ERP Endpoint"""
        # Point to unreachable port to test timeout/defensive exception handling
        res = sync_session_to_frappe(self.db, self.session_id, frappe_url="http://127.0.0.1:9999/api/sync")
        self.assertEqual(res["status"], "ERROR")
        self.assertIn("failed gracefully", res["detail"])

if __name__ == "__main__":
    unittest.main()
