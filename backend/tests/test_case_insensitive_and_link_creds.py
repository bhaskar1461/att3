"""
Test suite verifying:
1. Case-insensitive roll numbers (e.g. 23311a05y6 vs 23311A05Y6).
2. Fresh credentials and onboarding PIN self-healing.
3. Missing User row auto-provisioning from StudentOnboarding.
4. Magic link 1-click authentication and device binding.
"""

import unittest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.models.models import User, UserRole, Student, StudentOnboarding, OnboardingState, Department, AcademicYear, Section
from app.core.security import get_password_hash, create_magic_login_token
from app.main import app


class TestCaseInsensitiveAndLinkCreds(unittest.TestCase):

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

        # Base mock student
        self.pin = "962381"
        self.pin_hash = get_password_hash(self.pin)
        self.roll = "23311A05Y6"

        self.onboarding = StudentOnboarding(
            roll_number=self.roll,
            email="23311a05y6@cse.sreenidhi.edu.in",
            name="Bhaskar Sharma",
            pin_hash=self.pin_hash,
            state=OnboardingState.ACTIVATED
        )
        self.db.add(self.onboarding)

        self.user = User(
            username=self.roll,
            email="23311a05y6@cse.sreenidhi.edu.in",
            password_hash=self.pin_hash,
            role=UserRole.STUDENT,
            is_active=True,
            must_change_password=False
        )
        self.db.add(self.user)
        self.db.commit()

    def tearDown(self):
        self.db.close()
        app.dependency_overrides.clear()

    def test_case_insensitive_login_lowercase(self):
        """Student typing lowercase roll number e.g. 23311a05y6 must authenticate successfully."""
        resp = self.client.post("/api/v1/auth/login", data={"username": "23311a05y6", "password": self.pin})
        self.assertEqual(resp.status_code, 200, f"Failed: {resp.text}")
        data = resp.json()
        self.assertEqual(data["username"], "23311A05Y6")
        self.assertIn("access_token", data)

    def test_case_insensitive_login_uppercase(self):
        """Student typing uppercase roll number 23311A05Y6 must authenticate successfully."""
        resp = self.client.post("/api/v1/auth/login", data={"username": "23311A05Y6", "password": self.pin})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["username"], "23311A05Y6")

    def test_onboarding_pin_self_healing(self):
        """If User.password_hash is out of sync with StudentOnboarding.pin_hash, login heals User hash."""
        # Desynchronize user password
        self.user.password_hash = get_password_hash("old_outdated_pw")
        self.db.commit()

        # Login with the fresh onboarding PIN
        resp = self.client.post("/api/v1/auth/login", data={"username": "23311a05y6", "password": self.pin})
        self.assertEqual(resp.status_code, 200)

        # Verify User.password_hash was healed
        self.db.refresh(self.user)
        from app.core.security import verify_password
        self.assertTrue(verify_password(self.pin, self.user.password_hash))

    def test_auto_provision_user_from_onboarding_record(self):
        """If User row does not exist yet, login auto-provisions User row and logs student in."""
        self.db.delete(self.user)
        self.db.commit()

        # Ensure User is gone
        self.assertIsNone(self.db.query(User).filter(User.username == self.roll).first())

        # Student logs in with lowercase roll and valid PIN
        resp = self.client.post("/api/v1/auth/login", data={"username": "23311a05y6", "password": self.pin})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["username"], "23311A05Y6")

        # Check User was provisioned
        new_user = self.db.query(User).filter(User.username == self.roll).first()
        self.assertIsNotNone(new_user)
        self.assertTrue(new_user.is_active)

    def test_magic_login_flow(self):
        """Student logging in via 1-click magic link token succeeds and binds device."""
        tok = create_magic_login_token(username=self.roll, role="STUDENT", expires_days=7)
        resp = self.client.post("/api/v1/auth/magic-login", json={
            "token": tok,
            "device_public_id": "TEST-IPHONE-DEV-1",
            "device_secret": "TEST-SECRET-SALT"
        })
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["username"], "23311A05Y6")
        self.assertIn("access_token", data)


if __name__ == "__main__":
    unittest.main()
