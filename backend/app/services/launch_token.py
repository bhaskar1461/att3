"""
SNIST ERP — Launch Token Service (Phase 12A: Universal Projector Entry)

Generates and validates short-lived, HMAC-SHA256 signed, session-bound
launch tokens for embedding in HTTPS attendance URLs.

The launch token is the bridge between "normal phone camera sees a URL"
and "backend validates the attendance session reference."

SECURITY INVARIANT:
- The token contains ONLY session reference IDs and timing metadata.
- The token NEVER contains: HMAC secret, DB credentials, student PII,
  permanent auth tokens, raw student identity, or private API keys.
- Opening a launch URL does NOT mark attendance. It only starts the flow.
- The backend remains the sole authority on attendance decisions.

Token format (URL-safe base64):
  {session_id}:{short_code}:{v}:{nonce}:{exp_ts}:{hmac_signature}
"""

import time
import hmac
import hashlib
import secrets
import base64
import logging
from typing import Dict, Any, Optional

logger = logging.getLogger("snist_erp.launch_token")


def _get_launch_signing_key() -> bytes:
    """
    Returns the HMAC signing key for launch tokens.
    Reuses the existing QR_SECRET_KEY to avoid key proliferation.
    """
    from app.core.config import settings
    raw_key = getattr(settings, "QR_SECRET_KEY", "")
    if not raw_key:
        raise RuntimeError("QR_SECRET_KEY is not configured — cannot sign launch tokens.")
    # Derive a distinct sub-key for launch tokens to avoid cross-protocol collisions
    return hmac.new(
        raw_key.encode("utf-8"),
        b"SNIST_LAUNCH_TOKEN_V1",
        hashlib.sha256
    ).digest()


def _url_safe_b64_encode(data: bytes) -> str:
    """Encodes bytes to URL-safe base64 without padding."""
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _url_safe_b64_decode(s: str) -> bytes:
    """Decodes URL-safe base64 with auto-padding restoration."""
    padding = 4 - (len(s) % 4)
    if padding != 4:
        s += "=" * padding
    return base64.urlsafe_b64decode(s)


def generate_launch_token(
    session_id: int,
    short_code: str,
    v: int,
    step_window: int = 10,
    grace_seconds: Optional[int] = None
) -> str:
    """
    Generates a short-lived, signed launch token for URL embedding.

    Args:
        session_id: The attendance session ID.
        short_code: The Crockford Base32 short code for the session.
        v: The current rotation step counter.
        step_window: Duration of each rotation step in seconds (default 10).
        grace_seconds: Override expiry grace. Defaults to settings.LAUNCH_TOKEN_GRACE_SECONDS.

    Returns:
        URL-safe base64 encoded token string.
    """
    from app.core.config import settings

    if grace_seconds is None:
        grace_seconds = int(getattr(settings, "LAUNCH_TOKEN_GRACE_SECONDS", 30))

    nonce = secrets.token_hex(4)  # 8 hex chars = 32 bits of entropy
    # Token expires at: end of current step + grace
    exp_ts = int(((v + 1) * step_window) + grace_seconds)

    # Plaintext payload (no secrets — all values are session references)
    payload_str = f"{session_id}:{short_code}:{v}:{nonce}:{exp_ts}"

    # HMAC-SHA256 signature over payload
    key = _get_launch_signing_key()
    sig = hmac.new(key, payload_str.encode("utf-8"), hashlib.sha256).hexdigest()[:16]

    # Compact signed token
    signed_payload = f"{payload_str}:{sig}"
    token = _url_safe_b64_encode(signed_payload.encode("utf-8"))

    logger.debug(
        f"[LaunchToken] Generated: session={session_id}, short={short_code}, "
        f"v={v}, exp={exp_ts}, nonce={nonce}, token_len={len(token)}"
    )
    return token


from app.core.security import TokenValidationError
import threading

# Active claims registry: claim_token -> {session_id, short_code, v, exp_ts, device_fingerprint, consumed}
_ACTIVE_CLAIMS: Dict[str, Dict[str, Any]] = {}
_CLAIM_LOCK = threading.Lock()


def validate_launch_token(
    token_str: str,
    now_ts: Optional[float] = None
) -> Dict[str, Any]:
    """
    Validates a launch token's signature and expiry.
    Accepts ONLY the current window (v == current_step) and previous window (v == current_step - 1).

    Args:
        token_str: The URL-safe base64 encoded token.
        now_ts: Override current timestamp (for testing).

    Returns:
        Dict with keys: session_id, short_code, v, nonce, exp_ts

    Raises:
        TokenValidationError: With code='expired' or code='invalid'.
    """
    if now_ts is None:
        now_ts = time.time()

    if not token_str or len(token_str) < 10:
        raise TokenValidationError(code="invalid", message="Invalid launch token: too short or empty.", server_now=now_ts)

    # Strip any surrounding whitespace or URL fragments
    token_str = token_str.strip().split("#")[0].split("?")[0]

    try:
        decoded = _url_safe_b64_decode(token_str).decode("utf-8")
    except Exception:
        raise TokenValidationError(code="invalid", message="Invalid launch token: malformed base64 encoding.", server_now=now_ts)

    parts = decoded.split(":")
    if len(parts) != 6:
        raise TokenValidationError(code="invalid", message="Invalid launch token: unexpected structure.", server_now=now_ts)

    try:
        session_id = int(parts[0])
        short_code = parts[1]
        v = int(parts[2])
        nonce = parts[3]
        exp_ts = int(parts[4])
        provided_sig = parts[5]
    except (ValueError, IndexError):
        raise TokenValidationError(code="invalid", message="Invalid launch token: corrupt fields.", server_now=now_ts)

    # Verify HMAC signature
    payload_str = f"{session_id}:{short_code}:{v}:{nonce}:{exp_ts}"
    key = _get_launch_signing_key()
    expected_sig = hmac.new(key, payload_str.encode("utf-8"), hashlib.sha256).hexdigest()[:16]

    if not hmac.compare_digest(provided_sig, expected_sig):
        raise TokenValidationError(code="invalid", message="Invalid launch token: signature verification failed (tampered).", server_now=now_ts)

    # Strictly accept only the current window (current_step) and previous window (current_step - 1)
    current_step = int(now_ts // 10)
    if v < current_step - 1:
        raise TokenValidationError(
            code="expired",
            message="Launch token has expired. Please scan the refreshed QR code on the projector.",
            server_now=now_ts
        )
    if v > current_step:
        raise TokenValidationError(
            code="invalid",
            message="Launch token counter is in the future. Check clock synchronization.",
            server_now=now_ts
        )

    return {
        "session_id": session_id,
        "short_code": short_code,
        "v": v,
        "nonce": nonce,
        "exp_ts": exp_ts
    }


def create_claim_ticket(
    session_id: int,
    short_code: str,
    v: int,
    device_fingerprint: Optional[str] = None,
    claim_ttl_seconds: int = 180,
    now_ts: Optional[float] = None
) -> Dict[str, Any]:
    """
    Exchanges a validated launch token for a 3-minute single-use claim ticket.
    The claim ticket survives student login and binds to the student device/browser.
    """
    if now_ts is None:
        now_ts = time.time()

    claim_id = secrets.token_hex(8)
    exp_ts = int(now_ts + claim_ttl_seconds)
    fp = (device_fingerprint or "").strip()[:64]
    payload_str = f"CLM:{claim_id}:{session_id}:{short_code}:{v}:{exp_ts}:{fp}"
    
    key = _get_launch_signing_key()
    sig = hmac.new(key, payload_str.encode("utf-8"), hashlib.sha256).hexdigest()[:16]
    claim_token = _url_safe_b64_encode(f"{payload_str}:{sig}".encode("utf-8"))

    with _CLAIM_LOCK:
        # Prune expired claims
        expired_keys = [k for k, val in _ACTIVE_CLAIMS.items() if now_ts > val.get("exp_ts", 0) + 600]
        for k in expired_keys:
            _ACTIVE_CLAIMS.pop(k, None)

        _ACTIVE_CLAIMS[claim_token] = {
            "session_id": session_id,
            "short_code": short_code,
            "v": v,
            "exp_ts": exp_ts,
            "device_fingerprint": fp,
            "consumed": False,
            "created_at": now_ts
        }

    return {
        "claim_token": claim_token,
        "session_id": session_id,
        "short_code": short_code,
        "v": v,
        "expires_at": exp_ts,
        "expires_in_seconds": claim_ttl_seconds,
        "server_now": now_ts,
        "serverNow": now_ts
    }


def validate_claim(
    claim_token: str,
    now_ts: Optional[float] = None
) -> Dict[str, Any]:
    """
    Validates a claim ticket signature, freshness, and single-use status WITHOUT consuming it.
    """
    if now_ts is None:
        now_ts = time.time()

    if not claim_token:
        raise TokenValidationError(code="invalid", message="Missing claim ticket.", server_now=now_ts)

    # 1. Cryptographic signature check
    try:
        decoded = _url_safe_b64_decode(claim_token).decode("utf-8")
        parts = decoded.split(":")
        if len(parts) != 8 or parts[0] != "CLM":
            raise ValueError("Malformed claim ticket")
        
        _, claim_id, sid_str, short_code, v_str, exp_str, fp, provided_sig = parts
        session_id = int(sid_str)
        v = int(v_str)
        exp_ts = int(exp_str)
        payload_str = f"CLM:{claim_id}:{session_id}:{short_code}:{v}:{exp_ts}:{fp}"
        key = _get_launch_signing_key()
        expected_sig = hmac.new(key, payload_str.encode("utf-8"), hashlib.sha256).hexdigest()[:16]
        if not hmac.compare_digest(provided_sig, expected_sig):
            raise TokenValidationError(code="invalid", message="Claim ticket signature tampered or invalid.", server_now=now_ts)
    except TokenValidationError:
        raise
    except Exception:
        raise TokenValidationError(code="invalid", message="Malformed claim ticket.", server_now=now_ts)

    if now_ts > exp_ts:
        raise TokenValidationError(
            code="expired",
            message="Claim ticket has expired (~3 min limit). Please scan the refreshed QR on the projector.",
            server_now=now_ts
        )

    # 2. Single-use registry check
    with _CLAIM_LOCK:
        claim_data = _ACTIVE_CLAIMS.get(claim_token)
        if claim_data and claim_data.get("consumed"):
            raise TokenValidationError(
                code="invalid",
                message="Claim ticket has already been used to record attendance.",
                server_now=now_ts
            )

    return {
        "session_id": session_id,
        "short_code": short_code,
        "v": v,
        "claim_token": claim_token,
        "exp_ts": exp_ts,
        "device_fingerprint": fp
    }


def consume_claim(
    claim_token: str,
    now_ts: Optional[float] = None
) -> None:
    """
    Atomically marks a claim ticket as consumed upon successful attendance.
    """
    if not claim_token:
        return
    if now_ts is None:
        now_ts = time.time()
    with _CLAIM_LOCK:
        claim_data = _ACTIVE_CLAIMS.get(claim_token)
        if not claim_data:
            _ACTIVE_CLAIMS[claim_token] = {
                "consumed": True,
                "consumed_at": now_ts
            }
        else:
            claim_data["consumed"] = True
            claim_data["consumed_at"] = now_ts


def unconsume_claim(claim_token: str) -> None:
    """
    If attendance processing fails after claim ticket validation (e.g. student needs
    to enroll device, GPS geofence warmup, section check), unconsume the ticket so
    the student can resolve the issue and retry within the ticket's valid window.
    """
    if not claim_token:
        return
    with _CLAIM_LOCK:
        claim_data = _ACTIVE_CLAIMS.get(claim_token)
        if claim_data:
            claim_data["consumed"] = False


def validate_and_consume_claim(
    claim_token: str,
    device_fingerprint: Optional[str] = None,
    now_ts: Optional[float] = None
) -> Dict[str, Any]:
    """
    Validates and atomically consumes a claim ticket (single-use).
    """
    res = validate_claim(claim_token, now_ts=now_ts)
    consume_claim(claim_token, now_ts=now_ts)
    return res


def extract_launch_token_from_url(url: str) -> Optional[str]:
    """
    Extracts a launch token from a URL path like:
      https://attendance.example.com/a/<token>
      /a/<token>

    Returns the token string, or None if the URL doesn't match the pattern.
    """
    if not url:
        return None

    url = url.strip()

    # Handle full URLs and relative paths
    # Look for /a/<token> pattern
    import re
    match = re.search(r"/a/([A-Za-z0-9_-]{10,})", url)
    if match:
        return match.group(1)

    return None
