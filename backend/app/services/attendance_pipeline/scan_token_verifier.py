import time
import logging
from typing import Dict, Any, Tuple
from fastapi import HTTPException, status, Request
from sqlalchemy.orm import Session

from app.core.security import TokenValidationError
from app.services.qr_token import ShortTokenService
from app.models.models import SecurityEventType
from app.core.device_security import log_security_audit_event

logger = logging.getLogger("snist_erp.scan_telemetry")


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
    Returns:
        (token_data, claim_consumed_here, t_hmac_ms)
    """
    t_hmac_start = time.perf_counter()
    claim_consumed_here = False

    try:
        if req.claim_token:
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
            raw_token = (req.session_token or "").strip()
            code_input = raw_token or (req.short_code or "").strip()
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
                v=req.v,
                step_window=10,
                max_grace_steps=1,
                now_ts=now_ts,
                is_offline_submission=bool(req.is_offline_submission)
            )
        t_hmac_ms = (time.perf_counter() - t_hmac_start) * 1000
        return token_data, claim_consumed_here, t_hmac_ms

    except TokenValidationError as tve:
        failed_token_tracker.record_failure(tracker_key)
        client_epoch_ms = request.headers.get("x-client-epoch-ms")
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
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "expired",
                "error_code": p7_code,
                "phase7_code": p7_code,
                "message": tve.message, 
                "serverNow": tve.server_now,
                "epoch_delta": tve.epoch_delta,
                "session_status": tve.session_status,
                "skew_ms": skew_ms
            }
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
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "invalid", "message": str(val_err), "serverNow": time.time()}
        )
