"""
Defaulter Lists & Early-Warning Alerts API Endpoints
SNIST AI QR Attendance & Academic System (Compliance Module - Feature 2)

Role-Gated Endpoints:
1. GET /api/v1/faculty/defaulters (Faculty own courses)
2. GET /api/v1/hod/defaulters (HOD own department)
3. GET /api/v1/admin/defaulters (Super Admin all departments)
4. GET /api/v1/defaulters/export (Excel export in SNIST register format)
5. POST /api/v1/faculty/students/{roll}/warning (Warning issuance with immutable snapshot)
6. GET /api/v1/student/warnings (Student self-view of warnings)
7. POST /api/v1/admin/ops/hod-digest (Idempotent HOD weekly digest dispatch)
"""

import logging
from typing import Optional, Dict, Any, List
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Request, Response
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field

from app.core.database import get_db
from app.core.security import get_server_ist_date, get_server_ist_datetime
from app.api.auth import get_current_user, require_admin, require_teacher
from app.models.models import (
    User, UserRole, Student, Teacher, Subject, Department,
    TeacherAssignment, StudentWarning, SecurityEventType
)
from app.core.device_security import log_security_audit_event
from app.services.attendance_engine import AttendanceEngine

logger = logging.getLogger("snist_erp.defaulters_api")

router = APIRouter(tags=["Defaulters & Early Warnings"])

# Pydantic Request Schemas
class WarningCreateRequest(BaseModel):
    course_id: Optional[int] = Field(None, description="Course ID or None for semester aggregate warning")
    custom_message: Optional[str] = Field(None, description="Custom recovery advice from faculty")
    notify_parent: bool = Field(False, description="Whether to send notification to registered guardian")

class DigestTriggerRequest(BaseModel):
    target_date: Optional[str] = Field(None, description="Target date YYYY-MM-DD (defaults to server IST date)")
    force: bool = Field(False, description="Bypass idempotency guard and force re-dispatch")


# ==============================================================================
# 1. FACULTY DEFAULTERS LIST
# ==============================================================================
@router.get("/faculty/defaulters")
def get_faculty_defaulters(
    course_id: Optional[int] = None,
    band: Optional[str] = None,
    flag: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher)
):
    """
    Faculty endpoint: Defaulter list for assigned courses.
    Role-gated: Faculty can only access courses assigned to them.
    Filters: DETAINED / CONDONABLE / BELOW_75 / RAPID_DECLINE / NOT_RECOVERABLE / ALL
    """
    try:
        res = AttendanceEngine.get_defaulters_roster(
            db=db,
            user=current_user,
            course_id=course_id,
            band_filter=band,
            flag_filter=flag
        )
        return res
    except PermissionError as pe:
        logger.warning(f"[SECURITY ALERT] Faculty {current_user.username} unauthorized defaulter access: {pe}")
        log_security_audit_event(
            db=db,
            event_type="PRIVESC_ATTEMPT",
            action="UNAUTHORIZED_DEFAULTER_ROSTER_ACCESS",
            details=str(pe),
            user_id=current_user.id
        )
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(pe))
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve))


# ==============================================================================
# 2. HOD DEFAULTERS LIST
# ==============================================================================
@router.get("/hod/defaulters")
def get_hod_defaulters(
    dept: Optional[str] = None,
    year: Optional[int] = None,
    band: Optional[str] = None,
    flag: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    HOD endpoint: Department-level defaulters list.
    Role-gated: Faculty can only query their own department. Admin unrestricted.
    """
    if current_user.role not in (UserRole.TEACHER, UserRole.SUPER_ADMIN):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="HOD or Admin permission required")

    target_dept = dept
    if current_user.role == UserRole.TEACHER:
        teacher_prof = current_user.teacher_profile
        if not teacher_prof or not teacher_prof.department:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Faculty department alignment missing")
        user_dept_code = teacher_prof.department.code.strip().upper()
        if target_dept and target_dept.strip().upper() != user_dept_code:
            logger.warning(f"[SECURITY ALERT] Faculty {current_user.username} (Dept {user_dept_code}) attempted lookup for Dept {target_dept}")
            log_security_audit_event(
                db=db,
                event_type="PRIVESC_ATTEMPT",
                action="UNAUTHORIZED_HOD_DEFAULTER_LOOKUP",
                details=f"Faculty blocked from accessing Dept {target_dept} defaulters",
                user_id=current_user.id
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied: You are only authorized to view defaulters for department {user_dept_code}."
            )
        target_dept = user_dept_code

    try:
        res = AttendanceEngine.get_defaulters_roster(
            db=db,
            user=current_user,
            dept_code=target_dept,
            academic_year_id=year,
            band_filter=band,
            flag_filter=flag
        )
        return res
    except PermissionError as pe:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(pe))


# ==============================================================================
# 3. SUPER ADMIN DEFAULTERS LIST
# ==============================================================================
@router.get("/admin/defaulters")
def get_admin_defaulters(
    dept: Optional[str] = None,
    band: Optional[str] = None,
    flag: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """
    Super Admin endpoint: Defaulter list across all departments and courses.
    """
    res = AttendanceEngine.get_defaulters_roster(
        db=db,
        user=current_user,
        dept_code=dept,
        band_filter=band,
        flag_filter=flag
    )
    return res


# ==============================================================================
# 4. ONE-CLICK EXCEL EXPORT (SNIST REGISTER FORMAT)
# ==============================================================================
@router.get("/defaulters/export")
def export_defaulters_register(
    course_id: Optional[int] = None,
    dept: Optional[str] = None,
    band: Optional[str] = None,
    flag: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Generates official Excel defaulter register formatted per SNIST academic standards.
    """
    if current_user.role not in (UserRole.TEACHER, UserRole.SUPER_ADMIN):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission required to export defaulter registers")

    target_dept = dept
    if current_user.role == UserRole.TEACHER:
        teacher_prof = current_user.teacher_profile
        if not teacher_prof:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Teacher profile missing")
        if dept and teacher_prof.department and dept.strip().upper() != teacher_prof.department.code.strip().upper():
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied: Department scope mismatch.")
        if not course_id and not dept and teacher_prof.department:
            target_dept = teacher_prof.department.code

    roster_res = AttendanceEngine.get_defaulters_roster(
        db=db,
        user=current_user,
        course_id=course_id,
        dept_code=target_dept,
        band_filter=band,
        flag_filter=flag
    )

    rows = roster_res.get("defaulters", [])
    title_suffix = f"Course {course_id}" if course_id else (f"Dept {target_dept}" if target_dept else "Institutional")
    excel_bytes = AttendanceEngine.generate_defaulters_excel(
        defaulters_data=rows,
        title=f"Official Defaulter Register — {title_suffix}"
    )

    today_str = get_server_ist_date()
    filename = f"SNIST_Defaulters_Register_{title_suffix.replace(' ', '_')}_{today_str}.xlsx"

    log_security_audit_event(
        db=db,
        event_type=SecurityEventType.PWA_TELEMETRY,
        action="DEFAULTER_REGISTER_EXPORT",
        details=f"User {current_user.username} exported {len(rows)} defaulter rows ({title_suffix})",
        user_id=current_user.id
    )

    return Response(
        content=excel_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Access-Control-Expose-Headers": "Content-Disposition"
        }
    )


# ==============================================================================
# 5. WARNING ISSUANCE + EVIDENCE SNAPSHOT
# ==============================================================================
@router.post("/faculty/students/{roll}/warning")
def issue_warning_to_student(
    roll: str,
    req: WarningCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher)
):
    """
    Issues an attendance warning to a student trending toward detention.
    Captures an immutable snapshot of attendance numbers at issuance time.
    """
    try:
        result = AttendanceEngine.issue_student_warning(
            db=db,
            issuer_user=current_user,
            student_roll=roll,
            course_id=req.course_id,
            custom_message=req.custom_message,
            notify_parent=req.notify_parent
        )

        log_security_audit_event(
            db=db,
            event_type=SecurityEventType.PWA_TELEMETRY,
            action="STUDENT_ATTENDANCE_WARNING_ISSUED",
            details=(
                f"Faculty {current_user.username} issued warning to {roll} "
                f"(Snapshot: {result['percentage_at_issue']}%, Band: {result['band_at_issue']}, "
                f"Classes Needed: {result['classes_needed_at_issue']})"
            ),
            user_id=current_user.id,
            roll_number=roll
        )

        return {
            "status": "SUCCESS",
            "warning": result,
            **result
        }
    except PermissionError as pe:
        logger.warning(f"[SECURITY ALERT] Unauthorized warning issuance attempt by {current_user.username}: {pe}")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(pe))
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve))


# ==============================================================================
# 6. STUDENT WARNINGS SELF-VIEW
# ==============================================================================
@router.get("/student/warnings")
def get_student_warnings(
    roll: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Student self-view endpoint for early-warning notices and recovery paths.
    Role-gated: Students can only view their own warnings.
    """
    target_roll = roll.strip().upper() if roll else None

    if current_user.role == UserRole.STUDENT:
        student_roll = current_user.username.strip().upper()
        if current_user.student_profile and current_user.student_profile.roll_number:
            student_roll = current_user.student_profile.roll_number.strip().upper()

        if target_roll and target_roll != student_roll:
            logger.warning(f"[SECURITY ALERT] Student {current_user.username} attempted to view warnings of {target_roll}")
            log_security_audit_event(
                db=db,
                event_type="PRIVESC_ATTEMPT",
                action="UNAUTHORIZED_STUDENT_WARNING_LOOKUP",
                details=f"Student blocked from viewing warnings of {target_roll}",
                user_id=current_user.id
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied: You are only authorized to view your own attendance warnings."
            )
        target_roll = student_roll

    if not target_roll:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Roll number parameter required for non-student users")

    student = db.query(Student).filter(Student.roll_number == target_roll).first()
    if not student:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Student {target_roll} not found")

    warnings = db.query(StudentWarning).filter(
        StudentWarning.student_id == student.id
    ).order_by(StudentWarning.issued_at.desc()).all()

    warnings_list = [
        {
            "warning_id": w.id,
            "student_roll": student.roll_number,
            "student_name": student.name,
            "course_id": w.course_id,
            "course_code": w.course.code if w.course else None,
            "course_name": w.course.name if w.course else "Semester Aggregate",
            "warning_type": w.warning_type,
            "percentage_at_issue": w.percentage_at_issue,
            "band_at_issue": w.band_at_issue,
            "classes_needed_at_issue": w.classes_needed_at_issue,
            "sessions_held_at_issue": w.sessions_held_at_issue,
            "sessions_present_at_issue": w.sessions_present_at_issue,
            "issued_at": w.issued_at.isoformat(),
            "message": w.message,
            "parent_notified": w.parent_notified,
            "parent_notification_status": w.parent_notification_status
        }
        for w in warnings
    ]

    return {
        "student_roll": student.roll_number,
        "student_name": student.name,
        "total_warnings": len(warnings_list),
        "warnings": warnings_list
    }


# ==============================================================================
# 7. HOD WEEKLY DIGEST (OPS GUARDRAIL)
# ==============================================================================
@router.post("/admin/ops/hod-digest")
def trigger_hod_weekly_digest(
    req: DigestTriggerRequest = DigestTriggerRequest(),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """
    Triggers weekly HOD digest generation (department defaulters, rapid decline watchlist, not recoverable).
    Idempotent: Running multiple times on the same date skips duplicate sends.
    """
    res = AttendanceEngine.generate_and_send_hod_weekly_digest(
        db=db,
        target_date_str=req.target_date,
        force=req.force
    )
    return res
