"""
SNIST ERP — Launch Token API (Phase 12A: Universal Projector Entry)

Provides two endpoints:
1. GET  /api/v1/launch/validate   — Public: validates launch token, returns session metadata
2. POST /api/v1/launch/attend     — Authenticated: submits attendance via launch token

SECURITY INVARIANT:
- GET /validate is public but NEVER marks attendance; it only returns session metadata.
- POST /attend requires student authentication and delegates to the SAME verification
  pipeline as /student/scan-session (token validation, device binding, geofence, dedup).
- Zero business logic duplication: all attendance decisions go through existing services.
"""

import time
import logging
from typing import Optional, Union
from fastapi import APIRouter, Depends, HTTPException, Request, status, BackgroundTasks
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.core.database import get_db
from app.core.config import settings
from app.services.launch_token import validate_launch_token

logger = logging.getLogger("snist_erp.launch_api")

router = APIRouter(prefix="/launch", tags=["Launch Token — Universal Projector Entry"])


class LaunchClaimRequest(BaseModel):
    """Request body for immediately claiming a launch token upon landing."""
    launch_token: str
    device_fingerprint: Optional[str] = None


class LaunchAttendRequest(BaseModel):
    """Request body for submitting attendance via a launch token or claim ticket."""
    claim_token: Optional[str] = None
    launch_token: Optional[str] = None
    device_fingerprint: Optional[str] = None
    device_uuid: Optional[str] = None
    device_id: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    accuracy_m: Optional[float] = None
    scan_mode: Optional[str] = None
    entry_method: Optional[str] = "WEB_URL"  # WEB_URL, WEB_PASTE, ANDROID_APP
    # Phase 4: Device Binding V2 fields
    challenge_token: Optional[str] = None
    binding_signature: Optional[str] = None


@router.post("/claim")
def claim_launch_token(
    req: LaunchClaimRequest,
    db: Session = Depends(get_db)
):
    """
    Public endpoint: Immediately validates a fresh launch token upon scan/landing
    and exchanges it for a 3-minute single-use claim ticket that survives login.
    """
    from app.services.launch_token import validate_launch_token, create_claim_ticket
    from app.core.security import TokenValidationError
    now_ts = time.time()
    try:
        token_data = validate_launch_token(req.launch_token, now_ts=now_ts)
    except TokenValidationError as tve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": tve.code, "message": tve.message, "serverNow": tve.server_now}
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "invalid", "message": str(e), "serverNow": now_ts}
        )

    session_id = token_data["session_id"]
    from app.models.models import AttendanceSession, SessionStatus
    session = db.query(AttendanceSession).filter(AttendanceSession.id == session_id).first()
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "invalid", "message": "Attendance session not found.", "serverNow": now_ts}
        )

    claim_info = create_claim_ticket(
        session_id=session_id,
        short_code=token_data["short_code"],
        v=token_data["v"],
        device_fingerprint=req.device_fingerprint,
        claim_ttl_seconds=180,
        now_ts=now_ts
    )

    session_status = getattr(session.status, "value", str(session.status))
    session_data = {
        "valid": True,
        "session_id": session_id,
        "subject_name": session.subject.name if session.subject else "",
        "subject_code": session.subject.code if session.subject else "",
        "section_name": session.section.name if session.section else "",
        "teacher_name": session.teacher.name if session.teacher else "",
        "session_date": session.session_date,
        "period": session.period,
        "session_status": session_status,
        "is_open": session_status == "OPEN",
        "short_code": token_data["short_code"],
        "v": token_data["v"]
    }
    return {
        "valid": True,
        "claim_token": claim_info["claim_token"],
        "expires_at": claim_info["expires_at"],
        "expiresAt": claim_info["expires_at"],
        "expires_in_seconds": claim_info["expires_in_seconds"],
        "expires_in": claim_info["expires_in_seconds"],
        "server_now": now_ts,
        "serverNow": now_ts,
        "session": session_data,
        **session_data
    }


@router.get("/validate")
def validate_launch(
    token: str,
    db: Session = Depends(get_db)
):
    """
    Public endpoint: validates a launch token and returns session metadata.
    
    This does NOT mark attendance. It only lets the landing page display
    session context (subject, section, teacher, status) so the student
    knows what session they're about to join.
    """
    from app.core.security import TokenValidationError
    now_ts = time.time()
    try:
        token_data = validate_launch_token(token, now_ts=now_ts)
    except TokenValidationError as tve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": tve.code, "message": tve.message, "serverNow": tve.server_now}
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "invalid", "message": str(e), "serverNow": now_ts}
        )

    session_id = token_data["session_id"]

    # Fetch session metadata for display
    from app.models.models import AttendanceSession, SessionStatus
    session = db.query(AttendanceSession).filter(
        AttendanceSession.id == session_id
    ).first()

    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "invalid", "message": "Attendance session not found.", "serverNow": now_ts}
        )

    session_status = getattr(session.status, "value", str(session.status))
    session_data = {
        "valid": True,
        "session_id": session_id,
        "subject_name": session.subject.name if session.subject else "",
        "subject_code": session.subject.code if session.subject else "",
        "section_name": session.section.name if session.section else "",
        "teacher_name": session.teacher.name if session.teacher else "",
        "session_date": session.session_date,
        "period": session.period,
        "session_status": session_status,
        "is_open": session_status == "OPEN",
        "short_code": token_data["short_code"],
        "v": token_data["v"],
        "server_now": now_ts,
        "serverNow": now_ts
    }
    return {
        "session": session_data,
        **session_data
    }


@router.post("/attend")
async def launch_attend(
    req: LaunchAttendRequest,
    background_tasks: BackgroundTasks,
    request: Request,
    db: Session = Depends(get_db)
):
    """
    Authenticated endpoint: submits attendance via a validated claim ticket or launch token.
    """
    # 1. Require student authentication
    from app.models.models import User, UserRole, Student
    from app.core.security import decode_access_token, TokenValidationError

    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "unauthorized", "message": "Authentication required. Please log in to mark attendance.", "serverNow": time.time()},
            headers={"WWW-Authenticate": "Bearer"}
        )

    token_str = auth_header[7:]
    try:
        payload = decode_access_token(token_str)
        username = payload.get("sub")
        if not username:
            raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "Invalid token", "serverNow": time.time()})
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "unauthorized", "message": "Invalid or expired authentication token.", "serverNow": time.time()},
            headers={"WWW-Authenticate": "Bearer"}
        )

    user = db.query(User).filter(User.username == username).first()
    if not user or user.role != UserRole.STUDENT or not user.student_profile:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "forbidden", "message": "Only students can mark attendance via launch tokens.", "serverNow": time.time()}
        )

    current_student = user.student_profile

    # 2. Validate request parameters
    if not req.claim_token and not req.launch_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "invalid", "message": "Either claim_token or launch_token is required.", "serverNow": time.time()}
        )

    # 3. Delegate to existing student scan-session logic
    from app.api.student import StudentScanSessionRequest, student_scan_session

    scan_req = StudentScanSessionRequest(
        session_token=req.launch_token if not req.claim_token else None,
        claim_token=req.claim_token,
        token_format="claim" if req.claim_token else "launch",
        device_uuid=req.device_uuid,
        device_id=req.device_id,
        latitude=req.latitude,
        longitude=req.longitude,
        accuracy_m=req.accuracy_m,
        scan_mode=req.scan_mode or "WEB_URL",
        challenge_token=req.challenge_token,
        binding_signature=req.binding_signature
    )

    try:
        result = await student_scan_session(
            req=scan_req,
            background_tasks=background_tasks,
            request=request,
            db=db,
            current_student=current_student
        )
    except HTTPException:
        raise  # Re-raise 400/401/403/429 from the scan pipeline
    except Exception as e:
        logger.error(f"[LaunchAttend] Unexpected error for {current_student.roll_number}: {e}", exc_info=True)
        if req.claim_token:
            try:
                from app.services.launch_token import unconsume_claim
                unconsume_claim(req.claim_token)
            except Exception:
                pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred while processing attendance."
        )

    # Add entry_method to result if not already present
    if isinstance(result, dict):
        result["entry_method"] = req.entry_method or "WEB_URL"

    # Record entry_method on the attendance record in the background
    entry_method = req.entry_method or "WEB_URL"
    if isinstance(result, dict) and result.get("attendance_id"):
        background_tasks.add_task(
            _async_update_entry_method,
            attendance_id=result["attendance_id"],
            entry_method=entry_method
        )

    return result


def _async_update_entry_method(attendance_id: int, entry_method: str):
    """Background task to update entry_method on the attendance record."""
    try:
        from app.core.database import SessionLocal
        from app.models.models import AttendanceRecord
        db_bg = SessionLocal()
        try:
            record = db_bg.query(AttendanceRecord).filter(
                AttendanceRecord.id == attendance_id
            ).first()
            if record:
                record.entry_method = entry_method
                db_bg.commit()
        finally:
            db_bg.close()
    except Exception as e:
        logger.warning(f"[LaunchAttend] Failed to update entry_method for record {attendance_id}: {e}")
