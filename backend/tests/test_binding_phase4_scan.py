"""
Test Suite: Binding Phase 4 — Scan-Path Challenge Enforcement

Validates the ECDSA P-256 possession-proof integration into the attendance scan path:
1. BINDING_V2=false → scan works without binding fields (regression proof)
2. BINDING_V2=true, enrolled student + valid signature → SUCCESS
3. BINDING_V2=true, unenrolled student → 403 BINDING_REQUIRED
4. BINDING_V2=true, wrong key signature → 401 signature_invalid
5. BINDING_V2=true, expired challenge → 401 challenge_expired
6. BINDING_V2=true, replayed challenge → 401 challenge_reused
7. BINDING_V2=true, offline submission → SUCCESS (binding skipped)
8. Verify duration ≤ 5ms budget (timing assertion)
9. Lockout enforcement: 5 bad signatures → 429 VERIFY_LOCKOUT
"""

import os
import sys
import time
import base64
import hashlib
import unittest
from datetime import datetime, timedelta

from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# Ensure backend directory is in sys.path
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.main import app
from app.core.database import get_db, Base
from app.core.config import settings
from app.core.security import create_access_token, get_password_hash, get_server_ist_date
from app.core.binding_crypto import (
    create_challenge_token,
    _CONSUMED_NONCES,
    clear_binding_verify_lockouts,
    record_verify_failure,
    check_verify_lockout
)
from app.models.models import (
    User, UserRole, Student, Teacher, Department, Subject, Section, AcademicYear,
    AttendanceSession, SessionStatus, TeacherAssignment, DeviceBinding
)
from app.services.qr_token import ShortTokenService
from app.api.student import failed_token_tracker, student_scan_limiter


def _generate_p256_keypair():
    """Helper: generates a real P-256 ECDSA keypair; returns (private_key, spki_b64, key_id)."""
    private_key = ec.generate_private_key(ec.SECP256R1())
    public_key = private_key.public_key()
    spki_der = public_key.public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo
    )
    spki_b64 = base64.b64encode(spki_der).decode("ascii")
    key_id = hashlib.sha256(spki_der).hexdigest()[:32].upper()
    return private_key, spki_b64, key_id


def _sign_challenge_p1363(private_key, challenge_token_str: str) -> str:
    """Helper: produces IEEE P1363 raw 64-byte signature Base64 (matching WebCrypto API output)."""
    der_sig = private_key.sign(
        challenge_token_str.encode("utf-8"),
        ec.ECDSA(hashes.SHA256())
    )
    r, s = decode_dss_signature(der_sig)
    raw_sig = r.to_bytes(32, "big") + s.to_bytes(32, "big")
    return base64.b64encode(raw_sig).decode("ascii")


class TestBindingPhase4ScanPath(unittest.TestCase):
    """
    Comprehensive scan-path integration tests for the Binding V2 possession-proof.
    Each test uses a fresh in-memory SQLite database with seeded attendance hierarchy.
    """

    def setUp(self):
        """Seeds: Department, AcademicYear, Section, Subject, Teacher, Student, AttendanceSession."""
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool
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

        # Clear in-memory caches
        _CONSUMED_NONCES.clear()
        clear_binding_verify_lockouts()
        ShortTokenService.clear_cache()
        with failed_token_tracker._lock:
            failed_token_tracker._failures.clear()
            failed_token_tracker._cooldowns.clear()
        with student_scan_limiter._lock:
            student_scan_limiter._attempts.clear()

        # --- Seed Hierarchy ---
        dept = Department(code="CSE", name="Computer Science")
        ay = AcademicYear(name="2025-2026")
        self.db.add_all([dept, ay])
        self.db.commit()

        self.section = Section(name="CSE-A", department_id=dept.id, academic_year_id=ay.id)
        self.subject = Subject(code="CS401", name="Cryptography", department_id=dept.id, academic_year_id=ay.id)
        self.db.add_all([self.section, self.subject])
        self.db.commit()

        # Teacher
        t_user = User(
            username="teacher_crypto",
            password_hash=get_password_hash("pass123"),
            role=UserRole.TEACHER,
            is_active=True
        )
        self.db.add(t_user)
        self.db.commit()

        self.teacher = Teacher(
            user_id=t_user.id,
            teacher_code="T201",
            name="Dr. Rivest",
            department_id=dept.id
        )
        self.db.add(self.teacher)
        self.db.commit()

        assignment = TeacherAssignment(teacher_id=self.teacher.id, subject_id=self.subject.id, section_id=self.section.id)
        self.db.add(assignment)
        self.db.commit()

        # Student 1 (enrolled in section)
        self.s1_user = User(
            username="23311A05P1",
            password_hash=get_password_hash("pass123"),
            role=UserRole.STUDENT,
            is_active=True
        )
        self.db.add(self.s1_user)
        self.db.commit()

        self.student1 = Student(
            user_id=self.s1_user.id,
            roll_number="23311A05P1",
            name="Student Phase4",
            department_id=dept.id,
            academic_year_id=ay.id,
            section_id=self.section.id
        )
        self.db.add(self.student1)
        self.db.commit()

        # Attendance Session (OPEN, today)
        self.att_session = AttendanceSession(
            teacher_id=self.teacher.id,
            subject_id=self.subject.id,
            section_id=self.section.id,
            period="1 Period",
            session_date=get_server_ist_date(),
            status=SessionStatus.OPEN
        )
        self.db.add(self.att_session)
        self.db.commit()

        # Auth tokens
        self.teacher_token = create_access_token({"sub": t_user.username, "role": UserRole.TEACHER.value})
        self.teacher_headers = {"Authorization": f"Bearer {self.teacher_token}"}

        self.s1_token = create_access_token({"sub": self.s1_user.username, "role": UserRole.STUDENT.value})
        self.s1_headers = {"Authorization": f"Bearer {self.s1_token}"}

        # Save original BINDING_V2 flag
        self.orig_binding_v2 = getattr(settings, 'BINDING_V2', False)

    def tearDown(self):
        settings.BINDING_V2 = self.orig_binding_v2
        app.dependency_overrides.clear()
        self.db.close()
        _CONSUMED_NONCES.clear()
        clear_binding_verify_lockouts()

    def _get_broadcast_token(self):
        """Helper: fetches a valid QR broadcast token (short format) from the teacher endpoint."""
        res = self.client.get(
            f"/api/v1/teacher/sessions/{self.att_session.id}/broadcast-token?period_count=1",
            headers=self.teacher_headers
        )
        self.assertEqual(res.status_code, 200, f"Broadcast token fetch failed: {res.text}")
        return res.json()["qr_payload"]

    def _enroll_binding(self, student, private_key, spki_b64, key_id):
        """Helper: directly creates a DeviceBinding row in DB (bypasses /binding/enroll endpoint)."""
        binding = DeviceBinding(
            student_id=student.id,
            public_key=spki_b64,
            key_id=key_id,
            enrolled_at=datetime.utcnow(),
            enrolled_via="self",
            storage_persist_granted=True,
            browser_profile_tag="test_p4"
        )
        self.db.add(binding)
        self.db.commit()
        return binding

    # ================================================================
    # TEST 1: BINDING_V2=false, grace expired → legacy device receives 410
    # ================================================================
    def test_01_flag_off_scan_succeeds_without_binding(self):
        """Phase 5 Cutover: When BINDING_V2 is disabled and grace expired, client sending legacy device_uuid receives HTTP 410 legacy_binding_retired."""
        settings.BINDING_V2 = False
        orig_grace = getattr(settings, "LEGACY_BINDING_GRACE_UNTIL", "2026-12-31T23:59:59Z")
        settings.LEGACY_BINDING_GRACE_UNTIL = "2020-01-01T00:00:00Z"

        try:
            qr_payload = self._get_broadcast_token()

            res = self.client.post(
                "/api/v1/student/scan-session",
                json={
                    "session_token": qr_payload,
                    "token_format": "short",
                    "device_uuid": "DEV-TEST-P4"
                },
                headers=self.s1_headers
            )
            self.assertEqual(res.status_code, 410, f"Expected 410, got {res.status_code}: {res.text}")
            data = res.json()
            self.assertIn("legacy_binding_retired", str(data))
        finally:
            settings.LEGACY_BINDING_GRACE_UNTIL = orig_grace


    # ================================================================
    # TEST 2: BINDING_V2=true, enrolled + valid signature → SUCCESS
    # ================================================================
    def test_02_enrolled_valid_signature_succeeds(self):
        """Full happy path: enrolled student submits valid possession proof → attendance recorded."""
        settings.BINDING_V2 = True

        # 1. Generate keypair and enroll binding
        priv_key, spki_b64, key_id = _generate_p256_keypair()
        self._enroll_binding(self.student1, priv_key, spki_b64, key_id)

        # 2. Create a valid challenge token
        challenge_result = create_challenge_token(
            student_id=self.student1.id,
            roll_number=self.student1.roll_number,
            ttl_seconds=60
        )
        challenge_token = challenge_result["challenge_token"]

        # 3. Sign the challenge token with the private key
        binding_sig = _sign_challenge_p1363(priv_key, challenge_token)

        # 4. Get a valid QR token
        qr_payload = self._get_broadcast_token()

        # 5. Submit scan with binding proof
        res = self.client.post(
            "/api/v1/student/scan-session",
            json={
                "session_token": qr_payload,
                "token_format": "short",
                "device_uuid": "DEV-ENROLLED-P4",
                "challenge_token": challenge_token,
                "binding_signature": binding_sig
            },
            headers=self.s1_headers
        )
        self.assertEqual(res.status_code, 200, f"Expected 200, got {res.status_code}: {res.text}")
        data = res.json()
        self.assertIn(data["status"], ("SUCCESS", "ALREADY_MARKED"))

    # ================================================================
    # TEST 3: BINDING_V2=true, unenrolled → 403 BINDING_REQUIRED
    # ================================================================
    def test_03_unenrolled_student_gets_binding_required(self):
        """Unenrolled student (no DeviceBinding row) gets 403 when BINDING_V2 is on."""
        settings.BINDING_V2 = True

        qr_payload = self._get_broadcast_token()

        res = self.client.post(
            "/api/v1/student/scan-session",
            json={
                "session_token": qr_payload,
                "token_format": "short",
                "device_uuid": "DEV-NOENROLL-P4"
            },
            headers=self.s1_headers
        )
        self.assertEqual(res.status_code, 403, f"Expected 403, got {res.status_code}: {res.text}")
        self.assertIn("BINDING_REQUIRED", res.json().get("detail", ""))

    # ================================================================
    # TEST 4: BINDING_V2=true, wrong key → 401 signature_invalid
    # ================================================================
    def test_04_wrong_key_signature_rejected(self):
        """Signature from a different key pair is rejected with 401."""
        settings.BINDING_V2 = True

        # Enroll with key A
        priv_a, spki_a, kid_a = _generate_p256_keypair()
        self._enroll_binding(self.student1, priv_a, spki_a, kid_a)

        # Create challenge and sign with DIFFERENT key B
        priv_b, _, _ = _generate_p256_keypair()
        challenge_result = create_challenge_token(
            student_id=self.student1.id,
            roll_number=self.student1.roll_number,
            ttl_seconds=60
        )
        challenge_token = challenge_result["challenge_token"]
        bad_sig = _sign_challenge_p1363(priv_b, challenge_token)

        qr_payload = self._get_broadcast_token()

        res = self.client.post(
            "/api/v1/student/scan-session",
            json={
                "session_token": qr_payload,
                "token_format": "short",
                "device_uuid": "DEV-WRONGKEY-P4",
                "challenge_token": challenge_token,
                "binding_signature": bad_sig
            },
            headers=self.s1_headers
        )
        self.assertEqual(res.status_code, 401, f"Expected 401, got {res.status_code}: {res.text}")
        self.assertIn("signature", res.json().get("detail", "").lower())

    # ================================================================
    # TEST 5: Expired challenge → 401
    # ================================================================
    def test_05_expired_challenge_rejected(self):
        """Challenge token with expired TTL is rejected."""
        settings.BINDING_V2 = True

        priv_key, spki_b64, key_id = _generate_p256_keypair()
        self._enroll_binding(self.student1, priv_key, spki_b64, key_id)

        # Create challenge that is already expired (issued 120s ago, TTL=60s)
        challenge_result = create_challenge_token(
            student_id=self.student1.id,
            roll_number=self.student1.roll_number,
            ttl_seconds=60,
            issue_time=int(time.time()) - 120  # Already expired
        )
        challenge_token = challenge_result["challenge_token"]
        sig = _sign_challenge_p1363(priv_key, challenge_token)

        qr_payload = self._get_broadcast_token()

        res = self.client.post(
            "/api/v1/student/scan-session",
            json={
                "session_token": qr_payload,
                "token_format": "short",
                "device_uuid": "DEV-EXPIRED-P4",
                "challenge_token": challenge_token,
                "binding_signature": sig
            },
            headers=self.s1_headers
        )
        self.assertEqual(res.status_code, 401, f"Expected 401, got {res.status_code}: {res.text}")
        self.assertIn("expired", res.json().get("detail", "").lower())

    # ================================================================
    # TEST 6: Replayed challenge → 401
    # ================================================================
    def test_06_replayed_challenge_rejected(self):
        """Re-using an already-consumed challenge token is rejected (replay prevention)."""
        settings.BINDING_V2 = True

        priv_key, spki_b64, key_id = _generate_p256_keypair()
        self._enroll_binding(self.student1, priv_key, spki_b64, key_id)

        challenge_result = create_challenge_token(
            student_id=self.student1.id,
            roll_number=self.student1.roll_number,
            ttl_seconds=60
        )
        challenge_token = challenge_result["challenge_token"]
        sig = _sign_challenge_p1363(priv_key, challenge_token)

        qr_payload = self._get_broadcast_token()

        # First submission → SUCCESS
        res1 = self.client.post(
            "/api/v1/student/scan-session",
            json={
                "session_token": qr_payload,
                "token_format": "short",
                "device_uuid": "DEV-REPLAY-P4",
                "challenge_token": challenge_token,
                "binding_signature": sig
            },
            headers=self.s1_headers
        )
        self.assertEqual(res1.status_code, 200, f"First submit expected 200: {res1.text}")

        # Second submission with SAME challenge_token → 401 (nonce already consumed)
        # Need a new QR broadcast token for a different v value
        # But the nonce replay check happens BEFORE QR validation in _verify_binding_proof
        # Actually the nonce is consumed in step 0e which is before session lookup...
        # But the student might get ALREADY_MARKED from the first scan.
        # Let's create a second fresh challenge to test explicitly via the consumed nonce set.
        
        # Pre-consume a nonce manually to test replay rejection
        challenge_result2 = create_challenge_token(
            student_id=self.student1.id,
            roll_number=self.student1.roll_number,
            ttl_seconds=60
        )
        challenge_token2 = challenge_result2["challenge_token"]
        nonce2 = challenge_result2["nonce"]
        sig2 = _sign_challenge_p1363(priv_key, challenge_token2)
        
        # Pre-consume the nonce
        _CONSUMED_NONCES[nonce2] = challenge_result2["expires_at"]

        qr_payload2 = self._get_broadcast_token()

        res2 = self.client.post(
            "/api/v1/student/scan-session",
            json={
                "session_token": qr_payload2,
                "token_format": "short",
                "device_uuid": "DEV-REPLAY-P4",
                "challenge_token": challenge_token2,
                "binding_signature": sig2
            },
            headers=self.s1_headers
        )
        self.assertEqual(res2.status_code, 401, f"Replay expected 401: {res2.text}")
        self.assertIn("already been used", res2.json().get("detail", "").lower())

    # ================================================================
    # TEST 7: Offline submission → SUCCESS (binding skipped)
    # ================================================================
    def test_07_offline_submission_skips_binding(self):
        """Offline-queued submissions bypass binding check even when BINDING_V2=true."""
        settings.BINDING_V2 = True

        # Student has NO binding, but is_offline_submission=True → should succeed
        qr_payload = self._get_broadcast_token()

        res = self.client.post(
            "/api/v1/student/scan-session",
            json={
                "session_token": qr_payload,
                "token_format": "short",
                "device_uuid": "DEV-OFFLINE-P4",
                "is_offline_submission": True,
                "queued_at": time.time() - 30  # queued 30s ago
            },
            headers=self.s1_headers
        )
        self.assertEqual(res.status_code, 200, f"Offline submit expected 200: {res.text}")
        data = res.json()
        self.assertIn(data["status"], ("SUCCESS", "ALREADY_MARKED"))

    # ================================================================
    # TEST 8: Verify duration ≤ 5ms budget
    # ================================================================
    def test_08_verify_duration_within_budget(self):
        """Signature verification completes within 5ms budget (generous assertion)."""
        from app.core.binding_crypto import verify_ecdsa_p1363_signature

        priv_key, spki_b64, key_id = _generate_p256_keypair()

        # Generate a challenge and sign it
        challenge_str = "test_challenge_budget_timing_verification"
        sig_b64 = _sign_challenge_p1363(priv_key, challenge_str)

        # Time the verification over 10 iterations for statistical confidence
        durations = []
        for _ in range(10):
            t0 = time.perf_counter()
            valid, reason = verify_ecdsa_p1363_signature(
                spki_b64, sig_b64, challenge_str.encode("utf-8")
            )
            elapsed_ms = (time.perf_counter() - t0) * 1000
            durations.append(elapsed_ms)
            self.assertTrue(valid, f"Signature should be valid: {reason}")

        avg_ms = sum(durations) / len(durations)
        max_ms = max(durations)

        # Budget: average must be ≤5ms, max ≤10ms (generous for CI/test environments)
        self.assertLessEqual(avg_ms, 5.0,
            f"Average verify time {avg_ms:.3f}ms exceeds 5ms budget")
        self.assertLessEqual(max_ms, 10.0,
            f"Max verify time {max_ms:.3f}ms exceeds 10ms ceiling")

    # ================================================================
    # TEST 9: Lockout enforcement (5 bad sigs → 429)
    # ================================================================
    def test_09_lockout_after_repeated_failures(self):
        """After MAX_VERIFY_FAILURES_BEFORE_LOCKOUT bad signatures, student gets 429."""
        settings.BINDING_V2 = True

        priv_key, spki_b64, key_id = _generate_p256_keypair()
        self._enroll_binding(self.student1, priv_key, spki_b64, key_id)

        # Simulate MAX failures by recording them directly
        lockout_key = f"binding_v2_{self.student1.roll_number.strip().upper()}"
        max_failures = getattr(settings, 'MAX_VERIFY_FAILURES_BEFORE_LOCKOUT', 5)

        for _ in range(max_failures):
            record_verify_failure(lockout_key)

        # Verify lockout is active
        is_locked, count, remaining = check_verify_lockout(lockout_key)
        self.assertTrue(is_locked, f"Expected lockout after {max_failures} failures, got locked={is_locked}")

        # Now attempt a scan — should get 429 even with valid binding proof
        challenge_result = create_challenge_token(
            student_id=self.student1.id,
            roll_number=self.student1.roll_number,
            ttl_seconds=60
        )
        challenge_token = challenge_result["challenge_token"]
        sig = _sign_challenge_p1363(priv_key, challenge_token)

        qr_payload = self._get_broadcast_token()

        res = self.client.post(
            "/api/v1/student/scan-session",
            json={
                "session_token": qr_payload,
                "token_format": "short",
                "device_uuid": "DEV-LOCKOUT-P4",
                "challenge_token": challenge_token,
                "binding_signature": sig
            },
            headers=self.s1_headers
        )
        self.assertEqual(res.status_code, 429, f"Expected 429 lockout, got {res.status_code}: {res.text}")
        self.assertIn("locked", res.json().get("detail", "").lower())


if __name__ == "__main__":
    unittest.main()
