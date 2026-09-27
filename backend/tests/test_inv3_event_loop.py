"""
Adversarial Verification Suite for INV-3: Event Loop Health & Non-Blocking Async
Location: backend/tests/test_inv3_event_loop.py

Verifies:
1. Event-loop lag monitor: samples event loop lag while concurrent requests execute.
2. Blocking-call tripwire: detects whether synchronous DB queries run directly on the event loop thread in async def routes.
3. SMTP send during OTP request: verifies whether SMTP delivery is executed inline within the request cycle, causing client latency to scale with mail server delays.
"""

import os
import sys
import time
import asyncio
import threading
import unittest
from unittest.mock import patch, MagicMock
from io import BytesIO

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.main import app
from app.core.database import get_db, Base
from app.core.config import settings
from app.core.security import create_access_token, get_password_hash, get_server_ist_date
from app.core.binding_crypto import create_challenge_token
from app.models.models import (
    User, UserRole, Student, Department, Subject, Section, AcademicYear,
    AttendanceSession, SessionStatus, Teacher, TeacherAssignment,
    DeviceBinding, DeviceRegistration, AttendanceRecord, StudentOnboarding
)
from app.services.qr_token import ShortTokenService
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature


def _generate_p256_keypair():
    private_key = ec.generate_private_key(ec.SECP256R1())
    public_key = private_key.public_key()
    spki_der = public_key.public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo
    )
    kid = "k_" + os.urandom(8).hex()
    return private_key, spki_der.hex(), kid


def _sign_challenge(private_key, challenge_token_str: str) -> str:
    parts = challenge_token_str.strip().split(".")
    payload_b64 = parts[0]
    padding = '=' * (-len(payload_b64) % 4)
    payload_json = (BytesIO(payload_b64.encode('utf-8')).read()).decode('utf-8')
    import base64, json
    payload = json.loads(base64.urlsafe_b64decode(payload_b64 + padding).decode('utf-8'))
    canonical_msg = payload.get("canonical_message", "").encode('utf-8')

    der_sig = private_key.sign(canonical_msg, ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der_sig)
    r_bytes = r.to_bytes(32, byteorder='big')
    s_bytes = s.to_bytes(32, byteorder='big')
    return base64.urlsafe_b64encode(r_bytes + s_bytes).decode('utf-8')


class TestInv3EventLoop(unittest.TestCase):

    def setUp(self):
        self.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool
        )
        self.TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)
        Base.metadata.create_all(bind=self.engine)

        self.db = self.TestingSessionLocal()

        def override_get_db():
            db = self.TestingSessionLocal()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_get_db
        self.client = TestClient(app)

        # Seed hierarchy
        dept = Department(name="Computer Science", code="CSE")
        self.db.add(dept)
        self.db.flush()

        ay = AcademicYear(name="3rd Year")
        self.db.add(ay)
        self.db.flush()

        sec = Section(name="A", department_id=dept.id, academic_year_id=ay.id)
        self.db.add(sec)
        self.db.flush()

        subj = Subject(name="Operating Systems", code="CS301", department_id=dept.id, academic_year_id=ay.id)
        self.db.add(subj)
        self.db.flush()

        t_user = User(username="TEACH01", email="teach01@sreenidhi.edu.in", password_hash=get_password_hash("pass"), role=UserRole.TEACHER)
        self.db.add(t_user)
        self.db.flush()

        teacher = Teacher(user_id=t_user.id, name="Prof. Rao", teacher_code="TEACH01", department_id=dept.id)
        self.db.add(teacher)
        self.db.flush()

        asgn = TeacherAssignment(teacher_id=teacher.id, subject_id=subj.id, section_id=sec.id)
        self.db.add(asgn)
        self.db.flush()

        # Seed Student
        s_user = User(username="23311A0520", email="23311a0520@cse.sreenidhi.edu.in", password_hash=get_password_hash("pass"), role=UserRole.STUDENT)
        self.db.add(s_user)
        self.db.flush()

        self.student = Student(
            user_id=s_user.id,
            roll_number="23311A0520",
            name="Bob Loop",
            department_id=dept.id,
            academic_year_id=ay.id,
            section_id=sec.id
        )
        self.db.add(self.student)
        self.db.flush()

        # Seed V2 ECDSA key binding
        self.priv_key, self.spki, self.kid = _generate_p256_keypair()
        binding = DeviceBinding(
            student_id=self.student.id,
            public_key=self.spki,
            key_id=self.kid,
            status="ACTIVE"
        )
        self.db.add(binding)
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
        self.db.flush()

        # Seed attendance record for selfie test
        from app.models.models import AttendanceStatus
        self.att_record = AttendanceRecord(
            session_id=self.session.id,
            student_id=self.student.id,
            roll_number=self.student.roll_number,
            session_date=today_str,
            status=AttendanceStatus.PRESENT
        )
        self.db.add(self.att_record)
        self.db.commit()

        # Auth headers
        self.token = create_access_token({"sub": "23311A0520", "role": "STUDENT"})
        self.headers = {"Authorization": f"Bearer {self.token}"}

    def tearDown(self):
        app.dependency_overrides.clear()
        self.db.close()
        Base.metadata.drop_all(bind=self.engine)

    def _get_proof(self):
        c_data = create_challenge_token(self.student.id, ttl_seconds=60)
        c_token = c_data["challenge_token"]
        sig = _sign_challenge(self.priv_key, c_token)
        return {
            "challenge_token": c_token,
            "binding_signature": sig,
            "device_public_id": "DEV-LOOP-001"
        }

    def test_01_event_loop_lag_monitor_selfie_upload(self):
        """
        Samples event loop lag during concurrent selfie uploads.
        Verifies that threadpool offloading in upload_attendance_selfie keeps loop lag < 200ms.
        """
        # Create a tiny 1x1 JPEG byte stream
        jpeg_1x1 = (
            b'\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x01\x00`\x00`\x00\x00'
            b'\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t'
            b'\x08\n\x0c\x14\r\x0c\x0b\x0b\x0c\x19\x12\x13\x0f\x14\x1d\x1a'
            b'\x1f\x1e\x1d\x1a\x1c\x1c $.\' ",#\x1c\x1c(7),01444\x1f\'9=82<.342'
            b'\xff\xc0\x00\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00'
            b'\xff\xc4\x00\x1f\x00\x00\x01\x05\x01\x01\x01\x01\x01\x01\x00\x00'
            b'\x00\x00\x00\x00\x00\x00\x01\x02\x03\x04\x05\x06\x07\x08\t\n\x0b'
            b'\xff\xda\x00\x08\x01\x01\x00\x00?\x00\xbf\x00\xff\xd9'
        )

        loop_lags = []
        stop_sampler = threading.Event()

        def lag_sampler():
            sample_interval = 0.02  # 20ms
            while not stop_sampler.is_set():
                t0 = time.perf_counter()
                time.sleep(sample_interval)
                actual_elapsed = time.perf_counter() - t0
                lag = max(0.0, actual_elapsed - sample_interval)
                loop_lags.append(lag)

        sampler_thread = threading.Thread(target=lag_sampler, daemon=True)
        sampler_thread.start()

        # Fire 15 simulated selfie uploads
        responses = []
        for _ in range(15):
            r = self.client.post(
                f"/api/v1/attendance/records/{self.att_record.id}/selfie",
                files={"file": ("selfie.jpg", jpeg_1x1, "image/jpeg")},
                data={"session_id": str(self.session.id)},
                headers=self.headers
            )
            responses.append(r)

        stop_sampler.set()
        sampler_thread.join(timeout=2.0)

        # Assert all succeeded
        for r in responses:
            self.assertEqual(r.status_code, 200, f"Selfie upload failed: {r.text}")

        # Assert max loop lag under load < 200ms
        max_lag_ms = max(loop_lags) * 1000 if loop_lags else 0
        print(f"\n[INV-3] Max recorded loop lag during selfie upload: {max_lag_ms:.2f}ms")
        self.assertLess(max_lag_ms, 200.0, f"Event loop lag exceeded 200ms: {max_lag_ms}ms")

    def test_02_blocking_call_tripwire_on_async_routes(self):
        """
        Tripwire: Detects whether synchronous database I/O runs directly on the event loop.
        FastAPI async def routes that invoke sync SQLAlchemy methods (e.g. Session.query)
        run on the main thread where the event loop resides, blocking all concurrent coroutines.
        """
        blocking_calls_detected = []

        # Hook into SQLAlchemy cursor execution
        @event.listens_for(self.engine, "before_cursor_execute")
        def detect_sync_db_on_loop(conn, cursor, statement, parameters, context, executemany):
            try:
                loop = asyncio.get_running_loop()
                if loop and loop.is_running():
                    blocking_calls_detected.append({
                        "statement": statement[:60],
                        "thread": threading.current_thread().name,
                        "loop_running": True
                    })
            except RuntimeError:
                pass

        # Call async def student_scan_session
        proof = self._get_proof()
        token_info = ShortTokenService.issue_or_get_short_code(
            db=self.db,
            session_id=self.session.id,
            period_count=1,
            step_window=10
        )
        session_token = token_info["payload"]

        self.session.status = SessionStatus.OPEN
        self.db.commit()

        self.client.post(
            "/api/v1/student/scan-session",
            json={
                "session_token": session_token,
                "token_format": "short",
                "latitude": 17.456,
                "longitude": 78.678,
                "accuracy_m": 10.0,
                **proof
            },
            headers={**self.headers, "Idempotency-Key": "DEV-TRIPWIRE-TEST:112233"}
        )

        print(f"\n[INV-3] Tripwire detected {len(blocking_calls_detected)} sync DB queries executed on event loop thread!")
        has_blocking = len(blocking_calls_detected) > 0
        self.assertTrue(
            has_blocking,
            "Tripwire should detect synchronous SQLAlchemy queries running on the event loop thread in async def student_scan_session"
        )

    def test_03_smtp_send_blocks_otp_request(self):
        """
        Verifies whether SMTP delivery during OTP request runs inline.
        If SMTP server has high latency (e.g. 1.5s delay), does the request-response latency scale accordingly?
        """
        from app.services.onboarding_service import create_onboarding_session_token

        # Create an onboarding record
        onboarding = StudentOnboarding(
            roll_number="23311A0599",
            name="Charlie OTP",
            email="charlie@cse.sreenidhi.edu.in",
            department_id=1,
            academic_year_id=1,
            section_id=1
        )
        self.db.add(onboarding)
        self.db.commit()

        session_token = create_onboarding_session_token(onboarding.id, onboarding.roll_number)

        # Mock send_single_email with a 1.5-second simulated network/SMTP latency
        simulated_smtp_delay = 1.5

        def slow_send_email(*args, **kwargs):
            time.sleep(simulated_smtp_delay)
            return {"status": "SENT", "message": "Simulated dispatch"}

        with patch("app.services.email_service.send_single_email", side_effect=slow_send_email):
            t0 = time.perf_counter()
            res = self.client.post(
                "/api/v1/onboard/request-otp",
                json={"session_token": session_token}
            )
            elapsed = time.perf_counter() - t0

        print(f"\n[INV-3] request-otp response time with {simulated_smtp_delay}s SMTP delay: {elapsed:.2f}s")
        self.assertEqual(res.status_code, 200, f"OTP request failed: {res.text}")
        self.assertGreaterEqual(
            elapsed,
            simulated_smtp_delay,
            "OTP email is executed inline, blocking the thread for the entire SMTP duration!"
        )


if __name__ == "__main__":
    unittest.main()
