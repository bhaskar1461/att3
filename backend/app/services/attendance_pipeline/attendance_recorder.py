import time
import logging
import asyncio
import hashlib
from typing import Dict, Any, Optional
from datetime import datetime
from fastapi import HTTPException, status, BackgroundTasks, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.models.models import AttendanceRecord, AttendanceStatus
from app.core.device_security import register_or_get_device, enforce_device_binding, enforce_student_device_enrollment

logger = logging.getLogger("snist_erp.scan_telemetry")


async def record_scan_attendance(
    db: Session,
    req: Any,
    current_student: Any,
    session_meta: Dict[str, Any],
    period_count: int,
    resolved_subject_name: str,
    dist_calc: float,
    scan_mode_val: str,
    now_utc: datetime,
    ip_addr: Optional[str],
    device_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    token_data: Dict[str, Any],
    tracker_key: str,
    clean_roll: str,
    device_bucket: str,
    token_age_ms: Optional[int],
    t_scan_start: float,
    t_hmac_ms: float,
    t_enrollment_ms: float,
    async_attendance_writer: Any,
    student_scan_limiter: Any,
    failed_token_tracker: Any,
    student_summary_cache_lock: Any,
    student_summary_cache: Any,
    scan_concurrency_tokens: Any,
    async_scan_telemetry_fn: Any,
    async_post_scan_tasks_fn: Any
) -> Dict[str, Any]:
    """
    Executes attendance write (either async writer for MySQL or bounded synchronous transaction for SQLite).
    Handles device registration, 30-minute lock, student-device enrollment, duplicate detection,
    database commit/rollback, cache busting, and telemetry dispatch.
    """
    session_id = token_data["session_id"]
    is_sqlite = getattr(getattr(db, "bind", None), "dialect", None) and db.bind.dialect.name == "sqlite"

    if not is_sqlite:
        # AM-200 Mandatory Async Fast-Path for Production MySQL
        if async_attendance_writer.is_already_marked(session_id, clean_roll):
            student_scan_limiter.reset_limit(clean_roll)
            failed_token_tracker.record_success(tracker_key)
            with student_summary_cache_lock:
                student_summary_cache.pop(current_student.id, None)
            try:
                from app.services.attendance_engine import invalidate_attendance_cache
                invalidate_attendance_cache(student_id=current_student.id, roll_number=clean_roll)
            except Exception:
                pass
            existing_record = db.query(AttendanceRecord).filter(
                AttendanceRecord.session_id == session_id,
                AttendanceRecord.student_id == current_student.id
            ).first()
            return {
                "status": "ALREADY_MARKED",
                "already_marked": True,
                "attendance_id": existing_record.id if existing_record else None,
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

        # FIX-3: Register per-job asyncio.Future before enqueuing to background worker
        job_fut = async_attendance_writer.create_waiter(job_id)
        async_attendance_writer.enqueue(job_id, payload)
        student_scan_limiter.reset_limit(clean_roll)
        failed_token_tracker.record_success(tracker_key)
        with student_summary_cache_lock:
            student_summary_cache.pop(current_student.id, None)
        try:
            from app.services.attendance_engine import invalidate_attendance_cache
            invalidate_attendance_cache(student_id=current_student.id, roll_number=clean_roll)
        except Exception:
            pass

        resolved_att_id = None
        try:
            resolved_att_id = await asyncio.wait_for(job_fut, timeout=2.0)
        except (asyncio.TimeoutError, TimeoutError):
            # Authoritative DB lookup fallback by (session_id, student_id)
            existing = db.query(AttendanceRecord).filter(
                AttendanceRecord.session_id == session_id,
                AttendanceRecord.student_id == current_student.id
            ).first()
            if existing:
                resolved_att_id = existing.id
            else:
                # 202 Accepted pending job poll per Section 3.3 contract
                poll_url = f"/api/v1/attendance/job/{job_id}"
                return JSONResponse(
                    status_code=status.HTTP_202_ACCEPTED,
                    content={
                        "job_id": job_id,
                        "status": "pending",
                        "poll_url": poll_url,
                        "session_id": session_id,
                        "subject_name": resolved_subject_name,
                        "period_name": session_meta["period"],
                        "period_count": period_count,
                        "session_date": session_meta["session_date"],
                        "roll_number": current_student.roll_number,
                        "student_name": current_student.name
                    }
                )

        t_total_ms = (time.perf_counter() - t_scan_start) * 1000
        logger.info(
            f"[SCAN_TIMINGS] roll={clean_roll} bucket={device_bucket} token_age_ms={token_age_ms} "
            f"hmac_ms={t_hmac_ms:.2f} enroll_ms={t_enrollment_ms:.2f} total_ms={t_total_ms:.2f} mode=ASYNC att_id={resolved_att_id}"
        )

        return {
            "status": "SUCCESS",
            "attendance_id": resolved_att_id,
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
    with scan_concurrency_tokens:
        if not device_id:
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

        # Server-authoritative 30-minute device lock (Rule 6 in AGENTS.md)
        enforce_device_binding(
            db=db,
            device=device,
            roll_number=clean_roll,
            ip_address=ip_addr
        )

        # Layer 2: Bi-directional student-to-device enrollment
        try:
            enforce_student_device_enrollment(
                db=db,
                student=current_student,
                device=device,
                ip_address=ip_addr
            )
        except HTTPException:
            raise
        except Exception as enrollment_err:
            logging.getLogger("snist_erp.student").warning(
                f"Non-fatal enrollment check error for {clean_roll}: {enrollment_err}"
            )

        # Check if already marked present
        existing_record = db.query(AttendanceRecord).filter(
            AttendanceRecord.session_id == session_id,
            AttendanceRecord.student_id == current_student.id
        ).first()

        if existing_record and existing_record.status == AttendanceStatus.PRESENT:
            with student_summary_cache_lock:
                student_summary_cache.pop(current_student.id, None)
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
            with student_summary_cache_lock:
                student_summary_cache.pop(current_student.id, None)
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

        with student_summary_cache_lock:
            student_summary_cache.pop(current_student.id, None)
        try:
            from app.services.attendance_engine import invalidate_attendance_cache
            invalidate_attendance_cache(student_id=current_student.id, roll_number=clean_roll)
        except Exception:
            pass

    # 6. Asynchronously record audit log and evaluate Layer 3 concurrent telemetry
    background_tasks.add_task(
        async_scan_telemetry_fn,
        student_id=current_student.id,
        roll_number=clean_roll,
        device_id=device.id if device else None,
        session_id=session_id,
        period_count=period_count,
        now_utc=now_utc,
        ip_addr=ip_addr
    )

    # 8. Asynchronous multi-target sync with pre-resolved session_meta
    background_tasks.add_task(
        async_post_scan_tasks_fn,
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
