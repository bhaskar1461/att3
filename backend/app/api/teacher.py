import os
import logging
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, status, Response
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

from app.core.config import settings
from app.core.database import get_db, SessionLocal
from app.api.auth import get_current_user
from app.models.models import (
    User, UserRole, Teacher, TeacherAssignment, AttendanceSession, 
    AttendanceRecord, AttendanceStatus, Student, SessionStatus, DeviceBinding,
    SelfieRecord, ShortTokenRegistry
)

logger = logging.getLogger("snist_erp.teacher")

router = APIRouter(prefix="/teacher", tags=["Teacher Mobile Workflow"])

def require_teacher(current_user: User = Depends(get_current_user)) -> Teacher:
    if current_user.role != UserRole.TEACHER or not current_user.teacher_profile:
        raise HTTPException(status_code=403, detail="Teacher permission required")
    return current_user.teacher_profile

class StartSessionRequest(BaseModel):
    subject_id: int
    section_id: int
    period: str
    period_count: Optional[int] = None
    date: Optional[str] = None # Defaults to YYYY-MM-DD
    display_type: Optional[str] = "projector" # 'projector' | 'phone_screen' | 'laptop'
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    accuracy_m: Optional[float] = None
    geofence_radius_m: Optional[float] = 100.0

from app.core.security import get_server_ist_date, get_server_ist_datetime
from app.core.device_security import log_security_audit_event, SecurityEventType

@router.get("/current-class")
def get_current_class(db: Session = Depends(get_db), current_teacher: Teacher = Depends(require_teacher)):
    """
    Detects current period and timetable class according to server IST time.
    Provides 1-tap start/resume attendance for faculty.
    Server-authoritative: returns detected_period=None when outside class hours or during breaks.
    """
    now_ist = get_server_ist_datetime()
    current_time_str = now_ist.strftime("%H:%M")
    current_date_str = get_server_ist_date()

    periods = [
        ("Period 1", "09:30", "10:20"),
        ("Period 2", "10:20", "11:10"),
        ("Period 3", "11:20", "12:10"),
        ("Period 4", "12:10", "13:00"),
        ("Period 5", "13:40", "14:30"),
        ("Period 6", "14:30", "15:20"),
        ("Period 7", "15:20", "16:10"),
        ("Period 8", "16:10", "17:00"),
    ]

    detected_period = None
    is_class_active = False
    is_break = False
    break_label = None

    # Detect institutional breaks between periods
    if "11:10" < current_time_str < "11:20":
        is_break = True
        break_label = "Morning Short Break (11:10 - 11:20)"
    elif "13:00" < current_time_str < "13:40":
        is_break = True
        break_label = "Lunch Break (13:00 - 13:40)"

    for p_name, start_t, end_t in periods:
        if start_t <= current_time_str <= end_t:
            detected_period = p_name
            is_class_active = True
            break

    assignments = db.query(TeacherAssignment).filter(TeacherAssignment.teacher_id == current_teacher.id).all()
    primary_assignment = assignments[0] if assignments else None

    # Rule 6 & 8: Check for active OPEN session today for this faculty member first
    open_session = db.query(AttendanceSession).filter(
        AttendanceSession.teacher_id == current_teacher.id,
        AttendanceSession.session_date == current_date_str,
        AttendanceSession.status == SessionStatus.OPEN
    ).order_by(AttendanceSession.id.desc()).first()

    existing_session = open_session
    if not existing_session and primary_assignment:
        if detected_period:
            existing_session = db.query(AttendanceSession).filter(
                AttendanceSession.teacher_id == current_teacher.id,
                AttendanceSession.subject_id == primary_assignment.subject_id,
                AttendanceSession.section_id == primary_assignment.section_id,
                AttendanceSession.session_date == current_date_str,
                AttendanceSession.period.like(f"%{detected_period}%")
            ).order_by(AttendanceSession.id.desc()).first()

        if not existing_session:
            existing_session = db.query(AttendanceSession).filter(
                AttendanceSession.teacher_id == current_teacher.id,
                AttendanceSession.subject_id == primary_assignment.subject_id,
                AttendanceSession.section_id == primary_assignment.section_id,
                AttendanceSession.session_date == current_date_str
            ).order_by(AttendanceSession.id.desc()).first()

    active_assignment = None
    if existing_session and existing_session.subject and existing_session.section:
        active_assignment = {
            "assignment_id": primary_assignment.id if primary_assignment else None,
            "subject_id": existing_session.subject_id,
            "subject_name": existing_session.subject.name,
            "subject_code": existing_session.subject.code,
            "section_id": existing_session.section_id,
            "section_name": existing_session.section.name,
        }
    elif primary_assignment:
        active_assignment = {
            "assignment_id": primary_assignment.id,
            "subject_id": primary_assignment.subject_id,
            "subject_name": primary_assignment.subject.name if primary_assignment.subject else "",
            "subject_code": primary_assignment.subject.code if primary_assignment.subject else "",
            "section_id": primary_assignment.section_id,
            "section_name": primary_assignment.section.name if primary_assignment.section else "",
        }

    total_enrolled = 0
    present_count = 0
    if existing_session:
        total_enrolled = db.query(Student).filter(Student.section_id == existing_session.section_id).count()
        records = db.query(AttendanceRecord).filter(AttendanceRecord.session_id == existing_session.id).all()
        present_count = sum(1 for r in records if r.status.value in ["PRESENT", "4"])

    return {
        "current_time": current_time_str,
        "current_date": current_date_str,
        "detected_period": detected_period,
        "is_class_active": is_class_active,
        "is_break": is_break,
        "break_label": break_label,
        "has_assignment": active_assignment is not None,
        "assignment": active_assignment,
        "existing_session_id": existing_session.id if existing_session else None,
        "session_status": existing_session.status.value if existing_session else None,
        "total_enrolled": total_enrolled,
        "present_count": present_count,
    }

@router.get("/sessions/{session_id}/unmarked-students")
def get_unmarked_students(
    session_id: int, 
    db: Session = Depends(get_db), 
    current_teacher: Teacher = Depends(require_teacher)
):
    """
    Returns list of students in the session's section who have not been marked present yet.
    Enables faculty to quickly review and call out absences.
    """
    session = db.query(AttendanceSession).filter(AttendanceSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.teacher_id != current_teacher.id and current_teacher.user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Not authorized to access this session")

    all_students = db.query(Student).filter(Student.section_id == session.section_id).order_by(Student.roll_number.asc()).all()

    marked_records = db.query(AttendanceRecord.student_id).filter(
        AttendanceRecord.session_id == session_id,
        AttendanceRecord.status.in_(["PRESENT", "4"])
    ).all()
    marked_set = {m[0] for m in marked_records}

    unmarked = []
    for s in all_students:
        if s.id not in marked_set:
            unmarked.append({
                "student_id": s.id,
                "roll_number": s.roll_number,
                "name": s.name
            })

    return {
        "session_id": session_id,
        "total_enrolled": len(all_students),
        "total_marked": len(marked_set),
        "total_unmarked": len(unmarked),
        "unmarked_students": unmarked
    }

@router.get("/assigned-classes")
def get_assigned_classes(db: Session = Depends(get_db), current_teacher: Teacher = Depends(require_teacher)):
    assignments = db.query(TeacherAssignment).filter(TeacherAssignment.teacher_id == current_teacher.id).all()
    res = []
    for a in assignments:
        res.append({
            "assignment_id": a.id,
            "subject_id": a.subject_id,
            "subject_code": a.subject.code if a.subject else "",
            "subject_name": a.subject.name if a.subject else "",
            "section_id": a.section_id,
            "section_name": a.section.name if a.section else "",
            "department": a.section.department.code if a.section and a.section.department else "",
            "year": a.section.academic_year.name if a.section and a.section.academic_year else ""
        })
    return res

def _extract_period_count(period_str: str) -> int:
    try:
        if not period_str:
            return 1
        import re
        m = re.search(r'\((\d+)\s*periods?\)', period_str, re.I)
        if m:
            return max(1, min(8, int(m.group(1))))
        if "-" in period_str:
            cleaned = period_str.lower().replace("periods", "").replace("period", "").strip()
            parts = cleaned.split("-")
            if len(parts) >= 2:
                p0 = re.findall(r'\d+', parts[0])
                p1 = re.findall(r'\d+', parts[1])
                if p0 and p1:
                    return max(1, min(8, int(p1[0]) - int(p0[0]) + 1))
        periods_found = re.findall(r'\b(?:Period\s*)?(\d+)\b', period_str, re.I)
        if len(periods_found) > 1:
            return max(1, min(8, len(periods_found)))
        elif len(periods_found) == 1:
            return 1
        digits = [int(s) for s in period_str.split() if s.isdigit()]
        if digits:
            return max(1, min(8, digits[0]))
    except Exception:
        pass
    return 1

@router.post("/sessions/start")
def start_attendance_session(req: StartSessionRequest, db: Session = Depends(get_db), current_teacher: Teacher = Depends(require_teacher)):
    # 1. Authorize: Verify teacher assignment
    assignment = db.query(TeacherAssignment).filter(
        TeacherAssignment.teacher_id == current_teacher.id,
        TeacherAssignment.subject_id == req.subject_id,
        TeacherAssignment.section_id == req.section_id
    ).first()

    if not assignment:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Teacher is not authorized or assigned to this subject and class section."
        )

    date_str = req.date or get_server_ist_date()
    server_today = get_server_ist_date()

    # Rule 24: Prevent creating attendance sessions for future dates
    from datetime import datetime as dt
    try:
        req_d = dt.strptime(date_str, "%Y-%m-%d").date()
        today_d = dt.strptime(server_today, "%Y-%m-%d").date()
        if req_d > today_d:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot create attendance sessions for future dates."
            )
    except ValueError:
        pass

    p_count = max(1, min(8, req.period_count or _extract_period_count(req.period)))
    period_label = req.period.strip()
    if p_count > 1 and f"({p_count} Period" not in period_label and "periods" not in period_label.lower():
        period_label = f"{period_label} ({p_count} Periods)"

    # Rule 8 & 34: Check existing session for same subject/section/date and period to prevent duplicate sessions
    existing = db.query(AttendanceSession).filter(
        AttendanceSession.teacher_id == current_teacher.id,
        AttendanceSession.subject_id == req.subject_id,
        AttendanceSession.section_id == req.section_id,
        AttendanceSession.session_date == date_str,
        AttendanceSession.period == period_label,
        AttendanceSession.status == SessionStatus.OPEN
    ).order_by(AttendanceSession.id.desc()).first()

    if not existing:
        existing = db.query(AttendanceSession).filter(
            AttendanceSession.teacher_id == current_teacher.id,
            AttendanceSession.subject_id == req.subject_id,
            AttendanceSession.section_id == req.section_id,
            AttendanceSession.session_date == date_str,
            AttendanceSession.status == SessionStatus.OPEN
        ).order_by(AttendanceSession.id.desc()).first()

    if existing:
        updated = False
        if req.display_type and existing.display_type != req.display_type:
            existing.display_type = req.display_type
            updated = True
        if req.latitude is not None and existing.faculty_latitude is None:
            existing.faculty_latitude = req.latitude
            existing.faculty_longitude = req.longitude
            existing.faculty_accuracy_m = req.accuracy_m
            existing.geofence_radius_m = req.geofence_radius_m or 100.0
            updated = True
        if updated:
            db.commit()
        return {
            "session_id": existing.id,
            "status": existing.status.value,
            "session_date": existing.session_date,
            "period": existing.period,
            "period_count": _extract_period_count(existing.period),
            "display_type": existing.display_type or "projector",
            "faculty_latitude": existing.faculty_latitude,
            "faculty_longitude": existing.faculty_longitude,
            "geofence_radius_m": existing.geofence_radius_m or 100.0,
            "message": "Resumed existing attendance session"
        }

    # Check if a locked session already exists for this exact class
    existing_locked = db.query(AttendanceSession).filter(
        AttendanceSession.teacher_id == current_teacher.id,
        AttendanceSession.subject_id == req.subject_id,
        AttendanceSession.section_id == req.section_id,
        AttendanceSession.session_date == date_str,
        AttendanceSession.period == period_label,
        AttendanceSession.status == SessionStatus.LOCKED
    ).order_by(AttendanceSession.id.desc()).first()

    if existing_locked:
        return {
            "session_id": existing_locked.id,
            "status": existing_locked.status.value,
            "session_date": existing_locked.session_date,
            "period": existing_locked.period,
            "period_count": _extract_period_count(existing_locked.period),
            "display_type": existing_locked.display_type or "projector",
            "message": "Attendance session already exists and is locked. Please unlock it to edit attendance."
        }

    disp_type = req.display_type if req.display_type in ["projector", "phone_screen", "laptop"] else "projector"
    radius = req.geofence_radius_m if req.geofence_radius_m and req.geofence_radius_m > 0 else 100.0
    new_session = AttendanceSession(
        teacher_id=current_teacher.id,
        subject_id=req.subject_id,
        section_id=req.section_id,
        period=period_label,
        session_date=date_str,
        status=SessionStatus.OPEN,
        display_type=disp_type,
        faculty_latitude=req.latitude,
        faculty_longitude=req.longitude,
        faculty_accuracy_m=req.accuracy_m,
        geofence_radius_m=radius
    )
    db.add(new_session)
    db.commit()
    db.refresh(new_session)

    # Log security audit event for session creation with GPS evidence
    log_security_audit_event(
        db=db,
        event_type=SecurityEventType.ATTENDANCE_SUBMITTED,
        action="SESSION_CREATED",
        details=(
            f"Attendance session #{new_session.id} started for {period_label} by {current_teacher.name}. "
            f"GPS: ({req.latitude}, {req.longitude}, acc={req.accuracy_m}m), Geofence: {radius}m"
        ),
        user_id=current_teacher.user_id
    )

    # Rule 29: Explicit audit log when a historical session is created
    if date_str < server_today:
        log_security_audit_event(
            db=db,
            event_type=SecurityEventType.ATTENDANCE_SUBMITTED,
            action="HISTORICAL_SESSION_CREATED",
            details=f"Historical attendance session #{new_session.id} created for date {date_str}, {period_label} by teacher {current_teacher.name}",
            user_id=current_teacher.user_id
        )

    return {
        "session_id": new_session.id,
        "status": new_session.status.value,
        "session_date": new_session.session_date,
        "period": new_session.period,
        "period_count": p_count,
        "display_type": new_session.display_type,
        "faculty_latitude": new_session.faculty_latitude,
        "faculty_longitude": new_session.faculty_longitude,
        "geofence_radius_m": new_session.geofence_radius_m,
        "message": f"Started new attendance session for {p_count} period{'s' if p_count > 1 else ''}"
    }

@router.get("/historical-sessions")
def get_historical_sessions(
    date: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(require_teacher)
):
    # Week 9 Part D: Bounded pagination to prevent slow load with 50+ sessions
    safe_limit = max(1, min(200, limit))
    safe_offset = max(0, offset)

    query = db.query(AttendanceSession).filter(AttendanceSession.teacher_id == current_teacher.id)
    if date:
        query = query.filter(AttendanceSession.session_date == date)
    
    # Eagerly load subject and section in 1 query with pagination applied
    sessions = query.options(
        joinedload(AttendanceSession.subject),
        joinedload(AttendanceSession.section)
    ).order_by(AttendanceSession.created_at.desc()).offset(safe_offset).limit(safe_limit).all()

    if not sessions:
        return []

    # Batch group aggregations to eliminate 2 queries per session inside loop
    session_ids = [s.id for s in sessions]
    section_ids = list(set(s.section_id for s in sessions))

    # Single query for section total students count across all sections
    total_students_map = dict(
        db.query(Student.section_id, func.count(Student.id))
        .filter(Student.section_id.in_(section_ids))
        .group_by(Student.section_id)
        .all()
    )

    # Single query for present counts across all sessions
    present_counts_map = dict(
        db.query(AttendanceRecord.session_id, func.count(AttendanceRecord.id))
        .filter(
            AttendanceRecord.session_id.in_(session_ids),
            AttendanceRecord.status.in_([AttendanceStatus.PRESENT, "4"])
        )
        .group_by(AttendanceRecord.session_id)
        .all()
    )

    res = []
    for s in sessions:
        total_students = total_students_map.get(s.section_id, 0)
        present_count = present_counts_map.get(s.id, 0)
        absent_count = max(0, total_students - present_count)

        res.append({
            "session_id": s.id,
            "subject_id": s.subject_id,
            "subject_name": s.subject.name if s.subject else "",
            "subject_code": s.subject.code if s.subject else "",
            "section_id": s.section_id,
            "section_name": s.section.name if s.section else "",
            "period": s.period,
            "period_count": _extract_period_count(s.period),
            "session_date": s.session_date,
            "status": s.status.value,
            "total_students": total_students,
            "present_count": present_count,
            "absent_count": absent_count,
            "created_at": s.created_at.isoformat() if s.created_at else ""
        })
    return res

@router.get("/sessions/{session_id}")
def get_session_details(session_id: int, db: Session = Depends(get_db), current_teacher: Teacher = Depends(require_teacher)):
    # Eagerly load subject and section
    session = db.query(AttendanceSession).options(
        joinedload(AttendanceSession.subject),
        joinedload(AttendanceSession.section)
    ).filter(AttendanceSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Attendance session not found")

    if session.teacher_id != current_teacher.id:
        raise HTTPException(status_code=403, detail="You are not authorized to view this session")

    total_section_students = db.query(Student).filter(Student.section_id == session.section_id).all()
    student_ids = [s.id for s in total_section_students]
    active_bindings = db.query(DeviceBinding.student_id).filter(
        DeviceBinding.student_id.in_(student_ids),
        DeviceBinding.revoked_at.is_(None)
    ).all() if student_ids else []
    bound_student_ids = {b[0] for b in active_bindings}
    unbound_students_count = sum(1 for s in total_section_students if s.id not in bound_student_ids)
    unbound_straggler_alert = (unbound_students_count >= 1)

    records = db.query(AttendanceRecord).filter(AttendanceRecord.session_id == session_id).order_by(AttendanceRecord.id.desc()).all()
    scanned_rolls = {}
    manual_records_map = {}
    manual_count = 0
    for r in records:
        if r.roll_number not in scanned_rolls:
            scanned_rolls[r.roll_number] = r.status.value
            is_manual = (getattr(r, "scan_mode", None) == "MANUAL" or getattr(r, "manual_reason", None) is not None)
            manual_records_map[r.roll_number] = {
                "is_manual": is_manual,
                "manual_reason": getattr(r, "manual_reason", None)
            }
            if is_manual and r.status.value in ["PRESENT", "4", "1", "2", "3", "5", "6", "7", "8"]:
                manual_count += 1

    students_list = []
    present_count = 0
    absent_count = 0

    for s in total_section_students:
        status_val = scanned_rolls.get(s.roll_number, "ABSENT")
        rec_meta = manual_records_map.get(s.roll_number, {"is_manual": False, "manual_reason": None})
        if status_val in ["PRESENT", "4", "1", "2", "3", "5", "6", "7", "8"]:
            present_count += 1
        else:
            absent_count += 1

        students_list.append({
            "student_id": s.id,
            "roll_number": s.roll_number,
            "name": s.name,
            "status": status_val,
            "binding_status": "enrolled" if s.id in bound_student_ids else "unbound",
            "is_scanned": s.roll_number in scanned_rolls,
            "is_manual": rec_meta["is_manual"],
            "manual_reason": rec_meta["manual_reason"]
        })

    from app.core.config import settings
    manual_pct = round((manual_count / present_count * 100), 1) if present_count > 0 else 0.0
    anomaly_status = "NORMAL"
    if manual_pct >= settings.MANUAL_MARK_RED_THRESHOLD_PCT:
        anomaly_status = "RED"
    elif manual_pct >= settings.MANUAL_MARK_AMBER_THRESHOLD_PCT:
        anomaly_status = "AMBER"

    return {
        "session_id": session.id,
        "subject_name": session.subject.name if session.subject else "",
        "section_name": session.section.name if session.section else "",
        "period": session.period,
        "period_count": _extract_period_count(session.period),
        "session_date": session.session_date,
        "status": session.status.value,
        "total_students": len(total_section_students),
        "present_count": present_count,
        "absent_count": absent_count,
        "unbound_students_count": unbound_students_count,
        "unbound_straggler_alert": unbound_straggler_alert,
        "manual_count": manual_count,
        "manual_pct": manual_pct,
        "anomaly_status": anomaly_status,
        "students": students_list
    }

from app.core.security import generate_projector_session_token
from app.services.qr_token import ShortTokenService
from app.services.qr_service import QRService

@router.get("/sessions/{session_id}/broadcast-token")
def get_session_broadcast_token(
    session_id: int,
    period_count: Optional[int] = None,
    dark_mode: bool = False,
    response: Response = None,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(require_teacher)
):
    """
    Generates a 10-second rotating QR token for teacher classroom projection,
    along with live student headcount stats and chunky QR image base64.
    """
    if response:
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
    session = db.query(AttendanceSession).filter(AttendanceSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Attendance session not found")

    if session.teacher_id != current_teacher.id and current_teacher.user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Not authorized to broadcast this session")

    if session.status != SessionStatus.OPEN:
        raise HTTPException(status_code=400, detail="Cannot broadcast a locked session. Please unlock the session first.")

    p_count = max(1, min(8, period_count or _extract_period_count(session.period)))

    from app.services.qr_token import get_effective_qr_format, get_effective_render_version
    active_format, format_reason = get_effective_qr_format(
        db=db,
        session_id=session.id,
        section_id=session.section_id,
        dept_code=session.section.department.code if session.section and session.section.department else None
    )

    active_render_v, render_reason = get_effective_render_version(
        db=db,
        session_id=session.id,
        section_id=session.section_id,
        dept_code=session.section.department.code if session.section and session.section.department else None
    )

    short_info = ShortTokenService.issue_or_get_short_code(
        db=db,
        session_id=session.id,
        period_count=p_count,
        step_window=10
    )

    legacy_info = generate_projector_session_token(
        session_id=session.id,
        period_count=p_count,
        step_window=10
    )

    from app.services.launch_token import generate_launch_token
    from app.core.config import settings

    launch_token = generate_launch_token(
        session_id=session.id,
        short_code=short_info["short_code"],
        v=short_info["v"],
        step_window=10
    )

    # Determine canonical HTTPS base URL
    attendance_base = getattr(settings, "ATTENDANCE_BASE_URL", "").strip().rstrip("/")
    if attendance_base:
        base_url = attendance_base
    else:
        base_url = settings.public_frontend_url.strip().rstrip("/")
    if not base_url.startswith("http://") and not base_url.startswith("https://"):
        base_url = f"https://{base_url}"
    launch_url = f"{base_url}/a/{launch_token}"

    if active_format == "legacy":
        chosen_payload = legacy_info["payload"]
        chosen_step = legacy_info.get("step")
        chosen_seconds = legacy_info.get("seconds_remaining", 10)
    else:
        chosen_payload = launch_url
        chosen_step = short_info["v"]
        chosen_seconds = short_info["seconds_remaining"]

    qr_base64 = QRService.generate_projector_qr_code(
        chosen_payload,
        as_base64=True,
        render_version=active_render_v,
        dark_mode=dark_mode
    )

    total_enrolled = db.query(Student).filter(Student.section_id == session.section_id).count()
    records = db.query(AttendanceRecord).filter(AttendanceRecord.session_id == session.id).all()
    total_marked = sum(1 for r in records if r.status.value in ["PRESENT", "4"])
    manual_count = sum(1 for r in records if (getattr(r, "scan_mode", None) == "MANUAL" or getattr(r, "manual_reason", None) is not None) and r.status.value in ["PRESENT", "4"])
    manual_pct = round((manual_count / total_marked * 100), 1) if total_marked > 0 else 0.0
    attendance_pct = round((total_marked / total_enrolled * 100), 1) if total_enrolled > 0 else 0.0

    # Phase 5: Live unbound student alert for faculty projector view
    section_student_ids = [s[0] for s in db.query(Student.id).filter(Student.section_id == session.section_id).all()]
    active_bound_count = db.query(func.count(func.distinct(DeviceBinding.student_id))).filter(
        DeviceBinding.student_id.in_(section_student_ids),
        DeviceBinding.revoked_at.is_(None)
    ).scalar() or 0 if section_student_ids else 0
    unbound_students_count = max(0, total_enrolled - active_bound_count)
    unbound_straggler_alert = (unbound_students_count >= 1)

    anomaly_status = "NORMAL"
    if manual_pct >= settings.MANUAL_MARK_RED_THRESHOLD_PCT:
        anomaly_status = "RED"
    elif manual_pct >= settings.MANUAL_MARK_AMBER_THRESHOLD_PCT:
        anomaly_status = "AMBER"

    import time
    import math
    server_now = time.time()
    step_expires_at = float((chosen_step + 1) * 10)
    int_seconds_remaining = max(1, int(math.ceil(step_expires_at - server_now)))
    precise_seconds_remaining = max(0.1, round(step_expires_at - server_now, 2))

    return {
        "session_id": session.id,
        "format": active_format,
        "format_reason": format_reason,
        "render_version": active_render_v,
        "render_reason": render_reason,
        "qr_payload": chosen_payload,
        "launch_url": launch_url,
        "launch_token": launch_token,
        "legacy_payload": legacy_info["payload"],
        "short_payload": short_info["payload"],
        "short_code": short_info["short_code"],
        "qr_base64": qr_base64,
        "step": chosen_step,
        "seconds_remaining": int_seconds_remaining,
        "precise_seconds_remaining": precise_seconds_remaining,
        "server_now": server_now,
        "serverNow": server_now,
        "expires_at": step_expires_at,
        "expiresAt": step_expires_at,
        "refresh_interval": 10,
        "period_count": p_count,
        "period_name": session.period,
        "subject_name": session.subject.name if session.subject else "",
        "subject_code": session.subject.code if session.subject else "",
        "section_name": session.section.name if session.section else "",
        "session_date": session.session_date,
        "display_type": session.display_type or "projector",
        "total_enrolled": total_enrolled,
        "total_marked": total_marked,
        "unbound_students_count": unbound_students_count,
        "unbound_straggler_alert": unbound_straggler_alert,
        "manual_count": manual_count,
        "manual_pct": manual_pct,
        "anomaly_status": anomaly_status,
        "attendance_pct": attendance_pct
    }

from app.api.attendance import invalidate_session_cache
from app.core.frappe_sync import sync_session_to_frappe
from app.services.gsheets_service import GoogleSheetsService
from app.services.excel_service import ExcelAttendanceService

import threading

_active_sync_locks = set()
_sync_lock_mutex = threading.Lock()

def _async_full_session_sync(session_id: int, target_sheet_id: Optional[str] = None):
    """
    Defensively executes asynchronous multi-target sync for a locked attendance session:
    1. Institutional Frappe ERP
    2. Google Sheets Attendance Register (atomic single-call batch sync)
    3. Official Master Excel Register
    Deduplicated with _active_sync_locks to prevent worker pool starvation from duplicate sync clicks.
    """
    with _sync_lock_mutex:
        if session_id in _active_sync_locks:
            logger.info(f"[Sync Debounce] Sync already running for session {session_id}. Skipping duplicate job.")
            return
        _active_sync_locks.add(session_id)

    sync_db = SessionLocal()
    try:
        session = sync_db.query(AttendanceSession).filter(AttendanceSession.id == session_id).first()
        if not session:
            return

        date_str = session.session_date
        all_students = sync_db.query(Student).filter(Student.section_id == session.section_id).all()
        all_rolls = [s.roll_number for s in all_students]

        session_p_count = max(1, min(8, _extract_period_count(session.period)))

        records = sync_db.query(AttendanceRecord).filter(AttendanceRecord.session_id == session_id).all()
        present_rolls = [
            r.roll_number for r in records
            if getattr(r.status, "value", str(r.status)).upper() in ["PRESENT", "1", "2", "3", "4", "5", "6", "7", "8"]
        ]

        # 1. Sync to Frappe ERP
        try:
            sync_session_to_frappe(sync_db, session_id)
        except Exception as f_err:
            logger.warning(f"[Frappe Sync Warning] Session {session_id} Frappe sync failed: {f_err}")

        # 2. Sync to Google Sheets (if sheet ID is configured)
        if target_sheet_id:
            try:
                creds_file = settings.GOOGLE_CREDENTIALS_FILE or os.path.join(settings.BACKEND_DIR, "credentials.json")
                GoogleSheetsService.sync_session_to_gsheet(
                    credentials_json=creds_file,
                    spreadsheet_id=target_sheet_id,
                    date_str=date_str,
                    present_rolls=present_rolls,
                    all_section_rolls=all_rolls,
                    period_total=str(session_p_count)
                )
            except Exception as gs_err:
                logger.warning(f"[Google Sheets Sync Warning] Session {session_id} GSheets sync failed: {gs_err}")

        # 3. Sync to Official Master Excel Register
        try:
            master_excel = os.path.join(settings.MASTER_TEMPLATE_DIR, "Official_Attendance_Register.xlsx")
            if os.path.exists(master_excel):
                from datetime import datetime as dt
                try:
                    d_obj = dt.strptime(date_str, "%Y-%m-%d")
                    d_formatted = d_obj.strftime("%d/%m/%Y")
                except Exception:
                    d_formatted = date_str

                for r_num in all_rolls:
                    status_val = str(session_p_count) if r_num in present_rolls else "A"
                    ExcelAttendanceService.record_attendance_in_excel(
                        file_path=master_excel,
                        roll_number=r_num,
                        date_str=d_formatted,
                        status_code=status_val,
                        overwrite=True
                    )
        except Exception as ex_err:
            logger.warning(f"[Excel Sync Warning] Session {session_id} Excel sync failed: {ex_err}")

    except Exception as general_err:
        logger.error(f"[Async Full Session Sync Error] Session {session_id}: {general_err}", exc_info=True)
    finally:
        with _sync_lock_mutex:
            _active_sync_locks.discard(session_id)
        sync_db.close()

@router.post("/sessions/{session_id}/lock")
def lock_session(
    session_id: int, 
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db), 
    current_teacher: Teacher = Depends(require_teacher)
):
    session = db.query(AttendanceSession).filter(AttendanceSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.teacher_id != current_teacher.id and current_teacher.user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Not authorized to lock this session")
    
    session.status = SessionStatus.LOCKED
    session.locked_at = datetime.utcnow()
    db.commit()
    invalidate_session_cache(session_id)
    ShortTokenService.purge_session_tokens(db=db, session_id=session_id)

    # Determine Google Sheet ID for this teacher
    teacher_sheet_id = (current_teacher.google_sheet_id or "").strip()
    if not teacher_sheet_id:
        from app.models.models import SystemSettings
        setting = db.query(SystemSettings).filter(SystemSettings.key == "GOOGLE_SPREADSHEET_ID").first()
        teacher_sheet_id = (setting.value.strip() if (setting and setting.value) else getattr(settings, "GOOGLE_SPREADSHEET_ID", "")).strip()

    has_google_sheet = bool(teacher_sheet_id)
    warning_msg = None

    if not has_google_sheet:
        warning_msg = "No Google Sheet linked for this faculty. Attendance is safely stored in the institutional database and ready for sync once a Google Sheet URL is linked."
        log_security_audit_event(
            db=db,
            event_type=SecurityEventType.ATTENDANCE_SUBMITTED,
            action="SESSION_LOCKED_WITHOUT_SHEET",
            details=f"Session {session_id} locked by {current_teacher.name}. Attendance saved in DB; Google Sheet pending configuration.",
            user_id=current_teacher.user_id
        )
    else:
        log_security_audit_event(
            db=db,
            event_type=SecurityEventType.ATTENDANCE_SUBMITTED,
            action="SESSION_LOCKED",
            details=f"Session {session_id} locked by {current_teacher.name}. Full background sync queued.",
            user_id=current_teacher.user_id
        )

    # Always dispatch non-blocking background sync (Frappe + Excel, plus Sheets if configured)
    background_tasks.add_task(_async_full_session_sync, session_id, teacher_sheet_id if has_google_sheet else None)

    return {
        "status": "SUCCESS",
        "message": "Attendance session locked successfully and attendance records committed to institutional database.",
        "has_google_sheet": has_google_sheet,
        "warning": warning_msg
    }

@router.post("/sessions/{session_id}/sync-sheet")
def trigger_session_sheet_sync(
    session_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(require_teacher)
):
    """
    Manually triggers or re-triggers Google Sheet and external register sync for a locked session.
    Enables faculty to sync past sessions immediately after linking their Google Sheet URL.
    """
    session = db.query(AttendanceSession).filter(AttendanceSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.teacher_id != current_teacher.id and current_teacher.user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Not authorized to sync this session")

    teacher_sheet_id = (current_teacher.google_sheet_id or "").strip()
    if not teacher_sheet_id:
        from app.models.models import SystemSettings
        setting = db.query(SystemSettings).filter(SystemSettings.key == "GOOGLE_SPREADSHEET_ID").first()
        teacher_sheet_id = (setting.value.strip() if (setting and setting.value) else getattr(settings, "GOOGLE_SPREADSHEET_ID", "")).strip()

    if not teacher_sheet_id:
        raise HTTPException(
            status_code=400,
            detail="No Google Sheet URL is linked yet. Please update your Google Sheet URL in Settings first."
        )

    background_tasks.add_task(_async_full_session_sync, session_id, teacher_sheet_id)
    return {
        "status": "SUCCESS",
        "message": f"Sync queued successfully for Session {session_id} to Google Sheet."
    }

@router.post("/sessions/{session_id}/unlock")
def unlock_session(session_id: int, db: Session = Depends(get_db), current_teacher: Teacher = Depends(require_teacher)):
    session = db.query(AttendanceSession).filter(AttendanceSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.teacher_id != current_teacher.id and current_teacher.user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Not authorized to unlock this session")
    
    session.status = SessionStatus.OPEN
    session.locked_at = None
    db.commit()
    invalidate_session_cache(session_id)

    log_security_audit_event(
        db=db,
        event_type=SecurityEventType.ATTENDANCE_SUBMITTED,
        action="SESSION_UNLOCKED",
        details=f"Session {session_id} unlocked for historical editing by teacher {current_teacher.name}",
        user_id=current_teacher.user_id
    )

    return {"message": "Attendance session unlocked successfully for historical editing"}

class UpdateSessionPeriodRequest(BaseModel):
    period: str
    period_count: Optional[int] = None

@router.put("/sessions/{session_id}/period")
def update_session_period(
    session_id: int,
    req: UpdateSessionPeriodRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(require_teacher)
):
    """
    Updates the period and period count for an attendance session,
    automatically cascading the new period_count to all present student records.
    """
    session = db.query(AttendanceSession).filter(AttendanceSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.teacher_id != current_teacher.id and current_teacher.user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Not authorized to update this session")

    p_count = max(1, min(8, req.period_count or _extract_period_count(req.period)))
    period_label = req.period.strip()
    if p_count > 1 and f"({p_count} Period" not in period_label and "periods" not in period_label.lower():
        period_label = f"{period_label} ({p_count} Periods)"

    old_period = session.period
    session.period = period_label

    records = db.query(AttendanceRecord).filter(
        AttendanceRecord.session_id == session_id,
        AttendanceRecord.status == AttendanceStatus.PRESENT
    ).all()
    for r in records:
        r.period_count = p_count

    db.commit()
    invalidate_session_cache(session_id)

    log_security_audit_event(
        db=db,
        event_type=SecurityEventType.ATTENDANCE_SUBMITTED,
        action="SESSION_PERIOD_UPDATED",
        details=f"Session {session_id} period updated from '{old_period}' to '{period_label}' ({p_count} periods) by {current_teacher.name}. Updated {len(records)} present records.",
        user_id=current_teacher.user_id
    )

    if session.status == SessionStatus.LOCKED:
        teacher_sheet_id = (current_teacher.google_sheet_id or "").strip()
        if teacher_sheet_id:
            background_tasks.add_task(_async_full_session_sync, session_id, teacher_sheet_id)

    return {
        "session_id": session.id,
        "period": session.period,
        "period_count": p_count,
        "updated_records_count": len(records),
        "message": f"Session period updated to '{period_label}' and {len(records)} student records updated to {p_count} periods credit."
    }

@router.delete("/sessions/{session_id}")
def delete_session(
    session_id: int,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(require_teacher)
):
    """
    Deletes an attendance session and all associated attendance records, selfies, and tokens.
    Authoritative: only the session owner or a Super Admin may execute deletion.
    """
    session = db.query(AttendanceSession).filter(AttendanceSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.teacher_id != current_teacher.id and current_teacher.user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Not authorized to delete this session")

    subject_name = session.subject.name if session.subject else f"Subject #{session.subject_id}"
    section_name = session.section.name if session.section else f"Section #{session.section_id}"
    session_date = session.session_date
    period_label = session.period

    # Count records being deleted
    record_count = db.query(AttendanceRecord).filter(AttendanceRecord.session_id == session_id).count()

    # 1. Clean up selfies
    try:
        db.query(SelfieRecord).filter(SelfieRecord.session_id == session_id).delete(synchronize_session=False)
    except Exception as s_err:
        logger.warning(f"Notice: Selfie cleanup skipped or failed for session {session_id}: {s_err}")

    # 2. Clean up short tokens
    try:
        db.query(ShortTokenRegistry).filter(ShortTokenRegistry.session_id == session_id).delete(synchronize_session=False)
    except Exception as t_err:
        logger.warning(f"Notice: ShortToken cleanup skipped or failed for session {session_id}: {t_err}")

    # 3. Clean up attendance records
    db.query(AttendanceRecord).filter(AttendanceRecord.session_id == session_id).delete(synchronize_session=False)

    # 4. Delete the session
    db.delete(session)
    db.commit()

    # 5. Invalidate cache
    invalidate_session_cache(session_id)

    # 6. Audit logging
    log_security_audit_event(
        db=db,
        event_type=SecurityEventType.ATTENDANCE_SUBMITTED,
        action="SESSION_DELETED",
        details=f"Session {session_id} ({subject_name} - {section_name} - {period_label} on {session_date}) deleted by teacher {current_teacher.name}. Removed {record_count} attendance records.",
        user_id=current_teacher.user_id
    )

    return {
        "status": "SUCCESS",
        "session_id": session_id,
        "deleted_records_count": record_count,
        "message": f"Session {session_id} ({subject_name}, {period_label}) and its {record_count} attendance records were deleted successfully."
    }

class TeacherSettingsRequest(BaseModel):
    google_sheet_id: str

def extract_spreadsheet_id(input_str: str) -> str:
    if not input_str:
        return ""
    s = input_str.strip()
    if "/d/" in s:
        parts = s.split("/d/")
        if len(parts) > 1:
            return parts[1].split("/")[0]
    return s

@router.get("/profile")
def get_teacher_profile(db: Session = Depends(get_db), current_teacher: Teacher = Depends(require_teacher)):
    sp_id = current_teacher.google_sheet_id or ""
    sp_url = f"https://docs.google.com/spreadsheets/d/{sp_id}/edit" if sp_id else ""
    return {
        "id": current_teacher.id,
        "teacher_code": current_teacher.teacher_code,
        "name": current_teacher.name,
        "department": current_teacher.department.name if current_teacher.department else "",
        "mobile": current_teacher.mobile or "",
        "google_sheet_id": sp_id,
        "google_sheet_url": sp_url
    }

@router.put("/settings")
def update_teacher_settings(req: TeacherSettingsRequest, db: Session = Depends(get_db), current_teacher: Teacher = Depends(require_teacher)):
    sp_id = extract_spreadsheet_id(req.google_sheet_id)
    current_teacher.google_sheet_id = sp_id
    db.commit()
    sp_url = f"https://docs.google.com/spreadsheets/d/{sp_id}/edit" if sp_id else ""
    return {
        "message": "Teacher Google Sheet configuration updated successfully",
        "google_sheet_id": sp_id,
        "google_sheet_url": sp_url
    }

class SyncSheetRosterRequest(BaseModel):
    google_sheet_id: Optional[str] = None
    section_id: Optional[int] = None

@router.post("/sync-roster-from-sheet")
def sync_roster_from_sheet(
    req: SyncSheetRosterRequest,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(require_teacher)
):
    """
    Reads student records (Roll No in Col B, Name in Col C) directly from the Google Sheet
    and syncs them into the designated section in the database.
    """
    import os
    from app.services.gsheets_service import GoogleSheetsService
    from app.core.config import settings
    from app.models.models import Section, Student, User, UserRole
    from app.core.security import get_password_hash

    target_sheet_id = extract_spreadsheet_id(req.google_sheet_id or "") or current_teacher.google_sheet_id
    if not target_sheet_id:
        raise HTTPException(status_code=400, detail="Google Sheet ID or URL required")

    target_section_id = req.section_id
    if not target_section_id:
        assignment = db.query(TeacherAssignment).filter(TeacherAssignment.teacher_id == current_teacher.id).first()
        if assignment:
            target_section_id = assignment.section_id

    if not target_section_id:
        raise HTTPException(status_code=400, detail="No section specified or assigned to sync roster into")

    section = db.query(Section).filter(Section.id == target_section_id).first()
    if not section:
        raise HTTPException(status_code=404, detail="Section not found")

    creds_file = settings.GOOGLE_CREDENTIALS_FILE or os.path.join(settings.BACKEND_DIR, "credentials.json")
    try:
        client = GoogleSheetsService._get_client(creds_file)
        spreadsheet = client.open_by_key(target_sheet_id)
        try:
            worksheet = spreadsheet.worksheet("Attendance Register")
        except Exception:
            worksheet = spreadsheet.sheet1

        vals = worksheet.get_all_values()
        if len(vals) < 7:
            raise HTTPException(status_code=400, detail="Sheet has no student rows (expected students starting row 7)")

        synced_count = 0

        for r_idx in range(6, len(vals)):
            row = vals[r_idx]
            if len(row) < 2:
                continue
            roll = str(row[1]).strip().upper()
            if not roll or roll in ["ROLL NO", "ROLL NUMBER", "SNO", "TOTAL", "S.NO"]:
                continue
            name = str(row[2]).strip() if len(row) > 2 and row[2] else f"Student {roll}"
            agency = str(row[3]).strip() if len(row) > 3 and row[3] else "Regular"

            existing = db.query(Student).filter(Student.roll_number == roll).first()
            if existing:
                existing.section_id = section.id
                existing.name = name
                existing.agency = agency
                synced_count += 1
            else:
                user = db.query(User).filter(User.username == roll).first()
                if not user:
                    user = User(
                        username=roll,
                        email=f"{roll.lower()}@snist.edu.in",
                        password_hash=get_password_hash("student123"),
                        role=UserRole.STUDENT
                    )
                    db.add(user)
                    db.flush()
                st = Student(
                    user_id=user.id,
                    roll_number=roll,
                    name=name,
                    department_id=section.department_id,
                    academic_year_id=section.academic_year_id,
                    section_id=section.id,
                    email=f"{roll.lower()}@snist.edu.in",
                    agency=agency
                )
                db.add(st)
                synced_count += 1

        db.commit()
        return {
            "status": "SUCCESS",
            "message": f"Successfully synchronized {synced_count} students into {section.name} from Google Sheet!",
            "synced_count": synced_count,
            "section_name": section.name
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to sync roster from Google Sheet: {str(e)}")

