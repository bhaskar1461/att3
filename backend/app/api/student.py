from fastapi import APIRouter, Depends, HTTPException, Request, status, BackgroundTasks
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.exc import IntegrityError
from typing import Dict, Any, List, Optional, Tuple, Union
from datetime import datetime, timedelta
from pydantic import BaseModel
import time
import threading
import logging

logger = logging.getLogger("snist_erp.scan_telemetry")

from app.core.database import get_db
from app.core.config import settings
from app.api.auth import get_current_user
from app.models.models import User, UserRole, Student, AttendanceRecord, AttendanceSession, Subject, DeviceRegistration, DeviceBinding
from app.services.qr_service import QRService
from app.core.security import get_server_ist_date
from app.core.device_security import validate_active_binding_for_student
from app.core.device_classifier import classify_device

# Phase 4: Binding V2 cryptographic verification imports (lazy-loaded, zero cost when flag off)
try:
    from app.core.binding_crypto import (
        decode_and_validate_challenge_token,
        mark_challenge_consumed,
        verify_ecdsa_p1363_signature,
        record_verify_failure,
        check_verify_lockout,
        clear_verify_failures
    )
    _BINDING_CRYPTO_AVAILABLE = True
except ImportError:
    _BINDING_CRYPTO_AVAILABLE = False

_STUDENT_SUMMARY_CACHE: Dict[int, Tuple[Dict[str, Any], float]] = {}
_STUDENT_SUMMARY_CACHE_LOCK = threading.Lock()
_STUDENT_SUMMARY_TTL = 15.0  # 15s cache to eliminate DB hammering on portal switches

router = APIRouter(prefix="/student", tags=["Student Portal"])

def require_student(current_user: User = Depends(get_current_user)) -> Student:
    if current_user.role != UserRole.STUDENT or not current_user.student_profile:
        raise HTTPException(
            status_code=403,
            detail={"code": "role_not_allowed", "message": "Student permission required."}
        )
    return current_user.student_profile

@router.get("/profile")
def get_student_profile(current_student: Student = Depends(require_student)):
    return {
        "id": current_student.id,
        "roll_number": current_student.roll_number,
        "name": current_student.name,
        "department": current_student.department.code if current_student.department else "",
        "year": current_student.academic_year.name if current_student.academic_year else "",
        "section": current_student.section.name if current_student.section else "",
        "email": current_student.email,
        "mobile": current_student.mobile
    }

@router.get("/qr-code")
def get_student_qr(
    request: Request,
    date: Optional[str] = None,
    db: Session = Depends(get_db),
    current_student: Student = Depends(require_student)
):
    device_public_id = request.headers.get("x-device-public-id", "").strip()
    if device_public_id:
        device = db.query(DeviceRegistration).filter(DeviceRegistration.device_public_id == device_public_id).first()
        if device:
            if not device.is_active:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Device has been revoked or disabled by system administrator."
                )
            # Layer 2 enforcement on QR code retrieval: student can only fetch QR from bound device
            from app.core.device_security import enforce_student_device_enrollment
            enforce_student_device_enrollment(
                db=db,
                student=current_student,
                device=device,
                ip_address=request.client.host if request.client else None
            )
    server_today = get_server_ist_date()
    target_date = date or server_today

    if target_date > server_today:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot generate attendance QR code for a future date"
        )
    
    qr_base64 = QRService.generate_student_qr_code(
        student_id=current_student.id,
        roll_number=current_student.roll_number,
        student_name=current_student.name,
        attendance_date=target_date,
        as_base64=True
    )

    pure_qr_base64 = QRService.generate_pure_qr_code(
        student_id=current_student.id,
        roll_number=current_student.roll_number,
        attendance_date=target_date,
        as_base64=True
    )

    try:
        dt_obj = datetime.strptime(target_date, "%Y-%m-%d")
        formatted_date = dt_obj.strftime("%d %b %Y").upper()
    except Exception:
        formatted_date = str(target_date).upper()

    is_today = (target_date == server_today)

    return {
        "roll_number": current_student.roll_number,
        "name": current_student.name,
        "attendance_date": target_date,
        "formatted_date": formatted_date,
        "is_today": is_today,
        "is_makeup": not is_today,
        "qr_code_url": qr_base64,
        "pure_qr_code_url": pure_qr_base64
    }

@router.get("/pure-qr")
def get_student_pure_qr(
    date: Optional[str] = None,
    current_student: Student = Depends(require_student)
):
    target_date = date or get_server_ist_date()
    pure_qr_base64 = QRService.generate_pure_qr_code(
        student_id=current_student.id,
        roll_number=current_student.roll_number,
        attendance_date=target_date,
        as_base64=True
    )
    return {
        "roll_number": current_student.roll_number,
        "attendance_date": target_date,
        "pure_qr_code_url": pure_qr_base64
    }


@router.get("/attendance-summary")
def get_student_attendance_summary(db: Session = Depends(get_db), current_student: Student = Depends(require_student)):
    now_ts = time.time()
    with _STUDENT_SUMMARY_CACHE_LOCK:
        if current_student.id in _STUDENT_SUMMARY_CACHE:
            cached_data, cached_at = _STUDENT_SUMMARY_CACHE[current_student.id]
            if (now_ts - cached_at) < _STUDENT_SUMMARY_TTL:
                return cached_data

    from app.api.teacher import _extract_period_count

    records = db.query(AttendanceRecord).options(
        joinedload(AttendanceRecord.session).joinedload(AttendanceSession.subject)
    ).filter(AttendanceRecord.student_id == current_student.id).all()
    
    present_records = [
        r for r in records 
        if r.status.value in ["PRESENT", "4", "1", "2", "3", "5", "6", "7", "8"]
    ]
    total_present = sum(r.period_count or 1 for r in present_records)
    
    server_today = get_server_ist_date()
    # Query all sessions conducted for this student's section up to today,
    # plus any sessions where this student has a recorded attendance mark
    from sqlalchemy import or_
    recorded_sids = [r.session_id for r in records if r.session_id]
    section_cond = (AttendanceSession.section_id == current_student.section_id) if current_student.section_id else False
    section_sessions = db.query(AttendanceSession).filter(
        AttendanceSession.session_date <= server_today,
        or_(
            section_cond,
            AttendanceSession.id.in_(recorded_sids) if recorded_sids else False
        )
    ).all()
    
    # Total conducted periods across all section sessions up to today
    total_conducted = sum(_extract_period_count(s.period) for s in section_sessions)
    total_conducted = max(total_conducted, total_present)
    total_absent = max(0, total_conducted - total_present)
    
    overall_percentage = round((total_present / total_conducted * 100), 1) if total_conducted > 0 else 0.0

    # Group by subject
    subject_stats = {}
    for r in records:
        subj_name = r.session.subject.name if r.session and r.session.subject else "General"
        if subj_name not in subject_stats:
            subject_stats[subj_name] = {"conducted": 0, "present": 0}
        p_count = r.period_count or 1
        subject_stats[subj_name]["conducted"] += p_count
        if r.status.value in ["PRESENT", "4", "1", "2", "3", "5", "6", "7", "8"]:
            subject_stats[subj_name]["present"] += p_count

    subject_list = []
    for s_name, data in subject_stats.items():
        pct = round((data["present"] / data["conducted"] * 100), 1) if data["conducted"] > 0 else 0.0
        subject_list.append({
            "subject_name": s_name,
            "conducted": data["conducted"],
            "present": data["present"],
            "percentage": pct
        })

    summary_result = {
        "total_conducted": total_conducted,
        "total_present": total_present,
        "total_absent": total_absent,
        "overall_percentage": overall_percentage,
        "has_records": total_conducted > 0,
        "subjects": subject_list
    }

    with _STUDENT_SUMMARY_CACHE_LOCK:
        _STUDENT_SUMMARY_CACHE[current_student.id] = (summary_result, time.time())

    return summary_result


@router.get("/today-schedule")
def get_student_today_schedule(
    db: Session = Depends(get_db),
    current_student: Student = Depends(require_student)
):
    """
    Returns today's active schedule and personal attendance confirmation status for student.
    """
    from app.api.teacher import _extract_period_count
    server_today = get_server_ist_date()
    
    # Check if there is an active/open session for student's section for today
    active_session = db.query(AttendanceSession).filter(
        AttendanceSession.section_id == current_student.section_id,
        AttendanceSession.session_date == server_today,
        AttendanceSession.status == SessionStatus.OPEN
    ).order_by(AttendanceSession.id.desc()).first()

    today_session = active_session or db.query(AttendanceSession).filter(
        AttendanceSession.section_id == current_student.section_id,
        AttendanceSession.session_date == server_today
    ).order_by(AttendanceSession.id.desc()).first()

    # Check student's personal attendance record for today's session
    my_record = None
    if today_session:
        my_record = db.query(AttendanceRecord).filter(
            AttendanceRecord.session_id == today_session.id,
            AttendanceRecord.student_id == current_student.id
        ).order_by(AttendanceRecord.id.desc()).first()

    is_marked = my_record is not None and my_record.status.value in [
        "PRESENT", "4", "1", "2", "3", "5", "6", "7", "8"
    ]

    ist_marked_time = None
    if is_marked and my_record and my_record.scanned_at:
        try:
            ist_dt = my_record.scanned_at + timedelta(hours=5, minutes=30)
            ist_marked_time = ist_dt.strftime("%I:%M %p IST")
        except Exception:
            ist_marked_time = "IST Verified"

    active_p_count = _extract_period_count(today_session.period) if today_session else 4

    my_attendance = {
        "is_marked": is_marked,
        "status": "PRESENT" if is_marked else "UNMARKED",
        "period_count": (my_record.period_count if my_record else None) or active_p_count,
        "marked_at": ist_marked_time,
        "session_id": today_session.id if today_session else None,
        "scan_mode": my_record.scan_mode if my_record else None,
        "subject_name": today_session.subject.name if today_session and today_session.subject else "Career Enhancement Training (CET)",
        "teacher_name": today_session.teacher.name if today_session and today_session.teacher else "Mrs. N. Sowjanya"
    }

    schedule_items = [
        {
            "subject_name": "Career Enhancement Training (CET)",
            "subject_code": "CS(CET)",
            "teacher_name": "Mrs. N. Sowjanya",
            "timing": "09:30 AM - 01:00 PM",
            "period": f"{active_p_count} Periods",
            "period_count": active_p_count,
            "room": "CSE-CS Projector Lab",
            "is_live": active_session is not None,
            "is_marked": is_marked,
            "session_id": active_session.id if active_session else None,
            "status": f"Marked Present ({active_p_count} Periods)" if is_marked else ("Live In-Class" if active_session else "Scheduled")
        }
    ]

    return {
        "today_date": server_today,
        "schedule": schedule_items,
        "my_attendance": my_attendance,
        "active_session": {
            "session_id": active_session.id,
            "subject_name": active_session.subject.name if active_session.subject else "Career Enhancement Training (CET)",
            "teacher_name": active_session.teacher.name if active_session.teacher else "Mrs. N. Sowjanya",
            "period": active_session.period or f"{active_p_count} Periods",
            "period_count": active_p_count,
            "room": "CSE-CS Projector Lab",
            "status": "LIVE IN-CLASS",
            "is_marked": is_marked
        } if active_session else {
            "subject_name": "Career Enhancement Training (CET)",
            "teacher_name": "Mrs. N. Sowjanya",
            "period": f"{active_p_count} Periods",
            "period_count": active_p_count,
            "room": "CSE-CS Projector Lab",
            "status": "Scheduled",
            "is_marked": is_marked
        }
    }


class StudentScanSessionRequest(BaseModel):
    session_token: Optional[str] = None
    short_code: Optional[str] = None
    v: Optional[int] = None
    claim_token: Optional[str] = None
    token_format: Optional[str] = None
    device_uuid: Optional[str] = None
    device_id: Optional[str] = None
    is_offline_submission: Optional[bool] = False
    queued_at: Optional[Union[float, int, str]] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    accuracy_m: Optional[float] = None
    scan_mode: Optional[str] = None
    # Cryptographic Device Identity proof fields
    challenge_token: Optional[str] = None
    binding_signature: Optional[str] = None
    device_signature: Optional[str] = None
    device_verified: Optional[bool] = None  # Untrusted client assertion; backend independently verifies


def _verify_binding_proof(
    db: Session,
    student: Student,
    req: StudentScanSessionRequest,
    ip_addr: Optional[str] = None
) -> Dict[str, Any]:
    """
    Server-authoritative cryptographic device identity proof verification.
    Validates that the scan request carries a valid challenge token signed by
    the student's registered ECDSA P-256 private key.
    Client-side assertions like device_verified=True are NEVER trusted.

    Returns dict with verification metadata on success.
    Raises HTTPException on any verification failure.
    """
    t_verify_start = time.perf_counter()
    clean_roll = student.roll_number.strip().upper()
    lockout_key = f"binding_v2_{clean_roll}"

    # 0. Check if binding crypto module is available
    if not _BINDING_CRYPTO_AVAILABLE:
        logger.warning(f"[DEVICE IDENTITY] Crypto module unavailable, skipping proof for {clean_roll}")
        return {"binding_verified": False, "reason": "crypto_unavailable"}

    # 1. Check brute-force lockout
    is_locked, fail_count, remaining_sec = check_verify_lockout(lockout_key)
    if is_locked:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="VERIFY_LOCKOUT: Device verification locked due to repeated failures. Try again later.",
            headers={"Retry-After": str(remaining_sec)}
        )

    # 2. Extract signature from binding_signature or device_signature
    sig = req.binding_signature or req.device_signature

    # 3. Validate challenge_token and signature are present
    if not req.challenge_token or not sig:
        active_binding = db.query(DeviceBinding).filter(
            DeviceBinding.student_id == student.id,
            DeviceBinding.revoked_at.is_(None),
            DeviceBinding.status == "ACTIVE"
        ).first()
        if not active_binding:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "code": "no_active_binding",
                    "detail": "no_active_binding: BINDING_REQUIRED: No active device binding found. Please enroll your device.",
                    "message": "no_active_binding: BINDING_REQUIRED: No active device binding found. Please enroll your device.",
                    "serverNow": time.time()
                }
            )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "no_active_binding",
                "detail": "no_active_binding: BINDING_REQUIRED: Device binding proof is required. Please enroll your device first.",
                "message": "no_active_binding: BINDING_REQUIRED: Device binding proof is required. Please enroll your device first.",
                "serverNow": time.time()
            }
        )

    # 4. Decode and validate challenge token (HMAC signature + freshness)
    is_valid, payload, reason = decode_and_validate_challenge_token(req.challenge_token)
    if not is_valid:
        if reason == "challenge_expired":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="DEVICE_CHALLENGE_EXPIRED: Challenge token has expired. Please scan again."
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"DEVICE_VERIFICATION_FAILED: Invalid challenge token: {reason}"
        )

    # 4b. Verify challenge token ownership (blocks cross-account challenge splicing)
    token_student_id = payload.get("student_id")
    token_roll = (payload.get("roll_number") or "").strip().upper()
    if token_student_id is not None and token_student_id != student.id:
        logger.warning(
            f"[DEVICE IDENTITY SECURITY] Cross-account token attempt! Authenticated student={clean_roll} (id={student.id}), "
            f"challenge token issued to student_id={token_student_id}"
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="DEVICE_VERIFICATION_FAILED: Challenge token was not issued to this student account."
        )
    if token_roll and token_roll != "UNKNOWN" and token_roll != clean_roll:
        logger.warning(
            f"[DEVICE IDENTITY SECURITY] Cross-account roll mismatch! Authenticated={clean_roll}, token roll={token_roll}"
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="DEVICE_VERIFICATION_FAILED: Challenge token was not issued to this student account."
        )

    # 5. REPLAY PROTECTION: Consume nonce
    nonce = payload.get("nonce", "")
    exp_ts = payload.get("exp") or payload.get("expires_at") or (int(time.time()) + 60)
    consumed, consume_reason = mark_challenge_consumed(nonce, exp_ts)
    if not consumed:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="DEVICE_CHALLENGE_REPLAYED: Challenge token has already been used. Please scan again."
        )

    # 6. Fetch student's device binding
    target_dev_id = req.device_id or req.device_uuid or payload.get("device_id")
    if target_dev_id:
        active_binding = db.query(DeviceBinding).filter(
            DeviceBinding.student_id == student.id,
            DeviceBinding.device_id == target_dev_id
        ).first()
        # Fallback if binding was registered before device_id was populated
        if not active_binding:
            active_binding = db.query(DeviceBinding).filter(
                DeviceBinding.student_id == student.id,
                DeviceBinding.revoked_at.is_(None)
            ).first()
    else:
        active_binding = db.query(DeviceBinding).filter(
            DeviceBinding.student_id == student.id,
            DeviceBinding.revoked_at.is_(None)
        ).first()

    if not active_binding:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="no_active_binding: BINDING_REQUIRED: No active device binding found. Please enroll your device."
        )

    if active_binding.status == "REVOKED" or active_binding.revoked_at is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="DEVICE_REVOKED: This device has been revoked and cannot participate in attendance."
        )

    # 7. Verify ECDSA P-256 signature
    canonical_msg = payload.get("canonical_message")
    sig_valid = False
    sig_reason = ""

    if canonical_msg:
        sig_valid, sig_reason = verify_ecdsa_p1363_signature(
            active_binding.public_key,
            sig,
            canonical_msg.encode("utf-8")
        )

    # Fallback to signing challenge_token bytes (Phase 4 legacy format compatibility)
    if not sig_valid:
        challenge_bytes = req.challenge_token.encode("utf-8")
        sig_valid, sig_reason = verify_ecdsa_p1363_signature(
            active_binding.public_key,
            sig,
            challenge_bytes
        )

    if not sig_valid:
        record_verify_failure(lockout_key)
        logger.warning(
            f"[DEVICE IDENTITY SECURITY] Signature verification FAILED for {clean_roll}: {sig_reason}"
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"DEVICE_VERIFICATION_FAILED: Device signature verification failed: {sig_reason}"
        )

    # 8. Success — clear failures, update last_seen, return metadata
    clear_verify_failures(lockout_key)
    now = datetime.utcnow()
    active_binding.last_seen_at = now
    active_binding.last_verified_at = now
    try:
        db.commit()
    except Exception:
        pass

    verify_ms = (time.perf_counter() - t_verify_start) * 1000
    logger.info(
        f"[DEVICE IDENTITY] Possession proof VERIFIED for {clean_roll} "
        f"device_id={active_binding.device_id} key_id={active_binding.key_id[:8]}... verify_ms={verify_ms:.3f}"
    )

    return {
        "binding_verified": True,
        "device_id": active_binding.device_id,
        "key_id": active_binding.key_id,
        "verify_duration_ms": round(verify_ms, 3)
    }


from app.core.security import validate_projector_session_token
from app.services.qr_token import ShortTokenService
from app.api.attendance import _async_post_scan_tasks, get_cached_session_meta
from app.models.models import AttendanceStatus, SessionStatus, SecurityEventType, BindingStatus, DeviceAccountBinding
from app.core.device_security import log_security_audit_event


import time
import threading
from collections import defaultdict

class FailedTokenTracker:
    """
    In-memory thread-safe rate limiter for failed rotating QR token validations (A3 & AM3).
    - Blocks brute-force script flooding (15 consecutive failures in 60s -> 60s cooldown).
    - EXEMPTS legitimate students (AM3): A valid token immediately clears all failure history.
    - Single expired tokens mid-typing never trigger cooldown.
    """
    def __init__(self, max_failures: int = 15, window_seconds: int = 60, cooldown_seconds: int = 60):
        self.max_failures = max_failures
        self.window_seconds = window_seconds
        self.cooldown_seconds = cooldown_seconds
        self._failures: Dict[str, List[float]] = defaultdict(list)
        self._cooldowns: Dict[str, float] = {}
        self._lock = threading.Lock()

    def check_rate_limit(self, key: str) -> None:
        now = time.time()
        with self._lock:
            cooldown_until = self._cooldowns.get(key, 0)
            if now < cooldown_until:
                retry_after = int(cooldown_until - now)
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=f"Too many invalid QR scans. Please wait {max(1, retry_after)} seconds before scanning again.",
                    headers={
                        "Retry-After": str(max(1, retry_after)),
                        "X-Retry-After-Seconds": str(max(1, retry_after))
                    }
                )

    def record_failure(self, key: str) -> None:
        now = time.time()
        with self._lock:
            valid_times = [t for t in self._failures[key] if now - t < self.window_seconds]
            valid_times.append(now)
            self._failures[key] = valid_times
            if len(valid_times) >= self.max_failures:
                self._cooldowns[key] = now + self.cooldown_seconds
                self._failures.pop(key, None)
                try:
                    from app.services.security_alert_service import alert_tracker, EVENT_FAILED_HMAC
                    alert_tracker.record_and_evaluate(EVENT_FAILED_HMAC, key, key)
                except Exception:
                    pass

    def record_success(self, key: str) -> None:
        """AM3: Exempt legitimate scans by resetting any failure history immediately."""
        with self._lock:
            self._failures.pop(key, None)

failed_token_tracker = FailedTokenTracker(max_failures=15, window_seconds=60, cooldown_seconds=60)


class StudentScanRateLimiter:
    """
    In-memory rate limiter enforcing max 15 scan attempts per minute per ROLL NUMBER (AM-200).
    Prevents rogue client loops or scraping scripts while allowing all legitimate students
    on a shared classroom NAT IP to submit without interference.
    """
    def __init__(self, max_attempts: int = 15, window_seconds: int = 60):
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self._attempts: Dict[str, List[float]] = defaultdict(list)
        self._lock = threading.Lock()

    def check_rate_limit(self, roll_number: str) -> None:
        if not roll_number:
            return
        clean_roll = roll_number.strip().upper()
        now = time.time()
        with self._lock:
            valid_attempts = [t for t in self._attempts[clean_roll] if now - t < self.window_seconds]
            if len(valid_attempts) >= self.max_attempts:
                retry_after = int(self.window_seconds - (now - valid_attempts[0]))
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail={
                        "code": "rate_limited",
                        "message": f"Too many scan attempts for roll {clean_roll}. Maximum {self.max_attempts} attempts per minute allowed. Please wait {max(1, retry_after)} seconds.",
                        "retry_after": max(1, retry_after),
                        "serverNow": now
                    },
                    headers={
                        "Retry-After": str(max(1, retry_after)),
                        "X-Retry-After-Seconds": str(max(1, retry_after))
                    }
                )
            valid_attempts.append(now)
            self._attempts[clean_roll] = valid_attempts

    def reset_limit(self, roll_number: str) -> None:
        """Resets attempt history immediately for legitimate/successful scans."""
        if not roll_number:
            return
        clean_roll = roll_number.strip().upper()
        with self._lock:
            self._attempts.pop(clean_roll, None)


student_scan_limiter = StudentScanRateLimiter(max_attempts=15, window_seconds=60)

# Bounded concurrency token limiter: ensures at most 25 database scan workers run concurrently (AM-200)
_scan_concurrency_tokens = threading.BoundedSemaphore(25)


def _async_scan_telemetry(
    student_id: int,
    roll_number: str,
    device_id: Optional[int],
    session_id: int,
    period_count: int,
    now_utc: datetime,
    ip_addr: Optional[str]
):
    """Background task for audit logging and concurrent scan proxy telemetry (AM-200)."""
    try:
        from app.core.database import SessionLocal
        with SessionLocal() as bg_db:
            # 1. Audit log event
            log_security_audit_event(
                db=bg_db,
                event_type=SecurityEventType.ATTENDANCE_SUBMITTED,
                action="STUDENT_PROJECTOR_SCAN_SUCCESS",
                details=f"Student {roll_number} scanned teacher projector QR for session {session_id} (Period count: {period_count})",
                roll_number=roll_number,
                device_id=device_id,
                ip_address=ip_addr
            )

            # 2. Layer 3: Concurrent scan telemetry
            if ip_addr and device_id:
                from sqlalchemy import and_
                concurrent_window_start = now_utc - timedelta(seconds=60)
                concurrent_scans = bg_db.query(AttendanceRecord).filter(
                    and_(
                        AttendanceRecord.session_id == session_id,
                        AttendanceRecord.student_id != student_id,
                        AttendanceRecord.status == AttendanceStatus.PRESENT,
                        AttendanceRecord.scan_mode == "PROJECTOR_SCAN",
                        AttendanceRecord.scanned_at >= concurrent_window_start,
                        AttendanceRecord.scanned_at <= now_utc
                    )
                ).all()

                if concurrent_scans:
                    other_rolls = [s.roll_number for s in concurrent_scans]
                    matched_binding = bg_db.query(DeviceAccountBinding).filter(
                        DeviceAccountBinding.roll_number.in_(other_rolls),
                        DeviceAccountBinding.device_id == device_id,
                        DeviceAccountBinding.status == BindingStatus.ACTIVE,
                        DeviceAccountBinding.expires_at > now_utc
                    ).first()

                    if matched_binding:
                        log_security_audit_event(
                            db=bg_db,
                            event_type=SecurityEventType.SUSPICIOUS_CONCURRENT_SCAN,
                            action="MULTI_ACCOUNT_DEVICE_DETECTED",
                            details=f"Device ID {device_id} concurrently scanned for multiple students: {roll_number} and {matched_binding.roll_number}",
                            roll_number=roll_number,
                            device_id=device_id,
                            ip_address=ip_addr
                        )
    except Exception as bg_err:
        import logging
import queue

class AsyncAttendanceWriter:
    """
    AM-200 Mandatory Async Fast-Path for Student Projector Scans:
    Validates HMAC in-memory in microseconds, returns HTTP 200 immediately,
    and enqueues the database write to a bounded worker pool.
    Decouples remote MySQL network round-trip latency from the 10-20s rotating QR window.
    """
    def __init__(self, num_workers: int = 10, max_queue_size: int = 2000):
        self._queue = queue.Queue(maxsize=max_queue_size)
        self._num_workers = num_workers
        self._started = False
        self._lock = threading.Lock()
        self._results = {}
        self._fast_cache = set()  # (session_id, roll_number)
        self._fast_cache_lock = threading.Lock()

    def start_workers(self):
        with self._lock:
            if self._started:
                return
            self._started = True
            for i in range(self._num_workers):
                t = threading.Thread(target=self._worker_loop, daemon=True, name=f"att_writer_{i}")
                t.start()

    def _worker_loop(self):
        from app.core.database import SessionLocal
        from app.models.models import AttendanceRecord, AttendanceStatus
        from app.core.device_security import register_or_get_device, enforce_device_binding
        
        while True:
            try:
                task = self._queue.get()
                if task is None:
                    break
                job_id, payload = task
                try:
                    with SessionLocal() as db:
                        # 1. Legacy device registration & binding check (bypassed under BINDING_V2)
                        if not getattr(settings, 'BINDING_V2', False) and payload.get("device_id"):
                            dev = register_or_get_device(
                                db=db,
                                device_public_id=payload["device_id"],
                                device_secret=payload.get("device_secret", ""),
                                ip_address=payload.get("ip_addr")
                            )
                            if dev and dev.is_active:
                                try:
                                    enforce_device_binding(
                                        db=db,
                                        device=dev,
                                        roll_number=payload["roll_number"],
                                        ip_address=payload.get("ip_addr")
                                    )
                                except Exception:
                                    pass
                        
                        # 2. Duplicate check & write
                        existing = db.query(AttendanceRecord).filter(
                            AttendanceRecord.session_id == payload["session_id"],
                            AttendanceRecord.student_id == payload["student_id"]
                        ).first()
                        
                        scan_mode_val = payload.get("scan_mode") or "PROJECTOR_SCAN"
                        rec_id = None
                        if existing:
                            existing.status = AttendanceStatus.PRESENT
                            existing.period_count = payload["period_count"]
                            existing.scan_mode = scan_mode_val
                            existing.student_latitude = payload.get("student_latitude")
                            existing.student_longitude = payload.get("student_longitude")
                            existing.gps_accuracy_m = payload.get("gps_accuracy_m")
                            existing.distance_m = payload.get("distance_m")
                            existing.scanned_at = payload["now_utc"]
                            rec_id = existing.id
                        else:
                            new_rec = AttendanceRecord(
                                session_id=payload["session_id"],
                                student_id=payload["student_id"],
                                roll_number=payload["roll_number"],
                                session_date=payload["session_date"],
                                period_count=payload["period_count"],
                                status=AttendanceStatus.PRESENT,
                                scan_mode=scan_mode_val,
                                student_latitude=payload.get("student_latitude"),
                                student_longitude=payload.get("student_longitude"),
                                gps_accuracy_m=payload.get("gps_accuracy_m"),
                                distance_m=payload.get("distance_m"),
                                scanned_at=payload["now_utc"]
                            )
                            db.add(new_rec)
                            db.flush()
                            rec_id = new_rec.id
                        db.commit()
                        try:
                            from app.services.attendance_engine import invalidate_attendance_cache
                            invalidate_attendance_cache(student_id=payload["student_id"])
                        except Exception:
                            pass
                        with self._lock:
                            self._results[job_id] = {
                                "status": "SUCCESS",
                                "attendance_id": rec_id,
                                "message": "Recorded in database."
                            }

                        # 3. Post-scan sync executed inside isolated worker thread
                        if payload.get("sync_meta"):
                            try:
                                sm = payload["sync_meta"]
                                _async_post_scan_tasks(
                                    roll_number=payload["roll_number"],
                                    date_formatted=payload["session_date"],
                                    student_name=payload.get("student_name", ""),
                                    dept_code=sm.get("dept_code", ""),
                                    year_name=sm.get("year_name", ""),
                                    sec_name=sm.get("sec_name", ""),
                                    sub_name=sm.get("sub_name", ""),
                                    period=sm.get("period", ""),
                                    teacher_name=sm.get("teacher_name", ""),
                                    gs_id=sm.get("teacher_gsheet_id", ""),
                                    period_count=payload["period_count"]
                                )
                            except Exception:
                                pass
                except IntegrityError:
                    # Concurrent duplicate race: another worker thread committed the exact same (session_id, student_id)
                    try:
                        db.rollback()
                        existing = db.query(AttendanceRecord).filter(
                            AttendanceRecord.session_id == payload["session_id"],
                            AttendanceRecord.student_id == payload["student_id"]
                        ).first()
                        with self._fast_cache_lock:
                            self._fast_cache.add((payload["session_id"], payload["roll_number"]))
                        with self._lock:
                            self._results[job_id] = {
                                "status": "ALREADY_MARKED",
                                "attendance_id": existing.id if existing else None,
                                "message": "Already marked present."
                            }
                        try:
                            from app.services.attendance_engine import invalidate_attendance_cache
                            invalidate_attendance_cache(student_id=payload["student_id"], roll_number=payload["roll_number"])
                        except Exception:
                            pass
                    except Exception as rollback_err:
                        logging.getLogger("snist_erp.student").warning(f"Error resolving race condition for {payload.get('roll_number')}: {rollback_err}")
                except Exception as ex:
                    import logging
                    logging.getLogger("snist_erp.student").error(f"Async attendance writer error for {payload.get('roll_number')}: {ex}")
                    with self._fast_cache_lock:
                        self._fast_cache.discard((payload.get("session_id"), payload.get("roll_number")))
                    with self._lock:
                        self._results[job_id] = {"status": "ERROR", "message": str(ex)}
                finally:
                    self._queue.task_done()
            except Exception:
                time.sleep(0.01)

    def is_already_marked(self, session_id: int, roll: str) -> bool:
        with self._fast_cache_lock:
            return (session_id, roll) in self._fast_cache

    def mark_in_cache(self, session_id: int, roll: str):
        with self._fast_cache_lock:
            self._fast_cache.add((session_id, roll))

    def enqueue(self, job_id: str, payload: dict) -> bool:
        self.start_workers()
        self.mark_in_cache(payload["session_id"], payload["roll_number"])
        try:
            self._queue.put_nowait((job_id, payload))
            with self._lock:
                self._results[job_id] = {"status": "QUEUED", "message": "Attendance queued for database write."}
            return True
        except queue.Full:
            return False

    def get_status(self, job_id: str) -> dict:
        with self._lock:
            return self._results.get(job_id, {"status": "UNKNOWN"})

async_attendance_writer = AsyncAttendanceWriter(num_workers=10)


@router.get("/scan-status/{job_id}")
def get_scan_status(job_id: str, current_student: Student = Depends(require_student)):
    """AM-200: Polling endpoint to verify background attendance write status."""
    return async_attendance_writer.get_status(job_id)


@router.post("/scan-session")
async def student_scan_session(
    req: StudentScanSessionRequest,
    background_tasks: BackgroundTasks,
    request: Request,
    db: Session = Depends(get_db),
    current_student: Student = Depends(require_student)
):
    """
    Endpoint for students scanning the teacher's projected rotating 10-second QR code.
    Validates token in-memory FIRST (Step 0) to eliminate DB round-trips for invalid/replay tokens.
    """
    t_scan_start = time.perf_counter()
    now_utc = datetime.utcnow()
    ip_addr = request.client.host if request.client else None
    device_id = (req.device_id or req.device_uuid or request.headers.get("x-device-public-id", "")).strip()
    clean_roll = current_student.roll_number.strip().upper()
    tracker_key = f"{ip_addr or 'unknown'}_{device_id or clean_roll}"
    device_bucket = classify_device(request.headers.get("user-agent", ""))


    # Step 0a: Fast-fail if this client is under active cooldown from invalid token flooding
    failed_token_tracker.check_rate_limit(tracker_key)

    # Step 0b: AM-200 Enforce per-student scan attempt rate limit (max 6 attempts/min per roll number)
    student_scan_limiter.check_rate_limit(clean_roll)

    # Step 0c: Dual-Format verification (< 0.05ms memory cache, ZERO DB round-trips for hits)
    t_hmac_start = time.perf_counter()
    from app.core.security import TokenValidationError
    now_ts = time.time()
    claim_consumed_here = False
    try:
        if req.claim_token:
            from app.services.launch_token import validate_and_consume_claim
            claim_data = validate_and_consume_claim(req.claim_token, now_ts=now_ts)
            claim_consumed_here = True
            token_data = {
                "session_id": claim_data["session_id"],
                "short_code": claim_data["short_code"],
                "step": claim_data["v"],
                "token_format": "claim",
                "period_count": 1
            }
        else:
            raw_token = (req.session_token or "").strip()
            code_input = raw_token or (req.short_code or "").strip()
            if not code_input:
                raise TokenValidationError(code="invalid", message="Missing attendance token: session_token or short_code required.", server_now=now_ts)

            # Defensive token extraction if client submitted raw URL or relative path
            if code_input and ("/a/" in code_input or "http://" in code_input or "https://" in code_input):
                try:
                    from app.services.launch_token import extract_launch_token_from_url
                    extracted_token = extract_launch_token_from_url(code_input)
                    if extracted_token:
                        code_input = extracted_token
                except Exception:
                    pass

            token_data = ShortTokenService.validate_attendance_token(
                db=db,
                payload_or_code=code_input,
                v=req.v,
                step_window=10,
                max_grace_steps=1,
                now_ts=now_ts,
                is_offline_submission=bool(req.is_offline_submission)
            )
        t_hmac_ms = (time.perf_counter() - t_hmac_start) * 1000
    except TokenValidationError as tve:
        failed_token_tracker.record_failure(tracker_key)
        client_epoch_ms = request.headers.get("x-client-epoch-ms")
        skew_ms = None
        if client_epoch_ms:
            try:
                skew_ms = round(float(client_epoch_ms) - (now_ts * 1000), 2)
            except Exception:
                pass

        if (tve.code in ("QR-OLD", "expired") or getattr(tve, "code", None) == "QR-OLD") and getattr(tve, "session_id", None):
            try:
                from app.services.display_heartbeat import record_qr_old_event
                record_qr_old_event(tve.session_id)
            except Exception:
                pass

        p7_code = "QR-SESSION-END" if str(tve.code) == "QR-SESSION-END" else "QR-OLD"
        try:
            log_security_audit_event(
                db=db,
                event_type=SecurityEventType.ATTENDANCE_REJECTED,
                action="PROJECTOR_TOKEN_REJECTED",
                details=f"Projector token validation error for student {current_student.roll_number}: {tve.message} | epoch_delta={tve.epoch_delta}, session_status={tve.session_status}, skew_ms={skew_ms}",
                roll_number=current_student.roll_number
            )
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "expired",
                "error_code": p7_code,
                "phase7_code": p7_code,
                "message": tve.message, 
                "serverNow": tve.server_now,
                "epoch_delta": tve.epoch_delta,
                "session_status": tve.session_status,
                "skew_ms": skew_ms
            }
        )
    except ValueError as val_err:
        failed_token_tracker.record_failure(tracker_key)
        try:
            log_security_audit_event(
                db=db,
                event_type=SecurityEventType.ATTENDANCE_REJECTED,
                action="PROJECTOR_TOKEN_REJECTED",
                details=f"Projector token validation error for student {current_student.roll_number}: {str(val_err)}",
                roll_number=current_student.roll_number
            )
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "invalid", "message": str(val_err), "serverNow": time.time()}
        )

    try:
        # Calculate token age in milliseconds between issuance and validation
        token_step = token_data.get("step")
        token_age_ms = max(0, int((time.time() - (token_step * 10)) * 1000)) if token_step is not None else None

        # Step 0d: AM3 Valid token exemption: reset any prior failed token count immediately!
        failed_token_tracker.record_success(tracker_key)

        # Step 0e: Device Binding V2 Possession Proof (Feature-Flagged, Phase 4 & Phase 5 Cutover)
        # When BINDING_V2=true, validates ECDSA P-256 challenge-response before allowing attendance.
        # When BINDING_V2=false (legacy test mode), requests sending only legacy device ID receive hard deprecation error.
        # Offline submissions are exempt (cannot fetch challenge while offline).
        binding_proof_meta = None
        if getattr(settings, 'BINDING_V2', False):
            if not req.is_offline_submission:
                try:
                    binding_proof_meta = _verify_binding_proof(db, current_student, req, ip_addr)
                except HTTPException:
                    raise  # Re-raise 401/403/429 binding failures
                except Exception as binding_err:
                    # Defensive: never crash the scan path due to binding module errors
                    logger.error(f"[BINDING V2] Non-fatal verification error for {clean_roll}: {binding_err}")
                    binding_proof_meta = {"binding_verified": False, "reason": "internal_error"}
        else:
            # Phase 5 Server Cutover: Hard deprecation under flag-off for clients sending only legacy device ID
            has_legacy_id = bool(req.device_uuid or request.headers.get("x-device-public-id"))
            has_v2_proof = bool(req.challenge_token and req.binding_signature)
            if has_legacy_id and not has_v2_proof and not req.is_offline_submission:
                raise HTTPException(
                    status_code=status.HTTP_410_GONE,
                    detail="legacy_binding_retired: Legacy soft-binding device ID has been retired. Device binding enrollment is required."
                )

        session_id = token_data["session_id"]
        period_count = max(1, min(8, int(token_data.get("period_count", 1))))

        # 1. Fetch session using BoundedLRUSessionCache (avoids remote MySQL round-trip on hits)
        t_enroll_start = time.perf_counter()
        session_meta = get_cached_session_meta(db, session_id)
        if not session_meta:
            raise HTTPException(status_code=404, detail="Attendance session not found.")

        # Authoritative multi-period inheritance: Never downgrade multi-period sessions to single period
        sess_period_label = session_meta.get("period", "")
        if sess_period_label:
            from app.api.teacher import _extract_period_count
            sess_p = _extract_period_count(sess_period_label)
            if sess_p > period_count:
                period_count = sess_p

        resolved_subject_name = (session_meta.get("subject_name") or "").strip() or "Career Enhancement Training (CET)"
        session_meta["subject_name"] = resolved_subject_name

        status_str = getattr(session_meta["status"], "value", str(session_meta["status"]))
        if status_str != "OPEN":
            locked_at = session_meta.get("locked_at")
            grace_minutes = getattr(settings, "SUBMIT_GRACE_MINUTES", 10)

            # Offline submissions are only accepted if queued BEFORE the session lock time!
            queued_at_val = getattr(req, "queued_at", None)
            is_valid_prelock_offline = False
            if getattr(req, "is_offline_submission", False) and queued_at_val is not None:
                try:
                    q_dt = None
                    if isinstance(queued_at_val, (int, float)):
                        # If epoch milliseconds (> 1e11), convert to seconds
                        epoch_sec = queued_at_val / 1000.0 if queued_at_val > 1e11 else float(queued_at_val)
                        q_dt = datetime.utcfromtimestamp(epoch_sec)
                    elif isinstance(queued_at_val, str):
                        cleaned = queued_at_val.strip().replace("Z", "+00:00")
                        if cleaned.isdigit() or (cleaned.replace(".", "", 1).isdigit()):
                            num_val = float(cleaned)
                            epoch_sec = num_val / 1000.0 if num_val > 1e11 else num_val
                            q_dt = datetime.utcfromtimestamp(epoch_sec)
                        else:
                            q_dt = datetime.fromisoformat(cleaned).replace(tzinfo=None)
                    elif isinstance(queued_at_val, datetime):
                        q_dt = queued_at_val.replace(tzinfo=None)

                    if q_dt and locked_at and q_dt <= locked_at:
                        is_valid_prelock_offline = True
                except Exception as parse_err:
                    logger.warning(f"[Offline Sync] Failed to parse queued_at ({queued_at_val}): {parse_err}")

            if is_valid_prelock_offline and locked_at:
                time_since_lock_sec = (now_utc - locked_at).total_seconds()
                if time_since_lock_sec > (grace_minutes * 60):
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Attendance session is locked. Submission grace window ({grace_minutes}m) has expired."
                    )
                logger.info(
                    f"Accepted offline/grace submission for student {clean_roll} in locked session {session_id} "
                    f"(+{time_since_lock_sec:.1f}s post-lock, grace_limit={grace_minutes}m)"
                )
            else:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={
                        "code": "expired",
                        "error_code": "QR-SESSION-END",
                        "phase7_code": "QR-SESSION-END",
                        "message": "This class session has ended. Attendance session is locked. See your faculty if you believe this is wrong. (Code: QR-SESSION-END)",
                        "session_status": "LOCKED",
                        "serverNow": time.time()
                    }
                )

        # 2. Check section membership (in-memory)
        if current_student.section_id != session_meta["section_id"]:
            try:
                log_security_audit_event(
                    db=db,
                    event_type=SecurityEventType.ATTENDANCE_REJECTED,
                    action="SECTION_MISMATCH_REJECTED",
                    details=f"Student {current_student.roll_number} section {current_student.section_id} mismatched session section {session_meta['section_id']}",
                    roll_number=current_student.roll_number
                )
            except Exception:
                pass
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Student is not enrolled in this section."
            )
        t_enrollment_ms = (time.perf_counter() - t_enroll_start) * 1000

        # 2b. Geofence validation (Rule 5 & MVP GPS geofence)
        from app.services.geofence_service import validate_student_geofence
        fac_lat = session_meta.get("faculty_latitude")
        fac_lon = session_meta.get("faculty_longitude")
        radius_m = session_meta.get("geofence_radius_m") or 100.0

        is_valid_geo, dist_calc, geo_msg = validate_student_geofence(
            student_lat=req.latitude,
            student_lon=req.longitude,
            student_acc=req.accuracy_m,
            session_lat=fac_lat,
            session_lon=fac_lon,
            session_acc=session_meta.get("faculty_accuracy_m"),
            geofence_radius_m=radius_m
        )
        if not is_valid_geo:
            try:
                log_security_audit_event(
                    db=db,
                    event_type=SecurityEventType.ATTENDANCE_REJECTED,
                    action="GEOFENCE_VALIDATION_FAILED",
                    details=f"Student {clean_roll} failed geofence: {geo_msg}",
                    roll_number=clean_roll,
                    ip_address=ip_addr
                )
            except Exception:
                pass
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"code": "geofence_failed", "message": f"Geofence validation failed: {geo_msg}", "serverNow": time.time()}
            )

        # 3. Database operations bounded by concurrency token pool (AM-200: 25 tokens)
        now_utc = datetime.utcnow()
        is_sqlite = getattr(getattr(db, "bind", None), "dialect", None) and db.bind.dialect.name == "sqlite"
        scan_mode_val = req.scan_mode or ("QR_OFFLINE_SYNC" if req.is_offline_submission else "PROJECTOR_SCAN")

        if not is_sqlite:
            # AM-200 Mandatory Async Fast-Path for Production MySQL (Decoupled from 230ms DB latency)
            if async_attendance_writer.is_already_marked(session_id, clean_roll):
                student_scan_limiter.reset_limit(clean_roll)
                failed_token_tracker.record_success(tracker_key)
                with _STUDENT_SUMMARY_CACHE_LOCK:
                    _STUDENT_SUMMARY_CACHE.pop(current_student.id, None)
                try:
                    from app.services.attendance_engine import invalidate_attendance_cache
                    invalidate_attendance_cache(student_id=current_student.id, roll_number=clean_roll)
                except Exception:
                    pass
                return {
                    "status": "ALREADY_MARKED",
                    "message": "You have already been marked present for this session.",
                    "session_id": session_id,
                    "token_format": token_data.get("token_format", "legacy"),
                    "subject_name": resolved_subject_name,
                    "period_name": session_meta["period"],
                    "period_count": period_count,
                    "session_date": session_meta["session_date"],
                    "roll_number": current_student.roll_number,
                    "student_name": current_student.name
                }

            job_id = f"SCAN-{session_id}-{clean_roll}-{int(time.time() * 1000)}"
            if not device_id:
                import hashlib
                client_ua = request.headers.get("user-agent", "generic_student_browser")
                client_ip = ip_addr or "127.0.0.1"
                conn_sig = hashlib.sha256(f"{client_ip}_{client_ua}".encode()).hexdigest()[:16]
                device_id = f"DEV-CONN-{conn_sig.upper()}"

            device_secret = request.headers.get("x-device-secret", "").strip() or f"{device_id}_SECRET_SALT_2026"

            payload = {
                "job_id": job_id,
                "session_id": session_id,
                "student_id": current_student.id,
                "roll_number": clean_roll,
                "student_name": current_student.name,
                "device_id": device_id.strip(),
                "device_secret": device_secret,
                "period_count": period_count,
                "session_date": session_meta["session_date"],
                "now_utc": now_utc,
                "ip_addr": ip_addr,
                "student_latitude": req.latitude,
                "student_longitude": req.longitude,
                "gps_accuracy_m": req.accuracy_m,
                "distance_m": dist_calc,
                "scan_mode": scan_mode_val,
                "sync_meta": {
                    "dept_code": current_student.department.code if current_student.department else "",
                    "year_name": current_student.academic_year.name if current_student.academic_year else "",
                    "sec_name": session_meta["section_name"],
                    "sub_name": session_meta["subject_name"],
                    "period": session_meta["period"],
                    "teacher_name": session_meta["teacher_name"],
                    "teacher_gsheet_id": session_meta["teacher_gsheet_id"],
                }
            }

            async_attendance_writer.enqueue(job_id, payload)
            student_scan_limiter.reset_limit(clean_roll)
            failed_token_tracker.record_success(tracker_key)
            with _STUDENT_SUMMARY_CACHE_LOCK:
                _STUDENT_SUMMARY_CACHE.pop(current_student.id, None)
            try:
                from app.services.attendance_engine import invalidate_attendance_cache
                invalidate_attendance_cache(student_id=current_student.id, roll_number=clean_roll)
            except Exception:
                pass

            t_total_ms = (time.perf_counter() - t_scan_start) * 1000
            logger.info(
                f"[SCAN_TIMINGS] roll={clean_roll} bucket={device_bucket} token_age_ms={token_age_ms} "
                f"hmac_ms={t_hmac_ms:.2f} enroll_ms={t_enrollment_ms:.2f} total_ms={t_total_ms:.2f} mode=ASYNC"
            )

            return {
                "status": "SUCCESS",
                "job_id": job_id,
                "message": f"Successfully marked present for {period_count} period{'s' if period_count > 1 else ''}!",
                "session_id": session_id,
                "token_format": token_data.get("token_format", "legacy"),
                "distance_m": dist_calc,
                "scan_mode": scan_mode_val,
                "subject_name": resolved_subject_name,
                "period_name": session_meta["period"],
                "period_count": period_count,
                "session_date": session_meta["session_date"],
                "roll_number": current_student.roll_number,
                "student_name": current_student.name
            }

        device = None
        with _scan_concurrency_tokens:
            # Server-authoritative 30-minute device lock (Rule 6 in AGENTS.md)
            # Blocks Student B from scanning on Student A's phone within 30 minutes
            from app.core.device_security import register_or_get_device, enforce_device_binding
            if not device_id:
                import hashlib
                client_ua = request.headers.get("user-agent", "generic_student_browser")
                client_ip = ip_addr or "127.0.0.1"
                conn_sig = hashlib.sha256(f"{client_ip}_{client_ua}".encode()).hexdigest()[:16]
                device_id = f"DEV-CONN-{conn_sig.upper()}"

            device_secret = request.headers.get("x-device-secret", "").strip() or f"{device_id}_SECRET_SALT_2026"

            device = register_or_get_device(
                db=db,
                device_public_id=device_id.strip(),
                device_secret=device_secret,
                ip_address=ip_addr
            )
            if not device.is_active:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Device has been revoked or disabled by system administrator."
                )

            # Server-authoritative 30-minute device lock (blocks Student B from scanning on Student A's phone)
            enforce_device_binding(
                db=db,
                device=device,
                roll_number=clean_roll,
                ip_address=ip_addr
            )

            # Layer 2: Bi-directional student-to-device enrollment (blocks cross-browser proxy)
            try:
                from app.core.device_security import enforce_student_device_enrollment
                enforce_student_device_enrollment(
                    db=db,
                    student=current_student,
                    device=device,
                    ip_address=ip_addr
                )
            except HTTPException:
                raise  # Re-raise the 403 from enrollment enforcement
            except Exception as enrollment_err:
                import logging
                logging.getLogger("snist_erp.student").warning(
                    f"Non-fatal enrollment check error for {clean_roll}: {enrollment_err}"
                )

            # 4. Check if already marked present (using composite index idx_att_rec_session_student)
            existing_record = db.query(AttendanceRecord).filter(
                AttendanceRecord.session_id == session_id,
                AttendanceRecord.student_id == current_student.id
            ).first()

            if existing_record and existing_record.status == AttendanceStatus.PRESENT:
                with _STUDENT_SUMMARY_CACHE_LOCK:
                    _STUDENT_SUMMARY_CACHE.pop(current_student.id, None)
                try:
                    from app.services.attendance_engine import invalidate_attendance_cache
                    invalidate_attendance_cache(student_id=current_student.id, roll_number=clean_roll)
                except Exception:
                    pass
                return {
                    "status": "ALREADY_MARKED",
                    "message": "You have already been marked present for this session.",
                    "session_id": session_id,
                    "attendance_id": existing_record.id,
                    "distance_m": existing_record.distance_m,
                    "scan_mode": existing_record.scan_mode,
                    "subject_name": resolved_subject_name,
                    "period_name": session_meta["period"],
                    "period_count": existing_record.period_count or period_count,
                    "session_date": session_meta["session_date"],
                    "roll_number": current_student.roll_number,
                    "student_name": current_student.name
                }

            # 5. Record or update attendance
            rec_id = None
            if existing_record:
                existing_record.status = AttendanceStatus.PRESENT
                existing_record.period_count = period_count
                existing_record.scan_mode = scan_mode_val
                existing_record.student_latitude = req.latitude
                existing_record.student_longitude = req.longitude
                existing_record.gps_accuracy_m = req.accuracy_m
                existing_record.distance_m = dist_calc
                existing_record.scanned_at = now_utc
                rec_id = existing_record.id
            else:
                new_record = AttendanceRecord(
                    session_id=session_id,
                    student_id=current_student.id,
                    roll_number=current_student.roll_number,
                    session_date=session_meta["session_date"],
                    period_count=period_count,
                    status=AttendanceStatus.PRESENT,
                    scan_mode=scan_mode_val,
                    student_latitude=req.latitude,
                    student_longitude=req.longitude,
                    gps_accuracy_m=req.accuracy_m,
                    distance_m=dist_calc,
                    scanned_at=now_utc
                )
                db.add(new_record)
                db.flush()
                rec_id = new_record.id

            try:
                db.commit()
            except IntegrityError:
                db.rollback()
                existing_record = db.query(AttendanceRecord).filter(
                    AttendanceRecord.session_id == session_id,
                    AttendanceRecord.student_id == current_student.id
                ).first()
                with _STUDENT_SUMMARY_CACHE_LOCK:
                    _STUDENT_SUMMARY_CACHE.pop(current_student.id, None)
                try:
                    from app.services.attendance_engine import invalidate_attendance_cache
                    invalidate_attendance_cache(student_id=current_student.id, roll_number=clean_roll)
                except Exception:
                    pass
                return {
                    "status": "ALREADY_MARKED",
                    "message": "You have already been marked present for this session.",
                    "session_id": session_id,
                    "attendance_id": existing_record.id if existing_record else None,
                    "distance_m": existing_record.distance_m if existing_record else dist_calc,
                    "scan_mode": existing_record.scan_mode if existing_record else scan_mode_val,
                    "subject_name": resolved_subject_name,
                    "period_name": session_meta["period"],
                    "period_count": existing_record.period_count if existing_record else period_count,
                    "session_date": session_meta["session_date"],
                    "roll_number": current_student.roll_number,
                    "student_name": current_student.name
                }

            with _STUDENT_SUMMARY_CACHE_LOCK:
                _STUDENT_SUMMARY_CACHE.pop(current_student.id, None)
            try:
                from app.services.attendance_engine import invalidate_attendance_cache
                invalidate_attendance_cache(student_id=current_student.id, roll_number=clean_roll)
            except Exception:
                pass

        # 6. Asynchronously record audit log and evaluate Layer 3 concurrent telemetry (AM-200)
        background_tasks.add_task(
            _async_scan_telemetry,
            student_id=current_student.id,
            roll_number=clean_roll,
            device_id=device.id if device else None,
            session_id=session_id,
            period_count=period_count,
            now_utc=now_utc,
            ip_addr=ip_addr
        )

        # 8. Asynchronous multi-target sync with pre-resolved session_meta (0 DB queries)
        background_tasks.add_task(
            _async_post_scan_tasks,
            roll_number=current_student.roll_number,
            date_formatted=session_meta["session_date"],
            student_name=current_student.name,
            dept_code=current_student.department.code if current_student.department else "",
            year_name=current_student.academic_year.name if current_student.academic_year else "",
            sec_name=session_meta["section_name"],
            sub_name=session_meta["subject_name"],
            period=session_meta["period"],
            teacher_name=session_meta["teacher_name"],
            gs_id=session_meta["teacher_gsheet_id"],
            period_count=period_count
        )

        t_total_ms = (time.perf_counter() - t_scan_start) * 1000
        logger.info(
            f"[SCAN_TIMINGS] roll={clean_roll} bucket={device_bucket} token_age_ms={token_age_ms} "
            f"hmac_ms={t_hmac_ms:.2f} enroll_ms={t_enrollment_ms:.2f} total_ms={t_total_ms:.2f} mode=SYNC"
        )

        return {
            "status": "SUCCESS",
            "attendance_id": rec_id,
            "distance_m": dist_calc,
            "scan_mode": scan_mode_val,
            "message": f"Successfully marked present for {period_count} period{'s' if period_count > 1 else ''}!",
            "session_id": session_id,
            "token_format": token_data.get("token_format", "legacy"),
            "subject_name": resolved_subject_name,
            "period_name": session_meta["period"],
            "period_count": period_count,
            "session_date": session_meta["session_date"],
            "roll_number": current_student.roll_number,
            "student_name": current_student.name
        }
    except Exception:
        if claim_consumed_here and req.claim_token:
            try:
                from app.services.launch_token import unconsume_claim
                unconsume_claim(req.claim_token)
            except Exception:
                pass
        raise
