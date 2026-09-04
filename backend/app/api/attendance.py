import os
import time
import logging
from datetime import datetime
from typing import Optional, Dict, Any, List
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks, Response, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.core.database import get_db
from app.api.auth import get_current_user
from app.core.config import settings
from app.models.models import (
    User, UserRole, Student, Teacher, AttendanceSession, AttendanceRecord, 
    AttendanceStatus, SessionStatus, SystemSettings, Classroom, AttendanceAuditReview,
    TeacherAssignment
)
from app.services.qr_service import QRService
from app.services.excel_service import ExcelAttendanceService
from app.services.gsheets_service import GoogleSheetsService
from app.core.security import (
    haversine_distance, generate_proximity_challenge, verify_proximity_challenge,
    verify_manual_short_code, get_server_ist_date, get_server_ist_datetime
)
import secrets

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

    return {"status": "SUCCESS", "message": "All students marked as ABSENT across system and Google Sheets"}


# ==============================================================================
# PROXIMITY-BASED CONCURRENT ATTENDANCE ENGINE (BLE / UWB / ROTATING SHORT CODE)
# ==============================================================================

class StartProximitySessionRequest(BaseModel):
    subject_id: int
    section_id: int
    period: str
    classroom_id: Optional[int] = None
    date: Optional[str] = None

class ProximitySubmitRequest(BaseModel):
    session_id: int
    challenge_nonce: str
    latitude: float
    longitude: float
    location_accuracy_meters: Optional[float] = None
    is_mock_location: Optional[bool] = False
    median_rssi: Optional[int] = None
    rssi_samples: Optional[List[int]] = None
    proximity_tier: Optional[str] = "BLE"
    client_timestamp_ist: Optional[str] = None
    period_count: Optional[int] = 4

class ManualCodeSubmitRequest(BaseModel):
    session_id: int
    code: str
    latitude: float
    longitude: float
    location_accuracy_meters: Optional[float] = None
    is_mock_location: Optional[bool] = False
    period_count: Optional[int] = 4


@router.get("/classrooms")
def list_active_classrooms(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Returns list of active classrooms with indoor coordinates and RSSI thresholds."""
    rooms = db.query(Classroom).filter(Classroom.is_active == True).all()
    return [
        {
            "id": r.id,
            "room_code": r.room_code,
            "building": r.building,
            "floor": r.floor,
            "center_latitude": r.center_latitude,
            "center_longitude": r.center_longitude,
            "geofence_radius_meters": r.geofence_radius_meters,
            "default_rssi_threshold": r.default_rssi_threshold,
            "uwb_supported": r.uwb_supported
        }
        for r in rooms
    ]


@router.post("/session/start-proximity")
def start_proximity_session(
    req: StartProximitySessionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Initializes or resumes a proximity-based attendance session for a class.
    Generates the master ephemeral cryptographic secret and the first 15-second rotating challenge nonce.
    """
    if current_user.role not in [UserRole.TEACHER, UserRole.SUPER_ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only faculty members or administrators can launch proximity attendance sessions."
        )

    # Verify teacher assignment allotment if teacher
    if current_user.role == UserRole.TEACHER and current_user.teacher_profile:
        teacher_id = current_user.teacher_profile.id
        assignment = db.query(TeacherAssignment).filter(
            TeacherAssignment.teacher_id == teacher_id,
            TeacherAssignment.subject_id == req.subject_id,
            TeacherAssignment.section_id == req.section_id
        ).first()
        if not assignment:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not authorized or assigned to this subject and section."
            )
    else:
        # Super admin: use first assigned teacher or existing session's teacher
        teacher = db.query(Teacher).first()
        teacher_id = teacher.id if teacher else 1

    date_str = req.date or get_server_ist_date()

    # Find or create AttendanceSession
    session = db.query(AttendanceSession).filter(
        AttendanceSession.teacher_id == teacher_id,
        AttendanceSession.subject_id == req.subject_id,
        AttendanceSession.section_id == req.section_id,
        AttendanceSession.period == req.period,
        AttendanceSession.session_date == date_str
    ).first()

    if not session:
        session = AttendanceSession(
            teacher_id=teacher_id,
            subject_id=req.subject_id,
            section_id=req.section_id,
            period=req.period,
            session_date=date_str,
            status=SessionStatus.OPEN
        )
        db.add(session)
        db.commit()
        db.refresh(session)
    else:
        if session.status == SessionStatus.LOCKED and current_user.role != UserRole.SUPER_ADMIN:
            session.status = SessionStatus.OPEN
            session.locked_at = None
            db.commit()

    # Associate Classroom if specified, or pick default if empty
    if req.classroom_id:
        classroom = db.query(Classroom).filter(Classroom.id == req.classroom_id).first()
        if classroom:
            session.classroom_id = classroom.id
    elif not session.classroom_id:
        default_classroom = db.query(Classroom).filter(Classroom.is_active == True).first()
        if default_classroom:
            session.classroom_id = default_classroom.id

    # Generate or refresh 32-byte cryptographic ephemeral secret
    if not session.ephemeral_secret:
        session.ephemeral_secret = secrets.token_hex(32)

    nonce, short_code, remaining_sec = generate_proximity_challenge(session.id, session.ephemeral_secret)
    session.current_challenge = nonce
    session.challenge_generated_at = datetime.utcnow()
    session.manual_fallback_code = short_code

    from datetime import timedelta
    session.manual_code_expires_at = datetime.utcnow() + timedelta(seconds=remaining_sec)
    db.commit()
    invalidate_session_cache(session.id)

    classroom = session.classroom
    broadcast_payload = f"SNIST|{session.id}|{nonce}|{int(time.time())}"

    from app.core.device_security import log_security_audit_event, SecurityEventType
    log_security_audit_event(
        db=db,
        event_type=SecurityEventType.ATTENDANCE_SUBMITTED,
        action="PROXIMITY_SESSION_STARTED",
        details=f"Proximity session {session.id} started with classroom {classroom.room_code if classroom else 'N/A'}",
        user_id=current_user.id
    )

    return {
        "session_id": session.id,
        "status": session.status.value,
        "session_date": session.session_date,
        "period": session.period,
        "classroom_id": session.classroom_id,
        "classroom_code": classroom.room_code if classroom else "",
        "broadcast_payload": broadcast_payload,
        "challenge_nonce": nonce,
        "manual_fallback_code": short_code,
        "remaining_seconds": remaining_sec,
        "rssi_threshold": classroom.default_rssi_threshold if classroom else -75,
        "geofence_radius_meters": classroom.geofence_radius_meters if classroom else 60
    }


@router.get("/session/{session_id}/live-challenge")
def get_live_challenge(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Returns the active rotating challenge nonce and live counter for the faculty dashboard.
    """
    session = db.query(AttendanceSession).filter(AttendanceSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if current_user.role == UserRole.TEACHER and current_user.teacher_profile:
        if session.teacher_id != current_user.teacher_profile.id and current_user.role != UserRole.SUPER_ADMIN:
            raise HTTPException(status_code=403, detail="Not authorized for this session")

    if not session.ephemeral_secret:
        session.ephemeral_secret = secrets.token_hex(32)
        db.commit()

    nonce, short_code, remaining_sec = generate_proximity_challenge(session.id, session.ephemeral_secret)
    session.current_challenge = nonce
    session.manual_fallback_code = short_code
    db.commit()

    total_enrolled = db.query(Student).filter(Student.section_id == session.section_id).count()
    total_marked = db.query(AttendanceRecord).filter(
        AttendanceRecord.session_id == session.id,
        AttendanceRecord.status.in_([AttendanceStatus.PRESENT, "4"])
    ).count()

    classroom = session.classroom

    return {
        "session_id": session.id,
        "status": session.status.value,
        "challenge_nonce": nonce,
        "broadcast_payload": f"SNIST|{session.id}|{nonce}|{int(time.time())}",
        "manual_fallback_code": short_code,
        "remaining_seconds": remaining_sec,
        "total_enrolled": total_enrolled,
        "total_marked": total_marked,
        "classroom_code": classroom.room_code if classroom else "",
        "rssi_threshold": classroom.default_rssi_threshold if classroom else -75
    }


@router.post("/proximity-submit")
def submit_proximity_attendance(
    req: ProximitySubmitRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Concurrent Proximity-Verified Attendance Submission Endpoint.
    Validates: student identity, 30-minute device lock, session status, section membership,
    ephemeral cryptographic challenge, coarse geofence, and fine in-room RSSI proximity.
    """
    t0 = time.perf_counter()

    if current_user.role != UserRole.STUDENT or not current_user.student_profile:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only authenticated students can submit proximity attendance."
        )

    student = current_user.student_profile
    from app.core.device_security import log_security_audit_event, SecurityEventType

    # 1. Device Binding Verification (ADR-004)
    device_public_id = request.headers.get("x-device-public-id", "").strip()
    if device_public_id:
        from app.models.models import DeviceRegistration, DeviceAccountBinding, BindingStatus
        device = db.query(DeviceRegistration).filter(DeviceRegistration.device_public_id == device_public_id).first()
        if device and not device.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Device has been revoked or disabled by system administrator."
            )
        now_dt = datetime.utcnow()
        other_binding = db.query(DeviceAccountBinding).filter(
            DeviceAccountBinding.device_id == (device.id if device else -1),
            DeviceAccountBinding.status == BindingStatus.ACTIVE,
            DeviceAccountBinding.expires_at > now_dt,
            DeviceAccountBinding.roll_number != student.roll_number
        ).first()
        if other_binding:
            log_security_audit_event(
                db=db,
                event_type=SecurityEventType.ACCOUNT_SWITCH_ATTEMPT,
                action="ACCOUNT_SWITCH_ATTEMPT",
                details=f"Proximity submit from device bound to {other_binding.roll_number} attempted by {student.roll_number}",
                roll_number=student.roll_number,
                device_id=device.id if device else None
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This device is temporarily associated with another student account. Please try again after the current security window expires."
            )

    # 2. Session Lookup & Validation
    session_meta = get_cached_session_meta(db, req.session_id)
    if not session_meta:
        raise HTTPException(status_code=404, detail="Attendance session not found")

    status_str = getattr(session_meta["status"], "value", str(session_meta["status"]))
    if status_str == "LOCKED":
        raise HTTPException(status_code=400, detail="Attendance session is locked")

    session = db.query(AttendanceSession).filter(AttendanceSession.id == req.session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Attendance session not found")

    # 3. Section Membership Verification
    if student.section_id != session.section_id:
        log_security_audit_event(
            db=db,
            event_type=SecurityEventType.ATTENDANCE_REJECTED,
            action="SECTION_MISMATCH_REJECTED",
            details=f"Student {student.roll_number} does not belong to section {session.section.name if session.section else session.section_id}",
            user_id=current_user.id,
            roll_number=student.roll_number
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Attendance Rejected: Student {student.roll_number} does not belong to class section {session.section.name if session.section else ''}."
        )

    # 4. Ephemeral Cryptographic Challenge Nonce Verification
    if not session.ephemeral_secret:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Session has not initialized proximity security parameters."
        )

    is_challenge_valid = verify_proximity_challenge(
        nonce=req.challenge_nonce,
        session_id=session.id,
        secret=session.ephemeral_secret,
        window_seconds=15,
        tolerance_windows=1
    )

    if not is_challenge_valid:
        log_security_audit_event(
            db=db,
            event_type=SecurityEventType.ATTENDANCE_REJECTED,
            action="CHALLENGE_NONCE_REJECTED",
            details=f"Expired or invalid challenge nonce '{req.challenge_nonce}' for session {session.id}",
            user_id=current_user.id,
            roll_number=student.roll_number
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Attendance Rejected: Invalid or expired proximity challenge nonce. Please refresh and retry."
        )

    # 5. Coarse Geofence Validation
    classroom = session.classroom
    dist_meters = None
    if classroom and classroom.center_latitude and classroom.center_longitude:
        dist_meters = haversine_distance(
            req.latitude, req.longitude,
            classroom.center_latitude, classroom.center_longitude
        )
        if dist_meters > classroom.geofence_radius_meters:
            log_security_audit_event(
                db=db,
                event_type=SecurityEventType.ATTENDANCE_REJECTED,
                action="GEOFENCE_REJECTED",
                details=f"Student {student.roll_number} outside classroom {classroom.room_code}: {round(dist_meters, 1)}m away (max {classroom.geofence_radius_meters}m)",
                user_id=current_user.id,
                roll_number=student.roll_number
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Attendance Rejected: Outside classroom geofence ({round(dist_meters, 1)}m away, allowed radius {classroom.geofence_radius_meters}m)."
            )

    # 6. Fine Proximity (RSSI) Validation & Anomaly Flagging
    threshold = classroom.default_rssi_threshold if classroom else -75
    tier = (req.proximity_tier or "BLE").upper()

    if tier == "BLE" and req.median_rssi is not None:
        if req.median_rssi < (threshold - 10):
            log_security_audit_event(
                db=db,
                event_type=SecurityEventType.ATTENDANCE_REJECTED,
                action="PROXIMITY_RSSI_REJECTED",
                details=f"Student {student.roll_number} RSSI {req.median_rssi} dBm too weak (required >= {threshold} dBm)",
                user_id=current_user.id,
                roll_number=student.roll_number
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Attendance Rejected: In-room proximity signal too weak ({req.median_rssi} dBm, required >= {threshold} dBm)."
            )
        elif req.median_rssi < threshold:
            # Borderline RSSI: Deterministically ACCEPT, but record non-decision review flag
            review = AttendanceAuditReview(
                session_id=session.id,
                student_id=student.id,
                roll_number=student.roll_number,
                event_type="BORDERLINE_RSSI",
                measured_rssi=req.median_rssi,
                target_threshold=threshold,
                latitude=req.latitude,
                longitude=req.longitude,
                calculated_distance_meters=dist_meters,
                details=f"Borderline RSSI ({req.median_rssi} dBm vs target {threshold} dBm) in {classroom.room_code if classroom else 'room'}"
            )
            db.add(review)

    # OS Mock Location Flagging
    if req.is_mock_location:
        review = AttendanceAuditReview(
            session_id=session.id,
            student_id=student.id,
            roll_number=student.roll_number,
            event_type="MOCK_LOCATION_FLAG",
            latitude=req.latitude,
            longitude=req.longitude,
            calculated_distance_meters=dist_meters,
            details="Client OS reported mock location provider enabled"
        )
        db.add(review)

    # 7. Idempotent Attendance Record Insert / Update
    period_count = max(1, min(8, req.period_count or 4))
    scan_mode_val = f"PROXIMITY_{tier}"
    now = datetime.utcnow()

    existing = db.query(AttendanceRecord).filter(
        AttendanceRecord.session_id == session.id,
        AttendanceRecord.student_id == student.id
    ).first()

    if existing:
        existing.status = AttendanceStatus.PRESENT
        existing.period_count = period_count
        existing.scan_mode = scan_mode_val
        existing.verified_scan_mode = scan_mode_val
        existing.measured_rssi = req.median_rssi
        existing.location_accuracy_meters = req.location_accuracy_meters
        existing.challenge_latency_ms = int((time.perf_counter() - t0) * 1000)
        existing.scanned_at = now
    else:
        new_record = AttendanceRecord(
            session_id=session.id,
            student_id=student.id,
            roll_number=student.roll_number,
            session_date=session.session_date,
            period_count=period_count,
            status=AttendanceStatus.PRESENT,
            scan_mode=scan_mode_val,
            verified_scan_mode=scan_mode_val,
            measured_rssi=req.median_rssi,
            location_accuracy_meters=req.location_accuracy_meters,
            challenge_latency_ms=int((time.perf_counter() - t0) * 1000),
            scanned_at=now
        )
        db.add(new_record)

    db.commit()

    # 8. Multi-Target Sync in Background
    gs_id = session_meta["teacher_gsheet_id"]
    date_formatted = datetime.now().strftime("%d/%m/%Y")
    background_tasks.add_task(
        _async_post_scan_tasks,
        roll_number=student.roll_number,
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
    logger.info(f"Proximity attendance recorded in {dur_ms}ms for {student.roll_number} (session {session.id})")

    return {
        "status": "SUCCESS",
        "message": f"Attendance recorded via proximity verification for {student.name} ({period_count} periods)",
        "roll_number": student.roll_number,
        "student_name": student.name,
        "verified_scan_mode": scan_mode_val,
        "measured_rssi": req.median_rssi,
        "scanned_at": now.strftime("%H:%M:%S")
    }


@router.post("/manual-code-submit")
def submit_manual_code_attendance(
    req: ManualCodeSubmitRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Student Fallback Endpoint: Submits the displayed 4-character rotating short code.
    Enforces student identity, section membership, short-code validity, and coarse geofence.
    """
    if current_user.role != UserRole.STUDENT or not current_user.student_profile:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only authenticated students can submit attendance."
        )

    student = current_user.student_profile
    session_meta = get_cached_session_meta(db, req.session_id)
    if not session_meta or session_meta["status"] == SessionStatus.LOCKED:
        raise HTTPException(status_code=400, detail="Attendance session not found or locked")

    session = db.query(AttendanceSession).filter(AttendanceSession.id == req.session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Attendance session not found")

    if student.section_id != session.section_id:
        raise HTTPException(status_code=400, detail="Student does not belong to class section")

    # Verify rotating short code
    if not session.ephemeral_secret:
        raise HTTPException(status_code=400, detail="Session has not initialized proximity security parameters")

    is_code_valid = verify_manual_short_code(
        code=req.code,
        session_id=session.id,
        secret=session.ephemeral_secret,
        window_seconds=15,
        tolerance_windows=2
    )

    if not is_code_valid:
        raise HTTPException(status_code=400, detail="Invalid or expired short code. Please check the screen and retry.")

    # Validate coarse geofence
    classroom = session.classroom
    dist_meters = None
    if classroom and classroom.center_latitude and classroom.center_longitude:
        dist_meters = haversine_distance(
            req.latitude, req.longitude,
            classroom.center_latitude, classroom.center_longitude
        )
        if dist_meters > classroom.geofence_radius_meters:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Attendance Rejected: Outside classroom geofence ({round(dist_meters, 1)}m away)."
            )

    period_count = max(1, min(8, req.period_count or 4))
    now = datetime.utcnow()

    existing = db.query(AttendanceRecord).filter(
        AttendanceRecord.session_id == session.id,
        AttendanceRecord.student_id == student.id
    ).first()

    if existing:
        existing.status = AttendanceStatus.PRESENT
        existing.period_count = period_count
        existing.scan_mode = "PROXIMITY_CODE"
        existing.verified_scan_mode = "PROXIMITY_CODE"
        existing.scanned_at = now
    else:
        new_record = AttendanceRecord(
            session_id=session.id,
            student_id=student.id,
            roll_number=student.roll_number,
            session_date=session.session_date,
            period_count=period_count,
            status=AttendanceStatus.PRESENT,
            scan_mode="PROXIMITY_CODE",
            verified_scan_mode="PROXIMITY_CODE",
            scanned_at=now
        )
        db.add(new_record)

    db.commit()

    gs_id = session_meta["teacher_gsheet_id"]
    date_formatted = datetime.now().strftime("%d/%m/%Y")
    background_tasks.add_task(
        _async_post_scan_tasks,
        roll_number=student.roll_number,
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

    return {
        "status": "SUCCESS",
        "message": f"Attendance marked via short-code verification for {student.name}",
        "roll_number": student.roll_number,
        "verified_scan_mode": "PROXIMITY_CODE",
        "scanned_at": now.strftime("%H:%M:%S")
    }


@router.get("/sessions/{session_id}/audit-reviews")
def get_session_audit_reviews(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Returns flagged anomaly reviews for human audit inspection.
    """
    if current_user.role not in [UserRole.TEACHER, UserRole.SUPER_ADMIN]:
        raise HTTPException(status_code=403, detail="Not authorized")

    reviews = db.query(AttendanceAuditReview).filter(
        AttendanceAuditReview.session_id == session_id
    ).order_by(AttendanceAuditReview.created_at.desc()).all()

    return [
        {
            "id": r.id,
            "student_id": r.student_id,
            "roll_number": r.roll_number,
            "event_type": r.event_type,
            "measured_rssi": r.measured_rssi,
            "target_threshold": r.target_threshold,
            "latitude": r.latitude,
            "longitude": r.longitude,
            "calculated_distance_meters": r.calculated_distance_meters,
            "details": r.details,
            "created_at": r.created_at.isoformat() if r.created_at else ""
        }
        for r in reviews
    ]

