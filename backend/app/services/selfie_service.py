"""
SNIST ERP Attendance System — Private Selfie Storage & Service
Handles post-attendance selfie capture, server-generated private storage keys,
file validation, and audit recording. Decoupled from core attendance validity.
"""

import os
import uuid
import logging
from datetime import datetime
from typing import Optional, Dict, Any, Tuple
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.models import AttendanceRecord, SelfieRecord, AttendanceStatus
from app.core.device_security import log_security_audit_event, SecurityEventType

logger = logging.getLogger("snist_erp.selfie")

MAX_SELFIE_SIZE_BYTES = 5 * 1024 * 1024  # 5 MB
ALLOWED_MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}


def _get_image_metadata(data: bytes) -> Tuple[str, int, int]:
    """
    Identifies image format and dimensions (width, height) from raw bytes.
    Uses PIL if available, or basic header detection fallback.
    """
    mime_type = "image/jpeg"
    width, height = 0, 0

    try:
        from PIL import Image
        import io
        img = Image.open(io.BytesIO(data))
        fmt = (img.format or "").upper()
        if fmt == "PNG":
            mime_type = "image/png"
        elif fmt == "WEBP":
            mime_type = "image/webp"
        else:
            mime_type = "image/jpeg"
        width, height = img.size
        return mime_type, width, height
    except Exception:
        # Fallback inspection by magic bytes
        if data.startswith(b"\x89PNG\r\n\x1a\n"):
            mime_type = "image/png"
        elif data.startswith(b"RIFF") and data[8:12] == b"WEBP":
            mime_type = "image/webp"
        elif data.startswith(b"\xff\xd8\xff"):
            mime_type = "image/jpeg"
        return mime_type, width, height


# sync-only — run via run_in_threadpool
def store_attendance_selfie(
    db: Session,
    attendance_id: int,
    student_id: int,
    image_bytes: bytes,
    frame_index: int = 1,
    total_frames: int = 1,
    ip_address: Optional[str] = None,
    session_id: Optional[int] = None
) -> Dict[str, Any]:
    """
    Validates, saves to private storage, and links selfie to attendance record.
    Organized by Roll Number and Student Name for AI model training:
        data/selfies/<ROLL>_<NAME>/<ROLL>_<NAME>_s<session_id>_<timestamp>_f<frame>_<uuid>.jpg
    """
    import time
    t_selfie_start = time.perf_counter()

    if not image_bytes or len(image_bytes) == 0:
        raise ValueError("Selfie image payload cannot be empty.")

    if len(image_bytes) > MAX_SELFIE_SIZE_BYTES:
        raise ValueError(f"Selfie image exceeds maximum allowed size of {MAX_SELFIE_SIZE_BYTES // (1024 * 1024)}MB.")

    mime_type, width, height = _get_image_metadata(image_bytes)
    if mime_type not in ALLOWED_MIME_TYPES:
        raise ValueError(f"Unsupported image type '{mime_type}'. Supported: JPEG, PNG, WebP.")

    # 1. Fetch attendance record & student details
    record = None
    if attendance_id and attendance_id > 0:
        record = db.query(AttendanceRecord).filter(
            AttendanceRecord.id == attendance_id,
            AttendanceRecord.student_id == student_id
        ).first()

    # FIX-2: Remove 5x 0.15s event-loop-blocking sleep.
    # Committed attendance_id is passed directly from FIX-3. Keep at most ONE fallback re-query.
    if not record and session_id:
        record = db.query(AttendanceRecord).filter(
            AttendanceRecord.session_id == session_id,
            AttendanceRecord.student_id == student_id
        ).order_by(AttendanceRecord.id.desc()).first()

    if not record:
        raise ValueError(f"Attendance record {attendance_id} for student {student_id} not found.")

    from app.models.models import Student
    student = db.query(Student).filter(Student.id == student_id).first()
    roll_number = (student.roll_number if student else record.roll_number or "UNKNOWN").upper().strip()
    raw_name = (student.name if student else "").strip() or "Student"
    clean_name = "".join(c for c in raw_name.replace(" ", "_") if c.isalnum() or c == "_")

    now = datetime.utcnow()
    session_id = record.session_id or 0
    unique_suffix = uuid.uuid4().hex[:6]
    timestamp_str = now.strftime("%Y%m%d_%H%M%S")
    file_name = f"{roll_number}_{clean_name}_s{session_id}_{timestamp_str}_f{frame_index}_{unique_suffix}.jpg"

    # Construct dataset storage key labeled by student identity for facial recognition model training
    folder_name = f"{roll_number}_{clean_name}"
    rel_key = os.path.join(folder_name, file_name)
    storage_base = getattr(settings, "SELFIE_STORAGE_DIR", os.path.join(settings.DATA_DIR, "selfies"))
    full_path = os.path.join(storage_base, rel_key)
    os.makedirs(os.path.dirname(full_path), exist_ok=True)

    # Write file to disk
    with open(full_path, "wb") as f:
        f.write(image_bytes)

    # 2. Persist SelfieRecord metadata
    selfie = SelfieRecord(
        attendance_id=record.id,
        student_id=student_id,
        session_id=session_id,
        object_storage_key=rel_key.replace("\\", "/"),
        mime_type=mime_type,
        file_size=len(image_bytes),
        width=width,
        height=height,
        quality_status="ACCEPTED",
        status="UPLOADED",
        captured_at=now,
        uploaded_at=now
    )
    db.add(selfie)

    # 3. Update AttendanceRecord
    record.selfie_status = "ACCEPTED"
    record.selfie_storage_key = rel_key.replace("\\", "/")
    db.commit()

    # 4. Audit Log
    try:
        log_security_audit_event(
            db=db,
            event_type=SecurityEventType.ATTENDANCE_SUBMITTED,
            action="SELFIE_SUBMITTED",
            details=f"Selfie frame {frame_index}/{total_frames} uploaded for attendance #{attendance_id} (Student {roll_number} {clean_name}, Session #{session_id})",
            roll_number=record.roll_number,
            ip_address=ip_address
        )
    except Exception:
        pass

    duration_ms = (time.perf_counter() - t_selfie_start) * 1000
    logger.info(
        f"[SELFIE_STORE] student_id={student_id} attendance_id={record.id} selfie_id={selfie.id} "
        f"selfie_store_duration_ms={duration_ms:.2f} status=ACCEPTED"
    )

    return {
        "status": "ACCEPTED",
        "selfie_id": selfie.id,
        "object_storage_key": selfie.object_storage_key,
        "file_size": len(image_bytes),
        "frame_index": frame_index,
        "selfie_store_duration_ms": duration_ms,
        "roll_number": roll_number,
        "student_name": clean_name
    }


def skip_attendance_selfie(
    db: Session,
    attendance_id: int,
    student_id: int,
    reason: str = "USER_SKIPPED",
    ip_address: Optional[str] = None,
    session_id: Optional[int] = None
) -> Dict[str, Any]:
    """
    Records that a selfie was skipped or failed.
    CRITICAL RULE: Never invalidates or reverses the existing attendance record.
    Attendance remains AttendanceStatus.PRESENT.
    """
    record = None
    if attendance_id and attendance_id > 0:
        record = db.query(AttendanceRecord).filter(
            AttendanceRecord.id == attendance_id,
            AttendanceRecord.student_id == student_id
        ).first()

    if not record and session_id:
        record = db.query(AttendanceRecord).filter(
            AttendanceRecord.session_id == session_id,
            AttendanceRecord.student_id == student_id
        ).order_by(AttendanceRecord.id.desc()).first()

    if not record:
        # Graceful return if record is still pending in async writer queue: attendance validity remains PRESENT
        return {
            "status": "SKIPPED",
            "attendance_id": attendance_id or 0,
            "attendance_status": "PRESENT",
            "selfie_status": "SKIPPED",
            "message": "Selfie skipped gracefully."
        }

    record.selfie_status = "SKIPPED" if reason == "USER_SKIPPED" else "FAILED"
    db.commit()

    try:
        log_security_audit_event(
            db=db,
            event_type=SecurityEventType.ATTENDANCE_SUBMITTED,
            action="SELFIE_SKIPPED",
            details=f"Selfie skipped for attendance #{record.id} (reason: {reason})",
            roll_number=record.roll_number,
            ip_address=ip_address
        )
    except Exception:
        pass

    return {
        "status": "SKIPPED",
        "attendance_id": record.id,
        "attendance_status": record.status.value if hasattr(record.status, "value") else str(record.status),
        "selfie_status": record.selfie_status
    }
