from fastapi import APIRouter, Depends, HTTPException, Request, status, BackgroundTasks
from sqlalchemy.orm import Session, joinedload
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta
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
        if device:
            if not device.is_active:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Device has been revoked or disabled by system administrator."
                )
            # Layer 2 enforcement on QR code retrieval: student can only fetch QR from bound device
            from app.core.device_security import enforce_student_device_enrollment
            enforce_student_device_enrollment(
                db=db,
                student=current_student,
                device=device,
                ip_address=request.client.host if request.client else None
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
    from app.api.teacher import _extract_period_count

    records = db.query(AttendanceRecord).options(
        joinedload(AttendanceRecord.session).joinedload(AttendanceSession.subject)
    ).filter(AttendanceRecord.student_id == current_student.id).all()
    
    present_records = [
        r for r in records 
        if r.status.value in ["PRESENT", "4", "1", "2", "3", "5", "6", "7", "8"]
    ]
    total_present = sum(r.period_count or 1 for r in present_records)
    
    server_today = get_server_ist_date()
    
    # Query all sessions conducted for this student's section up to today
    section_sessions = db.query(AttendanceSession).filter(
        AttendanceSession.section_id == current_student.section_id,
        AttendanceSession.session_date <= server_today
    ).all()
    
    # Total conducted periods across all section sessions up to today
    total_conducted = sum(_extract_period_count(s.period) for s in section_sessions)
    total_conducted = max(total_conducted, total_present)
    total_absent = max(0, total_conducted - total_present)
    
    overall_percentage = round((total_present / total_conducted * 100), 1) if total_conducted > 0 else 0.0

    # Group by subject
    subject_stats = {}
    for r in records:
        subj_name = r.session.subject.name if r.session and r.session.subject else "General"
        if subj_name not in subject_stats:
            subject_stats[subj_name] = {"conducted": 0, "present": 0}
        p_count = r.period_count or 1
        subject_stats[subj_name]["conducted"] += p_count
        if r.status.value in ["PRESENT", "4", "1", "2", "3", "5", "6", "7", "8"]:
            subject_stats[subj_name]["present"] += p_count

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
        "total_absent": total_absent,
        "overall_percentage": overall_percentage,
        "has_records": total_conducted > 0,
        "subjects": subject_list
    }


@router.get("/today-schedule")
def get_student_today_schedule(
    db: Session = Depends(get_db),
    current_student: Student = Depends(require_student)
):
    """
    Returns today's active schedule and personal attendance confirmation status for student.
    """
    from app.api.teacher import _extract_period_count
    server_today = get_server_ist_date()
    
    # Check if there is an active/open session for student's section
    active_session = db.query(AttendanceSession).filter(
        AttendanceSession.section_id == current_student.section_id,
        AttendanceSession.status == SessionStatus.OPEN
    ).order_by(AttendanceSession.id.desc()).first()

    today_session = active_session or db.query(AttendanceSession).filter(
        AttendanceSession.section_id == current_student.section_id,
        AttendanceSession.session_date == server_today
    ).order_by(AttendanceSession.id.desc()).first()

    # Check student's personal attendance record for today's session
    my_record = None
    if today_session:
        my_record = db.query(AttendanceRecord).filter(
            AttendanceRecord.session_id == today_session.id,
            AttendanceRecord.student_id == current_student.id
        ).first()

    is_marked = my_record is not None and my_record.status.value in [
        "PRESENT", "4", "1", "2", "3", "5", "6", "7", "8"
    ]

    ist_marked_time = None
    if is_marked and my_record and my_record.scanned_at:
        try:
            ist_dt = my_record.scanned_at + timedelta(hours=5, minutes=30)
            ist_marked_time = ist_dt.strftime("%I:%M %p IST")
        except Exception:
            ist_marked_time = "IST Verified"

    active_p_count = _extract_period_count(today_session.period) if today_session else 4

    my_attendance = {
        "is_marked": is_marked,
        "status": "PRESENT" if is_marked else "UNMARKED",
        "period_count": (my_record.period_count if my_record else None) or active_p_count,
        "marked_at": ist_marked_time,
        "session_id": today_session.id if today_session else None,
        "scan_mode": my_record.scan_mode if my_record else None,
        "subject_name": today_session.subject.name if today_session and today_session.subject else "Career Enhancement Training (CET)",
        "teacher_name": today_session.teacher.name if today_session and today_session.teacher else "Mrs. N. Sowjanya"
    }

    schedule_items = [
        {
            "subject_name": "Career Enhancement Training (CET)",
            "subject_code": "CS(CET)",
            "teacher_name": "Mrs. N. Sowjanya",
            "timing": "09:30 AM - 01:00 PM",
            "period": f"{active_p_count} Periods",
            "period_count": active_p_count,
            "room": "CSE-CS Projector Lab",
            "is_live": active_session is not None,
            "is_marked": is_marked,
            "session_id": active_session.id if active_session else None,
            "status": f"Marked Present ({active_p_count} Periods)" if is_marked else ("Live In-Class" if active_session else "Scheduled")
        }
    ]

    return {
        "today_date": server_today,
        "schedule": schedule_items,
        "my_attendance": my_attendance,
        "active_session": {
            "session_id": active_session.id,
            "subject_name": active_session.subject.name if active_session.subject else "Career Enhancement Training (CET)",
            "teacher_name": active_session.teacher.name if active_session.teacher else "Mrs. N. Sowjanya",
            "period": active_session.period or f"{active_p_count} Periods",
            "period_count": active_p_count,
            "room": "CSE-CS Projector Lab",
            "status": "LIVE IN-CLASS",
            "is_marked": is_marked
        } if active_session else {
            "subject_name": "Career Enhancement Training (CET)",
            "teacher_name": "Mrs. N. Sowjanya",
            "period": f"{active_p_count} Periods",
            "period_count": active_p_count,
            "room": "CSE-CS Projector Lab",
            "status": "Scheduled",
            "is_marked": is_marked
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

    # Layer 2: Bi-directional student-to-device enrollment (blocks cross-browser proxy)
    try:
        from app.core.device_security import enforce_student_device_enrollment
        enforce_student_device_enrollment(
            db=db,
            student=current_student,
            device=device,
            ip_address=ip_addr
        )
    except HTTPException:
        raise  # Re-raise the 403 from enrollment enforcement
    except Exception as enrollment_err:
        import logging
        logging.getLogger("snist_erp.student").warning(
            f"Non-fatal enrollment check error for {clean_roll}: {enrollment_err}"
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

    # 7b. Layer 3: Concurrent Scan Telemetry — detect proxy attendance patterns
    #     WHY: If two different students scan the same session from the same IP within 60 seconds,
    #     it's extremely likely one student is scanning for an absent friend on the same phone/network.
    try:
        from sqlalchemy import and_
        concurrent_window_start = now_utc - timedelta(seconds=60)
        concurrent_scans = db.query(AttendanceRecord).filter(
            and_(
                AttendanceRecord.session_id == session_id,
                AttendanceRecord.student_id != current_student.id,
                AttendanceRecord.status == AttendanceStatus.PRESENT,
                AttendanceRecord.scan_mode == "PROJECTOR_SCAN",
                AttendanceRecord.scanned_at >= concurrent_window_start,
                AttendanceRecord.scanned_at <= now_utc
            )
        ).all()

        if concurrent_scans and ip_addr:
            # Check if any of those other scans came from the same device
            for other_scan in concurrent_scans:
                # Query the device binding for this other student around the same time
                other_student_binding = db.query(DeviceAccountBinding).filter(
                    DeviceAccountBinding.roll_number == other_scan.roll_number,
                    DeviceAccountBinding.status == BindingStatus.ACTIVE,
                    DeviceAccountBinding.expires_at > now_utc
                ).first()

                if other_student_binding and other_student_binding.device_id == device.id:
                    # SAME device used by two different students — definitive proxy indicator
                    log_security_audit_event(
                        db=db,
                        event_type=SecurityEventType.SUSPICIOUS_CONCURRENT_SCAN,
                        action="SUSPICIOUS_CONCURRENT_SCAN",
                        details=(
                            f"PROXY ALERT: Students {current_student.roll_number} and {other_scan.roll_number} "
                            f"scanned session {session_id} from SAME device (ID: {device.id}) "
                            f"within 60 seconds. IP: {ip_addr}"
                        ),
                        roll_number=current_student.roll_number,
                        device_id=device.id,
                        ip_address=ip_addr
                    )
    except Exception as concurrent_err:
        import logging
        logging.getLogger("snist_erp.student").warning(
            f"Non-fatal concurrent scan check error: {concurrent_err}"
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
