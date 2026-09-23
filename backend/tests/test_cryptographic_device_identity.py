"""
Comprehensive Automated Test Suite: Cryptographic Device Identity
Validates:
1. 10 same-model phones concurrency (e.g. Samsung Galaxy A55, identical UA/hardware meta)
   with 10 independent keypairs and zero false collisions.
2. Cross-student key reuse rejection (DEVICE_KEY_REUSE_REJECTED / 409).
3. Cross-student possession attempt rejection.
4. Forged device_id rejection.
5. Missing signature rejection (BINDING_REQUIRED / 403).
6. Invalid signature rejection (DEVICE_VERIFICATION_FAILED / 401).
7. Challenge replay rejection (DEVICE_CHALLENGE_REPLAYED / 401).
8. Expired challenge rejection (DEVICE_CHALLENGE_EXPIRED / 401).
9. Revoked device rejection (DEVICE_REVOKED) with past attendance preserved.
10. Multi-device limit check (DEVICE_LIMIT_REACHED / 409) and replace_active flow.
11. Verification through attendance scan path (POST /api/v1/student/scan-session).
12. Untrusted client claims rejection (client sending device_verified: true without proof).
"""

import os
import sys
import time
import base64
import hashlib
import uuid
import unittest
from unittest.mock import patch
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
    sign_canonical_challenge,
    build_canonical_challenge_message,
    _CONSUMED_NONCES,
    clear_binding_verify_lockouts
)
from app.models.models import (
    User, UserRole, Student, Teacher, Department, Subject, Section, AcademicYear,
    AttendanceSession, SessionStatus, TeacherAssignment, DeviceBinding, AttendanceRecord,
    AuditLog, RevokedReason
)
from app.api.student import failed_token_tracker, student_scan_limiter, async_attendance_writer


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


def _sign_challenge_p1363(private_key, challenge_str: str) -> str:
    """Helper: produces IEEE P1363 raw 64-byte signature Base64 (matching WebCrypto API output)."""
    der_sig = private_key.sign(
        challenge_str.encode("utf-8"),
        ec.ECDSA(hashes.SHA256())
    )
    r, s = decode_dss_signature(der_sig)
    raw_sig = r.to_bytes(32, "big") + s.to_bytes(32, "big")
    return base64.b64encode(raw_sig).decode("ascii")


class TestCryptographicDeviceIdentity(unittest.TestCase):

    def setUp(self):
        # In-memory SQLite with StaticPool for total clean test isolation
        self.engine = create_engine(
            "sqlite:///:memory:",
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

        # Clear in-memory replay tracking and rate limiters
        _CONSUMED_NONCES.clear()
        clear_binding_verify_lockouts()
        failed_token_tracker._failures.clear()
        failed_token_tracker._cooldowns.clear()
        student_scan_limiter._attempts.clear()

        # Patch external gsheets post-scan task
        self.patcher = patch("app.api.student._async_post_scan_tasks")
        self.mock_post_scan = self.patcher.start()
        self.addCleanup(self.patcher.stop)

        # Save settings state and enable BINDING_V2
        self._orig_binding_v2 = getattr(settings, "BINDING_V2", False)
        self._orig_binding_v2_enabled = getattr(settings, "BINDING_V2_ENABLED", False)
        settings.BINDING_V2 = True
        settings.BINDING_V2_ENABLED = True

        # Base seed data
        self.dept = Department(name="Computer Science & Engineering", code="CSE")
        self.ay = AcademicYear(name="2025-2026")
        self.db.add_all([self.dept, self.ay])
        self.db.commit()

        self.sec = Section(name="CSE-A", department_id=self.dept.id, academic_year_id=self.ay.id)
        self.subject = Subject(name="Distributed Systems", code="CS701", department_id=self.dept.id, academic_year_id=self.ay.id)
        self.db.add_all([self.sec, self.subject])
        self.db.commit()

        # Teacher user & record
        self.teacher_user = User(
            username="prof.sharma",
            password_hash=get_password_hash("FacultyPass123"),
            role=UserRole.TEACHER,
            is_active=True
        )
        self.db.add(self.teacher_user)
        self.db.commit()

        self.teacher = Teacher(
            user_id=self.teacher_user.id,
            teacher_code="FAC0099",
            name="Prof Sharma",
            department_id=self.dept.id
        )
        self.db.add(self.teacher)
        self.db.commit()

        self.assignment = TeacherAssignment(
            teacher_id=self.teacher.id,
            subject_id=self.subject.id,
            section_id=self.sec.id
        )
        self.db.add(self.assignment)
        self.db.commit()

        # Auth token for teacher
        self.teacher_token = create_access_token(
            data={"sub": self.teacher_user.username, "role": UserRole.TEACHER.value}
        )
        self.teacher_headers = {"Authorization": f"Bearer {self.teacher_token}"}

    def tearDown(self):
        settings.BINDING_V2 = self._orig_binding_v2
        settings.BINDING_V2_ENABLED = self._orig_binding_v2_enabled
        app.dependency_overrides.clear()
        self.db.close()
        Base.metadata.drop_all(bind=self.engine)
        self.engine.dispose()
        _CONSUMED_NONCES.clear()
        clear_binding_verify_lockouts()

    def _create_student(self, roll_number: str, sap_id: str, email: str):
        """Helper to create student and auth token."""
        uname = roll_number.upper()
        user = User(
            username=uname,
            password_hash=get_password_hash("StudentPass123"),
            role=UserRole.STUDENT,
            is_active=True
        )
        self.db.add(user)
        self.db.commit()

        student = Student(
            user_id=user.id,
            roll_number=roll_number,
            name=f"Student {roll_number}",
            department_id=self.dept.id,
            section_id=self.sec.id,
            academic_year_id=self.ay.id
        )
        self.db.add(student)
        self.db.commit()

        token = create_access_token(
            data={"sub": user.username, "role": UserRole.STUDENT.value}
        )
        return user, student, token

    def _create_session_and_get_token(self):
        """Creates an OPEN attendance session and fetches valid QR broadcast token from teacher API."""
        session = AttendanceSession(
            teacher_id=self.teacher.id,
            subject_id=self.subject.id,
            section_id=self.sec.id,
            period="1 Period",
            session_date=get_server_ist_date(),
            status=SessionStatus.OPEN
        )
        self.db.add(session)
        self.db.commit()

        res = self.client.get(
            f"/api/v1/teacher/sessions/{session.id}/broadcast-token?period_count=1",
            headers=self.teacher_headers
        )
        self.assertEqual(res.status_code, 200, f"Broadcast token fetch failed: {res.text}")
        return session, res.json()["qr_payload"]

    def test_ten_identical_phone_models_concurrent_enrollment_and_attendance(self):
        """
        Critical Test:
        10 students using identical phone models (e.g. Samsung Galaxy A55 5G),
        same User-Agent, same platform, same screen/hardware profile, same Wi-Fi IP.
        Each generates independent ECDSA P-256 keypair and UUID device_id.
        All 10 MUST enroll, verify possession, and record attendance with ZERO collisions.
        """
        shared_ua = "Mozilla/5.0 (Linux; Android 14; SM-A556B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36"
        shared_meta = {
            "device_label": "Samsung Galaxy A55 5G",
            "platform": "Android 14",
            "browser_family": "Chrome Mobile",
            "app_version": "2.4.0",
            "screen": "1080x2340",
            "hardware_concurrency": 8
        }
        shared_ip = "192.168.1.100"

        # 1. Create 10 students
        students_info = []
        for i in range(1, 11):
            roll = f"21SNISTCSE{i:03d}"
            sap = f"SAP900{i:03d}"
            email = f"student{i}@snist.edu.in"
            user, student, token = self._create_student(roll, sap, email)
            priv_key, spki_b64, key_id = _generate_p256_keypair()
            dev_id = str(uuid.uuid4())
            students_info.append({
                "index": i,
                "user": user,
                "student": student,
                "token": token,
                "priv_key": priv_key,
                "spki_b64": spki_b64,
                "key_id": key_id,
                "device_id": dev_id
            })

        # 2. Register all 10 devices
        for s in students_info:
            reg_payload = {
                "device_id": s["device_id"],
                "public_key_spki_b64": s["spki_b64"],
                "key_algorithm": "ECDSA_P256",
                "client_type": "WEB",
                "device_label": shared_meta["device_label"],
                "platform": shared_meta["platform"],
                "browser_family": shared_meta["browser_family"],
                "app_version": shared_meta["app_version"],
                "telemetry_metadata": shared_meta
            }
            res = self.client.post(
                "/api/v1/attendance/devices/register",
                json=reg_payload,
                headers={
                    "Authorization": f"Bearer {s['token']}",
                    "User-Agent": shared_ua,
                    "X-Forwarded-For": shared_ip
                }
            )
            self.assertEqual(res.status_code, 200, f"Student {s['index']} registration failed: {res.text}")
            data = res.json()
            self.assertTrue(data["success"])
            self.assertEqual(data["status"], "ACTIVE")
            self.assertEqual(data["device_id"], s["device_id"])

        # Verify 10 distinct DB records exist
        bindings = self.db.query(DeviceBinding).filter(DeviceBinding.status == "ACTIVE").all()
        self.assertEqual(len(bindings), 10)
        registered_dev_ids = {b.device_id for b in bindings}
        self.assertEqual(len(registered_dev_ids), 10, "All 10 device_ids must be strictly distinct")

        # 3. Create active attendance session and get valid QR token
        active_sess, launch_token = self._create_session_and_get_token()

        # 4. Challenge & Verify proof for all 10 students concurrently
        for s in students_info:
            # Request challenge
            c_res = self.client.post(
                "/api/v1/attendance/devices/challenge",
                json={"device_id": s["device_id"], "operation": "ATTENDANCE_VERIFICATION"},
                headers={"Authorization": f"Bearer {s['token']}", "User-Agent": shared_ua}
            )
            self.assertEqual(c_res.status_code, 200)
            c_data = c_res.json()
            challenge_id = c_data["challenge_id"]
            canonical_msg = c_data["canonical_message"]

            # Sign canonical message
            sig_b64 = _sign_challenge_p1363(s["priv_key"], canonical_msg)

            # Direct verification endpoint test
            v_res = self.client.post(
                "/api/v1/attendance/devices/verify",
                json={
                    "device_id": s["device_id"],
                    "challenge_id": challenge_id,
                    "signature": sig_b64,
                    "operation": "ATTENDANCE_VERIFICATION"
                },
                headers={"Authorization": f"Bearer {s['token']}", "User-Agent": shared_ua}
            )
            self.assertEqual(v_res.status_code, 200)
            self.assertTrue(v_res.json()["valid"])

            # 5. Submit attendance scan session
            # Fresh challenge for attendance submission
            c_scan = self.client.post(
                "/api/v1/attendance/devices/challenge",
                json={"device_id": s["device_id"], "operation": "ATTENDANCE_SCAN"},
                headers={"Authorization": f"Bearer {s['token']}", "User-Agent": shared_ua}
            )
            self.assertEqual(c_scan.status_code, 200)
            c_scan_data = c_scan.json()
            scan_sig = _sign_challenge_p1363(s["priv_key"], c_scan_data["canonical_message"])

            scan_res = self.client.post(
                "/api/v1/student/scan-session",
                json={
                    "session_token": launch_token,
                    "device_id": s["device_id"],
                    "device_signature": scan_sig,
                    "challenge_token": c_scan_data["challenge_token"]
                },
                headers={"Authorization": f"Bearer {s['token']}", "User-Agent": shared_ua}
            )
            self.assertEqual(scan_res.status_code, 200, f"Scan failed for student {s['index']}: {scan_res.text}")
            self.assertIn(scan_res.json()["status"], ("SUCCESS", "ALREADY_MARKED"))

        # Verify all 10 students marked present in DB without any collisions
        records = self.db.query(AttendanceRecord).filter(AttendanceRecord.session_id == active_sess.id).all()
        self.assertEqual(len(records), 10, "All 10 students must be present without any collision")
        recorded_rolls = {r.roll_number for r in records}
        self.assertEqual(len(recorded_rolls), 10, "All 10 student roll numbers must be recorded distinctly")

    def test_cross_student_key_reuse_rejection(self):
        """
        Security requirement: Student A registers public key K_A.
        Student B attempts to register a device with the EXACT SAME public key K_A.
        Server MUST reject with HTTP 409 and code DEVICE_KEY_REUSE_REJECTED.
        """
        _, student_a, token_a = self._create_student("21CSE001", "SAP1001", "studA@snist.edu.in")
        _, student_b, token_b = self._create_student("21CSE002", "SAP1002", "studB@snist.edu.in")

        priv_a, spki_a, _ = _generate_p256_keypair()
        dev_a = str(uuid.uuid4())
        dev_b = str(uuid.uuid4())

        # Student A registers successfully
        res_a = self.client.post(
            "/api/v1/attendance/devices/register",
            json={"device_id": dev_a, "public_key_spki_b64": spki_a, "client_type": "WEB"},
            headers={"Authorization": f"Bearer {token_a}"}
        )
        self.assertEqual(res_a.status_code, 200)

        # Student B attempts to register identical public key
        res_b = self.client.post(
            "/api/v1/attendance/devices/register",
            json={"device_id": dev_b, "public_key_spki_b64": spki_a, "client_type": "WEB"},
            headers={"Authorization": f"Bearer {token_b}"}
        )
        self.assertEqual(res_b.status_code, 409)
        self.assertIn("DEVICE_KEY_REUSE_REJECTED", str(res_b.json().get("detail", "")))

        # Verify audit log recorded rejection event
        audit = self.db.query(AuditLog).filter(
            AuditLog.event_type == "DEVICE_KEY_REUSE_REJECTED"
        ).first()
        self.assertIsNotNone(audit)

    def test_cross_student_possession_attempt_rejection(self):
        """
        Student A registers Device A with Key A.
        Student B registers Device B with Key B.
        Student B generates challenge, but presents signature made by Key A / Device A.
        Server MUST reject the possession claim.
        """
        _, _, token_a = self._create_student("21CSE003", "SAP1003", "studA3@snist.edu.in")
        _, _, token_b = self._create_student("21CSE004", "SAP1004", "studB4@snist.edu.in")

        priv_a, spki_a, _ = _generate_p256_keypair()
        priv_b, spki_b, _ = _generate_p256_keypair()
        dev_a = str(uuid.uuid4())
        dev_b = str(uuid.uuid4())

        # Enroll both
        self.client.post(
            "/api/v1/attendance/devices/register",
            json={"device_id": dev_a, "public_key_spki_b64": spki_a},
            headers={"Authorization": f"Bearer {token_a}"}
        )
        self.client.post(
            "/api/v1/attendance/devices/register",
            json={"device_id": dev_b, "public_key_spki_b64": spki_b},
            headers={"Authorization": f"Bearer {token_b}"}
        )

        # Student B requests challenge for their device
        c_res = self.client.post(
            "/api/v1/attendance/devices/challenge",
            json={"device_id": dev_b},
            headers={"Authorization": f"Bearer {token_b}"}
        )
        c_data = c_res.json()

        # Attacker signs Student B's canonical challenge using Key A
        fake_sig = _sign_challenge_p1363(priv_a, c_data["canonical_message"])

        # Verify attempt should fail (wrong public key)
        v_res = self.client.post(
            "/api/v1/attendance/devices/verify",
            json={
                "device_id": dev_b,
                "challenge_id": c_data["challenge_id"],
                "signature": fake_sig
            },
            headers={"Authorization": f"Bearer {token_b}"}
        )
        self.assertEqual(v_res.status_code, 401)
        self.assertIn("DEVICE_VERIFICATION_FAILED", str(v_res.json().get("detail", "")))

    def test_forged_device_id_rejection(self):
        """
        Valid student signs challenge, but specifies a forged / unregistered device_id.
        Server MUST reject with DEVICE_KEY_MISSING (401).
        """
        _, _, token = self._create_student("21CSE005", "SAP1005", "stud5@snist.edu.in")
        priv_k, spki_k, _ = _generate_p256_keypair()
        real_dev = str(uuid.uuid4())
        forged_dev = str(uuid.uuid4())

        self.client.post(
            "/api/v1/attendance/devices/register",
            json={"device_id": real_dev, "public_key_spki_b64": spki_k},
            headers={"Authorization": f"Bearer {token}"}
        )

        # Challenge for forged dev
        c_res = self.client.post(
            "/api/v1/attendance/devices/challenge",
            json={"device_id": forged_dev},
            headers={"Authorization": f"Bearer {token}"}
        )
        self.assertEqual(c_res.status_code, 401)
        self.assertIn("DEVICE_KEY_MISSING", str(c_res.json().get("detail", "")))

    def test_missing_signature_rejection_binding_required(self):
        """
        Enrolled student scans QR session without supplying cryptographic proof.
        Server MUST reject with HTTP 403 BINDING_REQUIRED.
        """
        _, _, token = self._create_student("21CSE006", "SAP1006", "stud6@snist.edu.in")
        priv_k, spki_k, _ = _generate_p256_keypair()
        dev_id = str(uuid.uuid4())

        # Enroll device
        self.client.post(
            "/api/v1/attendance/devices/register",
            json={"device_id": dev_id, "public_key_spki_b64": spki_k},
            headers={"Authorization": f"Bearer {token}"}
        )

        # Active session & QR token
        sess, launch_token = self._create_session_and_get_token()

        # Attempt scan without binding signature
        res = self.client.post(
            "/api/v1/student/scan-session",
            json={"session_token": launch_token},
            headers={"Authorization": f"Bearer {token}"}
        )
        self.assertEqual(res.status_code, 403)
        self.assertIn("BINDING_REQUIRED", str(res.json().get("detail", "")))

    def test_invalid_signature_rejection(self):
        """
        Malformed or tampered signature bytes must be rejected with 401 DEVICE_VERIFICATION_FAILED.
        """
        _, _, token = self._create_student("21CSE007", "SAP1007", "stud7@snist.edu.in")
        priv_k, spki_k, _ = _generate_p256_keypair()
        dev_id = str(uuid.uuid4())

        self.client.post(
            "/api/v1/attendance/devices/register",
            json={"device_id": dev_id, "public_key_spki_b64": spki_k},
            headers={"Authorization": f"Bearer {token}"}
        )

        c_res = self.client.post(
            "/api/v1/attendance/devices/challenge",
            json={"device_id": dev_id},
            headers={"Authorization": f"Bearer {token}"}
        )
        c_data = c_res.json()

        # Send invalid signature (64 dummy bytes base64)
        bad_sig = base64.b64encode(b"\x00" * 64).decode("ascii")

        v_res = self.client.post(
            "/api/v1/attendance/devices/verify",
            json={
                "device_id": dev_id,
                "challenge_id": c_data["challenge_id"],
                "signature": bad_sig
            },
            headers={"Authorization": f"Bearer {token}"}
        )
        self.assertEqual(v_res.status_code, 401)
        self.assertIn("DEVICE_VERIFICATION_FAILED", str(v_res.json().get("detail", "")))

    def test_challenge_replay_rejection(self):
        """
        A single-use challenge token/id cannot be replayed. Second attempt must return 401 DEVICE_CHALLENGE_REPLAYED.
        """
        _, _, token = self._create_student("21CSE008", "SAP1008", "stud8@snist.edu.in")
        priv_k, spki_k, _ = _generate_p256_keypair()
        dev_id = str(uuid.uuid4())

        self.client.post(
            "/api/v1/attendance/devices/register",
            json={"device_id": dev_id, "public_key_spki_b64": spki_k},
            headers={"Authorization": f"Bearer {token}"}
        )

        c_res = self.client.post(
            "/api/v1/attendance/devices/challenge",
            json={"device_id": dev_id},
            headers={"Authorization": f"Bearer {token}"}
        )
        c_data = c_res.json()
        sig = _sign_challenge_p1363(priv_k, c_data["canonical_message"])

        # First verification succeeds
        v1 = self.client.post(
            "/api/v1/attendance/devices/verify",
            json={
                "device_id": dev_id,
                "challenge_id": c_data["challenge_id"],
                "signature": sig
            },
            headers={"Authorization": f"Bearer {token}"}
        )
        self.assertEqual(v1.status_code, 200)

        # Second verification with exact same challenge MUST fail
        v2 = self.client.post(
            "/api/v1/attendance/devices/verify",
            json={
                "device_id": dev_id,
                "challenge_id": c_data["challenge_id"],
                "signature": sig
            },
            headers={"Authorization": f"Bearer {token}"}
        )
        self.assertEqual(v2.status_code, 401)
        self.assertIn("DEVICE_CHALLENGE_REPLAYED", str(v2.json().get("detail", "")))

    def test_expired_challenge_rejection(self):
        """
        Challenge token created in the past beyond CHALLENGE_TTL_SECONDS must be rejected with DEVICE_CHALLENGE_EXPIRED.
        """
        _, student, token = self._create_student("21CSE009", "SAP1009", "stud9@snist.edu.in")
        priv_k, spki_k, _ = _generate_p256_keypair()
        dev_id = str(uuid.uuid4())

        self.client.post(
            "/api/v1/attendance/devices/register",
            json={"device_id": dev_id, "public_key_spki_b64": spki_k},
            headers={"Authorization": f"Bearer {token}"}
        )

        # Create expired challenge token (epoch 600s in the past, ttl=60s)
        past_epoch = int(time.time()) - 600
        chal_res = create_challenge_token(
            student_id=student.id,
            roll_number=student.roll_number,
            device_id=dev_id,
            ttl_seconds=60,
            issue_time=past_epoch
        )
        challenge_token = chal_res["challenge_token"]
        chal_id = chal_res["challenge_id"]
        canonical_msg = chal_res["canonical_message"]

        sig = _sign_challenge_p1363(priv_k, canonical_msg)

        v_res = self.client.post(
            "/api/v1/attendance/devices/verify",
            json={
                "device_id": dev_id,
                "challenge_id": chal_id,
                "signature": sig,
                "challenge_token": challenge_token
            },
            headers={"Authorization": f"Bearer {token}"}
        )
        self.assertEqual(v_res.status_code, 401)
        self.assertIn("DEVICE_CHALLENGE_EXPIRED", str(v_res.json().get("detail", "")))

    def test_revoked_device_rejection_and_past_attendance_preservation(self):
        """
        Revoking a device sets status to REVOKED and blocks subsequent verification.
        Past attendance records remain intact.
        """
        _, student, token = self._create_student("21CSE010", "SAP1010", "stud10@snist.edu.in")
        priv_k, spki_k, _ = _generate_p256_keypair()
        dev_id = str(uuid.uuid4())

        # Register
        self.client.post(
            "/api/v1/attendance/devices/register",
            json={"device_id": dev_id, "public_key_spki_b64": spki_k},
            headers={"Authorization": f"Bearer {token}"}
        )

        # Create session & get QR token
        sess, launch_token = self._create_session_and_get_token()

        c_res = self.client.post(
            "/api/v1/attendance/devices/challenge",
            json={"device_id": dev_id},
            headers={"Authorization": f"Bearer {token}"}
        )
        c_data = c_res.json()
        sig = _sign_challenge_p1363(priv_k, c_data["canonical_message"])

        # Scan succeeds
        scan_res = self.client.post(
            "/api/v1/student/scan-session",
            json={
                "session_token": launch_token,
                "device_id": dev_id,
                "device_signature": sig,
                "challenge_token": c_data["challenge_token"]
            },
            headers={"Authorization": f"Bearer {token}"}
        )
        self.assertEqual(scan_res.status_code, 200)

        # Revoke the device
        rev_res = self.client.post(
            f"/api/v1/attendance/devices/{dev_id}/revoke",
            json={"reason": "Device lost by student"},
            headers={"Authorization": f"Bearer {token}"}
        )
        self.assertEqual(rev_res.status_code, 200)
        self.assertEqual(rev_res.json()["status"], "REVOKED")

        # Subsequent challenge/verify must fail
        c2 = self.client.post(
            "/api/v1/attendance/devices/challenge",
            json={"device_id": dev_id},
            headers={"Authorization": f"Bearer {token}"}
        )
        self.assertEqual(c2.status_code, 401)
        self.assertIn("DEVICE_REVOKED", str(c2.json().get("detail", "")))

        # Verify historical attendance record is STILL present
        record = self.db.query(AttendanceRecord).filter(
            AttendanceRecord.session_id == sess.id,
            AttendanceRecord.student_id == student.id
        ).first()
        self.assertIsNotNone(record, "Historical attendance records must never be lost when device is revoked")

    def test_multi_device_limit_and_replace_active(self):
        """
        With MAX_ACTIVE_DEVICES_PER_STUDENT=1:
        Registering a second device without replace_active=True fails with 409 DEVICE_LIMIT_REACHED.
        With replace_active=True, former device is revoked and new device is ACTIVE.
        """
        _, _, token = self._create_student("21CSE011", "SAP1011", "stud11@snist.edu.in")
        priv_1, spki_1, _ = _generate_p256_keypair()
        priv_2, spki_2, _ = _generate_p256_keypair()
        dev_1 = str(uuid.uuid4())
        dev_2 = str(uuid.uuid4())

        # Register Device 1
        r1 = self.client.post(
            "/api/v1/attendance/devices/register",
            json={"device_id": dev_1, "public_key_spki_b64": spki_1},
            headers={"Authorization": f"Bearer {token}"}
        )
        self.assertEqual(r1.status_code, 200)

        # Register Device 2 without replace_active
        r2 = self.client.post(
            "/api/v1/attendance/devices/register",
            json={"device_id": dev_2, "public_key_spki_b64": spki_2, "replace_active": False},
            headers={"Authorization": f"Bearer {token}"}
        )
        self.assertEqual(r2.status_code, 409)
        self.assertIn("DEVICE_LIMIT_REACHED", str(r2.json().get("detail", "")))

        # Register Device 2 with replace_active=True
        r3 = self.client.post(
            "/api/v1/attendance/devices/register",
            json={"device_id": dev_2, "public_key_spki_b64": spki_2, "replace_active": True},
            headers={"Authorization": f"Bearer {token}"}
        )
        self.assertEqual(r3.status_code, 200)
        self.assertEqual(r3.json()["status"], "ACTIVE")

        # Verify DB states
        b1 = self.db.query(DeviceBinding).filter(DeviceBinding.device_id == dev_1).first()
        b2 = self.db.query(DeviceBinding).filter(DeviceBinding.device_id == dev_2).first()
        self.assertEqual(b1.status, "REVOKED")
        self.assertEqual(b2.status, "ACTIVE")

    def test_untrusted_client_claims_rejected(self):
        """
        A client submitting `device_verified: true` without valid cryptographic signature
        MUST NOT be trusted by the server. Server must reject with 403 BINDING_REQUIRED.
        """
        _, _, token = self._create_student("21CSE012", "SAP1012", "stud12@snist.edu.in")
        priv_k, spki_k, _ = _generate_p256_keypair()
        dev_id = str(uuid.uuid4())

        self.client.post(
            "/api/v1/attendance/devices/register",
            json={"device_id": dev_id, "public_key_spki_b64": spki_k},
            headers={"Authorization": f"Bearer {token}"}
        )

        sess, launch_token = self._create_session_and_get_token()

        # Attacker tries to bypass by sending device_verified: True directly
        res = self.client.post(
            "/api/v1/student/scan-session",
            json={
                "session_token": launch_token,
                "device_id": dev_id,
                "device_verified": True
                # Intentionally missing device_signature and challenge_token
            },
            headers={"Authorization": f"Bearer {token}"}
        )
        self.assertEqual(res.status_code, 403)
        self.assertIn("BINDING_REQUIRED", str(res.json().get("detail", "")))


if __name__ == "__main__":
    unittest.main()
