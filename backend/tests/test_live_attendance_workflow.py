# Phase 5 Test Suite: Live / Today's Attendance Workflow Integration
import os
import sys
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch
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
from app.core.security import get_password_hash, get_server_ist_date, get_server_ist_datetime

class TestLiveAttendanceWorkflow(unittest.TestCase):
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

        # Provision institutional academic hierarchy
        dept = Department(code="CSE", name="Computer Science")
        ay = AcademicYear(name="2025-2026")
        self.db.add_all([dept, ay])
        self.db.commit()

        sec_a = Section(name="CSE-A", department_id=dept.id, academic_year_id=ay.id)
        sec_b = Section(name="CSE-B", department_id=dept.id, academic_year_id=ay.id)
        subj_ds = Subject(code="CS301", name="Data Structures", department_id=dept.id, academic_year_id=ay.id)
        self.db.add_all([sec_a, sec_b, subj_ds])
        self.db.commit()

        # Provision faculty users
        u_fac1 = User(username="FAC101", email="fac101@sreenidhi.edu.in", password_hash=get_password_hash("pass123"), role=UserRole.TEACHER)
        u_fac2 = User(username="FAC102", email="fac102@sreenidhi.edu.in", password_hash=get_password_hash("pass123"), role=UserRole.TEACHER)
        self.db.add_all([u_fac1, u_fac2])
        self.db.commit()

        teacher1 = Teacher(user_id=u_fac1.id, teacher_code="FAC101", name="Dr. Sharma", department_id=dept.id)
        teacher2 = Teacher(user_id=u_fac2.id, teacher_code="FAC102", name="Prof. Rao", department_id=dept.id)
        self.db.add_all([teacher1, teacher2])
        self.db.commit()

        # Provision enrolled students in CSE-A
        stu_objs = []
        for i in range(1, 11):
            roll = f"21CS{i:03d}"
            u_s = User(username=roll, email=f"{roll.lower()}@sreenidhi.edu.in", password_hash=get_password_hash("pass123"), role=UserRole.STUDENT)
            self.db.add(u_s)
            self.db.commit()
            stu = Student(user_id=u_s.id, roll_number=roll, name=f"Student {i}", section_id=sec_a.id, department_id=dept.id, academic_year_id=ay.id)
            stu_objs.append(stu)
        self.db.add_all(stu_objs)
        self.db.commit()

        # Assign Dr. Sharma to Data Structures in CSE-A
        asgn1 = TeacherAssignment(teacher_id=teacher1.id, subject_id=subj_ds.id, section_id=sec_a.id)
        self.db.add(asgn1)
        self.db.commit()

        self.teacher1 = teacher1
        self.teacher2 = teacher2
        self.subj_ds = subj_ds
        self.sec_a = sec_a
        self.sec_b = sec_b

        # Obtain JWT tokens
        res_t1 = self.client.post("/api/v1/auth/login", json={
            "username": "FAC101",
            "password": "pass123",
            "device_public_id": "PWA_FAC1",
            "device_secret": "SECRET_FAC1"
        })
        self.assertEqual(res_t1.status_code, 200)
        self.token_t1 = res_t1.json()["access_token"]
        self.headers_t1 = {"Authorization": f"Bearer {self.token_t1}"}

        res_t2 = self.client.post("/api/v1/auth/login", json={
            "username": "FAC102",
            "password": "pass123",
            "device_public_id": "PWA_FAC2",
            "device_secret": "SECRET_FAC2"
        })
        self.assertEqual(res_t2.status_code, 200)
        self.token_t2 = res_t2.json()["access_token"]
        self.headers_t2 = {"Authorization": f"Bearer {self.token_t2}"}

        # Provision student tokens
        from app.core.security import create_access_token
        self.token_s1 = create_access_token({"sub": "21CS001", "role": UserRole.STUDENT.value})
        self.headers_s1 = {"Authorization": f"Bearer {self.token_s1}"}
        self.token_s2 = create_access_token({"sub": "21CS002", "role": UserRole.STUDENT.value})
        self.headers_s2 = {"Authorization": f"Bearer {self.token_s2}"}

    def tearDown(self):
        self.db.close()
        app.dependency_overrides.clear()

    def test_1_current_class_detection_during_period(self):
        """Test server-authoritative class detection when current IST time is inside Period 2 (10:30)."""
        dt_period2 = datetime(2026, 9, 12, 10, 30, 0)
        with patch("app.api.teacher.get_server_ist_datetime", return_value=dt_period2):
            res = self.client.get("/api/v1/teacher/current-class", headers=self.headers_t1)
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertEqual(data["detected_period"], "Period 2")
            self.assertTrue(data["is_class_active"])
            self.assertFalse(data["is_break"])
            self.assertIsNone(data["break_label"])
            self.assertTrue(data["has_assignment"])
            self.assertEqual(data["assignment"]["subject_name"], "Data Structures")
            self.assertEqual(data["assignment"]["section_name"], "CSE-A")

    def test_2_current_class_detection_during_morning_break(self):
        """Test server-authoritative detection during morning break (11:15), ensuring no false LIVE state."""
        dt_morning_break = datetime(2026, 9, 12, 11, 15, 0)
        with patch("app.api.teacher.get_server_ist_datetime", return_value=dt_morning_break):
            res = self.client.get("/api/v1/teacher/current-class", headers=self.headers_t1)
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertIsNone(data["detected_period"])
            self.assertFalse(data["is_class_active"])
            self.assertTrue(data["is_break"])
            self.assertIn("Morning Short Break", data["break_label"])

    def test_3_current_class_detection_during_lunch_break(self):
        """Test server-authoritative detection during lunch break (13:20), ensuring no false LIVE state."""
        dt_lunch = datetime(2026, 9, 12, 13, 20, 0)
        with patch("app.api.teacher.get_server_ist_datetime", return_value=dt_lunch):
            res = self.client.get("/api/v1/teacher/current-class", headers=self.headers_t1)
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertIsNone(data["detected_period"])
            self.assertFalse(data["is_class_active"])
            self.assertTrue(data["is_break"])
            self.assertIn("Lunch Break", data["break_label"])

    def test_4_current_class_detection_outside_hours(self):
        """Test server-authoritative detection outside college hours (08:00 and 18:00)."""
        dt_before = datetime(2026, 9, 12, 8, 0, 0)
        with patch("app.api.teacher.get_server_ist_datetime", return_value=dt_before):
            res = self.client.get("/api/v1/teacher/current-class", headers=self.headers_t1)
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertIsNone(data["detected_period"])
            self.assertFalse(data["is_class_active"])
            self.assertFalse(data["is_break"])

        dt_after = datetime(2026, 9, 12, 18, 0, 0)
        with patch("app.api.teacher.get_server_ist_datetime", return_value=dt_after):
            res = self.client.get("/api/v1/teacher/current-class", headers=self.headers_t1)
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertIsNone(data["detected_period"])
            self.assertFalse(data["is_class_active"])
            self.assertFalse(data["is_break"])

    def test_5_session_start_idempotency_and_rapid_double_clicks(self):
        """Section 7: Verify rapid double clicks / parallel starts return the same logical session."""
        req_payload = {
            "subject_id": self.subj_ds.id,
            "section_id": self.sec_a.id,
            "period": "Period 2",
            "date": self.today,
            "display_type": "projector"
        }
        res1 = self.client.post("/api/v1/teacher/sessions/start", json=req_payload, headers=self.headers_t1)
        self.assertEqual(res1.status_code, 200)
        session_id_1 = res1.json()["session_id"]

        # Immediate repeat attempt
        res2 = self.client.post("/api/v1/teacher/sessions/start", json=req_payload, headers=self.headers_t1)
        self.assertEqual(res2.status_code, 200)
        session_id_2 = res2.json()["session_id"]

        self.assertEqual(session_id_1, session_id_2)
        self.assertIn("Resumed existing", res2.json()["message"])

        # Verify only 1 row exists in database
        total_sessions = self.db.query(AttendanceSession).filter(
            AttendanceSession.teacher_id == self.teacher1.id,
            AttendanceSession.subject_id == self.subj_ds.id,
            AttendanceSession.session_date == self.today
        ).count()
        self.assertEqual(total_sessions, 1)

    def test_6_current_class_resumes_active_open_session(self):
        """Section 6 & 12: When an OPEN session exists, /teacher/current-class immediately returns it."""
        # Create an OPEN session today
        new_sess = AttendanceSession(
            teacher_id=self.teacher1.id,
            subject_id=self.subj_ds.id,
            section_id=self.sec_a.id,
            period="Period 2",
            session_date=self.today,
            status=SessionStatus.OPEN,
            display_type="projector"
        )
        self.db.add(new_sess)
        self.db.commit()

        # Add 3 present records
        students = self.db.query(Student).filter(Student.section_id == self.sec_a.id).limit(3).all()
        for s in students:
            rec = AttendanceRecord(
                session_id=new_sess.id,
                student_id=s.id,
                roll_number=s.roll_number,
                session_date=self.today,
                status=AttendanceStatus.PRESENT
            )
            self.db.add(rec)
        self.db.commit()

        res = self.client.get("/api/v1/teacher/current-class", headers=self.headers_t1)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["existing_session_id"], new_sess.id)
        self.assertEqual(data["session_status"], "OPEN")
        self.assertEqual(data["total_enrolled"], 10)
        self.assertEqual(data["present_count"], 3)

    def test_7_projector_broadcast_token_open_session(self):
        """Section 8 & 9: Projector broadcast token generates rotating token and live headcount."""
        new_sess = AttendanceSession(
            teacher_id=self.teacher1.id,
            subject_id=self.subj_ds.id,
            section_id=self.sec_a.id,
            period="Period 2",
            session_date=self.today,
            status=SessionStatus.OPEN,
            display_type="projector"
        )
        self.db.add(new_sess)
        self.db.commit()

        res = self.client.get(f"/api/v1/teacher/sessions/{new_sess.id}/broadcast-token", headers=self.headers_t1)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("qr_base64", data)
        self.assertTrue(len(data["qr_base64"]) > 100)
        self.assertIn("seconds_remaining", data)
        self.assertLessEqual(data["seconds_remaining"], 10)
        self.assertEqual(data["total_enrolled"], 10)
        self.assertEqual(data["period_name"], "Period 2")

    def test_8_projector_broadcast_token_rejected_when_session_locked(self):
        """Section 31 & 45: Live projector broadcast is strictly rejected when session is locked."""
        locked_sess = AttendanceSession(
            teacher_id=self.teacher1.id,
            subject_id=self.subj_ds.id,
            section_id=self.sec_a.id,
            period="Period 2",
            session_date=self.today,
            status=SessionStatus.LOCKED,
            display_type="projector"
        )
        self.db.add(locked_sess)
        self.db.commit()

        res = self.client.get(f"/api/v1/teacher/sessions/{locked_sess.id}/broadcast-token", headers=self.headers_t1)
        self.assertEqual(res.status_code, 400)
        self.assertIn("Cannot broadcast a locked session", res.json()["detail"])

    def test_9_session_lock_authorization_defense(self):
        """Section 17 & 46: Teacher B cannot lock Teacher A's session."""
        sess = AttendanceSession(
            teacher_id=self.teacher1.id,
            subject_id=self.subj_ds.id,
            section_id=self.sec_a.id,
            period="Period 2",
            session_date=self.today,
            status=SessionStatus.OPEN,
            display_type="projector"
        )
        self.db.add(sess)
        self.db.commit()

        res = self.client.post(f"/api/v1/teacher/sessions/{sess.id}/lock", headers=self.headers_t2)
        self.assertEqual(res.status_code, 403)
        self.assertIn("Not authorized", res.json()["detail"])

    def test_10_session_locking_workflow_and_token_purging(self):
        """Section 16, 18 & 53: Locking session commits DB status and records audit event."""
        sess = AttendanceSession(
            teacher_id=self.teacher1.id,
            subject_id=self.subj_ds.id,
            section_id=self.sec_a.id,
            period="Period 2",
            session_date=self.today,
            status=SessionStatus.OPEN,
            display_type="projector"
        )
        self.db.add(sess)
        self.db.commit()

        res = self.client.post(f"/api/v1/teacher/sessions/{sess.id}/lock", headers=self.headers_t1)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "SUCCESS")

        # Verify database reflection
        self.db.refresh(sess)
        self.assertEqual(sess.status, SessionStatus.LOCKED)
        self.assertIsNotNone(sess.locked_at)

        # Audit log verification
        audit = self.db.query(AuditLog).filter(
            AuditLog.user_id == self.teacher1.user_id,
            AuditLog.action.in_(["SESSION_LOCKED", "SESSION_LOCKED_WITHOUT_SHEET"])
        ).first()
        self.assertIsNotNone(audit)

    def test_11_student_scan_records_attendance_and_increments_live_headcount(self):
        """Section 12, 14 & 43: Student scan creates attendance record and increments live headcount."""
        sess = AttendanceSession(
            teacher_id=self.teacher1.id,
            subject_id=self.subj_ds.id,
            section_id=self.sec_a.id,
            period="Period 2",
            session_date=self.today,
            status=SessionStatus.OPEN,
            display_type="projector"
        )
        self.db.add(sess)
        self.db.commit()

        # Teacher gets broadcast token
        bcast_res = self.client.get(f"/api/v1/teacher/sessions/{sess.id}/broadcast-token", headers=self.headers_t1)
        self.assertEqual(bcast_res.status_code, 200)
        token_payload = bcast_res.json()["qr_payload"]
        self.assertEqual(bcast_res.json()["total_marked"], 0)

        # Student 1 scans on Student 1's phone
        scan1 = self.client.post("/api/v1/student/scan-session", headers=self.headers_s1, json={
            "session_token": token_payload,
            "is_offline_submission": True,
            "device_uuid": "DEV-STUDENT1-PHONE"
        })
        self.assertEqual(scan1.status_code, 200)
        self.assertEqual(scan1.json()["status"], "SUCCESS")

        # Student 2 scans on Student 2's phone
        scan2 = self.client.post("/api/v1/student/scan-session", headers=self.headers_s2, json={
            "session_token": token_payload,
            "is_offline_submission": True,
            "device_uuid": "DEV-STUDENT2-PHONE"
        })
        self.assertEqual(scan2.status_code, 200)
        self.assertEqual(scan2.json()["status"], "SUCCESS")

        # Re-query projector broadcast endpoint -> live count is 2
        bcast_updated = self.client.get(f"/api/v1/teacher/sessions/{sess.id}/broadcast-token", headers=self.headers_t1)
        self.assertEqual(bcast_updated.status_code, 200)
        self.assertEqual(bcast_updated.json()["total_marked"], 2)

        # Re-query current-class endpoint -> live headcount is 2 / 10
        cur_updated = self.client.get("/api/v1/teacher/current-class", headers=self.headers_t1)
        self.assertEqual(cur_updated.status_code, 200)
        self.assertEqual(cur_updated.json()["present_count"], 2)
        self.assertEqual(cur_updated.json()["total_enrolled"], 10)

    def test_12_student_scan_rejected_when_session_locked(self):
        """Section 26 & 45: Student scan attempt against a locked session is strictly rejected."""
        sess = AttendanceSession(
            teacher_id=self.teacher1.id,
            subject_id=self.subj_ds.id,
            section_id=self.sec_a.id,
            period="Period 2",
            session_date=self.today,
            status=SessionStatus.OPEN,
            display_type="projector"
        )
        self.db.add(sess)
        self.db.commit()

        bcast_res = self.client.get(f"/api/v1/teacher/sessions/{sess.id}/broadcast-token", headers=self.headers_t1)
        token_payload = bcast_res.json()["qr_payload"]

        # Lock session
        lock_res = self.client.post(f"/api/v1/teacher/sessions/{sess.id}/lock", headers=self.headers_t1)
        self.assertEqual(lock_res.status_code, 200)

        # Student scans with previously captured token
        scan_res = self.client.post("/api/v1/student/scan-session", headers=self.headers_s1, json={
            "session_token": token_payload,
            "is_offline_submission": True
        })
        self.assertEqual(scan_res.status_code, 400)
        detail = scan_res.json()["detail"].lower()
        self.assertTrue(any(k in detail for k in ["locked", "expired", "invalid"]))

    def test_13_period_transition_simulation(self):
        """Section 21, 22, 23 & 47: Verify seamless period transitions across the college day."""
        # 10:30 - Period 2
        with patch("app.api.teacher.get_server_ist_datetime", return_value=datetime(2026, 9, 12, 10, 30, 0)):
            res = self.client.get("/api/v1/teacher/current-class", headers=self.headers_t1)
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.json()["detected_period"], "Period 2")
            self.assertTrue(res.json()["is_class_active"])
            self.assertFalse(res.json()["is_break"])

        # 11:15 - Morning Short Break
        with patch("app.api.teacher.get_server_ist_datetime", return_value=datetime(2026, 9, 12, 11, 15, 0)):
            res = self.client.get("/api/v1/teacher/current-class", headers=self.headers_t1)
            self.assertEqual(res.status_code, 200)
            self.assertIsNone(res.json()["detected_period"])
            self.assertFalse(res.json()["is_class_active"])
            self.assertTrue(res.json()["is_break"])
            self.assertIn("Morning Short Break", res.json()["break_label"])

        # 11:30 - Period 3
        with patch("app.api.teacher.get_server_ist_datetime", return_value=datetime(2026, 9, 12, 11, 30, 0)):
            res = self.client.get("/api/v1/teacher/current-class", headers=self.headers_t1)
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.json()["detected_period"], "Period 3")
            self.assertTrue(res.json()["is_class_active"])
            self.assertFalse(res.json()["is_break"])

        # 13:20 - Lunch Break
        with patch("app.api.teacher.get_server_ist_datetime", return_value=datetime(2026, 9, 12, 13, 20, 0)):
            res = self.client.get("/api/v1/teacher/current-class", headers=self.headers_t1)
            self.assertEqual(res.status_code, 200)
            self.assertIsNone(res.json()["detected_period"])
            self.assertFalse(res.json()["is_class_active"])
            self.assertTrue(res.json()["is_break"])
            self.assertIn("Lunch Break", res.json()["break_label"])

        # 17:30 - Outside College Hours
        with patch("app.api.teacher.get_server_ist_datetime", return_value=datetime(2026, 9, 12, 17, 30, 0)):
            res = self.client.get("/api/v1/teacher/current-class", headers=self.headers_t1)
            self.assertEqual(res.status_code, 200)
            self.assertIsNone(res.json()["detected_period"])
            self.assertFalse(res.json()["is_class_active"])
            self.assertFalse(res.json()["is_break"])


    def test_14_concurrent_tab_session_convergence(self):
        """Section 34, 51 & 52: Multiple browser tabs converge on identical session and discover locked state."""
        payload = {
            "subject_id": self.subj_ds.id,
            "section_id": self.sec_a.id,
            "period": "Period 2",
            "date": self.today,
            "display_type": "projector"
        }

        # Tab A starts session
        res_tab_a = self.client.post("/api/v1/teacher/sessions/start", json=payload, headers=self.headers_t1)
        self.assertEqual(res_tab_a.status_code, 200)
        session_id_a = res_tab_a.json()["session_id"]

        # Tab B opens and starts/continues
        res_tab_b = self.client.post("/api/v1/teacher/sessions/start", json=payload, headers=self.headers_t1)
        self.assertEqual(res_tab_b.status_code, 200)
        session_id_b = res_tab_b.json()["session_id"]

        self.assertEqual(session_id_a, session_id_b)

        # Tab A locks the session
        lock_res = self.client.post(f"/api/v1/teacher/sessions/{session_id_a}/lock", headers=self.headers_t1)
        self.assertEqual(lock_res.status_code, 200)

        # Tab B attempts to fetch broadcast token -> rejected with 400
        bcast_b = self.client.get(f"/api/v1/teacher/sessions/{session_id_b}/broadcast-token", headers=self.headers_t1)
        self.assertEqual(bcast_b.status_code, 400)
        self.assertIn("locked", bcast_b.json()["detail"].lower())

        # Tab B refreshes current-class -> reflects LOCKED state
        cur_b = self.client.get("/api/v1/teacher/current-class", headers=self.headers_t1)
        self.assertEqual(cur_b.status_code, 200)
        self.assertEqual(cur_b.json()["session_status"], "LOCKED")
