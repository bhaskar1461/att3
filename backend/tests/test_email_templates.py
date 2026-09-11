"""
Pytest: Email Template Existence & Dry-Render Verification
WHY: Prevents deploying a build where any email template is missing or syntactically broken.
Mirrors the startup guard logic so CI catches issues before they reach production.
"""

import os
import sys
import unittest

# Ensure backend is on sys.path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.core.config import settings
from app.services.email_service import render_email_template


# Every template referenced in the codebase with minimal sample context for dry-render
REQUIRED_TEMPLATES = {
    "security_alert_email.html": {
        "event_title": "TEST", "event_type": "TEST", "severity": "LOW",
        "subject_id": "TEST", "source_id": "TEST", "trigger_reason": "Pytest dry-render",
        "client_ip": "127.0.0.1", "audit_id": 0, "details": "Dry render",
        "recommended_action": "None", "timestamp_ist": "01-Jan-2026 00:00:00",
        "admin_url": "https://ather-os.de5.net/admin",
    },
    "security_digest_email.html": {
        "window_start_ist": "09:00", "window_end_ist": "10:00",
        "total_events": 0, "alerts_dispatched": 0, "suppressed_count": 0,
        "events": [], "suppressed_items": {},
        "admin_url": "https://ather-os.de5.net/admin",
    },
    "disciplinary_security_warning_email.html": {
        "student_name": "TEST", "roll_number": "TEST", "event_type": "TEST",
        "details": "Dry render", "timestamp_ist": "01-Jan-2026 00:00:00",
        "admin_url": "https://ather-os.de5.net/admin",
    },
    "magic_link_email.html": {
        "student_name": "TEST", "magic_link": "https://example.com",
        "expiry_hours": 48, "otp": "000000", "roll_number": "TEST",
    },
    "otp_email.html": {
        "student_name": "TEST", "otp": "000000", "expiry_minutes": 10,
    },
    "student_credentials_email.html": {
        "name": "TEST", "sap_id": "TEST", "username": "TEST",
        "password": "TEST", "portal_url": "https://example.com",
    },
    "teacher_credentials_email.html": {
        "name": "TEST", "sap_id": "TEST", "username": "TEST",
        "password": "TEST", "portal_url": "https://example.com",
    },
    "teacher_class_allotment_email.html": {
        "teacher_name": "TEST", "teacher_username": "TEST", "default_password": "TEST",
        "magic_login_url": "https://example.com", "class_name": "TEST",
        "class_code": "TEST", "department": "TEST", "section": "TEST",
        "student_count": 0, "next_class_date": "TEST", "weekly_schedule": "TEST",
        "timings": "TEST", "venue": "TEST", "portal_url": "https://example.com",
        "trigger_type": "PYTEST_CHECK", "support_email": "test@test.com",
    },
}


class TestEmailTemplates(unittest.TestCase):
    """Verifies all email templates exist and render without errors."""

    def test_template_directory_exists(self):
        """EMAIL_TEMPLATE_DIR must point to an existing directory."""
        self.assertTrue(
            os.path.isdir(settings.EMAIL_TEMPLATE_DIR),
            f"EMAIL_TEMPLATE_DIR does not exist: {settings.EMAIL_TEMPLATE_DIR}"
        )

    def test_template_directory_is_in_app_tree(self):
        """Templates must live inside the versioned app/ tree, not in data/."""
        # WHY: data/ is runtime storage and may be overwritten by volume mounts
        normalized = os.path.normpath(settings.EMAIL_TEMPLATE_DIR)
        self.assertIn(
            os.sep + "app" + os.sep,
            normalized,
            f"EMAIL_TEMPLATE_DIR should be inside app/ tree, got: {normalized}"
        )

    def test_all_templates_exist(self):
        """Every referenced template file must exist on disk."""
        for tmpl_name in REQUIRED_TEMPLATES:
            tmpl_path = os.path.join(settings.EMAIL_TEMPLATE_DIR, tmpl_name)
            self.assertTrue(
                os.path.isfile(tmpl_path),
                f"Template file missing: {tmpl_name} (expected at {tmpl_path})"
            )

    def test_all_templates_dry_render(self):
        """Every template must render with sample context without producing error output."""
        for tmpl_name, sample_ctx in REQUIRED_TEMPLATES.items():
            with self.subTest(template=tmpl_name):
                rendered = render_email_template(tmpl_name, sample_ctx)
                self.assertNotIn(
                    "Template rendering error",
                    rendered,
                    f"Template '{tmpl_name}' dry-render produced error output"
                )
                self.assertNotIn(
                    "Template rendering unavailable",
                    rendered,
                    f"Jinja2 not installed — cannot render '{tmpl_name}'"
                )
                # Must produce non-trivial HTML
                self.assertGreater(
                    len(rendered), 100,
                    f"Template '{tmpl_name}' rendered suspiciously short output ({len(rendered)} chars)"
                )

    def test_no_host_absolute_paths_in_config(self):
        """EMAIL_TEMPLATE_DIR must not contain host-absolute production paths."""
        # WHY: Prevents the exact bug we're fixing — hardcoded /home/azureuser/... paths
        dir_path = settings.EMAIL_TEMPLATE_DIR
        self.assertNotIn("/home/azureuser", dir_path, "Host-absolute VM path leaked into config")
        self.assertNotIn("/home/", dir_path, "Host-absolute path leaked into config")


if __name__ == "__main__":
    unittest.main()
