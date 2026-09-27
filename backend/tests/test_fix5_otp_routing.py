"""
FIX-5 Test Suite: Canonical Recipient Resolution, Audit Logging, Cooldown & Retry
Verifies:
1. roll 23311A0501 -> 23311a0501@cse.sreenidhi.edu.in
2. Bare / dev fallback recipients (alice, s1, demostudent, example.com) are rejected
3. 30s resend cooldown triggers HTTP 429 otp_cooldown with retry_after_s
4. Delivery attempts are logged to qr_otp_delivery_log table
5. Email masking preserves genuine domain (e.g. 2••••••1@cse.sreenidhi.edu.in)
6. 24h bounce suppression triggers HTTP 502
"""

import os
import sys
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch, MagicMock
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.main import app
from app.models.models import Base, Student, User, UserRole, OTPDeliveryLog

from app.services.email_service import (
    resolve_otp_recipient,
    is_banned_recipient,
    send_otp_with_retry_and_logging,
    OTPRecipientUnresolved
)
from app.api.binding import mask_email


class TestFix5OTPRouting(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(cls.engine)
        cls.Session = sessionmaker(bind=cls.engine)

    def setUp(self):
        self.db = self.Session()

    def tearDown(self):
        self.db.rollback()
        self.db.close()

    def test_01_canonical_roll_recipient_resolution(self):
        """T5: roll 23311A0501 -> 23311a0501@cse.sreenidhi.edu.in"""
        student = Student(id=1, roll_number="23311A0501", name="Test Student", email="random@test.com")
        recipient = resolve_otp_recipient(student)
        self.assertEqual(recipient, "23311a0501@cse.sreenidhi.edu.in")

    def test_02_fallback_to_student_email_if_no_roll(self):
        """When roll is absent, fallback to valid student.email"""
        student = Student(id=2, roll_number="", name="No Roll", email="valid_student@cse.sreenidhi.edu.in")
        recipient = resolve_otp_recipient(student)
        self.assertEqual(recipient, "valid_student@cse.sreenidhi.edu.in")

    def test_03_unresolved_raises_exception(self):
        """When neither roll nor email is valid, raises OTPRecipientUnresolved (no dev fallback)"""
        student = Student(id=3, roll_number="", name="Ghost", email="")
        with self.assertRaises(OTPRecipientUnresolved):
            resolve_otp_recipient(student)

    def test_04_banned_recipients_rejected(self):
        """CI gate: alice, s1, demostudent, example.com, bare usernames must be rejected"""
        self.assertTrue(is_banned_recipient("alice@sreenidhi.edu.in"))
        self.assertTrue(is_banned_recipient("s1@sreenidhi.edu.in"))
        self.assertTrue(is_banned_recipient("demostudent@sreenidhi.edu.in"))
        self.assertTrue(is_banned_recipient("user@example.com"))
        self.assertTrue(is_banned_recipient("bareusername"))
        self.assertFalse(is_banned_recipient("23311a0501@cse.sreenidhi.edu.in"))

    def test_05_email_masking_preserves_real_domain(self):
        """Modal masking must show 2••••••1@cse.sreenidhi.edu.in, never a fabricated domain"""
        masked = mask_email("23311a0501@cse.sreenidhi.edu.in")
        self.assertEqual(masked, "2••••••1@cse.sreenidhi.edu.in")

    @patch("app.services.email_service.send_single_email")
    def test_06_send_otp_success_and_cooldown(self, mock_send):
        """Successful send writes to qr_otp_delivery_log, then second send within 30s raises 429"""
        mock_send.return_value = {"status": "SENT", "message_id": "msg_12345"}
        student = Student(id=10, roll_number="23311A0510", name="Cooldown Test")
        self.db.add(student)
        self.db.commit()

        # First send -> should succeed
        res = send_otp_with_retry_and_logging(
            db=self.db,
            student=student,
            otp_code="123456",
            channel="EMAIL",
            enforce_cooldown=True
        )
        self.assertEqual(res["status"], "SENT")
        self.assertEqual(res["recipient"], "23311a0510@cse.sreenidhi.edu.in")

        # Verify DB log entry
        log = self.db.query(OTPDeliveryLog).filter(OTPDeliveryLog.student_id == 10).first()
        self.assertIsNotNone(log)
        self.assertEqual(log.status, "sent")
        self.assertEqual(log.recipient, "23311a0510@cse.sreenidhi.edu.in")

        # Second send immediately -> should trigger 429 otp_cooldown
        with self.assertRaises(HTTPException) as ctx:
            send_otp_with_retry_and_logging(
                db=self.db,
                student=student,
                otp_code="654321",
                channel="EMAIL",
                enforce_cooldown=True
            )
        self.assertEqual(ctx.exception.status_code, 429)
        self.assertEqual(ctx.exception.detail.get("error_code"), "otp_cooldown")
        self.assertGreaterEqual(ctx.exception.detail.get("retry_after_s"), 1)

    @patch("app.services.email_service.send_single_email")
    def test_07_bounce_suppression_window(self, mock_send):
        """Previously bounced recipient is suppressed for 24h with 502 otp_delivery_failed"""
        student = Student(id=20, roll_number="23311A0520", name="Bounce Test")
        self.db.add(student)
        # Add a bounced log in last 24 hours
        bounced_entry = OTPDeliveryLog(
            student_id=20,
            channel="EMAIL",
            recipient="23311a0520@cse.sreenidhi.edu.in",
            status="bounced",
            attempt=1,
            created_at=datetime.utcnow() - timedelta(hours=2)
        )
        self.db.add(bounced_entry)
        self.db.commit()

        with self.assertRaises(HTTPException) as ctx:
            send_otp_with_retry_and_logging(
                db=self.db,
                student=student,
                otp_code="999999",
                channel="EMAIL",
                enforce_cooldown=False
            )
        self.assertEqual(ctx.exception.status_code, 502)
        self.assertEqual(ctx.exception.detail.get("error_code"), "otp_delivery_failed")


if __name__ == "__main__":
    unittest.main()
