import os
import time
import logging
from datetime import datetime
from typing import Optional, Dict, Any, List
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks, Response
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.core.database import get_db
from app.api.auth import get_current_user
from app.core.config import settings
from app.models.models import (
    User, UserRole, Student, Teacher, AttendanceSession, AttendanceRecord, 
    AttendanceStatus, SessionStatus, SystemSettings
)
from app.services.qr_service import QRService
from app.services.excel_service import ExcelAttendanceService
from app.services.gsheets_service import GoogleSheetsService

logger = logging.getLogger("snist_erp.attendance_api")

router = APIRouter(prefix="/attendance", tags=["Attendance Engine"])

_SESSION_CACHE: Dict[int, Dict[str, Any]] = {}
_SESSION_CACHE_TTL = 30  # seconds

def get_cached_session_meta(db: Session, session_id: int) -> Optional[Dict[str, Any]]:
    # In test environments with in-memory SQLite, bypass global cache to prevent cross-test ID collision
    is_test_sqlite = False
    try:
        if db.bind and (str(db.bind.url).startswith("sqlite") or ":memory:" in str(db.bind.url)):
            is_test_sqlite = True
    except Exception:
        pass

    now_ts = time.time()
    if not is_test_sqlite:
        cached = _SESSION_CACHE.get(session_id)
        if cached and (now_ts - cached["cached_at"] < _SESSION_CACHE_TTL):
            return cached

    session = db.query(AttendanceSession).filter(AttendanceSession.id == session_id).first()
    if not session:
        return None

    teacher_gsheet = ""
    if session.teacher:
        teacher_gsheet = (session.teacher.google_sheet_id or "").strip()
    if not teacher_gsheet:
        setting = db.query(SystemSettings).filter(SystemSettings.key == "GOOGLE_SPREADSHEET_ID").first()
        teacher_gsheet = setting.value.strip() if (setting and setting.value) else getattr(settings, "GOOGLE_SPREADSHEET_ID", "")

    meta = {
        "id": session.id,
        "teacher_id": session.teacher_id,
        "subject_id": session.subject_id,
        "section_id": session.section_id,
        "period": session.period,
        "session_date": session.session_date,
        "status": session.status,
        "teacher_gsheet_id": teacher_gsheet,
        "section_name": session.section.name if session.section else "",
        "subject_name": session.subject.name if session.subject else "",
        "teacher_name": session.teacher.name if session.teacher else "",
        "dept_code": session.section.department.code if (session.section and session.section.department) else "",
        "year_name": session.section.academic_year.name if (session.section and session.section.academic_year) else "",
        "cached_at": now_ts
    }
    if not is_test_sqlite:
        _SESSION_CACHE[session_id] = meta
    return meta

def invalidate_session_cache(session_id: int):
    _SESSION_CACHE.pop(session_id, None)

class QRScanRequest(BaseModel):
    session_id: int
    qr_payload: str # Encrypted QR JSON or string token
    period_count: int = 4  # Custom period count (1-4), default 4 for on-time students
    allow_makeup: Optional[bool] = False # When True and teacher is authorized, accepts today's live QR for a previous session date

class SingleScanItem(BaseModel):
    session_id: int
    qr_payload: str
    period_count: Optional[int] = 4
    scanned_at: Optional[str] = None
    allow_makeup: Optional[bool] = False

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

def _get_effective_gsheet_id(db: Session, session: Optional[AttendanceSession]) -> str:
    try:
        if session and session.teacher_id:
            teacher = db.query(Teacher).filter(Teacher.id == session.teacher_id).first()
            if teacher and teacher.google_sheet_id:
                return teacher.google_sheet_id.strip()
        setting = db.query(SystemSettings).filter(SystemSettings.key == "GOOGLE_SPREADSHEET_ID").first()
        return setting.value.strip() if (setting and setting.value) else settings.GOOGLE_SPREADSHEET_ID
    except Exception:
        return getattr(settings, "GOOGLE_SPREADSHEET_ID", "")

@router.post("/scan")
def process_qr_scan(
    req: QRScanRequest, 
    background_tasks: BackgroundTasks, 
    response: Response,
    db: Session = Depends(get_db), 
    current_user: User = Depends(get_current_user)
):
    t0 = time.perf_counter()
    is_admin = (current_user.role == UserRole.SUPER_ADMIN)

    # 1. Fetch Session (Using in-memory TTL cache)
    session_meta = get_cached_session_meta(db, req.session_id)
    if not session_meta:
        raise HTTPException(status_code=404, detail="Attendance session not found")
    status_str = getattr(session_meta["status"], "value", str(session_meta["status"]))
    if status_str == "LOCKED" and not is_admin:
        raise HTTPException(status_code=400, detail="Attendance session is locked")

    # 2. Teacher Ownership Check (if user is teacher and not admin)
    if current_user.role == UserRole.TEACHER and current_user.teacher_profile and not is_admin:
        if session_meta["teacher_id"] != current_user.teacher_profile.id:
            raise HTTPException(status_code=403, detail="You do not own or have authorization for this attendance session")

    # 3. Robust Validate QR Payload (V2 primary student_id or V1 roll_number)
    raw_payload = req.qr_payload.strip()
    student = None
    roll_number = None
    qr_data = None

    try:
        qr_data = QRService.validate_scanned_qr(raw_payload)
        if qr_data:
            if qr_data.get("studentId"):
                student = db.query(Student).filter(Student.id == int(qr_data.get("studentId"))).first()
            if not student and qr_data.get("rollNumber"):
                roll_number = str(qr_data.get("rollNumber")).strip().upper()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid QR Code: {str(e)}")

    if not student and roll_number:
        student = db.query(Student).filter(Student.roll_number == roll_number).first()

    if not student:
        raise HTTPException(status_code=400, detail="Invalid QR Code: Student record not found")

    # 4. Server-Side Date-Mismatch Validation (Enforced for non-admins)
    is_makeup_scan = False
    if qr_data and not is_admin:
        qr_date = qr_data.get("qr_date") or qr_data.get("date")
        if qr_date and qr_date != session_meta["session_date"]:
            from app.core.security import get_server_ist_date
            server_today = get_server_ist_date()
            is_valid_makeup = (
                req.allow_makeup and 
                qr_date == server_today and 
                session_meta["session_date"] <= server_today and 
                current_user.role == UserRole.TEACHER
            )
            if is_valid_makeup:
                is_makeup_scan = True
                from app.core.device_security import log_security_audit_event, SecurityEventType
                log_security_audit_event(
                    db=db,
                    event_type=SecurityEventType.ATTENDANCE_SUBMITTED,
                    action="MAKEUP_ATTENDANCE_MARKED",
                    details=f"Teacher {current_user.username} accepted today's live QR ({qr_date}) for previous session {session_meta['id']} ({session_meta['session_date']}) for {student.roll_number}",
                    user_id=current_user.id,
                    roll_number=student.roll_number
                )
            else:
                from app.core.device_security import log_security_audit_event, SecurityEventType
                log_security_audit_event(
                    db=db,
                    event_type=SecurityEventType.ATTENDANCE_REJECTED,
                    action="DATE_MISMATCH_REJECTED",
                    details=f"QR Date ({qr_date}) mismatched Session Date ({session_meta['session_date']}) for {student.roll_number}",
                    user_id=current_user.id,
                    roll_number=student.roll_number
                )
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Attendance Rejected: Student QR Date ({qr_date}) does not match Selected Attendance Date ({session_meta['session_date']})."
                )

    # 5. Section Membership Check (Enforced for non-admins)
    if student.section_id != session_meta["section_id"] and not is_admin:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Attendance Rejected: Student {student.roll_number} does not belong to class section {session_meta['section_name']}."
        )

    # 6. Enforce Security Rule: Student user cannot submit attendance for a different student!
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

    # 7. Clamp period_count to 1-8
    period_count = max(1, min(8, req.period_count))

    # 8. Check & Update Existing or Create New Record (Duplicate & Period Change Handling)
    existing = db.query(AttendanceRecord).filter(
        AttendanceRecord.session_id == req.session_id,
        AttendanceRecord.student_id == student.id
    ).first()

    now = datetime.utcnow()
    date_formatted = datetime.now().strftime("%d/%m/%Y")

    if existing and existing.status == AttendanceStatus.PRESENT:
        prev_periods = existing.period_count or 4
        
        # Case A: Same period count selected -> Return Already Marked status
        if prev_periods == period_count:
            dur_ms = round((time.perf_counter() - t0) * 1000, 2)
            response.headers["Server-Timing"] = f"app;dur={dur_ms};desc=\"Already Marked\""
            return {
                "status": "ALREADY_MARKED",
                "message": f"Already Marked ({period_count} Periods): Student {student.name} ({roll_number}) is already present for {session_meta['session_date']} ({session_meta['period']})",
                "roll_number": roll_number,
                "student_name": student.name,
                "period_count": period_count,
                "session_date": session_meta["session_date"],
                "period": session_meta["period"]
            }
        else:
            # Case B: Period count reduced or increased -> Update Attendance Record & Sync Registers
            existing.period_count = period_count
            existing.scanned_at = now
            db.commit()

            gs_id = session_meta["teacher_gsheet_id"]
            background_tasks.add_task(
                _async_post_scan_tasks,
                roll_number=roll_number,
                date_formatted=date_formatted,
                student_name=student.name,
                dept_code=session_meta["dept_code"],
                year_name=session_meta["year_name"],
                sec_name=session_meta["section_name"],
                sub_name=session_meta["subject_name"],
                period=session_meta["period"],
                teacher_name=session_meta["teacher_name"],
                gs_id=gs_id,
                period_count=period_count
            )

            dur_ms = round((time.perf_counter() - t0) * 1000, 2)
            response.headers["Server-Timing"] = f"app;dur={dur_ms};desc=\"Period Updated\""
            logger.info(f"Attendance period count updated from {prev_periods} to {period_count} in {dur_ms}ms for roll {roll_number} (session {req.session_id})")

            return {
                "status": "PERIOD_UPDATED",
                "message": f"⚡ Attendance Period Updated: Student {student.name} ({roll_number}) updated to {period_count} Periods (Changed from {prev_periods} Periods)!",
                "roll_number": roll_number,
                "student_name": student.name,
                "period_count": period_count,
                "previous_period_count": prev_periods,
                "scanned_at": now.strftime("%H:%M:%S")
            }

    scan_mode_val = "QR_MAKEUP" if is_makeup_scan else "QR"
    if existing:
        existing.status = AttendanceStatus.PRESENT
        existing.period_count = period_count
        existing.scanned_at = now
        existing.scan_mode = scan_mode_val
    else:
        new_record = AttendanceRecord(
            session_id=req.session_id,
            student_id=student.id,
            roll_number=roll_number,
            session_date=session_meta["session_date"],
            period_count=period_count,
            status=AttendanceStatus.PRESENT,
            scan_mode=scan_mode_val,
            scanned_at=now
        )
        db.add(new_record)
    db.commit()

    # 9. Queue Excel & GSheets async background updates
    gs_id = session_meta["teacher_gsheet_id"]

    background_tasks.add_task(
        _async_post_scan_tasks,
        roll_number=roll_number,
        date_formatted=date_formatted,
        student_name=student.name,
        dept_code=session_meta["dept_code"],
        year_name=session_meta["year_name"],
        sec_name=session_meta["section_name"],
        sub_name=session_meta["subject_name"],
        period=session_meta["period"],
        teacher_name=session_meta["teacher_name"],
        gs_id=gs_id,
        period_count=period_count
    )

    dur_ms = round((time.perf_counter() - t0) * 1000, 2)
    response.headers["Server-Timing"] = f"app;dur={dur_ms};desc=\"Scan Processed\""
    logger.info(f"Scan processed in {dur_ms}ms for roll {roll_number} (session {req.session_id})")

    # 10. Return Instant Success Payload
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

    if current_user.role not in [UserRole.TEACHER, UserRole.SUPER_ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only faculty members or administrators are authorized to process batch attendance scans."
        )

    is_admin = (current_user.role == UserRole.SUPER_ADMIN)
    results = []
    processed_count = 0
    now = datetime.utcnow()
    date_formatted = datetime.now().strftime("%d/%m/%Y")
    
    # Resolves per-session effective Google Sheet ID dynamically inside scan loop

    for item in req.scans:
        session = db.query(AttendanceSession).filter(AttendanceSession.id == item.session_id).first()
        if not session or (session.status == SessionStatus.LOCKED and not is_admin):
            results.append({"status": "FAILED", "reason": "Session invalid or locked"})
            continue

        if current_user.role == UserRole.TEACHER and current_user.teacher_profile and not is_admin:
            if session.teacher_id != current_user.teacher_profile.id:
                results.append({"status": "FAILED", "reason": "Not authorized to submit scans for this session"})
                continue

        raw_payload = item.qr_payload.strip()
        student = None
        roll_number = None
        qr_data = None

        try:
            qr_data = QRService.validate_scanned_qr(raw_payload)
            if qr_data:
                if qr_data.get("studentId"):
                    student = db.query(Student).filter(Student.id == int(qr_data.get("studentId"))).first()
                if not student and qr_data.get("rollNumber"):
                    roll_number = str(qr_data.get("rollNumber")).strip().upper()
        except Exception as err:
            results.append({"status": "FAILED", "reason": f"QR decode error: {str(err)}"})
            continue

        if not student and roll_number:
            student = db.query(Student).filter(Student.roll_number == roll_number).first()

        if not student:
            results.append({"status": "FAILED", "reason": "Student not found"})
            continue

        is_batch_makeup = False
        if qr_data and not is_admin:
            qr_date = qr_data.get("qr_date") or qr_data.get("date")
            if qr_date and qr_date != session.session_date:
                from app.core.security import get_server_ist_date
                server_today = get_server_ist_date()
                is_valid_makeup = (
                    item.allow_makeup and 
                    qr_date == server_today and 
                    session.session_date <= server_today and 
                    current_user.role == UserRole.TEACHER
                )
                if is_valid_makeup:
                    is_batch_makeup = True
                else:
                    results.append({
                        "status": "FAILED", 
                        "reason": f"QR Date ({qr_date}) does not match session date ({session.session_date})"
                    })
                    continue

        if student.section_id != session.section_id and not is_admin:
            results.append({"status": "FAILED", "reason": "Student does not belong to session class section"})
            continue

        roll_number = student.roll_number
        period_count = max(1, min(8, item.period_count or 4))

        existing = db.query(AttendanceRecord).filter(
            AttendanceRecord.session_id == item.session_id,
            AttendanceRecord.student_id == student.id
        ).first()

        scan_mode_val = "QR_MAKEUP" if is_batch_makeup else "QR"
        if existing:
            existing.status = AttendanceStatus.PRESENT
            existing.scanned_at = now
            existing.scan_mode = scan_mode_val
        else:
            new_record = AttendanceRecord(
                session_id=item.session_id,
                student_id=student.id,
                roll_number=roll_number,
                session_date=session.session_date,
                status=AttendanceStatus.PRESENT,
                scan_mode=scan_mode_val,
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
        gs_id = _get_effective_gsheet_id(db, session)
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

    if current_user.role not in [UserRole.TEACHER, UserRole.SUPER_ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only faculty members or administrators are authorized to manually mark attendance."
        )

    if current_user.role == UserRole.TEACHER:
        if not current_user.teacher_profile or session.teacher_id != current_user.teacher_profile.id:
            raise HTTPException(status_code=403, detail="Not authorized to edit attendance for this session")

    student = db.query(Student).filter(Student.roll_number == req.roll_number.strip().upper()).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    existing = db.query(AttendanceRecord).filter(
        AttendanceRecord.session_id == req.session_id,
        AttendanceRecord.student_id == student.id
    ).first()

    old_status_str = existing.status.value if existing else "NONE"
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

    from app.core.device_security import log_security_audit_event, SecurityEventType
    log_security_audit_event(
        db=db,
        event_type=SecurityEventType.ATTENDANCE_SUBMITTED,
        action="HISTORICAL_EDIT",
        details=f"User {current_user.username} edited {student.roll_number} status from {old_status_str} to {status_enum.value} for session {session.id} ({session.session_date})",
        user_id=current_user.id,
        roll_number=student.roll_number
    )

    db.commit()

    # Queue Google Sheets & Master Excel background updates
    date_formatted = datetime.now().strftime("%d/%m/%Y")
    status_code = str(req.period_count or 4) if status_enum == AttendanceStatus.PRESENT else "A"

    gs_id = _get_effective_gsheet_id(db, session)

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
