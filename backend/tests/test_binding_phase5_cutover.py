"""
Test Suite: Binding Phase 5 — Legacy Soft-Binding Cutover & Code Removal

Validates the retirement of the legacy soft-binding path and enforcement convergence:
1. Legacy-only scan attempt under flag-off returns typed 410 legacy_binding_retired
2. Unbound straggler scan attempt under V2 returns typed 403 no_active_binding with enrollment CTA
3. Enrolled student scan attempt under V2 succeeds with challenge signature without legacy device checks
4. Admin analytics endpoint reports enforcement_summary (hard_bound, soft_bound=0, unbound) strictly from DeviceBinding
5. Admin department enrolled students endpoint reports device_bound and binding_status from DeviceBinding (zero legacy reads)
6. Teacher session details endpoint reports unbound_students_count and unbound_straggler_alert
7. Teacher broadcast token endpoint reports unbound_students_count and unbound_straggler_alert
8. Inline self-healing enrollment flow: unbound -> 403 -> enroll -> scan succeeds
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
from app.core.binding_crypto import create_challenge_token, clear_binding_verify_lockouts
from app.models.models import (
    User, UserRole, Student, Teacher, Department, Subject, Section, AcademicYear,
    AttendanceSession, SessionStatus, TeacherAssignment, DeviceBinding
)
from app.services.qr_token import ShortTokenService
from app.api.student import failed_token_tracker, student_scan_limiter


def _generate_p256_keypair():
    """Generates real P-256 ECDSA keypair; returns (private_key, spki_b64, key_id)."""
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
    """Produces IEEE P1363 raw 64-byte signature Base64 (matching WebCrypto API output)."""
    der_sig = private_key.sign(
        challenge_token_str.encode("utf-8"),
        ec.ECDSA(hashes.SHA256())
    )
    r, s = decode_dss_signature(der_sig)
    raw_sig = r.to_bytes(32, "big") + s.to_bytes(32, "big")
    return base64.b64encode(raw_sig).decode("ascii")


class TestBindingPhase5Cutover(unittest.TestCase):
    """
    Comprehensive cutover test suite verifying that legacy soft-binding is retired,
    the server enforces DeviceBinding V2, and faculty/admin observability is active.
    """

    def setUp(self):
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

        # Clear in-memory rate-limit trackers
        failed_token_tracker._failures.clear()
        student_scan_limiter._attempts.clear()
        clear_binding_verify_lockouts()

        # Seed test hierarchy
        dept = Department(name="Computer Science", code="CSE")
        self.db.add(dept)
        self.db.flush()

        ay = AcademicYear(name="2025-2026")
        self.db.add(ay)
        self.db.flush()

        sec = Section(name="CSE-A", department_id=dept.id, academic_year_id=ay.id)
        self.db.add(sec)
        self.db.flush()

        subj = Subject(name="Operating Systems", code="CS301", department_id=dept.id, academic_year_id=ay.id)
        self.db.add(subj)
        self.db.flush()

        teacher_user = User(
            username="T1001",
            email="teacher@snist.edu.in",
            password_hash=get_password_hash("pass123"),
            role=UserRole.TEACHER,
            is_active=True
        )
        self.db.add(teacher_user)
        self.db.flush()

        teacher = Teacher(user_id=teacher_user.id, name="Dr. Rao", teacher_code="T1001", department_id=dept.id)
        self.db.add(teacher)
        self.db.flush()

        admin_user = User(
            username="ADMIN01",
            email="admin@snist.edu.in",
            password_hash=get_password_hash("pass123"),
            role=UserRole.SUPER_ADMIN,
            is_active=True
        )
        self.db.add(admin_user)
        self.db.flush()

        assignment = TeacherAssignment(
            teacher_id=teacher.id,
            subject_id=subj.id,
            section_id=sec.id
        )
        self.db.add(assignment)
        self.db.flush()

        # Seed Student 1 (Enrolled under V2)
        student1_user = User(
            username="21051A0501",
            email="s1@snist.edu.in",
            password_hash=get_password_hash("pass123"),
            role=UserRole.STUDENT,
            is_active=True
        )
        self.db.add(student1_user)
        self.db.flush()

        student1 = Student(
            user_id=student1_user.id,
            name="Alice Bound",
            roll_number="21051A0501",
            section_id=sec.id,
            department_id=dept.id,
            academic_year_id=ay.id
        )
        self.db.add(student1)
        self.db.flush()

        # Seed Student 2 (Unbound Straggler)
        student2_user = User(
            username="21051A0502",
            email="s2@snist.edu.in",
            password_hash=get_password_hash("pass123"),
            role=UserRole.STUDENT,
            is_active=True
        )
        self.db.add(student2_user)
        self.db.flush()

        student2 = Student(
            user_id=student2_user.id,
            name="Bob Straggler",
            roll_number="21051A0502",
            section_id=sec.id,
            department_id=dept.id,
            academic_year_id=ay.id
        )
        self.db.add(student2)
        self.db.flush()

        # Keypair for Student 1
        priv, spki, kid = _generate_p256_keypair()
        self.s1_priv = priv
        self.s1_spki = spki
        self.s1_kid = kid

        binding1 = DeviceBinding(
            student_id=student1.id,
            public_key=spki,
            key_id=kid,
            enrolled_at=datetime.utcnow()
        )
        self.db.add(binding1)
        self.db.flush()

        # Active attendance session
        today_str = get_server_ist_date()
        session = AttendanceSession(
            teacher_id=teacher.id,
            subject_id=subj.id,
            section_id=sec.id,
            session_date=today_str,
            period="1",
            status=SessionStatus.OPEN
        )
        self.db.add(session)
        self.db.commit()

        self.dept = dept
        self.section = sec
        self.subject = subj
        self.teacher = teacher
        self.teacher_user = teacher_user
        self.admin_user = admin_user
        self.student1 = student1
        self.student1_user = student1_user
        self.student2 = student2
        self.student2_user = student2_user
        self.session = session

        # Auth headers
        self.s1_headers = {"Authorization": f"Bearer {create_access_token({'sub': '21051A0501'})}"}
        self.s2_headers = {"Authorization": f"Bearer {create_access_token({'sub': '21051A0502'})}"}
        self.teacher_headers = {"Authorization": f"Bearer {create_access_token({'sub': 'T1001'})}"}
        self.admin_headers = {"Authorization": f"Bearer {create_access_token({'sub': 'ADMIN01'})}"}

        # Issue active session token
        token_info = ShortTokenService.issue_or_get_short_code(
            db=self.db,
            session_id=self.session.id,
            period_count=1,
            step_window=10
        )
        self.session_token = token_info["payload"]
        self.short_code = token_info["short_code"]

    def tearDown(self):
        self.db.close()
        app.dependency_overrides.clear()
        settings.BINDING_V2 = True

    def test_01_legacy_binding_retired_under_flag_off(self):
        """Under flag-off, a client sending legacy device_uuid receives 410 legacy_binding_retired."""
        settings.BINDING_V2 = False

        res = self.client.post(
            "/api/v1/student/scan-session",
            json={
                "session_token": self.session_token,
                "token_format": "short",
                "device_uuid": "DEV-LEGACY-CLIENT-001"
            },
            headers=self.s1_headers
        )

        self.assertEqual(res.status_code, 410)
        data = res.json()
        self.assertIn("legacy_binding_retired", data.get("detail", ""))

    def test_02_unbound_straggler_under_v2_returns_no_active_binding(self):
        """Unenrolled student receives 403 no_active_binding with inline CTA when BINDING_V2=True."""
        settings.BINDING_V2 = True

        res = self.client.post(
            "/api/v1/student/scan-session",
            json={
                "session_token": self.session_token,
                "token_format": "short"
            },
            headers=self.s2_headers
        )

        self.assertEqual(res.status_code, 403)
        data = res.json()
        detail = data.get("detail", "")
        self.assertIn("no_active_binding", detail)
        self.assertIn("BINDING_REQUIRED", detail)

    def test_03_enrolled_student_v2_scan_success(self):
        """Enrolled student with valid challenge token and ECDSA signature marks attendance successfully."""
        settings.BINDING_V2 = True

        # 1. Fetch challenge token
        ch_res = self.client.post(
            "/api/v1/binding/challenge",
            json={},
            headers=self.s1_headers
        )
        self.assertEqual(ch_res.status_code, 200)
        challenge_token = ch_res.json()["challenge_token"]

        # 2. Sign challenge using Alice's private key
        sig = _sign_challenge_p1363(self.s1_priv, challenge_token)

        # 3. Submit scan without any legacy device_uuid
        scan_res = self.client.post(
            "/api/v1/student/scan-session",
            json={
                "session_token": self.session_token,
                "token_format": "short",
                "challenge_token": challenge_token,
                "binding_signature": sig
            },
            headers=self.s1_headers
        )

        self.assertEqual(scan_res.status_code, 200)
        data = scan_res.json()
        self.assertEqual(data.get("status"), "SUCCESS")

    def test_04_admin_anti_downgrade_analytics(self):
        """Admin enrollment analytics returns enforcement_summary strictly from DeviceBinding."""
        res = self.client.get(
            "/api/v1/admin/analytics/enrollment",
            headers=self.admin_headers
        )

        self.assertEqual(res.status_code, 200)
        data = res.json()

        # Validate summary numbers: 2 students total (Alice=bound, Bob=unbound)
        self.assertIn("enforcement_summary", data)
        summary = data["enforcement_summary"]
        self.assertEqual(summary["hard_bound_count"], 1)
        self.assertEqual(summary["soft_bound_count"], 0)
        self.assertEqual(summary["unbound_count"], 1)
        self.assertEqual(summary["coverage_pct"], 50.0)

        # Validate department breakdown
        dept_data = data["departments"][0]
        self.assertEqual(dept_data["hard_bound_count"], 1)
        self.assertEqual(dept_data["soft_bound_count"], 0)
        self.assertEqual(dept_data["unbound_count"], 1)

    def test_05_admin_department_enrolled_students_zero_legacy_reads(self):
        """Admin department students list reports device_bound and binding_status from DeviceBinding."""
        res = self.client.get(
            f"/api/v1/admin/department-enrolled-students?dept_id={self.dept.id}",
            headers=self.admin_headers
        )

        self.assertEqual(res.status_code, 200)
        students = res.json()
        self.assertEqual(len(students), 2)

        student_map = {s["roll_number"]: s for s in students}
        # Alice is hard-bound
        self.assertTrue(student_map["21051A0501"]["device_bound"])
        self.assertEqual(student_map["21051A0501"]["binding_status"], "hard")

        # Bob is unbound
        self.assertFalse(student_map["21051A0502"]["device_bound"])
        self.assertEqual(student_map["21051A0502"]["binding_status"], "unbound")

    def test_06_teacher_session_details_unbound_straggler_alert(self):
        """Teacher session details reports unbound_students_count and unbound_straggler_alert."""
        res = self.client.get(
            f"/api/v1/teacher/sessions/{self.session.id}",
            headers=self.teacher_headers
        )

        self.assertEqual(res.status_code, 200)
        data = res.json()

        # Section has 2 students: Alice (bound) and Bob (unbound) -> unbound_students_count = 1
        self.assertEqual(data["unbound_students_count"], 1)
        self.assertTrue(data["unbound_straggler_alert"])

        # Check student roster binding_status
        students = {s["roll_number"]: s for s in data["students"]}
        self.assertEqual(students["21051A0501"]["binding_status"], "enrolled")
        self.assertEqual(students["21051A0502"]["binding_status"], "unbound")

    def test_07_teacher_broadcast_token_unbound_alert(self):
        """Teacher broadcast token reports unbound_students_count and unbound_straggler_alert for live projector view."""
        res = self.client.get(
            f"/api/v1/teacher/sessions/{self.session.id}/broadcast-token",
            headers=self.teacher_headers
        )

        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["unbound_students_count"], 1)
        self.assertTrue(data["unbound_straggler_alert"])

    def test_08_inline_self_healing_enrollment_flow(self):
        """Unbound student encounters 403, enrolls inline, then marks attendance cleanly."""
        settings.BINDING_V2 = True

        # 1. Bob scans -> 403 no_active_binding
        scan1 = self.client.post(
            "/api/v1/student/scan-session",
            json={"session_token": self.session_token, "token_format": "short"},
            headers=self.s2_headers
        )
        self.assertEqual(scan1.status_code, 403)
        self.assertIn("no_active_binding", scan1.json()["detail"])

        # 2. Bob generates keypair and enrolls inline (~3s self-healing)
        bob_priv, bob_spki, bob_kid = _generate_p256_keypair()
        enroll_res = self.client.post(
            "/api/v1/binding/enroll",
            json={
                "public_key_spki_b64": bob_spki,
                "key_id": bob_kid
            },
            headers=self.s2_headers
        )
        self.assertEqual(enroll_res.status_code, 200)

        # 3. Bob requests challenge and signs it
        ch_res = self.client.post(
            "/api/v1/binding/challenge",
            json={},
            headers=self.s2_headers
        )
        self.assertEqual(ch_res.status_code, 200)
        bob_ch = ch_res.json()["challenge_token"]
        bob_sig = _sign_challenge_p1363(bob_priv, bob_ch)

        # 4. Bob rescans -> 200 SUCCESS
        scan2 = self.client.post(
            "/api/v1/student/scan-session",
            json={
                "session_token": self.session_token,
                "token_format": "short",
                "challenge_token": bob_ch,
                "binding_signature": bob_sig
            },
            headers=self.s2_headers
        )
        self.assertEqual(scan2.status_code, 200)
        self.assertEqual(scan2.json()["status"], "SUCCESS")


if __name__ == "__main__":
    unittest.main()
