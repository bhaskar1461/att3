from fastapi import APIRouter, Depends, HTTPException, Request, status, BackgroundTasks
from sqlalchemy.orm import Session, joinedload
from typing import Dict, Any, List, Optional
from datetime import datetime
from pydantic import BaseModel

from app.core.database import get_db
from app.api.auth import get_current_user
from app.models.models import User, UserRole, Student, AttendanceRecord, AttendanceSession, Subject, DeviceRegistration
from app.services.qr_service import QRService
from app.core.security import get_server_ist_date
from app.core.device_security import validate_active_binding_for_student

router = APIRouter(prefix="/student", tags=["Student Portal"])

def require_student(current_user: User = Depends(get_current_user)) -> Student:
    if current_user.role != UserRole.STUDENT or not current_user.student_profile:
        raise HTTPException(status_code=403, detail="Student permission required")
    return current_user.student_profile

@router.get("/profile")
def get_student_profile(current_student: Student = Depends(require_student)):
    return {
        "id": current_student.id,
        "roll_number": current_student.roll_number,
        "name": current_student.name,
        "department": current_student.department.code if current_student.department else "",
        "year": current_student.academic_year.name if current_student.academic_year else "",
        "section": current_student.section.name if current_student.section else "",
        "email": current_student.email,
        "mobile": current_student.mobile
    }

@router.get("/qr-code")
def get_student_qr(
    request: Request,
    date: Optional[str] = None,
    db: Session = Depends(get_db),
    current_student: Student = Depends(require_student)
):
    device_public_id = request.headers.get("x-device-public-id", "").strip()
    if device_public_id:
        device = db.query(DeviceRegistration).filter(DeviceRegistration.device_public_id == device_public_id).first()
        if device and not device.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Device has been revoked or disabled by system administrator."
            )
    server_today = get_server_ist_date()
    target_date = date or server_today

    if target_date > server_today:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot generate attendance QR code for a future date"
        )
    
    qr_base64 = QRService.generate_student_qr_code(
        student_id=current_student.id,
        roll_number=current_student.roll_number,
        student_name=current_student.name,
        attendance_date=target_date,
        as_base64=True
    )

    pure_qr_base64 = QRService.generate_pure_qr_code(
        student_id=current_student.id,
        roll_number=current_student.roll_number,
        attendance_date=target_date,
        as_base64=True
    )

    try:
        dt_obj = datetime.strptime(target_date, "%Y-%m-%d")
        formatted_date = dt_obj.strftime("%d %b %Y").upper()
    except Exception:
        formatted_date = str(target_date).upper()

    is_today = (target_date == server_today)

    return {
        "roll_number": current_student.roll_number,
        "name": current_student.name,
        "attendance_date": target_date,
        "formatted_date": formatted_date,
        "is_today": is_today,
        "is_makeup": not is_today,
        "qr_code_url": qr_base64,
        "pure_qr_code_url": pure_qr_base64
    }

@router.get("/pure-qr")
def get_student_pure_qr(
    date: Optional[str] = None,
    current_student: Student = Depends(require_student)
):
    target_date = date or get_server_ist_date()
    pure_qr_base64 = QRService.generate_pure_qr_code(
        student_id=current_student.id,
        roll_number=current_student.roll_number,
        attendance_date=target_date,
        as_base64=True
    )
    return {
        "roll_number": current_student.roll_number,
        "attendance_date": target_date,
        "pure_qr_code_url": pure_qr_base64
    }


@router.get("/attendance-summary")
def get_student_attendance_summary(db: Session = Depends(get_db), current_student: Student = Depends(require_student)):
    records = db.query(AttendanceRecord).options(
        joinedload(AttendanceRecord.session).joinedload(AttendanceSession.subject)
    ).filter(AttendanceRecord.student_id == current_student.id).all()
    
    total_conducted = len(records)
    total_present = sum(1 for r in records if r.status.value in ["PRESENT", "4"])
    overall_percentage = round((total_present / total_conducted * 100), 1) if total_conducted > 0 else 100.0

    # Group by subject
    subject_stats = {}
    for r in records:
        subj_name = r.session.subject.name if r.session and r.session.subject else "General"
        if subj_name not in subject_stats:
            subject_stats[subj_name] = {"conducted": 0, "present": 0}
        subject_stats[subj_name]["conducted"] += 1
        if r.status.value in ["PRESENT", "4"]:
            subject_stats[subj_name]["present"] += 1

    subject_list = []
    for s_name, data in subject_stats.items():
        pct = round((data["present"] / data["conducted"] * 100), 1) if data["conducted"] > 0 else 0.0
        subject_list.append({
            "subject_name": s_name,
            "conducted": data["conducted"],
            "present": data["present"],
            "percentage": pct
        })

    return {
        "total_conducted": total_conducted,
        "total_present": total_present,
        "overall_percentage": overall_percentage,
        "subjects": subject_list
    }


@router.get("/today-schedule")
def get_student_today_schedule(
    db: Session = Depends(get_db),
    current_student: Student = Depends(require_student)
):
    """
    Returns today's active schedule for the student's section.
    For CS Security testing, returns Career Enhancement Training (CET) (4 Periods).
    """
    server_today = get_server_ist_date()
    
    # Check if there is an active session for the student's section today
    active_session = db.query(AttendanceSession).filter(
        AttendanceSession.section_id == current_student.section_id,
        AttendanceSession.session_date == server_today,
        AttendanceSession.status == SessionStatus.OPEN
    ).order_by(AttendanceSession.id.desc()).first()

    schedule_items = [
        {
            "subject_name": "Career Enhancement Training (CET)",
            "subject_code": "CS(CET)",
            "teacher_name": "Mrs. N. Sowjanya",
            "timing": "09:30 AM - 01:00 PM",
            "period": "4 Periods",
            "period_count": 4,
            "room": "CSE-CS Projector Lab",
            "is_live": active_session is not None,
            "session_id": active_session.id if active_session else None,
            "status": "Live In-Class" if active_session else "Scheduled"
        }
    ]

    return {
        "today_date": server_today,
        "schedule": schedule_items,
        "active_session": {
            "session_id": active_session.id,
            "subject_name": active_session.subject.name if active_session.subject else "Career Enhancement Training (CET)",
            "teacher_name": active_session.teacher.name if active_session.teacher else "Mrs. N. Sowjanya",
            "period": active_session.period or "4 Periods",
            "period_count": 4,
            "room": "CSE-CS Projector Lab",
            "status": "LIVE IN-CLASS"
        } if active_session else {
            "subject_name": "Career Enhancement Training (CET)",
            "teacher_name": "Mrs. N. Sowjanya",
            "period": "4 Periods",
            "period_count": 4,
            "room": "CSE-CS Projector Lab",
            "status": "Scheduled"
        }
    }


class StudentScanSessionRequest(BaseModel):
    session_token: str
    device_uuid: Optional[str] = None


from app.core.security import validate_projector_session_token
from app.api.attendance import _async_post_scan_tasks, get_cached_session_meta
from app.models.models import AttendanceStatus, SessionStatus, SecurityEventType, BindingStatus, DeviceAccountBinding
from app.core.device_security import log_security_audit_event


@router.post("/scan-session")
def student_scan_session(
    req: StudentScanSessionRequest,
    background_tasks: BackgroundTasks,
    request: Request,
    db: Session = Depends(get_db),
    current_student: Student = Depends(require_student)
):
    """
    Endpoint for students scanning the teacher's projected rotating 10-second QR code.
    Validates token, session status, section membership, device binding, and records attendance.
    Optimized with BoundedLRUSessionCache to eliminate redundant DB round-trips.
    """
    # 1. Device binding check (ADR-004: Anti-proxy account switching lockout)
    from app.core.device_security import register_or_get_device, enforce_device_binding
    device_id = req.device_uuid or request.headers.get("x-device-public-id", "").strip()
    if not device_id:
        import hashlib
        client_ua = request.headers.get("user-agent", "generic_student_browser")
        client_ip = (request.client.host if request.client else None) or "127.0.0.1"
        conn_sig = hashlib.sha256(f"{client_ip}_{client_ua}".encode()).hexdigest()[:16]
        device_id = f"DEV-CONN-{conn_sig.upper()}"

    clean_roll = current_student.roll_number.strip().upper()
    ip_addr = request.client.host if request.client else None
    device_secret = request.headers.get("x-device-secret", "").strip() or f"{device_id}_SECRET_SALT_2026"

    device = register_or_get_device(
        db=db,
        device_public_id=device_id.strip(),
        device_secret=device_secret,
        ip_address=ip_addr
    )
    if not device.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Device has been revoked or disabled by system administrator."
        )

    # Server-authoritative 30-minute device lock (blocks Student B from scanning on Student A's phone)
    enforce_device_binding(
        db=db,
        device=device,
        roll_number=clean_roll,
        ip_address=ip_addr
    )

    # 2. Validate rotating session token with 10s + 10s sliding window
    try:
        token_data = validate_projector_session_token(
            token_str=req.session_token,
            step_window=10,
            max_grace_steps=1
        )
    except ValueError as val_err:
        log_security_audit_event(
            db=db,
            event_type=SecurityEventType.ATTENDANCE_REJECTED,
            action="PROJECTOR_TOKEN_REJECTED",
            details=f"Projector token validation error for student {current_student.roll_number}: {str(val_err)}",
            roll_number=current_student.roll_number
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(val_err)
        )

    session_id = token_data["session_id"]
    period_count = token_data["period_count"]

    # 3. Fetch session using BoundedLRUSessionCache (avoids remote MySQL round-trip on hits)
    session_meta = get_cached_session_meta(db, session_id)
    if not session_meta:
        raise HTTPException(status_code=404, detail="Attendance session not found.")

    status_str = getattr(session_meta["status"], "value", str(session_meta["status"]))
    if status_str != "OPEN":
        raise HTTPException(status_code=400, detail="Attendance session is locked. No further scans allowed.")

    # 4. Check section membership
    if current_student.section_id != session_meta["section_id"]:
        log_security_audit_event(
            db=db,
            event_type=SecurityEventType.ATTENDANCE_REJECTED,
            action="SECTION_MISMATCH_REJECTED",
            details=f"Student {current_student.roll_number} section {current_student.section_id} mismatched session section {session_meta['section_id']}",
            roll_number=current_student.roll_number
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Attendance Rejected: You are not enrolled in class section {session_meta['section_name']}."
        )

    # 5. Check if already marked present (using composite index idx_att_rec_session_student)
    existing_record = db.query(AttendanceRecord).filter(
        AttendanceRecord.session_id == session_id,
        AttendanceRecord.student_id == current_student.id
    ).first()

    if existing_record and existing_record.status == AttendanceStatus.PRESENT:
        return {
            "status": "ALREADY_MARKED",
            "message": "You have already been marked present for this session.",
            "session_id": session_id,
            "subject_name": session_meta["subject_name"],
            "period_name": session_meta["period"],
            "period_count": existing_record.period_count or period_count,
            "session_date": session_meta["session_date"],
            "roll_number": current_student.roll_number,
            "student_name": current_student.name
        }

    # 6. Record or update attendance
    now_utc = datetime.utcnow()
    if existing_record:
        existing_record.status = AttendanceStatus.PRESENT
        existing_record.period_count = period_count
        existing_record.scan_mode = "PROJECTOR_SCAN"
        existing_record.scanned_at = now_utc
    else:
        new_record = AttendanceRecord(
            session_id=session_id,
            student_id=current_student.id,
            roll_number=current_student.roll_number,
            session_date=session_meta["session_date"],
            period_count=period_count,
            status=AttendanceStatus.PRESENT,
            scan_mode="PROJECTOR_SCAN",
            scanned_at=now_utc
        )
        db.add(new_record)

    db.commit()

    # 7. Audit log event
    log_security_audit_event(
        db=db,
        event_type=SecurityEventType.ATTENDANCE_SUBMITTED,
        action="STUDENT_PROJECTOR_SCAN_SUCCESS",
        details=f"Student {current_student.roll_number} scanned teacher projector QR for session {session_id} (Period count: {period_count})",
        roll_number=current_student.roll_number
    )

    # 8. Asynchronous multi-target sync with pre-resolved session_meta (0 DB queries)
    background_tasks.add_task(
        _async_post_scan_tasks,
        roll_number=current_student.roll_number,
        date_formatted=session_meta["session_date"],
        student_name=current_student.name,
        dept_code=current_student.department.code if current_student.department else "",
        year_name=current_student.academic_year.name if current_student.academic_year else "",
        sec_name=session_meta["section_name"],
        sub_name=session_meta["subject_name"],
        period=session_meta["period"],
        teacher_name=session_meta["teacher_name"],
        gs_id=session_meta["teacher_gsheet_id"],
        period_count=period_count
    )

    return {
        "status": "SUCCESS",
        "message": f"Successfully marked present for {period_count} period{'s' if period_count > 1 else ''}!",
        "session_id": session_id,
        "subject_name": session_meta["subject_name"],
        "period_name": session_meta["period"],
        "period_count": period_count,
        "session_date": session_meta["session_date"],
        "roll_number": current_student.roll_number,
        "student_name": current_student.name
    }
