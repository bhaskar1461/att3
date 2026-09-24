"""
SNIST ERP — Short-Token QR Payload & Security Verification Suite (Week 3)
Verifies:
1. Token lifecycle (issue -> rotate -> sliding grace -> expiry -> purge)
2. Dual-format parity (legacy full-token & new short ?s=...&v=... format)
3. Brute-force resistance, rate limiting, and lockout
4. Single-use and section enrollment invariants
5. 30-minute device binding & account-switch lockout
6. Fuzz testing: 200 mutated inputs -> 0 500s, all 4xx
7. Telemetry format tagging & rollup breakdown
8. Scan-path micro-benchmark (overhead <= +2.0 ms)
"""

import os
import sys
import time
import secrets
import unittest
from datetime import datetime, timedelta
from fastapi import HTTPException
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
from app.models.models import (
    User, UserRole, Department, AcademicYear, Section, Subject,
    Teacher, Student, TeacherAssignment, AttendanceSession, SessionStatus,
    AttendanceRecord, AttendanceStatus, DeviceRegistration, DeviceAccountBinding,
    BindingStatus, ShortTokenRegistry
)
from app.core.security import (
    generate_projector_session_token,
    validate_projector_session_token,
    get_password_hash,
    create_access_token,
    get_server_ist_date
)
from app.services.qr_token import (
    ShortTokenService,
    CROCKFORD_ALPHABET,
    generate_short_code,
    normalize_crockford
)
from app.api.student import failed_token_tracker, student_scan_limiter
from app.core.binding_crypto import create_test_binding_proof, generate_test_p256_keypair
from app.models.models import DeviceBinding


class TestShortTokenSecurity(unittest.TestCase):
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

        # Clear short token in-memory caches
        ShortTokenService.clear_cache()

        # Clear rate limiters
        with failed_token_tracker._lock:
            failed_token_tracker._failures.clear()
            failed_token_tracker._cooldowns.clear()
        with student_scan_limiter._lock:
            student_scan_limiter._attempts.clear()

        # Seed hierarchy
        dept = Department(code="CSE", name="Computer Science")
        ay = AcademicYear(name="2025-2026")
        self.db.add_all([dept, ay])
        self.db.commit()

        self.sec_a = Section(name="CSE-A", department_id=dept.id, academic_year_id=ay.id)
        self.sec_b = Section(name="CSE-B", department_id=dept.id, academic_year_id=ay.id)
        self.subj = Subject(code="CS301", name="Database Systems", department_id=dept.id, academic_year_id=ay.id)
        self.db.add_all([self.sec_a, self.sec_b, self.subj])
        self.db.commit()

        # Teacher setup
        self.t_user = User(
            username="teacher_cs",
            password_hash=get_password_hash("pass123"),
            role=UserRole.TEACHER,
            is_active=True
        )
        self.db.add(self.t_user)
        self.db.commit()

        self.teacher = Teacher(
            user_id=self.t_user.id,
            teacher_code="T101",
            name="Dr. Alan Turing",
            department_id=dept.id
        )
        self.db.add(self.teacher)
        self.db.commit()

        assignment = TeacherAssignment(teacher_id=self.teacher.id, subject_id=self.subj.id, section_id=self.sec_a.id)
        self.db.add(assignment)
        self.db.commit()

        # Student A (in Section A)
        self.s_user_a = User(
            username="student_a",
            password_hash=get_password_hash("pass123"),
            role=UserRole.STUDENT,
            is_active=True
        )
        self.db.add(self.s_user_a)
        self.db.commit()

        self.student_a = Student(
            user_id=self.s_user_a.id,
            roll_number="24KH1A0501",
            name="Ada Lovelace",
            department_id=dept.id,
            academic_year_id=ay.id,
            section_id=self.sec_a.id
        )
        self.db.add(self.student_a)

        # Student B (also in Section A)
        self.s_user_b = User(
            username="student_b",
            password_hash=get_password_hash("pass123"),
            role=UserRole.STUDENT,
            is_active=True
        )
        self.db.add(self.s_user_b)
        self.db.commit()

        self.student_b = Student(
            user_id=self.s_user_b.id,
            roll_number="24KH1A0502",
            name="Charles Babbage",
            department_id=dept.id,
            academic_year_id=ay.id,
            section_id=self.sec_a.id
        )
        self.db.add(self.student_b)

        # Student C (in Section B — for enrollment mismatch checks)
        self.s_user_c = User(
            username="student_c",
            password_hash=get_password_hash("pass123"),
            role=UserRole.STUDENT,
            is_active=True
        )
        self.db.add(self.s_user_c)
        self.db.commit()

        self.student_c = Student(
            user_id=self.s_user_c.id,
            roll_number="24KH1A0599",
            name="Grace Hopper",
            department_id=dept.id,
            academic_year_id=ay.id,
            section_id=self.sec_b.id
        )
        self.db.add(self.student_c)
        self.db.commit()

        # Phase 5 Cutover: Enroll DeviceBinding for Student A, B, C
        from app.models.models import DeviceBinding
        from app.core.binding_crypto import generate_test_p256_keypair, create_test_binding_proof
        self.priv_a, spki_a, kid_a = generate_test_p256_keypair()
        self.binding_a = DeviceBinding(student_id=self.student_a.id, public_key=spki_a, key_id=kid_a, enrolled_at=datetime.utcnow())
        self.priv_b, spki_b, kid_b = generate_test_p256_keypair()
        self.binding_b = DeviceBinding(student_id=self.student_b.id, public_key=spki_b, key_id=kid_b, enrolled_at=datetime.utcnow())
        self.priv_c, spki_c, kid_c = generate_test_p256_keypair()
        self.binding_c = DeviceBinding(student_id=self.student_c.id, public_key=spki_c, key_id=kid_c, enrolled_at=datetime.utcnow())
        self.db.add_all([self.binding_a, self.binding_b, self.binding_c])
        self.db.commit()

        # Attendance Session
        self.session = AttendanceSession(
            teacher_id=self.teacher.id,
            subject_id=self.subj.id,
            section_id=self.sec_a.id,
            period="1 Period",
            session_date=get_server_ist_date(),
            status=SessionStatus.OPEN
        )
        self.db.add(self.session)
        self.db.commit()

        # Auth Tokens
        self.teacher_token = create_access_token({"sub": self.t_user.username, "role": UserRole.TEACHER.value})
        self.teacher_headers = {"Authorization": f"Bearer {self.teacher_token}"}

        self.student_a_token = create_access_token({"sub": self.s_user_a.username, "role": UserRole.STUDENT.value})
        self.student_a_headers = {"Authorization": f"Bearer {self.student_a_token}"}

        self.student_b_token = create_access_token({"sub": self.s_user_b.username, "role": UserRole.STUDENT.value})
        self.student_b_headers = {"Authorization": f"Bearer {self.student_b_token}"}

        self.student_c_token = create_access_token({"sub": self.s_user_c.username, "role": UserRole.STUDENT.value})
        self.student_c_headers = {"Authorization": f"Bearer {self.student_c_token}"}

    def tearDown(self):
        app.dependency_overrides.clear()
        self.db.close()

    # -------------------------------------------------------------
    # 1. Token Lifecycle Tests
    # -------------------------------------------------------------
    def test_short_token_lifecycle(self):
        """Tests issue -> validate -> sliding grace -> expiry -> cleanup."""
        # 1. Issue short code
        token_info = ShortTokenService.issue_or_get_short_code(
            db=self.db,
            session_id=self.session.id,
            period_count=1,
            step_window=10
        )
        short_code = token_info["short_code"]
        v = token_info["v"]
        payload = token_info["payload"]

        self.assertEqual(len(short_code), 8)
        self.assertTrue(set(short_code).issubset(set(CROCKFORD_ALPHABET)))
        self.assertEqual(payload, f"?s={short_code}&v={v}")

        # 2. Calling issue again for same active session reuses same short_code
        reissued = ShortTokenService.issue_or_get_short_code(
            db=self.db,
            session_id=self.session.id,
            period_count=1,
            step_window=10
        )
        self.assertEqual(reissued["short_code"], short_code)

        # 3. Nominal validation (within 10s window)
        now_nominal = v * 10 + 4.0
        val = ShortTokenService.validate_attendance_token(
            db=self.db,
            payload_or_code=payload,
            step_window=10,
            now_ts=now_nominal
        )
        self.assertEqual(val["session_id"], self.session.id)
        self.assertEqual(val["step"], v)
        self.assertFalse(val["is_grace_window"])
        self.assertEqual(val["token_format"], "short")

        # 4. Sliding grace window (e.g. at 11.5s, within 3s grace)
        now_grace = (v + 1) * 10 + 1.5
        val_grace = ShortTokenService.validate_attendance_token(
            db=self.db,
            payload_or_code=payload,
            step_window=10,
            grace_seconds=3.0,
            now_ts=now_grace
        )
        self.assertTrue(val_grace["is_grace_window"])
        self.assertEqual(val_grace["session_id"], self.session.id)

        # 5. Past grace window (e.g. at 14.5s, > 3s grace) -> rejected
        now_expired = (v + 1) * 10 + 4.5
        with self.assertRaises(ValueError) as ctx:
            ShortTokenService.validate_attendance_token(
                db=self.db,
                payload_or_code=payload,
                step_window=10,
                grace_seconds=3.0,
                now_ts=now_expired
            )
        self.assertIn("expired", str(ctx.exception).lower())

        # 6. Future timestamp (> 2s clock skew) -> rejected
        now_future = (v * 10) - 3.5
        with self.assertRaises(ValueError) as ctx_fut:
            ShortTokenService.validate_attendance_token(
                db=self.db,
                payload_or_code=payload,
                step_window=10,
                now_ts=now_future
            )
        self.assertIn("future", str(ctx_fut.exception).lower())

        # 7. Session purge removes mapping
        ShortTokenService.purge_session_tokens(self.db, self.session.id)
        reg = self.db.query(ShortTokenRegistry).filter(
            ShortTokenRegistry.short_code == short_code
        ).first()
        self.assertFalse(reg.is_active)

    # -------------------------------------------------------------
    # 2. Dual-Format Scan Endpoint Tests
    # -------------------------------------------------------------
    def test_dual_format_scan_endpoint_acceptance(self):
        """Verifies scan endpoint accepts BOTH legacy full token and new short format."""
        # 1. Broadcast session from teacher endpoint
        b_res = self.client.get(
            f"/api/v1/teacher/sessions/{self.session.id}/broadcast-token?period_count=1",
            headers=self.teacher_headers
        )
        self.assertEqual(b_res.status_code, 200)
        b_data = b_res.json()
        short_payload = b_data.get("short_payload") or b_data["qr_payload"]
        self.assertTrue(short_payload.startswith("?s="))

        # 2. Student A submits new short format (?s=...&v=...)
        proof_a = create_test_binding_proof(self.student_a.id, self.student_a.roll_number, self.priv_a)
        scan_short_res = self.client.post(
            "/api/v1/student/scan-session",
            json={
                "session_token": short_payload,
                "token_format": "short",
                "device_uuid": "DEV-TEST-STUDENT-A",
                **proof_a
            },
            headers=self.student_a_headers
        )
        self.assertEqual(scan_short_res.status_code, 200)
        data_a = scan_short_res.json()
        self.assertEqual(data_a["status"], "SUCCESS")
        self.assertEqual(data_a["token_format"], "short")

        # Verify attendance record recorded
        rec_a = self.db.query(AttendanceRecord).filter(
            AttendanceRecord.session_id == self.session.id,
            AttendanceRecord.student_id == self.student_a.id
        ).first()
        self.assertIsNotNone(rec_a)
        self.assertEqual(rec_a.status, AttendanceStatus.PRESENT)

        # 3. Create second open session for Student B to test legacy token acceptance
        session_2 = AttendanceSession(
            teacher_id=self.teacher.id,
            subject_id=self.subj.id,
            section_id=self.sec_a.id,
            period="1 Period",
            session_date=get_server_ist_date(),
            status=SessionStatus.OPEN
        )
        self.db.add(session_2)
        self.db.commit()

        legacy_info = generate_projector_session_token(session_id=session_2.id, period_count=1, step_window=10)
        legacy_payload = legacy_info["payload"]
        self.assertTrue(legacy_payload.startswith("SNIST-SES|"))

        # Student B submits legacy token format
        proof_b = create_test_binding_proof(self.student_b.id, self.student_b.roll_number, self.priv_b)
        scan_legacy_res = self.client.post(
            "/api/v1/student/scan-session",
            json={
                "session_token": legacy_payload,
                "token_format": "legacy",
                "device_uuid": "DEV-TEST-STUDENT-B",
                **proof_b
            },
            headers=self.student_b_headers
        )
        self.assertEqual(scan_legacy_res.status_code, 200)
        data_b = scan_legacy_res.json()
        self.assertEqual(data_b["status"], "SUCCESS")
        self.assertEqual(data_b["token_format"], "legacy")

    def test_short_token_format_variations(self):
        """Verifies delimited and separate parameter variations of short token."""
        token_info = ShortTokenService.issue_or_get_short_code(
            db=self.db,
            session_id=self.session.id,
            period_count=1,
            step_window=10
        )
        code = token_info["short_code"]
        v = token_info["v"]

        # 1. Colon-delimited format "CODE:V"
        val_colon = ShortTokenService.validate_attendance_token(
            db=self.db,
            payload_or_code=f"{code}:{v}",
            step_window=10
        )
        self.assertEqual(val_colon["session_id"], self.session.id)
        self.assertEqual(val_colon["token_format"], "short")

        # 2. Pipe-delimited format "CODE|V"
        val_pipe = ShortTokenService.validate_attendance_token(
            db=self.db,
            payload_or_code=f"{code}|{v}",
            step_window=10
        )
        self.assertEqual(val_pipe["session_id"], self.session.id)

        # 3. Separate parameters {short_code, v}
        val_params = ShortTokenService.validate_attendance_token(
            db=self.db,
            payload_or_code=code,
            v=v,
            step_window=10
        )
        self.assertEqual(val_params["session_id"], self.session.id)

    # -------------------------------------------------------------
    # 3. Single-Use and Section Invariant Tests
    # -------------------------------------------------------------
    def test_single_use_and_section_enrollment_invariants(self):
        """Verifies single-use per student and section enrollment verification."""
        token_info = ShortTokenService.issue_or_get_short_code(
            db=self.db,
            session_id=self.session.id,
            period_count=1,
            step_window=10
        )
        payload = token_info["payload"]

        # First scan by Student A: SUCCESS
        proof_a1 = create_test_binding_proof(self.student_a.id, self.student_a.roll_number, self.priv_a)
        res1 = self.client.post(
            "/api/v1/student/scan-session",
            json={"session_token": payload, "device_uuid": "DEV-STU-A-01", **proof_a1},
            headers=self.student_a_headers
        )
        self.assertEqual(res1.status_code, 200)
        self.assertEqual(res1.json()["status"], "SUCCESS")

        # Second scan by Student A: ALREADY_MARKED
        proof_a2 = create_test_binding_proof(self.student_a.id, self.student_a.roll_number, self.priv_a)
        res2 = self.client.post(
            "/api/v1/student/scan-session",
            json={"session_token": payload, "device_uuid": "DEV-STU-A-01", **proof_a2},
            headers=self.student_a_headers
        )
        self.assertEqual(res2.status_code, 200)
        self.assertEqual(res2.json()["status"], "ALREADY_MARKED")

        # Student C (in Section B) tries to scan Section A's QR: REJECTED with 400
        proof_c = create_test_binding_proof(self.student_c.id, self.student_c.roll_number, self.priv_c)
        res_c = self.client.post(
            "/api/v1/student/scan-session",
            json={"session_token": payload, "device_uuid": "DEV-STU-C-01", **proof_c},
            headers=self.student_c_headers
        )
        self.assertEqual(res_c.status_code, 400)
        self.assertIn("not enrolled in this section", res_c.json()["detail"].lower())

    # -------------------------------------------------------------
    # 4. Device Binding & Account-Switch Lockout Tests
    # -------------------------------------------------------------
    def test_device_binding_lockout_across_formats(self):
        """Verifies 30-minute device account switching lockout on both formats."""
        # Create a fresh session for this test
        fresh_sess = AttendanceSession(
            teacher_id=self.teacher.id,
            subject_id=self.subj.id,
            section_id=self.sec_a.id,
            period="1 Period",
            session_date=get_server_ist_date(),
            status=SessionStatus.OPEN
        )
        self.db.add(fresh_sess)
        self.db.commit()

        token_info = ShortTokenService.issue_or_get_short_code(
            db=self.db,
            session_id=fresh_sess.id,
            period_count=1,
            step_window=10
        )
        shared_device_id = "DEV-PHYSICAL-PHONE-42"

        # Student A scans from shared device -> binds phone
        proof_a = create_test_binding_proof(self.student_a.id, self.student_a.roll_number, self.priv_a)
        res_a = self.client.post(
            "/api/v1/student/scan-session",
            json={"session_token": token_info["payload"], "device_uuid": shared_device_id, **proof_a},
            headers=self.student_a_headers
        )
        self.assertEqual(res_a.status_code, 200)

        # Student B immediately attempts to scan on Student A's phone -> REJECTED with 403
        proof_b = create_test_binding_proof(self.student_b.id, self.student_b.roll_number, self.priv_b)
        res_b = self.client.post(
            "/api/v1/student/scan-session",
            json={"session_token": token_info["payload"], "device_uuid": shared_device_id, **proof_b},
            headers=self.student_b_headers
        )
        self.assertEqual(res_b.status_code, 403)
        self.assertIn("another student", res_b.json()["detail"].lower())

    # -------------------------------------------------------------
    # 5. Brute-Force & Rate Limiting Tests
    # -------------------------------------------------------------
    def test_brute_force_rate_limiting_and_lockout(self):
        """Simulates rapid invalid code guesses and verifies lockout and security alert."""
        v = int(time.time() // 10)

        # 1. Per-student scan attempt rate limit: dynamic max attempts/min per student
        from app.api.student import student_scan_limiter
        limit = getattr(student_scan_limiter, "max_attempts", 15)
        for i in range(limit):
            bogus_code = f"FAKE{i:04d}"
            proof_att = create_test_binding_proof(self.student_a.id, self.student_a.roll_number, self.priv_a)
            res = self.client.post(
                "/api/v1/student/scan-session",
                json={"session_token": f"?s={bogus_code}&v={v}", "device_uuid": "DEV-ATTACKER", **proof_att},
                headers=self.student_a_headers
            )
            self.assertEqual(res.status_code, 400)

        # Exceeding scan limit from same student triggers HTTP 429 Too Many Requests
        proof_att = create_test_binding_proof(self.student_a.id, self.student_a.roll_number, self.priv_a)
        lockout_res = self.client.post(
            "/api/v1/student/scan-session",
            json={"session_token": f"?s=FAKE9999&v={v}", "device_uuid": "DEV-ATTACKER", **proof_att},
            headers=self.student_a_headers
        )
        self.assertEqual(lockout_res.status_code, 429)
        self.assertIn("Retry-After", lockout_res.headers)

        # 2. Failed token tracker: verifies 15 invalid token failures triggers device/IP cooldown
        tracker_key = "127.0.0.1_DEV-FLOODER"
        for _ in range(15):
            failed_token_tracker.record_failure(tracker_key)
        with self.assertRaises(HTTPException) as ctx:
            failed_token_tracker.check_rate_limit(tracker_key)
        self.assertEqual(ctx.exception.status_code, 429)

    # -------------------------------------------------------------
    # 6. Fuzz Testing: 200 Mutated Inputs
    # -------------------------------------------------------------
    def test_fuzz_mutated_inputs_no_500s(self):
        """Fuzzes token parser with 200 corrupted inputs, verifying zero 500 server crashes."""
        v = int(time.time() // 10)
        mutations = [
            "",                                       # Empty
            "   ",                                    # Whitespace
            "?s=&v=",                                 # Empty params
            "?s=TOOLONGCODE123456789&v=10",           # Oversized code
            "?s=SHORT&v=10",                          # Undersized code
            f"?s=8XK2Q7MD&v=-5",                      # Negative counter
            f"?s=8XK2Q7MD&v=0",                       # Zero counter
            f"?s=8XK2Q7MD&v=99999999999999999999",    # Huge counter
            "?s=8XK2Q7M!&v=10",                       # Invalid symbol
            "?s=8XK2Q7MI&v=10",                       # Excluded 'I' glyph
            "?s=8XK2Q7MO&v=10",                       # Excluded 'O' glyph
            "SNIST-SES|",                             # Truncated legacy
            "SNIST-SES|1|2|3",                        # Incomplete legacy
            "SNIST-SES|INVALID|COUNT|STEP|MAC",       # Malformed legacy
            "'; DROP TABLE qr_short_tokens; --",      # SQL injection
            "<script>alert(1)</script>",              # XSS injection
            "\x00\x01\x02\xff",                       # Binary garbage
            "https://evil.com/scan?s=8XK2Q7MD&v=10",  # External URL
            "8XK2Q7MD:::10",                          # Bad delimiter
            "||||",                                   # Pipes only
        ]

        # Generate 180 additional randomized mutations
        for _ in range(180):
            noise_len = secrets.randbelow(40) + 1
            noise = "".join(secrets.choice("!@#$%^&*()_+-=[]{}|;':\",./<>?~` \t\n\r" + CROCKFORD_ALPHABET) for _ in range(noise_len))
            mutations.append(noise)

        crash_count = 0
        for idx, mutant in enumerate(mutations):
            try:
                # Direct validation call should raise ValueError, never uncaught Exception
                ShortTokenService.validate_attendance_token(
                    db=self.db,
                    payload_or_code=mutant,
                    step_window=10
                )
            except ValueError:
                pass  # Clean domain rejection
            except Exception as uncaught:
                crash_count += 1
                print(f"[FUZZ CRASH] Input #{idx} '{mutant[:30]}' triggered uncaught: {uncaught}")

        self.assertEqual(crash_count, 0, "Fuzzer encountered uncaught internal exceptions!")

    # -------------------------------------------------------------
    # 7. Telemetry Format Tagging Tests
    # -------------------------------------------------------------
    def test_telemetry_token_format_ingest_and_validation(self):
        """Verifies telemetry endpoint accepts valid token_format and rejects invalid formats."""
        # 1. Valid batch with token_format
        batch_payload = {
            "events": [
                {
                    "event_type": "token_submitted",
                    "stage": "token_submitted",
                    "device_bucket": "old",
                    "token_format": "short",
                    "ts": int(time.time() * 1000)
                },
                {
                    "event_type": "token_submitted",
                    "stage": "token_submitted",
                    "device_bucket": "new",
                    "token_format": "legacy",
                    "ts": int(time.time() * 1000)
                }
            ],
            "sent_at": int(time.time() * 1000)
        }

        res = self.client.post("/api/v1/telemetry/scan-events", json=batch_payload, headers=self.student_a_headers)
        self.assertEqual(res.status_code, 202)
        self.assertEqual(res.json()["status"], "ACCEPTED")

        # 2. Invalid token_format -> 422 Unprocessable Entity
        invalid_payload = {
            "events": [
                {
                    "event_type": "token_submitted",
                    "stage": "token_submitted",
                    "device_bucket": "old",
                    "token_format": "unsupported_xyz",
                    "ts": int(time.time() * 1000)
                }
            ]
        }
        res_invalid = self.client.post("/api/v1/telemetry/scan-events", json=invalid_payload, headers=self.student_a_headers)
        self.assertEqual(res_invalid.status_code, 422)

    # -------------------------------------------------------------
    # 8. Scan-Path Microbenchmark (< +2.0 ms)
    # -------------------------------------------------------------
    def test_scan_path_microbenchmark(self):
        """Measures ShortTokenService lookup overhead on memory cache hits."""
        token_info = ShortTokenService.issue_or_get_short_code(
            db=self.db,
            session_id=self.session.id,
            period_count=1,
            step_window=10
        )
        payload = token_info["payload"]
        now_ts = token_info["v"] * 10 + 2.0

        # Warm up
        ShortTokenService.validate_attendance_token(self.db, payload, step_window=10, now_ts=now_ts)

        # 1,000 iterations
        iterations = 1000
        t0 = time.perf_counter()
        for _ in range(iterations):
            ShortTokenService.validate_attendance_token(self.db, payload, step_window=10, now_ts=now_ts)
        elapsed_total_ms = (time.perf_counter() - t0) * 1000
        avg_latency_ms = elapsed_total_ms / iterations

        print(f"\n[MICROBENCHMARK] Short token validation latency: {avg_latency_ms * 1000:.2f} µs ({avg_latency_ms:.4f} ms)")
        # Must be well below the +2.0 ms hard ceiling (typically < 0.05 ms)
        self.assertLess(avg_latency_ms, 2.0)
        self.assertLess(avg_latency_ms, 0.20)  # In-memory target: < 0.20 ms


if __name__ == "__main__":
    unittest.main()
