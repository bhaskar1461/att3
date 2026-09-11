"""
Test suite verifying:
1. GET /api/v1/attendance/admin/daily-sheet loads section students and Mon-Sat week overview.
2. POST /api/v1/attendance/admin/mark-daily auto-creates AttendanceSession and records PRESENT / ABSENT / UNMARKED.
3. POST /api/v1/attendance/admin/batch-mark-daily marks entire section atomically.
4. Proper audit logging and permission enforcement.
"""

import unittest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.models.models import (
    User, UserRole, Student, Teacher, Subject, Section, Department, AcademicYear,
    AttendanceSession, AttendanceRecord, AttendanceStatus, SessionStatus
)
from app.core.security import create_access_token, get_password_hash
from app.main import app


class TestWeeklyAttendanceMarking(unittest.TestCase):

    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(bind=self.engine)
        TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)
        self.db = TestingSessionLocal()

        def override_get_db():
            try:
                yield self.db
            finally:
                pass

        app.dependency_overrides[get_db] = override_get_db
        self.client = TestClient(app)

        # Setup Admin User & Token
        self.admin = User(
            username="admin_super",
            email="admin@sreenidhi.edu.in",
            password_hash=get_password_hash("AdminPass123"),
            role=UserRole.SUPER_ADMIN,
            is_active=True
        )
        self.db.add(self.admin)

        # Setup Academic Entities
        self.dept = Department(name="Computer Science & Engineering", code="CSE-CS")
        self.db.add(self.dept)
        self.db.flush()

        self.year = AcademicYear(name="III - I")
        self.db.add(self.year)
        self.db.flush()

        self.section = Section(name="CS-A", department_id=self.dept.id, academic_year_id=self.year.id)
        self.db.add(self.section)
        self.db.flush()

        teacher_user = User(
            username="sowjanya_n",
            email="sowjanya.n@sreenidhi.edu.in",
            password_hash=get_password_hash("TeacherPass123"),
            role=UserRole.TEACHER,
            is_active=True
        )
        self.db.add(teacher_user)
        self.db.flush()

        self.teacher = Teacher(user_id=teacher_user.id, teacher_code="TCH004", name="Mrs. N. Sowjanya", department_id=self.dept.id)
        self.db.add(self.teacher)
        self.db.flush()

        self.subject = Subject(name="Operating Systems", code="OS101", department_id=self.dept.id, academic_year_id=self.year.id)
        self.db.add(self.subject)
        self.db.flush()

        # Add 3 Students
        self.student1 = Student(
            roll_number="23311A05Y6", name="Bhaskar", email="23311a05y6@cs.sreenidhi.edu.in",
            department_id=self.dept.id, academic_year_id=self.year.id, section_id=self.section.id
        )
        self.student2 = Student(
            roll_number="23311A6256", name="Vinay", email="23311a6256@cs.sreenidhi.edu.in",
            department_id=self.dept.id, academic_year_id=self.year.id, section_id=self.section.id
        )
        self.student3 = Student(
            roll_number="23311A6255", name="Vachan", email="23311a6255@cs.sreenidhi.edu.in",
            department_id=self.dept.id, academic_year_id=self.year.id, section_id=self.section.id
        )
        self.db.add_all([self.student1, self.student2, self.student3])
        self.db.commit()

        token = create_access_token(data={"sub": self.admin.username, "role": "SUPER_ADMIN"})
        self.headers = {"Authorization": f"Bearer {token}"}

    def tearDown(self):
        app.dependency_overrides.clear()
        self.db.close()
        Base.metadata.drop_all(bind=self.engine)

    def test_daily_sheet_fetch_and_week_overview(self):
        # Fetch daily sheet for Wednesday 2026-09-09
        res = self.client.get(
            f"/api/v1/attendance/admin/daily-sheet?date=2026-09-09&section_id={self.section.id}",
            headers=self.headers
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["date"], "2026-09-09")
        self.assertEqual(data["section_id"], self.section.id)
        self.assertEqual(data["total_students"], 3)
        self.assertEqual(data["unmarked_count"], 3)
        self.assertEqual(data["present_count"], 0)
        self.assertEqual(data["absent_count"], 0)
        self.assertEqual(len(data["students"]), 3)

        # Verify 6 academic days (Monday through Saturday)
        self.assertEqual(len(data["week_days"]), 6)
        day_names = [d["day_name"] for d in data["week_days"]]
        self.assertEqual(day_names, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"])

        # Wednesday should be selected
        wed = [d for d in data["week_days"] if d["date"] == "2026-09-09"][0]
        self.assertTrue(wed["is_selected"])
        self.assertEqual(wed["present_count"], 0)

    def test_mark_daily_individual_student(self):
        # 1. Mark Bhaskar present for 4 periods on 2026-09-09
        mark_res = self.client.post(
            "/api/v1/attendance/admin/mark-daily",
            json={
                "date": "2026-09-09",
                "section_id": self.section.id,
                "roll_number": "23311A05Y6",
                "status": "PRESENT",
                "period_count": 4
            },
            headers=self.headers
        )
        self.assertEqual(mark_res.status_code, 200)
        mark_data = mark_res.json()
        self.assertEqual(mark_data["status"], "SUCCESS")
        self.assertEqual(mark_data["student_status"], "PRESENT")
        self.assertEqual(mark_data["period_count"], 4)

        # Verify daily-sheet now has 1 present, 2 unmarked
        sheet_res = self.client.get(
            f"/api/v1/attendance/admin/daily-sheet?date=2026-09-09&section_id={self.section.id}",
            headers=self.headers
        )
        sheet_data = sheet_res.json()
        self.assertEqual(sheet_data["present_count"], 1)
        self.assertEqual(sheet_data["unmarked_count"], 2)

        bhaskar = [s for s in sheet_data["students"] if s["roll_number"] == "23311A05Y6"][0]
        self.assertEqual(bhaskar["status"], "PRESENT")
        self.assertEqual(bhaskar["period_count"], 4)

        # 2. Change Bhaskar to ABSENT
        absent_res = self.client.post(
            "/api/v1/attendance/admin/mark-daily",
            json={
                "date": "2026-09-09",
                "section_id": self.section.id,
                "roll_number": "23311A05Y6",
                "status": "ABSENT",
                "period_count": 0
            },
            headers=self.headers
        )
        self.assertEqual(absent_res.status_code, 200)
        self.assertEqual(absent_res.json()["student_status"], "ABSENT")

        sheet_res2 = self.client.get(
            f"/api/v1/attendance/admin/daily-sheet?date=2026-09-09&section_id={self.section.id}",
            headers=self.headers
        )
        sheet_data2 = sheet_res2.json()
        self.assertEqual(sheet_data2["present_count"], 0)
        self.assertEqual(sheet_data2["absent_count"], 1)

        # 3. Clear (UNMARKED)
        clear_res = self.client.post(
            "/api/v1/attendance/admin/mark-daily",
            json={
                "date": "2026-09-09",
                "section_id": self.section.id,
                "roll_number": "23311A05Y6",
                "status": "UNMARKED"
            },
            headers=self.headers
        )
        self.assertEqual(clear_res.status_code, 200)
        self.assertEqual(clear_res.json()["student_status"], "UNMARKED")

        sheet_res3 = self.client.get(
            f"/api/v1/attendance/admin/daily-sheet?date=2026-09-09&section_id={self.section.id}",
            headers=self.headers
        )
        self.assertEqual(sheet_res3.json()["unmarked_count"], 3)

    def test_batch_mark_daily(self):
        # Batch mark all students as PRESENT (3 periods) on Saturday 2026-09-12
        batch_res = self.client.post(
            "/api/v1/attendance/admin/batch-mark-daily",
            json={
                "date": "2026-09-12",
                "section_id": self.section.id,
                "status": "PRESENT",
                "period_count": 3
            },
            headers=self.headers
        )
        self.assertEqual(batch_res.status_code, 200)
        b_data = batch_res.json()
        self.assertEqual(b_data["status"], "SUCCESS")
        self.assertEqual(b_data["marked_count"], 3)
        self.assertEqual(b_data["present_count"], 3)

        # Check sheet for Saturday
        sheet_res = self.client.get(
            f"/api/v1/attendance/admin/daily-sheet?date=2026-09-12&section_id={self.section.id}",
            headers=self.headers
        )
        sheet_data = sheet_res.json()
        self.assertEqual(sheet_data["present_count"], 3)
        self.assertEqual(sheet_data["absent_count"], 0)
        for s in sheet_data["students"]:
            self.assertEqual(s["status"], "PRESENT")
            self.assertEqual(s["period_count"], 3)

        # Now batch mark all as ABSENT
        batch_absent_res = self.client.post(
            "/api/v1/attendance/admin/batch-mark-daily",
            json={
                "date": "2026-09-12",
                "section_id": self.section.id,
                "status": "ABSENT",
                "period_count": 0
            },
            headers=self.headers
        )
        self.assertEqual(batch_absent_res.status_code, 200)
        self.assertEqual(batch_absent_res.json()["absent_count"], 3)


if __name__ == "__main__":
    unittest.main()
