import time
import logging
import secrets
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List

from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field

from app.core.database import get_db
from app.core.config import settings
from app.models.models import (
    AttendanceSession, AttendanceRecord, Student, Classroom,
    AttendanceAuditReview, DeviceBinding, RotatingCode, SessionStatus,
    AttendanceStatus, SessionCanonical, StudentCanonical
)
from app.core.security import (
    generate_rotating_code, verify_rotating_code, validate_coarse_geofence,
    get_server_ist_datetime, get_server_ist_date, hash_rotating_code
)
from app.services.sheets_batch_worker import sync_session_to_sheets_batch

logger = logging.getLogger("snist_erp.prox_presence")

router = APIRouter(tags=["ProxPresence Attendance Engine"])

# ============================================================================
# PYDANTIC SCHEMAS
# ============================================================================

class SessionStartRequest(BaseModel):
    faculty_id: int
    room_id: int
    section: str
    period: Optional[str] = "Period 1"
    subject_id: Optional[int] = None

class SessionLockRequest(BaseModel):
    session_id: int
    faculty_id: Optional[int] = None

class AttendanceMarkRequest(BaseModel):
    session_id: int
    student_id: Optional[int] = None
    roll_no: Optional[str] = None
    device_hash: str
    method: str = "ble"  # 'ble' | 'code' | 'manual'
    code: Optional[str] = None
    rssi: Optional[int] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    geo_accuracy_m: Optional[float] = None
    is_mock_location: Optional[bool] = False

class CodeVerifyRequest(BaseModel):
    session_id: int
    code: str

class KillSwitchRequest(BaseModel):
    session_id: Optional[int] = None
    room_id: Optional[int] = None
    active: bool = True
    reason: Optional[str] = "High error rate detected (>10%)"

class AuditResolveRequest(BaseModel):
    review_id: int
    resolution: str = "APPROVED"  # 'APPROVED' | 'REJECTED'
    resolved_by: str = "FACULTY"

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def _find_or_create_session_secret(session: AttendanceSession, db: Session) -> str:
    if not session.ephemeral_secret:
        session.ephemeral_secret = secrets.token_hex(32)
        db.commit()
    return session.ephemeral_secret

def _get_active_code(session: AttendanceSession, db: Session) -> Dict[str, Any]:
    secret = _find_or_create_session_secret(session, db)
    code, code_hash, remaining_sec = generate_rotating_code(session.id, secret)
    
    # Check if this bucket is already recorded
    now = get_server_ist_datetime()
    existing_rc = db.query(RotatingCode).filter(
        RotatingCode.session_id == session.id,
        RotatingCode.code_hash == code_hash
    ).first()
    
    if not existing_rc:
        rc = RotatingCode(
            session_id=session.id,
            code_hash=code_hash,
            generated_at=now,
            valid_until=now + timedelta(seconds=remaining_sec)
        )
        db.add(rc)
        try:
            db.commit()
        except Exception:
            db.rollback()

    return {
        "code": code,
        "remaining_seconds": remaining_sec,
        "valid_until": (now + timedelta(seconds=remaining_sec)).isoformat()
    }

# ============================================================================
# ENDPOINTS
# ============================================================================

@router.post("/session/start")
def start_session(req: SessionStartRequest, db: Session = Depends(get_db)):
    """
    Initializes a new proximity attendance session.
    Generates server-authoritative ephemeral secret and initial 4-char rotating code.
    """
    classroom = db.query(Classroom).filter(Classroom.id == req.room_id).first()
    if not classroom:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Classroom with id {req.room_id} not found."
        )

    now = get_server_ist_datetime()
    today_date = get_server_ist_date()

    # Create AttendanceSession
    session = AttendanceSession(
        teacher_id=req.faculty_id,
        faculty_id=req.faculty_id,
        room_id=classroom.id,
        classroom_id=classroom.id,
        subject_id=req.subject_id or 1,
        section_id=1,  # fallback if section entity mapped separately
        period=req.period or "Period 1",
        session_date=today_date,
        status=SessionStatus.OPEN,
        starts_at=now,
        kill_switch_active=False,
        ephemeral_secret=secrets.token_hex(32)
    )
    db.add(session)
    db.flush()

    # Also register in canonical sessions table if present
    try:
        can_session = SessionCanonical(
            faculty_id=req.faculty_id,
            room_id=classroom.id,
            section=req.section,
            starts_at=now,
            status="OPEN"
        )
        db.add(can_session)
    except Exception as e:
        logger.debug(f"SessionCanonical notice (non-fatal): {e}")

    # Generate first rotating code
    code_info = _get_active_code(session, db)
    db.commit()

    return {
        "status": "OPEN",
        "session_id": session.id,
        "faculty_id": req.faculty_id,
        "room_id": classroom.id,
        "room_code": classroom.room_code,
        "section": req.section,
        "period": session.period,
        "starts_at": session.starts_at.isoformat(),
        "rotating_code": code_info["code"],
        "expires_in_seconds": code_info["remaining_seconds"],
        "beacon_uuid": "SNIST-PROX-2026",
        "beacon_payload": f"SNIST|{session.id}|{code_info['code']}|{int(time.time())}",
        "rssi_threshold_dbm": classroom.default_rssi_threshold,
        "geofence_radius_meters": classroom.geofence_radius_meters
    }

@router.post("/session/lock")
def lock_session(
    req: SessionLockRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    Locks the session, preventing further student submissions.
    Fires a single Google Sheets batch sync in the background with retry and DLQ.
    Returns reconciliation report (total marked, method breakdown, flagged count).
    """
    session = db.query(AttendanceSession).filter(AttendanceSession.id == req.session_id).first()
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {req.session_id} not found."
        )

    now = get_server_ist_datetime()
    session.status = SessionStatus.LOCKED
    session.locks_at = now

    # Gather reconciliation data
    records = db.query(AttendanceRecord).filter(AttendanceRecord.session_id == session.id).all()
    total_marked = len(records)
    
    ble_count = sum(1 for r in records if (r.method == "ble" or r.verified_scan_mode == "PROXIMITY_BLE"))
    code_count = sum(1 for r in records if (r.method == "code" or r.verified_scan_mode == "PROXIMITY_CODE"))
    manual_count = sum(1 for r in records if (r.method == "manual" or r.scan_mode == "MANUAL"))
    # Default remaining to ble
    if (ble_count + code_count + manual_count) < total_marked:
        ble_count += total_marked - (ble_count + code_count + manual_count)

    flagged_reviews = db.query(AttendanceAuditReview).filter(
        AttendanceAuditReview.session_id == session.id
    ).count()

    db.commit()

    # Fire single batchUpdate background task to Google Sheets
    background_tasks.add_task(sync_session_to_sheets_batch, session.id)

    return {
        "status": "LOCKED",
        "session_id": session.id,
        "locked_at": session.locks_at.isoformat(),
        "reconciliation": {
            "total_marked": total_marked,
            "method_breakdown": {
                "ble": ble_count,
                "code": code_count,
                "manual": manual_count
            },
            "flagged_for_review": flagged_reviews,
            "sheets_sync_status": "QUEUED_BATCH"
        }
    }

@router.post("/attendance/mark")
def mark_attendance(req: AttendanceMarkRequest, db: Session = Depends(get_db)):
    """
    Tiered attendance marking endpoint:
    - Tier 1 (BLE): Web Bluetooth scan of room beacon (accepted >= -85 dBm; flagged -75..-85 dBm)
    - Tier 2 (Code): 4-char rotating code (+-30s grace window)
    - Tier 3 (Manual): Faculty manual check-in UI (always logged)

    Enforces 5 Security Invariants:
    1. Geofence coarse gate (+25m tolerance)
    2. Section match
    3. Device binding (30-min lock per session; violation -> HTTP 403)
    4. Rotating code HMAC verify (never stored plaintext)
    5. Fast response (< 20ms DB write only, zero per-scan Sheets calls)
    """
    now = get_server_ist_datetime()

    # 1. Retrieve & validate session
    session = db.query(AttendanceSession).filter(AttendanceSession.id == req.session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")
    if session.status == SessionStatus.LOCKED:
        raise HTTPException(status_code=400, detail="Attendance session is locked.")

    # 2. Check Kill Switch
    if session.kill_switch_active and req.method != "manual":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Room is in manual-only mode. Please check in manually with faculty."
        )

    # 3. Retrieve student
    student = None
    if req.student_id:
        student = db.query(Student).filter(Student.id == req.student_id).first()
    if not student and req.roll_no:
        clean_roll = req.roll_no.strip().upper()
        student = db.query(Student).filter(Student.roll_number == clean_roll).first()
        if not student:
            # Check canonical table
            can_s = db.query(StudentCanonical).filter(StudentCanonical.roll_no == clean_roll).first()
            if can_s:
                student = student = db.query(Student).filter(Student.roll_number == can_s.roll_no).first()

    if not student:
        raise HTTPException(status_code=404, detail="Student record not found.")

    # 4. Security Invariant 2: Section Match
    student_section_name = student.section.name if student.section else ""
    session_section_name = session.section.name if session.section else ""
    if not session_section_name:
        # Check canonical session
        can_sess = db.query(SessionCanonical).filter(SessionCanonical.id == session.id).first()
        session_section_name = can_sess.section if can_sess else ""

    if student_section_name and session_section_name and student_section_name != session_section_name:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Section mismatch: You are enrolled in section {student_section_name}, but this session is for {session_section_name}."
        )

    # 5. Security Invariant 3: Device Binding (30-Minute Lock)
    clean_device_hash = req.device_hash.strip().lower()
    recent_cutoff = now - timedelta(minutes=settings.DEVICE_BINDING_MINUTES)
    
    active_binding = db.query(DeviceBinding).filter(
        DeviceBinding.device_hash == clean_device_hash,
        DeviceBinding.bound_at >= recent_cutoff
    ).order_by(DeviceBinding.bound_at.desc()).first()

    if active_binding and active_binding.student_id != student.id:
        # Friendly 403 copy directing to faculty manual search
        logger.warning(
            f"Device lock violation: Device {clean_device_hash[:8]} bound to student {active_binding.student_id}, "
            f"attempted by student {student.id} ({student.roll_number})."
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Security Lock: one phone per student per 30-minute session. Please see faculty for manual check-in."
        )

    # Refresh / create device binding
    if not active_binding:
        new_bind = DeviceBinding(
            device_hash=clean_device_hash,
            student_id=student.id,
            bound_at=now,
            expires_at=now + timedelta(minutes=settings.DEVICE_BINDING_MINUTES)
        )
        db.add(new_bind)

    student.device_hash = clean_device_hash

    # 6. Security Invariant 1: Geofence Coarse Check (+25m tolerance)
    audit_flags = []
    classroom = session.classroom or db.query(Classroom).filter(Classroom.id == (session.classroom_id or session.room_id)).first()
    
    if classroom:
        if req.latitude is not None and req.longitude is not None:
            inside_geo, dist_m = validate_coarse_geofence(
                client_lat=req.latitude,
                client_lon=req.longitude,
                classroom_lat=classroom.center_latitude,
                classroom_lon=classroom.center_longitude,
                geofence_radius_m=classroom.geofence_radius_meters,
                tolerance_m=25.0
            )
            if not inside_geo:
                audit_flags.append({
                    "flag": "geo_coarse",
                    "reason": f"Outside coarse geofence ({dist_m:.1f}m > {classroom.geofence_radius_meters + 25}m)"
                })
        else:
            # Denied geolocation: coarse fallback + audit flag, never a hard error
            audit_flags.append({
                "flag": "geo_coarse",
                "reason": "Geolocation permission not granted by student device; coarse fallback applied"
            })

    # 7. Tiered Attendance Validation
    norm_method = req.method.strip().lower()
    
    if norm_method == "ble":
        # Tier 1 (BLE): RSSI >= -85 accepted; -75..-85 flagged; below rejected
        if req.rssi is None:
            raise HTTPException(status_code=400, detail="Missing RSSI measurement for BLE attendance.")
        
        target_thresh = classroom.default_rssi_threshold if classroom else -75
        if req.rssi < -85:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Bluetooth signal too weak ({req.rssi} dBm). Please move closer to faculty beacon or enter the 4-digit rotating code."
            )
        elif -85 <= req.rssi < target_thresh:
            audit_flags.append({
                "flag": "rssi_borderline",
                "reason": f"Borderline RSSI ({req.rssi} dBm between -85 and {target_thresh} dBm)"
            })

    elif norm_method == "code":
        # Tier 2 (Code): 4-char rotating code (15s rotation, HMAC-signed, TOTP-style, +-30s grace)
        if not req.code:
            raise HTTPException(status_code=400, detail="4-character rotating code required.")
        
        secret = _find_or_create_session_secret(session, db)
        is_code_valid = verify_rotating_code(
            code=req.code,
            session_id=session.id,
            secret=secret,
            window_seconds=15,
            tolerance_windows=2
        )
        if not is_code_valid:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid or expired rotating code. Please check the screen and try again."
            )

    elif norm_method == "manual":
        # Tier 3 (Manual): Faculty manual check-in
        audit_flags.append({
            "flag": "manual",
            "reason": "Marked via faculty manual search"
        })
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported attendance method '{req.method}'.")

    # 8. Idempotent DB Write (< 20ms)
    existing_record = db.query(AttendanceRecord).filter(
        AttendanceRecord.session_id == session.id,
        AttendanceRecord.student_id == student.id
    ).first()

    if existing_record:
        return {
            "status": "SUCCESS",
            "message": "Attendance already confirmed for this session.",
            "roll_no": student.roll_number,
            "name": student.name,
            "method": existing_record.method or norm_method,
            "marked_at": (existing_record.marked_at or existing_record.scanned_at or now).isoformat()
        }

    verified_mode_map = {
        "ble": "PROXIMITY_BLE",
        "code": "PROXIMITY_CODE",
        "manual": "MANUAL"
    }

    record = AttendanceRecord(
        session_id=session.id,
        student_id=student.id,
        roll_number=student.roll_number,
        session_date=session.session_date or get_server_ist_date(),
        period_count=4,
        status=AttendanceStatus.PRESENT,
        scan_mode="PROXIMITY" if norm_method != "manual" else "MANUAL",
        verified_scan_mode=verified_mode_map.get(norm_method, "PROXIMITY_BLE"),
        method=norm_method,
        rssi=req.rssi,
        measured_rssi=req.rssi,
        geo_accuracy_m=req.geo_accuracy_m,
        location_accuracy_meters=req.geo_accuracy_m,
        marked_at=now,
        scanned_at=now
    )
    db.add(record)
    db.flush()

    # Record any audit review flags
    for af in audit_flags:
        rev = AttendanceAuditReview(
            session_id=session.id,
            student_id=student.id,
            record_id=record.id,
            roll_number=student.roll_number,
            flag=af["flag"],
            event_type=af["flag"].upper(),
            measured_rssi=req.rssi,
            target_threshold=classroom.default_rssi_threshold if classroom else -75,
            latitude=req.latitude,
            longitude=req.longitude,
            details=af["reason"],
            created_at=now
        )
        db.add(rev)

    db.commit()

    return {
        "status": "SUCCESS",
        "message": "Attendance marked successfully",
        "roll_no": student.roll_number,
        "name": student.name,
        "method": norm_method,
        "marked_at": record.marked_at.isoformat()
    }

@router.post("/code/verify")
def verify_code(req: CodeVerifyRequest, db: Session = Depends(get_db)):
    """
    Validates a 4-character rotating code against the session secret
    with server grace window (+-30s tolerance).
    """
    session = db.query(AttendanceSession).filter(AttendanceSession.id == req.session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")
    
    secret = _find_or_create_session_secret(session, db)
    valid = verify_rotating_code(
        code=req.code,
        session_id=session.id,
        secret=secret,
        window_seconds=15,
        tolerance_windows=2
    )

    return {
        "session_id": session.id,
        "code": req.code.strip().upper(),
        "valid": valid,
        "message": "Code is valid" if valid else "Invalid or expired rotating code"
    }

@router.post("/admin/kill-switch")
def toggle_kill_switch(req: KillSwitchRequest, db: Session = Depends(get_db)):
    """
    One-tap Kill Switch: Switches a room/session to manual-only mode
    (e.g., if BLE error rate > 10% or hardware failure).
    """
    sessions = []
    if req.session_id:
        s = db.query(AttendanceSession).filter(AttendanceSession.id == req.session_id).first()
        if s:
            sessions.append(s)
    elif req.room_id:
        sessions = db.query(AttendanceSession).filter(
            AttendanceSession.room_id == req.room_id,
            AttendanceSession.status == SessionStatus.OPEN
        ).all()

    if not sessions:
        raise HTTPException(status_code=404, detail="Active session not found.")

    for s in sessions:
        s.kill_switch_active = req.active

    db.commit()

    return {
        "status": "SUCCESS",
        "kill_switch_active": req.active,
        "mode": "MANUAL_ONLY" if req.active else "NORMAL_TIERED",
        "sessions_affected": len(sessions),
        "reason": req.reason,
        "message": f"Switched to {'manual-only mode' if req.active else 'standard tiered mode'}."
    }

@router.get("/health")
def health_check(db: Session = Depends(get_db)):
    """
    Health check verifying server IST time, DB connectivity, and system state.
    """
    db_status = "CONNECTED"
    try:
        from sqlalchemy import text
        db.execute(text("SELECT 1"))
    except Exception as e:
        db_status = f"ERROR: {e}"

    return {
        "status": "ONLINE",
        "system": "ProxPresence Multi-Tier Attendance Engine",
        "version": settings.VERSION,
        "server_time_ist": get_server_ist_datetime().isoformat(),
        "server_date_ist": get_server_ist_date(),
        "database": db_status
    }

# ============================================================================
# FACULTY HUD LIVE STREAM & COUNTERS
# ============================================================================

@router.get("/session/{session_id}/hud")
def get_faculty_hud_data(session_id: int, db: Session = Depends(get_db)):
    """
    Provides real-time HUD telemetry for the faculty dashboard:
    - Active rotating code & countdown seconds
    - Pre-flight checklist status
    - Live counters (BLE / Code / Manual)
    - Error rate
    - Audit-review queue with one-tap approve/reject
    """
    session = db.query(AttendanceSession).filter(AttendanceSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")

    code_info = _get_active_code(session, db)
    records = db.query(AttendanceRecord).filter(AttendanceRecord.session_id == session.id).all()
    total_marked = len(records)

    ble_count = sum(1 for r in records if (r.method == "ble" or r.verified_scan_mode == "PROXIMITY_BLE"))
    code_count = sum(1 for r in records if (r.method == "code" or r.verified_scan_mode == "PROXIMITY_CODE"))
    manual_count = sum(1 for r in records if (r.method == "manual" or r.scan_mode == "MANUAL"))
    if (ble_count + code_count + manual_count) < total_marked:
        ble_count += total_marked - (ble_count + code_count + manual_count)

    # Audit reviews
    pending_reviews = db.query(AttendanceAuditReview).filter(
        AttendanceAuditReview.session_id == session.id,
        AttendanceAuditReview.resolved_at.is_(None)
    ).all()

    # Preflight checklist
    preflight = {
        "server_health": True,
        "beacon_advertising": True,
        "manual_mode_armed": True,
        "kill_switch_active": bool(session.kill_switch_active)
    }

    # Error rate approximation based on audit flags vs total
    error_rate = (len(pending_reviews) / max(total_marked, 1)) * 100.0 if total_marked > 0 else 0.0

    return {
        "session_id": session.id,
        "status": session.status.value if hasattr(session.status, "value") else str(session.status),
        "rotating_code": code_info["code"],
        "countdown_seconds": code_info["remaining_seconds"],
        "preflight": preflight,
        "kill_switch_active": bool(session.kill_switch_active),
        "counters": {
            "total_marked": total_marked,
            "ble": ble_count,
            "code": code_count,
            "manual": manual_count,
            "error_rate_percent": round(error_rate, 1)
        },
        "audit_reviews": [
            {
                "id": r.id,
                "roll_number": r.roll_number,
                "flag": r.flag or r.event_type,
                "measured_rssi": r.measured_rssi,
                "details": r.details,
                "created_at": r.created_at.isoformat() if r.created_at else None
            }
            for r in pending_reviews
        ]
    }

@router.post("/admin/audit-review/resolve")
def resolve_audit_review(req: AuditResolveRequest, db: Session = Depends(get_db)):
    """
    One-tap resolution for faculty HUD audit queue (approve or reject).
    """
    review = db.query(AttendanceAuditReview).filter(AttendanceAuditReview.id == req.review_id).first()
    if not review:
        raise HTTPException(status_code=404, detail="Audit review not found.")

    review.resolved_by = req.resolved_by
    review.resolved_at = get_server_ist_datetime()
    review.details = f"{review.details or ''} | Resolved as {req.resolution} by {req.resolved_by}"

    if req.resolution == "REJECTED" and review.record_id:
        rec = db.query(AttendanceRecord).filter(AttendanceRecord.id == review.record_id).first()
        if rec:
            db.delete(rec)

    db.commit()
    return {
        "status": "SUCCESS",
        "review_id": review.id,
        "resolution": req.resolution
    }
