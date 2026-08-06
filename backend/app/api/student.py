from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import Dict, Any, List

from app.core.database import get_db
from app.api.auth import get_current_user
from app.models.models import User, UserRole, Student, AttendanceRecord, AttendanceSession, Subject
from app.services.qr_service import QRService

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
def get_student_qr(current_student: Student = Depends(require_student)):
    qr_base64 = QRService.generate_student_qr_code(
        student_id=current_student.id,
        roll_number=current_student.roll_number,
        student_name=current_student.name,
        as_base64=True
    )
    return {
        "roll_number": current_student.roll_number,
        "name": current_student.name,
        "qr_code_url": qr_base64
    }

@router.get("/attendance-summary")
def get_student_attendance_summary(db: Session = Depends(get_db), current_student: Student = Depends(require_student)):
    records = db.query(AttendanceRecord).filter(AttendanceRecord.student_id == current_student.id).all()
    
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
