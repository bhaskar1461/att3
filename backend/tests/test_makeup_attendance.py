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
    AuditLog
)
from app.core.security import (
    generate_encrypted_qr_payload_v2,
    get_password_hash,
    get_server_ist_date
)

class TestMakeupAttendance(unittest.TestCase):
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
        self.three_days_ago = (datetime.strptime(self.today, "%Y-%m-%d") - timedelta(days=3)).strftime("%Y-%m-%d")
        self.tomorrow = (datetime.strptime(self.today, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d")

        dept = Department(code="CSE", name="Computer Science")
        ay = AcademicYear(name="2025-2026")
        self.db.add_all([dept, ay])
        self.db.commit()

        sec = Section(name="CSE-A", department_id=dept.id, academic_year_id=ay.id)
        subj = Subject(code="CS301", name="Data Structures", department_id=dept.id, academic_year_id=ay.id)
        self.db.add_all([sec, subj])
        self.db.commit()

        u_fac = User(username="FAC001", email="fac001@sreenidhi.edu.in", password_hash=get_password_hash("pass123"), role=UserRole.TEACHER)
        u_stu = User(username="21CS001", email="21cs001@sreenidhi.edu.in", password_hash=get_password_hash("pass123"), role=UserRole.STUDENT)
        u_other = User(username="FAC999", email="fac999@sreenidhi.edu.in", password_hash=get_password_hash("pass123"), role=UserRole.TEACHER)
        self.db.add_all([u_fac, u_stu, u_other])
        self.db.commit()

        teacher = Teacher(user_id=u_fac.id, teacher_code="FAC001", name="Dr. Sharma", department_id=dept.id)
        other_teacher = Teacher(user_id=u_other.id, teacher_code="FAC999", name="Prof. Other", department_id=dept.id)
        student = Student(user_id=u_stu.id, roll_number="21CS001", name="Alice", department_id=dept.id, academic_year_id=ay.id, section_id=sec.id)
        self.db.add_all([teacher, other_teacher, student])
        self.db.commit()

        assign = TeacherAssignment(teacher_id=teacher.id, subject_id=subj.id, section_id=sec.id)
        self.db.add(assign)
        self.db.commit()

        self.teacher = teacher
        self.other_teacher = other_teacher
        self.student = student
        self.subj = subj
        self.sec = sec

        res_login = self.client.post("/api/v1/auth/login", json={
            "username": "FAC001",
            "password": "pass123",
            "device_public_id": "DEV_FAC001",
            "device_secret": "SEC_FAC001"
        })
        self.token_teacher = res_login.json()["access_token"]

        res_login_stu = self.client.post("/api/v1/auth/login", json={
            "username": "21CS001",
            "password": "pass123",
            "device_public_id": "DEV_STU001",
            "device_secret": "SEC_STU001"
        })
        self.token_student = res_login_stu.json()["access_token"]

        res_login_other = self.client.post("/api/v1/auth/login", json={
            "username": "FAC999",
            "password": "pass123",
            "device_public_id": "DEV_OTHER",
            "device_secret": "SEC_OTHER"
        })
        self.token_other = res_login_other.json()["access_token"]

    def tearDown(self):
        app.dependency_overrides.clear()
        self.db.close()

    def test_1_student_selects_yesterday_qr_and_matches_yesterday_session(self):
        """Student selects yesterday's date to generate QR code -> Scanned for yesterday's session -> ACCEPTED"""
        # 1. Fetch yesterday's QR from student endpoint
        res_qr = self.client.get(
            f"/api/v1/student/qr-code?date={self.yesterday}",
            headers={"Authorization": f"Bearer {self.token_student}"}
        )
        self.assertEqual(res_qr.status_code, 200)
        data = res_qr.json()
        self.assertEqual(data["attendance_date"], self.yesterday)
        self.assertTrue(data["is_makeup"])

        # 2. Start yesterday's session
        res_session = self.client.post(
            "/api/v1/teacher/sessions/start",
            headers={"Authorization": f"Bearer {self.token_teacher}"},
            json={
                "subject_id": self.subj.id,
                "section_id": self.sec.id,
                "period": "Period 2",
                "date": self.yesterday
            }
        )
        self.assertEqual(res_session.status_code, 200)
        session_id = res_session.json()["session_id"]

        # 3. Generate payload with yesterday's date and scan
        qr_yesterday = generate_encrypted_qr_payload_v2(student_id=self.student.id, roll_number="21CS001", attendance_date=self.yesterday)
        res_scan = self.client.post(
            "/api/v1/attendance/scan",
            headers={"Authorization": f"Bearer {self.token_teacher}"},
            json={"session_id": session_id, "qr_payload": qr_yesterday, "period_count": 2}
        )
        self.assertEqual(res_scan.status_code, 200)
        self.assertEqual(res_scan.json()["status"], "SUCCESS")

        # Verify recorded session_date in DB
        record = self.db.query(AttendanceRecord).filter(AttendanceRecord.session_id == session_id).first()
        self.assertIsNotNone(record)
        self.assertEqual(record.session_date, self.yesterday)
        self.assertEqual(record.period_count, 2)

    def test_2_today_qr_for_yesterday_session_without_makeup_flag_rejected(self):
        """Today's live QR scanned for yesterday's session without allow_makeup flag -> REJECTED"""
        session = AttendanceSession(
            teacher_id=self.teacher.id,
            subject_id=self.subj.id,
            section_id=self.sec.id,
            period="Period 1",
            session_date=self.yesterday,
            status=SessionStatus.OPEN
        )
        self.db.add(session)
        self.db.commit()

        qr_today = generate_encrypted_qr_payload_v2(student_id=self.student.id, roll_number="21CS001", attendance_date=self.today)
        res = self.client.post(
            "/api/v1/attendance/scan",
            headers={"Authorization": f"Bearer {self.token_teacher}"},
            json={"session_id": session.id, "qr_payload": qr_today, "allow_makeup": False}
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("does not match Selected Attendance Date", res.json()["detail"])

    def test_3_today_live_qr_with_allow_makeup_flag_accepted(self):
        """Today's live QR scanned for yesterday's session with allow_makeup=True by assigned teacher -> ACCEPTED"""
        session = AttendanceSession(
            teacher_id=self.teacher.id,
            subject_id=self.subj.id,
            section_id=self.sec.id,
            period="Period 3",
            session_date=self.yesterday,
            status=SessionStatus.OPEN
        )
        self.db.add(session)
        self.db.commit()

        qr_today = generate_encrypted_qr_payload_v2(student_id=self.student.id, roll_number="21CS001", attendance_date=self.today)
        res = self.client.post(
            "/api/v1/attendance/scan",
            headers={"Authorization": f"Bearer {self.token_teacher}"},
            json={"session_id": session.id, "qr_payload": qr_today, "allow_makeup": True, "period_count": 4}
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "SUCCESS")

        # Verify record has QR_MAKEUP scan_mode
        record = self.db.query(AttendanceRecord).filter(AttendanceRecord.session_id == session.id).first()
        self.assertIsNotNone(record)
        self.assertEqual(record.scan_mode, "QR_MAKEUP")
        self.assertEqual(record.session_date, self.yesterday)

        # Verify audit log
        logs = self.db.query(AuditLog).all()
        actions = [l.action for l in logs]
        self.assertIn("MAKEUP_ATTENDANCE_MARKED", actions)

    def test_4_stale_qr_with_allow_makeup_rejected(self):
        """Stale QR (3 days old) presented for yesterday's session with allow_makeup=True -> REJECTED (only today's live QR accepted)"""
        session = AttendanceSession(
            teacher_id=self.teacher.id,
            subject_id=self.subj.id,
            section_id=self.sec.id,
            period="Period 4",
            session_date=self.yesterday,
            status=SessionStatus.OPEN
        )
        self.db.add(session)
        self.db.commit()

        qr_stale = generate_encrypted_qr_payload_v2(student_id=self.student.id, roll_number="21CS001", attendance_date=self.three_days_ago)
        res = self.client.post(
            "/api/v1/attendance/scan",
            headers={"Authorization": f"Bearer {self.token_teacher}"},
            json={"session_id": session.id, "qr_payload": qr_stale, "allow_makeup": True}
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("does not match Selected Attendance Date", res.json()["detail"])

    def test_5_unassigned_teacher_cannot_makeup_scan(self):
        """Unassigned teacher cannot use make-up scan on another teacher's session"""
        session = AttendanceSession(
            teacher_id=self.teacher.id,
            subject_id=self.subj.id,
            section_id=self.sec.id,
            period="Period 1",
            session_date=self.yesterday,
            status=SessionStatus.OPEN
        )
        self.db.add(session)
        self.db.commit()

        qr_today = generate_encrypted_qr_payload_v2(student_id=self.student.id, roll_number="21CS001", attendance_date=self.today)
        res = self.client.post(
            "/api/v1/attendance/scan",
            headers={"Authorization": f"Bearer {self.token_other}"},
            json={"session_id": session.id, "qr_payload": qr_today, "allow_makeup": True}
        )
        self.assertEqual(res.status_code, 403)

    def test_6_student_cannot_generate_future_date_qr(self):
        """Student cannot generate QR for tomorrow or future dates"""
        res = self.client.get(
            f"/api/v1/student/qr-code?date={self.tomorrow}",
            headers={"Authorization": f"Bearer {self.token_student}"}
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("future", res.json()["detail"].lower())

if __name__ == "__main__":
    unittest.main()
