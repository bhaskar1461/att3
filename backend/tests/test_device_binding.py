import os
import unittest
from datetime import datetime, timedelta

from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from sqlalchemy.orm import sessionmaker
from starlette.testclient import TestClient
from fastapi import HTTPException

from app.core.database import Base, get_db
from app.models.models import (
    User, UserRole, Student, Department, AcademicYear, Section,
    DeviceRegistration, DeviceAccountBinding, BindingStatus, AuditLog
)
from app.core.security import get_password_hash
from app.core.device_security import (
    register_or_get_device,
    enforce_device_binding,
    revoke_device_by_admin
)
from app.main import app

class TestDeviceBindingSecurity(unittest.TestCase):

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

        # Create prerequisite master data
        dept = Department(code="CSE", name="Computer Science")
        year = AcademicYear(name="3rd Year")
        self.db.add_all([dept, year])
        self.db.commit()

        sec = Section(name="CSE-A", department_id=dept.id, academic_year_id=year.id)
        self.db.add(sec)
        self.db.commit()

        # Create Student 1 (21CS001)
        u1 = User(username="21CS001", password_hash=get_password_hash("pass123"), role=UserRole.STUDENT)
        self.db.add(u1)
        self.db.commit()
        s1 = Student(user_id=u1.id, roll_number="21CS001", name="Student One", department_id=dept.id, academic_year_id=year.id, section_id=sec.id)
        self.db.add(s1)

        # Create Student 2 (21CS002)
        u2 = User(username="21CS002", password_hash=get_password_hash("pass123"), role=UserRole.STUDENT)
        self.db.add(u2)
        self.db.commit()
        s2 = Student(user_id=u2.id, roll_number="21CS002", name="Student Two", department_id=dept.id, academic_year_id=year.id, section_id=sec.id)
        self.db.add(s2)

        # Create Admin
        u_admin = User(username="admin", password_hash=get_password_hash("admin123"), role=UserRole.SUPER_ADMIN)
        self.db.add(u_admin)
        self.db.commit()

    def tearDown(self):
        self.db.close()
        Base.metadata.drop_all(bind=self.engine)

    def test_01_normal_login(self):
        """Test 1 — Normal Login (Device 01 -> 21CS001) -> SUCCESS"""
        device = register_or_get_device(self.db, "DEVICE_TEST_01", "SECRET_01")
        self.assertIsNotNone(device)
        self.assertEqual(device.device_public_id, "DEVICE_TEST_01")

        binding = enforce_device_binding(self.db, device, "21CS001")
        self.assertEqual(binding.roll_number, "21CS001")
        self.assertEqual(binding.status, BindingStatus.ACTIVE)
        self.assertEqual(binding.attempt_count, 1)

    def test_02_same_account_reauth(self):
        """Test 2 — Same Account Again (Device 02 -> 21CS001) -> SUCCESS up to 5 attempts"""
        device = register_or_get_device(self.db, "DEVICE_TEST_02", "SECRET_02")
        
        for i in range(1, 6):
            binding = enforce_device_binding(self.db, device, "21CS001")
            self.assertEqual(binding.attempt_count, i)

    def test_03_different_account_rejection(self):
        """Test 3 — Different Account (Device 03 -> 21CS001, then Device 03 -> 21CS002) -> REJECTED 403"""
        device = register_or_get_device(self.db, "DEVICE_TEST_03", "SECRET_03")
        enforce_device_binding(self.db, device, "21CS001")

        with self.assertRaises(HTTPException) as cm:
            enforce_device_binding(self.db, device, "21CS002")

        self.assertEqual(cm.exception.status_code, 403)
        self.assertIn("temporarily associated with another student account", cm.exception.detail)

    def test_04_logout_bypass_prevention(self):
        """Test 4 — Logout Bypass (Device 04 -> 21CS001, Logout, Device 04 -> 21CS002) -> REJECTED 403"""
        # Login 21CS001
        res = self.client.post("/api/v1/auth/login", json={
            "username": "21CS001",
            "password": "pass123",
            "device_public_id": "DEVICE_TEST_04",
            "device_secret": "SECRET_04"
        })
        self.assertEqual(res.status_code, 200)
        token1 = res.json()["access_token"]

        # Logout
        res_logout = self.client.post("/api/v1/auth/logout", headers={"Authorization": f"Bearer {token1}"})
        self.assertEqual(res_logout.status_code, 200)

        # Attempt login as 21CS002 on same device
        res_switch = self.client.post("/api/v1/auth/login", json={
            "username": "21CS002",
            "password": "pass123",
            "device_public_id": "DEVICE_TEST_04",
            "device_secret": "SECRET_04"
        })
        self.assertEqual(res_switch.status_code, 403)
        self.assertIn("temporarily associated with another student account", res_switch.json()["detail"])

    def test_05_six_attempts_limit(self):
        """Test 5 — Six Attempts (Device 05 -> 21CS001 x 6) -> Attempt 6 REJECTED 429"""
        device = register_or_get_device(self.db, "DEVICE_TEST_05", "SECRET_05")

        for _ in range(5):
            enforce_device_binding(self.db, device, "21CS001")

        with self.assertRaises(HTTPException) as cm:
            enforce_device_binding(self.db, device, "21CS001")

        self.assertEqual(cm.exception.status_code, 429)
        self.assertIn("Maximum authentication attempts", cm.exception.detail)

    def test_06_binding_expiry(self):
        """Test 6 — Binding Expiry (10:00 Device 06 -> 21CS001, 10:30+ Device 06 -> 21CS002) -> SUCCESS after 30 min"""
        device = register_or_get_device(self.db, "DEVICE_TEST_06", "SECRET_06")
        
        # Manually create an expired binding (created 31 minutes ago)
        old_time = datetime.utcnow() - timedelta(minutes=31)
        binding = DeviceAccountBinding(
            device_id=device.id,
            roll_number="21CS001",
            bound_at=old_time,
            expires_at=old_time + timedelta(minutes=30),
            attempt_count=1,
            status=BindingStatus.ACTIVE
        )
        self.db.add(binding)
        self.db.commit()

        # Attempt login with 21CS002 after expiration
        new_binding = enforce_device_binding(self.db, device, "21CS002")
        self.assertEqual(new_binding.roll_number, "21CS002")
        self.assertEqual(new_binding.status, BindingStatus.ACTIVE)

    def test_07_device_revocation(self):
        """Test 7 — Admin Revocation of Device"""
        device = register_or_get_device(self.db, "DEVICE_TEST_07", "SECRET_07")
        enforce_device_binding(self.db, device, "21CS001")

        revoke_device_by_admin(self.db, "DEVICE_TEST_07", admin_user_id=1)

        with self.assertRaises(HTTPException) as cm:
            register_or_get_device(self.db, "DEVICE_TEST_07", "SECRET_07")

        self.assertEqual(cm.exception.status_code, 403)
        self.assertIn("revoked", cm.exception.detail)

    def test_08_storage_clearing_protection(self):
        """Test 8 — Storage Clearing Protection (New request without tokens from same device -> REJECTED)"""
        # First login
        self.client.post("/api/v1/auth/login", json={
            "username": "21CS001",
            "password": "pass123",
            "device_public_id": "DEVICE_PERSISTENT",
            "device_secret": "SECRET_PERSISTENT"
        })

        # Client clears localStorage/cookies, tries logging in as 21CS002 with same device credential
        res_cleared = self.client.post("/api/v1/auth/login", json={
            "username": "21CS002",
            "password": "pass123",
            "device_public_id": "DEVICE_PERSISTENT",
            "device_secret": "SECRET_PERSISTENT"
        })
        self.assertEqual(res_cleared.status_code, 403)

    def test_09_current_device_endpoint(self):
        """Test 9 — Current Device API Endpoint"""
        self.client.post("/api/v1/auth/login", json={
            "username": "21CS001",
            "password": "pass123",
            "device_public_id": "DEVICE_INFO",
            "device_secret": "SECRET_INFO"
        })

        res_login = self.client.post("/api/v1/auth/login", json={
            "username": "21CS001",
            "password": "pass123",
            "device_public_id": "DEVICE_INFO",
            "device_secret": "SECRET_INFO"
        })
        token = res_login.json()["access_token"]

        res = self.client.get(
            "/api/v1/devices/current",
            headers={
                "Authorization": f"Bearer {token}",
                "X-Device-Public-Id": "DEVICE_INFO"
            }
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["has_active_binding"])
        self.assertEqual(data["active_binding"]["roll_number"], "21CS001")

    def test_10_qr_mismatch_rejection(self):
        """Test 10 — QR Mismatch (Authenticated user 21CS001 scans 21CS002 QR) -> REJECTED"""
        # Create an attendance session first
        from app.models.models import AttendanceSession, SessionStatus, Subject
        subj = Subject(code="CS301", name="Data Structures", department_id=1, academic_year_id=1)
        self.db.add(subj)
        self.db.commit()

        from app.core.security import get_server_ist_date
        today_date = get_server_ist_date()
        session = AttendanceSession(teacher_id=1, subject_id=subj.id, section_id=1, period="Period 1", session_date=today_date, status=SessionStatus.OPEN)
        self.db.add(session)
        self.db.commit()

        # Login Student 1 (21CS001)
        res_login = self.client.post("/api/v1/auth/login", json={
            "username": "21CS001",
            "password": "pass123",
            "device_public_id": "DEVICE_SCAN_10",
            "device_secret": "SECRET_SCAN_10"
        })
        token1 = res_login.json()["access_token"]

        # Student 1 attempts to submit attendance using Student 2's QR payload
        s2 = self.db.query(Student).filter(Student.roll_number == "21CS002").first()
        from app.core.security import generate_encrypted_qr_payload_v2
        qr_payload_s2 = generate_encrypted_qr_payload_v2(student_id=s2.id, roll_number="21CS002", attendance_date=today_date)

        res_scan = self.client.post(
            "/api/v1/attendance/scan",
            headers={"Authorization": f"Bearer {token1}"},
            json={
                "session_id": session.id,
                "qr_payload": qr_payload_s2,
                "period_count": 4
            }
        )
        self.assertIn(res_scan.status_code, [400, 403])
        self.assertIn("cannot submit attendance for another student account", res_scan.json()["detail"])

if __name__ == "__main__":
    unittest.main()
