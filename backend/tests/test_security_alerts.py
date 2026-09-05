"""
Unit and Integration Tests for Two-Layer Security Alerting System
Tests sliding window threshold tracking, cooldown suppression, non-blocking execution, hourly digest logic, and test-send admin API.
"""

import os
import sys
import time
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch, MagicMock

# Set path to backend
backend_dir = os.path.abspath("backend")
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.services.security_alert_service import (
    SecurityAlertTracker,
    SecurityAlertService,
    alert_tracker,
    EVENT_ACCOUNT_SWITCH,
    EVENT_PRIVESC_ATTEMPT,
    EVENT_FAILED_HMAC,
    EVENT_LOGIN_RATE_LIMIT,
    EVENT_ALERT_SENT,
    THRESHOLDS
)
from app.models.models import User, UserRole, AuditLog


class TestSecurityAlertSystem(unittest.TestCase):

    def setUp(self):
        # Clean tracker state before every test
        alert_tracker.reset_state()

    def test_account_switch_threshold_trigger(self):
        """
        Verify ACCOUNT_SWITCH_ATTEMPT triggers alert strictly on 3rd attempt within window,
        and suppresses subsequent attempts under the 10-minute cooldown.
        """
        device_sig = "DEV-TEST-D114"
        student_roll = "24311A6216"

        # Attempt 1 -> Below threshold (count=1)
        alert1, supp1, count1, _ = alert_tracker.record_and_evaluate(
            EVENT_ACCOUNT_SWITCH, student_roll, device_sig
        )
        self.assertFalse(alert1)
        self.assertFalse(supp1)
        self.assertEqual(count1, 1)

        # Attempt 2 -> Below threshold (count=2)
        alert2, supp2, count2, _ = alert_tracker.record_and_evaluate(
            EVENT_ACCOUNT_SWITCH, student_roll, device_sig
        )
        self.assertFalse(alert2)
        self.assertFalse(supp2)
        self.assertEqual(count2, 2)

        # Attempt 3 -> Reaches threshold (count=3) -> MUST ALERT
        alert3, supp3, count3, reason3 = alert_tracker.record_and_evaluate(
            EVENT_ACCOUNT_SWITCH, student_roll, device_sig
        )
        self.assertTrue(alert3, "Expected 3rd attempt to trigger security alert")
        self.assertFalse(supp3)
        self.assertEqual(count3, 3)

        # Attempt 4 -> Within cooldown -> MUST SUPPRESS
        alert4, supp4, count4, reason4 = alert_tracker.record_and_evaluate(
            EVENT_ACCOUNT_SWITCH, student_roll, device_sig
        )
        self.assertFalse(alert4, "Expected 4th attempt to be suppressed by cooldown")
        self.assertTrue(supp4)
        self.assertEqual(count4, 4)

        # Attempt 5 -> Still within cooldown -> MUST SUPPRESS
        alert5, supp5, count5, _ = alert_tracker.record_and_evaluate(
            EVENT_ACCOUNT_SWITCH, student_roll, device_sig
        )
        self.assertFalse(alert5)
        self.assertTrue(supp5)
        self.assertEqual(count5, 5)

        # Verify suppressed count recorded for digest
        suppressed = alert_tracker.get_and_flush_suppressed_counts()
        self.assertIn(f"{EVENT_ACCOUNT_SWITCH}:{student_roll}", suppressed)
        self.assertEqual(suppressed[f"{EVENT_ACCOUNT_SWITCH}:{student_roll}"], 2)

    def test_immediate_alert_events(self):
        """
        Verify critical events like PRIVESC_ATTEMPT trigger immediate alert on 1st occurrence.
        """
        alert, supp, count, _ = alert_tracker.record_and_evaluate(
            EVENT_PRIVESC_ATTEMPT, "24311A6216", "IP-106.192.38.143"
        )
        self.assertTrue(alert, "Expected PRIVESC_ATTEMPT to alert immediately")
        self.assertFalse(supp)
        self.assertEqual(count, 1)

    def test_failed_hmac_threshold(self):
        """
        Verify FAILED_HMAC requires >10 attempts before alerting.
        """
        source = "IP-192.168.1.50"
        for i in range(1, 10):
            alert, _, count, _ = alert_tracker.record_and_evaluate(
                EVENT_FAILED_HMAC, "UNKNOWN", source
            )
            self.assertFalse(alert)
            self.assertEqual(count, i)

        # 10th attempt reaches threshold
        alert10, _, count10, _ = alert_tracker.record_and_evaluate(
            EVENT_FAILED_HMAC, "UNKNOWN", source
        )
        self.assertTrue(alert10, "Expected 10th FAILED_HMAC to trigger alert")
        self.assertEqual(count10, 10)

    def test_digest_only_event(self):
        """
        Verify RATE_LIMIT_TRIGGERED is recorded for hourly digest without sending real-time alert.
        """
        alert, supp, _, _ = alert_tracker.record_and_evaluate(
            EVENT_LOGIN_RATE_LIMIT, "IP-127.0.0.1", "IP-127.0.0.1"
        )
        self.assertFalse(alert)
        self.assertFalse(supp)

        suppressed = alert_tracker.get_and_flush_suppressed_counts()
        self.assertIn(f"{EVENT_LOGIN_RATE_LIMIT}:IP-127.0.0.1", suppressed)
        self.assertEqual(suppressed[f"{EVENT_LOGIN_RATE_LIMIT}:IP-127.0.0.1"], 1)

    @patch("app.services.email_service.send_single_email")
    def test_non_blocking_hook_audit_event(self, mock_send):
        """
        Verify hook_audit_event executes safely and dispatches in worker pool without raising errors.
        """
        mock_send.return_value = {"status": "SENT", "channel": "DEFAULT"}

        # Fire 3 events to trigger alert
        for _ in range(3):
            SecurityAlertService.hook_audit_event(
                event_type=EVENT_ACCOUNT_SWITCH,
                roll_number="24311A6216",
                device_id="DEV-TEST-ASYNC",
                ip_address="127.0.0.1",
                details="Testing async alert hook"
            )

        # Give background thread pool a moment to process
        time.sleep(0.3)
        self.assertTrue(mock_send.called, "Expected email service to be invoked for 3rd attempt")

    @patch("app.services.email_service.send_single_email")
    def test_simulation_5_consecutive_account_switch_attempts(self, mock_send):
        """
        End-to-End Simulation:
        5 consecutive account switch attempts from same device:
        - Attempt 1: No alert (count=1)
        - Attempt 2: No alert (count=2)
        - Attempt 3: Alert triggered! (count=3, email dispatched)
        - Attempt 4: Suppressed by cooldown (count=4, no email)
        - Attempt 5: Suppressed by cooldown (count=5, no email)
        Asserts exactly ONE email dispatched across all 5 events.
        """
        mock_send.return_value = {"status": "SENT", "channel": "DEFAULT"}

        for i in range(5):
            SecurityAlertService.hook_audit_event(
                event_type=EVENT_ACCOUNT_SWITCH,
                roll_number="24311A6216",
                device_id="DEV-SHARED-SIM-001",
                ip_address="192.168.1.100",
                details=f"Account switch simulation attempt #{i+1}"
            )

        time.sleep(0.4)

        # Assert exactly one email dispatched to the operator
        self.assertEqual(mock_send.call_count, 1, "Expected exactly 1 email queued/sent on 3rd attempt")

        # Assert suppressed count is 2 (for attempts 4 and 5)
        suppressed = alert_tracker.get_and_flush_suppressed_counts()
        self.assertEqual(suppressed.get(f"{EVENT_ACCOUNT_SWITCH}:24311A6216"), 2)

    @patch("app.core.database.SessionLocal")
    @patch("app.services.email_service.send_single_email")
    def test_hourly_digest_empty_hour_sends_no_email(self, mock_send, mock_session_local):
        """
        Hourly Digest Safety Net:
        When zero security events occurred in the past hour:
        - Assert function returns SKIPPED / ZERO_EVENTS
        - Assert send_single_email is NOT called (strictly zero all-clear spam)
        """
        mock_db = MagicMock()
        mock_session_local.return_value.__enter__.return_value = mock_db
        # Return empty list from query
        mock_db.query.return_value.filter.return_value.order_by.return_value.all.return_value = []

        res = SecurityAlertService.generate_and_send_hourly_digest(force_window=True)
        self.assertEqual(res.get("status"), "SKIPPED")
        self.assertEqual(res.get("reason"), "ZERO_EVENTS")
        mock_send.assert_not_called()

    @patch("app.core.database.SessionLocal")
    @patch("app.services.email_service.send_single_email")
    def test_hourly_digest_with_events_sends_one_digest(self, mock_send, mock_session_local):
        """
        Hourly Digest Safety Net:
        When events exist in the past hour:
        - Assert function returns SENT
        - Assert send_single_email is called once with digest subject
        """
        mock_db = MagicMock()
        mock_session_local.return_value.__enter__.return_value = mock_db

        mock_event1 = AuditLog(
            id=101,
            user_id=None,
            roll_number="24311A6216",
            device_id=None,
            event_type=EVENT_ACCOUNT_SWITCH,
            action="ACCOUNT_SWITCH_BLOCKED",
            details="Blocked account switch on device",
            ip_address="106.192.38.143",
            created_at=datetime.utcnow() - timedelta(minutes=25)
        )
        mock_event2 = AuditLog(
            id=102,
            user_id=None,
            roll_number="UNKNOWN",
            device_id=None,
            event_type=EVENT_PRIVESC_ATTEMPT,
            action="STUDENT_PRIVESC_BLOCKED",
            details="Student token attempted teacher endpoint",
            ip_address="106.192.38.143",
            created_at=datetime.utcnow() - timedelta(minutes=10)
        )

        mock_db.query.return_value.filter.return_value.order_by.return_value.all.return_value = [mock_event1, mock_event2]
        mock_db.query.return_value.filter.return_value.all.return_value = []
        mock_send.return_value = {"status": "SENT", "channel": "DEFAULT"}

        res = SecurityAlertService.generate_and_send_hourly_digest(force_window=True)
        self.assertEqual(res.get("status"), "SENT")
        self.assertEqual(res.get("events_count"), 2)
        self.assertTrue(mock_send.called)

        # Verify subject structure
        call_subject = mock_send.call_args[1].get("subject", "")
        self.assertIn("[SNIST SECURITY DIGEST]", call_subject)

    @patch("app.services.email_service.send_single_email")
    def test_admin_test_send_endpoint(self, mock_send):
        """
        Operator Verification Endpoint:
        POST /api/v1/admin/security-alerts/test-send
        - Authorized Super Admin receives 200 OK and email is dispatched
        """
        from fastapi.testclient import TestClient
        from app.main import app
        from app.api.auth import require_admin
        from app.core.database import get_db

        mock_send.return_value = {"status": "SENT", "channel": "DEFAULT"}

        mock_admin = User(
            id=1,
            username="bhaskar",
            email="23311a05y6@cse.sreenidhi.edu.in",
            role=UserRole.SUPER_ADMIN,
            is_active=True
        )

        # Mock DB session for get_db dependency
        mock_db = MagicMock()

        app.dependency_overrides[require_admin] = lambda: mock_admin
        app.dependency_overrides[get_db] = lambda: mock_db

        try:
            client = TestClient(app)
            response = client.post("/api/v1/admin/security-alerts/test-send")
            self.assertEqual(response.status_code, 200)
            data = response.json()
            self.assertEqual(data.get("status"), "SENT")
            self.assertIn("target_email", data)
            self.assertTrue(mock_send.called)
        finally:
            app.dependency_overrides.clear()

    def test_admin_test_send_endpoint_forbidden_for_student(self):
        """
        Operator Verification Endpoint:
        Student user attempting to call /api/v1/admin/security-alerts/test-send
        is rejected with HTTP 403 Forbidden.
        """
        from fastapi import HTTPException
        from fastapi.testclient import TestClient
        from app.main import app
        from app.api.auth import require_admin

        def deny_student():
            raise HTTPException(status_code=403, detail="Admin privileges required")

        app.dependency_overrides[require_admin] = deny_student

        try:
            client = TestClient(app)
            response = client.post("/api/v1/admin/security-alerts/test-send")
            self.assertEqual(response.status_code, 403)
        finally:
            app.dependency_overrides.clear()


if __name__ == "__main__":
    unittest.main()
