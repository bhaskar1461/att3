import os
import logging
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, status
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
    AttendanceRecord, AttendanceStatus, Student, SessionStatus
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

from app.core.security import get_server_ist_date, get_server_ist_datetime
from app.core.device_security import log_security_audit_event, SecurityEventType

@router.get("/current-class")
def get_current_class(db: Session = Depends(get_db), current_teacher: Teacher = Depends(require_teacher)):
    """
    Detects current period and timetable class according to server IST time.
    Provides 1-tap start/resume attendance for faculty.
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
    ]

    detected_period = "Period 1"
    for p_name, start_t, end_t in periods:
        if start_t <= current_time_str <= end_t:
            detected_period = p_name
            break

    assignments = db.query(TeacherAssignment).filter(TeacherAssignment.teacher_id == current_teacher.id).all()
    primary_assignment = assignments[0] if assignments else None

    existing_session = None
    if primary_assignment:
        existing_session = db.query(AttendanceSession).filter(
            AttendanceSession.teacher_id == current_teacher.id,
            AttendanceSession.subject_id == primary_assignment.subject_id,
            AttendanceSession.section_id == primary_assignment.section_id,
            AttendanceSession.session_date == current_date_str
        ).first()

    return {
        "current_time": current_time_str,
        "current_date": current_date_str,
        "detected_period": detected_period,
        "has_assignment": primary_assignment is not None,
        "assignment": {
            "assignment_id": primary_assignment.id,
            "subject_id": primary_assignment.subject_id,
            "subject_name": primary_assignment.subject.name if primary_assignment and primary_assignment.subject else "",
            "subject_code": primary_assignment.subject.code if primary_assignment and primary_assignment.subject else "",
            "section_id": primary_assignment.section_id,
            "section_name": primary_assignment.section.name if primary_assignment and primary_assignment.section else "",
        } if primary_assignment else None,
        "existing_session_id": existing_session.id if existing_session else None,
        "session_status": existing_session.status.value if existing_session else None
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
    p_count = req.period_count or _extract_period_count(req.period)
    period_label = req.period.strip()
    if p_count > 1 and f"({p_count} Period" not in period_label and "periods" not in period_label.lower():
        period_label = f"{period_label} ({p_count} Periods)"

    # Check existing active session for same subject/section/date
    existing = db.query(AttendanceSession).filter(
        AttendanceSession.teacher_id == current_teacher.id,
        AttendanceSession.subject_id == req.subject_id,
        AttendanceSession.section_id == req.section_id,
        AttendanceSession.session_date == date_str,
        AttendanceSession.status == SessionStatus.OPEN
    ).order_by(AttendanceSession.id.desc()).first()

    if existing:
        return {
            "session_id": existing.id,
            "status": existing.status.value,
            "session_date": existing.session_date,
            "period": existing.period,
            "period_count": _extract_period_count(existing.period),
            "message": "Resumed existing attendance session"
        }

    new_session = AttendanceSession(
        teacher_id=current_teacher.id,
        subject_id=req.subject_id,
        section_id=req.section_id,
        period=period_label,
        session_date=date_str,
        status=SessionStatus.OPEN
    )
    db.add(new_session)
    db.commit()
    db.refresh(new_session)

    return {
        "session_id": new_session.id,
        "status": new_session.status.value,
        "session_date": new_session.session_date,
        "period": new_session.period,
        "period_count": p_count,
        "message": f"Started new attendance session for {p_count} period{'s' if p_count > 1 else ''}"
    }

@router.get("/historical-sessions")
def get_historical_sessions(
    date: Optional[str] = None,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(require_teacher)
):
    query = db.query(AttendanceSession).filter(AttendanceSession.teacher_id == current_teacher.id)
    if date:
        query = query.filter(AttendanceSession.session_date == date)
    
    # Eagerly load subject and section in 1 query
    sessions = query.options(
        joinedload(AttendanceSession.subject),
        joinedload(AttendanceSession.section)
    ).order_by(AttendanceSession.created_at.desc()).all()

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
    records = db.query(AttendanceRecord).filter(AttendanceRecord.session_id == session_id).all()
    scanned_rolls = {r.roll_number: r.status.value for r in records}

    students_list = []
    present_count = 0
    absent_count = 0

    for s in total_section_students:
        status_val = scanned_rolls.get(s.roll_number, "ABSENT")
        if status_val in ["PRESENT", "4", "1", "2", "3", "5", "6", "7", "8"]:
            present_count += 1
        else:
            absent_count += 1

        students_list.append({
            "student_id": s.id,
            "roll_number": s.roll_number,
            "name": s.name,
            "status": status_val,
            "is_scanned": s.roll_number in scanned_rolls
        })

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
        "students": students_list
    }

from app.core.security import generate_projector_session_token
from app.services.qr_service import QRService

@router.get("/sessions/{session_id}/broadcast-token")
def get_session_broadcast_token(
    session_id: int,
    period_count: Optional[int] = None,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(require_teacher)
):
    """
    Generates a 10-second rotating QR token for teacher classroom projection,
    along with live student headcount stats and chunky QR image base64.
    """
    session = db.query(AttendanceSession).filter(AttendanceSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Attendance session not found")

    if session.teacher_id != current_teacher.id and current_teacher.user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Not authorized to broadcast this session")

    if session.status != SessionStatus.OPEN:
        raise HTTPException(status_code=400, detail="Cannot broadcast a locked session. Please unlock the session first.")

    p_count = period_count or _extract_period_count(session.period)

    token_info = generate_projector_session_token(
        session_id=session.id,
        period_count=p_count,
        step_window=10
    )

    qr_base64 = QRService.generate_projector_qr_code(token_info["payload"], as_base64=True)

    total_enrolled = db.query(Student).filter(Student.section_id == session.section_id).count()
    records = db.query(AttendanceRecord).filter(AttendanceRecord.session_id == session.id).all()
    total_marked = sum(1 for r in records if r.status.value in ["PRESENT", "4"])
    attendance_pct = round((total_marked / total_enrolled * 100), 1) if total_enrolled > 0 else 0.0

    return {
        "session_id": session.id,
        "qr_payload": token_info["payload"],
        "qr_base64": qr_base64,
        "step": token_info["step"],
        "seconds_remaining": token_info["seconds_remaining"],
        "refresh_interval": 10,
        "period_count": p_count,
        "period_name": session.period,
        "subject_name": session.subject.name if session.subject else "",
        "subject_code": session.subject.code if session.subject else "",
        "section_name": session.section.name if session.section else "",
        "session_date": session.session_date,
        "total_enrolled": total_enrolled,
        "total_marked": total_marked,
        "attendance_pct": attendance_pct
    }

from app.api.attendance import invalidate_session_cache
from app.core.frappe_sync import sync_session_to_frappe
from app.services.gsheets_service import GoogleSheetsService
from app.services.excel_service import ExcelAttendanceService

def _async_full_session_sync(session_id: int, target_sheet_id: Optional[str] = None):
    """
    Defensively executes asynchronous multi-target sync for a locked attendance session:
    1. Institutional Frappe ERP
    2. Google Sheets Attendance Register (atomic single-call batch sync)
    3. Official Master Excel Register
    Any individual target failure is logged without impacting other sync targets or the API response.
    """
    sync_db = SessionLocal()
    try:
        session = sync_db.query(AttendanceSession).filter(AttendanceSession.id == session_id).first()
        if not session:
            return

        date_str = session.session_date
        all_students = sync_db.query(Student).filter(Student.section_id == session.section_id).all()
        all_rolls = [s.roll_number for s in all_students]

        records = sync_db.query(AttendanceRecord).filter(AttendanceRecord.session_id == session_id).all()
        present_rolls = [r.roll_number for r in records if getattr(r.status, "value", str(r.status)) in ["PRESENT", "4"]]

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
                    period_total="4"
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
                    status_val = "4" if r_num in present_rolls else "A"
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

