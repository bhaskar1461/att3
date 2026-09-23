import unittest
import re
from datetime import datetime, timedelta
from unittest.mock import patch, MagicMock

from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from sqlalchemy.orm import sessionmaker
from starlette.testclient import TestClient

from app.core.database import Base, get_db
from app.models.models import (
    User, UserRole, Student, Department, AcademicYear, Section,
    DeviceRegistration, DeviceResetOTP, AuditLog, SecurityEventType
)
from app.core.security import get_password_hash
from app.main import app

class TestDeviceSelfServiceReset(unittest.TestCase):

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

        # Create department, year, section
        dept = Department(code="CSE", name="Computer Science")
        year = AcademicYear(name="3rd Year")
        self.db.add_all([dept, year])
        self.db.commit()

        sec = Section(name="CSE-A", department_id=dept.id, academic_year_id=year.id)
        self.db.add(sec)
        self.db.commit()

        # Create Student
        self.u1 = User(
            username="23311A05Y6",
            email="23311a05y6@sreenidhi.edu.in",
            password_hash=get_password_hash("pass1461"),
            role=UserRole.STUDENT
        )
        self.db.add(self.u1)
        self.db.commit()

        self.s1 = Student(
            user_id=self.u1.id,
            roll_number="23311A05Y6",
            name="Bhaskar",
            email="23311a05y6@sreenidhi.edu.in",
            department_id=dept.id,
            academic_year_id=year.id,
            section_id=sec.id
        )
        self.db.add(self.s1)
        self.db.commit()

        # Create Teacher
        self.u_teacher = User(
            username="TEACHER01",
            password_hash=get_password_hash("teacherpass"),
            role=UserRole.TEACHER
        )
        self.db.add(self.u_teacher)
        self.db.commit()

        # Create Super Admin
        self.u_admin = User(
            username="ADMIN01",
            password_hash=get_password_hash("adminpass"),
            role=UserRole.SUPER_ADMIN
        )
        self.db.add(self.u_admin)
        self.db.commit()

    def tearDown(self):
        app.dependency_overrides.clear()
        self.db.close()
        Base.metadata.drop_all(bind=self.engine)

    @patch("app.api.devices.send_single_email")
    def test_request_reset_happy_path(self, mock_email):
        """Happy path: student requests OTP, email sent, DB OTP row created with 10-min expiry."""
        mock_email.return_value = {"status": "SENT"}

        res = self.client.post("/api/v1/devices/request-reset", json={
            "roll_number": "23311a05y6",
            "password": "pass1461"
        })

        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "SUCCESS")
        self.assertIn("masked_email", data)
        self.assertEqual(data["expires_in_minutes"], 10)

        mock_email.assert_called_once()

        # Verify DB OTP record
        otp_rec = self.db.query(DeviceResetOTP).filter(DeviceResetOTP.roll_number == "23311A05Y6").first()
        self.assertIsNotNone(otp_rec)
        self.assertFalse(otp_rec.is_consumed)
        self.assertEqual(otp_rec.attempts, 0)

    def test_request_reset_wrong_password(self):
        """Wrong password fails with HTTP 401."""
        res = self.client.post("/api/v1/devices/request-reset", json={
            "roll_number": "23311A05Y6",
            "password": "wrongpassword"
        })
        self.assertEqual(res.status_code, 401)
        self.assertIn("Incorrect password", res.json()["detail"])

    @patch("app.api.devices.send_single_email")
    def test_request_reset_rate_limit(self, mock_email):
        """Max 3 requests per hour; 4th request returns HTTP 429."""
        mock_email.return_value = {"status": "SENT"}

        for _ in range(3):
            res = self.client.post("/api/v1/devices/request-reset", json={
                "roll_number": "23311A05Y6",
                "password": "pass1461"
            })
            self.assertEqual(res.status_code, 200)

        # 4th request must be rejected with 429
        res4 = self.client.post("/api/v1/devices/request-reset", json={
            "roll_number": "23311A05Y6",
            "password": "pass1461"
        })
        self.assertEqual(res4.status_code, 429)
        self.assertIn("Too many verification requests", res4.json()["detail"])

    @patch("app.api.devices.send_single_email")
    def test_request_reset_semester_cap(self, mock_email):
        """Semester cap of 5 resets: attempt #6 triggers HTTP 403 and records DEVICE_SELF_RESET_CAP_EXCEEDED."""
        mock_email.return_value = {"status": "SENT"}

        # Simulate 5 past self-resets in AuditLog
        for i in range(5):
            log = AuditLog(
                user_id=self.u1.id,
                roll_number="23311A05Y6",
                event_type="DEVICE_SELF_RESET",
                action="DEVICE_SELF_RESET",
                details=f"Test reset {i+1}",
                created_at=datetime.utcnow() - timedelta(days=10)
            )
            self.db.add(log)
        self.db.commit()

        # 6th reset attempt must be blocked with HTTP 403
        res = self.client.post("/api/v1/devices/request-reset", json={
            "roll_number": "23311A05Y6",
            "password": "pass1461"
        })
        self.assertEqual(res.status_code, 403)
        self.assertIn("maximum limit of 5 self-service device resets", res.json()["detail"])

        # Verify audit log recorded CAP_EXCEEDED
        cap_log = self.db.query(AuditLog).filter(AuditLog.event_type == "DEVICE_SELF_RESET_CAP_EXCEEDED").first()
        self.assertIsNotNone(cap_log)

    @patch("app.api.devices.send_single_email")
    def test_verify_reset_happy_path_and_atomic_consumption(self, mock_email):
        """Verifying correct OTP rebinds device; OTP cannot be reused a second time (atomic single-use)."""
        mock_email.return_value = {"status": "SENT"}

        # Request OTP
        self.client.post("/api/v1/devices/request-reset", json={
            "roll_number": "23311A05Y6",
            "password": "pass1461"
        })

        # Capture the plaintext OTP from mock_email call
        call_args = mock_email.call_args[1]
        subject = call_args["subject"]
        otp_code = subject.split(":")[-1].strip()

        # Submit verification from new device
        res = self.client.post("/api/v1/devices/verify-reset", json={
            "roll_number": "23311A05Y6",
            "otp": otp_code,
            "new_device_public_id": "DEV-IPHONE-NEW-9999",
            "new_device_secret": "SECRET-HASH-NEW-9999"
        })
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "SUCCESS")

        # Verify student now points to new device
        self.db.refresh(self.s1)
        new_dev = self.db.query(DeviceRegistration).filter(DeviceRegistration.device_public_id == "DEV-IPHONE-NEW-9999").first()
        self.assertIsNotNone(new_dev)
        self.assertEqual(self.s1.registered_device_id, new_dev.id)

        # Verify OTP is marked consumed
        otp_rec = self.db.query(DeviceResetOTP).filter(DeviceResetOTP.roll_number == "23311A05Y6").first()
        self.assertTrue(otp_rec.is_consumed)

        # Attempt to reuse the same OTP a second time must FAIL
        reuse_res = self.client.post("/api/v1/devices/verify-reset", json={
            "roll_number": "23311A05Y6",
            "otp": otp_code,
            "new_device_public_id": "DEV-ANOTHER-DEVICE",
            "new_device_secret": "ANOTHER-SECRET"
        })
        self.assertEqual(reuse_res.status_code, 400)
        self.assertIn("No active reset request found", reuse_res.json()["detail"])

    @patch("app.api.devices.send_single_email")
    def test_verify_reset_invalid_otp_increments_attempts(self, mock_email):
        """Invalid OTP code increments attempt count and rejects with 400."""
        mock_email.return_value = {"status": "SENT"}

        self.client.post("/api/v1/devices/request-reset", json={
            "roll_number": "23311A05Y6",
            "password": "pass1461"
        })

        res = self.client.post("/api/v1/devices/verify-reset", json={
            "roll_number": "23311A05Y6",
            "otp": "000000",
            "new_device_public_id": "DEV-TEST-000",
            "new_device_secret": "DEV-SECRET-000"
        })
        self.assertEqual(res.status_code, 400)
        self.assertIn("Invalid verification code", res.json()["detail"])

        otp_rec = self.db.query(DeviceResetOTP).filter(DeviceResetOTP.roll_number == "23311A05Y6").first()
        self.assertEqual(otp_rec.attempts, 1)

    @patch("app.api.devices.send_single_email")
    def test_verify_reset_expired_otp(self, mock_email):
        """Expired OTP is rejected."""
        mock_email.return_value = {"status": "SENT"}

        self.client.post("/api/v1/devices/request-reset", json={
            "roll_number": "23311A05Y6",
            "password": "pass1461"
        })

        # Artificially expire the OTP
        otp_rec = self.db.query(DeviceResetOTP).filter(DeviceResetOTP.roll_number == "23311A05Y6").first()
        otp_rec.expires_at = datetime.utcnow() - timedelta(minutes=1)
        self.db.commit()

        res = self.client.post("/api/v1/devices/verify-reset", json={
            "roll_number": "23311A05Y6",
            "otp": "123456",
            "new_device_public_id": "DEV-TEST-000",
            "new_device_secret": "DEV-SECRET-000"
        })
        self.assertEqual(res.status_code, 400)
        self.assertIn("expired", res.json()["detail"].lower())

    def test_admin_reset_role_guards(self):
        """Non-teacher/admin role calling reset-student-enrollment receives HTTP 403."""
        from app.api.auth import get_current_user

        # Override as student user
        app.dependency_overrides[get_current_user] = lambda: self.u1

        res = self.client.post("/api/v1/devices/reset-student-enrollment", json={
            "roll_number": "23311A05Y6"
        })
        self.assertEqual(res.status_code, 403)
        self.assertIn("Admin or Teacher permission required", res.json()["detail"])

        # Override as teacher user
        app.dependency_overrides[get_current_user] = lambda: self.u_teacher
        res_teacher = self.client.post("/api/v1/devices/reset-student-enrollment", json={
            "roll_number": "23311A05Y6"
        })
        self.assertEqual(res_teacher.status_code, 200)
        self.assertEqual(res_teacher.json()["status"], "success")

    def test_student_qr_code_unapproved_device_guard(self):
        """Calling /student/qr-code with unapproved device header triggers HTTP 403."""
        from app.api.auth import get_current_user
        from app.core.device_security import register_or_get_device

        # Enroll student on approved device DEV-APPROVED-111
        dev1 = register_or_get_device(self.db, "DEV-APPROVED-111", "SECRET-111")
        self.s1.registered_device_id = dev1.id
        self.db.commit()

        # Create another device DEV-UNAPPROVED-222
        register_or_get_device(self.db, "DEV-UNAPPROVED-222", "SECRET-222")

        # Mock current user as student 1
        app.dependency_overrides[get_current_user] = lambda: self.u1

        # Request /student/qr-code with unapproved device header
        res = self.client.get(
            "/api/v1/student/qr-code",
            headers={"X-Device-Public-Id": "DEV-UNAPPROVED-222"}
        )
        self.assertEqual(res.status_code, 403)
        self.assertIn("registered to a different device", res.json()["detail"])

        # Request /student/qr-code with approved device header succeeds
        res_ok = self.client.get(
            "/api/v1/student/qr-code",
            headers={"X-Device-Public-Id": "DEV-APPROVED-111"}
        )
        self.assertEqual(res_ok.status_code, 200)

    @patch("app.api.devices.send_single_email")
    def test_verify_reset_with_placeholder_clears_enrollment_for_auto_enroll(self, mock_email):
        """Self-service reset with placeholder DEV-RESET-V2 sets registered_device_id=None and returns tokens."""
        mock_email.return_value = {"status": "SENT"}

        # Previously enrolled on old device
        from app.core.device_security import register_or_get_device
        old_dev = register_or_get_device(self.db, "DEV-OLD-PHONE", "SECRET-OLD")
        self.s1.registered_device_id = old_dev.id
        self.db.commit()

        # Request OTP
        self.client.post("/api/v1/devices/request-reset", json={
            "roll_number": "23311A05Y6",
            "password": "pass1461"
        })
        call_args = mock_email.call_args[1]
        import re
        m = re.search(r"Code:\s*([0-9]{6})", call_args["subject"])
        otp_code = m.group(1)

        # Submit verification with DEV-RESET-V2 placeholder
        res = self.client.post("/api/v1/devices/verify-reset", json={
            "roll_number": "23311A05Y6",
            "otp": otp_code,
            "new_device_public_id": "DEV-RESET-V2",
            "new_device_secret": "V2_RESET_CREDENTIAL"
        })
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "SUCCESS")
        self.assertIn("access_token", data)
        self.assertIn("user", data)

        # registered_device_id must be None so subsequent login auto-enrolls
        self.db.refresh(self.s1)
        self.assertIsNone(self.s1.registered_device_id)

    @patch("app.api.devices.send_single_email")
    def test_verify_reset_multi_otp_tolerance(self, mock_email):
        """Requesting a second OTP doesn't immediately invalidate the first; first OTP still succeeds."""
        mock_email.return_value = {"status": "SENT"}

        # Request 1st OTP
        self.client.post("/api/v1/devices/request-reset", json={
            "roll_number": "23311A05Y6",
            "password": "pass1461"
        })
        m1 = re.search(r"Code:\s*([0-9]{6})", mock_email.call_args[1]["subject"])
        otp_1 = m1.group(1)

        # Request 2nd OTP 5 seconds later
        self.client.post("/api/v1/devices/request-reset", json={
            "roll_number": "23311A05Y6",
            "password": "pass1461"
        })
        m2 = re.search(r"Code:\s*([0-9]{6})", mock_email.call_args[1]["subject"])
        otp_2 = m2.group(1)

        # Student enters otp_1 (received first by email)
        res = self.client.post("/api/v1/devices/verify-reset", json={
            "roll_number": "23311A05Y6",
            "otp": otp_1,
            "new_device_public_id": "DEV-RESET-V2",
            "new_device_secret": "V2_RESET_CREDENTIAL"
        })
        self.assertEqual(res.status_code, 200)

        # Both OTPs must now be consumed
        otps = self.db.query(DeviceResetOTP).filter(DeviceResetOTP.roll_number == "23311A05Y6").all()
        for o in otps:
            self.assertTrue(o.is_consumed)

if __name__ == "__main__":
    unittest.main()
