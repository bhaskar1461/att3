"""
Test Suite: Binding Phase 6 — Edge-Case Workflows, Recovery & Binding Hardening

Validates real-world edge cases and failure states:
1. Unbound student inline self-healing enrollment + immediate scan
2. Storage loss / private key loss recovery via email OTP rebind
3. Invalid / expired rebind OTP rejection and attempt caps
4. Account switching: cross-student challenge token splice rejection
5. Wrong-key signature rejection
6. Challenge nonce replay attack rejection
7. Expired challenge token rejection
8. Network retry & duplicate attendance scan prevention (idempotency)
9. Concurrent multi-threaded double-enrollment race safety
10. Idempotent re-enrollment with identical key (BINDING_REFRESH)
11. Admin revocation + fresh re-enrollment workflow
12. 30-day churn rate limit enforcement (max 2 rebinds)
13. Admin reset exemption from churn budget
14. Brute-force signature failure rate limiting & 15m lockout
15. Self-service device reset endpoint revoking active V2 binding
16. Zero raw key material / sensitive tokens in audit logs
"""

import os
import sys
import time
import base64
import hashlib
import unittest
import threading
import tempfile
from concurrent.futures import ThreadPoolExecutor
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
    clear_binding_verify_lockouts,
    _CONSUMED_NONCES
)
from app.models.models import (
    User, UserRole, Student, Teacher, Department, Subject, Section, AcademicYear,
    AttendanceSession, SessionStatus, TeacherAssignment, DeviceBinding, DeviceRebindOTP,
    DeviceResetOTP, AuditLog, RevokedReason, EnrolledVia
)
from app.services.qr_token import ShortTokenService
from app.api.student import failed_token_tracker, student_scan_limiter


def _generate_p256_keypair():
    """Generates an authentic ECDSA P-256 keypair; returns (private_key, spki_b64, key_id)."""
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
    """Produces IEEE P1363 raw 64-byte signature Base64 matching WebCrypto API."""
    der_sig = private_key.sign(
        challenge_token_str.encode("utf-8"),
        ec.ECDSA(hashes.SHA256())
    )
    r, s = decode_dss_signature(der_sig)
    raw_sig = r.to_bytes(32, "big") + s.to_bytes(32, "big")
    return base64.b64encode(raw_sig).decode("ascii")


class TestBindingPhase6EdgeCases(unittest.TestCase):
    """
    Automated regression suite verifying all Phase 6 edge cases and attack vectors.
    """

    def setUp(self):
        clear_binding_verify_lockouts()
        with failed_token_tracker._lock:
            failed_token_tracker._failures.clear()
            failed_token_tracker._cooldowns.clear()
        with student_scan_limiter._lock:
            student_scan_limiter._attempts.clear()
        _CONSUMED_NONCES.clear()
        settings.BINDING_V2 = True

        self.tmp_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp_db.close()
        self.engine = create_engine(
            f"sqlite:///{self.tmp_db.name}",
            connect_args={"timeout": 15, "check_same_thread": False}
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

        # Seed test hierarchy
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
            username="PROF_SMITH",
            password_hash=get_password_hash("pass123"),
            role=UserRole.TEACHER,
            is_active=True
        )
        self.db.add(t_user)
        self.db.commit()

        self.teacher = Teacher(
            user_id=t_user.id,
            teacher_code="T201",
            name="Prof Smith",
            department_id=dept.id
        )
        self.db.add(self.teacher)
        self.db.commit()

        assign = TeacherAssignment(teacher_id=self.teacher.id, subject_id=self.subject.id, section_id=self.section.id)
        self.db.add(assign)
        self.db.commit()

        # Student 1
        self.s1_user = User(
            username="21051A0501",
            password_hash=get_password_hash("pass123"),
            role=UserRole.STUDENT,
            is_active=True
        )
        self.db.add(self.s1_user)
        self.db.commit()

        self.student1 = Student(
            user_id=self.s1_user.id,
            roll_number="21051A0501",
            name="Alice Student",
            department_id=dept.id,
            academic_year_id=ay.id,
            section_id=self.section.id,
            email="alice@sreenidhi.edu.in"
        )

        # Student 2 (for account switching / cross-account attacks)
        self.s2_user = User(
            username="21051A0502",
            password_hash=get_password_hash("pass123"),
            role=UserRole.STUDENT,
            is_active=True
        )
        self.db.add(self.s2_user)
        self.db.commit()

        self.student2 = Student(
            user_id=self.s2_user.id,
            roll_number="21051A0502",
            name="Bob Student",
            department_id=dept.id,
            academic_year_id=ay.id,
            section_id=self.section.id,
            email="bob@sreenidhi.edu.in"
        )

        self.db.add_all([self.student1, self.student2])
        self.db.commit()

        # Open attendance session
        self.session = AttendanceSession(
            teacher_id=self.teacher.id,
            subject_id=self.subject.id,
            section_id=self.section.id,
            period="1 Period",
            session_date=get_server_ist_date(),
            status=SessionStatus.OPEN
        )
        self.db.add(self.session)
        self.db.commit()

        # Auth headers
        self.t_token = create_access_token({"sub": t_user.username, "role": UserRole.TEACHER.value})
        self.s1_token = create_access_token({"sub": self.s1_user.username, "role": UserRole.STUDENT.value})
        self.s2_token = create_access_token({"sub": self.s2_user.username, "role": UserRole.STUDENT.value})

        self.s1_headers = {"Authorization": f"Bearer {self.s1_token}"}
        self.s2_headers = {"Authorization": f"Bearer {self.s2_token}"}
        self.t_headers = {"Authorization": f"Bearer {self.t_token}"}

    def tearDown(self):
        clear_binding_verify_lockouts()
        _CONSUMED_NONCES.clear()
        app.dependency_overrides.clear()
        self.db.close()
        self.engine.dispose()
        try:
            if hasattr(self, "tmp_db") and os.path.exists(self.tmp_db.name):
                os.remove(self.tmp_db.name)
        except Exception:
            pass

    def _get_active_qr_token(self) -> str:
        """Helper to get fresh broadcast token from session."""
        res = self.client.get(f"/api/v1/teacher/sessions/{self.session.id}/broadcast-token?period_count=1", headers=self.t_headers)
        self.assertEqual(res.status_code, 200, f"Broadcast token failed: {res.text}")
        return res.json()["qr_payload"]

    # =========================================================================
    # TEST 1: Unbound Student Workflow (Initial Scan -> Enroll -> Rescan)
    # =========================================================================
    def test_01_unbound_student_enroll_and_immediate_scan(self):
        """Unbound student gets no_active_binding -> enrolls -> rescans successfully."""
        qr_token = self._get_active_qr_token()

        # 1. Unbound student tries to scan without signature
        scan_res = self.client.post(
            "/api/v1/student/scan-session",
            json={"session_token": qr_token, "token_format": "short"},
            headers=self.s1_headers
        )
        self.assertEqual(scan_res.status_code, 403)
        self.assertIn("no_active_binding", scan_res.json()["detail"])

        # 2. Student enrolls key
        priv, spki, key_id = _generate_p256_keypair()
        enroll_res = self.client.post(
            "/api/v1/binding/enroll",
            json={"public_key": spki, "key_id": key_id},
            headers=self.s1_headers
        )
        self.assertEqual(enroll_res.status_code, 200)
        self.assertEqual(enroll_res.json()["status"], "DEVICE_ENROLLED")

        # 3. Student requests challenge, signs, and rescans
        ch_res = self.client.post("/api/v1/binding/challenge", headers=self.s1_headers)
        self.assertEqual(ch_res.status_code, 200)
        challenge_token = ch_res.json()["challenge_token"]
        sig = _sign_challenge_p1363(priv, challenge_token)

        rescan_res = self.client.post(
            "/api/v1/student/scan-session",
            json={
                "session_token": qr_token,
                "token_format": "short",
                "challenge_token": challenge_token,
                "binding_signature": sig
            },
            headers=self.s1_headers
        )
        self.assertEqual(rescan_res.status_code, 200)
        self.assertEqual(rescan_res.json()["status"], "SUCCESS")

    # =========================================================================
    # TEST 2: Storage Loss / Private Key Loss Recovery with Email OTP Rebind
    # =========================================================================
    def test_02_storage_loss_recovery_with_rebind_otp(self):
        """Student with active binding loses storage -> enrolls new key -> receives OTP -> confirms -> scans."""
        # 1. Initial enrollment of Phone A
        priv_a, spki_a, key_id_a = _generate_p256_keypair()
        self.client.post("/api/v1/binding/enroll", json={"public_key": spki_a, "key_id": key_id_a}, headers=self.s1_headers)

        # 2. Student clears storage and tries to enroll Phone B (new key) without OTP
        priv_b, spki_b, key_id_b = _generate_p256_keypair()
        rebind_req = self.client.post(
            "/api/v1/binding/enroll",
            json={"public_key": spki_b, "key_id": key_id_b},
            headers=self.s1_headers
        )
        self.assertEqual(rebind_req.status_code, 200)
        data = rebind_req.json()
        self.assertEqual(data["status"], "REBIND_REQUIRED")
        self.assertTrue(data["otp_required"])

        # Fetch dispatched OTP from DB
        otp_row = self.db.query(DeviceRebindOTP).filter(
            DeviceRebindOTP.student_id == self.student1.id,
            DeviceRebindOTP.is_verified == False
        ).order_by(DeviceRebindOTP.id.desc()).first()
        self.assertIsNotNone(otp_row)

        test_otp = "889900"
        otp_row.otp_hash = hashlib.sha256(test_otp.encode("utf-8")).hexdigest()
        self.db.commit()

        # 3. Student submits rebind with OTP
        confirm_res = self.client.post(
            "/api/v1/binding/enroll",
            json={"public_key": spki_b, "key_id": key_id_b, "rebind_otp": test_otp},
            headers=self.s1_headers
        )
        self.assertEqual(confirm_res.status_code, 200)
        self.assertEqual(confirm_res.json()["action"], "DEVICE_REBOUND")

        # 4. Old Phone A binding must now be revoked
        old_binding = self.db.query(DeviceBinding).filter(DeviceBinding.key_id == key_id_a).first()
        self.assertIsNotNone(old_binding.revoked_at)
        self.assertEqual(old_binding.revoked_reason, RevokedReason.REBIND.value)

        # 5. New Phone B can immediately mark attendance
        qr_token = self._get_active_qr_token()
        ch_res = self.client.post("/api/v1/binding/challenge", headers=self.s1_headers)
        ch_token = ch_res.json()["challenge_token"]
        sig_b = _sign_challenge_p1363(priv_b, ch_token)

        scan_res = self.client.post(
            "/api/v1/student/scan-session",
            json={"session_token": qr_token, "challenge_token": ch_token, "binding_signature": sig_b},
            headers=self.s1_headers
        )
        self.assertEqual(scan_res.status_code, 200)
        self.assertEqual(scan_res.json()["status"], "SUCCESS")

    # =========================================================================
    # TEST 3: Invalid / Expired Rebind OTP Rejection
    # =========================================================================
    def test_03_invalid_rebind_otp_rejected(self):
        """Invalid rebind OTP is rejected with 400 and caps attempts at 3."""
        priv_a, spki_a, key_id_a = _generate_p256_keypair()
        self.client.post("/api/v1/binding/enroll", json={"public_key": spki_a, "key_id": key_id_a}, headers=self.s1_headers)

        priv_b, spki_b, key_id_b = _generate_p256_keypair()
        self.client.post("/api/v1/binding/enroll", json={"public_key": spki_b, "key_id": key_id_b}, headers=self.s1_headers)

        # Try 3 wrong OTPs
        for _ in range(3):
            bad_res = self.client.post(
                "/api/v1/binding/enroll",
                json={"public_key": spki_b, "key_id": key_id_b, "rebind_otp": "000000"},
                headers=self.s1_headers
            )
            self.assertEqual(bad_res.status_code, 400)

        # 4th attempt exceeds max attempts
        fourth_res = self.client.post(
            "/api/v1/binding/enroll",
            json={"public_key": spki_b, "key_id": key_id_b, "rebind_otp": "000000"},
            headers=self.s1_headers
        )
        self.assertEqual(fourth_res.status_code, 400)
        data = fourth_res.json()
        msg = data.get("message") or data.get("detail", {}).get("message", "")
        self.assertIn("Maximum verification attempts exceeded", msg)

    # =========================================================================
    # TEST 4: Account Switching — Cross-Student Challenge Splicing Rejected
    # =========================================================================
    def test_04_account_switching_cross_student_challenge_rejected(self):
        """Student A's challenge token used by Student B is strictly rejected."""
        priv1, spki1, key_id1 = _generate_p256_keypair()
        self.client.post("/api/v1/binding/enroll", json={"public_key": spki1, "key_id": key_id1}, headers=self.s1_headers)

        priv2, spki2, key_id2 = _generate_p256_keypair()
        self.client.post("/api/v1/binding/enroll", json={"public_key": spki2, "key_id": key_id2}, headers=self.s2_headers)

        # Student A requests challenge token
        ch_res = self.client.post("/api/v1/binding/challenge", headers=self.s1_headers)
        ch_token_student1 = ch_res.json()["challenge_token"]

        # Student B tries to sign Student A's challenge token with Student B's key and submit as Student B
        sig2 = _sign_challenge_p1363(priv2, ch_token_student1)
        qr_token = self._get_active_qr_token()

        scan_res = self.client.post(
            "/api/v1/student/scan-session",
            json={
                "session_token": qr_token,
                "challenge_token": ch_token_student1,
                "binding_signature": sig2
            },
            headers=self.s2_headers
        )
        self.assertEqual(scan_res.status_code, 401)
        self.assertIn("Challenge token was not issued to this student account", scan_res.json()["detail"])

    # =========================================================================
    # TEST 5: Wrong Key Signature Rejected
    # =========================================================================
    def test_05_wrong_key_signature_rejected(self):
        """Signing with a key that is not student's active public key is rejected."""
        priv_real, spki_real, key_id_real = _generate_p256_keypair()
        self.client.post("/api/v1/binding/enroll", json={"public_key": spki_real, "key_id": key_id_real}, headers=self.s1_headers)

        priv_wrong, _, _ = _generate_p256_keypair()

        ch_res = self.client.post("/api/v1/binding/challenge", headers=self.s1_headers)
        ch_token = ch_res.json()["challenge_token"]
        bad_sig = _sign_challenge_p1363(priv_wrong, ch_token)

        qr_token = self._get_active_qr_token()
        scan_res = self.client.post(
            "/api/v1/student/scan-session",
            json={"session_token": qr_token, "challenge_token": ch_token, "binding_signature": bad_sig},
            headers=self.s1_headers
        )
        self.assertEqual(scan_res.status_code, 401)
        self.assertIn("signature verification failed", scan_res.json()["detail"].lower())

    # =========================================================================
    # TEST 6: Challenge Nonce Replay Attack Rejected
    # =========================================================================
    def test_06_challenge_replay_attack_rejected(self):
        """Submitting a consumed challenge token a second time is rejected."""
        priv, spki, key_id = _generate_p256_keypair()
        self.client.post("/api/v1/binding/enroll", json={"public_key": spki, "key_id": key_id}, headers=self.s1_headers)

        ch_res = self.client.post("/api/v1/binding/challenge", headers=self.s1_headers)
        ch_token = ch_res.json()["challenge_token"]
        sig = _sign_challenge_p1363(priv, ch_token)
        qr_token = self._get_active_qr_token()

        # First scan consumes nonce
        res1 = self.client.post(
            "/api/v1/student/scan-session",
            json={"session_token": qr_token, "challenge_token": ch_token, "binding_signature": sig},
            headers=self.s1_headers
        )
        self.assertEqual(res1.status_code, 200)

        # Second scan with SAME challenge token must be rejected
        res2 = self.client.post(
            "/api/v1/student/scan-session",
            json={"session_token": qr_token, "challenge_token": ch_token, "binding_signature": sig},
            headers=self.s1_headers
        )
        self.assertEqual(res2.status_code, 401)
        self.assertIn("already been used", res2.json()["detail"].lower())

    # =========================================================================
    # TEST 7: Expired Challenge Token Rejected
    # =========================================================================
    def test_07_expired_challenge_token_rejected(self):
        """Challenge token beyond TTL (60s) is rejected."""
        priv, spki, key_id = _generate_p256_keypair()
        self.client.post("/api/v1/binding/enroll", json={"public_key": spki, "key_id": key_id}, headers=self.s1_headers)

        expired_ch = create_challenge_token(
            student_id=self.student1.id,
            roll_number=self.student1.roll_number,
            ttl_seconds=60,
            issue_time=int(time.time()) - 120
        )["challenge_token"]

        sig = _sign_challenge_p1363(priv, expired_ch)
        qr_token = self._get_active_qr_token()

        res = self.client.post(
            "/api/v1/student/scan-session",
            json={"session_token": qr_token, "challenge_token": expired_ch, "binding_signature": sig},
            headers=self.s1_headers
        )
        self.assertEqual(res.status_code, 401)
        self.assertIn("expired", res.json()["detail"].lower())

    # =========================================================================
    # TEST 8: Network Retry & Duplicate Attendance Scan Prevention
    # =========================================================================
    def test_08_duplicate_attendance_scan_prevention(self):
        """Student scans once -> retry scan returns ALREADY_MARKED without duplicate row."""
        priv, spki, key_id = _generate_p256_keypair()
        self.client.post("/api/v1/binding/enroll", json={"public_key": spki, "key_id": key_id}, headers=self.s1_headers)
        qr_token = self._get_active_qr_token()

        # Scan 1
        ch1 = self.client.post("/api/v1/binding/challenge", headers=self.s1_headers).json()["challenge_token"]
        sig1 = _sign_challenge_p1363(priv, ch1)
        res1 = self.client.post(
            "/api/v1/student/scan-session",
            json={"session_token": qr_token, "challenge_token": ch1, "binding_signature": sig1},
            headers=self.s1_headers
        )
        self.assertEqual(res1.status_code, 200)
        self.assertEqual(res1.json()["status"], "SUCCESS")

        # Scan 2 with fresh challenge token (simulating client retry after response drop)
        ch2 = self.client.post("/api/v1/binding/challenge", headers=self.s1_headers).json()["challenge_token"]
        sig2 = _sign_challenge_p1363(priv, ch2)
        res2 = self.client.post(
            "/api/v1/student/scan-session",
            json={"session_token": qr_token, "challenge_token": ch2, "binding_signature": sig2},
            headers=self.s1_headers
        )
        self.assertEqual(res2.status_code, 200)
        self.assertEqual(res2.json()["status"], "ALREADY_MARKED")

    # =========================================================================
    # TEST 9: Concurrent Multi-Threaded Double-Enrollment Race Safety
    # =========================================================================
    def test_09_concurrent_enrollment_race_safety(self):
        """Concurrent requests to enroll for the same student preserve single active binding invariant."""
        def override_concurrent_db():
            db = self.SessionLocal()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_concurrent_db
        results = []

        def enroll_attempt(idx):
            priv, spki, key_id = _generate_p256_keypair()
            local_client = TestClient(app)
            r = local_client.post(
                "/api/v1/binding/enroll",
                json={"public_key": spki, "key_id": key_id},
                headers=self.s1_headers
            )
            return r.status_code

        try:
            with ThreadPoolExecutor(max_workers=5) as executor:
                futures = [executor.submit(enroll_attempt, i) for i in range(5)]
                for f in futures:
                    results.append(f.result())

            for sc in results:
                self.assertIn(sc, [200, 409])

            # Exactly one active binding row must exist
            verify_db = self.SessionLocal()
            try:
                active_count = verify_db.query(DeviceBinding).filter(
                    DeviceBinding.student_id == self.student1.id,
                    DeviceBinding.revoked_at.is_(None)
                ).count()
                self.assertEqual(active_count, 1, f"Expected exactly 1 active binding, found {active_count}")
            finally:
                verify_db.close()
        finally:
            def override_get_db():
                try:
                    yield self.db
                finally:
                    pass
            app.dependency_overrides[get_db] = override_get_db

    # =========================================================================
    # TEST 10: Idempotent Re-Enrollment with Identical Key
    # =========================================================================
    def test_10_idempotent_re_enrollment_same_key(self):
        """Enrolling identical public key returns BINDING_REFRESH without OTP friction."""
        priv, spki, key_id = _generate_p256_keypair()

        res1 = self.client.post("/api/v1/binding/enroll", json={"public_key": spki, "key_id": key_id}, headers=self.s1_headers)
        self.assertEqual(res1.status_code, 200)
        self.assertEqual(res1.json()["status"], "DEVICE_ENROLLED")

        res2 = self.client.post("/api/v1/binding/enroll", json={"public_key": spki, "key_id": key_id, "storage_persist_granted": True}, headers=self.s1_headers)
        self.assertEqual(res2.status_code, 200)
        self.assertEqual(res2.json()["status"], "BINDING_REFRESH")

        # Must still be only 1 row
        total_rows = self.db.query(DeviceBinding).filter(DeviceBinding.student_id == self.student1.id).count()
        self.assertEqual(total_rows, 1)

    # =========================================================================
    # TEST 11: Admin Revocation + Fresh Re-Enrollment Workflow
    # =========================================================================
    def test_11_admin_revocation_allows_immediate_reenrollment(self):
        """Faculty revokes binding -> student enrolls fresh device without OTP and scans."""
        priv1, spki1, key_id1 = _generate_p256_keypair()
        self.client.post("/api/v1/binding/enroll", json={"public_key": spki1, "key_id": key_id1}, headers=self.s1_headers)

        # Admin/Faculty revokes
        revoke_res = self.client.post(f"/api/v1/binding/admin/revoke/{self.student1.id}", headers=self.t_headers)
        self.assertEqual(revoke_res.status_code, 200)
        self.assertEqual(revoke_res.json()["status"], "BINDING_REVOKED")

        # Student enrolls new key cleanly
        priv2, spki2, key_id2 = _generate_p256_keypair()
        enroll_res = self.client.post("/api/v1/binding/enroll", json={"public_key": spki2, "key_id": key_id2}, headers=self.s1_headers)
        self.assertEqual(enroll_res.status_code, 200)
        self.assertEqual(enroll_res.json()["status"], "DEVICE_ENROLLED")

    # =========================================================================
    # TEST 12: 30-Day Churn Rate Limit Enforcement
    # =========================================================================
    def test_12_churn_limit_30_days_enforcement(self):
        """Student performing > 2 self-rebinds in 30 days is blocked with 429 CHURN_LIMIT_EXCEEDED."""
        now = datetime.utcnow()
        # Seed 2 prior rebind rows in last 30 days
        for i in range(2):
            _, spki, kid = _generate_p256_keypair()
            row = DeviceBinding(
                student_id=self.student1.id,
                public_key=spki,
                key_id=kid,
                enrolled_at=now - timedelta(days=i + 1),
                enrolled_via="self",
                revoked_at=now - timedelta(hours=1),
                revoked_reason="rebind"
            )
            self.db.add(row)
        self.db.commit()

        # 3rd attempt
        _, spki3, kid3 = _generate_p256_keypair()
        res = self.client.post("/api/v1/binding/enroll", json={"public_key": spki3, "key_id": kid3}, headers=self.s1_headers)
        self.assertEqual(res.status_code, 429)
        data = res.json()
        err_type = data.get("error_type") or data.get("detail", {}).get("error_type")
        self.assertEqual(err_type, "CHURN_LIMIT_EXCEEDED")

    # =========================================================================
    # TEST 13: Admin Reset Exemption from Churn Budget
    # =========================================================================
    def test_13_admin_churn_exemption(self):
        """Admin resets are not counted against student's 2-rebind 30-day budget."""
        now = datetime.utcnow()
        for i in range(5):
            _, spki, kid = _generate_p256_keypair()
            row = DeviceBinding(
                student_id=self.student1.id,
                public_key=spki,
                key_id=kid,
                enrolled_at=now - timedelta(days=i + 1),
                enrolled_via="faculty_reset",
                revoked_at=now - timedelta(hours=1),
                revoked_reason="admin_reset"
            )
            self.db.add(row)
        self.db.commit()

        # Student can still enroll because revoked_reason != 'rebind'
        _, spki_fresh, kid_fresh = _generate_p256_keypair()
        res = self.client.post("/api/v1/binding/enroll", json={"public_key": spki_fresh, "key_id": kid_fresh}, headers=self.s1_headers)
        self.assertEqual(res.status_code, 200)

    # =========================================================================
    # TEST 14: Brute-Force Signature Lockout (5 failures -> 429)
    # =========================================================================
    def test_14_brute_force_signature_failure_lockout(self):
        """5 consecutive signature verification failures trigger 15-minute lockout."""
        priv_real, spki_real, key_id_real = _generate_p256_keypair()
        self.client.post("/api/v1/binding/enroll", json={"public_key": spki_real, "key_id": key_id_real}, headers=self.s1_headers)

        priv_wrong, _, _ = _generate_p256_keypair()
        qr_token = self._get_active_qr_token()

        for attempt in range(5):
            ch = self.client.post("/api/v1/binding/challenge", headers=self.s1_headers).json()["challenge_token"]
            bad_sig = _sign_challenge_p1363(priv_wrong, ch)
            res = self.client.post(
                "/api/v1/student/scan-session",
                json={"session_token": qr_token, "challenge_token": ch, "binding_signature": bad_sig},
                headers=self.s1_headers
            )
            self.assertEqual(res.status_code, 401)

        # 6th attempt hits lockout
        ch_lock = self.client.post("/api/v1/binding/challenge", headers=self.s1_headers).json()["challenge_token"]
        good_sig = _sign_challenge_p1363(priv_real, ch_lock)
        res_lock = self.client.post(
            "/api/v1/student/scan-session",
            json={"session_token": qr_token, "challenge_token": ch_lock, "binding_signature": good_sig},
            headers=self.s1_headers
        )
        self.assertEqual(res_lock.status_code, 429)
        self.assertIn("locked", res_lock.json()["detail"].lower())

    # =========================================================================
    # TEST 15: Self-Service Device Reset Revokes Active V2 Binding
    # =========================================================================
    def test_15_self_service_device_reset_revokes_v2_binding(self):
        """Calling /api/v1/devices/verify-reset with valid OTP revokes active DeviceBinding row."""
        priv, spki, key_id = _generate_p256_keypair()
        self.client.post("/api/v1/binding/enroll", json={"public_key": spki, "key_id": key_id}, headers=self.s1_headers)

        # Seed valid DeviceResetOTP in DB
        test_otp = "654321"
        otp_rec = DeviceResetOTP(
            roll_number=self.student1.roll_number,
            email=self.student1.email,
            otp_hash=hashlib.sha256(test_otp.encode("utf-8")).hexdigest(),
            expires_at=datetime.utcnow() + timedelta(minutes=10),
            attempts=0,
            is_consumed=False
        )
        self.db.add(otp_rec)
        self.db.commit()

        reset_res = self.client.post(
            "/api/v1/devices/verify-reset",
            json={
                "roll_number": self.student1.roll_number,
                "otp": test_otp,
                "new_device_public_id": "DEV-NEW-P6",
                "new_device_secret": "SECRET-P6"
            }
        )
        self.assertEqual(reset_res.status_code, 200)

        # Verify active V2 binding was revoked
        active = self.db.query(DeviceBinding).filter(
            DeviceBinding.student_id == self.student1.id,
            DeviceBinding.revoked_at.is_(None)
        ).first()
        self.assertIsNone(active, "Active DeviceBinding should be revoked after reset")

    # =========================================================================
    # TEST 16: Zero Raw Key Material in Audit Logs
    # =========================================================================
    def test_16_zero_raw_key_material_in_audit_logs(self):
        """Verifies that audit trail contains zero private keys, zero raw signatures, and zero plaintext secrets."""
        priv, spki, key_id = _generate_p256_keypair()
        self.client.post("/api/v1/binding/enroll", json={"public_key": spki, "key_id": key_id}, headers=self.s1_headers)

        logs = self.db.query(AuditLog).all()
        self.assertGreater(len(logs), 0)

        for log in logs:
            text = f"{log.details or ''} {log.action or ''}"
            self.assertNotIn("PRIVATE KEY", text.upper())
            self.assertNotIn("BEGIN EC PRIVATE KEY", text.upper())
            self.assertNotIn(spki, text)


if __name__ == "__main__":
    unittest.main()
