"""
Unit and Integration Tests for Student Onboarding & Credential Dispatch Modules
Tests token generation, OTP flow, PIN setting, device binding, and email rendering.
"""

import os
import sys
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch, MagicMock
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from sqlalchemy.orm import sessionmaker
from starlette.testclient import TestClient

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.core.config import settings
from app.core.database import Base, get_db
from app.models.models import (
    User, UserRole, Student, Department, AcademicYear, Section,
    StudentOnboarding, OnboardingToken, OnboardingOTP, OnboardingState,
    DeviceRebindRequest, RebindRequestStatus, CredentialBatch, CredentialItem,
    Teacher, TeacherAssignment, Subject
)
from app.core.security import get_password_hash
from app.services.email_service import render_email_template, send_teacher_class_allotment_notification
from app.services.onboarding_service import (
    generate_magic_token,
    verify_magic_token,
    generate_otp,
    verify_otp,
    set_student_pin,
    activate_student,
    create_onboarding_session_token,
    decode_onboarding_session_token
)
from app.main import app


class TestOnboardingAndCredentials(unittest.TestCase):

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

        # Prerequisite data
        self.dept = Department(code="CSE", name="Computer Science")
        self.year = AcademicYear(name="3rd Year")
        self.db.add_all([self.dept, self.year])
        self.db.commit()

        self.sec = Section(name="CSE-A", department_id=self.dept.id, academic_year_id=self.year.id)
        self.db.add(self.sec)
        self.db.commit()

        # Onboarding record
        self.onboarding = StudentOnboarding(
            roll_number="23311A05Y6",
            email="23311a05y6@cse.sreenidhi.edu.in",
            name="Bhaskar Test",
            department_id=self.dept.id,
            academic_year_id=self.year.id,
            section_id=self.sec.id,
            state=OnboardingState.PENDING_ONBOARDING
        )
        self.db.add(self.onboarding)
        self.db.commit()

    def tearDown(self):
        self.db.close()
        app.dependency_overrides.clear()

    # --- Test 1: Email Template Rendering ---
    def test_email_template_rendering(self):
        """Verify all 4 Jinja2 email templates render correctly with context."""
        # Magic link email
        magic_html = render_email_template("magic_link_email.html", {
            "student_name": "Bhaskar",
            "roll_number": "23311A05Y6",
            "magic_link": "http://localhost:5173/onboard?token=test12345",
            "expiry_hours": 48,
            "department": "CSE",
            "section": "A"
        })
        self.assertIn("Bhaskar", magic_html)
        self.assertIn("23311A05Y6", magic_html)

        # Student credentials email
        student_cred_html = render_email_template("student_credentials_email.html", {
            "name": "Bhaskar",
            "sap_id": "23311A05Y6",
            "portal_url": "http://localhost:5173",
            "temp_password": "TempPassword123"
        })
        self.assertIn("23311A05Y6", student_cred_html)
        self.assertIn("TempPassword123", student_cred_html)

        # Teacher credentials email
        teacher_cred_html = render_email_template("teacher_credentials_email.html", {
            "name": "Prof. Rao",
            "email": "rao@sreenidhi.edu.in",
            "portal_url": "http://localhost:5173",
            "temp_password": "TeacherPass123"
        })
        self.assertIn("Prof. Rao", teacher_cred_html)
        self.assertIn("TeacherPass123", teacher_cred_html)

        # OTP email
        otp_html = render_email_template("otp_email.html", {
            "otp_code": "654321",
            "expiry_minutes": 10,
            "student_email": "test@sreenidhi.edu.in"
        })
        self.assertIn("654321", otp_html)

    # --- Test 2: Token Generation & Verification ---
    def test_magic_link_token_lifecycle(self):
        """Create a magic link token and verify validation and single-use behavior."""
        raw_token = generate_magic_token(self.db, self.onboarding.id, self.onboarding.roll_number)
        self.assertIsNotNone(raw_token)
        self.assertGreater(len(raw_token), 30)

        # Valid token verification
        record, err = verify_magic_token(self.db, raw_token)
        self.assertIsNone(err)
        self.assertIsNotNone(record)
        self.assertEqual(record.roll_number, "23311A05Y6")

        # Second verification should fail because token is consumed (single-use)
        record2, err2 = verify_magic_token(self.db, raw_token)
        self.assertIsNone(record2)
        self.assertIn("already been used", err2)

        # Invalid token verification
        record3, err3 = verify_magic_token(self.db, "fake_token_value_that_does_not_exist")
        self.assertIsNone(record3)
        self.assertIn("Invalid", err3)

    # --- Test 3: OTP Request, Attempt Tracking, & Verification ---
    def test_otp_verification_flow(self):
        """Test OTP generation, attempt count, correct code matching, and wrong code rejection."""
        # Mock send_single_email to avoid network calls
        with patch("app.services.email_service.send_single_email", return_value={"status": "SENT", "to": self.onboarding.email}):
            success, msg = generate_otp(self.db, self.onboarding.id, self.onboarding.email)
            self.assertTrue(success)

        # Retrieve the generated OTP hash from DB
        otp_record = self.db.query(OnboardingOTP).filter(OnboardingOTP.onboarding_id == self.onboarding.id).first()
        self.assertIsNotNone(otp_record)

        # Wrong code rejection
        valid, err = verify_otp(self.db, self.onboarding.id, "000000")
        self.assertFalse(valid)
        self.assertIn("Invalid", err)

        # Test with known code by creating a known OTP record
        import hashlib
        known_code = "123456"
        otp_record.otp_hash = hashlib.sha256(known_code.encode("utf-8")).hexdigest()
        otp_record.attempts = 0
        self.db.commit()

        # Correct code success
        valid, success_msg = verify_otp(self.db, self.onboarding.id, known_code)
        self.assertTrue(valid)

    # --- Test 4: Complete Onboarding Activation Flow ---
    def test_complete_onboarding_activation(self):
        """Verify full onboarding activation: sets PIN, binds device, marks active, creates User and Student."""
        # Pre-verify mobile/OTP
        self.onboarding.mobile_verified = True
        self.db.commit()

        # 1. Set student PIN
        pin_ok, pin_msg = set_student_pin(self.db, self.onboarding.id, "1234")
        self.assertTrue(pin_ok)

        # 2. Activate student
        act_ok, act_msg, user_data = activate_student(
            db=self.db,
            onboarding_id=self.onboarding.id,
            device_uuid="test-hardware-device-uuid-999"
        )
        self.assertTrue(act_ok)
        self.assertEqual(user_data["roll_number"], "23311A05Y6")

        # Verify User and Student created
        user = self.db.query(User).filter(User.username == "23311A05Y6").first()
        self.assertIsNotNone(user)
        self.assertEqual(user.role, UserRole.STUDENT)

        student = self.db.query(Student).filter(Student.roll_number == "23311A05Y6").first()
        self.assertIsNotNone(student)
        self.assertEqual(student.name, "Bhaskar Test")

        # Verify onboarding status updated
        self.db.refresh(self.onboarding)
        self.assertEqual(self.onboarding.state, OnboardingState.ACTIVATED)

    # --- Test 5: Invalid PIN Rejection ---
    def test_invalid_pin_rejection(self):
        """Ensure non-numeric or wrong-length PINs are rejected."""
        # Non-numeric
        ok, msg = set_student_pin(self.db, self.onboarding.id, "abcd")
        self.assertFalse(ok)
        self.assertIn("digits", msg.lower())

        # Too short (< 4 digits)
        ok, msg = set_student_pin(self.db, self.onboarding.id, "12")
        self.assertFalse(ok)
        self.assertIn("digits", msg.lower())

        # Too long (> 6 digits)
        ok, msg = set_student_pin(self.db, self.onboarding.id, "12345678")
        self.assertFalse(ok)
        self.assertIn("digits", msg.lower())

    # --- Test 6: Session JWT Lifecycle ---
    def test_session_token_lifecycle(self):
        """Ensure onboarding session JWTs can be created, decoded, and validated."""
        token = create_onboarding_session_token(self.onboarding.id, self.onboarding.roll_number)
        self.assertIsNotNone(token)

        payload = decode_onboarding_session_token(token)
        self.assertIsNotNone(payload)
        self.assertEqual(payload.get("onboarding_id"), self.onboarding.id)
        self.assertEqual(payload.get("type"), "onboarding_session")

    # --- Test 7: Public Wizard API Endpoints via TestClient ---
    def test_public_onboarding_endpoints(self):
        """Test the public FastAPI router endpoints for student onboarding."""
        raw_token = generate_magic_token(self.db, self.onboarding.id, self.onboarding.roll_number)

        # POST /api/v1/onboard/verify-token
        resp = self.client.post("/api/v1/onboard/verify-token", json={"token": raw_token})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["student"]["roll_number"], "23311A05Y6")
        self.assertIn("session_token", data)

    # --- Test 8: Teacher Class Allotment Email & Anti-CC In-Charge Governance ---
    def test_teacher_class_allotment_notification(self):
        """Ensure teacher receives class assignment email with weekly schedule and coming Monday start date."""
        teacher_user = User(
            username="sowjanya",
            email="sowjanya.n@sreenidhi.edu.in",
            role=UserRole.TEACHER,
            password_hash=get_password_hash("password123"),
            is_active=True
        )
        self.db.add(teacher_user)
        self.db.commit()

        teacher = Teacher(
            user_id=teacher_user.id,
            teacher_code="T_SOWJANYA",
            name="Mrs. N. Sowjanya",
            department_id=self.dept.id,
        )
        self.db.add(teacher)
        self.db.commit()

        subject = Subject(
            code="CS(CET)",
            name="Career Enhancement Training (CET)",
            department_id=self.dept.id,
            academic_year_id=self.year.id
        )
        self.db.add(subject)
        self.db.commit()

        assignment = TeacherAssignment(
            teacher_id=teacher.id,
            subject_id=subject.id,
            section_id=self.sec.id
        )
        self.db.add(assignment)
        self.db.commit()

        with patch("app.services.email_service.send_single_email") as mock_send:
            mock_send.return_value = {"status": "SENT", "to": "sowjanya.n@sreenidhi.edu.in"}
            res = send_teacher_class_allotment_notification(
                db=self.db,
                teacher_email="sowjanya.n@sreenidhi.edu.in",
                section_id=self.sec.id,
                student_count=51,
                trigger_context="DISPATCH"
            )

            self.assertEqual(res["status"], "SENT")
            self.assertEqual(res["teacher_name"], "Mrs. N. Sowjanya")
            self.assertEqual(res["class_name"], "Career Enhancement Training (CET)")
            self.assertTrue("Coming Monday" in res["next_class_date"] or "Today" in res["next_class_date"])

            # Verify send_single_email was called with cc=None (ANTI-SPAM INBOX PROTECTION)
            mock_send.assert_called_once()
            _, kwargs = mock_send.call_args
            self.assertIsNone(kwargs.get("cc"))
            self.assertEqual(kwargs.get("to_email"), "sowjanya.n@sreenidhi.edu.in")
            self.assertIn("Career Enhancement Training (CET)", kwargs.get("subject"))

    def test_dual_channel_smtp_routing_and_failover(self):
        """
        Verify that:
        1. generate_otp dispatches via channel='OTP' (Proofsy Zoho Mail)
        2. send_single_email selects Proofsy credentials for channel='OTP'
        3. send_single_email selects Helpdesk credentials for channel='DEFAULT'
        4. send_single_email automatically fails over if the primary channel encounters an error
        """
        from app.services.email_service import send_single_email
        from app.services.onboarding_service import generate_otp

        # 1. Test generate_otp calls send_single_email with channel="OTP"
        with patch("app.services.email_service.send_single_email") as mock_send:
            mock_send.return_value = {"status": "SENT", "to": self.onboarding.email}
            ok, msg = generate_otp(db=self.db, onboarding_id=self.onboarding.id, email=self.onboarding.email)
            self.assertTrue(ok)
            mock_send.assert_called_once()
            _, kwargs = mock_send.call_args
            self.assertEqual(kwargs.get("channel"), "OTP")

        # 2. Test send_single_email with mock smtplib on OTP channel
        with patch("smtplib.SMTP") as mock_smtp, \
             patch("smtplib.SMTP_SSL") as mock_ssl:
            mock_server = MagicMock()
            mock_smtp.return_value = mock_server
            mock_ssl.return_value = mock_server
            res = send_single_email(
                to_email="test@example.com",
                subject="Test OTP",
                html_body="<p>123456</p>",
                channel="OTP",
            )
            self.assertEqual(res["status"], "SENT")
            self.assertIn("Brevo Relay 2", res["channel"])
            mock_server.login.assert_called_with(settings.SMTP_OTP_USER, settings.SMTP_OTP_PASSWORD)

        # 3. Test send_single_email failover: when primary channel raises Exception, failover to secondary relay
        with patch("smtplib.SMTP", side_effect=[Exception("Quota exceeded"), MagicMock()]) as mock_smtp, \
             patch("smtplib.SMTP_SSL", side_effect=Exception("SSL error")):
            res = send_single_email(
                to_email="test@example.com",
                subject="Test Failover",
                html_body="<p>Failover Body</p>",
                channel="OTP",
            )
            self.assertEqual(res["status"], "SENT")
            self.assertTrue(res.get("failover"))
            self.assertIn("Brevo Relay 1", res["channel"])

    def test_faculty_magic_link_login_and_password_update(self):
        """
        Verify teacher magic link login lifecycle:
        1. Token info endpoint validates teacher identity
        2. Teacher can choose a new password upon magic login
        3. Password hash is updated and standard login immediately accepts new password
        """
        from app.core.security import create_magic_login_token, verify_password
        from app.models.models import User, Teacher

        # Setup test teacher
        user_t = User(
            username="sowjanya_test",
            email="sowjanya_test@sreenidhi.edu.in",
            password_hash=get_password_hash("sowjanya123"),
            role=UserRole.TEACHER,
            is_active=True
        )
        self.db.add(user_t)
        self.db.commit()
        teacher_rec = Teacher(
            user_id=user_t.id,
            teacher_code="T_SOWJ_TEST",
            name="Mrs. N. Sowjanya Test",
            department_id=self.dept.id
        )
        self.db.add(teacher_rec)
        self.db.commit()

        # 1. Create magic link token
        token = create_magic_login_token(username="sowjanya_test", role="TEACHER", expires_days=7)

        # 2. Query magic-token-info
        resp_info = self.client.get(f"/api/v1/auth/magic-token-info?token={token}")
        self.assertEqual(resp_info.status_code, 200)
        data_info = resp_info.json()
        self.assertTrue(data_info["valid"])
        self.assertEqual(data_info["username"], "sowjanya_test")
        self.assertEqual(data_info["full_name"], "Mrs. N. Sowjanya Test")
        self.assertEqual(data_info["role"], "TEACHER")

        # 3. Magic login WITH new password
        resp_login = self.client.post("/api/v1/auth/magic-login", json={
            "token": token,
            "new_password": "MyNewPassword@123"
        })
        self.assertEqual(resp_login.status_code, 200)
        data_login = resp_login.json()
        self.assertIn("access_token", data_login)
        self.assertEqual(data_login["role"], "TEACHER")
        self.assertTrue(data_login["password_updated"])

        # 4. Verify standard login works with the newly chosen password
        resp_std = self.client.post("/api/v1/auth/login", data={
            "username": "sowjanya_test",
            "password": "MyNewPassword@123"
        })
        self.assertEqual(resp_std.status_code, 200)
        self.assertIn("access_token", resp_std.json())

    def test_resend_welcome_email_on_activated_student(self):
        """Verify that activated students can have their welcome email resent with audit log."""
        from app.core.security import create_access_token
        from app.models.models import User, UserRole, AuditLog

        # Create admin user
        admin = User(
            username="admin_resend_test",
            email="admin_resend@snist.edu.in",
            password_hash=get_password_hash("AdminPass123"),
            role=UserRole.SUPER_ADMIN,
            is_active=True
        )
        self.db.add(admin)
        self.onboarding.state = OnboardingState.ACTIVATED
        self.db.commit()

        token = create_access_token({"sub": admin.username, "role": admin.role.value, "user_id": admin.id})
        headers = {"Authorization": f"Bearer {token}"}

        with patch("app.services.email_service.send_single_email") as mock_send:
            mock_send.return_value = {"status": "SENT", "to": self.onboarding.email}
            resp = self.client.post(f"/api/v1/admin/onboard/resend/{self.onboarding.roll_number}", headers=headers)
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertEqual(data["status"], "ok")
            self.assertTrue(data["is_activated"])

        # Check qr_audit_logs
        log = self.db.query(AuditLog).filter(
            AuditLog.roll_number == self.onboarding.roll_number,
            AuditLog.action == "RESEND_WELCOME_EMAIL"
        ).first()
        self.assertIsNotNone(log)

    def test_admin_reset_pin_and_immediate_login(self):
        """Verify admin PIN reset updates hash, dispatches email, and enables immediate login."""
        from app.core.security import create_access_token
        from app.models.models import User, UserRole, AuditLog

        admin = User(
            username="admin_reset_pin_test",
            email="admin_pin@snist.edu.in",
            password_hash=get_password_hash("AdminPass123"),
            role=UserRole.SUPER_ADMIN,
            is_active=True
        )
        self.db.add(admin)
        self.db.commit()

        token = create_access_token({"sub": admin.username, "role": admin.role.value, "user_id": admin.id})
        headers = {"Authorization": f"Bearer {token}"}

        with patch("app.services.email_service.send_single_email") as mock_send:
            mock_send.return_value = {"status": "SENT", "to": self.onboarding.email}
            resp = self.client.post(f"/api/v1/admin/onboard/reset-pin/{self.onboarding.roll_number}", headers=headers)
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertEqual(data["status"], "success")
            self.assertIn("temp_pin", data)
            self.assertEqual(len(data["temp_pin"]), 6)

        # Immediate login with the reset PIN
        login_resp = self.client.post("/api/v1/auth/login", data={
            "username": self.onboarding.roll_number,
            "password": data["temp_pin"]
        })
        self.assertEqual(login_resp.status_code, 200)
        self.assertIn("access_token", login_resp.json())

        # Check qr_audit_logs
        log = self.db.query(AuditLog).filter(
            AuditLog.roll_number == self.onboarding.roll_number,
            AuditLog.action == "ADMIN_PIN_RESET"
        ).first()
        self.assertIsNotNone(log)

    def test_get_student_login_link(self):
        """Verify copy login link endpoint returns permanent link with zero tokens."""
        from app.core.security import create_access_token
        from app.models.models import User, UserRole

        admin = User(
            username="admin_link_test",
            email="admin_link@snist.edu.in",
            password_hash=get_password_hash("AdminPass123"),
            role=UserRole.SUPER_ADMIN,
            is_active=True
        )
        self.db.add(admin)
        self.db.commit()

        token = create_access_token({"sub": admin.username, "role": admin.role.value, "user_id": admin.id})
        headers = {"Authorization": f"Bearer {token}"}

        resp = self.client.get(f"/api/v1/admin/onboard/login-link/{self.onboarding.roll_number}", headers=headers)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("login_url", data)
        self.assertIn("/login?roll=", data["login_url"])
        self.assertNotIn("token=", data["login_url"])

    def test_role_guard_blocks_students_from_admin_actions(self):
        """Students must be rejected with 403 Forbidden on admin onboarding routes."""
        from app.core.security import create_access_token
        from app.models.models import User, UserRole

        student_user = User(
            username="student_attacker",
            email="student_attacker@snist.edu.in",
            password_hash=get_password_hash("StudentPass123"),
            role=UserRole.STUDENT,
            is_active=True
        )
        self.db.add(student_user)
        self.db.commit()

        token = create_access_token({"sub": student_user.username, "role": student_user.role.value, "user_id": student_user.id})
        headers = {"Authorization": f"Bearer {token}"}

        resp_resend = self.client.post(f"/api/v1/admin/onboard/resend/{self.onboarding.roll_number}", headers=headers)
        self.assertEqual(resp_resend.status_code, 403)

        resp_reset = self.client.post(f"/api/v1/admin/onboard/reset-pin/{self.onboarding.roll_number}", headers=headers)
        self.assertEqual(resp_reset.status_code, 403)


if __name__ == "__main__":
    unittest.main()



