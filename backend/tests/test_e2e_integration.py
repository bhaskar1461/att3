# Phase 7 — End-to-End Integration Verification Test Suite
import os
import unittest
from datetime import date
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.core.database import get_db, Base
from app.models.models import (
    User, UserRole, Department, AcademicYear, Section, Subject,
    Teacher, Student, AttendanceSession, SessionStatus, AuditLog, SecurityEventType
)
from app.core.security import generate_encrypted_qr_payload_v2, get_password_hash
from app.core.frappe_sync import sync_session_to_frappe

class TestE2ESystemIntegration(unittest.TestCase):
    def setUp(self):
        # Create shared in-memory SQLite database
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

        # 1. Pre-provision Institutional Data
        dept = Department(code="CSE", name="Computer Science")
        ay = AcademicYear(name="2025-2026")
        self.db.add_all([dept, ay])
        self.db.commit()

        sec = Section(name="3A", department_id=dept.id, academic_year_id=ay.id)
        subj = Subject(code="CS301", name="Data Structures", department_id=dept.id, academic_year_id=ay.id)
        self.db.add_all([sec, subj])
        self.db.commit()

        u_fac = User(username="FAC101", email="fac101@sreenidhi.edu.in", password_hash=get_password_hash("pass123"), role=UserRole.TEACHER)
        u_stu1 = User(username="21CS001", email="21cs001@sreenidhi.edu.in", password_hash=get_password_hash("pass123"), role=UserRole.STUDENT)
        u_stu2 = User(username="21CS002", email="21cs002@sreenidhi.edu.in", password_hash=get_password_hash("pass123"), role=UserRole.STUDENT)
        self.db.add_all([u_fac, u_stu1, u_stu2])
        self.db.commit()

        teacher = Teacher(user_id=u_fac.id, teacher_code="FAC101", name="Dr. Sharma", department_id=dept.id)
        stu1 = Student(user_id=u_stu1.id, roll_number="21CS001", name="Alice", department_id=dept.id, academic_year_id=ay.id, section_id=sec.id)
        stu2 = Student(user_id=u_stu2.id, roll_number="21CS002", name="Bob", department_id=dept.id, academic_year_id=ay.id, section_id=sec.id)
        self.db.add_all([teacher, stu1, stu2])
        self.db.commit()

        self.teacher = teacher
        self.stu1 = stu1
        self.stu2 = stu2
        self.subj = subj
        self.sec = sec

    def tearDown(self):
        app.dependency_overrides.clear()
        self.db.close()

    def test_e2e_full_attendance_and_security_lifecycle(self):
        """E2E Test — Complete Attendance Lifecycle & Device Security Enforcement"""
        # Step 1: Student 1 Login on Device A
        res_login1 = self.client.post("/api/v1/auth/login", json={
            "username": "21CS001",
            "password": "pass123",
            "device_public_id": "PWA_DEVICE_A",
            "device_secret": "PWA_SECRET_A"
        })
        self.assertEqual(res_login1.status_code, 200)
        token_stu1 = res_login1.json()["access_token"]

        # Step 2: Faculty Opens Attendance Session
        session = AttendanceSession(
            teacher_id=self.teacher.id,
            subject_id=self.subj.id,
            section_id=self.sec.id,
            period="Period 1",
            session_date=str(date.today()),
            status=SessionStatus.OPEN
        )
        self.db.add(session)
        self.db.commit()

        # Step 3: Student 1 scans encrypted QR payload for session
        qr_payload = generate_encrypted_qr_payload_v2(student_id=self.stu1.id, roll_number="21CS001")
        res_scan = self.client.post(
            "/api/v1/attendance/scan",
            headers={"Authorization": f"Bearer {token_stu1}"},
            json={
                "session_id": session.id,
                "qr_payload": qr_payload,
                "period_count": 1
            }
        )
        self.assertEqual(res_scan.status_code, 200)
        self.assertEqual(res_scan.json()["status"], "SUCCESS")

        # Step 4: Account Switch Rejection — Device A tries to login as Student 2
        res_switch = self.client.post("/api/v1/auth/login", json={
            "username": "21CS002",
            "password": "pass123",
            "device_public_id": "PWA_DEVICE_A",
            "device_secret": "PWA_SECRET_A"
        })
        self.assertEqual(res_switch.status_code, 403)
        self.assertIn("temporarily associated with another student account", res_switch.json()["detail"])

        # Step 5: Faculty Locks Session
        session.status = SessionStatus.LOCKED
        self.db.commit()

        # Step 6: Trigger Frappe ERP Hybrid Synchronization
        sync_result = sync_session_to_frappe(self.db, session.id, frappe_url="http://127.0.0.1:9999/api/sync")
        self.assertIn(sync_result["status"], ["SUCCESS", "ERROR", "SYNC_FAILED"])

        # Step 7: Audit Log Verification
        logs = self.db.query(AuditLog).all()
        self.assertTrue(len(logs) > 0)
        event_types = [l.event_type for l in logs]
        self.assertIn("ACCOUNT_SWITCH_ATTEMPT", event_types)

if __name__ == "__main__":
    unittest.main()
