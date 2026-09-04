from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session
from typing import Optional, List
from datetime import datetime

from app.core.database import get_db
from app.api.auth import get_current_user
from app.models.models import User, UserRole, AttendanceRecord, AttendanceSession, Student, Department, Section, Subject
from app.services.report_service import ReportService

router = APIRouter(prefix="/reports", tags=["Reports & Analytics"])

def fetch_filtered_records(
    db: Session,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    department_id: Optional[int] = None,
    section_id: Optional[int] = None,
    subject_id: Optional[int] = None
):
    query = db.query(AttendanceRecord)

    if start_date:
        query = query.filter(AttendanceRecord.session_date >= start_date)
    if end_date:
        query = query.filter(AttendanceRecord.session_date <= end_date)
    if department_id:
        query = query.join(Student).filter(Student.department_id == department_id)
    if section_id:
        query = query.join(Student).filter(Student.section_id == section_id)

    records = query.all()
    res = []
    for r in records:
        res.append({
            "roll_number": r.roll_number,
            "student_name": r.student.name if r.student else "",
            "department": r.student.department.code if r.student and r.student.department else "",
            "section": r.student.section.name if r.student and r.student.section else "",
            "subject": r.session.subject.name if r.session and r.session.subject else "",
            "status": r.status.value,
            "date": r.session_date
        })
    return res

from fastapi import Request
from app.core.security import decode_access_token

def get_report_user(
    request: Request,
    token: Optional[str] = Query(None),
    db: Session = Depends(get_db)
) -> User:
    auth_header = request.headers.get("Authorization", "")
    token_str = None
    if auth_header.startswith("Bearer "):
        token_str = auth_header.split("Bearer ")[1].strip()
    elif token:
        token_str = token.strip()

    if not token_str:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token required for report export",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = decode_access_token(token_str)
    if not payload or not payload.get("sub"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    username = payload.get("sub")
    user = db.query(User).filter(User.username == username).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User inactive or not found")
    return user

@router.get("/export/excel")
def export_excel_report(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    department_id: Optional[int] = None,
    section_id: Optional[int] = None,
    token: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_report_user)
):
    records = fetch_filtered_records(db, start_date, end_date, department_id, section_id)
    excel_bytes = ReportService.generate_excel_report(records, title="Attendance Register Export")
    filename = f"Attendance_Export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    return Response(
        content=excel_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@router.get("/export/csv")
def export_csv_report(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    department_id: Optional[int] = None,
    section_id: Optional[int] = None,
    token: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_report_user)
):
    records = fetch_filtered_records(db, start_date, end_date, department_id, section_id)
    csv_str = ReportService.generate_csv_report(records)
    filename = f"Attendance_Export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    return Response(
        content=csv_str,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@router.get("/export/pdf")
def export_pdf_report(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    department_id: Optional[int] = None,
    section_id: Optional[int] = None,
    token: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_report_user)
):
    records = fetch_filtered_records(db, start_date, end_date, department_id, section_id)
    pdf_bytes = ReportService.generate_pdf_report(records, title="Official Attendance Report")
    filename = f"Attendance_Export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@router.get("/low-attendance")
def get_low_attendance_report(threshold: float = 75.0, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    students = db.query(Student).all()
    low_att_list = []

    for s in students:
        records = db.query(AttendanceRecord).filter(AttendanceRecord.student_id == s.id).all()
        total = len(records)
        present = sum(1 for r in records if r.status.value in ["PRESENT", "4"])
        pct = round((present / total * 100), 1) if total > 0 else 100.0

        if pct < threshold:
            low_att_list.append({
                "student_id": s.id,
                "roll_number": s.roll_number,
                "student_name": s.name,
                "department": s.department.code if s.department else "",
                "section": s.section.name if s.section else "",
                "total_classes": total,
                "attended": present,
                "percentage": pct
            })

    return low_att_list

@router.get("/class-sheet-matrix")
def get_class_sheet_matrix(
    section_id: Optional[int] = None,
    subject_id: Optional[int] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Returns an Excel-style attendance register matrix for specific classes/sections.
    Provides date-by-date attendance columns for teachers and administrators.
    """
    query_students = db.query(Student)
    if section_id:
        query_students = query_students.filter(Student.section_id == section_id)
    students = query_students.order_by(Student.roll_number).all()

    session_query = db.query(AttendanceSession)
    if section_id:
        session_query = session_query.filter(AttendanceSession.section_id == section_id)
    if subject_id:
        session_query = session_query.filter(AttendanceSession.subject_id == subject_id)
    if start_date:
        session_query = session_query.filter(AttendanceSession.session_date >= start_date)
    if end_date:
        session_query = session_query.filter(AttendanceSession.session_date <= end_date)

    sessions = session_query.order_by(AttendanceSession.session_date).all()
    distinct_dates = sorted(list(set(s.session_date for s in sessions)))
    session_ids = [s.id for s in sessions]

    records = db.query(AttendanceRecord).filter(AttendanceRecord.session_id.in_(session_ids)).all() if session_ids else []

    att_map = {}
    for r in records:
        key = (r.student_id, r.session_date)
        if r.status.value in ["PRESENT", "1", "2", "3", "4", "5", "6", "7", "8"]:
            status_val = str(r.period_count or 4)
        else:
            status_val = "A"
        att_map[key] = status_val

    matrix_rows = []
    for idx, s in enumerate(students, 1):
        daily_status = {}
        present_cnt = 0
        absent_cnt = 0
        
        for d in distinct_dates:
            st = att_map.get((s.id, d), "-")
            daily_status[d] = st
            if st != "-" and st != "A":
                present_cnt += 1
            elif st == "A":
                absent_cnt += 1

        total_marked = present_cnt + absent_cnt
        pct = round((present_cnt / total_marked * 100), 1) if total_marked > 0 else 100.0

        matrix_rows.append({
            "sno": idx,
            "student_id": s.id,
            "roll_number": s.roll_number,
            "name": s.name,
            "department": s.department.code if s.department else "",
            "section": s.section.name if s.section else "",
            "daily_status": daily_status,
            "total_sessions": len(distinct_dates),
            "present_count": present_cnt,
            "absent_count": absent_cnt,
            "percentage": pct
        })

    return {
        "dates": distinct_dates,
        "rows": matrix_rows,
        "total_students": len(students),
        "total_dates": len(distinct_dates)
    }
