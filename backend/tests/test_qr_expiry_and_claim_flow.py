"""
SNIST ERP — Automated Verification Test Suite
Tests for:
1. Projector 10s rotation cadence, server-authoritative timestamps, and Cache-Control headers
2. Strict current and previous window verification (windows v and v-1 pass; older rejected with 'expired'; future rejected with 'invalid')
3. Single-use claim ticket exchange (/api/v1/launch/claim) surviving a 20s login delay
4. Atomic single-use claim consumption and duplicate replay prevention
5. Rejection of expired launch token for claim exchange
6. Distinct error codes across scanner and launch flows ('expired', 'invalid', 'no_active_binding', 'geofence_failed')
"""

import os
import sys
import time
from datetime import datetime
import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
root_dir = os.path.dirname(backend_dir)
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)

from app.main import app
from app.core.database import SessionLocal
from app.core.config import settings
from app.core.security import (
    generate_projector_session_token,
    validate_projector_session_token,
    TokenValidationError,
    create_access_token
)
from app.services.qr_token import ShortTokenService
from app.services.launch_token import (
    generate_launch_token,
    validate_launch_token,
    create_claim_ticket,
    validate_and_consume_claim
)
from app.models.models import (
    User, UserRole, Student, Teacher, Subject, Section, Department, AcademicYear,
    AttendanceSession, SessionStatus, AttendanceRecord, AttendanceStatus, DeviceBinding
)
from app.core.binding_crypto import generate_test_p256_keypair, create_test_binding_proof


class TestQRExpiryAndClaimFlow:

    @pytest.fixture(autouse=True)
    def setup_method(self):
        self.client = TestClient(app)
        self.db: Session = SessionLocal()
        orig_geofence = getattr(settings, 'GEOFENCE_ENABLED', False)
        settings.GEOFENCE_ENABLED = True

        # Clear rate limiters for clean test isolation
        try:
            from app.api.student import failed_token_tracker, student_scan_limiter
            failed_token_tracker._failures.clear()
            failed_token_tracker._cooldowns.clear()
            student_scan_limiter._attempts.clear()
        except Exception:
            pass

        # Ensure test department & academic year
        self.dept = self.db.query(Department).filter(Department.code == "CSE").first()
        if not self.dept:
            self.dept = Department(code="CSE", name="Computer Science and Engineering")
            self.db.add(self.dept)
            self.db.commit()

        self.year = self.db.query(AcademicYear).first()
        if not self.year:
            self.year = AcademicYear(name="2025-2026")
            self.db.add(self.year)
            self.db.commit()

        self.section = self.db.query(Section).filter(Section.name == "CSE-A").first()
        if not self.section:
            self.section = Section(name="CSE-A", department_id=self.dept.id, academic_year_id=self.year.id)
            self.db.add(self.section)
            self.db.commit()

        self.subject = self.db.query(Subject).filter(Subject.code == "CS301").first()
        if not self.subject:
            self.subject = Subject(code="CS301", name="Operating Systems", department_id=self.dept.id, academic_year_id=self.year.id)
            self.db.add(self.subject)
            self.db.commit()

        # Teacher user & record
        self.teacher_user = self.db.query(User).filter(User.username == "prof_rot_test").first()
        if not self.teacher_user:
            self.teacher_user = User(
                username="prof_rot_test",
                password_hash="testhash",
                role=UserRole.TEACHER,
                is_active=True
            )
            self.db.add(self.teacher_user)
            self.db.commit()

        self.teacher = self.db.query(Teacher).filter(Teacher.user_id == self.teacher_user.id).first()
        if not self.teacher:
            self.teacher = Teacher(
                user_id=self.teacher_user.id,
                name="Prof. Rotation Test",
                teacher_code="T-ROT-01",
                department_id=self.dept.id
            )
            self.db.add(self.teacher)
            self.db.commit()

        # Student user & record
        self.student_user = self.db.query(User).filter(User.username == "23311A0588").first()
        if not self.student_user:
            self.student_user = User(
                username="23311A0588",
                password_hash="testhash",
                role=UserRole.STUDENT,
                is_active=True
            )
            self.db.add(self.student_user)
            self.db.commit()

        self.student = self.db.query(Student).filter(Student.user_id == self.student_user.id).first()
        if not self.student:
            self.student = Student(
                user_id=self.student_user.id,
                roll_number="23311A0588",
                name="Student Rotation Test",
                section_id=self.section.id,
                department_id=self.dept.id,
                academic_year_id=self.year.id
            )
            self.db.add(self.student)
            self.db.commit()

        # Device binding for student
        self.priv, spki, kid = generate_test_p256_keypair()
        existing_binding = self.db.query(DeviceBinding).filter(DeviceBinding.student_id == self.student.id).first()
        if not existing_binding:
            self.binding = DeviceBinding(
                student_id=self.student.id,
                public_key=spki,
                key_id=kid,
                status="ACTIVE",
                enrolled_at=datetime.utcnow()
            )
            self.db.add(self.binding)
            self.db.commit()
        else:
            existing_binding.public_key = spki
            existing_binding.key_id = kid
            existing_binding.status = "ACTIVE"
            existing_binding.revoked_at = None
            self.db.commit()
            self.binding = existing_binding

        # Active attendance session
        self.session = self.db.query(AttendanceSession).filter(
            AttendanceSession.teacher_id == self.teacher.id,
            AttendanceSession.status == SessionStatus.OPEN
        ).first()
        if not self.session:
            self.session = AttendanceSession(
                subject_id=self.subject.id,
                section_id=self.section.id,
                teacher_id=self.teacher.id,
                session_date=datetime.utcnow().strftime("%Y-%m-%d"),
                period="1",
                status=SessionStatus.OPEN,
                display_type="projector",
                faculty_latitude=17.456,
                faculty_longitude=78.678,
                geofence_radius_m=100.0
            )
            self.db.add(self.session)
            self.db.commit()

        # Tokens
        self.teacher_token = create_access_token({
            "sub": self.teacher_user.username,
            "user_id": self.teacher_user.id,
            "role": "TEACHER"
        })
        self.student_token = create_access_token({
            "sub": self.student_user.username,
            "user_id": self.student_user.id,
            "role": "STUDENT"
        })

        yield

        # Cleanup created session and records
        try:
            self.db.query(AttendanceRecord).filter(AttendanceRecord.session_id == self.session.id).delete()
            self.db.commit()
        except Exception:
            self.db.rollback()
        finally:
            settings.GEOFENCE_ENABLED = orig_geofence
            self.db.close()

    def test_rotation_cadence_and_metadata(self):
        """1. Verify rotation cadence, server-authoritative timestamps, and anti-cache headers."""
        response = self.client.get(
            f"/api/v1/teacher/sessions/{self.session.id}/broadcast-token",
            headers={"Authorization": f"Bearer {self.teacher_token}"}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()

        # Verify Cache-Control header
        cache_control = response.headers.get("Cache-Control", "")
        assert "no-store" in cache_control, f"Expected 'no-store' in Cache-Control, got: {cache_control}"
        assert "no-cache" in cache_control

        # Verify serverNow and expiresAt are returned
        assert "serverNow" in data or "server_now" in data
        assert "expiresAt" in data or "expires_at" in data
        server_now = data.get("serverNow") or data.get("server_now")
        expires_at = data.get("expiresAt") or data.get("expires_at")
        assert expires_at > server_now
        remaining = expires_at - server_now
        assert 0 < remaining <= 10, f"Remaining time should be within 1-10s window step, got {remaining}"

    def test_strict_current_and_previous_window_verification(self):
        """2. Server strictly accepts only current window (v) and previous window (v-1)."""
        base_time = 1700000000.0  # arbitrary baseline epoch

        with patch("time.time", return_value=base_time):
            # Window at base_time (window v)
            token_dict = generate_projector_session_token(self.session.id, 1)
            token = token_dict["payload"]

        # 2a. Verification at base_time (current window v): PASS
        with patch("time.time", return_value=base_time):
            result = validate_projector_session_token(token, now_ts=base_time)
            assert result["session_id"] == self.session.id
            assert result["is_grace_window"] is False

        # 2b. Verification at base_time + 9s (still window v or previous window v-1): PASS
        with patch("time.time", return_value=base_time + 9.0):
            result = validate_projector_session_token(token, now_ts=base_time + 9.0)
            assert result["session_id"] == self.session.id

        # 2c. Verification at base_time + 10s (strictly previous window v-1): PASS
        with patch("time.time", return_value=base_time + 10.0):
            result = validate_projector_session_token(token, now_ts=base_time + 10.0)
            assert result["session_id"] == self.session.id
            assert result["is_grace_window"] is True

        # 2d. Verification at base_time + 25s (2.5 windows later, older than v-1): MUST FAIL with code='expired'
        with patch("time.time", return_value=base_time + 25.0):
            with pytest.raises(TokenValidationError) as exc_info:
                validate_projector_session_token(token, now_ts=base_time + 25.0)
            assert exc_info.value.code == "expired"

        # 2e. Verification with tampered signature: MUST FAIL with code='invalid'
        with patch("time.time", return_value=base_time):
            tampered_token = token[:-4] + "ABCD"
            with pytest.raises(TokenValidationError) as exc_info:
                validate_projector_session_token(tampered_token, now_ts=base_time)
            assert exc_info.value.code == "invalid"

    def _get_student_proof(self):
        return create_test_binding_proof(self.student.id, self.student.roll_number, self.priv)

    def test_claim_ticket_surviving_login_delay(self):
        """3. Launch link exchanges token for a single-use claim that survives a 20s login delay."""
        t0 = 1700000000.0
        v0 = int(t0 // 10)

        with patch("time.time", return_value=t0):
            launch_token = generate_launch_token(
                session_id=self.session.id,
                short_code="8XK2Q7MD",
                v=v0
            )

        # Step 1: Student lands on /a/<token> 2 seconds later (unauthenticated)
        # Immediately exchanges launch token for claim ticket
        with patch("time.time", return_value=t0 + 2.0):
            claim_resp = self.client.post(
                "/api/v1/launch/claim",
                json={"launch_token": launch_token}
            )
            assert claim_resp.status_code == 200, f"Claim failed: {claim_resp.text}"
            claim_data = claim_resp.json()
            assert claim_data["valid"] is True
            assert "claim_token" in claim_data
            claim_token = claim_data["claim_token"]
            assert claim_data.get("expires_in") == 180 or claim_data.get("expires_in_seconds") == 180

        # Step 2: Student spends 20 seconds authenticating (t0 + 22s).
        # Note that the original 10s projector token is now older than 2 windows and would be expired.
        # But the single-use claim ticket is valid for 180s!
        with patch("time.time", return_value=t0 + 22.0):
            attend_resp = self.client.post(
                "/api/v1/launch/attend",
                headers={"Authorization": f"Bearer {self.student_token}"},
                json={
                    "claim_token": claim_token,
                    "latitude": 17.456,
                    "longitude": 78.678,
                    "accuracy_m": 5.0,
                    **self._get_student_proof()
                }
            )
            assert attend_resp.status_code == 200, f"Attend with claim failed: {attend_resp.text}"
            attend_data = attend_resp.json()
            assert attend_data["status"] in ("PRESENT", "SUCCESS", "QUEUED")

        # Step 3: Atomic single-use claim protection: Re-using the same claim ticket MUST fail!
        with patch("time.time", return_value=t0 + 23.0):
            replay_resp = self.client.post(
                "/api/v1/launch/attend",
                headers={"Authorization": f"Bearer {self.student_token}"},
                json={
                    "claim_token": claim_token,
                    "latitude": 17.456,
                    "longitude": 78.678,
                    "accuracy_m": 5.0,
                    **self._get_student_proof()
                }
            )
            assert replay_resp.status_code == 400
            replay_data = replay_resp.json()
            replay_code = replay_data.get("code") or (replay_data.get("detail", {}) if isinstance(replay_data.get("detail"), dict) else {}).get("code")
            assert replay_code in ("invalid", "expired")

    def test_claim_rejection_for_expired_launch_token(self):
        """4. Attempting to exchange an expired launch token for a claim is rejected with code='expired'."""
        t0 = 1700000000.0
        v0 = int(t0 // 10)

        with patch("time.time", return_value=t0):
            launch_token = generate_launch_token(
                session_id=self.session.id,
                short_code="8XK2Q7MD",
                v=v0
            )

        # 25 seconds later, launch token is older than current (v) and previous (v-1) windows
        with patch("time.time", return_value=t0 + 25.0):
            claim_resp = self.client.post(
                "/api/v1/launch/claim",
                json={"launch_token": launch_token}
            )
            assert claim_resp.status_code == 400
            claim_data = claim_resp.json()
            detail = claim_data.get("detail", {}) if isinstance(claim_data.get("detail"), dict) else {}
            code = claim_data.get("code") or detail.get("code")
            assert code == "expired"
            assert ("serverNow" in claim_data) or ("serverNow" in detail)

    def test_distinct_server_error_codes(self):
        """5. Verify distinct error codes: expired, invalid, no_active_binding, geofence_failed."""
        t0 = 1700000000.0

        with patch("time.time", return_value=t0):
            token_dict = generate_projector_session_token(self.session.id, 1)
            token = token_dict["payload"]

        # 5a. Expired code
        with patch("time.time", return_value=t0 + 30.0):
            scan_resp = self.client.post(
                "/api/v1/student/scan-session",
                headers={"Authorization": f"Bearer {self.student_token}"},
                json={
                    "session_token": token,
                    "latitude": 17.456,
                    "longitude": 78.678,
                    "accuracy_m": 5.0,
                    **self._get_student_proof()
                }
            )
            assert scan_resp.status_code == 400
            data = scan_resp.json()
            detail = data.get("detail", {}) if isinstance(data.get("detail"), dict) else {}
            code = data.get("code") or detail.get("code")
            assert code == "expired"
            assert ("serverNow" in data) or ("serverNow" in detail)

        # 5b. Invalid code
        with patch("time.time", return_value=t0):
            scan_resp = self.client.post(
                "/api/v1/student/scan-session",
                headers={"Authorization": f"Bearer {self.student_token}"},
                json={
                    "session_token": "TOTALLY_CORRUPTED_TOKEN",
                    "latitude": 17.456,
                    "longitude": 78.678,
                    "accuracy_m": 5.0,
                    **self._get_student_proof()
                }
            )
            assert scan_resp.status_code == 400
            data = scan_resp.json()
            detail = data.get("detail", {}) if isinstance(data.get("detail"), dict) else {}
            code = data.get("code") or detail.get("code")
            assert code == "invalid"

        # 5c. No active binding code (missing challenge/signature proof)
        with patch("time.time", return_value=t0):
            scan_resp = self.client.post(
                "/api/v1/student/scan-session",
                headers={"Authorization": f"Bearer {self.student_token}"},
                json={
                    "session_token": token,
                    "latitude": 17.456,
                    "longitude": 78.678,
                    "accuracy_m": 5.0
                }
            )
            assert scan_resp.status_code == 403
            data = scan_resp.json()
            detail = data.get("detail", {}) if isinstance(data.get("detail"), dict) else {}
            code = data.get("code") or detail.get("code")
            assert code == "no_active_binding"

        # 5d. Geofence failed code (valid proof, but student location outside geofence radius)
        with patch("time.time", return_value=t0):
            scan_resp = self.client.post(
                "/api/v1/student/scan-session",
                headers={"Authorization": f"Bearer {self.student_token}"},
                json={
                    "session_token": token,
                    "latitude": 19.000,  # far away from faculty 17.456
                    "longitude": 72.000,
                    "accuracy_m": 5.0,
                    **self._get_student_proof()
                }
            )
            assert scan_resp.status_code == 403
            data = scan_resp.json()
            detail = data.get("detail", {}) if isinstance(data.get("detail"), dict) else {}
            code = data.get("code") or detail.get("code")
            assert code == "geofence_failed"

    def test_scanner_recovering_after_expired_response(self):
        """6. Verify scanner recovery: after receiving 'expired' error on old QR, fresh QR succeeds immediately."""
        t0 = 1700000000.0
        v0 = int(t0 // 10)

        # Step 1: Initial token generated at t0
        with patch("time.time", return_value=t0):
            old_launch_token = generate_launch_token(
                session_id=self.session.id,
                short_code="8XK2Q7MD",
                v=v0
            )

        # Step 2: 30 seconds later, student scans old token -> rejected with 'expired'
        t_scan_old = t0 + 30.0
        with patch("time.time", return_value=t_scan_old):
            old_resp = self.client.post(
                "/api/v1/student/scan-session",
                headers={"Authorization": f"Bearer {self.student_token}"},
                json={
                    "session_token": old_launch_token,
                    "latitude": 17.456,
                    "longitude": 78.678,
                    "accuracy_m": 5.0,
                    **self._get_student_proof()
                }
            )
            assert old_resp.status_code == 400
            old_data = old_resp.json()
            detail = old_data.get("detail", {}) if isinstance(old_data.get("detail"), dict) else {}
            code = old_data.get("code") or detail.get("code")
            assert code == "expired"

        # Step 3: Projector rotates to fresh token at t0 + 30s (window v3)
        v3 = int(t_scan_old // 10)
        with patch("time.time", return_value=t_scan_old):
            fresh_launch_token = generate_launch_token(
                session_id=self.session.id,
                short_code="8XK2Q7MD",
                v=v3
            )

        # Step 4: Scanner immediately detects fresh token (no lockup, no cooldown blocker for single expired scan)
        with patch("time.time", return_value=t_scan_old + 2.0):
            fresh_resp = self.client.post(
                "/api/v1/student/scan-session",
                headers={"Authorization": f"Bearer {self.student_token}"},
                json={
                    "session_token": fresh_launch_token,
                    "latitude": 17.456,
                    "longitude": 78.678,
                    "accuracy_m": 5.0,
                    **self._get_student_proof()
                }
            )
            assert fresh_resp.status_code == 200, f"Fresh scan failed: {fresh_resp.text}"
            fresh_data = fresh_resp.json()
            assert fresh_data.get("status") in ("PRESENT", "SUCCESS", "QUEUED", "ALREADY_MARKED")

    def test_claim_not_consumed_on_binding_failure_and_succeeds_on_retry(self):
        """7. Claim ticket is NOT consumed when attendance fails due to missing device binding (403).
        After enrolling, retrying with the SAME claim ticket succeeds!
        """
        t0 = 1700000000.0
        v0 = int(t0 // 10)

        with patch("time.time", return_value=t0):
            launch_token = generate_launch_token(
                session_id=self.session.id,
                short_code="8XK2Q7MD",
                v=v0
            )

        # Step 1: Student exchanges launch token for claim ticket
        with patch("time.time", return_value=t0 + 2.0):
            claim_resp = self.client.post(
                "/api/v1/launch/claim",
                json={"launch_token": launch_token}
            )
            assert claim_resp.status_code == 200
            claim_token = claim_resp.json()["claim_token"]

        # Step 2: Student attempts attendance WITHOUT device binding proof -> 403 Forbidden
        with patch("time.time", return_value=t0 + 10.0):
            fail_resp = self.client.post(
                "/api/v1/launch/attend",
                headers={"Authorization": f"Bearer {self.student_token}"},
                json={
                    "claim_token": claim_token,
                    "latitude": 17.456,
                    "longitude": 78.678,
                    "accuracy_m": 5.0
                    # NO binding proof
                }
            )
            assert fail_resp.status_code == 403

        # Step 3: Student completes device binding and retries with the SAME claim ticket -> SUCCESS
        with patch("time.time", return_value=t0 + 15.0):
            retry_resp = self.client.post(
                "/api/v1/launch/attend",
                headers={"Authorization": f"Bearer {self.student_token}"},
                json={
                    "claim_token": claim_token,
                    "latitude": 17.456,
                    "longitude": 78.678,
                    "accuracy_m": 5.0,
                    **self._get_student_proof()
                }
            )
            assert retry_resp.status_code == 200, f"Retry with claim ticket should succeed: {retry_resp.text}"
            retry_data = retry_resp.json()
            assert retry_data.get("status") in ("PRESENT", "SUCCESS", "QUEUED", "ALREADY_MARKED")

        # Step 4: Replay MUST fail with 400 because attendance succeeded in Step 3
        with patch("time.time", return_value=t0 + 20.0):
            replay_resp = self.client.post(
                "/api/v1/launch/attend",
                headers={"Authorization": f"Bearer {self.student_token}"},
                json={
                    "claim_token": claim_token,
                    "latitude": 17.456,
                    "longitude": 78.678,
                    "accuracy_m": 5.0,
                    **self._get_student_proof()
                }
            )
            assert replay_resp.status_code == 400


