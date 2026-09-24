import os
import sys
import unittest
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
    Teacher, Student, TeacherAssignment, AttendanceSession, SessionStatus, AttendanceRecord,
    AttendanceStatus
)
from app.core.security import get_password_hash, get_server_ist_date

class TestHistoricalSessionsVisibility(unittest.TestCase):
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
        self.yesterday = (datetime.strptime(self.today, "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")

        dept = Department(code="CSE", name="Computer Science")
        ay = AcademicYear(name="2025-2026")
        self.db.add_all([dept, ay])
        self.db.commit()

        sec = Section(name="CSE-B", department_id=dept.id, academic_year_id=ay.id)
        subj = Subject(code="CS401", name="Cloud Computing", department_id=dept.id, academic_year_id=ay.id)
        self.db.add_all([sec, subj])
        self.db.commit()

        u_fac = User(username="TEACH01", email="teach01@sreenidhi.edu.in", password_hash=get_password_hash("pass123"), role=UserRole.TEACHER)
        u_stu1 = User(username="21CSB01", email="21csb01@sreenidhi.edu.in", password_hash=get_password_hash("pass123"), role=UserRole.STUDENT)
        u_stu2 = User(username="21CSB02", email="21csb02@sreenidhi.edu.in", password_hash=get_password_hash("pass123"), role=UserRole.STUDENT)
        self.db.add_all([u_fac, u_stu1, u_stu2])
        self.db.commit()

        teacher = Teacher(user_id=u_fac.id, teacher_code="TEACH01", name="Mrs. Sowjanya", department_id=dept.id)
        stu1 = Student(user_id=u_stu1.id, roll_number="21CSB01", name="Student One", department_id=dept.id, academic_year_id=ay.id, section_id=sec.id)
        stu2 = Student(user_id=u_stu2.id, roll_number="21CSB02", name="Student Two", department_id=dept.id, academic_year_id=ay.id, section_id=sec.id)
        self.db.add_all([teacher, stu1, stu2])
        self.db.commit()

        assign = TeacherAssignment(teacher_id=teacher.id, subject_id=subj.id, section_id=sec.id)
        self.db.add(assign)
        self.db.commit()

        self.teacher = teacher
        self.subj = subj
        self.sec = sec
        self.stu1 = stu1
        self.stu2 = stu2

        res_login = self.client.post("/api/v1/auth/login", json={
            "username": "TEACH01",
            "password": "pass123",
            "device_public_id": "DEV_TEACH01",
            "device_secret": "SEC_TEACH01"
        })
        self.token = res_login.json()["access_token"]

    def test_historical_sessions_retrieval_and_filtering(self):
        # 1. Create a LOCKED session on yesterday
        sess1 = AttendanceSession(
            teacher_id=self.teacher.id,
            subject_id=self.subj.id,
            section_id=self.sec.id,
            period="Period 1",
            session_date=self.yesterday,
            status=SessionStatus.LOCKED
        )
        self.db.add(sess1)
        self.db.commit()

        # Add attendance records: stu1 present (manual), stu2 present (scanned)
        rec1 = AttendanceRecord(
            session_id=sess1.id,
            student_id=self.stu1.id,
            roll_number=self.stu1.roll_number,
            session_date=self.yesterday,
            status=AttendanceStatus.PRESENT,
            scan_mode="MANUAL"
        )
        rec2 = AttendanceRecord(
            session_id=sess1.id,
            student_id=self.stu2.id,
            roll_number=self.stu2.roll_number,
            session_date=self.yesterday,
            status=AttendanceStatus.PRESENT,
            scan_mode="QR"
        )
        self.db.add_all([rec1, rec2])
        self.db.commit()

        # 2. Create an OPEN session on today
        sess2 = AttendanceSession(
            teacher_id=self.teacher.id,
            subject_id=self.subj.id,
            section_id=self.sec.id,
            period="Period 2",
            session_date=self.today,
            status=SessionStatus.OPEN
        )
        self.db.add(sess2)
        self.db.commit()

        # 3. Query all historical sessions (no date filter)
        res = self.client.get(
            "/api/v1/teacher/historical-sessions",
            headers={"Authorization": f"Bearer {self.token}"}
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(len(data), 2)
        
        # Verify ordering: today comes first, then yesterday
        self.assertEqual(data[0]["session_id"], sess2.id)
        self.assertEqual(data[0]["status"], "OPEN")
        self.assertEqual(data[0]["session_date"], self.today)

        self.assertEqual(data[1]["session_id"], sess1.id)
        self.assertEqual(data[1]["status"], "LOCKED")
        self.assertEqual(data[1]["session_date"], self.yesterday)
        self.assertEqual(data[1]["present_count"], 2)
        self.assertEqual(data[1]["total_students"], 2)
        self.assertEqual(data[1]["manual_count"], 1)
        self.assertEqual(data[1]["manual_pct"], 50)

        # 4. Query with date filter for today
        res_today = self.client.get(
            f"/api/v1/teacher/historical-sessions?date={self.today}",
            headers={"Authorization": f"Bearer {self.token}"}
        )
        self.assertEqual(res_today.status_code, 200)
        data_today = res_today.json()
        self.assertEqual(len(data_today), 1)
        self.assertEqual(data_today[0]["session_id"], sess2.id)

        # 5. Query with trimmed date filter for yesterday
        res_yesterday = self.client.get(
            f"/api/v1/teacher/historical-sessions?date={self.yesterday}%20",
            headers={"Authorization": f"Bearer {self.token}"}
        )
        self.assertEqual(res_yesterday.status_code, 200)
        data_yesterday = res_yesterday.json()
        self.assertEqual(len(data_yesterday), 1)
        self.assertEqual(data_yesterday[0]["session_id"], sess1.id)
