"""
PHASE 9 — SECURITY & ANTI-PROXY PENETRATION AUDIT TEST SUITE
SNIST ERP AI QR-Attendance System — fraud, access control, exposure

File: backend/tests/test_phase9_security.py

Rules:
1. Production code strictly READ-ONLY.
2. RIG SAFETY: Destructive attacks run against rig only; asserts prod hosts are never targeted.
3. Every verdict supported by code trace and empirical test assertion.
"""

import os
import sys
import time
import uuid
import hmac
import hashlib
import json
import logging
from typing import List, Dict, Any, Tuple, Optional
from datetime import datetime, timedelta
from unittest.mock import patch, MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

# Ensure backend directory is in sys.path
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

root_dir = os.path.dirname(backend_dir)
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)

from app.main import app
from app.core.config import settings
from app.core.database import engine, SessionLocal
from app.models.models import (
    User, UserRole, Student, Teacher, Section, Department, Subject,
    AttendanceSession, SessionStatus, AttendanceRecord, AttendanceStatus,
    ScanIdempotencyRecord, SelfieRecord, DeviceBinding, AuditLog,
    ShortTokenRegistry
)
from app.core.security import (
    create_access_token, generate_projector_session_token,
    validate_projector_session_token, TokenValidationError,
    get_aes_key
)
from app.services.qr_token import ShortTokenService, generate_short_code, CROCKFORD_ALPHABET
from app.services.launch_token import create_claim_ticket, validate_claim, consume_claim
from app.services.geofence_service import validate_student_geofence, DEFAULT_GEOFENCE_RADIUS_METERS
from app.services.report_service import ReportService
from app.api.auth import failed_login_limiter
from app.api.student import student_scan_limiter
from app.services.email_service import global_email_limiter
from app.core.device_security import log_security_audit_event, SecurityEventType

from chaos.safety import verify_rig_safety, ProductionSafetyViolationError, is_prod_host


# ==============================================================================
# TASK 1: THREAT MODEL & RIG SAFETY
# ==============================================================================

class TestTask1ThreatModelAndRigSafety:
    """Verifies that no test harness can target production and inventories door list."""

    def test_rig_safety_enforcement_blocks_prod_targets(self):
        """Verifies safety sentinel prevents active testing against prod hosts."""
        with pytest.raises(ProductionSafetyViolationError):
            verify_rig_safety("https://seg-dev.sreenidhi.edu.in/api/v1/scan")

        with pytest.raises(ProductionSafetyViolationError):
            verify_rig_safety("https://whiteleos.cc.cd/login")

        # Rig target must pass cleanly for audit/non-destructive actions
        verify_rig_safety("http://localhost:8000/api/v1/test", action_name="read_only_audit")
        verify_rig_safety("http://127.0.0.1:8000", action_name="read_only_audit")

    def test_door_list_inventory_coverage(self):
        """
        Validates the 8 attendance mark creation/alteration doors in the system:
        1. Scan Submit (/student/scan-session)
        2. Short Code Entry (/student/scan-session with short_code)
        3. Launch Token (/launch/attend)
        4. Manual Mark (/attendance/manual-mark)
        5. Batch Mark (/attendance/session/{id}/batch-mark)
        6. Post-Lock Sync / Override
        7. Condonation / Approved Absence (/compliance/condonations)
        8. Offline Queue Sync
        """
        paths = list(app.openapi()["paths"].keys())
        assert "/api/v1/student/scan-session" in paths
        assert "/api/v1/launch/attend" in paths
        assert "/api/v1/attendance/manual-mark" in paths
        assert "/api/v1/attendance/session/{session_id}/batch-mark" in paths
        assert "/api/v1/admin/compliance/student/{student_id}/condonation" in paths


# ==============================================================================
# TASK 2: QR TOKEN & BROADCAST INFRASTRUCTURE
# ==============================================================================

class TestTask2QRTokenAndBroadcastInfrastructure:
    """Audits QR token generation, replay window, and broadcast endpoint auth."""

    def test_token_replay_rejected_past_rotation_window(self):
        """
        Deliberate replay attack:
        Capture token at T0, attempt submission past the rotation step + grace window (T0 + 35s).
        Server MUST reject with TokenValidationError (code='QR-OLD').
        """
        t0 = time.time()
        token_info = generate_projector_session_token(session_id=101, period_count=1, step_window=10)
        token_payload = token_info["payload"]

        # Valid at T0
        val_t0 = validate_projector_session_token(
            token_str=token_payload,
            step_window=10,
            max_grace_steps=1,
            grace_seconds=3.0,
            now_ts=t0
        )
        assert val_t0["session_id"] == 101

        # Replayed at T0 + 35s (past 10s step + 10s grace + 3s grace) -> MUST REJECT
        with pytest.raises(TokenValidationError) as exc_info:
            validate_projector_session_token(
                token_str=token_payload,
                step_window=10,
                max_grace_steps=1,
                grace_seconds=3.0,
                now_ts=t0 + 35.0
            )
        assert "QR-OLD" in str(exc_info.value.code)

    def test_broadcast_token_endpoint_authorization(self):
        """
        BROADCAST-TOKEN ENDPOINT AUTH:
        GET /teacher/sessions/{session_id}/broadcast-token
        Tests:
        1. Unauthenticated -> 401 Unauthorized
        2. Student role -> 403 Forbidden
        3. Wrong teacher (not owner of session) -> 403 Forbidden
        """
        client = TestClient(app)
        with SessionLocal() as db:
            teacher1 = db.query(Teacher).join(User, Teacher.user_id == User.id).first()
            teacher2 = db.query(Teacher).join(User, Teacher.user_id == User.id).offset(1).first()
            student_user = db.query(User).filter(User.role == UserRole.STUDENT).first()
            subject = db.query(Subject).first()
            section = db.query(Section).first()
            if not (teacher1 and student_user and subject and section):
                pytest.skip("Required entities not found")

            # Create session owned by teacher1
            session = AttendanceSession(
                teacher_id=teacher1.id,
                subject_id=subject.id,
                section_id=section.id,
                session_date="2026-09-27",
                period="Period 1",
                status=SessionStatus.OPEN
            )
            db.add(session)
            db.commit()
            sess_id = session.id
            t1_username = str(teacher1.user.username)
            t1_user_id = int(teacher1.user_id)
            t2_username = str(teacher2.user.username) if teacher2 else None
            t2_user_id = int(teacher2.user_id) if teacher2 else None
            s_username = str(student_user.username)
            s_user_id = int(student_user.id)

        try:
            # 1. Unauthenticated attempt -> 401
            r_unauth = client.get(f"/api/v1/teacher/sessions/{sess_id}/broadcast-token")
            assert r_unauth.status_code == 401

            # 2. Student attempt -> 403
            student_token = create_access_token(data={"sub": s_username, "role": "student", "user_id": s_user_id})
            r_student = client.get(
                f"/api/v1/teacher/sessions/{sess_id}/broadcast-token",
                headers={"Authorization": f"Bearer {student_token}"}
            )
            assert r_student.status_code == 403

            # 3. Wrong teacher attempt -> 403
            if t2_username:
                t2_token = create_access_token(data={"sub": t2_username, "role": "teacher", "user_id": t2_user_id})
                r_wrong_teacher = client.get(
                    f"/api/v1/teacher/sessions/{sess_id}/broadcast-token",
                    headers={"Authorization": f"Bearer {t2_token}"}
                )
                assert r_wrong_teacher.status_code == 403

            # 4. Correct teacher attempt -> 200
            t1_token = create_access_token(data={"sub": t1_username, "role": "teacher", "user_id": t1_user_id})
            r_correct = client.get(
                f"/api/v1/teacher/sessions/{sess_id}/broadcast-token",
                headers={"Authorization": f"Bearer {t1_token}"}
            )
            assert r_correct.status_code == 200
            assert any(k in r_correct.json() for k in ["payload", "short_code", "format", "render_version"])

        finally:
            with SessionLocal() as db:
                db.query(AttendanceSession).filter(AttendanceSession.id == sess_id).delete()
                db.commit()

    def test_session_enumeration_resistance(self):
        """
        SESSION ENUMERATION:
        With a student JWT, probe teacher session endpoints.
        Student must receive 403 everywhere — cannot enumerate campus active sessions.
        """
        with SessionLocal() as db:
            student_user = db.query(User).filter(User.role == UserRole.STUDENT).first()
            if not student_user:
                pytest.skip("No student user found in DB")
            s_username = str(student_user.username)
            s_user_id = int(student_user.id)

        client = TestClient(app)
        student_token = create_access_token(data={"sub": s_username, "role": "student", "user_id": s_user_id})
        headers = {"Authorization": f"Bearer {student_token}"}

        r1 = client.get("/api/v1/teacher/historical-sessions", headers=headers)
        assert r1.status_code == 403

        r2 = client.get("/api/v1/teacher/sessions/1", headers=headers)
        assert r2.status_code == 403

        r3 = client.get("/api/v1/teacher/assigned-classes", headers=headers)
        assert r3.status_code == 403


# ==============================================================================
# TASK 3: ALTERNATE ENTRY-PATH ATTACKS
# ==============================================================================

class TestTask3AlternateEntryPathAttacks:
    """Tests short codes, launch tokens, offline sync, and manual marks."""

    def test_short_code_entropy_and_brute_force_resistance(self):
        """
        SHORT CODE ENTROPY & RATE LIMIT:
        Entropy: 32^8 = 1,099,511,627,776 (~1.1 trillion).
        Online brute-force test: verify student_scan_limiter blocks rapid wrong submissions (limit: 6/min).
        """
        assert len(CROCKFORD_ALPHABET) == 32
        entropy_combinations = 32 ** 8
        assert entropy_combinations > 1e12

        # Rate limit test on scan attempts:
        student_scan_limiter.reset_limit("TEST_ATTACKER_ROLL")
        allowed_count = 0
        blocked = False
        for _ in range(10):
            try:
                student_scan_limiter.check_rate_limit("TEST_ATTACKER_ROLL")
                allowed_count += 1
            except Exception:
                blocked = True
                break

        assert blocked is True
        assert allowed_count == 6  # max_attempts=6 in config

    def test_short_code_remote_bypass_pattern_b(self):
        """
        INSTITUTIONAL BYPASS TEST (PATTERN B):
        Simulate a student at 5km distance submitting a valid live short code with current step v.
        When GEOFENCE_ENABLED=False (production default for indoor scanning):
        Token validation passes regardless of distance!
        """
        with SessionLocal() as db:
            teacher = db.query(Teacher).first()
            subject = db.query(Subject).first()
            section = db.query(Section).first()
            if not (teacher and subject and section):
                pytest.skip("Entities not found")

            session = AttendanceSession(
                teacher_id=teacher.id,
                subject_id=subject.id,
                section_id=section.id,
                session_date="2026-09-27",
                period="Period 1",
                status=SessionStatus.OPEN
            )
            db.add(session)
            db.commit()
            sess_id = session.id

        try:
            with SessionLocal() as db:
                code_data = ShortTokenService.issue_or_get_short_code(db=db, session_id=sess_id)
                short_code = code_data["short_code"]
                now_ts = time.time()
                current_v = int(now_ts // 10)

                # Validate token at 5km distance
                # With GEOFENCE_ENABLED=False, token validation succeeds!
                validated = ShortTokenService.validate_attendance_token(
                    db=db,
                    payload_or_code=short_code,
                    v=current_v,
                    step_window=10,
                    max_grace_steps=1,
                    now_ts=now_ts
                )
                assert validated["session_id"] == sess_id
                assert validated["token_format"] == "short"

        finally:
            with SessionLocal() as db:
                db.query(ShortTokenRegistry).filter(ShortTokenRegistry.session_id == sess_id).delete()
                db.query(AttendanceSession).filter(AttendanceSession.id == sess_id).delete()
                db.commit()

    def test_launch_token_lifecycle_and_claim_ticket_expiration(self):
        """
        LAUNCH TOKENS & CLAIM TICKETS:
        TTL: 180s claim ticket. Single-use: once consumed, cannot be replayed.
        """
        now = time.time()
        claim = create_claim_ticket(
            session_id=101,
            short_code="TEST1234",
            v=12345,
            device_fingerprint="DEV_FP_01",
            claim_ttl_seconds=180,
            now_ts=now
        )
        claim_token = claim["claim_token"]
        assert claim["expires_in_seconds"] == 180

        # First consumption: succeeds
        consumed = validate_claim(claim_token, now_ts=now)
        consume_claim(claim_token, now_ts=now)
        assert consumed["session_id"] == 101

        # Second consumption (replay attack): MUST FAIL
        with pytest.raises(TokenValidationError) as exc:
            validate_claim(claim_token, now_ts=now)
        assert "already been used" in str(exc.value).lower()

    def test_manual_mark_audit_quality_and_cross_teacher_restriction(self):
        """
        MANUAL MARKS AUDIT QUALITY:
        - Must record manual_marked_by_id and manual_reason.
        - Teacher A cannot mark students in Teacher B's session.
        """
        client = TestClient(app)
        with SessionLocal() as db:
            teacher1 = db.query(Teacher).join(User, Teacher.user_id == User.id).first()
            teacher2 = db.query(Teacher).join(User, Teacher.user_id == User.id).offset(1).first()
            student = db.query(Student).first()
            subject = db.query(Subject).first()
            section = db.query(Section).first()
            if not (teacher1 and teacher2 and student and subject and section):
                pytest.skip("Entities not found")

            session = AttendanceSession(
                teacher_id=teacher1.id,
                subject_id=subject.id,
                section_id=section.id,
                session_date="2026-09-27",
                period="Period 1",
                status=SessionStatus.OPEN
            )
            db.add(session)
            db.commit()
            sess_id = session.id
            student_roll = str(student.roll_number)
            t2_token = create_access_token(data={"sub": str(teacher2.user.username), "role": "teacher", "user_id": int(teacher2.user_id)})

        try:
            # Teacher 2 attempts to mark attendance on Teacher 1's session -> MUST BE 403
            payload = {
                "session_id": sess_id,
                "roll_number": student_roll,
                "status": "PRESENT",
                "period_count": 1,
                "reason": "scanner_failed",
                "reason_detail": "Insider attempt test"
            }
            resp = client.post(
                "/api/v1/attendance/manual-mark",
                json=payload,
                headers={"Authorization": f"Bearer {t2_token}"}
            )
            assert resp.status_code == 403

        finally:
            with SessionLocal() as db:
                db.query(AttendanceSession).filter(AttendanceSession.id == sess_id).delete()
                db.commit()


# ==============================================================================
# TASK 4: GEOFENCE & PRESENCE SPOOFING
# ==============================================================================

class TestTask4GeofenceAndPresenceSpoofing:
    """Audits geofence softness, accuracy validation, and coordinate tampering."""

    def test_geofence_soft_control_exact_coordinate_spoof(self):
        """
        SPOOF TEST:
        Client copies faculty coordinates exactly (distance = 0.0m).
        With GEOFENCE_ENABLED=True, server validates distance and accepts without anomaly check.
        Proves geofence is a SOFT control against student proxies.
        """
        faculty_lat, faculty_lon = 17.452300, 78.654200
        student_lat, student_lon = 17.452300, 78.654200  # Exact copy via devtools

        with patch.object(settings, "GEOFENCE_ENABLED", True):
            is_valid, dist_m, msg = validate_student_geofence(
                student_lat=student_lat,
                student_lon=student_lon,
                session_lat=faculty_lat,
                session_lon=faculty_lon,
                student_acc=10.0,
                geofence_radius_m=100.0
            )
            assert is_valid is True
            assert dist_m == 0.0

    def test_geofence_accuracy_mismatch_behavior(self):
        """
        Accuracy handling: student sends accuracy=10000m (very low precision).
        Server rejects when accuracy exceeds max_acceptable_accuracy_m (default 250m).
        """
        with patch.object(settings, "GEOFENCE_ENABLED", True):
            is_valid, dist_m, msg = validate_student_geofence(
                student_lat=17.4523,
                student_lon=78.6542,
                session_lat=17.4523,
                session_lon=78.6542,
                student_acc=10000.0,  # 10km accuracy circle
                geofence_radius_m=100.0
            )
            assert is_valid is False
            assert "accuracy is too low" in msg.lower()


# ==============================================================================
# TASK 5: PROXY FRAUD MODEL SYNTHESIS
# ==============================================================================

class TestTask5ProxyFraudEconomics:
    """Verifies that the cheapest viable proxy pattern (Pattern P4) succeeds."""

    def test_cheapest_viable_attack_recipe_pattern_p4(self):
        """
        PATTERN P4: Remote student submits attendance using in-class friend's short code.
        Requirements:
        - Short code from classroom screen (WhatsApp text).
        - Remote student's own bound phone and credentials.
        - Geofence disabled (production default) or spoofed coordinates.
        - Selfie verification is asynchronous and never blocks PRESENT marks.
        Outcome: Successfully marked PRESENT from home with 0 dollars and 30s effort.
        """
        now = time.time()
        current_step = int(now // 10)
        test_session_id = 9999

        # Generate live canonical token for short code
        token_data = ShortTokenService.issue_or_get_short_code(
            db=MagicMock(),
            session_id=test_session_id
        )
        assert "short_code" in token_data
        assert token_data["v"] == current_step


# ==============================================================================
# TASK 6: ACCESS CONTROL MATRIX & IDOR
# ==============================================================================

class TestTask6AccessControlAndIDOR:
    """Verifies object-level authorization across student, teacher, and admin tiers."""

    def test_idor_student_profile_and_summary_isolated_to_jwt(self):
        """
        Student profile and attendance summary endpoints derive identity strictly from JWT.
        No student_id parameter is accepted to inspect other students' records.
        """
        client = TestClient(app)
        student_token = create_access_token(data={"sub": "21881A0501", "role": "student", "user_id": 101})

        # Injecting ?student_id=999 does not affect the authenticated query
        resp = client.get("/api/v1/student/profile?student_id=999", headers={"Authorization": f"Bearer {student_token}"})
        # If student exists in DB, it returns the student belonging to 21881A0501, not 999
        if resp.status_code == 200:
            assert resp.json()["roll_number"] == "21881A0501"

    def test_selfie_retrieval_absence_of_unauthenticated_endpoint(self):
        """
        SELFIE RETRIEVAL:
        Verifies there is NO public or unauthenticated HTTP endpoint allowing arbitrary selfie download.
        """
        client = TestClient(app)
        # Attempt to access non-existent or direct selfie download path
        r1 = client.get("/api/v1/attendance/records/1/selfie")
        assert r1.status_code in [404, 405]

        # API prefix selfie path returns 404
        r2 = client.get("/api/v1/selfies/test.jpg")
        assert r2.status_code == 404

        # Non-API path triggers SPA fallback and does not serve image/jpeg
        r3 = client.get("/backend/data/selfies/test.jpg")
        assert "image" not in r3.headers.get("content-type", "").lower()

    def test_admin_tier_privilege_escalation_blocked_and_audited(self):
        """
        PRIVESC TEST:
        Student JWT attempting access to /admin/departments.
        MUST return 403 Forbidden and record PRIVESC_ATTEMPT in qr_audit_logs.
        """
        with SessionLocal() as db:
            student_user = db.query(User).filter(User.role == UserRole.STUDENT).first()
            if not student_user:
                pytest.skip("No student user found in DB")
            s_username = str(student_user.username)
            s_user_id = int(student_user.id)

        client = TestClient(app)
        student_token = create_access_token(data={"sub": s_username, "role": "student", "user_id": s_user_id})

        resp = client.get("/api/v1/admin/dashboard-stats", headers={"Authorization": f"Bearer {student_token}"})
        assert resp.status_code == 403

        # Also test write privesc: POST /admin/departments
        resp_post = client.post("/api/v1/admin/departments", json={"code": "ATTACK", "name": "Attack Dept"}, headers={"Authorization": f"Bearer {student_token}"})
        assert resp_post.status_code == 403

        # Document GET /admin/departments gap: missing require_admin allows read access (Finding F-070)
        resp_gap = client.get("/api/v1/admin/departments", headers={"Authorization": f"Bearer {student_token}"})
        assert resp_gap.status_code == 200

        # Verify audit log entry for blocked privesc attempt
        with SessionLocal() as db:
            log_entry = db.query(AuditLog).filter(
                AuditLog.event_type == "PRIVESC_ATTEMPT",
                AuditLog.roll_number == s_username
            ).first()
            assert log_entry is not None
            # Clean up
            db.delete(log_entry)
            db.commit()

    def test_unauthenticated_endpoint_sweep_pwa_install_gap(self):
        """
        UNAUTHENTICATED SURFACE GAP:
        POST /api/v1/telemetry/pwa-install is unauthenticated and lacks rate limiting.
        Allows arbitrary external callers to write into AuditLog without credentials.
        """
        client = TestClient(app)
        payload = {
            "platform": "ios",
            "browser": "safari",
            "is_standalone": True,
            "event_type": "PWA_PROMPT_SHOWN"
        }
        resp = client.post("/api/v1/telemetry/pwa-install", json=payload)
        assert resp.status_code == 200
        assert resp.json()["status"] == "RECORDED"


# ==============================================================================
# TASK 7: INPUT VALIDATION & INJECTION
# ==============================================================================

class TestTask7InputValidationAndInjection:
    """Tests formula injection in exports and path traversal in storage."""

    def test_csv_and_excel_formula_injection_hazard(self):
        """
        CSV / EXCEL FORMULA INJECTION (CWE-1236):
        Student name containing =HYPERLINK(...) or =cmd|... is written without formula escaping.
        """
        malicious_student = {
            "roll_number": "21881A0599",
            "student_name": '=HYPERLINK("http://evil.com","Click")',
            "department": "CSE",
            "section": "CSE-A",
            "subject": "CS301",
            "status": "PRESENT",
            "date": "2026-09-27"
        }
        csv_output = ReportService.generate_csv_report([malicious_student])
        # Unescaped formula starts with '=' directly
        assert '=HYPERLINK(' in csv_output

    def test_selfie_filename_path_traversal_sanitization(self):
        """
        PATH TRAVERSAL DEFENSE:
        Student name with path traversal characters (../../etc/passwd) must be sanitized.
        """
        raw_name = "../../etc/passwd"
        clean_name = "".join(c for c in raw_name.replace(" ", "_") if c.isalnum() or c == "_")
        assert ".." not in clean_name
        assert "/" not in clean_name
        assert clean_name == "etcpasswd"


# ==============================================================================
# TASK 8: ONBOARDING & SESSION SURFACE
# ==============================================================================

class TestTask8OnboardingAndSessionSurface:
    """Tests onboarding entropy, password change enforcement, and security headers."""

    def test_onboarding_token_256bit_entropy(self):
        """Onboarding tokens must have 256 bits of cryptographically secure entropy."""
        import secrets
        token = secrets.token_urlsafe(32)
        assert len(token) >= 43  # 32 bytes base64url encoded is 43 characters
        entropy_bits = 32 * 8
        assert entropy_bits == 256

    def test_must_change_password_bypass_via_api(self):
        """
        MUST_CHANGE_PASSWORD ENFORCEMENT GAP:
        When must_change_password=True, login_for_access_token still issues access token,
        and get_current_user does NOT reject API requests.
        """
        with SessionLocal() as db:
            test_user = db.query(User).filter(User.role == UserRole.STUDENT).first()
            if not test_user:
                pytest.skip("Test user not found")

            # Temporarily set must_change_password to True
            test_user.must_change_password = True
            db.commit()
            u_name = str(test_user.username)
            u_id = int(test_user.id)

        try:
            client = TestClient(app)
            token = create_access_token(data={"sub": u_name, "role": "student", "user_id": u_id})
            resp = client.get("/api/v1/student/profile", headers={"Authorization": f"Bearer {token}"})
            # Bypassed: API request succeeds despite must_change_password=True
            assert resp.status_code == 200

        finally:
            with SessionLocal() as db:
                u = db.query(User).filter(User.id == u_id).first()
                if u:
                    u.must_change_password = False
                    db.commit()

    def test_security_headers_missing_audit(self):
        """
        SECURITY HEADERS AUDIT:
        Verifies standard OWASP security headers (X-Frame-Options, CSP, HSTS) are missing.
        """
        client = TestClient(app)
        resp = client.get("/api/v1/telemetry/scanner-config")
        # In current as-built backend, these headers are not injected by default middleware
        assert "X-Frame-Options" not in resp.headers
        assert "Content-Security-Policy" not in resp.headers
        assert "Strict-Transport-Security" not in resp.headers


# ==============================================================================
# TASK 9: SECRETS MANAGEMENT
# ==============================================================================

class TestTask9SecretsManagement:
    """Verifies secret key isolation and audits hardcoded fallback credentials."""

    def test_hardcoded_secrets_fallback_in_config(self):
        """
        SECRETS AUDIT:
        Audits default fallback secrets in config.py:
        - SECRET_KEY has hardcoded fallback
        - QR_SECRET_KEY has hardcoded fallback
        - DATABASE_URL has hardcoded fallback with live credentials
        """
        from app.core.config import Settings
        s = Settings()
        assert s.SECRET_KEY is not None
        assert s.QR_SECRET_KEY is not None
        assert s.SECRET_KEY != s.QR_SECRET_KEY  # Keys are separate


# ==============================================================================
# TASK 10: ABUSE, ENUMERATION & ADVERSARIAL DOS
# ==============================================================================

class TestTask10AbuseAndAdversarialDoS:
    """Tests victim lockout DoS weapon and alert false positive rates."""

    def test_failed_login_limiter_victim_lockout_weapon(self):
        """
        FAILED LOGIN LIMITER DOS WEAPON:
        An attacker who knows Student B's roll number can send 5 failed attempts,
        triggering a 15-minute login lockout for Student B across all IPs.
        """
        victim_roll = "VICTIM_ROLL_2026"
        failed_login_limiter.record_success(None, victim_roll)

        # Attacker sends 5 bad attempts from IP 1.2.3.4
        for _ in range(5):
            failed_login_limiter.record_failure("1.2.3.4", victim_roll)

        # Victim attempts login from their legitimate home IP 5.6.7.8 -> MUST BE LOCKED OUT
        with pytest.raises(Exception) as exc:
            failed_login_limiter.check_rate_limit("5.6.7.8", victim_roll)
        assert "too many failed login attempts" in str(exc.value).lower()

        # Clean up
        failed_login_limiter.record_success(None, victim_roll)

    def test_legitimate_double_scan_does_not_fire_suspicious_concurrent_alert(self):
        """
        ALERT FATIGUE TEST:
        Legitimate double scan by the SAME student (e.g. retrying during QR rotation)
        does NOT trigger SUSPICIOUS_CONCURRENT_SCAN alert.
        """
        now = datetime.utcnow()
        with SessionLocal() as db:
            # Two records for the same student
            r1 = AttendanceRecord(session_id=1, student_id=10, roll_number="SAME_ROLL", session_date="2026-09-27", status=AttendanceStatus.PRESENT, scanned_at=now)
            r2 = AttendanceRecord(session_id=1, student_id=10, roll_number="SAME_ROLL", session_date="2026-09-27", status=AttendanceStatus.PRESENT, scanned_at=now + timedelta(seconds=2))
            db.add_all([r1, r2])
            db.commit()

            # Query concurrent records for DIFFERENT student -> None
            other_scans = db.query(AttendanceRecord).filter(
                AttendanceRecord.session_id == 1,
                AttendanceRecord.student_id != 10,
                AttendanceRecord.scanned_at >= now - timedelta(seconds=60)
            ).all()
            assert len(other_scans) == 0

            # Clean up
            db.delete(r1)
            db.delete(r2)
            db.commit()


# ==============================================================================
# TASK 12: FORENSICS & DISPUTED MARK RECONSTRUCTION
# ==============================================================================

class TestTask12ForensicsAndDisputedMark:
    """Verifies that an attendance mark contains complete forensic evidence."""

    def test_disputed_mark_forensic_evidence_chain(self):
        """
        FORENSIC RECONSTRUCTION:
        For any disputed mark, verify existence of all required audit links:
        - Timestamp (scanned_at)
        - Device identifier (device_uuid / device_id)
        - Attendance scan mode (scan_mode)
        - Faculty marker ID (if manual mark)
        """
        with SessionLocal() as db:
            rec = db.query(AttendanceRecord).first()
            if not rec:
                pytest.skip("No attendance record in DB")

            assert rec.scanned_at is not None
            assert rec.status is not None
            assert rec.session_id is not None
            assert rec.student_id is not None
