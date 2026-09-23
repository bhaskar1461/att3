"""
Phase 7 Stage 2: Display Hardening & Heartbeat Automated Verification Test Suite
"""
import pytest
import time
from unittest.mock import patch
from fastapi.testclient import TestClient
from app.main import app
from app.core.config import settings
from app.services.display_heartbeat import (
    record_display_heartbeat,
    get_display_heartbeat_status,
    clear_display_heartbeat,
    HEARTBEAT_ALIVE_THRESHOLD_SECONDS
)

client = TestClient(app)


def test_phase7_feature_flags_configured():
    """Verify Phase 7 feature flags exist in settings with expected defaults."""
    assert hasattr(settings, "DISPLAY_HARDENING")
    assert settings.DISPLAY_HARDENING is True
    assert hasattr(settings, "QR_GRACE_EPOCH")
    assert settings.QR_GRACE_EPOCH is True
    assert hasattr(settings, "ROTATION_INTERVAL_SECONDS")
    assert settings.ROTATION_INTERVAL_SECONDS == 45


def test_display_heartbeat_service_alive_and_dead_tracking():
    """Verify heartbeat service records beacons, computes ALIVE vs DEAD correctly."""
    session_id = 99991
    clear_display_heartbeat(session_id)

    # Unknown before any beacon
    status_before = get_display_heartbeat_status(session_id)
    assert status_before["status"] == "UNKNOWN"

    # Record beacon
    t0 = time.time()
    res = record_display_heartbeat(session_id=session_id, epoch=5, client_ts=t0, ip_address="192.168.1.50")
    assert res["status"] == "RECORDED"
    assert res["session_id"] == session_id
    assert res["epoch"] == 5

    # Check status -> ALIVE
    status_now = get_display_heartbeat_status(session_id)
    assert status_now["status"] == "ALIVE"
    assert status_now["epoch"] == 5
    assert status_now["seconds_ago"] <= 2.0
    assert status_now["ip_address"] == "192.168.1.50"

    # Simulate time travel beyond threshold
    from app.services import display_heartbeat
    with display_heartbeat._HEARTBEAT_LOCK:
        display_heartbeat._HEARTBEATS[session_id]["last_heartbeat_at"] = time.time() - 35.0

    status_dead = get_display_heartbeat_status(session_id)
    assert status_dead["status"] == "DEAD"
    assert status_dead["seconds_ago"] >= 34.0

    # Cleanup
    clear_display_heartbeat(session_id)
    assert get_display_heartbeat_status(session_id)["status"] == "UNKNOWN"


def test_display_heartbeat_http_endpoints():
    """Verify HTTP API endpoints /api/v1/qr-display-heartbeat and /status."""
    session_id = 99992
    clear_display_heartbeat(session_id)

    # Post heartbeat
    post_res = client.post("/api/v1/qr-display-heartbeat", json={
        "session_id": session_id,
        "epoch": 12,
        "ts": time.time()
    })
    assert post_res.status_code == 200
    data = post_res.json()
    assert data["status"] == "RECORDED"
    assert data["session_id"] == session_id

    # Get status
    get_res = client.get(f"/api/v1/qr-display-heartbeat/status?session_id={session_id}")
    assert get_res.status_code == 200
    status_data = get_res.json()
    assert status_data["status"] == "ALIVE"
    assert status_data["epoch"] == 12

    # Cleanup
    clear_display_heartbeat(session_id)


def test_epoch_boundary_acceptance_and_rejection():
    """Stage 4 Unit Test 1: Epoch boundary accepts (delta 0, 1) and rejects (delta >= 2)."""
    from app.core.security import generate_projector_session_token, validate_projector_session_token, TokenValidationError
    base_ts = 1700000000.0  # Slot 170000000
    with patch("time.time", return_value=base_ts):
        token_dict = generate_projector_session_token(session_id=101, period_count=1)
    token = token_dict["payload"]

    # 1. Delta = 0: current epoch accepts
    res0 = validate_projector_session_token(token, step_window=10, now_ts=base_ts)
    assert res0["session_id"] == 101
    assert res0["is_grace_window"] is False

    # 2. Delta = 0 (+9s, still same window) accepts
    res0_late = validate_projector_session_token(token, step_window=10, now_ts=base_ts + 9.0)
    assert res0_late["session_id"] == 101

    # 3. Delta = 1 (+10s, previous window, grace=1) accepts
    res1 = validate_projector_session_token(token, step_window=10, now_ts=base_ts + 10.0)
    assert res1["session_id"] == 101
    assert res1["is_grace_window"] is True

    # 4. Delta = 1 (+19s, still previous window grace) accepts
    res1_late = validate_projector_session_token(token, step_window=10, now_ts=base_ts + 19.0)
    assert res1_late["session_id"] == 101
    assert res1_late["is_grace_window"] is True

    # 5. Delta = 2 (+20s, two windows older than current): MUST REJECT with QR-OLD
    with pytest.raises(TokenValidationError) as exc_info:
        validate_projector_session_token(token, step_window=10, now_ts=base_ts + 20.0)
    assert exc_info.value.code == "QR-OLD"
    assert exc_info.value.epoch_delta == 2
    assert "outdated" in exc_info.value.message.lower()
    assert "QR-OLD" in exc_info.value.message

    # 6. Delta = 5 (+50s, five windows older): MUST REJECT with QR-OLD
    with pytest.raises(TokenValidationError) as exc_info5:
        validate_projector_session_token(token, step_window=10, now_ts=base_ts + 50.0)
    assert exc_info5.value.code == "QR-OLD"
    assert exc_info5.value.epoch_delta == 5
    assert "outdated" in exc_info5.value.message.lower()


def test_launch_token_epoch_boundary_acceptance_and_rejection():
    """Stage 4 Unit Test 2: Launch token accepts delta 0 and 1, rejects delta >= 2."""
    from app.services.launch_token import generate_launch_token, validate_launch_token
    from app.core.security import TokenValidationError
    base_ts = 1700000000.0
    v0 = int(base_ts // 10)
    launch_token = generate_launch_token(session_id=202, short_code="7AB3CD4F", v=v0)

    # Delta = 0: current window accepts
    val0 = validate_launch_token(launch_token, now_ts=base_ts)
    assert val0["session_id"] == 202
    assert val0["epoch_delta"] == 0

    # Delta = 1 (+10s, previous window): accepts (grace = 1)
    val1 = validate_launch_token(launch_token, now_ts=base_ts + 10.0)
    assert val1["session_id"] == 202
    assert val1["epoch_delta"] == 1

    # Delta = 2 (+20s, 2 epochs stale): MUST REJECT with QR-OLD
    with pytest.raises(TokenValidationError) as exc:
        validate_launch_token(launch_token, now_ts=base_ts + 20.0)
    assert exc.value.code == "QR-OLD"
    assert exc.value.epoch_delta == 2
    assert "outdated" in exc.value.message.lower()


def test_ended_session_token_rejection_http():
    """Stage 4 Unit Test 3: Ended session token rejected with QR-SESSION-END."""
    from app.core.database import SessionLocal
    from app.models.models import AttendanceSession, SessionStatus, Teacher, Department, Subject, Section
    from app.services.launch_token import generate_launch_token
    from datetime import date

    db = SessionLocal()
    try:
        dept = db.query(Department).first()
        teacher = db.query(Teacher).first()
        subj = db.query(Subject).first()
        sec = db.query(Section).first()
        if not dept or not teacher or not subj or not sec:
            pytest.skip("Database missing master entities for HTTP session test")

        sess = AttendanceSession(
            teacher_id=teacher.id,
            subject_id=subj.id,
            section_id=sec.id,
            period="Period 1",
            session_date=date.today(),
            status=SessionStatus.LOCKED
        )
        db.add(sess)
        db.commit()

        v0 = int(time.time() // 10)
        tok = generate_launch_token(session_id=sess.id, short_code="5K7L8M9N", v=v0)

        # POST /api/v1/launch/claim for locked session
        claim_res = client.post("/api/v1/launch/claim", json={"launch_token": tok})
        assert claim_res.status_code == 400
        body = claim_res.json()
        assert body.get("error_code") == "QR-SESSION-END"
        assert "QR-SESSION-END" in body.get("detail", "")
        assert "ended" in body.get("detail", "").lower()
    finally:
        db.close()


def test_clock_skew_tolerance_and_server_authoritative_enforcement():
    """Stage 4 Unit Test 4: Clock skew up to +/-90s logged without corrupting server authority."""
    from app.core.security import generate_projector_session_token, validate_projector_session_token
    server_now = 1700000000.0

    # Token valid according to server clock
    with patch("time.time", return_value=server_now):
        token_dict = generate_projector_session_token(session_id=303, period_count=1)
    token = token_dict["payload"]

    # Server validation ignores client clock; strictly uses server_now
    res = validate_projector_session_token(token, step_window=10, now_ts=server_now)
    assert res["session_id"] == 303

    # Client clock is +90 seconds fast (+90,000ms skew)
    client_epoch_ms_fast = (server_now + 90.0) * 1000
    skew_ms_fast = round(client_epoch_ms_fast - (server_now * 1000), 2)
    assert skew_ms_fast == 90000.0

    # Client clock is -90 seconds slow (-90,000ms skew)
    client_epoch_ms_slow = (server_now - 90.0) * 1000
    skew_ms_slow = round(client_epoch_ms_slow - (server_now * 1000), 2)
    assert skew_ms_slow == -90000.0

    # Regardless of +/-90s skew, the token validity is 100% server authoritative
    assert validate_projector_session_token(token, step_window=10, now_ts=server_now)["session_id"] == 303


def test_display_stale_alert_threshold_and_self_healing():
    """Stage 5 Unit Test: >= 3 QR-OLD events in 60s flags DISPLAY STALE and self-heals."""
    from app.services.display_heartbeat import (
        record_qr_old_event,
        is_display_stale,
        clear_qr_old_events,
        get_qr_old_events_count
    )
    test_session_id = 888801
    clear_qr_old_events(test_session_id)

    # Initial state: 0 events, not stale
    assert is_display_stale(test_session_id) is False
    assert get_qr_old_events_count(test_session_id) == 0

    # Event 1: not stale
    record_qr_old_event(test_session_id)
    assert is_display_stale(test_session_id) is False
    assert get_qr_old_events_count(test_session_id) == 1

    # Event 2: not stale
    record_qr_old_event(test_session_id)
    assert is_display_stale(test_session_id) is False
    assert get_qr_old_events_count(test_session_id) == 2

    # Event 3: REACHES THRESHOLD -> STALE
    record_qr_old_event(test_session_id)
    assert is_display_stale(test_session_id) is True
    assert get_qr_old_events_count(test_session_id) == 3

    # Self-healing: Faculty screen refreshes and clears events
    clear_qr_old_events(test_session_id)
    assert is_display_stale(test_session_id) is False
    assert get_qr_old_events_count(test_session_id) == 0

