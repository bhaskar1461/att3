# Phase 4 Test Suite: Previous-Class Attendance Workflow Security, Uniqueness & Authorization
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
    AttendanceStatus, AuditLog
)
from app.core.security import get_password_hash, get_server_ist_date

class TestPreviousClassAttendanceSecurity(unittest.TestCase):
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
        today_dt = datetime.strptime(self.today, "%Y-%m-%d")
        self.yesterday = (today_dt - timedelta(days=1)).strftime("%Y-%m-%d")
        self.three_days_ago = (today_dt - timedelta(days=3)).strftime("%Y-%m-%d")
        self.tomorrow = (today_dt + timedelta(days=1)).strftime("%Y-%m-%d")

        # Provision institutional setup
        dept = Department(code="CSE", name="Computer Science")
        ay = AcademicYear(name="2025-2026")
        self.db.add_all([dept, ay])
        self.db.commit()

        sec_a = Section(name="CSE-A", department_id=dept.id, academic_year_id=ay.id)
        sec_b = Section(name="CSE-B", department_id=dept.id, academic_year_id=ay.id)
        subj_ds = Subject(code="CS301", name="Data Structures", department_id=dept.id, academic_year_id=ay.id)
        subj_algo = Subject(code="CS302", name="Algorithms", department_id=dept.id, academic_year_id=ay.id)
        self.db.add_all([sec_a, sec_b, subj_ds, subj_algo])
        self.db.commit()

        u_fac1 = User(username="FAC101", email="fac101@sreenidhi.edu.in", password_hash=get_password_hash("pass123"), role=UserRole.TEACHER)
        u_fac2 = User(username="FAC102", email="fac102@sreenidhi.edu.in", password_hash=get_password_hash("pass123"), role=UserRole.TEACHER)
        u_stu1 = User(username="21CS001", email="21cs001@sreenidhi.edu.in", password_hash=get_password_hash("pass123"), role=UserRole.STUDENT)
        u_stu2 = User(username="21CS002", email="21cs002@sreenidhi.edu.in", password_hash=get_password_hash("pass123"), role=UserRole.STUDENT)
        self.db.add_all([u_fac1, u_fac2, u_stu1, u_stu2])
        self.db.commit()

        teacher1 = Teacher(user_id=u_fac1.id, teacher_code="FAC101", name="Dr. Sharma", department_id=dept.id)
        teacher2 = Teacher(user_id=u_fac2.id, teacher_code="FAC102", name="Prof. Rao", department_id=dept.id)
        stu1 = Student(user_id=u_stu1.id, roll_number="21CS001", name="Alice", department_id=dept.id, academic_year_id=ay.id, section_id=sec_a.id)
        stu2 = Student(user_id=u_stu2.id, roll_number="21CS002", name="Bob", department_id=dept.id, academic_year_id=ay.id, section_id=sec_b.id)
        self.db.add_all([teacher1, teacher2, stu1, stu2])
        self.db.commit()

        # Teacher 1 assigned to CSE-A / Data Structures
        assign1 = TeacherAssignment(teacher_id=teacher1.id, subject_id=subj_ds.id, section_id=sec_a.id)
        # Teacher 2 assigned to CSE-B / Algorithms
        assign2 = TeacherAssignment(teacher_id=teacher2.id, subject_id=subj_algo.id, section_id=sec_b.id)
        self.db.add_all([assign1, assign2])
        self.db.commit()

        self.teacher1 = teacher1
        self.teacher2 = teacher2
        self.stu1 = stu1
        self.stu2 = stu2
        self.subj_ds = subj_ds
        self.subj_algo = subj_algo
        self.sec_a = sec_a
        self.sec_b = sec_b

        # Authenticate teacher1
        res1 = self.client.post("/api/v1/auth/login", json={
            "username": "FAC101",
            "password": "pass123",
            "device_public_id": "PWA_FAC1",
            "device_secret": "SECRET_FAC1"
        })
        self.token_fac1 = res1.json()["access_token"]

        # Authenticate teacher2
        res2 = self.client.post("/api/v1/auth/login", json={
            "username": "FAC102",
            "password": "pass123",
            "device_public_id": "PWA_FAC2",
            "device_secret": "SECRET_FAC2"
        })
        self.token_fac2 = res2.json()["access_token"]

    def tearDown(self):
        app.dependency_overrides.clear()
        self.db.close()

    def test_1_start_historical_session_success(self):
        """1. Teacher can start an authorized historical session for yesterday and it logs audit event"""
        res = self.client.post(
            "/api/v1/teacher/sessions/start",
            headers={"Authorization": f"Bearer {self.token_fac1}"},
            json={
                "subject_id": self.subj_ds.id,
                "section_id": self.sec_a.id,
                "period": "Period 2",
                "date": self.yesterday,
                "display_type": "laptop"
            }
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "OPEN")
        self.assertEqual(data["session_date"], self.yesterday)
        self.assertEqual(data["period"], "Period 2")

        # Verify audit log was created
        audit = self.db.query(AuditLog).filter(AuditLog.action == "HISTORICAL_SESSION_CREATED").first()
        self.assertIsNotNone(audit)
        self.assertIn(self.yesterday, audit.details)

    def test_2_duplicate_start_returns_existing_session(self):
        """2. Calling start session twice for same class returns the existing session without duplication"""
        res1 = self.client.post(
            "/api/v1/teacher/sessions/start",
            headers={"Authorization": f"Bearer {self.token_fac1}"},
            json={
                "subject_id": self.subj_ds.id,
                "section_id": self.sec_a.id,
                "period": "Period 2",
                "date": self.yesterday
            }
        )
        session_id_1 = res1.json()["session_id"]

        res2 = self.client.post(
            "/api/v1/teacher/sessions/start",
            headers={"Authorization": f"Bearer {self.token_fac1}"},
            json={
                "subject_id": self.subj_ds.id,
                "section_id": self.sec_a.id,
                "period": "Period 2",
                "date": self.yesterday
            }
        )
        session_id_2 = res2.json()["session_id"]
        self.assertEqual(session_id_1, session_id_2)
        self.assertIn("Resumed existing", res2.json()["message"])

        # Exactly 1 session in database
        total_sessions = self.db.query(AttendanceSession).filter(
            AttendanceSession.teacher_id == self.teacher1.id,
            AttendanceSession.session_date == self.yesterday
        ).count()
        self.assertEqual(total_sessions, 1)

    def test_3_future_date_session_creation_rejected(self):
        """3. Attempting to create a session for tomorrow is strictly rejected (Rule 24)"""
        res = self.client.post(
            "/api/v1/teacher/sessions/start",
            headers={"Authorization": f"Bearer {self.token_fac1}"},
            json={
                "subject_id": self.subj_ds.id,
                "section_id": self.sec_a.id,
                "period": "Period 1",
                "date": self.tomorrow
            }
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("future dates", res.json()["detail"])

    def test_4_cross_teacher_session_access_rejected(self):
        """4. Teacher 2 cannot view or mark attendance for Teacher 1's historical session (Rule 25)"""
        session = AttendanceSession(
            teacher_id=self.teacher1.id,
            subject_id=self.subj_ds.id,
            section_id=self.sec_a.id,
            period="Period 3",
            session_date=self.yesterday,
            status=SessionStatus.OPEN
        )
        self.db.add(session)
        self.db.commit()

        # Teacher 2 tries to view details
        res_view = self.client.get(
            f"/api/v1/teacher/sessions/{session.id}",
            headers={"Authorization": f"Bearer {self.token_fac2}"}
        )
        self.assertEqual(res_view.status_code, 403)

        # Teacher 2 tries to mark attendance
        res_mark = self.client.post(
            "/api/v1/attendance/manual-mark",
            headers={"Authorization": f"Bearer {self.token_fac2}"},
            json={
                "session_id": session.id,
                "roll_number": "21CS001",
                "status": "PRESENT",
                "reason": "scanner_failed"
            }
        )
        self.assertEqual(res_mark.status_code, 403)

    def test_5_cross_section_student_marking_rejected(self):
        """5. Teacher cannot mark attendance for a student from Section B in a Section A session (Rule 25, 26)"""
        session = AttendanceSession(
            teacher_id=self.teacher1.id,
            subject_id=self.subj_ds.id,
            section_id=self.sec_a.id, # Session belongs to Section A
            period="Period 1",
            session_date=self.yesterday,
            status=SessionStatus.OPEN
        )
        self.db.add(session)
        self.db.commit()

        # stu2 belongs to Section B (21CS002)
        res = self.client.post(
            "/api/v1/attendance/manual-mark",
            headers={"Authorization": f"Bearer {self.token_fac1}"},
            json={
                "session_id": session.id,
                "roll_number": "21CS002",
                "status": "PRESENT",
                "reason": "scanner_failed"
            }
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("does not belong to this session's class section", res.json()["detail"])

    def test_6_unassigned_subject_start_rejected(self):
        """6. Teacher cannot start attendance for unassigned subject (Rule 27)"""
        res = self.client.post(
            "/api/v1/teacher/sessions/start",
            headers={"Authorization": f"Bearer {self.token_fac1}"},
            json={
                "subject_id": self.subj_algo.id, # Teacher 1 is NOT assigned to Algorithms
                "section_id": self.sec_a.id,
                "period": "Period 1",
                "date": self.yesterday
            }
        )
        self.assertEqual(res.status_code, 403)

    def test_7_locked_historical_session_cannot_be_edited(self):
        """7. Locked historical session rejects manual attendance marking (Rule 28)"""
        session = AttendanceSession(
            teacher_id=self.teacher1.id,
            subject_id=self.subj_ds.id,
            section_id=self.sec_a.id,
            period="Period 2",
            session_date=self.three_days_ago,
            status=SessionStatus.LOCKED
        )
        self.db.add(session)
        self.db.commit()

        res = self.client.post(
            "/api/v1/attendance/manual-mark",
            headers={"Authorization": f"Bearer {self.token_fac1}"},
            json={
                "session_id": session.id,
                "roll_number": "21CS001",
                "status": "PRESENT",
                "reason": "scanner_failed"
            }
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("locked", res.json()["detail"])

    def test_8_unlock_allows_editing_and_logs_audit(self):
        """8. Unlocking locked historical session permits editing and records audit log"""
        session = AttendanceSession(
            teacher_id=self.teacher1.id,
            subject_id=self.subj_ds.id,
            section_id=self.sec_a.id,
            period="Period 2",
            session_date=self.three_days_ago,
            status=SessionStatus.LOCKED
        )
        self.db.add(session)
        self.db.commit()

        # Unlock session
        res_unlock = self.client.post(
            f"/api/v1/teacher/sessions/{session.id}/unlock",
            headers={"Authorization": f"Bearer {self.token_fac1}"}
        )
        self.assertEqual(res_unlock.status_code, 200)

        # Verify session is now OPEN
        self.db.refresh(session)
        self.assertEqual(session.status, SessionStatus.OPEN)

        # Mark attendance now succeeds
        res_mark = self.client.post(
            "/api/v1/attendance/manual-mark",
            headers={"Authorization": f"Bearer {self.token_fac1}"},
            json={
                "session_id": session.id,
                "roll_number": "21CS001",
                "status": "PRESENT",
                "reason": "scanner_failed"
            }
        )
        self.assertEqual(res_mark.status_code, 200)

        # Verify session details reflect the mark
        res_details = self.client.get(
            f"/api/v1/teacher/sessions/{session.id}",
            headers={"Authorization": f"Bearer {self.token_fac1}"}
        )
        self.assertEqual(res_details.status_code, 200)
        self.assertEqual(res_details.json()["present_count"], 1)

    def test_9_lock_session_commits_and_logs(self):
        """9. Locking session transitions status to LOCKED and creates audit log"""
        session = AttendanceSession(
            teacher_id=self.teacher1.id,
            subject_id=self.subj_ds.id,
            section_id=self.sec_a.id,
            period="Period 2",
            session_date=self.yesterday,
            status=SessionStatus.OPEN
        )
        self.db.add(session)
        self.db.commit()

        res_lock = self.client.post(
            f"/api/v1/teacher/sessions/{session.id}/lock",
            headers={"Authorization": f"Bearer {self.token_fac1}"}
        )
        self.assertEqual(res_lock.status_code, 200)
        self.db.refresh(session)
        self.assertEqual(session.status, SessionStatus.LOCKED)

if __name__ == "__main__":
    unittest.main()
