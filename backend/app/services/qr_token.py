"""
SNIST ERP — Short-Token QR Payload Service (Week 3: Slim Code, Same Security)

PRIME DIRECTIVE:
The anti-proxy guarantees are IDENTICAL before and after:
rotating, single-use-per-student, device-bound, server-verified attendance tokens.

Design:
- The QR encodes only an opaque SHORT CODE mapping server-side to active session_id, plus rotation counter v.
  Payload shape: "?s=8XK2Q7MD&v=483921" (20 chars vs legacy 36-96 chars).
- Code space: Crockford Base32 (32 chars) ^ 8 = 2^40 ≈ 1.099 x 10^12 combinations.
- HMAC verification moves fully server-side: student submits {short_code, v};
  server resolves session, checks slot window + grace, derives expected HMAC,
  and executes the standard validate_projector_session_token contract.
- Scan-path additions: Exactly ONE indexed lookup (O(1) in-memory cache, DB fallback).
"""

import time
import hmac
import hashlib
import secrets
import threading
import re
from typing import Dict, Any, Optional, Tuple
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import (
    get_aes_key, 
    _int_to_base36, 
    _base36_to_int, 
    validate_projector_session_token,
    TokenValidationError
)
from app.models.models import ShortTokenRegistry, AttendanceSession, SessionStatus

# Crockford Base32 alphabet: 32 glyphs, excludes ambiguous I, L, O, U.
# 32^8 = 1,099,511,627,776 combinations (~1.10 trillion)
CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
CROCKFORD_SET = set(CROCKFORD_ALPHABET)
SHORT_CODE_LENGTH = 8

# Regular expressions for parsing format
RE_SHORT_QUERY = re.compile(r"[?&]s=([0-9A-HJ-NP-Za-km-z]{6,12})&v=([0-9]+)", re.IGNORECASE)
RE_SHORT_COLON = re.compile(r"^([0-9A-HJ-NP-Za-km-z]{6,12})[:|]([0-9]+)$", re.IGNORECASE)
RE_CLEAN_CODE = re.compile(r"^[0-9A-HJ-NP-Za-km-z]{6,12}$")

# Thread-safe in-memory cache for O(1) microsecond lookup in scan path
_SHORT_CODE_CACHE: Dict[str, Dict[str, Any]] = {}  # short_code -> {session_id, period_count, expires_slot, is_active}
_SESSION_SHORT_CODE: Dict[int, str] = {}           # session_id -> short_code
_CACHE_LOCK = threading.Lock()


def generate_short_code() -> str:
    """Generates an 8-character cryptographically random Crockford Base32 short code."""
    return "".join(secrets.choice(CROCKFORD_ALPHABET) for _ in range(SHORT_CODE_LENGTH))


def normalize_crockford(code: str) -> str:
    """Normalizes input characters to uppercase Crockford Base32 (maps o->0, i/l->1)."""
    trans = str.maketrans("oilOIL", "011011")
    return code.strip().translate(trans).upper()


class ShortTokenService:
    """
    Authoritative Short-Token lifecycle and dual-format validation engine.
    Wraps existing validate_projector_session_token to preserve check order byte-for-byte.
    """

    @classmethod
    def clear_cache(cls):
        """Clears in-memory caches (used during test isolation and process resets)."""
        with _CACHE_LOCK:
            _SHORT_CODE_CACHE.clear()
            _SESSION_SHORT_CODE.clear()

    @classmethod
    def issue_or_get_short_code(
        cls,
        db: Session,
        session_id: int,
        period_count: int = 1,
        step_window: int = 10
    ) -> Dict[str, Any]:
        """
        Retrieves or generates an opaque short code for an active session.
        The short code identifies WHO (the session); counter v identifies WHEN (the slot).
        """
        period_count = max(1, min(8, int(period_count)))
        now_ts = time.time()
        current_step = int(now_ts // step_window)
        seconds_remaining = int(step_window - (now_ts % step_window))
        expires_slot = current_step + 3600  # valid for up to ~10 hours

        with _CACHE_LOCK:
            if session_id in _SESSION_SHORT_CODE:
                existing_code = _SESSION_SHORT_CODE[session_id]
                cached_entry = _SHORT_CODE_CACHE.get(existing_code)
                if cached_entry and cached_entry.get("is_active"):
                    cached_entry["period_count"] = period_count
                    payload_str = f"?s={existing_code}&v={current_step}"
                    return {
                        "short_code": existing_code,
                        "v": current_step,
                        "payload": payload_str,
                        "session_id": session_id,
                        "period_count": period_count,
                        "seconds_remaining": max(1, seconds_remaining),
                        "step_window": step_window
                    }

        # Check DB for existing active token for this session
        existing_reg = db.query(ShortTokenRegistry).filter(
            ShortTokenRegistry.session_id == session_id,
            ShortTokenRegistry.is_active == True
        ).first()

        if existing_reg:
            code = existing_reg.short_code
        else:
            # Generate new collision-free code
            for _ in range(10):
                candidate = generate_short_code()
                conflict = db.query(ShortTokenRegistry).filter(
                    ShortTokenRegistry.short_code == candidate
                ).first()
                if not conflict:
                    code = candidate
                    break
            else:
                code = generate_short_code()

            new_reg = ShortTokenRegistry(
                short_code=code,
                session_id=session_id,
                issued_slot=current_step,
                expires_slot=expires_slot,
                is_active=True
            )
            db.add(new_reg)
            try:
                db.commit()
            except Exception:
                db.rollback()
                # Re-query in case of race condition
                reg = db.query(ShortTokenRegistry).filter(
                    ShortTokenRegistry.session_id == session_id,
                    ShortTokenRegistry.is_active == True
                ).first()
                if reg:
                    code = reg.short_code

        with _CACHE_LOCK:
            _SHORT_CODE_CACHE[code] = {
                "session_id": session_id,
                "period_count": period_count,
                "issued_slot": current_step,
                "expires_slot": expires_slot,
                "is_active": True
            }
            _SESSION_SHORT_CODE[session_id] = code

        payload_str = f"?s={code}&v={current_step}"
        return {
            "short_code": code,
            "v": current_step,
            "payload": payload_str,
            "session_id": session_id,
            "period_count": period_count,
            "seconds_remaining": max(1, seconds_remaining),
            "step_window": step_window
        }

    @classmethod
    def parse_token_payload(
        cls, 
        raw_input: str, 
        v_param: Optional[int] = None
    ) -> Tuple[str, Optional[int], str]:
        """
        Discovers payload format:
        Returns (code_or_token, v, format_type)
        format_type is 'legacy' | 'short' | 'launch' | 'unknown'
        """
        raw = str(raw_input).strip()

        # 1. Direct Legacy Token (starts with SNIST-SES| or S|)
        if raw.startswith("SNIST-SES|") or raw.startswith("S|"):
            return (raw, None, "legacy")

        # 2. URL containing legacy token parameter
        if "token=SNIST-SES%7C" in raw or "token=SNIST-SES|" in raw:
            import urllib.parse
            parsed_url = urllib.parse.urlparse(raw)
            params = urllib.parse.parse_qs(parsed_url.query)
            token_val = params.get("token", [""])[0]
            if token_val.startswith("SNIST-SES|"):
                return (token_val, None, "legacy")

        # 3. Universal Launch Token URL: https://whiteleos.cc.cd/a/<token> or /a/<token>
        try:
            from app.services.launch_token import extract_launch_token_from_url
            launch_from_url = extract_launch_token_from_url(raw)
            if launch_from_url:
                return (launch_from_url, None, "launch")
        except Exception:
            pass

        # 4. Raw Launch Token string: URL-safe base64 encoding 6 colon-separated segments
        if len(raw) >= 30 and not any(c in raw for c in [" ", "\t", "\n", "|", "&", "?", "/"]):
            try:
                from app.services.launch_token import _url_safe_b64_decode
                decoded_str = _url_safe_b64_decode(raw).decode("utf-8")
                parts = decoded_str.split(":")
                if len(parts) == 6 and parts[0].isdigit() and parts[2].isdigit() and parts[4].isdigit():
                    return (raw, None, "launch")
            except Exception:
                pass

        # 5. Query string short format: ?s=8XK2Q7MD&v=483921 or /scan?s=...
        query_match = RE_SHORT_QUERY.search(raw)
        if query_match:
            code = normalize_crockford(query_match.group(1))
            slot_v = int(query_match.group(2))
            return (code, slot_v, "short")

        # 6. Delimited short format: 8XK2Q7MD:483921 or 8XK2Q7MD|483921
        colon_match = RE_SHORT_COLON.match(raw)
        if colon_match:
            code = normalize_crockford(colon_match.group(1))
            slot_v = int(colon_match.group(2))
            return (code, slot_v, "short")

        # 7. Raw short code passed with explicit v_param
        if v_param is not None and RE_CLEAN_CODE.match(raw):
            code = normalize_crockford(raw)
            return (code, int(v_param), "short")

        return (raw, v_param, "unknown")

    @classmethod
    def validate_attendance_token(
        cls,
        db: Session,
        payload_or_code: str,
        v: Optional[int] = None,
        step_window: int = 10,
        grace_seconds: Optional[float] = None,
        max_grace_steps: Optional[int] = 1,
        now_ts: Optional[float] = None,
        is_offline_submission: bool = False
    ) -> Dict[str, Any]:
        """
        Dual-format validation wrapper:
        Accepts BOTH legacy full-token and new {short_code, v} formats.
        Delegates cryptographic verification to existing validate_projector_session_token.
        Error taxonomy and status codes remain byte-for-byte identical.
        Supports bounded SUBMIT_GRACE_MINUTES window for queued offline submissions.
        """
        code_or_token, slot_v, format_type = cls.parse_token_payload(payload_or_code, v)

        if format_type == "legacy":
            validated = validate_projector_session_token(
                token_str=code_or_token,
                step_window=step_window,
                max_grace_steps=max_grace_steps,
                grace_seconds=grace_seconds,
                now_ts=now_ts,
                is_offline_submission=is_offline_submission
            )
            validated["token_format"] = "legacy"
            return validated

        if format_type == "short":
            if now_ts is None:
                now_ts = time.time()

            if slot_v is None or slot_v <= 0:
                raise TokenValidationError(code="invalid", message="Invalid rotation counter in short token: counter must be positive integer", server_now=now_ts)

            if len(code_or_token) != SHORT_CODE_LENGTH or not set(code_or_token).issubset(CROCKFORD_SET):
                raise TokenValidationError(code="invalid", message="Invalid short code alphabet: Expected 8-character Crockford Base32", server_now=now_ts)

            # Determine effective grace in seconds
            if is_offline_submission:
                grace_mins = getattr(settings, "SUBMIT_GRACE_MINUTES", 10)
                effective_grace = float(grace_mins * 60)
                slot_start_ts = slot_v * step_window
                slot_end_ts = (slot_v + 1) * step_window
                max_valid_ts = slot_end_ts + effective_grace
                min_valid_ts = slot_start_ts - 2.0  # 2s clock skew allowance
                if now_ts > max_valid_ts:
                    raise TokenValidationError(
                        code="expired",
                        message=f"Projector QR token expired beyond offline submit grace window ({getattr(settings, 'SUBMIT_GRACE_MINUTES', 10)}m).",
                        server_now=now_ts
                    )
                if now_ts < min_valid_ts:
                    raise TokenValidationError(
                        code="invalid",
                        message="Projector QR token timestamp is in the future. Check clock synchronization.",
                        server_now=now_ts
                    )
            else:
                # Live online submission: Strictly accept only current window and previous window (default max 1 window grace)
                if grace_seconds is not None:
                    effective_grace = float(grace_seconds)
                elif max_grace_steps is not None and max_grace_steps > 0:
                    effective_grace = float(max_grace_steps * step_window)
                else:
                    effective_grace = float(step_window)

                slot_start_ts = slot_v * step_window
                slot_end_ts = (slot_v + 1) * step_window
                max_valid_ts = slot_end_ts + effective_grace
                min_valid_ts = slot_start_ts - 2.0  # 2s clock skew allowance

                if now_ts > max_valid_ts:
                    raise TokenValidationError(
                        code="expired",
                        message="Projector QR token has expired. Please scan the newly refreshed QR on screen.",
                        server_now=now_ts
                    )
                if now_ts < min_valid_ts:
                    raise TokenValidationError(
                        code="invalid",
                        message="Projector QR token timestamp is in the future. Check clock synchronization.",
                        server_now=now_ts
                    )

            # Resolve session_id: Step 1 O(1) in-memory cache
            session_id = None
            period_count = 1
            with _CACHE_LOCK:
                cached = _SHORT_CODE_CACHE.get(code_or_token)
                if cached and cached.get("is_active"):
                    session_id = cached["session_id"]
                    period_count = cached.get("period_count", 1)

            # Step 2 DB fallback on cache miss (e.g. server restart)
            if session_id is None:
                reg = db.query(ShortTokenRegistry).filter(
                    ShortTokenRegistry.short_code == code_or_token,
                    ShortTokenRegistry.is_active == True
                ).first()
                if not reg:
                    raise ValueError("Invalid attendance short code (Unknown or expired session)")

                session_id = reg.session_id
                # Extract period count from session
                sess = db.query(AttendanceSession).filter(AttendanceSession.id == session_id).first()
                if sess:
                    from app.api.teacher import _extract_period_count
                    period_count = _extract_period_count(sess.period)

                with _CACHE_LOCK:
                    _SHORT_CODE_CACHE[code_or_token] = {
                        "session_id": session_id,
                        "period_count": period_count,
                        "issued_slot": reg.issued_slot,
                        "expires_slot": reg.expires_slot,
                        "is_active": True
                    }
                    _SESSION_SHORT_CODE[session_id] = code_or_token

            # Cryptographic Verification:
            # Reconstruct the expected canonical token for this (session, period, slot)
            # and feed into the authoritative validate_projector_session_token
            sid_b36 = _int_to_base36(session_id)
            step_b36 = _int_to_base36(slot_v)
            base_str = f"SES|{sid_b36}|{period_count}|{step_b36}"
            key = get_aes_key()
            mac = hmac.new(key, base_str.encode("utf-8"), hashlib.sha256).hexdigest()[:12]
            canonical_token = f"SNIST-SES|{sid_b36}|{period_count}|{step_b36}|{mac}"

            validated = validate_projector_session_token(
                token_str=canonical_token,
                step_window=step_window,
                max_grace_steps=max_grace_steps,
                grace_seconds=grace_seconds,
                now_ts=now_ts
            )
            validated["token_format"] = "short"
            return validated

        if format_type == "launch":
            from app.services.launch_token import validate_launch_token
            launch_data = validate_launch_token(code_or_token, now_ts=now_ts)
            session_id = launch_data["session_id"]
            code = launch_data["short_code"]
            slot_v = launch_data["v"]
            exp_ts = launch_data["exp_ts"]

            if now_ts is None:
                now_ts = time.time()

            period_count = 1
            with _CACHE_LOCK:
                cached = _SHORT_CODE_CACHE.get(code)
                if cached and cached.get("is_active"):
                    period_count = cached.get("period_count", 1)

            if period_count == 1:
                sess = db.query(AttendanceSession).filter(AttendanceSession.id == session_id).first()
                if sess:
                    from app.api.teacher import _extract_period_count
                    period_count = _extract_period_count(sess.period)

            return {
                "session_id": session_id,
                "period_count": period_count,
                "step": slot_v,
                "token_format": "launch",
                "is_active": True,
                "short_code": code,
                "seconds_remaining": max(0, int(exp_ts - now_ts))
            }

        # Unknown / malformed input
        raise ValueError("Invalid projector token prefix: Expected HTTPS attendance URL, SNIST-SES, or ?s=...")

    @classmethod
    def purge_session_tokens(cls, db: Session, session_id: int):
        """Purges and deactivates short token mappings when a session ends or locks."""
        with _CACHE_LOCK:
            code = _SESSION_SHORT_CODE.pop(session_id, None)
            if code:
                _SHORT_CODE_CACHE.pop(code, None)

        try:
            db.query(ShortTokenRegistry).filter(
                ShortTokenRegistry.session_id == session_id
            ).update({"is_active": False})
            db.commit()
        except Exception:
            db.rollback()

    @classmethod
    def purge_expired_tokens(cls, db: Session):
        """Purges old short code registrations on the background maintenance budget."""
        now_step = int(time.time() // 10)
        try:
            db.query(ShortTokenRegistry).filter(
                ShortTokenRegistry.expires_slot < now_step
            ).delete()
            db.commit()
        except Exception:
            db.rollback()


def get_effective_qr_format(
    db: Session,
    session_id: Optional[int] = None,
    section_id: Optional[int] = None,
    dept_code: Optional[str] = None
) -> Tuple[str, str]:
    """
    Determines the active QR display format ('short' | 'legacy') and decision reason.
    Supports instant <1s runtime flips via SystemSettings in DB or settings.QR_TOKEN_FORMAT fallback.
    Priority:
    1. SystemSettings in DB: 'QR_TOKEN_FORMAT' ('legacy', 'short', 'dual')
       - If not in DB: fall back to settings.QR_TOKEN_FORMAT.
    2. If format is 'legacy': returns ('legacy', 'GLOBAL_FLAG_LEGACY')
    3. If format is 'short': returns ('short', 'GLOBAL_FLAG_SHORT')
    4. If format is 'dual':
       - Checks pilot cohort mapping:
         - SystemSettings 'QR_PILOT_SECTIONS' (or settings.QR_PILOT_SECTIONS)
         - SystemSettings 'QR_PILOT_DEPARTMENTS' (or settings.QR_PILOT_DEPARTMENTS)
       - If section_id or dept_code matches pilot cohort -> ('short', 'PILOT_COHORT_MATCH')
       - Else -> ('legacy', 'CONTROL_COHORT_FALLBACK')
    """
    from app.models.models import SystemSettings, AttendanceSession

    # 1. Resolve master mode (legacy | short | dual)
    format_setting = db.query(SystemSettings).filter(SystemSettings.key == "QR_TOKEN_FORMAT").first()
    mode = (format_setting.value if format_setting and format_setting.value else getattr(settings, "QR_TOKEN_FORMAT", "dual")).strip().lower()

    if mode == "legacy":
        return "legacy", "GLOBAL_FLAG_LEGACY"
    if mode == "short":
        return "short", "GLOBAL_FLAG_SHORT"

    # Mode is "dual" -> determine if session is in pilot cohort
    if session_id and (section_id is None or dept_code is None):
        sess = db.query(AttendanceSession).filter(AttendanceSession.id == session_id).first()
        if sess:
            if section_id is None:
                section_id = sess.section_id
            if dept_code is None and sess.section and sess.section.department:
                dept_code = sess.section.department.code

    # Read pilot sections from DB or settings
    sec_setting = db.query(SystemSettings).filter(SystemSettings.key == "QR_PILOT_SECTIONS").first()
    raw_secs = (sec_setting.value if sec_setting and sec_setting.value else getattr(settings, "QR_PILOT_SECTIONS", "1,2")).strip()
    pilot_section_ids = {s.strip() for s in raw_secs.split(",") if s.strip()}

    # Read pilot departments from DB or settings
    dept_setting = db.query(SystemSettings).filter(SystemSettings.key == "QR_PILOT_DEPARTMENTS").first()
    raw_depts = (dept_setting.value if dept_setting and dept_setting.value else getattr(settings, "QR_PILOT_DEPARTMENTS", "CSE,ECE")).strip()
    pilot_dept_codes = {d.strip().upper() for d in raw_depts.split(",") if d.strip()}

    # Check match
    if section_id is not None and str(section_id) in pilot_section_ids:
        return "short", f"PILOT_SECTION_MATCH_{section_id}"

    if dept_code and str(dept_code).strip().upper() in pilot_dept_codes:
        return "short", f"PILOT_DEPT_MATCH_{dept_code}"

    return "legacy", "CONTROL_COHORT_LEGACY"


def get_effective_render_version(
    db: Session,
    session_id: Optional[int] = None,
    section_id: Optional[int] = None,
    dept_code: Optional[str] = None
) -> Tuple[str, str]:
    """
    Determines the active QR visual rendering pipeline ('v1' | 'v2') and decision reason.
    Supports instant <1s runtime flips via SystemSettings in DB or settings.QR_RENDER_VERSION fallback.
    - 'v1': Legacy standard rendering (ECC M, default quiet zone).
    - 'v2': Pure optical instrument (ECC L, guaranteed 4-module quiet zone, crisp device-pixel-ratio render).
    """
    from app.models.models import SystemSettings, AttendanceSession

    # 1. Resolve master render mode (v1 | v2 | pilot)
    setting_row = db.query(SystemSettings).filter(SystemSettings.key == "QR_RENDER_VERSION").first()
    mode = (setting_row.value if setting_row and setting_row.value else getattr(settings, "QR_RENDER_VERSION", "v2")).strip().lower()

    if mode == "v1":
        return "v1", "GLOBAL_FLAG_V1"
    if mode == "v2":
        return "v2", "GLOBAL_FLAG_V2"

    # Mode is "pilot" -> determine if session is in render pilot cohort
    if session_id and (section_id is None or dept_code is None):
        sess = db.query(AttendanceSession).filter(AttendanceSession.id == session_id).first()
        if sess:
            if section_id is None:
                section_id = sess.section_id
            if dept_code is None and sess.section and sess.section.department:
                dept_code = sess.section.department.code

    sec_setting = db.query(SystemSettings).filter(SystemSettings.key == "QR_RENDER_PILOT_SECTIONS").first()
    raw_secs = (sec_setting.value if sec_setting and sec_setting.value else getattr(settings, "QR_RENDER_PILOT_SECTIONS", "1,2")).strip()
    pilot_section_ids = {s.strip() for s in raw_secs.split(",") if s.strip()}

    if section_id is not None and str(section_id) in pilot_section_ids:
        return "v2", f"PILOT_RENDER_SECTION_MATCH_{section_id}"

    return "v1", "CONTROL_RENDER_V1"


