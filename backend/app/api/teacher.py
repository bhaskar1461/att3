from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

from app.core.database import get_db
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
    date_str = req.date or datetime.now().strftime("%Y-%m-%d")

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
        "message": "Started new attendance session"
    }

@router.get("/sessions/{session_id}")
def get_session_details(session_id: int, db: Session = Depends(get_db), current_teacher: Teacher = Depends(require_teacher)):
    session = db.query(AttendanceSession).filter(AttendanceSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Attendance session not found")

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

@router.post("/sessions/{session_id}/lock")
def lock_session(session_id: int, db: Session = Depends(get_db), current_teacher: Teacher = Depends(require_teacher)):
    session = db.query(AttendanceSession).filter(AttendanceSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    session.status = SessionStatus.LOCKED
    session.locked_at = datetime.utcnow()
    db.commit()
    return {"message": "Attendance session locked successfully"}
