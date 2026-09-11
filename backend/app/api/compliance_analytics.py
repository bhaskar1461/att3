"""
JNTUH R25 Attendance Compliance & Analytics API Endpoints
SNIST AI QR Attendance & Academic System

Role-Gated & Audited Routes:
1. GET /api/v1/admin/analytics/attendance-summary (SUPER_ADMIN)
2. GET /api/v1/analytics/student/{roll}/attendance (Student self-view, Teacher, Admin)
3. GET /api/v1/faculty/analytics/course/{course_id} (Faculty own courses, Admin)
4. GET /api/v1/hod/analytics/department/{dept} (HOD own dept, Admin)
5. PUT /api/v1/admin/compliance/student/{student_id}/condonation (Admin fine management)
6. POST /api/v1/admin/compliance/attendance-record/{record_id}/approved-absence (Admin/Teacher approval)
"""

import logging
from typing import Optional, Dict, Any, List
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field

from app.core.database import get_db
from app.api.auth import get_current_user, require_admin, require_teacher
from app.models.models import (
    User, UserRole, Student, Teacher, Subject, TeacherAssignment,
    AttendanceRecord, StudentCondonation, SecurityEventType
)
from app.core.device_security import log_security_audit_event
from app.services.attendance_engine import (
    AttendanceEngine, invalidate_attendance_cache
)

logger = logging.getLogger("snist_erp.compliance_api")

router = APIRouter(tags=["Compliance Analytics"])

# Pydantic Request Models
class CondonationUpdateRequest(BaseModel):
    status: str = Field(..., description="Condonation status: pending, approved, paid, waived, rejected")
    course_id: Optional[int] = Field(None, description="Course ID or None for aggregate semester condonation")
    academic_year_id: Optional[int] = None
    fine_amount: float = Field(0.0, ge=0.0)
    remarks: Optional[str] = None

class ApprovedAbsenceUpdateRequest(BaseModel):
    is_approved_absence: bool = True
    reason: str = Field("MEDICAL", description="Absence reason: MEDICAL, SPORTS, OFFICIAL_DUTY, OTHER")


# ==============================================================================
# 1. ADMIN ANALYTICS: ATTENDANCE SUMMARY ACROSS ALL DEPARTMENTS
# ==============================================================================
@router.get("/admin/analytics/attendance-summary")
def get_admin_attendance_summary(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """
    Super Admin endpoint: Per-department aggregate eligible/condonable/detained counts.
    Includes Unassigned-department bucket if any unassigned students exist.
    """
    summary = AttendanceEngine.get_department_compliance_summary(db=db)
    
    # Audit log access
    log_security_audit_event(
        db=db,
        event_type=SecurityEventType.PWA_TELEMETRY,
        action="ADMIN_COMPLIANCE_SUMMARY_VIEW",
        details=f"Admin {current_user.username} viewed full institutional compliance summary",
        user_id=current_user.id
    )
    
    return summary


# ==============================================================================
# 2. STUDENT ANALYTICS: STUDENT ATTENDANCE & JNTUH BANDS
# ==============================================================================
@router.get("/analytics/student/{roll}/attendance")
@router.get("/compliance/student/{roll}")
def get_student_attendance_compliance(
    roll: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Student self-view endpoint: Students can see their own % and bands.
    Role-gated: Student cannot view another student's attendance.
    Super Admins and Teachers can view any student.
    Every response includes underlying session count + present count for complete auditability.
    """
    normalized_roll = roll.strip().upper()

    # Role scoping check
    if current_user.role == UserRole.STUDENT:
        user_roll = (current_user.username or "").strip().upper()
        student_profile_roll = (
            current_user.student_profile.roll_number.strip().upper()
            if current_user.student_profile else ""
        )
        if normalized_roll != user_roll and normalized_roll != student_profile_roll:
            logger.warning(
                f"[SECURITY ALERT] Student {current_user.username} attempted unauthorized access to {normalized_roll}'s attendance"
            )
            log_security_audit_event(
                db=db,
                event_type="PRIVESC_ATTEMPT",
                action="UNAUTHORIZED_STUDENT_ATTENDANCE_LOOKUP",
                details=f"Student {current_user.username} blocked from fetching {normalized_roll}'s compliance profile",
                user_id=current_user.id,
                roll_number=current_user.username
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied: You are only authorized to view your own attendance records."
            )
    elif current_user.role == UserRole.TEACHER:
        teacher_prof = current_user.teacher_profile
        target_student = db.query(Student).filter(Student.roll_number == normalized_roll).first()
        if target_student and teacher_prof:
            is_same_dept = (teacher_prof.department_id is not None and target_student.department_id == teacher_prof.department_id)
            is_assigned_section = False
            if target_student.section_id:
                from app.models.models import TeacherAssignment
                is_assigned_section = db.query(TeacherAssignment).filter(
                    TeacherAssignment.teacher_id == teacher_prof.id,
                    TeacherAssignment.section_id == target_student.section_id
                ).first() is not None

            if not is_same_dept and not is_assigned_section:
                logger.warning(
                    f"[SECURITY ALERT] Teacher {current_user.username} attempted unauthorized lookup for student {normalized_roll}"
                )
                log_security_audit_event(
                    db=db,
                    event_type="PRIVESC_ATTEMPT",
                    action="UNAUTHORIZED_TEACHER_STUDENT_COMPLIANCE_LOOKUP",
                    details=f"Teacher {current_user.username} blocked from fetching {normalized_roll} (cross-department / unassigned)",
                    user_id=current_user.id
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access denied: You are only authorized to view students in your department or assigned courses."
                )

    compliance_data = AttendanceEngine.get_student_full_compliance(db=db, roll_number=normalized_roll)
    if "error" in compliance_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=compliance_data["error"]
        )

    return compliance_data


# ==============================================================================
# 3. FACULTY ANALYTICS: COURSE-LEVEL ATTENDANCE
# ==============================================================================
@router.get("/faculty/analytics/course/{course_id}")
def get_faculty_course_compliance(
    course_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher)
):
    """
    Faculty endpoint: Attendance metrics for a specific course.
    Role-gated: Faculty can only view their own courses (assigned via TeacherAssignment).
    Super Admins can view any course.
    """
    course = db.query(Subject).filter(Subject.id == course_id).first()
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")

    teacher_id = None
    if current_user.role == UserRole.TEACHER:
        if not current_user.teacher_profile:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Teacher profile not found")
        
        teacher_id = current_user.teacher_profile.id
        
        # Verify assignment or department alignment
        is_assigned = db.query(TeacherAssignment).filter(
            TeacherAssignment.teacher_id == teacher_id,
            TeacherAssignment.subject_id == course_id
        ).first() is not None

        is_dept_aligned = (current_user.teacher_profile.department_id == course.department_id)

        if not is_assigned and not is_dept_aligned:
            logger.warning(
                f"[SECURITY ALERT] Faculty {current_user.username} attempted unauthorized access to unassigned course {course_id}"
            )
            log_security_audit_event(
                db=db,
                event_type="PRIVESC_ATTEMPT",
                action="UNAUTHORIZED_COURSE_ANALYTICS_ACCESS",
                details=f"Faculty {current_user.username} blocked from accessing course {course.code} ({course.name})",
                user_id=current_user.id
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied: You are only authorized to view analytics for your assigned courses."
            )

    course_data = AttendanceEngine.get_faculty_course_compliance(
        db=db,
        course_id=course_id,
        teacher_id=teacher_id if current_user.role == UserRole.TEACHER else None
    )

    return course_data


# ==============================================================================
# 4. HOD ANALYTICS: DEPARTMENT-LEVEL ATTENDANCE
# ==============================================================================
@router.get("/hod/analytics/department/{dept}")
def get_hod_department_compliance(
    dept: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher)
):
    """
    HOD endpoint: Department-level compliance breakdown.
    Role-gated: HOD/Faculty can only view their own department.
    Super Admins can view all departments.
    """
    normalized_dept = dept.strip().upper()

    if current_user.role == UserRole.TEACHER:
        if not current_user.teacher_profile or not current_user.teacher_profile.department:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Faculty profile or department association missing"
            )
        
        user_dept = current_user.teacher_profile.department.code.strip().upper()
        if user_dept != normalized_dept:
            logger.warning(
                f"[SECURITY ALERT] Faculty {current_user.username} (Dept: {user_dept}) attempted access to Dept {normalized_dept}"
            )
            log_security_audit_event(
                db=db,
                event_type="PRIVESC_ATTEMPT",
                action="UNAUTHORIZED_DEPARTMENT_ANALYTICS_ACCESS",
                details=f"Faculty {current_user.username} blocked from viewing Department {normalized_dept} analytics",
                user_id=current_user.id
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied: You are only authorized to view analytics for department {user_dept}."
            )

    dept_summary = AttendanceEngine.get_department_compliance_summary(
        db=db,
        department_code=normalized_dept
    )

    return dept_summary


# ==============================================================================
# 5. ADMIN CONDONATION FINE MANAGEMENT
# ==============================================================================
@router.put("/admin/compliance/student/{student_id}/condonation")
@router.put("/compliance/condonations/{student_id}")
def update_student_condonation(
    student_id: str,
    req: CondonationUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """
    Admin endpoint to edit student condonation fine status:
    pending, applied, approved, fine_paid, waived, rejected.
    Supports either student database ID or roll number.
    """
    student = None
    if str(student_id).isdigit():
        student = db.query(Student).filter(Student.id == int(student_id)).first()
    if not student:
        student = db.query(Student).filter(Student.roll_number == str(student_id).strip().upper()).first()
    if not student:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not found")

    condonation_rec = db.query(StudentCondonation).filter(
        StudentCondonation.student_id == student.id,
        StudentCondonation.course_id == req.course_id
    ).first()

    clean_status = req.status.strip().lower()
    current_status = condonation_rec.status if condonation_rec else "pending"
    old_status = current_status
    old_fine = condonation_rec.fine_amount if condonation_rec else 0.0

    # Enforce condonation state machine transitions (e.g., no rejected -> applied skip)
    if not StudentCondonation.validate_transition(current_status, clean_status):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid condonation transition: Cannot transition from '{current_status}' to '{clean_status}'"
        )

    if condonation_rec:
        condonation_rec.status = clean_status
        condonation_rec.fine_amount = req.fine_amount
        condonation_rec.remarks = req.remarks
        condonation_rec.updated_by = current_user.id
    else:
        condonation_rec = StudentCondonation(
            student_id=student.id,
            course_id=req.course_id,
            academic_year_id=req.academic_year_id or student.academic_year_id,
            status=clean_status,
            fine_amount=req.fine_amount,
            remarks=req.remarks,
            updated_by=current_user.id
        )
        db.add(condonation_rec)

    db.commit()
    db.refresh(condonation_rec)

    # Invalidate attendance engine cache
    invalidate_attendance_cache(student_id=student.id, course_id=req.course_id)

    log_security_audit_event(
        db=db,
        event_type=SecurityEventType.PWA_TELEMETRY,
        action="CONDONATION_STATUS_UPDATE",
        details=f"Admin {current_user.username} updated {student.roll_number} condonation: status '{old_status}' -> '{clean_status}', fine Rs. {old_fine} -> Rs. {req.fine_amount}",
        user_id=current_user.id,
        roll_number=student.roll_number
    )

    return {
        "status": "SUCCESS",
        "message": f"Condonation status updated to '{clean_status}'",
        "condonation": {
            "id": condonation_rec.id,
            "student_id": condonation_rec.student_id,
            "course_id": condonation_rec.course_id,
            "status": condonation_rec.status,
            "fine_amount": condonation_rec.fine_amount,
            "remarks": condonation_rec.remarks
        }
    }


# ==============================================================================
# 6. ADMIN/TEACHER APPROVED ABSENCE EXCLUSION MARKING
# ==============================================================================
@router.post("/admin/compliance/attendance-record/{record_id}/approved-absence")
def set_approved_absence_flag(
    record_id: int,
    req: ApprovedAbsenceUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher)
):
    """
    Marks an attendance record as an approved absence (medical/sports/duty).
    When JNTUH_INCLUDE_APPROVED_ABSENCES is active, this excludes the session
    from the attendance percentage denominator.
    """
    record = db.query(AttendanceRecord).filter(AttendanceRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attendance record not found")

    record.is_approved_absence = req.is_approved_absence
    record.approved_absence_reason = req.reason.strip().upper() if req.is_approved_absence else None

    db.commit()
    db.refresh(record)

    # Invalidate cache for student
    invalidate_attendance_cache(student_id=record.student_id)

    log_security_audit_event(
        db=db,
        event_type=SecurityEventType.ATTENDANCE_SUBMITTED,
        action="APPROVED_ABSENCE_MARKED",
        details=f"User {current_user.username} marked record {record.id} for {record.roll_number} as approved absence: {req.is_approved_absence} ({req.reason})",
        user_id=current_user.id,
        roll_number=record.roll_number
    )

    return {
        "status": "SUCCESS",
        "record_id": record.id,
        "roll_number": record.roll_number,
        "is_approved_absence": record.is_approved_absence,
        "approved_absence_reason": record.approved_absence_reason
    }
