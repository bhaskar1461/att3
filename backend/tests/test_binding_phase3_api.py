"""
Comprehensive Test Suite: Binding Phase 3 API Service
Focus:
1. Feature Flag Gating (BINDING_V2=off -> 404, on -> active)
2. POST /binding/enroll: Happy path, idempotent refresh, rebind friction (OTP), rate limits
3. POST /binding/challenge: Signed HMAC token, freshness, single-use
4. POST /binding/verify: Sub-ms P-256 verification, replay prevention, expiry, lockout
5. POST /binding/admin/revoke/{student_id}: Admin reset (churn budget exempt)
6. GET /binding/admin/churn-anomalies: Churn reporting
7. Audit trail string inspection: Zero key material in audit logs
"""

import os
import time
import base64
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.core.database import Base, get_db
from app.core.security import get_password_hash, create_access_token
from app.core.binding_crypto import (
    create_challenge_token,
    clear_binding_verify_lockouts,
    _CONSUMED_NONCES
)
from app.models.models import (
    User, UserRole, Student, Department, AcademicYear, Section,
    DeviceBinding, DeviceRebindOTP, AuditLog, RevokedReason
)
from app.main import app


def _generate_p256_keypair():
    """Helper to generate a real P-256 ECDSA keypair and return (private_key, spki_b64)."""
    private_key = ec.generate_private_key(ec.SECP256R1())
    public_key = private_key.public_key()
    spki_der = public_key.public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo
    )
    spki_b64 = base64.b64encode(spki_der).decode("ascii")
    return private_key, spki_b64


def _sign_challenge_p1363(private_key, challenge_str: str) -> str:
    """Helper to produce IEEE P1363 raw 64-byte signature Base64 (matching WebCrypto API)."""
    der_sig = private_key.sign(challenge_str.encode("utf-8"), ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der_sig)
    raw_sig = r.to_bytes(32, "big") + s.to_bytes(32, "big")
    return base64.b64encode(raw_sig).decode("ascii")


class TestBindingPhase3API(unittest.TestCase):

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

        # Clear in-memory replay cache and lockouts
        _CONSUMED_NONCES.clear()
        clear_binding_verify_lockouts()

        # Seed test master data
        dept = Department(code="CSE", name="Computer Science")
        self.db.add(dept)
        self.db.commit()

        # Student 1 User + Profile
        self.u1 = User(
            username="23311A05Y1",
            email="s1@sreenidhi.edu.in",
            password_hash=get_password_hash("pass123"),
            role=UserRole.STUDENT,
            is_active=True
        )
        self.db.add(self.u1)
        self.db.commit()

        self.s1 = Student(
            user_id=self.u1.id,
            roll_number="23311A05Y1",
            name="Student One",
            email="s1@sreenidhi.edu.in",
            department_id=dept.id,
            agency="Regular"
        )
        self.db.add(self.s1)

        # Student 2 User + Profile
        self.u2 = User(
            username="23311A05Y2",
            email="s2@sreenidhi.edu.in",
            password_hash=get_password_hash("pass123"),
            role=UserRole.STUDENT,
            is_active=True
        )
        self.db.add(self.u2)
        self.db.commit()

        self.s2 = Student(
            user_id=self.u2.id,
            roll_number="23311A05Y2",
            name="Student Two",
            email="s2@sreenidhi.edu.in",
            department_id=dept.id,
            agency="Regular"
        )
        self.db.add(self.s2)

        # Admin User
        self.admin = User(
            username="admin_hod",
            email="hod@sreenidhi.edu.in",
            password_hash=get_password_hash("admin123"),
            role=UserRole.SUPER_ADMIN,
            is_active=True
        )
        self.db.add(self.admin)
        self.db.commit()

        # Auth tokens
        self.s1_token = create_access_token({"sub": self.u1.username, "role": self.u1.role.value})
        self.s2_token = create_access_token({"sub": self.u2.username, "role": self.u2.role.value})
        self.admin_token = create_access_token({"sub": self.admin.username, "role": self.admin.role.value})

        # By default in tests, enable BINDING_V2 for testing the endpoints
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

    def test_01_feature_flag_gating(self):
        """When BINDING_V2 is False, endpoints return HTTP 404 Not Found."""
        settings.BINDING_V2 = False
        headers = {"Authorization": f"Bearer {self.s1_token}"}

        resp_enroll = self.client.post("/api/v1/binding/enroll", json={"public_key": "dummy"}, headers=headers)
        self.assertEqual(resp_enroll.status_code, 404)

        resp_challenge = self.client.post("/api/v1/binding/challenge", headers=headers)
        self.assertEqual(resp_challenge.status_code, 404)

        resp_verify = self.client.post("/api/v1/binding/verify", json={"challenge_token": "c", "signature": "s"}, headers=headers)
        self.assertEqual(resp_verify.status_code, 404)

    def test_02_happy_path_enrollment(self):
        """New student enrolls public key -> DEVICE_ENROLLED and single active row created."""
        priv1, spki1 = _generate_p256_keypair()
        headers = {"Authorization": f"Bearer {self.s1_token}"}

        resp = self.client.post(
            "/api/v1/binding/enroll",
            json={
                "public_key": spki1,
                "storage_persist_granted": True,
                "browser_profile_tag": "tag_student1"
            },
            headers=headers
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "DEVICE_ENROLLED")
        self.assertIn("key_id", data)

        # Verify DB row
        active_binding = self.db.query(DeviceBinding).filter(
            DeviceBinding.student_id == self.s1.id,
            DeviceBinding.revoked_at == None
        ).first()
        self.assertIsNotNone(active_binding)
        self.assertEqual(active_binding.public_key, spki1)
        self.assertEqual(active_binding.enrolled_via, "self")

    def test_03_idempotent_re_enrollment(self):
        """Submitting the same public key again -> BINDING_REFRESH without OTP friction."""
        priv1, spki1 = _generate_p256_keypair()
        headers = {"Authorization": f"Bearer {self.s1_token}"}

        # Initial enroll
        self.client.post("/api/v1/binding/enroll", json={"public_key": spki1}, headers=headers)

        # Re-enroll with same key
        resp2 = self.client.post("/api/v1/binding/enroll", json={"public_key": spki1}, headers=headers)
        self.assertEqual(resp2.status_code, 200)
        data2 = resp2.json()
        self.assertEqual(data2["status"], "BINDING_REFRESH")
        self.assertIn("key_id", data2)

        # Still only 1 row in DB
        total_rows = self.db.query(DeviceBinding).filter(DeviceBinding.student_id == self.s1.id).count()
        self.assertEqual(total_rows, 1)

    def test_04_rebind_requires_otp_friction(self):
        """Enrolling a NEW key when active binding exists -> REBIND_REQUIRED and OTP dispatched."""
        priv1, spki1 = _generate_p256_keypair()
        priv2, spki2 = _generate_p256_keypair()
        headers = {"Authorization": f"Bearer {self.s1_token}"}

        # 1. Enroll initial key
        self.client.post("/api/v1/binding/enroll", json={"public_key": spki1}, headers=headers)

        # 2. Attempt to enroll new key without OTP
        resp = self.client.post("/api/v1/binding/enroll", json={"public_key": spki2}, headers=headers)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "REBIND_REQUIRED")
        self.assertTrue(data["otp_required"])

        # Confirm OTP was generated in DB
        otp_entry = self.db.query(DeviceRebindOTP).filter(
            DeviceRebindOTP.student_id == self.s1.id,
            DeviceRebindOTP.is_verified == False
        ).order_by(DeviceRebindOTP.id.desc()).first()
        self.assertIsNotNone(otp_entry)

    def test_05_rebind_with_valid_otp_revokes_old_atomically(self):
        """Providing valid OTP revokes the old binding and activates the new key."""
        priv1, spki1 = _generate_p256_keypair()
        priv2, spki2 = _generate_p256_keypair()
        headers = {"Authorization": f"Bearer {self.s1_token}"}

        # Enroll initial key
        self.client.post("/api/v1/binding/enroll", json={"public_key": spki1}, headers=headers)

        # Request rebind OTP explicitly
        otp_resp = self.client.post("/api/v1/binding/request-rebind-otp", headers=headers)
        self.assertEqual(otp_resp.status_code, 200)

        # For testing, grab the generated OTP hash from DB or simulate known OTP
        # We can seed a deterministic OTP: "654321"
        import hashlib
        known_otp = "654321"
        otp_hash = hashlib.sha256(known_otp.encode("utf-8")).hexdigest()
        otp_record = DeviceRebindOTP(
            student_id=self.s1.id,
            otp_hash=otp_hash,
            expires_at=datetime.utcnow() + timedelta(minutes=10),
            attempts=0,
            is_verified=False
        )
        self.db.add(otp_record)
        self.db.commit()

        # Submit new key with incorrect OTP
        resp_bad = self.client.post(
            "/api/v1/binding/enroll",
            json={"public_key": spki2, "rebind_otp": "000000"},
            headers=headers
        )
        self.assertEqual(resp_bad.status_code, 400)
        self.assertEqual(resp_bad.json()["error_type"], "INVALID_OTP")

        # Submit new key with CORRECT OTP
        resp_good = self.client.post(
            "/api/v1/binding/enroll",
            json={"public_key": spki2, "rebind_otp": known_otp},
            headers=headers
        )
        self.assertEqual(resp_good.status_code, 200)
        self.assertEqual(resp_good.json()["status"], "DEVICE_ENROLLED")

        # Invariant check: Exactly 1 active row, 1 revoked row
        active_row = self.db.query(DeviceBinding).filter(
            DeviceBinding.student_id == self.s1.id,
            DeviceBinding.revoked_at == None
        ).first()
        self.assertIsNotNone(active_row)
        self.assertEqual(active_row.public_key, spki2)

        revoked_row = self.db.query(DeviceBinding).filter(
            DeviceBinding.student_id == self.s1.id,
            DeviceBinding.revoked_at != None
        ).first()
        self.assertIsNotNone(revoked_row)
        self.assertEqual(revoked_row.public_key, spki1)
        self.assertEqual(revoked_row.revoked_reason, "rebind")

    def test_06_challenge_and_verify_happy_path(self):
        """Complete challenge generation, signing, and sub-ms verification."""
        priv1, spki1 = _generate_p256_keypair()
        headers = {"Authorization": f"Bearer {self.s1_token}"}

        # 1. Enroll active key
        self.client.post("/api/v1/binding/enroll", json={"public_key": spki1}, headers=headers)

        # 2. Get Challenge
        ch_resp = self.client.post("/api/v1/binding/challenge", headers=headers)
        self.assertEqual(ch_resp.status_code, 200)
        challenge_token = ch_resp.json()["challenge_token"]
        self.assertIsNotNone(challenge_token)

        # 3. Client signs challenge token using private key (IEEE P1363 raw 64-byte signature)
        sig_b64 = _sign_challenge_p1363(priv1, challenge_token)

        # 4. POST /binding/verify
        v_resp = self.client.post(
            "/api/v1/binding/verify",
            json={"challenge_token": challenge_token, "signature": sig_b64},
            headers=headers
        )
        self.assertEqual(v_resp.status_code, 200)
        v_data = v_resp.json()
        self.assertEqual(v_data["status"], "VERIFIED")
        self.assertIn("verify_duration_ms", v_data)
        # Verify sub-5ms verification requirement
        self.assertLess(v_data["verify_duration_ms"], 5.0)

    def test_07_replay_attack_rejected(self):
        """Submitting the same challenge token twice must be rejected with challenge_reused."""
        priv1, spki1 = _generate_p256_keypair()
        headers = {"Authorization": f"Bearer {self.s1_token}"}
        self.client.post("/api/v1/binding/enroll", json={"public_key": spki1}, headers=headers)

        ch_resp = self.client.post("/api/v1/binding/challenge", headers=headers)
        challenge_token = ch_resp.json()["challenge_token"]
        sig_b64 = _sign_challenge_p1363(priv1, challenge_token)

        # First verification succeeds
        v1 = self.client.post("/api/v1/binding/verify", json={"challenge_token": challenge_token, "signature": sig_b64}, headers=headers)
        self.assertEqual(v1.status_code, 200)

        # Replay attempt MUST fail
        v2 = self.client.post("/api/v1/binding/verify", json={"challenge_token": challenge_token, "signature": sig_b64}, headers=headers)
        self.assertEqual(v2.status_code, 401)
        self.assertEqual(v2.json()["error_type"], "challenge_reused")

    def test_08_expired_challenge_rejected(self):
        """A challenge older than 60 seconds is rejected as challenge_expired."""
        priv1, spki1 = _generate_p256_keypair()
        headers = {"Authorization": f"Bearer {self.s1_token}"}
        self.client.post("/api/v1/binding/enroll", json={"public_key": spki1}, headers=headers)

        # Synthesize a challenge token with issue timestamp 75s in the past
        past_ts = int(time.time()) - 75
        expired_token = create_challenge_token(student_id=self.s1.id, issue_time=past_ts)["challenge_token"]
        sig_b64 = _sign_challenge_p1363(priv1, expired_token)

        resp = self.client.post(
            "/api/v1/binding/verify",
            json={"challenge_token": expired_token, "signature": sig_b64},
            headers=headers
        )
        self.assertEqual(resp.status_code, 401)
        self.assertEqual(resp.json()["error_type"], "challenge_expired")

    def test_09_invalid_signature_and_brute_force_lockout(self):
        """5 signature verification failures trigger 15-minute brute-force lockout."""
        priv1, spki1 = _generate_p256_keypair()
        headers = {"Authorization": f"Bearer {self.s1_token}"}
        self.client.post("/api/v1/binding/enroll", json={"public_key": spki1}, headers=headers)

        # Corrupted signature of 64 bytes
        bad_sig = base64.b64encode(b"\x00" * 64).decode("ascii")

        for attempt in range(1, 6):
            ch_resp = self.client.post("/api/v1/binding/challenge", headers=headers)
            ch_token = ch_resp.json()["challenge_token"]
            resp = self.client.post(
                "/api/v1/binding/verify",
                json={"challenge_token": ch_token, "signature": bad_sig},
                headers=headers
            )
            self.assertEqual(resp.status_code, 401)
            self.assertEqual(resp.json()["error_type"], "signature_invalid")

        # 6th attempt MUST hit 429 Lockout
        ch_resp = self.client.post("/api/v1/binding/challenge", headers=headers)
        ch_token = ch_resp.json()["challenge_token"]
        resp_locked = self.client.post(
            "/api/v1/binding/verify",
            json={"challenge_token": ch_token, "signature": bad_sig},
            headers=headers
        )
        self.assertEqual(resp_locked.status_code, 429)
        self.assertEqual(resp_locked.json()["error_type"], "VERIFY_LOCKOUT")
        self.assertIn("retry_after_seconds", resp_locked.json())

    def test_10_churn_rate_limit_enforcement(self):
        """Exceeding 2 rebinds in 30 days triggers HTTP 429 CHURN_LIMIT_EXCEEDED."""
        headers = {"Authorization": f"Bearer {self.s1_token}"}

        # Seed 2 previous rebinds within last 30 days
        now = datetime.utcnow()
        for i in range(2):
            b = DeviceBinding(
                student_id=self.s1.id,
                public_key=f"k_old_{i}",
                key_id=f"h_old_{i}",
                enrolled_at=now - timedelta(days=i + 1),
                enrolled_via="self",
                revoked_at=now - timedelta(days=i),
                revoked_reason="rebind"
            )
            self.db.add(b)

        # And 1 currently active binding
        b_active = DeviceBinding(
            student_id=self.s1.id,
            public_key="k_active",
            key_id="h_active",
            enrolled_at=now,
            enrolled_via="self",
            revoked_at=None
        )
        self.db.add(b_active)
        self.db.commit()

        # Seed valid OTP
        import hashlib
        known_otp = "889900"
        self.db.add(DeviceRebindOTP(
            student_id=self.s1.id,
            otp_hash=hashlib.sha256(known_otp.encode("utf-8")).hexdigest(),
            expires_at=now + timedelta(minutes=10),
            attempts=0,
            is_verified=False
        ))
        self.db.commit()

        # 3rd rebind attempt MUST be blocked by churn limit
        priv_new, spki_new = _generate_p256_keypair()
        resp = self.client.post(
            "/api/v1/binding/enroll",
            json={"public_key": spki_new, "rebind_otp": known_otp},
            headers=headers
        )
        self.assertEqual(resp.status_code, 429)
        self.assertEqual(resp.json()["error_type"], "CHURN_LIMIT_EXCEEDED")

    def test_11_admin_revocation_workflow_and_churn_exemption(self):
        """Admin revokes binding: reason=admin_reset and exempt from student churn budget."""
        headers_student = {"Authorization": f"Bearer {self.s1_token}"}
        headers_admin = {"Authorization": f"Bearer {self.admin_token}"}

        priv1, spki1 = _generate_p256_keypair()
        self.client.post("/api/v1/binding/enroll", json={"public_key": spki1}, headers=headers_student)

        # Admin revokes
        resp_admin = self.client.post(
            f"/api/v1/binding/admin/revoke/{self.s1.id}",
            json={"reason": "Student phone broken in lab"},
            headers=headers_admin
        )
        self.assertEqual(resp_admin.status_code, 200)
        self.assertEqual(resp_admin.json()["status"], "BINDING_REVOKED")

        # Verify DB revoked_reason
        binding = self.db.query(DeviceBinding).filter(DeviceBinding.student_id == self.s1.id).first()
        self.assertEqual(binding.revoked_reason, "admin_reset")
        self.assertIsNotNone(binding.revoked_at)

        # Now student can re-enroll as fresh enrollment without OTP because no active binding exists
        priv2, spki2 = _generate_p256_keypair()
        resp_re_enroll = self.client.post("/api/v1/binding/enroll", json={"public_key": spki2}, headers=headers_student)
        self.assertEqual(resp_re_enroll.status_code, 200)
        self.assertEqual(resp_re_enroll.json()["status"], "DEVICE_ENROLLED")

    def test_12_admin_churn_anomalies_view(self):
        """Admin churn anomaly endpoint returns students with >2 rebinds in rolling 30 days."""
        now = datetime.utcnow()
        # Student 2 has 3 rebinds
        for i in range(3):
            b = DeviceBinding(
                student_id=self.s2.id,
                public_key=f"k_s2_{i}",
                key_id=f"h_s2_{i}",
                enrolled_at=now - timedelta(days=i + 1),
                enrolled_via="self",
                revoked_at=now - timedelta(days=i),
                revoked_reason="rebind"
            )
            self.db.add(b)
        self.db.commit()

        headers_admin = {"Authorization": f"Bearer {self.admin_token}"}
        resp = self.client.get("/api/v1/binding/admin/churn-anomalies", headers=headers_admin)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("anomalies", data)
        student_rolls = [row["roll_number"] for row in data["anomalies"]]
        self.assertIn("23311A05Y2", student_rolls)

    def test_13_audit_trail_contains_no_raw_keys(self):
        """Audit log verification: ensure zero private keys, SPKI keys, or signatures in logs."""
        priv1, spki1 = _generate_p256_keypair()
        headers = {"Authorization": f"Bearer {self.s1_token}"}
        self.client.post("/api/v1/binding/enroll", json={"public_key": spki1}, headers=headers)

        # Inspect all audit log entries created during enrollment
        logs = self.db.query(AuditLog).filter(AuditLog.user_id == self.u1.id).all()
        self.assertGreater(len(logs), 0)

        for log in logs:
            action = log.action or ""
            detail = log.details or ""
            # Must NOT contain SPKI base64 string
            self.assertNotIn(spki1, action)
            self.assertNotIn(spki1, detail)
            self.assertNotIn("BEGIN PUBLIC KEY", detail)
            self.assertNotIn("BEGIN PRIVATE KEY", detail)


if __name__ == "__main__":
    unittest.main()
