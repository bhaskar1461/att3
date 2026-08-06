from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session
from typing import Optional, List
from datetime import datetime

from app.core.database import get_db
from app.api.auth import get_current_user
from app.models.models import User, UserRole, AttendanceRecord, Student, Department, Section, Subject
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

@router.get("/export/excel")
def export_excel_report(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    department_id: Optional[int] = None,
    section_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
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
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
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
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
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
