import time
import unittest
from datetime import datetime, timedelta
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.core.database import Base, get_db
from app.core.config import settings
from app.core.security import get_password_hash, create_access_token, create_refresh_token, decode_refresh_token, decode_access_token
from app.models.models import (
    User, UserRole, Student, Department, AcademicYear, Section,
    DeviceRegistration, DeviceAccountBinding, BindingStatus
)

class TestSessionStabilityAndAuthHardening(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool
        )
        cls.TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=cls.engine)

    def setUp(self):
        Base.metadata.create_all(bind=self.engine)
        self.db = self.TestingSessionLocal()

        def override_get_db():
            try:
                yield self.db
            finally:
                pass

        app.dependency_overrides[get_db] = override_get_db
        self.client = TestClient(app)

        # Create department, academic year, section
        dept = Department(code="CSE", name="Computer Science")
        year = AcademicYear(name="3rd Year")
        self.db.add_all([dept, year])
        self.db.commit()

        sec = Section(name="CSE-A", department_id=dept.id, academic_year_id=year.id)
        self.db.add(sec)
        self.db.commit()

        # Create Student User
        self.student_user = User(
            username="23311A0501",
            email="23311A0501@sreenidhi.edu.in",
            password_hash=get_password_hash("password123"),
            role=UserRole.STUDENT,
            is_active=True
        )
        self.db.add(self.student_user)
        self.db.commit()

        self.student_profile = Student(
            user_id=self.student_user.id,
            roll_number="23311A0501",
            name="Session Test Student",
            department_id=dept.id,
            academic_year_id=year.id,
            section_id=sec.id,
            email="23311A0501@sreenidhi.edu.in"
        )
        self.db.add(self.student_profile)
        self.db.commit()

    def tearDown(self):
        self.db.close()
        Base.metadata.drop_all(bind=self.engine)
        app.dependency_overrides.clear()

    def test_01_login_issues_both_access_and_refresh_tokens(self):
        """Verify POST /auth/login issues 15-min access token, 12-hour refresh token, and httpOnly cookie."""
        res = self.client.post("/api/v1/auth/login", json={
            "username": "23311A0501",
            "password": "password123",
            "device_public_id": "DEV-STABLE-01",
            "device_secret": "SECRET-STABLE-01"
        })
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("access_token", data)
        self.assertIn("refresh_token", data)

        # Validate access token lifespan (~900 seconds)
        acc_payload = decode_access_token(data["access_token"])
        self.assertIsNotNone(acc_payload)
        self.assertEqual(acc_payload.get("sub"), "23311A0501")
        time_to_expire = acc_payload.get("exp") - time.time()
        self.assertGreater(time_to_expire, 800)  # > 13 min remaining

        # Validate refresh token payload and lifespan (~12 hours)
        ref_payload = decode_refresh_token(data["refresh_token"])
        self.assertIsNotNone(ref_payload)
        self.assertEqual(ref_payload.get("token_type"), "refresh")
        ref_time_to_expire = ref_payload.get("exp") - time.time()
        self.assertGreater(ref_time_to_expire, 40000)  # > 11 hours remaining

        # Verify cookie was set
        self.assertIn("snist_refresh_token", res.cookies)

    def test_02_refresh_with_expired_access_token_succeeds(self):
        """Verify that when the access token has expired, /auth/refresh with refresh token still succeeds."""
        # Issue an expired access token (expired 5 minutes ago)
        expired_access_token = create_access_token(
            data={"sub": "23311A0501", "role": "STUDENT", "user_id": self.student_user.id},
            expires_delta=timedelta(seconds=-300)
        )
        self.assertIsNone(decode_access_token(expired_access_token))

        # First establish device binding
        login_res = self.client.post("/api/v1/auth/login", json={
            "username": "23311A0501",
            "password": "password123",
            "device_public_id": "DEV-STABLE-02",
            "device_secret": "SECRET-STABLE-02"
        })
        self.assertEqual(login_res.status_code, 200)
        refresh_token = login_res.json()["refresh_token"]

        # Call /auth/refresh passing the valid refresh token (with expired access token in Authorization or none)
        refresh_res = self.client.post("/api/v1/auth/refresh", json={
            "refresh_token": refresh_token,
            "device_public_id": "DEV-STABLE-02",
            "device_secret": "SECRET-STABLE-02"
        }, headers={
            "Authorization": f"Bearer {expired_access_token}",
            "X-Device-Public-Id": "DEV-STABLE-02",
            "X-Device-Secret": "SECRET-STABLE-02"
        })
        self.assertEqual(refresh_res.status_code, 200)
        new_data = refresh_res.json()
        self.assertIn("access_token", new_data)
        self.assertIn("refresh_token", new_data)

        # Verify new access token is fresh and valid
        new_acc_payload = decode_access_token(new_data["access_token"])
        self.assertIsNotNone(new_acc_payload)
        self.assertEqual(new_acc_payload.get("sub"), "23311A0501")

    def test_03_refresh_with_expired_refresh_token_fails_with_401(self):
        """Verify that when refresh token itself has expired (> 12h), /auth/refresh returns clean 401."""
        expired_refresh_token = create_refresh_token(
            data={"sub": "23311A0501", "role": "STUDENT", "user_id": self.student_user.id},
            expires_delta=timedelta(seconds=-60)
        )
        res = self.client.post("/api/v1/auth/refresh", json={
            "refresh_token": expired_refresh_token,
            "device_public_id": "DEV-STABLE-03",
            "device_secret": "SECRET-STABLE-03"
        })
        self.assertEqual(res.status_code, 401)
        self.assertIn("Session expired or invalid refresh token", res.json()["detail"])

    def test_04_relogin_from_bound_device_10_times_succeeds_11th_429(self):
        """Requirement R2: Re-login from same bound device is allowed up to 10x per window; 11th gets 429."""
        device_id = "DEV-STABLE-04"
        secret = "SECRET-STABLE-04"

        # 10 consecutive successful logins from the bound device
        for i in range(1, 11):
            res = self.client.post("/api/v1/auth/login", json={
                "username": "23311A0501",
                "password": "password123",
                "device_public_id": device_id,
                "device_secret": secret
            })
            self.assertEqual(res.status_code, 200, f"Login {i} should succeed")

        # 11th login attempt within the window must trigger 429 rate limit
        res_11 = self.client.post("/api/v1/auth/login", json={
            "username": "23311A0501",
            "password": "password123",
            "device_public_id": device_id,
            "device_secret": secret
        })
        self.assertEqual(res_11.status_code, 429)
        self.assertIn("Maximum authentication attempts reached", res_11.json()["detail"])
        self.assertIn("Retry-After", res_11.headers)

    def test_05_failed_login_budget_isolated_from_successful_logins(self):
        """Requirement R3: Failed attempts (wrong password) do NOT penalize successful logins, and vice-versa."""
        device_id = "DEV-STABLE-05"
        secret = "SECRET-STABLE-05"

        # 1. Perform 3 successful logins
        for _ in range(3):
            res = self.client.post("/api/v1/auth/login", json={
                "username": "23311A0501",
                "password": "password123",
                "device_public_id": device_id,
                "device_secret": secret
            })
            self.assertEqual(res.status_code, 200)

        # 2. Perform 4 failed attempts with wrong password
        for attempt in range(1, 5):
            res = self.client.post("/api/v1/auth/login", json={
                "username": "23311A0501",
                "password": "wrong_password",
                "device_public_id": device_id,
                "device_secret": secret
            })
            self.assertEqual(res.status_code, 401)

        # 3. Next attempt with CORRECT password succeeds (failed budget did not block correct password yet)
        res_correct = self.client.post("/api/v1/auth/login", json={
            "username": "23311A0501",
            "password": "password123",
            "device_public_id": device_id,
            "device_secret": secret
        })
        self.assertEqual(res_correct.status_code, 200)

        # 4. Now perform 5 consecutive failures
        for _ in range(5):
            res_fail = self.client.post("/api/v1/auth/login", json={
                "username": "23311A0501",
                "password": "wrong_password_again",
                "device_public_id": device_id,
                "device_secret": secret
            })
        
        # 6th failure receives 429
        res_locked = self.client.post("/api/v1/auth/login", json={
            "username": "23311A0501",
            "password": "wrong_password_again",
            "device_public_id": device_id,
            "device_secret": secret
        })
        self.assertEqual(res_locked.status_code, 429)

    def test_06_unapproved_cross_device_login_still_blocks_403(self):
        """Requirement R4: Student bound to Device A cannot log in on Device B -> returns 403."""
        # Initial login on Device A
        res_dev_a = self.client.post("/api/v1/auth/login", json={
            "username": "23311A0501",
            "password": "password123",
            "device_public_id": "DEV-PHONE-A",
            "device_secret": "SECRET-A"
        })
        self.assertEqual(res_dev_a.status_code, 200)

        # Attempt login on Device B
        res_dev_b = self.client.post("/api/v1/auth/login", json={
            "username": "23311A0501",
            "password": "password123",
            "device_public_id": "DEV-PHONE-B",
            "device_secret": "SECRET-B"
        })
        self.assertEqual(res_dev_b.status_code, 403)
        self.assertIn("registered to a different device", res_dev_b.json()["detail"])
