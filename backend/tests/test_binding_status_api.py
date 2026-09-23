"""
Automated Test Suite for Server-Authoritative Device Binding Status API
Endpoint: GET /api/v1/binding/status
"""

import os
import tempfile
import unittest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.core.database import Base, get_db
from app.core.security import get_password_hash, create_access_token
from app.models.models import (
    User, UserRole, Student, Department, AcademicYear, Section,
    DeviceBinding
)
from app.main import app


class TestBindingStatusAPI(unittest.TestCase):

    def setUp(self):
        # Tempfile database for clean test isolation
        self.tmp_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp_db.close()
        self.engine = create_engine(
            f"sqlite:///{self.tmp_db.name}",
            connect_args={"timeout": 15}
        )
        Base.metadata.create_all(bind=self.engine)
        self.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)
        self.db = self.SessionLocal()

        def override_get_db():
            try:
                yield self.db
            finally:
                pass

        app.dependency_overrides[get_db] = override_get_db
        self.client = TestClient(app)

        # Seed test master data
        dept = Department(code="CSE", name="Computer Science")
        self.db.add(dept)
        self.db.commit()

        # Student 1: Unbound
        self.u1 = User(
            username="23311A0504",
            email="vikram@snist.edu",
            password_hash=get_password_hash("pass123"),
            role=UserRole.STUDENT,
            is_active=True
        )
        self.db.add(self.u1)
        self.db.commit()

        self.s1 = Student(
            user_id=self.u1.id,
            roll_number="23311A0504",
            name="Vikram Test",
            department_id=dept.id
        )
        self.db.add(self.s1)

        # Student 2: Bound to a key
        self.u2 = User(
            username="23311A0599",
            email="bound@snist.edu",
            password_hash=get_password_hash("pass123"),
            role=UserRole.STUDENT,
            is_active=True
        )
        self.db.add(self.u2)
        self.db.commit()

        self.s2 = Student(
            user_id=self.u2.id,
            roll_number="23311A0599",
            name="Bound Student",
            department_id=dept.id
        )
        self.db.add(self.s2)
        self.db.commit()

        binding2 = DeviceBinding(
            student_id=self.s2.id,
            device_id="DEV_ALPHA_12345",
            key_id="KEY_ALPHA_12345",
            public_key="MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...",
            status="ACTIVE"
        )
        self.db.add(binding2)
        self.db.commit()

        self.s1_token = create_access_token({"sub": self.u1.username, "role": self.u1.role.value})
        self.s2_token = create_access_token({"sub": self.u2.username, "role": self.u2.role.value})

        self.orig_flag = settings.BINDING_V2
        settings.BINDING_V2 = True

    def tearDown(self):
        settings.BINDING_V2 = self.orig_flag
        self.db.close()
        self.engine.dispose()
        app.dependency_overrides.clear()
        try:
            if os.path.exists(self.tmp_db.name):
                os.remove(self.tmp_db.name)
        except Exception:
            pass

    def test_feature_flag_disabled(self):
        settings.BINDING_V2 = False
        res = self.client.get(
            "/api/v1/binding/status",
            headers={"Authorization": f"Bearer {self.s1_token}"}
        )
        self.assertEqual(res.status_code, 404)

    def test_unauthenticated_request(self):
        res = self.client.get("/api/v1/binding/status")
        self.assertEqual(res.status_code, 401)

    def test_unbound_student_status(self):
        res = self.client.get(
            "/api/v1/binding/status",
            headers={"Authorization": f"Bearer {self.s1_token}"}
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertFalse(data["enrolled"])
        self.assertEqual(data["status"], "NOT_ENROLLED")
        self.assertEqual(data["roll_number"], "23311A0504")
        self.assertIsNone(data["active_key_id"])
        self.assertFalse(data["device_matches"])

    def test_bound_student_matching_key(self):
        res = self.client.get(
            "/api/v1/binding/status?key_id=KEY_ALPHA_12345",
            headers={"Authorization": f"Bearer {self.s2_token}"}
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["enrolled"])
        self.assertEqual(data["status"], "BOUND")
        self.assertEqual(data["active_key_id"], "KEY_ALPHA_12345")
        self.assertTrue(data["device_matches"])

    def test_bound_student_mismatched_key(self):
        res = self.client.get(
            "/api/v1/binding/status?key_id=DIFFERENT_KEY_999",
            headers={"Authorization": f"Bearer {self.s2_token}"}
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["enrolled"])
        self.assertEqual(data["status"], "MISMATCH")
        self.assertEqual(data["active_key_id"], "KEY_ALPHA_12345")
        self.assertFalse(data["device_matches"])


if __name__ == "__main__":
    unittest.main()
