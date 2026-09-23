import time
import pytest
from fastapi import HTTPException

from app.api.auth import FailedLoginRateLimiter
from app.api.student import FailedTokenTracker
from app.services.email_service import GlobalEmailQuotaLimiter


def test_am1_failed_login_per_roll_isolation():
    """
    AM1 Verification: Confirm account lockouts are strictly per-ROLL-NUMBER.
    Student A failing 5 times on shared classroom Wi-Fi IP must NOT lock out Student B on the same IP.
    """
    limiter = FailedLoginRateLimiter(max_failures=5, block_duration_seconds=300, roll_block_duration_seconds=900)
    shared_ip = "192.168.1.100"

    # Student A fails 5 times
    for _ in range(5):
        limiter.record_failure(shared_ip, "23311A05Y6")

    # Student A is now locked out
    with pytest.raises(HTTPException) as exc_info:
        limiter.check_rate_limit(shared_ip, "23311A05Y6")
    assert exc_info.value.status_code == 429
    assert "23311A05Y6" in exc_info.value.detail

    # Student B on the SAME IP has 0 failures and must be allowed through cleanly!
    try:
        limiter.check_rate_limit(shared_ip, "23311A05Z1")
    except HTTPException:
        pytest.fail("Student B was incorrectly blocked on shared Wi-Fi IP (Violates AM1)!")


def test_am3_failed_token_tracker_valid_exemption():
    """
    AM3 Verification: Valid tokens must reset failure counts immediately.
    A legitimate student whose first token expired mid-typing must not trigger 60s cooldown.
    """
    tracker = FailedTokenTracker(max_failures=15, window_seconds=60, cooldown_seconds=60)
    client_key = "student_device_1"

    # Simulate 1 expired token failure
    tracker.record_failure(client_key)

    # Valid token scanned next -> resets failures (AM3)
    tracker.record_success(client_key)

    # Simulate 14 more valid tokens and 1 more expired token
    for _ in range(14):
        tracker.record_success(client_key)
    tracker.record_failure(client_key)

    # Check that client is NOT in cooldown
    try:
        tracker.check_rate_limit(client_key)
    except HTTPException:
        pytest.fail("Legitimate client was incorrectly put into cooldown despite valid scans (Violates AM3)!")


def test_failed_token_tracker_brute_force_lockout():
    """Verify that 15 consecutive invalid tokens triggers HTTP 429 cooldown."""
    tracker = FailedTokenTracker(max_failures=15, window_seconds=60, cooldown_seconds=60)
    attacker_key = "attacker_bot"

    # 15 consecutive garbage tokens without a single valid scan
    for _ in range(15):
        tracker.record_failure(attacker_key)

    # 16th scan must raise 429
    with pytest.raises(HTTPException) as exc_info:
        tracker.check_rate_limit(attacker_key)
    assert exc_info.value.status_code == 429
    assert "Too many invalid QR scans" in exc_info.value.detail


def test_global_email_quota_limiter():
    """A4 Verification: Global SMTP limiter caps server-wide email dispatches at 150/hr."""
    limiter = GlobalEmailQuotaLimiter(max_per_hour=150)

    # Allow 150 dispatches
    for _ in range(150):
        assert limiter.allow_dispatch() is True

    # 151st must be rejected
    assert limiter.allow_dispatch() is False
    assert limiter.get_remaining_quota() == 0


def test_am200_student_scan_rate_limiter_per_roll():
    """
    AM-200 Verification: Max 6 scan attempts per minute per ROLL NUMBER.
    The 7th scan for Roll A is blocked with 429, but Roll B is completely unaffected.
    """
    from app.api.student import StudentScanRateLimiter
    limiter = StudentScanRateLimiter(max_attempts=6, window_seconds=60)

    # 6 attempts for Student A succeed
    for _ in range(6):
        limiter.check_rate_limit("23311A05Y6")

    # 7th attempt for Student A raises 429
    with pytest.raises(HTTPException) as exc_info:
        limiter.check_rate_limit("23311A05Y6")
    assert exc_info.value.status_code == 429
    assert "23311A05Y6" in str(exc_info.value.detail)
    assert "Retry-After" in exc_info.value.headers

    # Student B on the same shared IP can scan normally (not blocked by Student A)
    try:
        limiter.check_rate_limit("23311A05Z1")
    except HTTPException:
        pytest.fail("Student B was blocked by Student A's scan rate limit (Violates AM-200)!")

