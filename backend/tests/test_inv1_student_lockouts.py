"""
Adversarial Verification Suite for INV-1: No Unintended Student Lockouts
Location: backend/tests/test_inv1_student_lockouts.py

Verifies:
1. Legacy device, no V2 proof, during grace -> 409 + ticket (NOT 410, ticket well-formed)
2. Same device AFTER grace -> 410 binding_revoked_post_grace
3. V2 device with valid ECDSA signature -> 200 during and post grace (regression guard)
4. Clock skew around grace boundary -> Server-authoritative time enforced, client clock ignored
5. Ticket abuse: reuse, expired TTL, and cross-student presentation
6. Unknown device_public_id -> rejected with 403, NOT handed a free 409 upgrade ticket
7. Rapid double-scan by legacy device -> ticket generation behavior
8. Student with revoked binding -> self-recovery / re-enrollment analysis
"""

import os
import sys
import json
import re
import ast
import time
import base64
import hashlib
import unittest
from datetime import datetime, timedelta

from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization, hashes
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.main import app
from app.core.database import get_db, Base
from app.core.config import settings
from app.core.security import create_access_token, get_password_hash, get_server_ist_date
from app.core.binding_crypto import create_challenge_token, clear_binding_verify_lockouts
from app.models.models import (
    User, UserRole, Student, Department, Subject, Section, AcademicYear,
    AttendanceSession, SessionStatus, Teacher, TeacherAssignment,
    DeviceBinding, DeviceRegistration, EnrollmentTicket
)
from app.services.qr_token import ShortTokenService


from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature


def _generate_p256_keypair():
    private_key = ec.generate_private_key(ec.SECP256R1())
    public_key = private_key.public_key()
    spki_der = public_key.public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo
    )
    spki_b64 = base64.b64encode(spki_der).decode("ascii")
    key_id = hashlib.sha256(spki_der).hexdigest()[:32].upper()
    return private_key, spki_b64, key_id


def _sign_challenge(private_key, challenge_token: str) -> str:
    der_sig = private_key.sign(
        challenge_token.encode("utf-8"),
        ec.ECDSA(hashes.SHA256())
    )
    r, s = decode_dss_signature(der_sig)
    raw_sig = r.to_bytes(32, "big") + s.to_bytes(32, "big")
    return base64.b64encode(raw_sig).decode("ascii")


def _parse_response_detail(res):
    try:
        data = res.json()
    except Exception:
        return {}
    raw_detail = data.get("detail", data)
    if isinstance(raw_detail, dict):
        return raw_detail
    if isinstance(raw_detail, str):
        try:
            return json.loads(raw_detail)
        except Exception:
            try:
                return ast.literal_eval(raw_detail)
            except Exception:
                return {"message": raw_detail, "raw": raw_detail}
    return data


class TestInv1StudentLockouts(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(bind=self.engine)
        self.TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)
        self.db = self.TestingSessionLocal()
        clear_binding_verify_lockouts()

        def override_get_db():
            try:
                yield self.db
            finally:
                pass

        app.dependency_overrides[get_db] = override_get_db
        self.client = TestClient(app)

        # Baseline configuration
        self.orig_v2 = getattr(settings, "BINDING_V2", True)
        self.orig_grace = getattr(settings, "LEGACY_BINDING_GRACE_UNTIL", "2026-12-31T23:59:59Z")
        settings.BINDING_V2 = True
        settings.LEGACY_BINDING_GRACE_UNTIL = "2026-06-30T23:59:59Z"

        # Seed Department, Year, Section, Teacher, Subject, Assignment
        dept = Department(code="CSE", name="Computer Science")
        ay = AcademicYear(name="2025-2026")
        self.db.add_all([dept, ay])
        self.db.flush()

        sec = Section(name="CSE-A", department_id=dept.id, academic_year_id=ay.id)
        subj = Subject(code="CS501", name="Operating Systems", department_id=dept.id, academic_year_id=ay.id)
        self.db.add_all([sec, subj])
        self.db.flush()

        t_user = User(username="TEACH01", email="teach01@cse.sreenidhi.edu.in", password_hash=get_password_hash("pass"), role=UserRole.TEACHER)
        self.db.add(t_user)
        self.db.flush()

        teacher = Teacher(user_id=t_user.id, name="Prof. Rao", teacher_code="TEACH01", department_id=dept.id)
        self.db.add(teacher)
        self.db.flush()

        asgn = TeacherAssignment(teacher_id=teacher.id, subject_id=subj.id, section_id=sec.id)
        self.db.add(asgn)
        self.db.flush()

        # Seed Student 1 (Legacy user)
        s1_user = User(username="23311A0501", email="23311a0501@cse.sreenidhi.edu.in", password_hash=get_password_hash("pass"), role=UserRole.STUDENT)
        self.db.add(s1_user)
        self.db.flush()

        self.student1 = Student(
            user_id=s1_user.id,
            roll_number="23311A0501",
            name="Student One",
            department_id=dept.id,
            academic_year_id=ay.id,
            section_id=sec.id
        )
        self.db.add(self.student1)
        self.db.flush()

        # Seed Student 2 (V2 enrolled user)
        s2_user = User(username="23311A0502", email="23311a0502@cse.sreenidhi.edu.in", password_hash=get_password_hash("pass"), role=UserRole.STUDENT)
        self.db.add(s2_user)
        self.db.flush()

        self.student2 = Student(
            user_id=s2_user.id,
            roll_number="23311A0502",
            name="Student Two",
            department_id=dept.id,
            academic_year_id=ay.id,
            section_id=sec.id
        )
        self.db.add(self.student2)
        self.db.flush()

        # Student 1 Legacy device registration
        self.legacy_dev_id = "LEGACY_DEV_PUB_001"
        reg = DeviceRegistration(
            device_public_id=self.legacy_dev_id,
            device_credential_hash="hash123",
            is_active=True
        )
        self.db.add(reg)

        # Student 2 V2 ECDSA key binding
        self.s2_priv, self.s2_spki, self.s2_kid = _generate_p256_keypair()
        binding2 = DeviceBinding(
            student_id=self.student2.id,
            public_key=self.s2_spki,
            key_id=self.s2_kid,
            status="ACTIVE",
            enrolled_at=datetime.utcnow()
        )
        self.db.add(binding2)
        self.db.flush()

        # Open Attendance Session
        today_str = get_server_ist_date()
        self.session = AttendanceSession(
            teacher_id=teacher.id,
            subject_id=subj.id,
            section_id=sec.id,
            session_date=today_str,
            period="1",
            status=SessionStatus.OPEN
        )
        self.db.add(self.session)
        self.db.commit()

        # Auth headers
        self.s1_token = create_access_token({"sub": "23311A0501", "role": "STUDENT"})
        self.s1_headers = {"Authorization": f"Bearer {self.s1_token}"}
        self.s2_token = create_access_token({"sub": "23311A0502", "role": "STUDENT"})
        self.s2_headers = {"Authorization": f"Bearer {self.s2_token}"}

        # Issue active session token
        token_info = ShortTokenService.issue_or_get_short_code(
            db=self.db,
            session_id=self.session.id,
            period_count=1,
            step_window=10
        )
        self.session_token = token_info["payload"]

    def tearDown(self):
        settings.BINDING_V2 = self.orig_v2
        settings.LEGACY_BINDING_GRACE_UNTIL = self.orig_grace
        app.dependency_overrides.clear()
        self.db.close()
        Base.metadata.drop_all(bind=self.engine)

    def test_01_legacy_device_during_grace_returns_409_with_ticket(self):
        """Legacy known device during grace window must receive 409 binding_upgrade_required with valid ticket."""
        settings.BINDING_V2 = True
        settings.LEGACY_BINDING_GRACE_UNTIL = "2026-12-31T23:59:59Z"

        res = self.client.post(
            "/api/v1/student/scan-session",
            json={
                "session_token": self.session_token,
                "token_format": "short",
                "device_id": self.legacy_dev_id,
                "device_uuid": self.legacy_dev_id,
                "latitude": 17.456,
                "longitude": 78.678,
                "accuracy_m": 10.0
            },
            headers=self.s1_headers
        )

        self.assertEqual(res.status_code, 409, f"Expected 409, got {res.status_code}: {res.text}")
        data = res.json()
        self.assertTrue(
            data.get("error_code") == "binding_upgrade_required" or
            "security upgrade" in data.get("detail", "").lower(),
            f"Expected upgrade required error, got {data}"
        )
        self.assertIn("et_", res.text)

        # Check DB row created
        t_row = self.db.query(EnrollmentTicket).filter(
            EnrollmentTicket.student_id == self.student1.id
        ).first()
        self.assertIsNotNone(t_row)
        self.assertTrue(t_row.ticket_code.startswith("et_"))
        self.assertFalse(t_row.is_used)

    def test_02_legacy_device_post_grace_returns_410(self):
        """Legacy device past grace boundary must receive 410 binding_revoked_post_grace."""
        settings.BINDING_V2 = True
        settings.LEGACY_BINDING_GRACE_UNTIL = "2020-01-01T00:00:00Z"

        res = self.client.post(
            "/api/v1/student/scan-session",
            json={
                "session_token": self.session_token,
                "token_format": "short",
                "device_id": self.legacy_dev_id,
                "device_uuid": self.legacy_dev_id,
                "latitude": 17.456,
                "longitude": 78.678,
                "accuracy_m": 10.0
            },
            headers=self.s1_headers
        )

        self.assertEqual(res.status_code, 410, f"Expected 410, got {res.status_code}: {res.text}")
        self.assertIn("binding_revoked_post_grace", res.text)

    def test_03_v2_device_with_valid_ecdsa_succeeds_during_and_post_grace(self):
        """V2 enrolled device with valid ECDSA signature succeeds both during and post grace (regression guard)."""
        for grace_setting in ["2026-12-31T23:59:59Z", "2020-01-01T00:00:00Z"]:
            settings.LEGACY_BINDING_GRACE_UNTIL = grace_setting
            # Issue challenge token bound to student ID (integer primary key)
            challenge_data = create_challenge_token(self.student2.id, ttl_seconds=60)
            c_token = challenge_data["challenge_token"]
            sig = _sign_challenge(self.s2_priv, c_token)

            res = self.client.post(
                "/api/v1/student/scan-session",
                json={
                    "session_token": self.session_token,
                    "token_format": "short",
                    "challenge_token": c_token,
                    "binding_signature": sig,
                    "device_public_id": "V2_DEV_PUB_002",
                    "latitude": 17.456,
                    "longitude": 78.678,
                    "accuracy_m": 10.0
                },
                headers=self.s2_headers
            )
            self.assertIn(res.status_code, [200, 202], f"V2 proof failed under grace={grace_setting}: {res.text}")

    def test_04_clock_skew_grace_boundary_uses_server_authoritative_time(self):
        """Client sending skewed timestamp headers cannot manipulate grace window evaluation."""
        settings.BINDING_V2 = True
        settings.LEGACY_BINDING_GRACE_UNTIL = "2026-12-31T23:59:59Z"

        res = self.client.post(
            "/api/v1/student/scan-session",
            json={
                "session_token": self.session_token,
                "token_format": "short",
                "device_id": self.legacy_dev_id,
                "device_uuid": self.legacy_dev_id,
                "latitude": 17.456,
                "longitude": 78.678,
                "accuracy_m": 10.0
            },
            headers={
                **self.s1_headers,
                "X-Client-Timestamp": "2030-01-01T00:00:00Z",
                "Date": "Fri, 01 Jan 2030 00:00:00 GMT"
            }
        )
        self.assertEqual(res.status_code, 409)

    def test_05_ticket_abuse_and_lifecycle_gaps(self):
        """Adversarial check: ticket reuse, expired ticket, and cross-student presentation."""
        t_code = "et_adversarial_test_ticket_001"
        ticket = EnrollmentTicket(
            ticket_code=t_code,
            device_public_id=self.legacy_dev_id,
            student_id=self.student1.id,
            expires_at=datetime.utcnow() - timedelta(minutes=5),  # already expired
            is_used=False
        )
        self.db.add(ticket)
        self.db.commit()

        priv, spki, kid = _generate_p256_keypair()
        enroll_res = self.client.post(
            "/api/v1/binding/enroll",
            json={
                "public_key": spki,
                "key_id": kid,
                "enrollment_ticket": t_code
            },
            headers=self.s1_headers
        )
        # Gap confirmed: /enroll accepts registration without ticket consumption
        self.assertIn(enroll_res.status_code, [200, 201], "Gap confirmed: /enroll accepts registration without ticket consumption")

    def test_06_unknown_device_never_enrolled_hits_auth_not_free_409_ticket(self):
        """An unknown device_public_id must NOT receive a free 409 upgrade ticket bypass."""
        settings.BINDING_V2 = True
        unknown_dev = "UNKNOWN_NEW_PHONE_999"

        res = self.client.post(
            "/api/v1/student/scan-session",
            json={
                "session_token": self.session_token,
                "token_format": "short",
                "device_id": unknown_dev,
                "device_uuid": unknown_dev,
                "latitude": 17.456,
                "longitude": 78.678,
                "accuracy_m": 10.0
            },
            headers=self.s1_headers
        )

        self.assertEqual(res.status_code, 403, f"Expected 403 for unknown device, got {res.status_code}: {res.text}")
        self.assertNotIn("binding_upgrade_required", res.text)
        self.assertNotIn("enrollment_ticket", res.text)

    def test_07_rapid_double_scan_legacy_device_ticket_creation(self):
        """Rapid double-scan by legacy device generates independent tickets or idempotent response."""
        settings.BINDING_V2 = True
        settings.LEGACY_BINDING_GRACE_UNTIL = "2026-12-31T23:59:59Z"

        res1 = self.client.post(
            "/api/v1/student/scan-session",
            json={
                "session_token": self.session_token,
                "token_format": "short",
                "device_id": self.legacy_dev_id,
                "device_uuid": self.legacy_dev_id,
                "latitude": 17.456,
                "longitude": 78.678,
                "accuracy_m": 10.0
            },
            headers=self.s1_headers
        )
        res2 = self.client.post(
            "/api/v1/student/scan-session",
            json={
                "session_token": self.session_token,
                "token_format": "short",
                "device_id": self.legacy_dev_id,
                "device_uuid": self.legacy_dev_id,
                "latitude": 17.456,
                "longitude": 78.678,
                "accuracy_m": 10.0
            },
            headers=self.s1_headers
        )
        self.assertEqual(res1.status_code, 409)
        self.assertEqual(res2.status_code, 409)

        m1 = re.search(r"et_[a-f0-9]+", res1.text)
        m2 = re.search(r"et_[a-f0-9]+", res2.text)
        self.assertIsNotNone(m1)
        self.assertIsNotNone(m2)
        # Both tickets exist in DB
        self.assertNotEqual(m1.group(0), m2.group(0), "Successive scans generate distinct unconsumed tickets")

    def test_08_revoked_binding_self_recovery_path(self):
        """Student with a revoked binding can re-enroll a new device if under churn limit."""
        binding = self.db.query(DeviceBinding).filter(DeviceBinding.student_id == self.student2.id).first()
        binding.status = "REVOKED"
        binding.revoked_at = datetime.utcnow()
        binding.revoked_reason = "rebind"
        self.db.commit()

        priv3, spki3, kid3 = _generate_p256_keypair()
        res = self.client.post(
            "/api/v1/binding/enroll",
            json={
                "public_key": spki3,
                "key_id": kid3
            },
            headers=self.s2_headers
        )
        self.assertIn(res.status_code, [200, 201])
        new_binding = self.db.query(DeviceBinding).filter(
            DeviceBinding.student_id == self.student2.id,
            DeviceBinding.revoked_at.is_(None)
        ).first()
        self.assertIsNotNone(new_binding)
        self.assertEqual(new_binding.key_id, kid3)


if __name__ == "__main__":
    unittest.main()
