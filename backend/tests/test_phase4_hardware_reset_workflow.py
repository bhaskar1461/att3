"""
Phase 4 Automated Verification Test Suite:
Formal Administrative Reset Workflow for P-256 WebCrypto Hardware Keys & Device Bindings

Verifies:
1. POST /api/v1/binding/admin/reset-student-binding:
   - Canonical lookup by SAP ID, roll_number, and student_id
   - Revocation of all active DeviceBinding records (P-256 WebCrypto keys)
   - Clearing of student.registered_device_id
   - Expiration of active 30-minute device account locks (DeviceAccountBinding)
   - Immutable audit logging with admin identity, reason, and key telemetry
   - Strict role-based access control (SUPER_ADMIN and TEACHER allowed; STUDENT -> 403; Anonymous -> 401)
   - Non-existent student handling -> 404
2. POST /api/v1/binding/admin/revoke/{student_id}:
   - Synchronized clearing of registered_device_id and session locks
3. POST /api/v1/devices/reset-student-enrollment:
   - Admin/Teacher endpoint fallback for environments without BINDING_V2
"""

import os
import unittest
from datetime import datetime, timedelta

from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from sqlalchemy.orm import sessionmaker
from starlette.testclient import TestClient

from app.core.config import settings
from app.core.database import Base, get_db
from app.core.security import get_password_hash, create_access_token
from app.models.models import (
    User, UserRole, Student, Department, AcademicYear, Section,
    DeviceRegistration, DeviceAccountBinding, BindingStatus,
    DeviceBinding, AuditLog, RevokedReason
)
from app.main import app


class TestPhase4HardwareResetWorkflow(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls._orig_binding_v2 = getattr(settings, "BINDING_V2", False)
        settings.BINDING_V2 = True

    @classmethod
    def tearDownClass(cls):
        settings.BINDING_V2 = cls._orig_binding_v2

    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool
        )
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

        # 1. Setup Department, Year, Section
        dept = Department(code="CSE", name="Computer Science and Engineering")
        year = AcademicYear(name="4th Year")
        self.db.add_all([dept, year])
        self.db.commit()

        sec = Section(name="CSE-B", department_id=dept.id, academic_year_id=year.id)
        self.db.add(sec)
        self.db.commit()

        # 2. Setup Super Admin
        self.admin_user = User(
            username="admin_hod",
            email="admin_hod@sreenidhi.edu.in",
            password_hash=get_password_hash("AdminPass123!"),
            role=UserRole.SUPER_ADMIN
        )
        # 3. Setup Teacher
        self.teacher_user = User(
            username="faculty_rao",
            email="faculty_rao@sreenidhi.edu.in",
            password_hash=get_password_hash("FacultyPass123!"),
            role=UserRole.TEACHER
        )
        # 4. Setup Target Student
        self.student_user = User(
            username="23311A05Y6",
            email="23311a05y6@sreenidhi.edu.in",
            password_hash=get_password_hash("StudentPass123!"),
            role=UserRole.STUDENT
        )
        # 5. Setup Another Unauthorized Student
        self.other_student = User(
            username="23311A05Z9",
            email="23311a05z9@sreenidhi.edu.in",
            password_hash=get_password_hash("OtherPass123!"),
            role=UserRole.STUDENT
        )
        self.db.add_all([self.admin_user, self.teacher_user, self.student_user, self.other_student])
        self.db.commit()

        # 6. Create Student Profile
        self.student = Student(
            user_id=self.student_user.id,
            roll_number="23311A05Y6",
            name="Bhaskar Sharma",
            department_id=dept.id,
            academic_year_id=year.id,
            section_id=sec.id,
            email="23311a05y6@sreenidhi.edu.in"
        )
        self.db.add(self.student)
        self.db.commit()

        # Generate Auth Tokens
        self.admin_token = create_access_token(data={"sub": self.admin_user.username, "role": "SUPER_ADMIN", "user_id": self.admin_user.id})
        self.teacher_token = create_access_token(data={"sub": self.teacher_user.username, "role": "TEACHER", "user_id": self.teacher_user.id})
        self.student_token = create_access_token(data={"sub": self.student_user.username, "role": "STUDENT", "user_id": self.student_user.id})

    def tearDown(self):
        app.dependency_overrides.clear()
        self.db.close()

    def _setup_active_student_bindings(self):
        """Helper to create realistic active P-256 hardware keys and Layer-2 device locks."""
        # Layer 1: Register physical hardware device
        dev = DeviceRegistration(
            device_public_id="DEV-PHONE-X99",
            device_credential_hash="hash123",
            first_registered_at=datetime.utcnow(),
            is_active=True
        )
        self.db.add(dev)
        self.db.commit()
        self.db.refresh(dev)

        self.student.registered_device_id = dev.id

        # Layer 2: 30-minute hardware lock
        lock = DeviceAccountBinding(
            device_id=dev.id,
            roll_number=self.student.roll_number,
            bound_at=datetime.utcnow(),
            expires_at=datetime.utcnow() + timedelta(minutes=30),
            status=BindingStatus.ACTIVE
        )
        self.db.add(lock)

        # Layer 3: P-256 WebCrypto cryptographic hardware keypair
        binding = DeviceBinding(
            student_id=self.student.id,
            device_id="client-uuid-444",
            public_key="MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE7v...dummy_p256_spki_b64",
            key_id="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            status="ACTIVE",
            enrolled_at=datetime.utcnow(),
            revoked_at=None
        )
        self.db.add(binding)
        self.db.commit()
        return dev, lock, binding

    # -------------------------------------------------------------------------
    # Test 1: Admin Reset by Canonical SAP ID
    # -------------------------------------------------------------------------
    def test_admin_reset_by_sap_id_success(self):
        dev, lock, binding = self._setup_active_student_bindings()

        res = self.client.post(
            "/api/v1/binding/admin/reset-student-binding",
            headers={"Authorization": f"Bearer {self.admin_token}"},
            json={
                "sap_id": "23311A05Y6",
                "reason": "PHONE_REPLACED",
                "notes": "Student presented new iPhone at HOD office"
            }
        )

        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        self.assertEqual(data["status"], "RESET_COMPLETED")
        self.assertEqual(data["action"], "HARDWARE_KEY_RESET")
        self.assertEqual(data["roll_number"], "23311A05Y6")
        self.assertEqual(data["sap_id"], "23311A05Y6")
        self.assertEqual(data["revoked_bindings_count"], 1)
        self.assertEqual(data["cleared_session_locks"], 1)
        self.assertTrue(data["can_enroll_immediately"])
        self.assertEqual(data["authorized_by"], "admin_hod")

        # Verify DB mutations
        self.db.refresh(binding)
        self.db.refresh(self.student)
        self.db.refresh(lock)

        self.assertIsNotNone(binding.revoked_at)
        self.assertEqual(binding.status, "REVOKED")
        self.assertEqual(binding.revoked_reason, RevokedReason.ADMIN_RESET.value)
        self.assertIsNone(self.student.registered_device_id)
        self.assertEqual(lock.status, BindingStatus.EXPIRED)

        # Verify Immutable Audit Log
        audit = self.db.query(AuditLog).filter(
            AuditLog.roll_number == "23311A05Y6",
            AuditLog.event_type == "ADMIN_HARDWARE_RE_ENROLLMENT_RESET"
        ).first()
        self.assertIsNotNone(audit)
        self.assertEqual(audit.user_id, self.admin_user.id)
        self.assertIn("admin_hod", audit.details)
        self.assertIn("PHONE_REPLACED", audit.details)
        self.assertIn("iPhone", audit.details)

    # -------------------------------------------------------------------------
    # Test 2: Faculty Reset by Roll Number
    # -------------------------------------------------------------------------
    def test_faculty_reset_by_roll_number_success(self):
        dev, lock, binding = self._setup_active_student_bindings()

        res = self.client.post(
            "/api/v1/binding/admin/reset-student-binding",
            headers={"Authorization": f"Bearer {self.teacher_token}"},
            json={
                "roll_number": "23311A05Y6",
                "reason": "DEVICE_LOST",
                "notes": "Verified student ID card physically"
            }
        )

        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        self.assertEqual(data["status"], "RESET_COMPLETED")
        self.assertEqual(data["authorized_by"], "faculty_rao")

        self.db.refresh(binding)
        self.assertEqual(binding.status, "REVOKED")

    # -------------------------------------------------------------------------
    # Test 3: Reset by Student Primary Key ID
    # -------------------------------------------------------------------------
    def test_admin_reset_by_student_id_success(self):
        dev, lock, binding = self._setup_active_student_bindings()

        res = self.client.post(
            "/api/v1/binding/admin/reset-student-binding",
            headers={"Authorization": f"Bearer {self.admin_token}"},
            json={
                "student_id": self.student.id,
                "reason": "BROWSER_STORAGE_CLEARED"
            }
        )

        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        self.assertEqual(data["student_id"], self.student.id)
        self.assertEqual(data["roll_number"], "23311A05Y6")

    # -------------------------------------------------------------------------
    # Test 4: Access Control Enforcements
    # -------------------------------------------------------------------------
    def test_student_rejected_with_403(self):
        res = self.client.post(
            "/api/v1/binding/admin/reset-student-binding",
            headers={"Authorization": f"Bearer {self.student_token}"},
            json={
                "roll_number": "23311A05Y6",
                "reason": "MALICIOUS_SELF_RESET_ATTEMPT"
            }
        )
        self.assertEqual(res.status_code, 403)

    def test_unauthenticated_rejected_with_401(self):
        res = self.client.post(
            "/api/v1/binding/admin/reset-student-binding",
            json={
                "roll_number": "23311A05Y6",
                "reason": "ANONYMOUS_RESET"
            }
        )
        self.assertEqual(res.status_code, 401)

    # -------------------------------------------------------------------------
    # Test 5: Non-Existent Student returns 404
    # -------------------------------------------------------------------------
    def test_nonexistent_student_returns_404(self):
        res = self.client.post(
            "/api/v1/binding/admin/reset-student-binding",
            headers={"Authorization": f"Bearer {self.admin_token}"},
            json={
                "roll_number": "NON_EXISTENT_ROLL_999",
                "reason": "TEST"
            }
        )
        self.assertEqual(res.status_code, 404)

    # -------------------------------------------------------------------------
    # Test 6: Legacy Revoke Endpoint Synchronized Clearing
    # -------------------------------------------------------------------------
    def test_legacy_revoke_endpoint_clears_locks_and_devices(self):
        dev, lock, binding = self._setup_active_student_bindings()

        res = self.client.post(
            f"/api/v1/binding/admin/revoke/{self.student.id}",
            headers={"Authorization": f"Bearer {self.admin_token}"}
        )

        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        self.assertEqual(data["status"], "BINDING_REVOKED")
        self.assertEqual(data["revoked_bindings_count"], 1)
        self.assertEqual(data["cleared_session_locks"], 1)

        self.db.refresh(binding)
        self.db.refresh(self.student)
        self.db.refresh(lock)

        self.assertEqual(binding.status, "REVOKED")
        self.assertIsNone(self.student.registered_device_id)
        self.assertEqual(lock.status, BindingStatus.EXPIRED)

    # -------------------------------------------------------------------------
    # Test 7: Devices API Fallback Endpoint (/devices/reset-student-enrollment)
    # -------------------------------------------------------------------------
    def test_devices_api_reset_enrollment_endpoint(self):
        dev, lock, binding = self._setup_active_student_bindings()

        res = self.client.post(
            "/api/v1/devices/reset-student-enrollment",
            headers={"Authorization": f"Bearer {self.teacher_token}"},
            json={"roll_number": "23311A05Y6"}
        )

        self.assertEqual(res.status_code, 200, res.text)
        self.db.refresh(self.student)
        self.assertIsNone(self.student.registered_device_id)


if __name__ == "__main__":
    unittest.main()
