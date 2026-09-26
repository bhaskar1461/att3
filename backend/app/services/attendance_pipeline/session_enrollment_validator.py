import time
import logging
from typing import Dict, Any, Tuple, Optional
from datetime import datetime
from fastapi import HTTPException, status, Request
from sqlalchemy.orm import Session

from app.core.config import settings
from app.api.attendance import get_cached_session_meta
from app.models.models import SecurityEventType
from app.core.device_security import log_security_audit_event

logger = logging.getLogger("snist_erp.scan_telemetry")


def validate_session_and_enrollment(
    db: Session,
    current_student: Any,
    req: Any,
    token_data: Dict[str, Any],
    clean_roll: str,
    ip_addr: Optional[str],
    now_utc: datetime,
    request: Request,
    verify_binding_proof_fn: Any
) -> Tuple[Dict[str, Any], int, str, Optional[Dict[str, Any]], float]:
    """
    Validates session existence, section membership (Rule 4),
    cryptographic device binding (BINDING_V2 or legacy retirement),
    and session lock / offline grace submission windows.
    Returns:
        (session_meta, period_count, resolved_subject_name, binding_proof_meta, t_enrollment_ms)
    """
    t_enroll_start = time.perf_counter()
    session_id = token_data["session_id"]
    period_count = max(1, min(8, int(token_data.get("period_count", 1))))

    # 1. Fetch session using BoundedLRUSessionCache
    session_meta = get_cached_session_meta(db, session_id)
    if not session_meta:
        raise HTTPException(status_code=404, detail="Attendance session not found.")

    # Authoritative multi-period inheritance: Never downgrade multi-period sessions to single period
    sess_period_label = session_meta.get("period", "")
    if sess_period_label:
        from app.api.teacher import _extract_period_count
        sess_p = _extract_period_count(sess_period_label)
        if sess_p > period_count:
            period_count = sess_p

    resolved_subject_name = (session_meta.get("subject_name") or "").strip() or "Class Attendance Session"
    session_meta["subject_name"] = resolved_subject_name

    # Step 0e: Canonical Section Membership Check (Rule 4 & Section Governance)
    if current_student.section_id != session_meta["section_id"]:
        try:
            log_security_audit_event(
                db=db,
                event_type=SecurityEventType.ATTENDANCE_REJECTED,
                action="SECTION_MISMATCH_REJECTED",
                details=f"Student {current_student.roll_number} section {current_student.section_id} mismatched session section {session_meta['section_id']}",
                roll_number=current_student.roll_number
            )
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Not enrolled in this section. Please contact faculty incharge."
        )

    # Step 0f: Device Binding V2 Possession Proof (Feature-Flagged, Phase 4 & Phase 5 Cutover)
    binding_proof_meta = None
    if getattr(settings, 'BINDING_V2', False):
        if not req.is_offline_submission:
            try:
                binding_proof_meta = verify_binding_proof_fn(db, current_student, req, ip_addr)
            except HTTPException:
                raise
            except Exception as binding_err:
                logger.error(f"[BINDING V2] Non-fatal verification error for {clean_roll}: {binding_err}")
                binding_proof_meta = {"binding_verified": False, "reason": "internal_error"}
    else:
        # Standard device binding path: verify V2 proof if provided, otherwise defer to Layer 1 & 2 binding in recorder
        has_v2_proof = bool(req.challenge_token and req.binding_signature)
        if has_v2_proof:
            try:
                binding_proof_meta = verify_binding_proof_fn(db, current_student, req, ip_addr)
            except Exception as binding_err:
                logger.info(f"[BINDING V2] Optional proof check for {clean_roll}: {binding_err}")
                binding_proof_meta = {"binding_verified": False, "reason": "optional_fallback"}

    status_str = getattr(session_meta["status"], "value", str(session_meta["status"]))
    if status_str != "OPEN":
        locked_at = session_meta.get("locked_at")
        grace_minutes = getattr(settings, "SUBMIT_GRACE_MINUTES", 10)

        # Offline submissions are only accepted if queued BEFORE the session lock time!
        queued_at_val = getattr(req, "queued_at", None)
        is_valid_prelock_offline = False
        if getattr(req, "is_offline_submission", False) and queued_at_val is not None:
            try:
                q_dt = None
                if isinstance(queued_at_val, (int, float)):
                    epoch_sec = queued_at_val / 1000.0 if queued_at_val > 1e11 else float(queued_at_val)
                    q_dt = datetime.utcfromtimestamp(epoch_sec)
                elif isinstance(queued_at_val, str):
                    cleaned = queued_at_val.strip().replace("Z", "+00:00")
                    if cleaned.isdigit() or (cleaned.replace(".", "", 1).isdigit()):
                        num_val = float(cleaned)
                        epoch_sec = num_val / 1000.0 if num_val > 1e11 else num_val
                        q_dt = datetime.utcfromtimestamp(epoch_sec)
                    else:
                        q_dt = datetime.fromisoformat(cleaned).replace(tzinfo=None)
                elif isinstance(queued_at_val, datetime):
                    q_dt = queued_at_val.replace(tzinfo=None)

                if q_dt and locked_at and q_dt <= locked_at:
                    is_valid_prelock_offline = True
            except Exception as parse_err:
                logger.warning(f"[Offline Sync] Failed to parse queued_at ({queued_at_val}): {parse_err}")

        if is_valid_prelock_offline and locked_at:
            time_since_lock_sec = (now_utc - locked_at).total_seconds()
            if time_since_lock_sec > (grace_minutes * 60):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Attendance session is locked. Submission grace window ({grace_minutes}m) has expired."
                )
            logger.info(
                f"Accepted offline/grace submission for student {clean_roll} in locked session {session_id} "
                f"(+{time_since_lock_sec:.1f}s post-lock, grace_limit={grace_minutes}m)"
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "expired",
                    "error_code": "QR-SESSION-END",
                    "phase7_code": "QR-SESSION-END",
                    "message": "This class session has ended. Attendance session is locked. See your faculty if you believe this is wrong. (Code: QR-SESSION-END)",
                    "session_status": "LOCKED",
                    "serverNow": time.time()
                }
            )

    t_enrollment_ms = (time.perf_counter() - t_enroll_start) * 1000
    return session_meta, period_count, resolved_subject_name, binding_proof_meta, t_enrollment_ms
