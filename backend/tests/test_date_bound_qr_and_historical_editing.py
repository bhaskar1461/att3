# Test Suite for Date-Bound Student QR Codes and Controlled Historical Attendance Editing
import os
import sys
import unittest
from datetime import datetime, timedelta
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# Ensure backend directory is in sys.path
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
from app.core.security import (
    generate_encrypted_qr_payload_v2, 
    generate_encrypted_qr_payload,
    decrypt_and_validate_qr_payload,
    get_password_hash,
    get_server_ist_date
)

class TestDateBoundQRAndHistoricalEditing(unittest.TestCase):
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

        # Provision Institutional Setup
        self.today = get_server_ist_date()
        self.yesterday = (datetime.strptime(self.today, "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")

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
        stu2 = Student(user_id=u_stu2.id, roll_number="21CS002", name="Bob", department_id=dept.id, academic_year_id=ay.id, section_id=sec_b.id) # Section B!
        self.db.add_all([teacher1, teacher2, stu1, stu2])
        self.db.commit()

        # Allot teacher1 to CSE-A / Data Structures
        assign1 = TeacherAssignment(teacher_id=teacher1.id, subject_id=subj_ds.id, section_id=sec_a.id)
        self.db.add(assign1)
        self.db.commit()

        self.teacher1 = teacher1
        self.teacher2 = teacher2
        self.stu1 = stu1
        self.stu2 = stu2
        self.subj_ds = subj_ds
        self.sec_a = sec_a
        self.sec_b = sec_b

        # Authenticate teacher1
        res_login = self.client.post("/api/v1/auth/login", json={
            "username": "FAC101",
            "password": "pass123",
            "device_public_id": "PWA_FAC1",
            "device_secret": "SECRET_FAC1"
        })
        self.token_fac1 = res_login.json()["access_token"]

        # Authenticate teacher2
        res_login2 = self.client.post("/api/v1/auth/login", json={
            "username": "FAC102",
            "password": "pass123",
            "device_public_id": "PWA_FAC2",
            "device_secret": "SECRET_FAC2"
        })
        self.token_fac2 = res_login2.json()["access_token"]

    def tearDown(self):
        app.dependency_overrides.clear()
        self.db.close()

    def test_1_today_qr_today_session_accept(self):
        """1. Today's QR + Today's session -> ACCEPT"""
        session = AttendanceSession(
            teacher_id=self.teacher1.id,
            subject_id=self.subj_ds.id,
            section_id=self.sec_a.id,
            period="Period 1",
            session_date=self.today,
            status=SessionStatus.OPEN
        )
        self.db.add(session)
        self.db.commit()

        qr_today = generate_encrypted_qr_payload_v2(student_id=self.stu1.id, roll_number="21CS001", attendance_date=self.today)
        res = self.client.post(
            "/api/v1/attendance/scan",
            headers={"Authorization": f"Bearer {self.token_fac1}"},
            json={"session_id": session.id, "qr_payload": qr_today, "period_count": 1}
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "SUCCESS")

    def test_2_yesterday_qr_today_session_reject(self):
        """2. Yesterday's QR + Today's session -> REJECT"""
        session = AttendanceSession(
            teacher_id=self.teacher1.id,
            subject_id=self.subj_ds.id,
            section_id=self.sec_a.id,
            period="Period 1",
            session_date=self.today,
            status=SessionStatus.OPEN
        )
        self.db.add(session)
        self.db.commit()

        qr_yesterday = generate_encrypted_qr_payload_v2(student_id=self.stu1.id, roll_number="21CS001", attendance_date=self.yesterday)
        res = self.client.post(
            "/api/v1/attendance/scan",
            headers={"Authorization": f"Bearer {self.token_fac1}"},
            json={"session_id": session.id, "qr_payload": qr_yesterday, "period_count": 1}
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("does not match Selected Attendance Date", res.json()["detail"])

    def test_3_today_qr_yesterday_session_reject(self):
        """3. Today's QR + Yesterday's session -> REJECT"""
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

        qr_today = generate_encrypted_qr_payload_v2(student_id=self.stu1.id, roll_number="21CS001", attendance_date=self.today)
        res = self.client.post(
            "/api/v1/attendance/scan",
            headers={"Authorization": f"Bearer {self.token_fac1}"},
            json={"session_id": session.id, "qr_payload": qr_today, "period_count": 1}
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("does not match Selected Attendance Date", res.json()["detail"])

    def test_4_historical_qr_matching_historical_session_accept(self):
        """4. Historical QR + Matching historical session -> ACCEPT"""
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

        qr_yesterday = generate_encrypted_qr_payload_v2(student_id=self.stu1.id, roll_number="21CS001", attendance_date=self.yesterday)
        res = self.client.post(
            "/api/v1/attendance/scan",
            headers={"Authorization": f"Bearer {self.token_fac1}"},
            json={"session_id": session.id, "qr_payload": qr_yesterday, "period_count": 1}
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "SUCCESS")

    def test_5_student_from_another_section_reject(self):
        """5. Student from another section -> REJECT"""
        session = AttendanceSession(
            teacher_id=self.teacher1.id,
            subject_id=self.subj_ds.id,
            section_id=self.sec_a.id, # Session for CSE-A
            period="Period 1",
            session_date=self.today,
            status=SessionStatus.OPEN
        )
        self.db.add(session)
        self.db.commit()

        # stu2 belongs to CSE-B!
        qr_stu2 = generate_encrypted_qr_payload_v2(student_id=self.stu2.id, roll_number="21CS002", attendance_date=self.today)
        res = self.client.post(
            "/api/v1/attendance/scan",
            headers={"Authorization": f"Bearer {self.token_fac1}"},
            json={"session_id": session.id, "qr_payload": qr_stu2, "period_count": 1}
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("Not enrolled in this section", res.json()["detail"])

    def test_6_teacher_not_assigned_to_session_reject(self):
        """6. Teacher not assigned to session -> REJECT"""
        session = AttendanceSession(
            teacher_id=self.teacher1.id,
            subject_id=self.subj_ds.id,
            section_id=self.sec_a.id,
            period="Period 1",
            session_date=self.today,
            status=SessionStatus.OPEN
        )
        self.db.add(session)
        self.db.commit()

        qr_today = generate_encrypted_qr_payload_v2(student_id=self.stu1.id, roll_number="21CS001", attendance_date=self.today)
        # teacher2 (fac2) tries to scan for teacher1's session
        res = self.client.post(
            "/api/v1/attendance/scan",
            headers={"Authorization": f"Bearer {self.token_fac2}"},
            json={"session_id": session.id, "qr_payload": qr_today, "period_count": 1}
        )
        self.assertEqual(res.status_code, 403)

    def test_7_invalid_or_tampered_qr_reject(self):
        """7. Invalid/tampered QR -> REJECT"""
        session = AttendanceSession(
            teacher_id=self.teacher1.id,
            subject_id=self.subj_ds.id,
            section_id=self.sec_a.id,
            period="Period 1",
            session_date=self.today,
            status=SessionStatus.OPEN
        )
        self.db.add(session)
        self.db.commit()

        tampered_qr = "V2|16|C31E6|161M|nonce|BADMAC"
        res = self.client.post(
            "/api/v1/attendance/scan",
            headers={"Authorization": f"Bearer {self.token_fac1}"},
            json={"session_id": session.id, "qr_payload": tampered_qr, "period_count": 1}
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("Invalid QR Code", res.json()["detail"])

    def test_8_duplicate_scan_handling(self):
        """8. Duplicate scan -> Return ALREADY_MARKED status"""
        session = AttendanceSession(
            teacher_id=self.teacher1.id,
            subject_id=self.subj_ds.id,
            section_id=self.sec_a.id,
            period="Period 1",
            session_date=self.today,
            status=SessionStatus.OPEN
        )
        self.db.add(session)
        self.db.commit()

        qr_today = generate_encrypted_qr_payload_v2(student_id=self.stu1.id, roll_number="21CS001", attendance_date=self.today)
        
        # First scan -> SUCCESS
        res1 = self.client.post(
            "/api/v1/attendance/scan",
            headers={"Authorization": f"Bearer {self.token_fac1}"},
            json={"session_id": session.id, "qr_payload": qr_today, "period_count": 1}
        )
        self.assertEqual(res1.status_code, 200)
        self.assertEqual(res1.json()["status"], "SUCCESS")

        # Second scan -> ALREADY_MARKED
        res2 = self.client.post(
            "/api/v1/attendance/scan",
            headers={"Authorization": f"Bearer {self.token_fac1}"},
            json={"session_id": session.id, "qr_payload": qr_today, "period_count": 1}
        )
        self.assertEqual(res2.status_code, 200)
        self.assertEqual(res2.json()["status"], "ALREADY_MARKED")

    def test_9_locked_historical_session_edit_reject(self):
        """9. Locked historical session -> EDIT REJECTED"""
        session = AttendanceSession(
            teacher_id=self.teacher1.id,
            subject_id=self.subj_ds.id,
            section_id=self.sec_a.id,
            period="Period 1",
            session_date=self.yesterday,
            status=SessionStatus.LOCKED
        )
        self.db.add(session)
        self.db.commit()

        qr_yesterday = generate_encrypted_qr_payload_v2(student_id=self.stu1.id, roll_number="21CS001", attendance_date=self.yesterday)
        res = self.client.post(
            "/api/v1/attendance/scan",
            headers={"Authorization": f"Bearer {self.token_fac1}"},
            json={"session_id": session.id, "qr_payload": qr_yesterday, "period_count": 1}
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("locked", res.json()["detail"])

    def test_10_unlocked_historical_session_edit_allow(self):
        """10. Unlocked historical session -> EDIT ALLOWED"""
        session = AttendanceSession(
            teacher_id=self.teacher1.id,
            subject_id=self.subj_ds.id,
            section_id=self.sec_a.id,
            period="Period 1",
            session_date=self.yesterday,
            status=SessionStatus.LOCKED
        )
        self.db.add(session)
        self.db.commit()

        # Unlock session via teacher endpoint
        res_unlock = self.client.post(
            f"/api/v1/teacher/sessions/{session.id}/unlock",
            headers={"Authorization": f"Bearer {self.token_fac1}"}
        )
        self.assertEqual(res_unlock.status_code, 200)

        # Now edit attendance via scan -> SUCCESS
        qr_yesterday = generate_encrypted_qr_payload_v2(student_id=self.stu1.id, roll_number="21CS001", attendance_date=self.yesterday)
        res_scan = self.client.post(
            "/api/v1/attendance/scan",
            headers={"Authorization": f"Bearer {self.token_fac1}"},
            json={"session_id": session.id, "qr_payload": qr_yesterday, "period_count": 1}
        )
        self.assertEqual(res_scan.status_code, 200)
        self.assertEqual(res_scan.json()["status"], "SUCCESS")

        # Verify audit log recorded HISTORICAL_EDIT / SESSION_UNLOCKED
        logs = self.db.query(AuditLog).all()
        actions = [l.action for l in logs]
        self.assertIn("SESSION_UNLOCKED", actions)

    def test_11_server_authoritative_date(self):
        """11. Server-authoritative IST date verification"""
        server_date = get_server_ist_date()
        self.assertTrue(len(server_date) == 10) # YYYY-MM-DD
        self.assertIn("-", server_date)

    def test_12_teacher_timetable_allotment_validation(self):
        """12. Teacher starting unassigned session is rejected"""
        # teacher1 tries to start a session for Algorithms (subj_algo), which he is NOT allotted to
        res = self.client.post(
            "/api/v1/teacher/sessions/start",
            headers={"Authorization": f"Bearer {self.token_fac1}"},
            json={
                "subject_id": 999, # Unassigned subject
                "section_id": self.sec_a.id,
                "period": "Period 1",
                "date": self.today
            }
        )
        self.assertEqual(res.status_code, 403)

    def test_13_admin_scan_override(self):
        """13. Super Admin scan override — Admin can mark attendance for any valid QR regardless of date mismatch or locked session"""
        # Create Super Admin user
        u_admin = User(username="SUPERADMIN1", email="admin@sreenidhi.edu.in", password_hash=get_password_hash("pass123"), role=UserRole.SUPER_ADMIN)
        self.db.add(u_admin)
        self.db.commit()

        res_login = self.client.post("/api/v1/auth/login", json={
            "username": "SUPERADMIN1",
            "password": "pass123",
            "device_public_id": "PWA_ADMIN",
            "device_secret": "SECRET_ADMIN"
        })
        token_admin = res_login.json()["access_token"]

        # Create locked session for yesterday
        session = AttendanceSession(
            teacher_id=self.teacher1.id,
            subject_id=self.subj_ds.id,
            section_id=self.sec_a.id,
            period="Period 4",
            session_date=self.yesterday,
            status=SessionStatus.LOCKED
        )
        self.db.add(session)
        self.db.commit()

        # Student generates QR with TODAY's date (mismatched with yesterday's session date)
        qr_today = generate_encrypted_qr_payload_v2(student_id=self.stu1.id, roll_number="21CS001", attendance_date=self.today)

        # Admin scans QR for locked yesterday session -> MUST ACCEPT (200 OK)
        res_admin_scan = self.client.post(
            "/api/v1/attendance/scan",
            headers={"Authorization": f"Bearer {token_admin}"},
            json={"session_id": session.id, "qr_payload": qr_today, "period_count": 1}
        )
        self.assertEqual(res_admin_scan.status_code, 200)
        self.assertEqual(res_admin_scan.json()["status"], "SUCCESS")

if __name__ == "__main__":
    unittest.main()
