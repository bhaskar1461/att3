import os
import shutil
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime

from app.core.database import get_db
from app.api.auth import get_current_user
from app.core.security import get_password_hash
from app.core.config import settings
from app.models.models import (
    User, UserRole, Department, AcademicYear, Section, Subject, 
    Teacher, Student, TeacherAssignment, SystemSettings, AuditLog, AttendanceRecord, AttendanceSession
)
from app.services.excel_service import ExcelAttendanceService
from app.services.qr_service import QRService
from app.services.gsheets_service import GoogleSheetsService

router = APIRouter(prefix="/admin", tags=["Super Admin"])

def require_admin(current_user: User = Depends(get_current_user)):
    if current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Super Admin permission required")
    return current_user

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

# --- Dashboard & Stats ---
@router.get("/dashboard-stats")
def get_dashboard_stats(db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    today_str = datetime.now().strftime("%Y-%m-%d")
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

    return {
        "total_students": total_students,
        "total_teachers": total_teachers,
        "total_departments": total_depts,
        "present_today": present_today,
        "absent_today": absent_today,
        "attendance_percentage": att_percentage,
        "active_live_classes": active_sessions
    }

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
    sections = db.query(Section).all()
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
    subjects = db.query(Subject).all()
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
def get_teachers(db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    teachers = db.query(Teacher).all()
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
    return {"message": "Teacher assigned successfully"}

@router.get("/assignments")
def list_assignments(db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    assignments = db.query(TeacherAssignment).all()
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
def get_students(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    students = db.query(Student).all()
    res = []
    for s in students:
        res.append({
            "id": s.id,
            "roll_number": s.roll_number,
            "name": s.name,
            "department": s.department.code if s.department else "",
            "year": s.academic_year.name if s.academic_year else "",
            "section": s.section.name if s.section else "",
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
def get_audit_logs(db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    logs = db.query(AuditLog).order_by(AuditLog.created_at.desc()).limit(100).all()
    res = []
    for l in logs:
        res.append({
            "id": l.id,
            "username": l.user.username if l.user else "System",
            "action": l.action,
            "details": l.details,
            "timestamp": l.created_at.strftime("%Y-%m-%d %H:%M:%S")
        })
    return res

@router.post("/export/students-google-sheet")
def export_students_google_sheet(db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    students = db.query(Student).all()
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
            "section": s.section.name if s.section else "CSE-A",
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

