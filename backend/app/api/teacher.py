from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

from app.core.database import get_db, SessionLocal
from app.api.auth import get_current_user
from app.models.models import (
    User, UserRole, Teacher, TeacherAssignment, AttendanceSession, 
    AttendanceRecord, Student, SessionStatus
)

router = APIRouter(prefix="/teacher", tags=["Teacher Mobile Workflow"])

def require_teacher(current_user: User = Depends(get_current_user)) -> Teacher:
    if current_user.role != UserRole.TEACHER or not current_user.teacher_profile:
        raise HTTPException(status_code=403, detail="Teacher permission required")
    return current_user.teacher_profile

class StartSessionRequest(BaseModel):
    subject_id: int
    section_id: int
    period: str
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

    # Check existing active session for same subject/section/period/date
    existing = db.query(AttendanceSession).filter(
        AttendanceSession.teacher_id == current_teacher.id,
        AttendanceSession.subject_id == req.subject_id,
        AttendanceSession.section_id == req.section_id,
        AttendanceSession.period == req.period,
        AttendanceSession.session_date == date_str
    ).first()

    if existing:
        return {
            "session_id": existing.id,
            "status": existing.status.value,
            "session_date": existing.session_date,
            "message": "Resumed existing attendance session"
        }

    new_session = AttendanceSession(
        teacher_id=current_teacher.id,
        subject_id=req.subject_id,
        section_id=req.section_id,
        period=req.period,
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
        "message": "Started new attendance session"
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
    
    sessions = query.order_by(AttendanceSession.created_at.desc()).all()
    res = []
    for s in sessions:
        total_students = db.query(Student).filter(Student.section_id == s.section_id).count()
        records = db.query(AttendanceRecord).filter(AttendanceRecord.session_id == s.id).all()
        present_count = sum(1 for r in records if r.status.value in ["PRESENT", "4"])
        absent_count = max(0, total_students - present_count)

        res.append({
            "session_id": s.id,
            "subject_id": s.subject_id,
            "subject_name": s.subject.name if s.subject else "",
            "subject_code": s.subject.code if s.subject else "",
            "section_id": s.section_id,
            "section_name": s.section.name if s.section else "",
            "period": s.period,
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
    session = db.query(AttendanceSession).filter(AttendanceSession.id == session_id).first()
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
        if status_val in ["PRESENT", "4"]:
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
        "session_date": session.session_date,
        "status": session.status.value,
        "total_students": len(total_section_students),
        "present_count": present_count,
        "absent_count": absent_count,
        "students": students_list
    }

from app.api.attendance import invalidate_session_cache
from app.core.frappe_sync import sync_session_to_frappe

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

    if session.teacher_id != current_teacher.id:
        raise HTTPException(status_code=403, detail="Not authorized to lock this session")
    
    session.status = SessionStatus.LOCKED
    session.locked_at = datetime.utcnow()
    db.commit()
    invalidate_session_cache(session_id)

    log_security_audit_event(
        db=db,
        event_type=SecurityEventType.ATTENDANCE_SUBMITTED,
        action="SESSION_LOCKED",
        details=f"Session {session_id} locked by teacher {current_teacher.name}",
        user_id=current_teacher.user_id
    )

    # Defensively trigger background sync to Frappe ERP
    def _async_frappe_sync():
        sync_db = SessionLocal()
        try:
            sync_session_to_frappe(sync_db, session_id)
        except Exception:
            pass
        finally:
            sync_db.close()

    background_tasks.add_task(_async_frappe_sync)

    return {"message": "Attendance session locked successfully and queued for Frappe ERP sync"}

@router.post("/sessions/{session_id}/unlock")
def unlock_session(session_id: int, db: Session = Depends(get_db), current_teacher: Teacher = Depends(require_teacher)):
    session = db.query(AttendanceSession).filter(AttendanceSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.teacher_id != current_teacher.id:
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

