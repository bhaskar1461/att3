import os
import shutil
import logging
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status, Request
from fastapi.responses import FileResponse

logger = logging.getLogger("snist_erp.admin")
from sqlalchemy import or_, func, case, and_
from sqlalchemy.orm import Session, joinedload
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime

from app.core.database import get_db
from app.api.auth import get_current_user, require_admin
from app.core.security import get_password_hash
from app.core.config import settings
from app.models.models import (
    User, UserRole, Department, AcademicYear, Section, Subject, 
    Teacher, Student, TeacherAssignment, SystemSettings, AuditLog, 
    AttendanceRecord, AttendanceSession, AttendanceStatus, DeviceRegistration
)
from app.services.excel_service import ExcelAttendanceService
from app.services.qr_service import QRService
from app.services.gsheets_service import GoogleSheetsService

router = APIRouter(prefix="/admin", tags=["Super Admin"])

# --- Pydantic Schemas ---
class DepartmentCreate(BaseModel):
    code: str
    name: str

class SectionCreate(BaseModel):
    name: str
    department_id: int
    academic_year_id: int

class SubjectCreate(BaseModel):
    code: str
    name: str
    department_id: int
    academic_year_id: int

class TeacherCreate(BaseModel):
    username: str
    password: str
    name: str
    teacher_code: str
    department_id: int
    email: Optional[str] = None
    mobile: Optional[str] = None

class StudentCreate(BaseModel):
    roll_number: str
    name: str
    department_id: int
    academic_year_id: int
    section_id: int
    email: Optional[str] = None
    mobile: Optional[str] = None
    agency: Optional[str] = "Regular"

class AssignmentCreate(BaseModel):
    teacher_id: int
    subject_id: int
    section_id: int
    google_sheet_id: Optional[str] = None

class AssignmentGSheetUpdate(BaseModel):
    google_sheet_id: Optional[str] = ""

class SettingsUpdate(BaseModel):
    settings: Dict[str, str]

import time
import threading

_DASHBOARD_STATS_CACHE: Optional[Dict[str, Any]] = None
_DASHBOARD_STATS_CACHE_AT: float = 0.0
_DASHBOARD_STATS_LOCK = threading.Lock()
_DASHBOARD_STATS_TTL = 30.0  # 30-second TTL cache to eliminate redundant multi-query DB stalls

# --- Dashboard & Stats ---
@router.get("/dashboard-stats")
def get_dashboard_stats(db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    global _DASHBOARD_STATS_CACHE, _DASHBOARD_STATS_CACHE_AT
    now = time.time()
    with _DASHBOARD_STATS_LOCK:
        if _DASHBOARD_STATS_CACHE is not None and (now - _DASHBOARD_STATS_CACHE_AT) < _DASHBOARD_STATS_TTL:
            return _DASHBOARD_STATS_CACHE

    from app.core.security import get_server_ist_date
    today_str = get_server_ist_date()
    total_students = db.query(Student).count()
    total_teachers = db.query(Teacher).count()
    total_depts = db.query(Department).count()
    
    today_records = db.query(AttendanceRecord).filter(AttendanceRecord.session_date == today_str).all()
    present_today = sum(1 for r in today_records if r.status.value in ["PRESENT", "4"])
    absent_today = len(today_records) - present_today

    att_percentage = round((present_today / len(today_records) * 100), 1) if today_records else 100.0

    active_sessions = db.query(AttendanceSession).filter(
        AttendanceSession.session_date == today_str, 
        AttendanceSession.status == "OPEN"
    ).count()

    stats = {
        "total_students": total_students,
        "total_teachers": total_teachers,
        "total_departments": total_depts,
        "present_today": present_today,
        "absent_today": absent_today,
        "attendance_percentage": att_percentage,
        "active_live_classes": active_sessions
    }
    with _DASHBOARD_STATS_LOCK:
        _DASHBOARD_STATS_CACHE = stats
        _DASHBOARD_STATS_CACHE_AT = time.time()

    return stats

# --- Enrollment Analytics & Mermaid Drill-Down ---
@router.get("/analytics/enrollment")
def get_enrollment_analytics(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """
    Returns department enrollment distribution for Level-1 Mermaid hierarchy diagram.
    Guarantees mathematical reconciliation: sum(departments) + unassigned == total_enrolled.
    """
    total_enrolled = db.query(func.count(Student.id)).scalar() or 0
    
    # Single aggregation query grouping students by department_id
    dept_counts_query = db.query(
        Student.department_id,
        func.count(Student.id).label("student_count")
    ).group_by(Student.department_id).all()
    
    counts_map = {row[0]: row[1] for row in dept_counts_query}
    
    try:
        from app.services.attendance_engine import AttendanceEngine
        compliance_summary = AttendanceEngine.get_department_compliance_summary(db=db, use_cache=True)
        defaulters_by_code = {
            d["department_code"]: d.get("condonable_count", 0) + d.get("detained_count", 0)
            for d in compliance_summary.get("departments", [])
        }
    except Exception as e:
        logger.warning(f"Could not compute department defaulters in enrollment analytics: {e}")
        defaulters_by_code = {}

    # Phase 5 Cutover: Promote Anti-Downgrade View (Query DeviceBinding for active keys)
    from app.models.models import DeviceBinding
    active_bindings_query = db.query(Student.department_id, func.count(DeviceBinding.id)).join(
        DeviceBinding, and_(DeviceBinding.student_id == Student.id, DeviceBinding.revoked_at.is_(None))
    ).group_by(Student.department_id).all()
    bound_map = {row[0]: row[1] for row in active_bindings_query}
    total_bound = sum(bound_map.values())

    departments = db.query(Department).order_by(Department.name).all()
    
    dept_list = []
    accounted_students = 0
    
    for d in departments:
        count = counts_map.get(d.id, 0)
        pct = round((count / total_enrolled * 100), 1) if total_enrolled > 0 else 0.0
        d_defaulters = defaulters_by_code.get(d.code, 0)
        dept_bound = bound_map.get(d.id, 0)
        dept_unbound = max(0, count - dept_bound)
        dept_cov_pct = round((dept_bound / count * 100), 1) if count > 0 else 0.0
        dept_list.append({
            "id": d.id,
            "code": d.code,
            "name": d.name,
            "count": count,
            "percentage": pct,
            "share_pct": pct,
            "defaulters_count": d_defaulters,
            "hard_bound_count": dept_bound,
            "soft_bound_count": 0,
            "unbound_count": dept_unbound,
            "coverage_pct": dept_cov_pct
        })
        accounted_students += count
        
    unassigned_count = total_enrolled - accounted_students
    if unassigned_count > 0:
        pct = round((unassigned_count / total_enrolled * 100), 1) if total_enrolled > 0 else 0.0
        u_defaulters = defaulters_by_code.get("UNASSIGNED", 0)
        unassigned_bound = max(0, total_bound - sum(bound_map.get(d.id, 0) for d in departments))
        unassigned_unbound = max(0, unassigned_count - unassigned_bound)
        u_cov_pct = round((unassigned_bound / unassigned_count * 100), 1) if unassigned_count > 0 else 0.0
        dept_list.append({
            "id": -1,
            "code": "UNASSIGNED",
            "name": "Unassigned Department",
            "count": unassigned_count,
            "percentage": pct,
            "share_pct": pct,
            "defaulters_count": u_defaulters,
            "hard_bound_count": unassigned_bound,
            "soft_bound_count": 0,
            "unbound_count": unassigned_unbound,
            "coverage_pct": u_cov_pct
        })

    return {
        "total_enrolled": total_enrolled,
        "unassigned_count": max(0, unassigned_count),
        "enforcement_summary": {
            "total_students": total_enrolled,
            "hard_bound_count": total_bound,
            "soft_bound_count": 0,
            "unbound_count": max(0, total_enrolled - total_bound),
            "coverage_pct": round(total_bound / total_enrolled * 100, 1) if total_enrolled > 0 else 0.0
        },
        "departments": dept_list
    }

@router.get("/analytics/enrollment/students")
@router.get("/department-enrolled-students")
def get_department_enrolled_students(
    dept_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """
    Level-2 drill-down: Lazy-loads students for a specific department with device and attendance telemetry.
    Uses batch queries (zero N+1) to resolve today's attendance, total session stats, and device details.
    """
    try:
        from app.core.security import get_server_ist_date
        today_str = get_server_ist_date()

        query = db.query(Student).options(
            joinedload(Student.department),
            joinedload(Student.academic_year),
            joinedload(Student.section)
        )
        if dept_id == -1:
            valid_dept_ids = [d.id for d in db.query(Department.id).all()]
            query = query.filter(or_(Student.department_id == None, ~Student.department_id.in_(valid_dept_ids)))
        else:
            query = query.filter(Student.department_id == dept_id)
            
        students = query.order_by(Student.roll_number).all()
        if not students:
            return []

        student_ids = [s.id for s in students]

        # Batch Query 1: Present today status (Defensive: use AttendanceStatus.PRESENT enum directly)
        today_present_query = db.query(AttendanceRecord.student_id).filter(
            AttendanceRecord.session_date == today_str,
            AttendanceRecord.student_id.in_(student_ids),
            AttendanceRecord.status == AttendanceStatus.PRESENT
        ).distinct().all()
        today_present_set = {r[0] for r in today_present_query}

        # Batch Query 2: Attendance aggregation per student (Defensive: use AttendanceStatus.PRESENT enum directly)
        rec_aggregates = db.query(
            AttendanceRecord.student_id,
            func.count(AttendanceRecord.id).label("total_records"),
            func.sum(
                case(
                    (AttendanceRecord.status == AttendanceStatus.PRESENT, 1),
                    else_=0
                )
            ).label("present_records")
        ).filter(AttendanceRecord.student_id.in_(student_ids)).group_by(AttendanceRecord.student_id).all()

        stats_map = {row[0]: (row[1] or 0, int(row[2] or 0)) for row in rec_aggregates}

        # Batch Query 3: Phase 5 Cutover — Authoritative Cryptographic Keypair Bindings (DeviceBinding)
        from app.models.models import DeviceBinding
        active_bindings = db.query(DeviceBinding).filter(
            DeviceBinding.student_id.in_(student_ids),
            DeviceBinding.revoked_at.is_(None)
        ).all()
        binding_map = {b.student_id: b for b in active_bindings}

        results = []
        for s in students:
            binding_rec = binding_map.get(s.id)
            is_hard_bound = binding_rec is not None
            tot, pres = stats_map.get(s.id, (0, 0))
            pct = round((pres / tot * 100), 1) if tot > 0 else 0.0

            try:
                from app.services.attendance_engine import get_student_full_compliance, determine_jntuh_band
                from app.core.config import R25Config
                comp = get_student_full_compliance(db, s.id, getattr(s, "join_date", None))
                agg = comp.get("aggregate", {})
                agg_pct = agg.get("aggregate_percentage")
                display_pct = agg.get("aggregate_display", f"{pct:.2f}%")
                band = agg.get("band", determine_jntuh_band(pct, sessions_held=tot))
                courses_below_75 = agg.get("courses_below_75_count", 0)
                condonation_status = agg.get("condonation_status", "pending")
            except Exception:
                from app.services.attendance_engine import determine_jntuh_band
                agg_pct = pct
                display_pct = f"{pct:.2f}%"
                band = determine_jntuh_band(pct, sessions_held=tot)
                courses_below_75 = 0
                condonation_status = "pending"

            device_info = None
            if binding_rec:
                device_info = {
                    "id": binding_rec.id,
                    "key_id": binding_rec.key_id,
                    "public_id": f"KEY-{binding_rec.key_id[:12]}",
                    "is_active": True,
                    "enrolled_at": binding_rec.enrolled_at.strftime("%Y-%m-%d %H:%M:%S") if binding_rec.enrolled_at else None,
                    "enrolled_via": binding_rec.enrolled_via,
                    "storage_persist_granted": binding_rec.storage_persist_granted
                }

            sec_name = s.section.name if s.section else "N/A"
            yr_name = s.academic_year.name if s.academic_year else "N/A"
            dept_name = s.department.name if s.department else "Unassigned"
            dept_code = s.department.code if s.department else "UNASSIGNED"

            results.append({
                "id": s.id,
                "roll_number": s.roll_number,
                "name": s.name,
                "department_id": s.department_id,
                "department_code": dept_code,
                "department_name": dept_name,
                "year": yr_name,
                "academic_year": yr_name,
                "section": sec_name,
                "section_name": sec_name,
                "email": s.email or "",
                "mobile": s.mobile or "",
                "agency": getattr(s, "agency", "Regular") or "Regular",
                "registered_device_id": None,
                "device_bound": is_hard_bound,
                "binding_status": "hard" if is_hard_bound else "unbound",
                "enrolled_key_id": binding_rec.key_id if binding_rec else None,
                "device_info": device_info,
                "present_today": s.id in today_present_set,
                "total_classes": tot,
                "attended_classes": pres,
                "attendance_percentage": agg_pct if agg_pct is not None else pct,
                "display_percentage": display_pct,
                "band": band,
                "condonation_status": condonation_status,
                "courses_below_75_count": courses_below_75,
                "join_date": getattr(s, "join_date", None),
                "attendance_summary": {
                    "attended_sessions": pres,
                    "total_sessions": tot,
                    "attendance_percentage": agg_pct if agg_pct is not None else pct,
                    "display_percentage": display_pct,
                    "band": band,
                    "condonation_status": condonation_status,
                    "courses_below_75_count": courses_below_75,
                }
            })

        return results
    except Exception as e:
        logger.error(f"Error resolving enrolled students for dept_id={dept_id}: {e}", exc_info=True)
        # Defensive fallback: return bare student list gracefully without crashing the admin modal
        try:
            bare_query = db.query(Student)
            if dept_id != -1:
                bare_query = bare_query.filter(Student.department_id == dept_id)
            bare_students = bare_query.order_by(Student.roll_number).all()
            return [
                {
                    "id": s.id,
                    "roll_number": s.roll_number,
                    "name": s.name,
                    "department_id": s.department_id,
                    "department_code": s.department.code if s.department else "CSE",
                    "department_name": s.department.name if s.department else "Computer Science & Engineering",
                    "year": s.academic_year.name if s.academic_year else "3rd Year",
                    "academic_year": s.academic_year.name if s.academic_year else "3rd Year",
                    "section": s.section.name if s.section else "CSE-A",
                    "section_name": s.section.name if s.section else "CSE-A",
                    "email": s.email or "",
                    "mobile": s.mobile or "",
                    "agency": getattr(s, "agency", "Regular") or "Regular",
                    "registered_device_id": None,
                    "device_bound": False,
                    "binding_status": "unbound",
                    "enrolled_key_id": None,
                    "device_info": None,
                    "present_today": False,
                    "total_classes": 0,
                    "attended_classes": 0,
                    "attendance_percentage": 0.0,
                    "display_percentage": "0.00%",
                    "band": "CRITICAL",
                    "condonation_status": "pending",
                    "courses_below_75_count": 0,
                    "join_date": getattr(s, "join_date", None),
                    "attendance_summary": {
                        "attended_sessions": 0,
                        "total_sessions": 0,
                        "attendance_percentage": 0.0,
                        "display_percentage": "0.00%",
                        "band": "CRITICAL",
                        "condonation_status": "pending",
                        "courses_below_75_count": 0,
                    }
                }
                for s in bare_students
            ]
        except Exception:
            return []

# --- Departments, Years, Sections, Subjects ---
@router.get("/departments")
def get_departments(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Department).all()

@router.post("/departments")
def create_department(dept: DepartmentCreate, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    new_dept = Department(code=dept.code.upper(), name=dept.name)
    db.add(new_dept)
    db.commit()
    db.refresh(new_dept)
    return new_dept

@router.get("/years")
def get_years(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(AcademicYear).all()

@router.get("/sections")
def get_sections(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    # Single round-trip with eager loads for department and academic year
    sections = db.query(Section).options(
        joinedload(Section.department),
        joinedload(Section.academic_year)
    ).all()
    res = []
    for s in sections:
        res.append({
            "id": s.id,
            "name": s.name,
            "department_id": s.department_id,
            "department": s.department.code if s.department else "",
            "academic_year_id": s.academic_year_id,
            "year": s.academic_year.name if s.academic_year else ""
        })
    return res

@router.post("/sections")
def create_section(sec: SectionCreate, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    new_sec = Section(name=sec.name, department_id=sec.department_id, academic_year_id=sec.academic_year_id)
    db.add(new_sec)
    db.commit()
    db.refresh(new_sec)
    return new_sec

@router.get("/subjects")
def get_subjects(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    # Single round-trip with eager loads for department and academic year
    subjects = db.query(Subject).options(
        joinedload(Subject.department),
        joinedload(Subject.academic_year)
    ).all()
    res = []
    for sub in subjects:
        res.append({
            "id": sub.id,
            "code": sub.code,
            "name": sub.name,
            "department_id": sub.department_id,
            "department": sub.department.code if sub.department else "",
            "academic_year_id": sub.academic_year_id,
            "year": sub.academic_year.name if sub.academic_year else ""
        })
    return res

@router.post("/subjects")
def create_subject(sub: SubjectCreate, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    new_sub = Subject(code=sub.code.upper(), name=sub.name, department_id=sub.department_id, academic_year_id=sub.academic_year_id)
    db.add(new_sub)
    db.commit()
    db.refresh(new_sub)
    return new_sub

def extract_spreadsheet_id(input_str: str) -> str:
    if not input_str:
        return ""
    s = input_str.strip()
    if "/d/" in s:
        parts = s.split("/d/")
        if len(parts) > 1:
            return parts[1].split("/")[0]
    return s

# --- Teachers & Assignments ---
@router.get("/teachers")
def get_teachers(
    page: Optional[int] = None,
    page_size: int = 20,
    department_id: Optional[int] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db), 
    current_user: User = Depends(require_admin)
):
    query = db.query(Teacher).options(
        joinedload(Teacher.department),
        joinedload(Teacher.user)
    )

    if department_id:
        query = query.filter(Teacher.department_id == department_id)
    if search:
        s_term = f"%{search.strip()}%"
        query = query.filter(or_(Teacher.name.ilike(s_term), Teacher.teacher_code.ilike(s_term)))

    # Return paginated envelope if page is passed; otherwise plain list for backward compatibility
    if page is not None:
        total = query.count()
        page_num = max(1, page)
        limit_val = max(1, min(100, page_size))
        offset_val = (page_num - 1) * limit_val
        teachers = query.order_by(Teacher.id.asc()).offset(offset_val).limit(limit_val).all()
        
        items = []
        teacher_ids = [t.id for t in teachers]
        assignments_map = {}
        if teacher_ids:
            all_asg = db.query(TeacherAssignment).options(
                joinedload(TeacherAssignment.subject),
                joinedload(TeacherAssignment.section)
            ).filter(TeacherAssignment.teacher_id.in_(teacher_ids)).all()
            for asg in all_asg:
                asg_sp_id = asg.google_sheet_id or ""
                asg_sp_url = f"https://docs.google.com/spreadsheets/d/{asg_sp_id}/edit" if asg_sp_id else ""
                assignments_map.setdefault(asg.teacher_id, []).append({
                    "id": asg.id,
                    "subject_code": asg.subject.code if asg.subject else "",
                    "subject_name": asg.subject.name if asg.subject else "",
                    "section_name": asg.section.name if asg.section else "",
                    "excel_file_name": asg.excel_file_name or f"Register_{asg.id}.xlsx",
                    "google_sheet_id": asg_sp_id,
                    "google_sheet_url": asg_sp_url
                })

        for t in teachers:
            sp_id = t.google_sheet_id or ""
            sp_url = f"https://docs.google.com/spreadsheets/d/{sp_id}/edit" if sp_id else ""
            t_asgs = assignments_map.get(t.id, [])
            items.append({
                "id": t.id,
                "teacher_code": t.teacher_code,
                "name": t.name,
                "department": t.department.name if t.department else "",
                "department_id": t.department_id,
                "mobile": t.mobile,
                "username": t.user.username if t.user else "",
                "google_sheet_id": sp_id,
                "google_sheet_url": sp_url,
                "assigned_count": len(t_asgs),
                "assigned_classes": t_asgs
            })

        import math
        return {
            "items": items,
            "total": total,
            "page": page_num,
            "page_size": limit_val,
            "total_pages": math.ceil(total / limit_val) if total > 0 else 1
        }

    teachers = query.all()
    teacher_ids = [t.id for t in teachers]
    assignments_map = {}
    if teacher_ids:
        all_asg = db.query(TeacherAssignment).options(
            joinedload(TeacherAssignment.subject),
            joinedload(TeacherAssignment.section)
        ).filter(TeacherAssignment.teacher_id.in_(teacher_ids)).all()
        for asg in all_asg:
            asg_sp_id = asg.google_sheet_id or ""
            asg_sp_url = f"https://docs.google.com/spreadsheets/d/{asg_sp_id}/edit" if asg_sp_id else ""
            assignments_map.setdefault(asg.teacher_id, []).append({
                "id": asg.id,
                "subject_code": asg.subject.code if asg.subject else "",
                "subject_name": asg.subject.name if asg.subject else "",
                "section_name": asg.section.name if asg.section else "",
                "excel_file_name": asg.excel_file_name or f"Register_{asg.id}.xlsx",
                "google_sheet_id": asg_sp_id,
                "google_sheet_url": asg_sp_url
            })

    res = []
    for t in teachers:
        sp_id = t.google_sheet_id or ""
        sp_url = f"https://docs.google.com/spreadsheets/d/{sp_id}/edit" if sp_id else ""
        t_asgs = assignments_map.get(t.id, [])
        res.append({
            "id": t.id,
            "teacher_code": t.teacher_code,
            "name": t.name,
            "department": t.department.name if t.department else "",
            "department_id": t.department_id,
            "mobile": t.mobile,
            "username": t.user.username if t.user else "",
            "google_sheet_id": sp_id,
            "google_sheet_url": sp_url,
            "assigned_count": len(t_asgs),
            "assigned_classes": t_asgs
        })
    return res

class TeacherGSheetUpdate(BaseModel):
    google_sheet_id: str

@router.put("/teachers/{teacher_id}/google-sheet")
def update_teacher_google_sheet(teacher_id: int, req: TeacherGSheetUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    teacher = db.query(Teacher).filter(Teacher.id == teacher_id).first()
    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")

    sp_id = extract_spreadsheet_id(req.google_sheet_id)
    teacher.google_sheet_id = sp_id
    db.commit()
    sp_url = f"https://docs.google.com/spreadsheets/d/{sp_id}/edit" if sp_id else ""
    return {
        "message": f"Updated Google Sheet ID for {teacher.name}",
        "google_sheet_id": sp_id,
        "google_sheet_url": sp_url
    }

@router.post("/teachers")
def create_teacher(req: TeacherCreate, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    if db.query(User).filter(User.username == req.username).first():
        raise HTTPException(status_code=400, detail="Username already exists")

    new_user = User(
        username=req.username,
        email=req.email,
        password_hash=get_password_hash(req.password),
        role=UserRole.TEACHER
    )
    db.add(new_user)
    db.flush()

    new_teacher = Teacher(
        user_id=new_user.id,
        teacher_code=req.teacher_code,
        name=req.name,
        department_id=req.department_id,
        mobile=req.mobile
    )
    db.add(new_teacher)
    db.commit()
    return {"message": "Teacher created successfully", "id": new_teacher.id}

@router.post("/assignments")
def assign_teacher(req: AssignmentCreate, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    existing = db.query(TeacherAssignment).filter(
        TeacherAssignment.teacher_id == req.teacher_id,
        TeacherAssignment.subject_id == req.subject_id,
        TeacherAssignment.section_id == req.section_id
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="This faculty member is already assigned to this Subject and Section.")

    sp_id = extract_spreadsheet_id(req.google_sheet_id) if req.google_sheet_id else None

    assignment = TeacherAssignment(
        teacher_id=req.teacher_id,
        subject_id=req.subject_id,
        section_id=req.section_id,
        google_sheet_id=sp_id
    )
    db.add(assignment)
    db.commit()
    db.refresh(assignment)

    # Immediately generate the dedicated class attendance register
    try:
        from app.services.register_service import generate_class_attendance_register
        generate_class_attendance_register(db, assignment.id, overwrite=False)
    except Exception as e:
        logger.warning(f"Could not auto-generate class attendance register for assignment {assignment.id}: {e}")

    teacher_notified = None
    try:
        teacher = db.query(Teacher).filter(Teacher.id == req.teacher_id).first()
        if teacher and teacher.user and teacher.user.email:
            from app.services.email_service import send_teacher_class_allotment_notification
            t_res = send_teacher_class_allotment_notification(
                db=db,
                teacher_email=teacher.user.email,
                section_id=req.section_id,
                trigger_context="ASSIGNMENT",
            )
            if t_res.get("status") in ("SENT", "DEV_MODE"):
                teacher_notified = teacher.user.email
    except Exception as e:
        logger.warning(f"Could not dispatch teacher assignment email: {e}")

    return {
        "message": "Class assigned to faculty successfully with dedicated Excel register",
        "id": assignment.id,
        "excel_file_name": assignment.excel_file_name,
        "teacher_notified": teacher_notified,
    }

@router.get("/assignments")
def list_assignments(
    teacher_id: Optional[int] = None,
    section_id: Optional[int] = None,
    db: Session = Depends(get_db), 
    current_user: User = Depends(require_admin)
):
    from app.services.register_service import get_assignment_register_info
    query = db.query(TeacherAssignment).options(
        joinedload(TeacherAssignment.teacher).joinedload(Teacher.department),
        joinedload(TeacherAssignment.subject),
        joinedload(TeacherAssignment.section).joinedload(Section.department),
        joinedload(TeacherAssignment.section).joinedload(Section.academic_year)
    )
    if teacher_id:
        query = query.filter(TeacherAssignment.teacher_id == teacher_id)
    if section_id:
        query = query.filter(TeacherAssignment.section_id == section_id)

    assignments = query.all()

    counts_by_section = dict(
        db.query(Student.section_id, func.count(Student.id))
        .group_by(Student.section_id)
        .all()
    )

    res = []
    for a in assignments:
        reg_info = get_assignment_register_info(a)
        sp_id = a.google_sheet_id or ""
        sp_url = f"https://docs.google.com/spreadsheets/d/{sp_id}/edit" if sp_id else ""
        dept_name = ""
        if a.section and a.section.department:
            dept_name = a.section.department.name
        elif a.teacher and a.teacher.department:
            dept_name = a.teacher.department.name

        acad_year = a.section.academic_year.name if a.section and a.section.academic_year else ""

        res.append({
            "id": a.id,
            "teacher_id": a.teacher_id,
            "teacher_code": a.teacher.teacher_code if a.teacher else "",
            "teacher_name": a.teacher.name if a.teacher else "",
            "subject_id": a.subject_id,
            "subject_code": a.subject.code if a.subject else "",
            "subject_name": a.subject.name if a.subject else "",
            "section_id": a.section_id,
            "section_name": a.section.name if a.section else "",
            "department": dept_name,
            "academic_year": acad_year,
            "student_count": counts_by_section.get(a.section_id, 0),
            "excel_file_name": reg_info.get("file_name") or a.excel_file_name or f"Register_{a.id}.xlsx",
            "has_excel_register": reg_info.get("exists", False),
            "google_sheet_id": sp_id,
            "google_sheet_url": sp_url
        })
    return res

@router.delete("/assignments/{assignment_id}")
def delete_assignment(assignment_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    assignment = db.query(TeacherAssignment).filter(TeacherAssignment.id == assignment_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    db.delete(assignment)
    db.commit()
    return {"message": "Class assignment removed successfully", "id": assignment_id}

@router.get("/assignments/{assignment_id}/download-register")
def admin_download_class_register(assignment_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    assignment = db.query(TeacherAssignment).filter(TeacherAssignment.id == assignment_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Class assignment not found")

    from app.services.register_service import get_or_create_assignment_register
    try:
        reg_path = get_or_create_assignment_register(db, assignment)
        if not os.path.exists(reg_path):
            raise HTTPException(status_code=404, detail="Register file could not be generated")

        download_name = assignment.excel_file_name or os.path.basename(reg_path)
        return FileResponse(
            path=reg_path,
            filename=download_name,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
    except Exception as e:
        logger.error(f"Failed to deliver class register for assignment {assignment_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Could not load class register: {str(e)}")

@router.post("/assignments/{assignment_id}/upload-register")
async def admin_upload_class_register(
    assignment_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    assignment = db.query(TeacherAssignment).filter(TeacherAssignment.id == assignment_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Class assignment not found")

    if not file.filename.endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Only .xlsx Excel files are supported")

    from app.services.register_service import get_register_directory, _sanitize_name
    reg_dir = get_register_directory()
    clean_orig = _sanitize_name(os.path.splitext(file.filename)[0])
    target_filename = f"Register_{assignment.id}_{clean_orig}.xlsx"
    target_path = os.path.join(reg_dir, target_filename)

    content = await file.read()
    with open(target_path, "wb") as f:
        f.write(content)

    assignment.excel_file_name = file.filename
    assignment.excel_file_path = target_path
    db.commit()

    return {
        "status": "SUCCESS",
        "message": f"Successfully updated Excel attendance register for class assignment #{assignment.id}",
        "file_name": file.filename,
        "file_path": target_path
    }

@router.post("/assignments/{assignment_id}/regenerate-register")
def admin_regenerate_class_register(
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    assignment = db.query(TeacherAssignment).filter(TeacherAssignment.id == assignment_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Class assignment not found")

    from app.services.register_service import generate_class_attendance_register
    try:
        reg_path = generate_class_attendance_register(db, assignment_id, overwrite=True)
        return {
            "status": "SUCCESS",
            "message": "Class attendance register regenerated with latest roster and attendance",
            "file_name": assignment.excel_file_name,
            "file_path": reg_path
        }
    except Exception as e:
        logger.error(f"Failed to regenerate class register for assignment {assignment_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Regeneration failed: {str(e)}")

@router.put("/assignments/{assignment_id}/google-sheet")
def admin_update_assignment_google_sheet(
    assignment_id: int,
    req: AssignmentGSheetUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    assignment = db.query(TeacherAssignment).filter(TeacherAssignment.id == assignment_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Class assignment not found")

    raw_val = (req.google_sheet_id or "").strip()
    sp_id = extract_spreadsheet_id(raw_val) if raw_val else None
    assignment.google_sheet_id = sp_id
    db.commit()
    sp_url = f"https://docs.google.com/spreadsheets/d/{sp_id}/edit" if sp_id else ""
    return {
        "message": f"Updated Google Sheet ID for class assignment #{assignment.id}" if sp_id else f"Cleared Google Sheet ID for class assignment #{assignment.id} (will fallback to faculty default)",
        "google_sheet_id": sp_id or "",
        "google_sheet_url": sp_url
    }

@router.post("/assignments/{assignment_id}/sync-roster-from-sheet")
def admin_sync_assignment_roster_from_sheet(
    assignment_id: int,
    req: Optional[AssignmentGSheetUpdate] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """
    Admin: Synchronizes student roster (Roll Number, Name, Agency) from the assigned class Google Sheet
    directly into the assigned section in the database.
    """
    assignment = db.query(TeacherAssignment).options(
        joinedload(TeacherAssignment.section),
        joinedload(TeacherAssignment.teacher)
    ).filter(TeacherAssignment.id == assignment_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Class assignment not found")

    target_sheet_id = None
    if req and req.google_sheet_id and req.google_sheet_id.strip():
        target_sheet_id = extract_spreadsheet_id(req.google_sheet_id.strip())
        if target_sheet_id != assignment.google_sheet_id:
            assignment.google_sheet_id = target_sheet_id
            db.commit()

    if not target_sheet_id:
        target_sheet_id = assignment.google_sheet_id
    if not target_sheet_id and assignment.teacher:
        target_sheet_id = assignment.teacher.google_sheet_id
    if not target_sheet_id:
        raise HTTPException(status_code=400, detail="No Google Sheet configured for this class or faculty member.")

    section = assignment.section
    if not section:
        raise HTTPException(status_code=400, detail="No section associated with this class assignment.")

    from app.services.gsheets_service import GoogleSheetsService
    from app.core.config import settings
    from app.models.models import Student, User, UserRole
    from app.core.security import get_password_hash

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
            raise HTTPException(status_code=400, detail="Sheet has no student rows (expected student rows starting row 7)")

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
            "message": f"Successfully synchronized {synced_count} students into {section.name} from class Google Sheet!",
            "synced_count": synced_count,
            "section_name": section.name,
            "google_sheet_id": target_sheet_id
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Admin sync roster from sheet failed for assignment {assignment_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to sync roster from Google Sheet: {str(e)}")

@router.post("/assignments/{assignment_id}/format-sheet")
def admin_format_assignment_google_sheet(
    assignment_id: int,
    req: Optional[AssignmentGSheetUpdate] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """
    Admin: Formats the class Google Sheet according to the official SNIST Attendance Register template
    and populates it with all currently enrolled students in the assigned section.
    """
    assignment = db.query(TeacherAssignment).options(
        joinedload(TeacherAssignment.section).joinedload(Section.department),
        joinedload(TeacherAssignment.section).joinedload(Section.academic_year),
        joinedload(TeacherAssignment.subject),
        joinedload(TeacherAssignment.teacher)
    ).filter(TeacherAssignment.id == assignment_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Class assignment not found")

    target_sheet_id = None
    if req and req.google_sheet_id and req.google_sheet_id.strip():
        target_sheet_id = extract_spreadsheet_id(req.google_sheet_id.strip())
        if target_sheet_id != assignment.google_sheet_id:
            assignment.google_sheet_id = target_sheet_id
            db.commit()

    if not target_sheet_id:
        target_sheet_id = assignment.google_sheet_id
    if not target_sheet_id and assignment.teacher:
        target_sheet_id = assignment.teacher.google_sheet_id
    if not target_sheet_id:
        raise HTTPException(status_code=400, detail="No Google Sheet configured for this class assignment.")

    section = assignment.section
    if not section:
        raise HTTPException(status_code=400, detail="No section associated with this class assignment.")

    from app.services.gsheets_service import GoogleSheetsService
    from app.core.config import settings
    from app.models.models import Student

    students = db.query(Student).filter(Student.section_id == section.id).order_by(Student.roll_number.asc()).all()
    students_list = [
        {
            "roll_number": s.roll_number,
            "name": s.name or s.roll_number,
            "agency": s.agency or "Regular"
        }
        for s in students
    ]

    dept_name = section.department.name.upper() if (section and section.department) else "ENGINEERING"
    acad_name = section.academic_year.name if (section and section.academic_year) else "2026-27"
    batch_info = f"SECTION:{section.name}  AY:{acad_name}"

    creds_file = settings.GOOGLE_CREDENTIALS_FILE or os.path.join(settings.BACKEND_DIR, "credentials.json")
    try:
        res = GoogleSheetsService.format_and_populate_snist_sheet(
            credentials_json=creds_file,
            spreadsheet_id=target_sheet_id,
            students=students_list,
            dept_name=dept_name,
            batch_info=batch_info
        )
        if not res.get("success", False):
            raise HTTPException(status_code=500, detail=f"Google Sheets API error: {res.get('error')}")

        return {
            "status": "SUCCESS",
            "message": f"Successfully initialized and formatted official SNIST sheet with {len(students_list)} students!",
            "student_count": len(students_list),
            "google_sheet_id": target_sheet_id,
            "google_sheet_url": f"https://docs.google.com/spreadsheets/d/{target_sheet_id}/edit"
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Admin format sheet failed for assignment {assignment_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to format Google Sheet: {str(e)}")

# --- Student Management & Bulk Excel Import ---
@router.get("/students")
def get_students(
    page: Optional[int] = None,
    page_size: int = 20,
    department_id: Optional[int] = None,
    academic_year_id: Optional[int] = None,
    section_id: Optional[int] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db), 
    current_user: User = Depends(get_current_user)
):
    # Single round-trip with eager loads for department, academic year, and section
    query = db.query(Student).options(
        joinedload(Student.department),
        joinedload(Student.academic_year),
        joinedload(Student.section)
    )

    if department_id:
        query = query.filter(Student.department_id == department_id)
    if academic_year_id:
        query = query.filter(Student.academic_year_id == academic_year_id)
    if section_id:
        query = query.filter(Student.section_id == section_id)
    if search:
        s_term = f"%{search.strip()}%"
        query = query.filter(or_(Student.name.ilike(s_term), Student.roll_number.ilike(s_term)))

    # Return paginated envelope if page is passed; otherwise plain list for backward compatibility
    if page is not None:
        total = query.count()
        page_num = max(1, page)
        limit_val = max(1, min(100, page_size))
        offset_val = (page_num - 1) * limit_val
        students = query.order_by(Student.id.asc()).offset(offset_val).limit(limit_val).all()
        
        items = [{
            "id": s.id,
            "roll_number": s.roll_number,
            "name": s.name,
            "department": s.department.code if s.department else "",
            "department_id": s.department_id,
            "year": s.academic_year.name if s.academic_year else "",
            "academic_year_id": s.academic_year_id,
            "section": s.section.name if s.section else "",
            "section_id": s.section_id,
            "email": s.email,
            "mobile": s.mobile,
            "agency": s.agency
        } for s in students]

        import math
        return {
            "items": items,
            "total": total,
            "page": page_num,
            "page_size": limit_val,
            "total_pages": math.ceil(total / limit_val) if total > 0 else 1
        }

    students = query.all()
    res = []
    for s in students:
        res.append({
            "id": s.id,
            "roll_number": s.roll_number,
            "name": s.name,
            "department": s.department.code if s.department else "",
            "department_id": s.department_id,
            "year": s.academic_year.name if s.academic_year else "",
            "academic_year_id": s.academic_year_id,
            "section": s.section.name if s.section else "",
            "section_id": s.section_id,
            "email": s.email,
            "mobile": s.mobile,
            "agency": s.agency
        })
    return res

@router.post("/students")
def create_student(req: StudentCreate, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    if db.query(Student).filter(Student.roll_number == req.roll_number).first():
        raise HTTPException(status_code=400, detail=f"Roll number {req.roll_number} already exists")

    # Create student account user
    user = User(
        username=req.roll_number,
        email=req.email,
        password_hash=get_password_hash(req.roll_number), # Default password = Roll Number
        role=UserRole.STUDENT
    )
    db.add(user)
    db.flush()

    student = Student(
        user_id=user.id,
        roll_number=req.roll_number.upper(),
        name=req.name,
        department_id=req.department_id,
        academic_year_id=req.academic_year_id,
        section_id=req.section_id,
        email=req.email,
        mobile=req.mobile,
        agency=req.agency or "Regular"
    )
    db.add(student)
    db.commit()

    return {"message": "Student created successfully", "id": student.id}

@router.post("/students/import-excel")
async def import_students_excel(
    file: UploadFile = File(...),
    department_id: int = Form(...),
    academic_year_id: int = Form(...),
    section_id: int = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    temp_path = os.path.join(settings.DATA_DIR, f"temp_import_{file.filename}")
    with open(temp_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    try:
        student_records = ExcelAttendanceService.parse_student_import_excel(temp_path)
        imported_count = 0
        skipped_count = 0

        for s_data in student_records:
            roll = str(s_data["roll_number"]).strip().upper()
            if not roll or roll.lower() == "roll no":
                continue

            if db.query(Student).filter(Student.roll_number == roll).first():
                skipped_count += 1
                continue

            raw_email = (s_data.get("email") or "").strip().lower()
            email_val = raw_email if (raw_email and "@" in raw_email) else f"{roll.lower()}@student.edu"
            
            # Prevent duplicate email collision
            if db.query(User).filter(User.email == email_val).first():
                email_val = f"{roll.lower()}.student@college.edu"

            user = User(
                username=roll,
                email=email_val,
                password_hash=get_password_hash(roll),
                role=UserRole.STUDENT
            )
            db.add(user)
            db.flush()

            # Auto-detect department and section from Roll Number branch code (e.g., A01 -> CIVIL, A05 -> CSE)
            student_dept_id = department_id
            student_sec_id = section_id

            target_dept_code = None
            if "A01" in roll: target_dept_code = "CIVIL"
            elif "A05" in roll: target_dept_code = "CSE"
            elif "A04" in roll: target_dept_code = "ECE"
            elif "A03" in roll: target_dept_code = "MECH"
            elif "A12" in roll: target_dept_code = "IT"
            elif "A02" in roll: target_dept_code = "EEE"

            if target_dept_code:
                detected_dept = db.query(Department).filter(Department.code == target_dept_code).first()
                if not detected_dept:
                    detected_dept = Department(code=target_dept_code, name=f"{target_dept_code} Engineering")
                    db.add(detected_dept)
                    db.flush()
                student_dept_id = detected_dept.id

                sec_name = f"{target_dept_code}-A"
                detected_sec = db.query(Section).filter(Section.name == sec_name).first()
                if not detected_sec:
                    detected_sec = Section(name=sec_name, department_id=detected_dept.id, academic_year_id=academic_year_id)
                    db.add(detected_sec)
                    db.flush()
                student_sec_id = detected_sec.id

            student = Student(
                user_id=user.id,
                roll_number=roll,
                name=s_data.get("name") or f"Student {roll}",
                department_id=student_dept_id,
                academic_year_id=academic_year_id,
                section_id=student_sec_id,
                email=email_val,
                mobile=s_data.get("mobile"),
                agency=s_data.get("agency") or "Regular"
            )
            db.add(student)
            imported_count += 1

        db.commit()
        return {
            "message": "Student import completed",
            "imported": imported_count,
            "skipped_duplicates": skipped_count
        }
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

# --- Master Excel Template Upload ---
@router.post("/master-template/upload")
async def upload_master_excel_template(file: UploadFile = File(...), current_user: User = Depends(require_admin)):
    if not file.filename.endswith(('.xlsx', '.xls')):
        raise HTTPException(status_code=400, detail="Only Excel files (.xlsx) supported")

    save_path = os.path.join(settings.MASTER_TEMPLATE_DIR, "Official_Attendance_Register.xlsx")
    with open(save_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    return {"message": f"Official Master Attendance Template updated successfully: {file.filename}"}

# --- Settings & Audit Logs ---
@router.get("/settings")
def get_settings(db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    items = db.query(SystemSettings).all()
    return {item.key: item.value for item in items}

@router.post("/settings")
def update_settings(data: SettingsUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    for key, val in data.settings.items():
        item = db.query(SystemSettings).filter(SystemSettings.key == key).first()
        if item:
            item.value = val
        else:
            db.add(SystemSettings(key=key, value=val))
    db.commit()
    return {"message": "Settings updated successfully"}

@router.get("/audit-logs")
def get_audit_logs(
    last_id: Optional[int] = None,
    limit: int = 20,
    page: Optional[int] = None,
    db: Session = Depends(get_db), 
    current_user: User = Depends(require_admin)
):
    # Eagerly load user in 1 query to prevent N+1 lazy loads per log entry
    query = db.query(AuditLog).options(joinedload(AuditLog.user))
    
    # Keyset cursor pagination on ID (uses clustered PK index, zero filesort on append-only table)
    if last_id is not None:
        query = query.filter(AuditLog.id < last_id)
        limit_val = max(1, min(100, limit))
        logs = query.order_by(AuditLog.id.desc()).limit(limit_val).all()
        
        items = [{
            "id": l.id,
            "username": l.user.username if l.user else "System",
            "roll_number": l.roll_number or "",
            "event_type": l.event_type or "",
            "action": l.action,
            "details": l.details,
            "timestamp": l.created_at.strftime("%Y-%m-%d %H:%M:%S") if l.created_at else ""
        } for l in logs]
        
        next_cursor = items[-1]["id"] if items else None
        return {
            "items": items,
            "next_cursor": next_cursor,
            "has_more": len(items) == limit_val
        }

    # Offset pagination if page is provided
    if page is not None:
        total = db.query(func.count(AuditLog.id)).scalar() or 0
        page_num = max(1, page)
        limit_val = max(1, min(100, limit))
        offset_val = (page_num - 1) * limit_val
        logs = query.order_by(AuditLog.id.desc()).offset(offset_val).limit(limit_val).all()
        
        items = [{
            "id": l.id,
            "username": l.user.username if l.user else "System",
            "roll_number": l.roll_number or "",
            "event_type": l.event_type or "",
            "action": l.action,
            "details": l.details,
            "timestamp": l.created_at.strftime("%Y-%m-%d %H:%M:%S") if l.created_at else ""
        } for l in logs]
        
        import math
        return {
            "items": items,
            "total": total,
            "page": page_num,
            "page_size": limit_val,
            "total_pages": math.ceil(total / limit_val) if total > 0 else 1
        }

    # Backward-compatible default 100 items with eager loading
    logs = query.order_by(AuditLog.id.desc()).limit(100).all()
    return [{
        "id": l.id,
        "username": l.user.username if l.user else "System",
        "action": l.action,
        "details": l.details,
        "timestamp": l.created_at.strftime("%Y-%m-%d %H:%M:%S") if l.created_at else ""
    } for l in logs]

@router.post("/export/students-google-sheet")
def export_students_google_sheet(db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    # Single query with eager loads for unpaginated batch export
    students = db.query(Student).options(
        joinedload(Student.department),
        joinedload(Student.academic_year),
        joinedload(Student.section)
    ).all()
    if not students:
        raise HTTPException(status_code=404, detail="No students found in database")

    student_list = []
    for s in students:
        student_list.append({
            "id": s.id,
            "roll_number": s.roll_number,
            "name": s.name,
            "department": s.department.name if s.department else "CSE",
            "academic_year": s.academic_year.name if s.academic_year else "3rd Year",
            "section": s.section.name if s.section else "CS-A",
            "email": s.email or "",
            "mobile": s.mobile or "",
            "agency": s.agency or "Regular"
        })

    creds_file = settings.GOOGLE_CREDENTIALS_FILE or os.getenv("GOOGLE_CREDENTIALS_FILE")
    if not creds_file:
        fallback_json = os.path.join(settings.BACKEND_DIR, "credentials.json")
        if os.path.exists(fallback_json):
            creds_file = fallback_json

    if not creds_file or not os.path.exists(creds_file):
        raise HTTPException(
            status_code=400,
            detail="Google Service Account credentials file not found. Please place credentials.json in backend/ directory or set GOOGLE_CREDENTIALS_FILE in .env."
        )

    res = GoogleSheetsService.create_and_populate_student_sheet(
        credentials_json=creds_file,
        students=student_list,
        title="Student Roster - AI QR Attendance System"
    )

    if not res.get("success"):
        raise HTTPException(status_code=500, detail=f"Google Sheets creation failed: {res.get('error')}")

    # Store spreadsheet ID in settings
    sp_id = res["spreadsheet_id"]
    item = db.query(SystemSettings).filter(SystemSettings.key == "GOOGLE_SPREADSHEET_ID").first()
    if item:
        item.value = sp_id
    else:
        db.add(SystemSettings(key="GOOGLE_SPREADSHEET_ID", value=sp_id, description="Google Sheets Spreadsheet ID"))
    db.commit()

    return res


@router.post("/security-alerts/test-send")
def send_test_security_alert(
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """
    Operator Verification Endpoint (Super Admin only).
    Renders and dispatches a test high-severity security alert to settings.SECURITY_ALERT_EMAIL.
    """
    import time
    t0 = time.perf_counter()
    from app.services.security_alert_service import EVENT_ACCOUNT_SWITCH
    from app.services.email_service import render_email_template, send_single_email
    from app.core.security import get_server_ist_datetime

    target_email = getattr(settings, "SECURITY_ALERT_EMAIL", "23311a05y6@cse.sreenidhi.edu.in")
    now_ist = get_server_ist_datetime().strftime("%d-%b-%Y %H:%M:%S")

    context = {
        "event_title": "Multi-Account Device Switching Detected (Test Send)",
        "event_type": EVENT_ACCOUNT_SWITCH,
        "severity": "CRITICAL",
        "subject_id": "23311A05Y6",
        "source_id": "DEV-TEST-VERIFY-001",
        "trigger_reason": "Manual operator verification from Admin Dashboard",
        "client_ip": "127.0.0.1",
        "audit_id": 9999,
        "details": "This is a synthetic verification alert to confirm end-to-end email delivery via Proofsy Zoho Mail channel and responsive HTML template rendering.",
        "recommended_action": "Verify email arrival in your inbox; confirm responsive HTML formatting and severity card display.",
        "timestamp_ist": now_ist,
        "admin_url": f"{getattr(settings, 'FRONTEND_URL', 'https://ather-os.de5.net').rstrip('/')}/admin"
    }

    html_content = render_email_template("security_alert_email.html", context)
    subject = "[SNIST SECURITY ALERT] [TEST] Security Alert Pipeline Verification"

    res = send_single_email(
        to_email=target_email,
        subject=subject,
        html_body=html_content,
        channel="PROOFSY"
    )

    latency_ms = round((time.perf_counter() - t0) * 1000, 2)

    # Record test dispatch in audit log
    # WHY: Provides full administrative accountability in qr_audit_logs for test alerts.
    try:
        test_audit = AuditLog(
            user_id=current_user.id,
            roll_number=current_user.username,
            event_type="SECURITY_ALERT_SENT",
            action="OPERATOR_TEST_ALERT_DISPATCHED",
            details=f"Super Admin {current_user.username} triggered test alert to {target_email}. Status: {res.get('status')}. Latency: {latency_ms}ms",
            ip_address="127.0.0.1",
            created_at=datetime.utcnow()
        )
        db.add(test_audit)
        db.commit()
    except Exception as a_err:
        logger.warning(f"Failed to record test alert audit entry: {a_err}")

    return {
        "status": res.get("status"),
        "target_email": target_email,
        "channel": res.get("channel"),
        "error": res.get("error"),
        "latency_ms": latency_ms,
        "server_time_ist": now_ist
    }


# =============================================================================
# ADMIN OPERATIONS & SYSTEM CONTROL CENTER  (/api/v1/admin/operations)
# Transforms manual maintenance scripts, recovery routines, cache invalidation,
# and device binding controls into authenticated one-click admin actions.
# Every route below is guarded by require_admin (SUPER_ADMIN role only → 403).
# =============================================================================

operations_router = APIRouter(prefix="/admin/operations", tags=["Admin Operations"])


class DeviceResetRequest(BaseModel):
    roll_number: str
    reason: str = "admin_reset"


class ClearLockoutsRequest(BaseModel):
    roll_number: Optional[str] = None
    ip_address: Optional[str] = None
    clear_all: bool = False


class RecalculateCacheRequest(BaseModel):
    roll_number: Optional[str] = None
    department_code: Optional[str] = None
    recalculate_all: bool = False


class ReseedDemoRequest(BaseModel):
    confirm_keyword: str


class ToggleBindingV2Request(BaseModel):
    enabled: bool


def _record_operation_audit(
    db: Session,
    current_user: User,
    action: str,
    details: str,
    request: Optional["Request"] = None,
    roll_number: Optional[str] = None,
):
    """Automatically log every administrative operation to the AuditLog table."""
    try:
        ip_addr = None
        if request is not None and getattr(request, "client", None) is not None:
            ip_addr = request.client.host
        entry = AuditLog(
            user_id=current_user.id,
            roll_number=roll_number or current_user.username,
            event_type="ADMIN_OPERATION",
            action=action,
            details=details,
            ip_address=ip_addr,
            created_at=datetime.utcnow(),
        )
        db.add(entry)
        db.commit()
    except Exception as audit_err:
        logger.warning(f"Failed to record admin operation audit '{action}': {audit_err}")
        try:
            db.rollback()
        except Exception:
            pass


# -----------------------------------------------------------------------------
# 1. Reset Student Device Binding
# -----------------------------------------------------------------------------
@operations_router.post("/device/reset")
def ops_reset_device_binding(
    payload: DeviceResetRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Revokes active cryptographic DeviceBinding (ECDSA P-256 keypair) records for a
    student, clears legacy registered_device_id, expires in-flight 30-minute
    DeviceAccountBinding windows, and unbinds the registered device ID so the
    student can re-enroll a fresh device on their next scan.
    """
    from app.core.device_security import reset_student_device_enrollment
    from app.models.models import DeviceBinding, DeviceAccountBinding, BindingStatus

    clean_roll = (payload.roll_number or "").strip().upper()
    if not clean_roll:
        raise HTTPException(status_code=400, detail="roll_number is required.")

    student = db.query(Student).filter(Student.roll_number == clean_roll).first()
    if not student:
        raise HTTPException(status_code=404, detail=f"Student with roll number '{clean_roll}' not found.")

    # Snapshot active bindings BEFORE revocation (for response metadata)
    revoked_key_ids = [
        b.key_id for b in db.query(DeviceBinding).filter(
            DeviceBinding.student_id == student.id,
            DeviceBinding.revoked_at.is_(None),
        ).all()
    ]

    # Core reset: revokes DeviceBinding keypairs + clears Student.registered_device_id
    reset_result = reset_student_device_enrollment(
        db=db,
        roll_number=clean_roll,
        admin_user_id=current_user.id,
        ip_address=request.client.host if request.client else None,
    )

    # Also expire any in-flight 30-minute device-account lockout bindings for this roll
    expired_windows = db.query(DeviceAccountBinding).filter(
        DeviceAccountBinding.roll_number == clean_roll,
        DeviceAccountBinding.status == BindingStatus.ACTIVE,
    ).update({DeviceAccountBinding.status: BindingStatus.REVOKED}, synchronize_session=False)
    db.commit()

    # Unbind the legacy registered device rows referenced by those keypairs
    unbound_devices = 0
    if revoked_key_ids:
        revoked_rows = db.query(DeviceBinding).filter(DeviceBinding.key_id.in_(revoked_key_ids)).all()
        client_device_ids = [r.device_id for r in revoked_rows if r.device_id]
        if client_device_ids:
            unbound_devices = db.query(DeviceRegistration).filter(
                DeviceRegistration.device_public_id.in_(client_device_ids),
                DeviceRegistration.is_active == True,
            ).update(
                {DeviceRegistration.is_active: False, DeviceRegistration.updated_at: datetime.utcnow()},
                synchronize_session=False,
            )
            db.commit()

    revoked_at = datetime.utcnow()
    _record_operation_audit(
        db, current_user,
        action="OPS_DEVICE_BINDING_RESET",
        details=(
            f"Admin {current_user.username} reset device binding for {clean_roll} "
            f"(reason={payload.reason}, keypairs_revoked={len(revoked_key_ids)}, "
            f"lockout_windows_expired={expired_windows}, devices_unbound={unbound_devices})"
        ),
        request=request,
        roll_number=clean_roll,
    )

    return {
        "success": True,
        "message": f"Device binding successfully reset for student {clean_roll}.",
        "roll_number": clean_roll,
        "reason": payload.reason,
        "keypairs_revoked": len(revoked_key_ids),
        "lockout_windows_expired": expired_windows,
        "devices_unbound": unbound_devices,
        "previous_device": reset_result.get("previous_device"),
        "revoked_at": revoked_at.isoformat(),
    }


# -----------------------------------------------------------------------------
# 2. Clear Student & IP Rate Limiters / Login Cooldowns
# -----------------------------------------------------------------------------
@operations_router.post("/security/clear-lockouts")
def ops_clear_lockouts(
    payload: ClearLockoutsRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Flushes failed_login_limiter (300s IP / 900s roll blocks), student_scan_limiter
    (per-roll scan attempts/min), and failed_token_tracker memory cooldowns —
    without restarting the server process.
    """
    from app.core.device_security import clear_security_lockouts

    clean_roll = (payload.roll_number or "").strip().upper() or None
    clean_ip = (payload.ip_address or "").strip() or None

    if not clean_roll and not clean_ip and not payload.clear_all:
        raise HTTPException(
            status_code=400,
            detail="Provide roll_number, ip_address, or set clear_all=true.",
        )

    cleared_roll, cleared_ip = clear_security_lockouts(
        roll_number=clean_roll,
        ip_address=clean_ip,
        clear_all=payload.clear_all,
    )

    _record_operation_audit(
        db, current_user,
        action="OPS_RATE_LIMITERS_CLEARED",
        details=f"Admin {current_user.username} cleared login/scan rate limiters (roll={cleared_roll or '-'}, ip={cleared_ip or '-'}, clear_all={payload.clear_all})",
        request=request,
        roll_number=clean_roll,
    )

    return {
        "success": True,
        "cleared_roll": cleared_roll,
        "cleared_ip": cleared_ip,
        "message": "Rate limiters and login cooldowns successfully cleared.",
    }


# -----------------------------------------------------------------------------
# 3. Recalculate Student Attendance & Invalidate Cache
# -----------------------------------------------------------------------------
@operations_router.post("/attendance/recalculate-cache")
def ops_recalculate_cache(
    payload: RecalculateCacheRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Invalidates the attendance engine TTL caches (redis/memory) and forces a cold
    JNTUH R25 threshold recomputation of percentage aggregates for one student,
    one department, or all students.
    """
    import time as _time
    from app.services.attendance_engine import (
        invalidate_attendance_cache,
        AttendanceEngine,
        _ENGINE_CACHE,
        _CACHE_LOCK,
    )

    t0 = _time.perf_counter()

    clean_roll = (payload.roll_number or "").strip().upper() or None
    dept_code = (payload.department_code or "").strip().upper() or None

    student_q = db.query(Student)
    if clean_roll:
        student_q = student_q.filter(Student.roll_number == clean_roll)
    elif dept_code:
        dept = db.query(Department).filter(Department.code == dept_code).first()
        if not dept:
            raise HTTPException(status_code=404, detail=f"Department '{dept_code}' not found.")
        student_q = student_q.filter(Student.department_id == dept.id)
    elif not payload.recalculate_all:
        raise HTTPException(
            status_code=400,
            detail="Provide roll_number, department_code, or set recalculate_all=true.",
        )

    students = student_q.all()
    if clean_roll and not students:
        raise HTTPException(status_code=404, detail=f"Student with roll number '{clean_roll}' not found.")

    recalculated = 0
    errors = []
    for s in students:
        try:
            # Step 1: purge stale cached aggregates for this student
            invalidate_attendance_cache(student_id=s.id, roll_number=s.roll_number)
            # Step 2: force cold recomputation across R25 thresholds (repopulates cache)
            AttendanceEngine.get_student_full_compliance(db=db, roll_number=s.roll_number, use_cache=True)
            recalculated += 1
        except Exception as calc_err:
            errors.append(f"{s.roll_number}: {calc_err}")

    # Always drop global admin/dept summary caches so dashboards reflect fresh numbers
    try:
        with _CACHE_LOCK:
            for k in [k for k in _ENGINE_CACHE.keys() if "admin_summary" in k or "dept:" in k]:
                _ENGINE_CACHE.pop(k, None)
    except Exception:
        pass

    elapsed_ms = round((_time.perf_counter() - t0) * 1000, 2)

    _record_operation_audit(
        db, current_user,
        action="OPS_ATTENDANCE_RECALCULATE",
        details=f"Admin {current_user.username} invalidated cache & recalculated attendance for {recalculated} student(s) (roll={clean_roll or '-'}, dept={dept_code or '-'}, all={payload.recalculate_all}). {elapsed_ms}ms",
        request=request,
        roll_number=clean_roll,
    )

    return {
        "success": True,
        "recalculated_records": recalculated,
        "elapsed_ms": elapsed_ms,
        "errors": errors[:10],
        "message": "Attendance cache invalidated and percentage aggregates updated.",
    }


# -----------------------------------------------------------------------------
# 4. Flush Async Attendance Writer Queue
# -----------------------------------------------------------------------------
@operations_router.post("/attendance/flush-queue")
def ops_flush_queue(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Inspects the in-memory AsyncAttendanceWriter queue, blocks until all queued
    pending scan jobs are written to the database (workers resolve duplicate
    race conditions themselves via IntegrityError handling), and reports status.
    """
    import time as _time
    from app.api.student import async_attendance_writer

    pending_before = async_attendance_writer._queue.qsize()

    flushed = 0
    wait_errors = []
    deadline = _time.time() + 15.0
    while _time.time() < deadline:
        try:
            async_attendance_writer._queue.join()  # blocks until all tasks are task_done()
            break
        except Exception as join_err:
            wait_errors.append(str(join_err))
            break

    pending_after = async_attendance_writer._queue.qsize()
    flushed = max(0, pending_before - pending_after)

    _record_operation_audit(
        db, current_user,
        action="OPS_ASYNC_QUEUE_FLUSH",
        details=f"Admin {current_user.username} flushed async attendance writer queue: pending_before={pending_before}, flushed={flushed}, remaining={pending_after}",
        request=request,
    )

    return {
        "success": True,
        "pending_queue_size": pending_before,
        "flushed_jobs": flushed,
        "remaining_queue_size": pending_after,
        "worker_pool_size": async_attendance_writer._num_workers,
        "wait_errors": wait_errors,
        "message": "Async attendance queue processed.",
    }


# -----------------------------------------------------------------------------
# 5. Database Health & Latency Benchmark (GET)
# -----------------------------------------------------------------------------
@operations_router.get("/diagnostics/benchmark")
def ops_diagnostics_benchmark(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Diagnostic benchmark: read/write latency, connection pool utilization,
    orphaned device binding integrity counts, and overall HEALTHY/DEGRADED status.
    """
    import time as _time
    from sqlalchemy import text as sql_text
    from app.core.database import engine
    from app.models.models import DeviceBinding

    t0 = _time.perf_counter()
    try:
        db.execute(sql_text("SELECT 1"))
        query_latency_ms = round((_time.perf_counter() - t0) * 1000, 3)
    except Exception as q_err:
        query_latency_ms = -1.0
        logger.warning(f"Benchmark read query failed: {q_err}")

    write_latency_ms = -1.0
    try:
        tw = _time.perf_counter()
        probe = AuditLog(
            user_id=current_user.id,
            roll_number=current_user.username,
            event_type="ADMIN_OPERATION",
            action="OPS_BENCHMARK_WRITE_PROBE",
            details="Diagnostics benchmark write probe",
            created_at=datetime.utcnow(),
        )
        db.add(probe)
        db.commit()
        write_latency_ms = round((_time.perf_counter() - tw) * 1000, 3)
        # Remove the synthetic probe row to keep audit logs clean
        db.delete(probe)
        db.commit()
    except Exception as w_err:
        logger.warning(f"Benchmark write probe failed: {w_err}")
        try:
            db.rollback()
        except Exception:
            pass

    total_students = db.query(func.count(Student.id)).scalar() or 0
    total_attendance_records = db.query(func.count(AttendanceRecord.id)).scalar() or 0
    active_bindings = db.query(func.count(DeviceBinding.id)).filter(
        DeviceBinding.revoked_at.is_(None)
    ).scalar() or 0

    valid_student_ids = [row[0] for row in db.query(Student.id).all()]
    orphaned_q = db.query(func.count(DeviceBinding.id)).filter(DeviceBinding.revoked_at.is_(None))
    if valid_student_ids:
        orphaned_q = orphaned_q.filter(~DeviceBinding.student_id.in_(valid_student_ids))
    orphaned_bindings = orphaned_q.scalar() or 0

    pool = engine.pool
    pool_status = {
        "pool_size": getattr(pool, "capacity", None),
        "checked_in": pool.checkedin(),
        "checked_out": pool.checkedout(),
        "overflow": pool.overflow(),
    }

    db_type = engine.dialect.name
    degraded = (
        query_latency_ms < 0
        or write_latency_ms < 0
        or query_latency_ms > 500
        or orphaned_bindings > 0
    )
    status_label = "DEGRADED" if degraded else "HEALTHY"

    _record_operation_audit(
        db, current_user,
        action="OPS_DB_BENCHMARK",
        details=f"Admin {current_user.username} ran DB benchmark: status={status_label}, read={query_latency_ms}ms, write={write_latency_ms}ms, students={total_students}, active_bindings={active_bindings}, orphaned={orphaned_bindings}",
        request=request,
    )

    return {
        "status": status_label,
        "db_type": db_type,
        "query_latency_ms": query_latency_ms,
        "write_latency_ms": write_latency_ms,
        "connection_pool": pool_status,
        "total_students": total_students,
        "active_bindings": active_bindings,
        "orphaned_bindings": orphaned_bindings,
        "total_attendance_records": total_attendance_records,
        "generated_at": datetime.utcnow().isoformat(),
    }


# -----------------------------------------------------------------------------
# 6. Re-Seed Demo Accounts
# -----------------------------------------------------------------------------
RESEED_CONFIRM_KEYWORD = "RESEED_SNIST_CONFIRM"


@operations_router.post("/diagnostics/reseed-demo")
def ops_reseed_demo(
    payload: ReseedDemoRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Runs seed_dev logic safely in dev/demo mode to ensure test students
    (e.g., 23311A0504) and demo faculty accounts exist with valid test passwords.
    Requires the exact confirmation keyword to prevent accidental execution.
    """
    if (payload.confirm_keyword or "").strip() != RESEED_CONFIRM_KEYWORD:
        raise HTTPException(
            status_code=400,
            detail=f"Confirmation keyword mismatch. Send confirm_keyword='{RESEED_CONFIRM_KEYWORD}' to proceed.",
        )

    env_mode = (getattr(settings, "ENVIRONMENT", "") or os.getenv("ENVIRONMENT", "")).lower()
    if env_mode and env_mode not in ("development", "dev", "demo", "test", "local"):
        raise HTTPException(
            status_code=403,
            detail=f"Demo re-seeding is disabled in '{env_mode}' environment. Only allowed in dev/demo/test mode.",
        )

    # Load seed_dev module defensively (project root may not be on sys.path in server context)
    seed_module = None
    try:
        import importlib.util
        root_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
        seed_path = os.path.join(root_dir, "seed_dev.py")
        if os.path.exists(seed_path):
            spec = importlib.util.spec_from_file_location("seed_dev", seed_path)
            seed_module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(seed_module)
    except Exception as load_err:
        logger.error(f"Could not load seed_dev.py for re-seed operation: {load_err}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Seeder module unavailable: {load_err}")

    accounts_touched = 0
    seed_output = []
    if seed_module is not None and hasattr(seed_module, "seed_database"):
        import io, contextlib
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf):
                seed_module.seed_database()
            seed_output = [ln for ln in buf.getvalue().splitlines() if ln.strip()][:20]
        except Exception as seed_err:
            logger.error(f"seed_database() execution failed: {seed_err}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Re-seed execution failed: {seed_err}")
        accounts_touched = sum(1 for ln in seed_output if "Created" in ln or "created" in ln)
    else:
        raise HTTPException(status_code=500, detail="seed_dev.seed_database() entrypoint not found.")

    # Guarantee the canonical demo test accounts exist even if the seeder skipped them
    demo_roll = "23311A0504"
    demo_student = db.query(Student).filter(Student.roll_number == demo_roll).first()
    if not demo_student:
        cse = db.query(Department).filter(Department.code == "CSE").first()
        ay = db.query(AcademicYear).filter(AcademicYear.name == "3rd Year").first()
        sec = db.query(Section).filter(Section.department_id == cse.id).first() if cse else None
        demo_user = db.query(User).filter(User.username == demo_roll).first()
        if not demo_user:
            demo_user = User(
                username=demo_roll,
                email=f"{demo_roll.lower()}@cse.sreenidhi.edu.in",
                password_hash=get_password_hash("student123"),
                role=UserRole.STUDENT,
                is_active=True,
            )
            db.add(demo_user)
            db.flush()
            accounts_touched += 1
        demo_student = Student(
            user_id=demo_user.id,
            roll_number=demo_roll,
            name="Demo Test Student",
            department_id=cse.id if cse else None,
            academic_year_id=ay.id if ay else None,
            section_id=sec.id if sec else None,
            agency="Regular",
        )
        db.add(demo_student)
        accounts_touched += 1
    db.commit()

    _record_operation_audit(
        db, current_user,
        action="OPS_RESEED_DEMO_ACCOUNTS",
        details=f"Admin {current_user.username} executed demo account re-seed. accounts_created_or_updated≈{accounts_touched}. Verified {demo_roll}.",
        request=request,
    )

    return {
        "success": True,
        "accounts_created_or_updated": accounts_touched,
        "demo_student_verified": demo_roll,
        "seeder_log": seed_output,
        "message": "Demo test accounts verified and refreshed.",
    }


# -----------------------------------------------------------------------------
# 7. Toggle Binding V2 Cryptographic Enforcement
# -----------------------------------------------------------------------------
@operations_router.post("/config/toggle-binding-v2")
def ops_toggle_binding_v2(
    payload: ToggleBindingV2Request,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Dynamically enables/disables settings.BINDING_V2 (live ECDSA P-256 possession
    proof enforcement) and persists the flag in the SystemSettings DB table.
    """
    new_flag = bool(payload.enabled)
    previous_flag = bool(getattr(settings, "BINDING_V2", False))
    settings.BINDING_V2 = new_flag

    item = db.query(SystemSettings).filter(SystemSettings.key == "BINDING_V2").first()
    if item:
        item.value = "true" if new_flag else "false"
    else:
        db.add(SystemSettings(
            key="BINDING_V2",
            value="true" if new_flag else "false",
            description="Cryptographic Device Binding V2 (WebCrypto ECDSA P-256) enforcement flag",
        ))
    db.commit()

    _record_operation_audit(
        db, current_user,
        action="OPS_TOGGLE_BINDING_V2",
        details=f"Admin {current_user.username} toggled BINDING_V2: {previous_flag} -> {new_flag}",
        request=request,
    )

    return {
        "success": True,
        "binding_v2_enabled": new_flag,
        "previous_state": previous_flag,
        "message": "Device Binding V2 enforcement updated.",
    }


# Register the operations router on the main admin router (defensive)
try:
    router.include_router(operations_router)
except Exception as ops_err:  # pragma: no cover
    logger.error(f"Failed to register Admin Operations router: {ops_err}", exc_info=True)


