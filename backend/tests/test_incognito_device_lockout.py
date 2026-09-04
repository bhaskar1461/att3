import os
import sys
import unittest
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
from app.models.models import User, UserRole, Department, AcademicYear, Section, Student
from app.core.security import get_password_hash

class TestIncognitoDeviceLockout(unittest.TestCase):
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

        dept = Department(code="CSE", name="Computer Science")
        ay = AcademicYear(name="2025-2026")
        self.db.add_all([dept, ay])
        self.db.commit()

        self.sec = Section(name="CSE-A", department_id=dept.id, academic_year_id=ay.id)
        self.db.add(self.sec)
        self.db.commit()

        # Create 4 student accounts
        self.students = []
        for i in range(1, 5):
            roll = f"21311A050{i}"
            u = User(username=roll, password_hash=get_password_hash("pass123"), role=UserRole.STUDENT)
            self.db.add(u)
            self.db.commit()

            s = Student(
                user_id=u.id,
                roll_number=roll,
                name=f"Student {i}",
                department_id=dept.id,
                academic_year_id=ay.id,
                section_id=self.sec.id
            )
            self.db.add(s)
            self.db.commit()
            self.students.append((u, s))

    def tearDown(self):
        app.dependency_overrides.clear()
        self.db.close()

    def test_multi_account_login_blocked_on_same_physical_device(self):
        """
        Tests that when Student 1 logs in on Device A,
        subsequent login attempts from Student 2, 3, and 4 on Device A (such as via Incognito windows)
        are strictly rejected with HTTP 403 Forbidden.
        """
        device_id = "DEV-PHYSICAL-HARDWARE-A1B2C3"
        device_secret = "SEC-DETERMINISTIC-SALT-987654"
        headers = {
            "X-Device-Public-Id": device_id,
            "X-Device-Secret": device_secret
        }

        # 1. Student 1 logs in -> SUCCESS (HTTP 200)
        res1 = self.client.post(
            "/api/v1/auth/login",
            data={
                "username": "21311A0501",
                "password": "pass123",
                "device_public_id": device_id,
                "device_secret": device_secret
            },
            headers=headers
        )
        self.assertEqual(res1.status_code, 200, f"Expected 200 for Student 1 login, got {res1.status_code}: {res1.text}")
        data1 = res1.json()
        self.assertIn("access_token", data1)

        # 2. Student 2 opens Incognito window on Device A (same hardware ID) and attempts login -> 403 FORBIDDEN
        res2 = self.client.post(
            "/api/v1/auth/login",
            data={
                "username": "21311A0502",
                "password": "pass123",
                "device_public_id": device_id,
                "device_secret": device_secret
            },
            headers=headers
        )
        self.assertEqual(res2.status_code, 403, f"Expected 403 for Student 2 incognito attempt, got {res2.status_code}")
        self.assertIn("temporarily associated with another student account", res2.json()["detail"])

        # 3. Student 3 opens another Incognito window on Device A and attempts login -> 403 FORBIDDEN
        res3 = self.client.post(
            "/api/v1/auth/login",
            data={
                "username": "21311A0503",
                "password": "pass123",
                "device_public_id": device_id,
                "device_secret": device_secret
            },
            headers=headers
        )
        self.assertEqual(res3.status_code, 403, f"Expected 403 for Student 3 incognito attempt, got {res3.status_code}")

        # 4. Student 4 attempts login on Device A -> 403 FORBIDDEN
        res4 = self.client.post(
            "/api/v1/auth/login",
            data={
                "username": "21311A0504",
                "password": "pass123",
                "device_public_id": device_id,
                "device_secret": device_secret
            },
            headers=headers
        )
        self.assertEqual(res4.status_code, 403, f"Expected 403 for Student 4 incognito attempt, got {res4.status_code}")

        # 5. Student 1 re-authenticates on Device A -> SUCCESS (HTTP 200)
        res1_reauth = self.client.post(
            "/api/v1/auth/login",
            data={
                "username": "21311A0501",
                "password": "pass123",
                "device_public_id": device_id,
                "device_secret": device_secret
            },
            headers=headers
        )
        self.assertEqual(res1_reauth.status_code, 200, f"Expected 200 for Student 1 reauth, got {res1_reauth.status_code}")

    def test_connection_signature_lockout_when_headers_omitted(self):
        """
        Tests that even if a student uses curl/private window without sending headers,
        the server-derived connection signature binds the client IP/User-Agent and rejects account switching.
        """
        client_headers = {"User-Agent": "Mozilla/5.0 IncognitoBrowser/1.0"}

        # Student 1 logs in without device headers
        r1 = self.client.post(
            "/api/v1/auth/login",
            data={"username": "21311A0501", "password": "pass123"},
            headers=client_headers
        )
        self.assertEqual(r1.status_code, 200)

        # Student 2 tries to log in from same IP/User-Agent without device headers
        r2 = self.client.post(
            "/api/v1/auth/login",
            data={"username": "21311A0502", "password": "pass123"},
            headers=client_headers
        )
        self.assertEqual(r2.status_code, 403)
        self.assertIn("temporarily associated with another student account", r2.json()["detail"])

if __name__ == "__main__":
    unittest.main()
