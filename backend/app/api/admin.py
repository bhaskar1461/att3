import os
import shutil
import logging
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status

logger = logging.getLogger("snist_erp.admin")
from sqlalchemy import or_, func, case
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

    departments = db.query(Department).order_by(Department.name).all()
    
    dept_list = []
    accounted_students = 0
    
    for d in departments:
        count = counts_map.get(d.id, 0)
        pct = round((count / total_enrolled * 100), 1) if total_enrolled > 0 else 0.0
        d_defaulters = defaulters_by_code.get(d.code, 0)
        dept_list.append({
            "id": d.id,
            "code": d.code,
            "name": d.name,
            "count": count,
            "percentage": pct,
            "share_pct": pct,
            "defaulters_count": d_defaulters
        })
        accounted_students += count
        
    unassigned_count = total_enrolled - accounted_students
    if unassigned_count > 0:
        pct = round((unassigned_count / total_enrolled * 100), 1) if total_enrolled > 0 else 0.0
        u_defaulters = defaulters_by_code.get("UNASSIGNED", 0)
        dept_list.append({
            "id": -1,
            "code": "UNASSIGNED",
            "name": "Unassigned Department",
            "count": unassigned_count,
            "percentage": pct,
            "share_pct": pct,
            "defaulters_count": u_defaulters
        })

    return {
        "total_enrolled": total_enrolled,
        "unassigned_count": max(0, unassigned_count),
        "departments": dept_list
    }

@router.get("/analytics/enrollment/students")
def get_department_enrolled_students(
    dept_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """
    Level-2 drill-down: Lazy-loads students for a specific department with device and attendance telemetry.
    Uses batch queries (zero N+1) to resolve today's attendance, total session stats, and device details.
    """
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

    # Batch Query 1: Present today status
    today_present_query = db.query(AttendanceRecord.student_id).filter(
        AttendanceRecord.session_date == today_str,
        AttendanceRecord.student_id.in_(student_ids),
        AttendanceRecord.status.in_([
            AttendanceStatus.PRESENT, "PRESENT", "1", "2", "3", "4", "5", "6", "7", "8"
        ])
    ).distinct().all()
    today_present_set = {r[0] for r in today_present_query}

    # Batch Query 2: Attendance aggregation per student
    rec_aggregates = db.query(
        AttendanceRecord.student_id,
        func.count(AttendanceRecord.id).label("total_records"),
        func.sum(
            case(
                (AttendanceRecord.status.in_([
                    AttendanceStatus.PRESENT, "PRESENT", "1", "2", "3", "4", "5", "6", "7", "8"
                ]), 1),
                else_=0
            )
        ).label("present_records")
    ).filter(AttendanceRecord.student_id.in_(student_ids)).group_by(AttendanceRecord.student_id).all()

    stats_map = {row[0]: (row[1] or 0, int(row[2] or 0)) for row in rec_aggregates}

    # Batch Query 3: Device registration info for enrolled devices
    device_ids = [s.registered_device_id for s in students if s.registered_device_id]
    device_map = {}
    if device_ids:
        devices = db.query(DeviceRegistration).filter(DeviceRegistration.id.in_(device_ids)).all()
        device_map = {d.id: d for d in devices}

    results = []
    for s in students:
        dev = device_map.get(s.registered_device_id) if s.registered_device_id else None
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
        if dev:
            device_info = {
                "id": dev.id,
                "public_id": dev.device_public_id,
                "is_active": dev.is_active,
                "last_seen_at": dev.last_seen_at.strftime("%Y-%m-%d %H:%M:%S") if dev.last_seen_at else None,
                "first_registered_at": dev.first_registered_at.strftime("%Y-%m-%d %H:%M:%S") if dev.first_registered_at else None
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
            "registered_device_id": s.registered_device_id,
            "device_bound": s.registered_device_id is not None,
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
        for t in teachers:
            sp_id = t.google_sheet_id or ""
            sp_url = f"https://docs.google.com/spreadsheets/d/{sp_id}/edit" if sp_id else ""
            items.append({
                "id": t.id,
                "teacher_code": t.teacher_code,
                "name": t.name,
                "department": t.department.name if t.department else "",
                "department_id": t.department_id,
                "mobile": t.mobile,
                "username": t.user.username if t.user else "",
                "google_sheet_id": sp_id,
                "google_sheet_url": sp_url
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
    res = []
    for t in teachers:
        sp_id = t.google_sheet_id or ""
        sp_url = f"https://docs.google.com/spreadsheets/d/{sp_id}/edit" if sp_id else ""
        res.append({
            "id": t.id,
            "teacher_code": t.teacher_code,
            "name": t.name,
            "department": t.department.name if t.department else "",
            "department_id": t.department_id,
            "mobile": t.mobile,
            "username": t.user.username if t.user else "",
            "google_sheet_id": sp_id,
            "google_sheet_url": sp_url
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
    assignment = TeacherAssignment(teacher_id=req.teacher_id, subject_id=req.subject_id, section_id=req.section_id)
    db.add(assignment)
    db.commit()

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
        "message": "Teacher assigned successfully",
        "teacher_notified": teacher_notified,
    }

@router.get("/assignments")
def list_assignments(db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    # Eagerly load teacher, subject, section in 1 query
    assignments = db.query(TeacherAssignment).options(
        joinedload(TeacherAssignment.teacher),
        joinedload(TeacherAssignment.subject),
        joinedload(TeacherAssignment.section)
    ).all()
    res = []
    for a in assignments:
        res.append({
            "id": a.id,
            "teacher_name": a.teacher.name if a.teacher else "",
            "subject_name": a.subject.name if a.subject else "",
            "section_name": a.section.name if a.section else ""
        })
    return res

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


