import os
import time
import logging
from datetime import datetime
from typing import Optional, Dict, Any, List
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks, Response, UploadFile, File, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.core.database import get_db
from app.api.auth import get_current_user, require_teacher, require_admin
from app.core.config import settings
from app.core.security import get_server_ist_datetime
import threading
from collections import OrderedDict
from sqlalchemy import or_, func
from sqlalchemy.orm import joinedload

from app.models.models import (
    User, UserRole, Student, Teacher, TeacherAssignment, AttendanceSession, AttendanceRecord, 
    AttendanceStatus, SessionStatus, SystemSettings, Section
)
from app.services.qr_service import QRService
from app.services.excel_service import ExcelAttendanceService
from app.services.gsheets_service import GoogleSheetsService

logger = logging.getLogger("snist_erp.attendance_api")

router = APIRouter(prefix="/attendance", tags=["Attendance Engine"])

class BoundedLRUSessionCache:
    """Thread-safe bounded LRU session cache with TTL eviction to prevent memory growth under high concurrency."""
    def __init__(self, maxsize: int = 500, ttl: float = 30.0):
        self.maxsize = maxsize
        self.ttl = ttl
        self._cache: OrderedDict[int, Dict[str, Any]] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, session_id: int) -> Optional[Dict[str, Any]]:
        now = time.time()
        with self._lock:
            if session_id not in self._cache:
                return None
            val = self._cache[session_id]
            # Check TTL
            if now - val["cached_at"] > self.ttl:
                del self._cache[session_id]
                return None
            # Move to end for LRU freshness
            self._cache.move_to_end(session_id)
            return val

    def set(self, session_id: int, meta: Dict[str, Any]) -> None:
        now = time.time()
        with self._lock:
            # Clean up expired items if cache is getting full
            if len(self._cache) >= self.maxsize:
                expired = [k for k, v in self._cache.items() if now - v["cached_at"] > self.ttl]
                for k in expired:
                    del self._cache[k]
                while len(self._cache) >= self.maxsize:
                    self._cache.popitem(last=False)
            self._cache[session_id] = meta
            self._cache.move_to_end(session_id)

    def pop(self, session_id: int, default=None):
        with self._lock:
            return self._cache.pop(session_id, default)

    def clear(self):
        with self._lock:
            self._cache.clear()

_SESSION_CACHE = BoundedLRUSessionCache(maxsize=500, ttl=30.0)
_SESSION_CACHE_TTL = 30  # seconds

def get_cached_session_meta(db: Session, session_id: int) -> Optional[Dict[str, Any]]:
    # In test environments with in-memory SQLite, bypass global cache to prevent cross-test ID collision
    is_test_sqlite = False
    try:
        if db.bind and (str(db.bind.url).startswith("sqlite") or ":memory:" in str(db.bind.url)):
            is_test_sqlite = True
    except Exception:
        pass

    if not is_test_sqlite:
        cached = _SESSION_CACHE.get(session_id)
        if cached:
            return cached

    # Eagerly load all relationships in 1 single JOIN query to eliminate N+1 lazy loads on cache miss
    session = db.query(AttendanceSession).options(
        joinedload(AttendanceSession.teacher),
        joinedload(AttendanceSession.subject),
        joinedload(AttendanceSession.section).joinedload(Section.department),
        joinedload(AttendanceSession.section).joinedload(Section.academic_year)
    ).filter(AttendanceSession.id == session_id).first()
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
        "locked_at": session.locked_at,
        "created_at": session.created_at,
        "teacher_gsheet_id": teacher_gsheet,
        "section_name": session.section.name if session.section else "",
        "subject_name": session.subject.name if session.subject else "",
        "teacher_name": session.teacher.name if session.teacher else "",
        "dept_code": session.section.department.code if (session.section and session.section.department) else "",
        "year_name": session.section.academic_year.name if (session.section and session.section.academic_year) else "",
        "faculty_latitude": session.faculty_latitude,
        "faculty_longitude": session.faculty_longitude,
        "faculty_accuracy_m": session.faculty_accuracy_m,
        "geofence_radius_m": session.geofence_radius_m or 100.0,
        "cached_at": time.time()
    }
    if not is_test_sqlite:
        _SESSION_CACHE.set(session_id, meta)
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

VALID_MANUAL_REASONS = {"scanner_failed", "device_lost", "late_join", "other"}

class ManualMarkRequest(BaseModel):
    session_id: int
    roll_number: str
    status: str # PRESENT or ABSENT
    reason: str # REQUIRED enum: scanner_failed | device_lost | late_join | other
    reason_detail: Optional[str] = None
    period_count: Optional[int] = None
    confirm_high_volume: Optional[bool] = False

class SessionBatchMarkRequest(BaseModel):
    status: str # PRESENT or ABSENT
    period_count: Optional[int] = 4
    roll_numbers: Optional[List[str]] = None
    reason: Optional[str] = "scanner_failed"
    reason_detail: Optional[str] = None
    confirm_high_volume: Optional[bool] = False

class AdminDailyMarkRequest(BaseModel):
    date: str  # YYYY-MM-DD
    section_id: int
    roll_number: str
    status: str  # PRESENT, ABSENT, UNMARKED
    period_count: Optional[int] = 4

class AdminBatchDailyMarkRequest(BaseModel):
    date: str  # YYYY-MM-DD
    section_id: int
    status: str  # PRESENT, ABSENT
    period_count: Optional[int] = 4
    roll_numbers: Optional[List[str]] = None

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
    clean_p = str(period_count).strip().upper()
    if clean_p in ["A", "ABSENT"]:
        status_str = "A"
        p_total_str = "4"
    else:
        try:
            val = max(1, min(8, int(clean_p)))
            status_str = str(val)
            p_total_str = str(val)
        except Exception:
            status_str = "4"
            p_total_str = "4"

    master_excel_path = os.path.join(settings.MASTER_TEMPLATE_DIR, "Official_Attendance_Register.xlsx")
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

    # Sync to Class-Specific Dedicated Excel Register
    try:
        from app.core.database import SessionLocal
        from app.models.models import TeacherAssignment, Section, Teacher
        from app.services.register_service import get_or_create_assignment_register
        with SessionLocal() as sync_db:
            sec_obj = sync_db.query(Section).filter(Section.name == sec_name).first()
            teacher_obj = sync_db.query(Teacher).filter(Teacher.name == teacher_name).first()
            if sec_obj and teacher_obj:
                asgn = sync_db.query(TeacherAssignment).filter(
                    TeacherAssignment.teacher_id == teacher_obj.id,
                    TeacherAssignment.section_id == sec_obj.id
                ).first()
                if asgn:
                    class_reg_path = get_or_create_assignment_register(sync_db, asgn)
                    if class_reg_path and os.path.exists(class_reg_path):
                        ExcelAttendanceService.record_attendance_in_excel(
                            file_path=class_reg_path,
                            roll_number=roll_number,
                            date_str=date_formatted,
                            status_code=status_str,
                            overwrite=True
                        )
    except Exception as ex_class:
        print(f"Class Register Update Warning: {ex_class}")

    if gs_id:
        try:
            creds_file = settings.GOOGLE_CREDENTIALS_FILE or os.path.join(settings.BACKEND_DIR, "credentials.json")
            GoogleSheetsService.record_attendance_in_gsheet(
                credentials_json=creds_file,
                spreadsheet_id=gs_id,
                roll_number=roll_number,
                date_str=date_formatted,
                status_code=status_str,
                period_total=p_total_str
            )
        except Exception as ex:
            print(f"GSheets Sync Warning: {str(ex)}")

    # Invalidate JNTUH R25 percentage engine cache off the critical scan path
    try:
        from app.services.attendance_engine import invalidate_attendance_cache
        invalidate_attendance_cache()
    except Exception as inv_err:
        pass

def _get_effective_gsheet_id(db: Session, session: Optional[AttendanceSession]) -> str:
    try:
        if session:
            # 1. Class-specific Google Sheet
            asgn = db.query(TeacherAssignment).filter(
                TeacherAssignment.teacher_id == session.teacher_id,
                TeacherAssignment.subject_id == session.subject_id,
                TeacherAssignment.section_id == session.section_id
            ).first()
            if asgn and asgn.google_sheet_id:
                return asgn.google_sheet_id.strip()

            # 2. Teacher-specific Google Sheet
            if session.teacher_id:
                teacher = db.query(Teacher).filter(Teacher.id == session.teacher_id).first()
                if teacher and teacher.google_sheet_id:
                    return teacher.google_sheet_id.strip()

        # 3. Global institutional sheet
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
    current_user: User = Depends(require_teacher)
):
    t0 = time.perf_counter()
    is_admin = (current_user.role == UserRole.SUPER_ADMIN)

    # Strictly verify faculty / admin role and log any unauthorized intrusion attempts
    if current_user.role not in [UserRole.TEACHER, UserRole.SUPER_ADMIN]:
        from app.core.device_security import log_security_audit_event, SecurityEventType
        log_security_audit_event(
            db=db,
            event_type=SecurityEventType.UNAUTHORIZED_ACCESS_ATTEMPT,
            action="UNAUTHORIZED_SCAN_BLOCKED",
            details=f"User {current_user.username} with role {current_user.role} attempted direct execution of /attendance/scan.",
            user_id=current_user.id
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: Only faculty and administrators can process attendance scans."
        )

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
        # Cryptographic QR token tampering detection hook
        # WHY: Tracks attempts to alter payloads or forge HMAC signatures for security alerting.
        if "Tampered" in str(e) or "Checksum" in str(e) or "structure" in str(e):
            try:
                from app.core.device_security import record_audit_log
                record_audit_log(
                    db=db,
                    user_id=current_user.id if current_user else None,
                    roll_number="UNKNOWN",
                    event_type="FAILED_HMAC",
                    action="QR_CHECKSUM_TAMPER_DETECTED",
                    details=f"Tampered QR payload scanned: {str(e)[:100]}. Payload prefix: {raw_payload[:40]}...",
                    ip_address="SCANNER_CLIENT"
                )
            except Exception as log_ex:
                logger.warning(f"Failed to log FAILED_HMAC: {log_ex}")
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
            detail="Not enrolled in this section. Please contact faculty incharge."
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
    date_formatted = get_server_ist_datetime().strftime("%d/%m/%Y")

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
    try:
        from app.services.attendance_engine import invalidate_attendance_cache
        invalidate_attendance_cache(student_id=student.id, course_id=session_meta.get("subject_id"))
    except Exception:
        pass

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
    Optimized with batch pre-fetching to eliminate N+1 round-trips against remote MySQL.
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
    date_formatted = get_server_ist_datetime().strftime("%d/%m/%Y")

    # Step 1: Pre-decode QR payloads and collect student identifiers and session IDs
    decoded_scans = []
    req_session_ids = set()
    req_student_ids = set()
    req_roll_numbers = set()

    for item in req.scans:
        raw_payload = item.qr_payload.strip()
        student_id = None
        roll_number = None
        qr_data = None
        decode_err = None

        try:
            qr_data = QRService.validate_scanned_qr(raw_payload)
            if qr_data:
                if qr_data.get("studentId"):
                    student_id = int(qr_data.get("studentId"))
                    req_student_ids.add(student_id)
                if qr_data.get("rollNumber"):
                    roll_number = str(qr_data.get("rollNumber")).strip().upper()
                    req_roll_numbers.add(roll_number)
        except Exception as err:
            decode_err = f"QR decode error: {str(err)}"

        req_session_ids.add(item.session_id)
        decoded_scans.append({
            "item": item,
            "student_id": student_id,
            "roll_number": roll_number,
            "qr_data": qr_data,
            "decode_err": decode_err
        })

    # Step 2: Batch pre-fetch session metadata (using BoundedLRUSessionCache)
    session_metas = {}
    for sid in req_session_ids:
        meta = get_cached_session_meta(db, sid)
        if meta:
            session_metas[sid] = meta

    # Step 3: Batch pre-fetch students with relationships in ONE query to avoid lazy load N+1s
    student_filters = []
    if req_student_ids:
        student_filters.append(Student.id.in_(list(req_student_ids)))
    if req_roll_numbers:
        student_filters.append(Student.roll_number.in_(list(req_roll_numbers)))

    student_by_id = {}
    student_by_roll = {}
    if student_filters:
        # Eager load department, academic_year, section in single query
        students = db.query(Student).options(
            joinedload(Student.department),
            joinedload(Student.academic_year),
            joinedload(Student.section)
        ).filter(or_(*student_filters)).all()
        for s in students:
            student_by_id[s.id] = s
            student_by_roll[s.roll_number.upper()] = s

    # Step 4: Batch pre-fetch existing attendance records using composite index idx_att_rec_session_student
    matched_student_ids = list(student_by_id.keys())
    existing_records_map = {}
    if req_session_ids and matched_student_ids:
        existing_recs = db.query(AttendanceRecord).filter(
            AttendanceRecord.session_id.in_(list(req_session_ids)),
            AttendanceRecord.student_id.in_(matched_student_ids)
        ).all()
        for rec in existing_recs:
            existing_records_map[(rec.session_id, rec.student_id)] = rec

    # Step 5: Process each scan purely in memory (ZERO DB queries inside loop)
    from app.core.security import get_server_ist_date
    server_today = get_server_ist_date()

    for entry in decoded_scans:
        item = entry["item"]
        session_meta = session_metas.get(item.session_id)
        
        # Verify session existence and lock state
        if not session_meta:
            results.append({"status": "FAILED", "reason": "Session invalid or not found"})
            continue
        status_val = getattr(session_meta["status"], "value", str(session_meta["status"]))
        if status_val == "LOCKED" and not is_admin:
            results.append({"status": "FAILED", "reason": "Session is locked"})
            continue

        # Verify teacher ownership
        if current_user.role == UserRole.TEACHER and current_user.teacher_profile and not is_admin:
            if session_meta["teacher_id"] != current_user.teacher_profile.id:
                results.append({"status": "FAILED", "reason": "Not authorized to submit scans for this session"})
                continue

        if entry["decode_err"]:
            results.append({"status": "FAILED", "reason": entry["decode_err"]})
            continue

        # Resolve student in O(1) memory lookup
        student = None
        if entry["student_id"] and entry["student_id"] in student_by_id:
            student = student_by_id[entry["student_id"]]
        if not student and entry["roll_number"] and entry["roll_number"] in student_by_roll:
            student = student_by_roll[entry["roll_number"]]

        if not student:
            results.append({"status": "FAILED", "reason": "Student not found"})
            continue

        # Date validation
        qr_data = entry["qr_data"]
        is_batch_makeup = False
        if qr_data and not is_admin:
            qr_date = qr_data.get("qr_date") or qr_data.get("date")
            if qr_date and qr_date != session_meta["session_date"]:
                is_valid_makeup = (
                    item.allow_makeup and 
                    qr_date == server_today and 
                    session_meta["session_date"] <= server_today and 
                    current_user.role == UserRole.TEACHER
                )
                if is_valid_makeup:
                    is_batch_makeup = True
                else:
                    results.append({
                        "status": "FAILED", 
                        "reason": f"QR Date ({qr_date}) does not match session date ({session_meta['session_date']})"
                    })
                    continue

        if student.section_id != session_meta["section_id"] and not is_admin:
            results.append({"status": "FAILED", "reason": "Not enrolled in this section. Please contact faculty incharge."})
            continue

        roll_number = student.roll_number
        period_count = max(1, min(8, item.period_count or 4))

        # Check existing record in O(1) memory lookup
        existing = existing_records_map.get((item.session_id, student.id))
        scan_mode_val = "QR_MAKEUP" if is_batch_makeup else "QR"
        if existing:
            existing.status = AttendanceStatus.PRESENT
            existing.period_count = period_count
            existing.scanned_at = now
            existing.scan_mode = scan_mode_val
        else:
            new_record = AttendanceRecord(
                session_id=item.session_id,
                student_id=student.id,
                roll_number=roll_number,
                session_date=session_meta["session_date"],
                period_count=period_count,
                status=AttendanceStatus.PRESENT,
                scan_mode=scan_mode_val,
                scanned_at=now
            )
            db.add(new_record)
            existing_records_map[(item.session_id, student.id)] = new_record

        processed_count += 1
        results.append({
            "status": "SUCCESS",
            "roll_number": roll_number,
            "student_name": student.name
        })

        # Queue async post-scan tasks with pre-resolved values (no lazy loads)
        gs_id = session_meta["teacher_gsheet_id"]
        background_tasks.add_task(
            _async_post_scan_tasks,
            roll_number=roll_number,
            date_formatted=date_formatted,
            student_name=student.name,
            dept_code=student.department.code if student.department else "",
            year_name=student.academic_year.name if student.academic_year else "",
            sec_name=student.section.name if student.section else "",
            sub_name=session_meta["subject_name"],
            period=session_meta["period"],
            teacher_name=session_meta["teacher_name"],
            gs_id=gs_id,
            period_count=period_count
        )

    # Step 6: Atomic commit for the entire batch
    db.commit()
    try:
        from app.services.attendance_engine import invalidate_attendance_cache
        distinct_subjects = {
            meta.get("subject_id") for meta in session_metas.values() if meta and meta.get("subject_id")
        }
        for sub_id in distinct_subjects:
            invalidate_attendance_cache(course_id=sub_id)
    except Exception as cache_err:
        logger.warning(f"Failed to invalidate attendance cache post batch-scan: {cache_err}")

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

    # Part C.1: Required Reason Enum validation
    clean_reason = (req.reason or "").strip().lower()
    if not clean_reason or clean_reason not in VALID_MANUAL_REASONS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid manual mark reason '{req.reason}'. Must be one of: {', '.join(sorted(VALID_MANUAL_REASONS))}."
        )

    # Part C.4: Session manual volume cap check (default 25 marks/session, configurable)
    from app.core.config import settings
    session_manual_recs = db.query(AttendanceRecord).filter(
        AttendanceRecord.session_id == req.session_id,
        AttendanceRecord.scan_mode == "MANUAL",
        AttendanceRecord.status == AttendanceStatus.PRESENT
    ).count()

    max_session_cap = getattr(settings, "MANUAL_MARK_MAX_PER_SESSION_CAP", 25)
    if session_manual_recs >= max_session_cap and not req.confirm_high_volume:
        raise HTTPException(
            status_code=status.HTTP_428_PRECONDITION_REQUIRED,
            detail=f"Session manual mark limit of {max_session_cap} reached ({session_manual_recs} already marked). Confirmation modal required to proceed."
        )

    student = db.query(Student).filter(Student.roll_number == req.roll_number.strip().upper()).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    # Rule 25 & 26: Cross-section validation - student must belong to session's section
    if student.section_id != session.section_id and current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Not enrolled in this section. Please contact faculty incharge."
        )

    existing_recs = db.query(AttendanceRecord).filter(
        AttendanceRecord.session_id == req.session_id,
        (AttendanceRecord.student_id == student.id) | (AttendanceRecord.roll_number == student.roll_number)
    ).order_by(AttendanceRecord.id.desc()).all()

    existing = existing_recs[0] if existing_recs else None

    status_enum = AttendanceStatus.PRESENT if req.status.upper() in ["PRESENT", "1", "2", "3", "4", "5", "6", "7", "8"] else AttendanceStatus.ABSENT

    from app.api.teacher import _extract_period_count
    session_periods = _extract_period_count(session.period)
    effective_periods = req.period_count if req.period_count is not None else session_periods
    
    if status_enum == AttendanceStatus.PRESENT:
        record_period_count = max(1, min(8, effective_periods))
        status_code = str(record_period_count)
    else:
        record_period_count = 0
        status_code = "A"

    old_status_str = existing.status.value if existing else "NONE"

    now_utc = datetime.utcnow()
    if existing:
        existing.status = status_enum
        existing.period_count = record_period_count
        existing.scan_mode = "MANUAL"
        existing.manual_reason = clean_reason
        existing.manual_reason_detail = req.reason_detail.strip() if req.reason_detail else None
        existing.manual_marked_by_id = current_user.id
        existing.scanned_at = now_utc
        for dup in existing_recs[1:]:
            db.delete(dup)
    else:
        new_record = AttendanceRecord(
            session_id=req.session_id,
            student_id=student.id,
            roll_number=student.roll_number,
            session_date=session.session_date,
            status=status_enum,
            period_count=record_period_count,
            scan_mode="MANUAL",
            manual_reason=clean_reason,
            manual_reason_detail=req.reason_detail.strip() if req.reason_detail else None,
            manual_marked_by_id=current_user.id,
            scanned_at=now_utc
        )
        db.add(new_record)

    # Part C.2: Explicit SECURITY-level Audit Log with (M) Flag
    from app.core.device_security import log_security_audit_event, SecurityEventType
    audit_detail = (
        f"MANUAL_MARK [M]: Marker={current_user.username} (ID {current_user.id}), "
        f"Target={student.roll_number}, Session={session.id} ({session.session_date}), "
        f"Status={status_enum.value} ({status_code} periods), Reason={clean_reason}"
        + (f" [Detail: {req.reason_detail.strip()}]" if req.reason_detail else "")
    )
    log_security_audit_event(
        db=db,
        event_type=SecurityEventType.ATTENDANCE_SUBMITTED,
        action="MANUAL_MARK_VERIFIED",
        details=audit_detail,
        user_id=current_user.id,
        roll_number=student.roll_number
    )

    db.commit()

    # Part C.3: Calculate Session Anomaly Thresholds
    total_marked_recs = db.query(AttendanceRecord).filter(
        AttendanceRecord.session_id == req.session_id,
        AttendanceRecord.status == AttendanceStatus.PRESENT
    ).count()
    updated_manual_recs = db.query(AttendanceRecord).filter(
        AttendanceRecord.session_id == req.session_id,
        AttendanceRecord.scan_mode == "MANUAL",
        AttendanceRecord.status == AttendanceStatus.PRESENT
    ).count()

    manual_pct = round((updated_manual_recs / max(1, total_marked_recs)) * 100.0, 1)
    amber_thresh = getattr(settings, "MANUAL_MARK_AMBER_THRESHOLD_PCT", 15.0)
    red_thresh = getattr(settings, "MANUAL_MARK_RED_THRESHOLD_PCT", 30.0)

    anomaly_status = "NORMAL"
    if manual_pct >= red_thresh:
        anomaly_status = "RED"
    elif manual_pct >= amber_thresh:
        anomaly_status = "AMBER"

    # Queue Google Sheets & Master Excel background updates
    try:
        from datetime import datetime as dt
        d_obj = dt.strptime(str(session.session_date).strip(), "%Y-%m-%d")
        date_formatted = d_obj.strftime("%d/%m/%Y")
    except Exception:
        date_formatted = str(session.session_date).strip() or get_server_ist_datetime().strftime("%d/%m/%Y")

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

    return {
        "status": "SUCCESS",
        "message": f"Updated {student.name} ({student.roll_number}) to {status_code} [M]",
        "roll_number": student.roll_number,
        "scan_mode": "MANUAL",
        "manual_reason": clean_reason,
        "is_manual": True,
        "session_manual_count": updated_manual_recs,
        "session_total_count": total_marked_recs,
        "session_manual_pct": manual_pct,
        "anomaly_status": anomaly_status
    }

@router.post("/session/{session_id}/batch-mark")
def batch_mark_session_attendance(
    session_id: int,
    req: SessionBatchMarkRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Atomically updates attendance for all students (or specified roll numbers) in a session.
    Executes in a single DB transaction and queues a single atomic Google Sheet session sync,
    preventing HTTP 429 quota exhaustion and N+1 round trips.
    """
    session = db.query(AttendanceSession).filter(AttendanceSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status == SessionStatus.LOCKED:
        raise HTTPException(status_code=400, detail="Session is locked")

    if current_user.role not in [UserRole.TEACHER, UserRole.SUPER_ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only faculty members or administrators are authorized to mark attendance."
        )

    if current_user.role == UserRole.TEACHER:
        if not current_user.teacher_profile or session.teacher_id != current_user.teacher_profile.id:
            raise HTTPException(status_code=403, detail="Not authorized to edit attendance for this session")

    # Fetch all students belonging to the session's section
    all_students = db.query(Student).filter(Student.section_id == session.section_id).all()
    all_rolls = [s.roll_number for s in all_students]
    student_map = {s.roll_number.upper(): s for s in all_students}

    target_rolls = [r.strip().upper() for r in req.roll_numbers] if req.roll_numbers else list(student_map.keys())

    is_present = req.status.strip().upper() in ["PRESENT", "1", "2", "3", "4", "5", "6", "7", "8"]

    from app.core.config import settings
    max_session_cap = getattr(settings, "MANUAL_MARK_MAX_PER_SESSION_CAP", 25)
    if is_present and len(target_rolls) >= max_session_cap and not req.confirm_high_volume:
        raise HTTPException(
            status_code=status.HTTP_428_PRECONDITION_REQUIRED,
            detail=f"Batch marking {len(target_rolls)} students exceeds the session cap of {max_session_cap}. Deliberate confirmation modal required to proceed."
        )

    from app.api.teacher import _extract_period_count
    session_periods = _extract_period_count(session.period)
    effective_periods = req.period_count if req.period_count is not None else session_periods
    p_count = max(1, min(8, effective_periods)) if is_present else 0
    status_enum = AttendanceStatus.PRESENT if is_present else AttendanceStatus.ABSENT

    # Fetch existing records for this session and group by roll number
    existing_records = db.query(AttendanceRecord).filter(
        AttendanceRecord.session_id == session_id
    ).all()
    from collections import defaultdict
    records_by_roll = defaultdict(list)
    for r in existing_records:
        records_by_roll[r.roll_number.strip().upper()].append(r)

    now = datetime.utcnow()
    batch_reason = (req.reason or "scanner_failed").strip().lower()
    for roll in target_rolls:
        st = student_map.get(roll)
        if not st:
            continue
        recs = records_by_roll.get(roll, [])
        if recs:
            primary = recs[0]
            primary.status = status_enum
            primary.period_count = p_count
            primary.scan_mode = "MANUAL"
            primary.manual_reason = batch_reason
            primary.manual_reason_detail = req.reason_detail.strip() if req.reason_detail else None
            primary.manual_marked_by_id = current_user.id
            primary.scanned_at = now
            for dup in recs[1:]:
                db.delete(dup)
        else:
            new_rec = AttendanceRecord(
                session_id=session_id,
                student_id=st.id,
                roll_number=st.roll_number,
                session_date=session.session_date,
                status=status_enum,
                period_count=p_count,
                scan_mode="MANUAL",
                manual_reason=batch_reason,
                manual_reason_detail=req.reason_detail.strip() if req.reason_detail else None,
                manual_marked_by_id=current_user.id,
                scanned_at=now
            )
            db.add(new_rec)
            records_by_roll[roll] = [new_rec]

    from app.core.device_security import log_security_audit_event, SecurityEventType
    log_security_audit_event(
        db=db,
        event_type=SecurityEventType.ATTENDANCE_SUBMITTED,
        action="BATCH_SESSION_MARK",
        details=f"User {current_user.username} batch marked {len(target_rolls)} students as {req.status.upper()} ({p_count} periods) for session {session.id} ({session.session_date})",
        user_id=current_user.id
    )
    db.commit()
    try:
        from app.services.attendance_engine import invalidate_attendance_cache
        invalidate_attendance_cache(course_id=session.subject_id)
    except Exception:
        pass

    # Determine present rolls across the section for this session
    all_current_records = db.query(AttendanceRecord).filter(
        AttendanceRecord.session_id == session_id
    ).all()
    present_rolls = [
        r.roll_number for r in all_current_records
        if getattr(r.status, "value", str(r.status)).upper() in ["PRESENT", "1", "2", "3", "4", "5", "6", "7", "8"]
    ]

    # Trigger single atomic batch sync to Google Sheets and Excel in background
    gs_id = _get_effective_gsheet_id(db, session)
    if gs_id:
        def _bg_sync(gs_spreadsheet_id, s_date, p_rolls, a_rolls, p_total):
            try:
                creds_file = settings.GOOGLE_CREDENTIALS_FILE or os.path.join(settings.BACKEND_DIR, "credentials.json")
                GoogleSheetsService.sync_session_to_gsheet(
                    credentials_json=creds_file,
                    spreadsheet_id=gs_spreadsheet_id,
                    date_str=s_date,
                    present_rolls=p_rolls,
                    all_section_rolls=a_rolls,
                    period_total=str(p_total)
                )
            except Exception as gs_err:
                print(f"Batch mark Google Sheets sync error: {gs_err}")

            try:
                master_excel = os.path.join(settings.MASTER_TEMPLATE_DIR, "Official_Attendance_Register.xlsx")
                if os.path.exists(master_excel):
                    from datetime import datetime as dt
                    try:
                        d_obj = dt.strptime(s_date, "%Y-%m-%d")
                        d_formatted = d_obj.strftime("%d/%m/%Y")
                    except Exception:
                        d_formatted = s_date
                    for r_num in a_rolls:
                        status_val = str(p_total) if r_num in p_rolls else "A"
                        ExcelAttendanceService.record_attendance_in_excel(
                            file_path=master_excel,
                            roll_number=r_num,
                            date_str=d_formatted,
                            status_code=status_val,
                            overwrite=True
                        )
            except Exception as ex_err:
                print(f"Batch mark Excel sync error: {ex_err}")

        p_total_sync = max(1, min(8, effective_periods))
        background_tasks.add_task(
            _bg_sync,
            gs_id,
            session.session_date,
            present_rolls,
            all_rolls,
            p_total_sync
        )

    return {
        "status": "SUCCESS",
        "message": f"Successfully marked {len(target_rolls)} students as {req.status.upper()}",
        "session_id": session_id,
        "marked_count": len(target_rolls),
        "present_count": len(present_rolls),
        "absent_count": len(all_rolls) - len(present_rolls)
    }

@router.post("/manual", include_in_schema=False)
def manual_mark_attendance_alias(
    req: ManualMarkRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return manual_mark_attendance(req, background_tasks, db, current_user)

@router.post("/mark-all-absent")
def mark_all_students_absent(db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    from app.core.device_security import log_security_audit_event, SecurityEventType
    log_security_audit_event(
        db=db,
        event_type=SecurityEventType.SYSTEM_SETTING_CHANGED,
        action="MARK_ALL_ABSENT_TRIGGERED",
        details=f"Administrator {current_user.username} triggered mark-all-absent wipe across the college.",
        user_id=current_user.id
    )
    db.query(AttendanceRecord).update({AttendanceRecord.status: AttendanceStatus.ABSENT})
    db.commit()
    try:
        from app.services.attendance_engine import invalidate_attendance_cache
        invalidate_attendance_cache()
    except Exception:
        pass

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


# =========================================================================
# WEEKLY CALENDAR & ADMIN DAILY ATTENDANCE REGISTER
# =========================================================================

def _get_or_create_admin_session(
    db: Session,
    section_id: int,
    session_date: str,
    period_count: int = 4,
    admin_user: Optional[User] = None
) -> AttendanceSession:
    """Finds or auto-provisions an AttendanceSession for (section_id, session_date)."""
    session = db.query(AttendanceSession).filter(
        AttendanceSession.section_id == section_id,
        AttendanceSession.session_date == session_date
    ).order_by(AttendanceSession.id.desc()).first()
    if session:
        return session

    from app.models.models import TeacherAssignment, Subject
    assignment = db.query(TeacherAssignment).filter(
        TeacherAssignment.section_id == section_id
    ).first()

    teacher_id = assignment.teacher_id if assignment else None
    subject_id = assignment.subject_id if assignment else None

    if not teacher_id:
        teacher = db.query(Teacher).first()
        teacher_id = teacher.id if teacher else 1
    if not subject_id:
        subject = db.query(Subject).first()
        subject_id = subject.id if subject else 1

    p_count = max(1, min(8, period_count))
    period_label = f"Period 1-{p_count} ({p_count} Periods)" if p_count > 1 else "Period 1 (1 Period)"

    new_session = AttendanceSession(
        teacher_id=teacher_id,
        subject_id=subject_id,
        section_id=section_id,
        period=period_label,
        session_date=session_date,
        status=SessionStatus.OPEN
    )
    db.add(new_session)
    db.commit()
    db.refresh(new_session)
    return new_session


@router.get("/admin/daily-sheet")
def get_admin_daily_sheet(
    date: Optional[str] = None,
    section_id: Optional[int] = 1,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """
    Fetches the full student attendance sheet for a given section on a specific date (YYYY-MM-DD),
    plus a 6-day (Monday to Saturday) overview of the academic week for the calendar bar.
    """
    from app.core.security import get_server_ist_date
    from datetime import datetime as dt, timedelta

    target_date = (date or "").strip() or get_server_ist_date()

    section = db.query(Section).filter(Section.id == section_id).first()
    if not section:
        section = db.query(Section).first()
        if not section:
            raise HTTPException(status_code=404, detail="No sections found in system")
        section_id = section.id

    students = db.query(Student).filter(
        Student.section_id == section_id
    ).order_by(Student.roll_number).all()

    session = db.query(AttendanceSession).filter(
        AttendanceSession.section_id == section_id,
        AttendanceSession.session_date == target_date
    ).order_by(AttendanceSession.id.desc()).first()

    records_by_student_id = {}
    records_by_roll = {}
    if session:
        records = db.query(AttendanceRecord).filter(
            AttendanceRecord.session_id == session.id
        ).all()
        for r in records:
            records_by_student_id[r.student_id] = r
            records_by_roll[r.roll_number.upper()] = r

    student_list = []
    present_cnt = 0
    absent_cnt = 0
    unmarked_cnt = 0

    for s in students:
        rec = records_by_student_id.get(s.id) or records_by_roll.get(s.roll_number.upper())
        if rec:
            st_val = rec.status.value if hasattr(rec.status, "value") else str(rec.status)
            if st_val in ["PRESENT", "1", "2", "3", "4", "5", "6", "7", "8"]:
                status_str = "PRESENT"
                p_count = rec.period_count or 4
                present_cnt += 1
            else:
                status_str = "ABSENT"
                p_count = 0
                absent_cnt += 1
            scan_mode = rec.scan_mode
            scanned_at = rec.scanned_at.strftime("%H:%M:%S") if rec.scanned_at else None
        else:
            status_str = "UNMARKED"
            p_count = 0
            unmarked_cnt += 1
            scan_mode = None
            scanned_at = None

        student_list.append({
            "student_id": s.id,
            "roll_number": s.roll_number,
            "name": s.name,
            "email": s.email,
            "status": status_str,
            "period_count": p_count,
            "scan_mode": scan_mode,
            "scanned_at": scanned_at
        })

    # Compute academic week (Monday through Saturday) for the week containing target_date
    try:
        curr_d = dt.strptime(target_date, "%Y-%m-%d").date()
    except Exception:
        curr_d = dt.strptime(get_server_ist_date(), "%Y-%m-%d").date()

    # Monday is weekday 0, Saturday is weekday 5
    monday_d = curr_d - timedelta(days=curr_d.weekday())
    day_names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    week_days = []

    for i in range(6):
        d_i = monday_d + timedelta(days=i)
        d_str = d_i.strftime("%Y-%m-%d")
        s_i = db.query(AttendanceSession).filter(
            AttendanceSession.section_id == section_id,
            AttendanceSession.session_date == d_str
        ).first()
        p_c = 0
        a_c = 0
        if s_i:
            recs_i = db.query(AttendanceRecord).filter(AttendanceRecord.session_id == s_i.id).all()
            for r in recs_i:
                st = r.status.value if hasattr(r.status, "value") else str(r.status)
                if st in ["PRESENT", "1", "2", "3", "4", "5", "6", "7", "8"]:
                    p_c += 1
                else:
                    a_c += 1
        week_days.append({
            "date": d_str,
            "day_name": day_names[i],
            "day_num": d_i.strftime("%d %b"),
            "is_selected": (d_str == target_date),
            "present_count": p_c,
            "absent_count": a_c,
            "total_students": len(students),
            "has_session": s_i is not None
        })

    return {
        "date": target_date,
        "section_id": section.id,
        "section_name": section.name,
        "department_name": section.department.name if section.department else "",
        "session_id": session.id if session else None,
        "total_students": len(students),
        "present_count": present_cnt,
        "absent_count": absent_cnt,
        "unmarked_count": unmarked_cnt,
        "students": student_list,
        "week_days": week_days
    }


@router.post("/admin/mark-daily")
def mark_admin_daily_attendance(
    req: AdminDailyMarkRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """Marks a single student's attendance on a specific day (Monday to Saturday)."""
    student = db.query(Student).filter(
        (Student.roll_number == req.roll_number.strip().upper()) &
        (Student.section_id == req.section_id)
    ).first()
    if not student:
        student = db.query(Student).filter(
            Student.roll_number == req.roll_number.strip().upper()
        ).first()
    if not student:
        raise HTTPException(status_code=404, detail=f"Student {req.roll_number} not found")

    status_req = req.status.strip().upper()
    session = _get_or_create_admin_session(db, req.section_id, req.date, req.period_count or 4, current_user)

    existing_recs = db.query(AttendanceRecord).filter(
        AttendanceRecord.session_id == session.id,
        (AttendanceRecord.student_id == student.id) | (AttendanceRecord.roll_number == student.roll_number)
    ).order_by(AttendanceRecord.id.desc()).all()

    existing = existing_recs[0] if existing_recs else None

    if status_req == "UNMARKED":
        for r in existing_recs:
            db.delete(r)
        db.commit()
        try:
            from app.services.attendance_engine import invalidate_attendance_cache
            invalidate_attendance_cache(student_id=student.id, course_id=session.subject_id if session else None)
        except Exception:
            pass
        return {
            "status": "SUCCESS",
            "message": f"Cleared attendance for {student.name} ({student.roll_number}) on {req.date}",
            "student_status": "UNMARKED",
            "period_count": 0
        }

    is_present = status_req in ["PRESENT", "1", "2", "3", "4", "5", "6", "7", "8"]
    p_count = max(1, min(8, req.period_count or 4)) if is_present else 0
    status_enum = AttendanceStatus.PRESENT if is_present else AttendanceStatus.ABSENT

    now = datetime.utcnow()
    if existing:
        existing.status = status_enum
        existing.period_count = p_count
        existing.scan_mode = "ADMIN_CALENDAR"
        existing.scanned_at = now
        for dup in existing_recs[1:]:
            db.delete(dup)
    else:
        new_rec = AttendanceRecord(
            session_id=session.id,
            student_id=student.id,
            roll_number=student.roll_number,
            session_date=session.session_date,
            status=status_enum,
            period_count=p_count,
            scan_mode="ADMIN_CALENDAR",
            scanned_at=now
        )
        db.add(new_rec)

    from app.core.device_security import log_security_audit_event, SecurityEventType
    log_security_audit_event(
        db=db,
        event_type=SecurityEventType.ATTENDANCE_SUBMITTED,
        action="ADMIN_CALENDAR_MARK",
        details=f"Admin {current_user.username} marked {student.roll_number} as {status_enum.value} ({p_count} periods) on {req.date}",
        user_id=current_user.id,
        roll_number=student.roll_number
    )
    db.commit()
    try:
        from app.services.attendance_engine import invalidate_attendance_cache
        invalidate_attendance_cache(student_id=student.id, course_id=session.subject_id if session else None)
    except Exception:
        pass

    return {
        "status": "SUCCESS",
        "message": f"Marked {student.name} ({student.roll_number}) as {status_enum.value} ({p_count} periods)",
        "student_status": "PRESENT" if is_present else "ABSENT",
        "period_count": p_count
    }


@router.post("/admin/batch-mark-daily")
def batch_mark_admin_daily_attendance(
    req: AdminBatchDailyMarkRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """Batch marks all or specified students as Present/Absent for a specific day."""
    session = _get_or_create_admin_session(db, req.section_id, req.date, req.period_count or 4, current_user)

    all_students = db.query(Student).filter(
        Student.section_id == req.section_id
    ).all()
    student_map = {s.roll_number.upper(): s for s in all_students}

    target_rolls = [r.strip().upper() for r in req.roll_numbers] if req.roll_numbers else list(student_map.keys())

    is_present = req.status.strip().upper() in ["PRESENT", "1", "2", "3", "4", "5", "6", "7", "8"]
    p_count = max(1, min(8, req.period_count or 4)) if is_present else 0
    status_enum = AttendanceStatus.PRESENT if is_present else AttendanceStatus.ABSENT

    existing_records = db.query(AttendanceRecord).filter(
        AttendanceRecord.session_id == session.id
    ).all()
    from collections import defaultdict
    records_by_roll = defaultdict(list)
    for r in existing_records:
        records_by_roll[r.roll_number.strip().upper()].append(r)

    now = datetime.utcnow()
    for roll in target_rolls:
        st = student_map.get(roll)
        if not st:
            continue
        recs = records_by_roll.get(roll, [])
        if recs:
            primary = recs[0]
            primary.status = status_enum
            primary.period_count = p_count
            primary.scan_mode = "ADMIN_CALENDAR"
            primary.scanned_at = now
            for dup in recs[1:]:
                db.delete(dup)
        else:
            new_rec = AttendanceRecord(
                session_id=session.id,
                student_id=st.id,
                roll_number=st.roll_number,
                session_date=session.session_date,
                status=status_enum,
                period_count=p_count,
                scan_mode="ADMIN_CALENDAR",
                scanned_at=now
            )
            db.add(new_rec)
            records_by_roll[roll] = [new_rec]

    from app.core.device_security import log_security_audit_event, SecurityEventType
    log_security_audit_event(
        db=db,
        event_type=SecurityEventType.ATTENDANCE_SUBMITTED,
        action="ADMIN_BATCH_CALENDAR_MARK",
        details=f"Admin {current_user.username} batch marked {len(target_rolls)} students as {req.status.upper()} ({p_count} periods) on {req.date}",
        user_id=current_user.id
    )
    db.commit()
    try:
        from app.services.attendance_engine import invalidate_attendance_cache
        invalidate_attendance_cache(course_id=session.subject_id if session else None)
    except Exception:
        pass

    present_count = len(target_rolls) if is_present else 0
    absent_count = 0 if is_present else len(target_rolls)

    return {
        "status": "SUCCESS",
        "message": f"Successfully marked {len(target_rolls)} students as {req.status.upper()}",
        "date": req.date,
        "section_id": req.section_id,
        "total_students": len(all_students),
        "marked_count": len(target_rolls),
        "present_count": present_count,
        "absent_count": absent_count
    }


class SelfieSkipRequest(BaseModel):
    reason: Optional[str] = "USER_SKIPPED"


def _require_student(current_user: User = Depends(get_current_user)) -> Student:
    if current_user.role != UserRole.STUDENT or not current_user.student_profile:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Student profile required"
        )
    return current_user.student_profile


@router.post("/records/{attendance_id}/selfie")
async def upload_attendance_selfie(
    attendance_id: int,
    file: UploadFile = File(...),
    request: Request = None,
    db: Session = Depends(get_db),
    current_student: Student = Depends(_require_student)
):
    """
    Post-attendance selfie upload endpoint.
    Saves image into private object storage and persists metadata in selfie_records.
    Decoupled from core attendance validity: selfie status never reverts AttendanceStatus.PRESENT.
    """
    from app.services.selfie_service import store_attendance_selfie
    contents = await file.read()
    ip_addr = request.client.host if request and request.client else None
    try:
        res = store_attendance_selfie(
            db=db,
            attendance_id=attendance_id,
            student_id=current_student.id,
            image_bytes=contents,
            ip_address=ip_addr
        )
        return res
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except Exception as ex:
        logger.error(f"Error saving attendance selfie: {ex}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to store selfie.")


@router.post("/records/{attendance_id}/selfie-skip")
def skip_attendance_selfie_endpoint(
    attendance_id: int,
    req: Optional[SelfieSkipRequest] = None,
    request: Request = None,
    db: Session = Depends(get_db),
    current_student: Student = Depends(_require_student)
):
    """
    Explicit skip endpoint when selfie cannot be taken (e.g. camera issue or student opted out).
    CRITICAL RULE: Never reverts or invalidates the accepted attendance record.
    """
    from app.services.selfie_service import skip_attendance_selfie
    ip_addr = request.client.host if request and request.client else None
    reason = req.reason if req and req.reason else "USER_SKIPPED"
    try:
        res = skip_attendance_selfie(
            db=db,
            attendance_id=attendance_id,
            student_id=current_student.id,
            reason=reason,
            ip_address=ip_addr
        )
        return res
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except Exception as ex:
        logger.error(f"Error skipping attendance selfie: {ex}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to update selfie status.")


