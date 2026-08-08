import os
from datetime import datetime
from typing import Optional, Dict, Any, List
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.core.database import get_db
from app.api.auth import get_current_user
from app.core.config import settings
from app.models.models import (
    User, UserRole, Student, AttendanceSession, AttendanceRecord, 
    AttendanceStatus, SessionStatus, SystemSettings
)
from app.services.qr_service import QRService
from app.services.excel_service import ExcelAttendanceService
from app.services.gsheets_service import GoogleSheetsService

router = APIRouter(prefix="/attendance", tags=["Attendance Engine"])

class QRScanRequest(BaseModel):
    session_id: int
    qr_payload: str # Encrypted QR JSON or string token
    period_count: int = 4  # Custom period count (1-4), default 4 for on-time students

class SingleScanItem(BaseModel):
    session_id: int
    qr_payload: str
    period_count: Optional[int] = 4
    scanned_at: Optional[str] = None

class BatchScanRequest(BaseModel):
    scans: List[SingleScanItem]

class ManualMarkRequest(BaseModel):
    session_id: int
    roll_number: str
    status: str # PRESENT or ABSENT
    period_count: Optional[int] = 4

def _async_post_scan_tasks(
    roll_number: str,
    date_formatted: str,
    student_name: str,
    dept_code: str,
    year_name: str,
    sec_name: str,
    sub_name: str,
    period: str,
    teacher_name: str,
    gs_id: str,
    period_count: Any = 4
):
    master_excel_path = os.path.join(settings.MASTER_TEMPLATE_DIR, "Official_Attendance_Register.xlsx")
    status_str = str(period_count)
    if os.path.exists(master_excel_path):
        try:
            ExcelAttendanceService.record_attendance_in_excel(
                file_path=master_excel_path,
                roll_number=roll_number,
                date_str=date_formatted,
                status_code=status_str,
                overwrite=True
            )
        except Exception as ex:
            print(f"Excel Update Warning: {str(ex)}")

    if gs_id:
        try:
            creds_file = settings.GOOGLE_CREDENTIALS_FILE or os.path.join(settings.BACKEND_DIR, "credentials.json")
            GoogleSheetsService.record_attendance_in_gsheet(
                credentials_json=creds_file,
                spreadsheet_id=gs_id,
                roll_number=roll_number,
                date_str=date_formatted,
                status_code=status_str,
                period_total="4"
            )
        except Exception as ex:
            print(f"GSheets Sync Warning: {str(ex)}")

@router.post("/scan")
def process_qr_scan(
    req: QRScanRequest, 
    background_tasks: BackgroundTasks, 
    db: Session = Depends(get_db), 
    current_user: User = Depends(get_current_user)
):
    # 1. Fetch Session
    session = db.query(AttendanceSession).filter(AttendanceSession.id == req.session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Attendance session not found")
    if session.status == SessionStatus.LOCKED:
        raise HTTPException(status_code=400, detail="Attendance session is locked")

    # 2. Robust Validate QR Payload (V2 primary student_id or V1 roll_number)
    raw_payload = req.qr_payload.strip()
    student = None
    roll_number = None

    try:
        qr_data = QRService.validate_scanned_qr(raw_payload)
        if qr_data:
            if qr_data.get("studentId"):
                student = db.query(Student).filter(Student.id == int(qr_data.get("studentId"))).first()
            if not student and qr_data.get("rollNumber"):
                roll_number = str(qr_data.get("rollNumber")).strip().upper()
    except Exception as e:
        pass

    if not student and roll_number:
        student = db.query(Student).filter(Student.roll_number == roll_number).first()

    if not student:
        # Fallback check: extract roll number directly from payload string
        raw_upper = raw_payload.upper()
        students = db.query(Student).all()
        for s in students:
            s_roll = s.roll_number.strip().upper()
            if s_roll in raw_upper or raw_upper in s_roll:
                student = s
                break

    if not student:
        raise HTTPException(status_code=400, detail="Invalid QR Code: Student record not found")

    # Enforce Security Rule: Student user cannot submit attendance for a different student!
    if current_user.role == UserRole.STUDENT and current_user.student_profile:
        if current_user.student_profile.id != student.id:
            from app.core.device_security import log_security_audit_event, SecurityEventType
            log_security_audit_event(
                db=db,
                event_type=SecurityEventType.ATTENDANCE_REJECTED,
                action="ATTENDANCE_REJECTED",
                details=f"Student {current_user.student_profile.roll_number} attempted submit for {student.roll_number}",
                user_id=current_user.id,
                roll_number=current_user.student_profile.roll_number
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Attendance submission rejected: You cannot submit attendance for another student account."
            )

    roll_number = student.roll_number

    # 4. Clamp period_count to 1-8
    period_count = max(1, min(8, req.period_count))

    # 5. Check & Update Existing or Create New Record
    existing = db.query(AttendanceRecord).filter(
        AttendanceRecord.session_id == req.session_id,
        AttendanceRecord.student_id == student.id
    ).first()

    now = datetime.utcnow()
    date_formatted = datetime.now().strftime("%d/%m/%Y")

    if existing:
        existing.status = AttendanceStatus.PRESENT
        existing.scanned_at = now
    else:
        new_record = AttendanceRecord(
            session_id=req.session_id,
            student_id=student.id,
            roll_number=roll_number,
            session_date=session.session_date,
            status=AttendanceStatus.PRESENT,
            scan_mode="QR",
            scanned_at=now
        )
        db.add(new_record)
    db.commit()

    # 6. Queue Excel & GSheets async background updates
    gs_id_setting = db.query(SystemSettings).filter(SystemSettings.key == "GOOGLE_SPREADSHEET_ID").first()
    gs_id = gs_id_setting.value if gs_id_setting else settings.GOOGLE_SPREADSHEET_ID

    background_tasks.add_task(
        _async_post_scan_tasks,
        roll_number=roll_number,
        date_formatted=date_formatted,
        student_name=student.name,
        dept_code=student.department.code if student.department else "",
        year_name=student.academic_year.name if student.academic_year else "",
        sec_name=student.section.name if student.section else "",
        sub_name=session.subject.name if session.subject else "",
        period=session.period,
        teacher_name=session.teacher.name if session.teacher else "",
        gs_id=gs_id,
        period_count=period_count
    )

    # 7. Return Instant Success Payload
    return {
        "status": "SUCCESS",
        "message": f"Attendance recorded for {student.name} ({period_count} periods)",
        "roll_number": roll_number,
        "student_name": student.name,
        "scanned_at": now.strftime("%H:%M:%S"),
        "excel_status": "QUEUED"
    }

@router.post("/batch-scan")
def process_batch_qr_scan(
    req: BatchScanRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    High-Speed Batch QR Scan Endpoint.
    Processes multiple QR scans in a single atomic database transaction.
    """
    if not req.scans:
        return {"status": "SUCCESS", "processed_count": 0, "results": []}

    results = []
    processed_count = 0
    now = datetime.utcnow()
    date_formatted = datetime.now().strftime("%d/%m/%Y")
    
    gs_id_setting = db.query(SystemSettings).filter(SystemSettings.key == "GOOGLE_SPREADSHEET_ID").first()
    gs_id = gs_id_setting.value if gs_id_setting else settings.GOOGLE_SPREADSHEET_ID

    for item in req.scans:
        session = db.query(AttendanceSession).filter(AttendanceSession.id == item.session_id).first()
        if not session or session.status == SessionStatus.LOCKED:
            results.append({"status": "FAILED", "reason": "Session invalid or locked"})
            continue

        raw_payload = item.qr_payload.strip()
        student = None
        roll_number = None

        try:
            qr_data = QRService.validate_scanned_qr(raw_payload)
            if qr_data:
                if qr_data.get("studentId"):
                    student = db.query(Student).filter(Student.id == int(qr_data.get("studentId"))).first()
                if not student and qr_data.get("rollNumber"):
                    roll_number = str(qr_data.get("rollNumber")).strip().upper()
        except Exception:
            pass

        if not student and roll_number:
            student = db.query(Student).filter(Student.roll_number == roll_number).first()

        if not student:
            results.append({"status": "FAILED", "reason": "Student not found"})
            continue

        roll_number = student.roll_number
        period_count = max(1, min(8, item.period_count or 4))

        existing = db.query(AttendanceRecord).filter(
            AttendanceRecord.session_id == item.session_id,
            AttendanceRecord.student_id == student.id
        ).first()

        if existing:
            existing.status = AttendanceStatus.PRESENT
            existing.scanned_at = now
        else:
            new_record = AttendanceRecord(
                session_id=item.session_id,
                student_id=student.id,
                roll_number=roll_number,
                session_date=session.session_date,
                status=AttendanceStatus.PRESENT,
                scan_mode="QR",
                scanned_at=now
            )
            db.add(new_record)

        processed_count += 1
        results.append({
            "status": "SUCCESS",
            "roll_number": roll_number,
            "student_name": student.name
        })

        # Queue async task per student
        background_tasks.add_task(
            _async_post_scan_tasks,
            roll_number=roll_number,
            date_formatted=date_formatted,
            student_name=student.name,
            dept_code=student.department.code if student.department else "",
            year_name=student.academic_year.name if student.academic_year else "",
            sec_name=student.section.name if student.section else "",
            sub_name=session.subject.name if session.subject else "",
            period=session.period,
            teacher_name=session.teacher.name if session.teacher else "",
            gs_id=gs_id,
            period_count=period_count
        )

    db.commit()

    return {
        "status": "SUCCESS",
        "processed_count": processed_count,
        "results": results
    }


@router.post("/manual-mark")
def manual_mark_attendance(
    req: ManualMarkRequest, 
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db), 
    current_user: User = Depends(get_current_user)
):
    session = db.query(AttendanceSession).filter(AttendanceSession.id == req.session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status == SessionStatus.LOCKED:
        raise HTTPException(status_code=400, detail="Session is locked")

    student = db.query(Student).filter(Student.roll_number == req.roll_number.strip().upper()).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    existing = db.query(AttendanceRecord).filter(
        AttendanceRecord.session_id == req.session_id,
        AttendanceRecord.student_id == student.id
    ).first()

    status_enum = AttendanceStatus.PRESENT if req.status.upper() in ["PRESENT", "1", "2", "3", "4"] else AttendanceStatus.ABSENT

    if existing:
        existing.status = status_enum
    else:
        new_record = AttendanceRecord(
            session_id=req.session_id,
            student_id=student.id,
            roll_number=student.roll_number,
            session_date=session.session_date,
            status=status_enum,
            scan_mode="MANUAL"
        )
        db.add(new_record)
    db.commit()

    # Queue Google Sheets & Master Excel background updates
    date_formatted = datetime.now().strftime("%d/%m/%Y")
    status_code = str(req.period_count or 4) if status_enum == AttendanceStatus.PRESENT else "A"

    gs_id_setting = db.query(SystemSettings).filter(SystemSettings.key == "GOOGLE_SPREADSHEET_ID").first()
    gs_id = gs_id_setting.value if gs_id_setting else settings.GOOGLE_SPREADSHEET_ID

    background_tasks.add_task(
        _async_post_scan_tasks,
        roll_number=student.roll_number,
        date_formatted=date_formatted,
        student_name=student.name,
        dept_code=student.department.code if student.department else "",
        year_name=student.academic_year.name if student.academic_year else "",
        sec_name=student.section.name if student.section else "",
        sub_name=session.subject.name if session.subject else "",
        period=session.period,
        teacher_name=session.teacher.name if session.teacher else "",
        gs_id=gs_id,
        period_count=status_code
    )

    return {"status": "SUCCESS", "message": f"Updated {student.name} ({student.roll_number}) to {status_code}"}

@router.post("/mark-all-absent")
def mark_all_students_absent(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db.query(AttendanceRecord).update({AttendanceRecord.status: AttendanceStatus.ABSENT})
    db.commit()

    gs_id_setting = db.query(SystemSettings).filter(SystemSettings.key == "GOOGLE_SPREADSHEET_ID").first()
    gs_id = gs_id_setting.value if gs_id_setting else settings.GOOGLE_SPREADSHEET_ID

    if gs_id:
        try:
            creds_file = settings.GOOGLE_CREDENTIALS_FILE or os.path.join(settings.BACKEND_DIR, "credentials.json")
            GoogleSheetsService.mark_all_absent(
                credentials_json=creds_file,
                spreadsheet_id=gs_id
            )
        except Exception as ex:
            print(f"GSheets Mark All Absent Error: {str(ex)}")

    return {"status": "SUCCESS", "message": "All students marked as ABSENT across system and Google Sheets"}
