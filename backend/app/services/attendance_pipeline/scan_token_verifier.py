import time
import logging
import threading
import hashlib
from typing import Dict, Any, Tuple, Optional
from fastapi import HTTPException, status, Request
from sqlalchemy.orm import Session

from app.core.security import TokenValidationError
from app.services.qr_token import ShortTokenService
from app.models.models import SecurityEventType
from app.core.device_security import log_security_audit_event

logger = logging.getLogger("snist_erp.scan_telemetry")

# In-memory Pre-Filter Cache for recent invalid/expired tokens (sub-0.05ms fast rejection)
_INVALID_TOKEN_PREFILTER_CACHE: Dict[str, Tuple[int, dict, float]] = {}
_PREFILTER_LOCK = threading.Lock()
_PREFILTER_TTL = 15.0  # 15 seconds
_PREFILTER_MAX_ENTRIES = 2048


def _compute_token_cache_key(req: Any) -> str:
    """Computes a normalized digest for token pre-filter lookup."""
    raw = (
        getattr(req, "claim_token", None)
        or getattr(req, "session_token", None)
        or getattr(req, "short_code", None)
        or ""
    )
    raw = str(raw).strip()
    v_val = str(getattr(req, "v", "") or "")
    combined = f"{raw}:{v_val}"
    return hashlib.sha256(combined.encode("utf-8")).hexdigest()[:32]


def clear_invalid_token_prefilter_cache() -> None:
    """Clears all cached invalid token pre-filter entries."""
    with _PREFILTER_LOCK:
        _INVALID_TOKEN_PREFILTER_CACHE.clear()


def get_invalid_token_prefilter_stats() -> dict:
    """Returns telemetry stats on the in-memory token pre-filter cache."""
    with _PREFILTER_LOCK:
        return {
            "size": len(_INVALID_TOKEN_PREFILTER_CACHE),
            "max_size": _PREFILTER_MAX_ENTRIES,
            "ttl_seconds": _PREFILTER_TTL
        }


def verify_and_resolve_scan_token(
    req: Any,
    tracker_key: str,
    current_student: Any,
    request: Request,
    db: Session,
    failed_token_tracker: Any,
    now_ts: float
) -> Tuple[Dict[str, Any], bool, float]:
    """
    Step 0c: Dual-Format verification (< 0.05ms memory cache, ZERO DB round-trips for hits).
    Validates either rotating claim token or HMAC short token.
    Fast-rejects replayed/invalid tokens from in-memory prefilter in < 0.02ms.
    Returns:
        (token_data, claim_consumed_here, t_hmac_ms)
    """
    t_hmac_start = time.perf_counter()
    claim_consumed_here = False
    now = now_ts or time.time()
    cache_key = _compute_token_cache_key(req)

    # 1. Fast-Path Pre-Filter: Sub-0.05ms rejection of replayed invalid/expired tokens (Zero DB hits)
    if cache_key:
        with _PREFILTER_LOCK:
            cached = _INVALID_TOKEN_PREFILTER_CACHE.get(cache_key)
            if cached is not None:
                cached_status, cached_detail, cached_at = cached
                if (now - cached_at) < _PREFILTER_TTL:
                    failed_token_tracker.record_failure(tracker_key)
                    t_hmac_ms = (time.perf_counter() - t_hmac_start) * 1000
                    raise HTTPException(
                        status_code=cached_status,
                        detail=cached_detail
                    )
                else:
                    _INVALID_TOKEN_PREFILTER_CACHE.pop(cache_key, None)

    try:
        # FIX-10: Canonical QR Payload validation (Defense in Depth)
        if getattr(req, "qr_type", None) is not None:
            qr_t = str(req.qr_type).strip()
            if qr_t not in ("live_session", "frequency_extended"):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail={"error_code": "qr_type_invalid", "message": "Wrong QR — scan the live session QR"}
                )
        if getattr(req, "exp", None) is not None:
            try:
                exp_val = float(req.exp)
                now_ms = (now_ts or time.time()) * 1000
                exp_ms = exp_val if exp_val > 1e11 else exp_val * 1000
                if now_ms - 30000 > exp_ms:
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                        detail={"error_code": "qr_expired", "message": "QR expired — rescan"}
                    )
            except (ValueError, TypeError):
                pass

        if getattr(req, "claim_token", None):
            from app.services.launch_token import validate_and_consume_claim
            claim_data = validate_and_consume_claim(req.claim_token, now_ts=now_ts)
            claim_consumed_here = True
            token_data = {
                "session_id": claim_data["session_id"],
                "short_code": claim_data["short_code"],
                "step": claim_data["v"],
                "token_format": "claim",
                "period_count": 1
            }
        else:
            raw_token = (getattr(req, "session_token", None) or "").strip()
            code_input = raw_token or (getattr(req, "short_code", None) or "").strip()
            if not code_input:
                raise TokenValidationError(
                    code="invalid",
                    message="Missing attendance token: session_token or short_code required.",
                    server_now=now_ts
                )

            # Defensive token extraction if client submitted raw URL or relative path
            if code_input and ("/a/" in code_input or "http://" in code_input or "https://" in code_input):
                try:
                    from app.services.launch_token import extract_launch_token_from_url
                    extracted_token = extract_launch_token_from_url(code_input)
                    if extracted_token:
                        code_input = extracted_token
                except Exception:
                    pass

            token_data = ShortTokenService.validate_attendance_token(
                db=db,
                payload_or_code=code_input,
                v=getattr(req, "v", None),
                step_window=10,
                max_grace_steps=1,
                now_ts=now_ts,
                is_offline_submission=bool(getattr(req, "is_offline_submission", False))
            )
        t_hmac_ms = (time.perf_counter() - t_hmac_start) * 1000
        return token_data, claim_consumed_here, t_hmac_ms

    except TokenValidationError as tve:
        failed_token_tracker.record_failure(tracker_key)
        client_epoch_ms = request.headers.get("x-client-epoch-ms") if request else None
        skew_ms = None
        if client_epoch_ms:
            try:
                skew_ms = round(float(client_epoch_ms) - (now_ts * 1000), 2)
            except Exception:
                pass

        if (tve.code in ("QR-OLD", "expired") or getattr(tve, "code", None) == "QR-OLD") and getattr(tve, "session_id", None):
            try:
                from app.services.display_heartbeat import record_qr_old_event
                record_qr_old_event(tve.session_id)
            except Exception:
                pass

        p7_code = "QR-SESSION-END" if str(tve.code) == "QR-SESSION-END" else "QR-OLD"
        try:
            log_security_audit_event(
                db=db,
                event_type=SecurityEventType.ATTENDANCE_REJECTED,
                action="PROJECTOR_TOKEN_REJECTED",
                details=f"Projector token validation error for student {current_student.roll_number}: {tve.message} | epoch_delta={tve.epoch_delta}, session_status={tve.session_status}, skew_ms={skew_ms}",
                roll_number=current_student.roll_number
            )
        except Exception:
            pass

        detail_obj = {
            "code": "expired",
            "error_code": p7_code,
            "phase7_code": p7_code,
            "message": tve.message, 
            "serverNow": tve.server_now,
            "epoch_delta": tve.epoch_delta,
            "session_status": tve.session_status,
            "skew_ms": skew_ms
        }

        # Cache failed token in in-memory pre-filter
        if cache_key:
            with _PREFILTER_LOCK:
                if len(_INVALID_TOKEN_PREFILTER_CACHE) >= _PREFILTER_MAX_ENTRIES:
                    cutoff = now - (_PREFILTER_TTL / 2)
                    to_del = [k for k, (_, _, ts) in _INVALID_TOKEN_PREFILTER_CACHE.items() if ts < cutoff]
                    if not to_del:
                        to_del = list(_INVALID_TOKEN_PREFILTER_CACHE.keys())[:int(_PREFILTER_MAX_ENTRIES * 0.2)]
                    for k in to_del:
                        _INVALID_TOKEN_PREFILTER_CACHE.pop(k, None)
                _INVALID_TOKEN_PREFILTER_CACHE[cache_key] = (status.HTTP_400_BAD_REQUEST, detail_obj, now)

        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=detail_obj
        )
    except ValueError as val_err:
        failed_token_tracker.record_failure(tracker_key)
        try:
            log_security_audit_event(
                db=db,
                event_type=SecurityEventType.ATTENDANCE_REJECTED,
                action="PROJECTOR_TOKEN_REJECTED",
                details=f"Projector token validation error for student {current_student.roll_number}: {str(val_err)}",
                roll_number=current_student.roll_number
            )
        except Exception:
            pass

        detail_obj = {"code": "invalid", "message": str(val_err), "serverNow": time.time()}

        # Cache failed token in in-memory pre-filter
        if cache_key:
            with _PREFILTER_LOCK:
                if len(_INVALID_TOKEN_PREFILTER_CACHE) >= _PREFILTER_MAX_ENTRIES:
                    cutoff = now - (_PREFILTER_TTL / 2)
                    to_del = [k for k, (_, _, ts) in _INVALID_TOKEN_PREFILTER_CACHE.items() if ts < cutoff]
                    if not to_del:
                        to_del = list(_INVALID_TOKEN_PREFILTER_CACHE.keys())[:int(_PREFILTER_MAX_ENTRIES * 0.2)]
                    for k in to_del:
                        _INVALID_TOKEN_PREFILTER_CACHE.pop(k, None)
                _INVALID_TOKEN_PREFILTER_CACHE[cache_key] = (status.HTTP_400_BAD_REQUEST, detail_obj, now)

        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=detail_obj
        )
