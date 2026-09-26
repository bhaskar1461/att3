from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session
from typing import Optional, List
from datetime import datetime

from app.core.database import get_db
from app.api.auth import get_current_user, require_teacher, require_admin
from app.models.models import User, UserRole, AttendanceRecord, AttendanceSession, Student, Department, Section, Subject
from app.services.report_service import ReportService

router = APIRouter(prefix="/reports", tags=["Reports & Analytics"])

def fetch_filtered_records(
    db: Session,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    department_id: Optional[int] = None,
    section_id: Optional[int] = None,
    subject_id: Optional[int] = None,
    session_id: Optional[int] = None
):
    from sqlalchemy.orm import joinedload
    # Eagerly load relationships to eliminate N+1 WAN round-trips to remote MySQL
    query = db.query(AttendanceRecord).options(
        joinedload(AttendanceRecord.student).joinedload(Student.department),
        joinedload(AttendanceRecord.student).joinedload(Student.section),
        joinedload(AttendanceRecord.session).joinedload(AttendanceSession.subject)
    )

    if session_id:
        query = query.filter(AttendanceRecord.session_id == session_id)
    if start_date and not session_id:
        query = query.filter(AttendanceRecord.session_date >= start_date)
    if end_date and not session_id:
        query = query.filter(AttendanceRecord.session_date <= end_date)
    if department_id:
        query = query.join(Student).filter(Student.department_id == department_id)
    if section_id:
        query = query.join(Student).filter(Student.section_id == section_id)

    # Hard ceiling of 2,000 records prevents openpyxl memory spikes from triggering Linux OOM on 896MB VM
    records = query.order_by(AttendanceRecord.session_date.desc(), AttendanceRecord.id.desc()).limit(2000).all()
    res = []
    for r in records:
        status_val = r.status.value
        if getattr(r, "scan_mode", "") == "MANUAL":
            status_val = f"{status_val} (M)"
        res.append({
            "roll_number": r.roll_number,
            "student_name": r.student.name if r.student else "",
            "department": r.student.department.code if r.student and r.student.department else "",
            "section": r.student.section.name if r.student and r.student.section else "",
            "subject": r.session.subject.name if r.session and r.session.subject else "",
            "status": status_val,
            "scan_mode": getattr(r, "scan_mode", "QR"),
            "manual_reason": getattr(r, "manual_reason", None),
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
    if user.role not in [UserRole.TEACHER, UserRole.SUPER_ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: Report access and export is restricted to faculty and administrators."
        )
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

from fastapi.responses import StreamingResponse

def stream_filtered_records(
    db: Session,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    department_id: Optional[int] = None,
    section_id: Optional[int] = None
):
    from sqlalchemy.orm import joinedload
    query = db.query(AttendanceRecord).options(
        joinedload(AttendanceRecord.student).joinedload(Student.department),
        joinedload(AttendanceRecord.student).joinedload(Student.section),
        joinedload(AttendanceRecord.session).joinedload(AttendanceSession.subject)
    )

    if start_date:
        query = query.filter(AttendanceRecord.session_date >= start_date)
    if end_date:
        query = query.filter(AttendanceRecord.session_date <= end_date)
    if department_id:
        query = query.join(Student).filter(Student.department_id == department_id)
    if section_id:
        query = query.join(Student).filter(Student.section_id == section_id)

    # yield_per(200) prevents batch loading of unbounded rows into RAM, guaranteeing O(1) memory
    for r in query.order_by(AttendanceRecord.session_date.desc(), AttendanceRecord.id.desc()).yield_per(200):
        status_val = r.status.value
        if getattr(r, "scan_mode", "") == "MANUAL":
            status_val = f"{status_val} (M)"
        yield {
            "roll_number": r.roll_number,
            "student_name": r.student.name if r.student else "",
            "department": r.student.department.code if r.student and r.student.department else "",
            "section": r.student.section.name if r.student and r.student.section else "",
            "subject": r.session.subject.name if r.session and r.session.subject else "",
            "status": status_val,
            "scan_mode": getattr(r, "scan_mode", "QR"),
            "manual_reason": getattr(r, "manual_reason", None),
            "date": r.session_date
        }

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
    records_iter = stream_filtered_records(db, start_date, end_date, department_id, section_id)
    filename = f"Attendance_Export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        ReportService.stream_csv_report(records_iter),
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

from app.core.config import R25Config

@router.get("/low-attendance")
def get_low_attendance_report(threshold: float = R25Config.ELIGIBLE_THRESHOLD, db: Session = Depends(get_db), current_user: User = Depends(require_teacher)):
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
    current_user: User = Depends(require_teacher)
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

@router.get("/session/{session_id}")
def get_session_attendance_report(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_report_user)
):
    """
    Returns verified attendance records for a specific session, tagging manual entries with (M).
    """
    session = db.query(AttendanceSession).filter(AttendanceSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if current_user.role == UserRole.TEACHER:
        if not current_user.teacher_profile or session.teacher_id != current_user.teacher_profile.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to view this session report"
            )

    records = db.query(AttendanceRecord).filter(AttendanceRecord.session_id == session_id).order_by(AttendanceRecord.id.asc()).all()
    res = []
    for r in records:
        status_val = r.status.value
        is_manual = (getattr(r, "scan_mode", "") == "MANUAL" or getattr(r, "manual_reason", None) is not None)
        if is_manual:
            status_val = f"{status_val} (M)"
        res.append({
            "record_id": r.id,
            "roll_number": r.roll_number,
            "status": status_val,
            "is_manual": is_manual,
            "manual_reason": getattr(r, "manual_reason", None),
            "manual_reason_detail": getattr(r, "manual_reason_detail", None),
            "scan_mode": getattr(r, "scan_mode", "QR"),
            "session_date": r.session_date
        })

    return {
        "session_id": session_id,
        "session_date": session.session_date,
        "period": session.period,
        "total_records": len(res),
        "attendance_records": res
    }


import uuid
import time
import threading
from pydantic import BaseModel
from typing import Dict, Any

class ReportRequestPayload(BaseModel):
    type: str = "register"
    range: str = "week"
    format: str = "xlsx"
    session_id: Optional[int] = None

_report_jobs: Dict[str, Dict[str, Any]] = {}
_report_jobs_lock = threading.Lock()

@router.post("/request")
def request_report_job(
    payload: ReportRequestPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_report_user)
):
    from datetime import timedelta
    from app.core.security import get_server_ist_datetime

    report_id = f"rep_{uuid.uuid4().hex[:12]}"
    now_ist = get_server_ist_datetime()
    today_str = now_ist.strftime("%Y-%m-%d")

    if payload.range == "today":
        start_date = today_str
    elif payload.range == "month":
        start_date = (now_ist - timedelta(days=30)).strftime("%Y-%m-%d")
    else:  # default week
        start_date = (now_ist - timedelta(days=7)).strftime("%Y-%m-%d")

    end_date = today_str

    with _report_jobs_lock:
        _report_jobs[report_id] = {
            "id": report_id,
            "status": "building",
            "type": payload.type,
            "range": payload.range,
            "format": payload.format,
            "session_id": payload.session_id,
            "created_at": time.time(),
            "download_url": None,
            "file_bytes": None,
            "filename": None,
            "error": None,
        }

    def _worker(rep_id: str, s_date: str, e_date: str, fmt: str, s_id: Optional[int]):
        from app.core.database import SessionLocal
        worker_db = SessionLocal()
        try:
            # Slight delay to ensure frontend observes building state on poll
            time.sleep(0.4)
            records = fetch_filtered_records(worker_db, start_date=s_date, end_date=e_date, session_id=s_id)

            # Traversing real backend chain: reports.py -> report_service.py -> excel_service.py
            title = f"Attendance Register - Session #{s_id}" if s_id else "Weekly Attendance Register"
            if fmt.lower() in ["xlsx", "excel"]:
                excel_bytes = ReportService.generate_weekly_register(records, title=title)
                filename = f"Attendance_Register_Session_{s_id}_{today_str}.xlsx" if s_id else f"Attendance_Register_Weekly_{today_str}.xlsx"
            elif fmt.lower() == "csv":
                csv_str = ReportService.generate_csv_report(records)
                excel_bytes = csv_str.encode("utf-8")
                filename = f"Attendance_Register_Session_{s_id}_{today_str}.csv" if s_id else f"Attendance_Register_Weekly_{today_str}.csv"
            else:
                excel_bytes = ReportService.generate_weekly_register(records, title=title)
                filename = f"Attendance_Register_Session_{s_id}_{today_str}.xlsx" if s_id else f"Attendance_Register_Weekly_{today_str}.xlsx"

            with _report_jobs_lock:
                if rep_id in _report_jobs:
                    _report_jobs[rep_id].update({
                        "status": "ready",
                        "download_url": f"/api/v1/reports/download/{rep_id}",
                        "file_bytes": excel_bytes,
                        "filename": filename,
                    })
        except Exception as e:
            with _report_jobs_lock:
                if rep_id in _report_jobs:
                    _report_jobs[rep_id].update({
                        "status": "failed",
                        "error": str(e),
                    })
        finally:
            worker_db.close()

    t = threading.Thread(target=_worker, args=(report_id, start_date, end_date, payload.format, payload.session_id), daemon=True)
    t.start()

    return {
        "id": report_id,
        "status": "building",
        "created_at": now_ist.isoformat(),
    }

@router.get("/download/{report_id}")
def download_report_file(
    report_id: str,
    token: Optional[str] = Query(None),
    current_user: User = Depends(get_report_user)
):
    with _report_jobs_lock:
        job = _report_jobs.get(report_id)
    if not job or job.get("status") != "ready" or not job.get("file_bytes"):
        raise HTTPException(status_code=404, detail="Report not ready or expired")

    filename = job.get("filename", f"Attendance_Register_{report_id}.xlsx")
    media_type = (
        "text/csv"
        if filename.endswith(".csv")
        else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )

    return Response(
        content=job["file_bytes"],
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@router.get("/{report_id}")
def get_report_job_status(
    report_id: str,
    token: Optional[str] = Query(None),
    current_user: User = Depends(get_report_user)
):
    with _report_jobs_lock:
        job = _report_jobs.get(report_id)
    if not job:
        raise HTTPException(status_code=404, detail="Report request not found")

    return {
        "id": job["id"],
        "status": job["status"],
        "download_url": job.get("download_url"),
        "error": job.get("error"),
    }


