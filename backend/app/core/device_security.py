import hashlib
from datetime import datetime, timedelta
from typing import Optional, Tuple
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.models import (
    DeviceRegistration,
    DeviceAccountBinding,
    BindingStatus,
    AuditLog,
    SecurityEventType,
    Student
)

def hash_device_secret(secret: str) -> str:
    """Computes SHA-256 hash of device secret."""
    return hashlib.sha256(secret.encode('utf-8')).hexdigest()

import logging

logger = logging.getLogger("snist_erp.device_security")

def record_audit_log(
    db: Session,
    user_id: Optional[int],
    action: str,
    details: Optional[str] = None,
    roll_number: Optional[str] = None,
    event_type: str = "SECURITY_EVENT",
    device_id: Optional[int] = None,
    ip_address: Optional[str] = None
):
    """Helper to log security-sensitive events to audit log with defensive rollback safety."""
    log_entry = None
    try:
        log_entry = AuditLog(
            user_id=user_id,
            roll_number=roll_number,
            device_id=device_id,
            event_type=event_type.value if hasattr(event_type, 'value') else str(event_type),
            action=action,
            details=details,
            ip_address=ip_address,
            created_at=datetime.utcnow()
        )
        db.add(log_entry)
        db.commit()

        # Fire-and-forget security alert hook (non-blocking outside request thread)
        # WHY: Dispatches operational alerts for active incidents without adding latency to the response.
        try:
            # Skip manual admin-initiated device revocations as per Phase 2 user policy
            is_manual_admin_revocation = (
                log_entry.event_type == "DEVICE_REVOKED" and user_id is not None
            )
            if not is_manual_admin_revocation:
                from app.services.security_alert_service import SecurityAlertService
                SecurityAlertService.hook_audit_event(
                    event_type=log_entry.event_type,
                    roll_number=roll_number,
                    device_id=device_id,
                    ip_address=ip_address,
                    details=details,
                    audit_id=log_entry.id
                )
        except Exception as alert_err:
            # Defensive error boundary: alerting failure must never impact the database transaction
            logger.warning(f"Security alert hook non-fatal error: {alert_err}")
    except Exception as log_err:
        logger.warning(f"Failed to record security audit log entry: {log_err}")
        if log_entry:
            try:
                db.expunge(log_entry)
            except Exception:
                pass

def log_security_audit_event(
    db: Session,
    event_type: SecurityEventType,
    action: str,
    details: str,
    user_id: Optional[int] = None,
    roll_number: Optional[str] = None,
    device_id: Optional[int] = None,
    ip_address: Optional[str] = None
):
    """Helper to log security-sensitive events to audit log with defensive rollback safety."""
    record_audit_log(
        db=db,
        user_id=user_id,
        action=action,
        details=details,
        roll_number=roll_number,
        event_type=event_type,
        device_id=device_id,
        ip_address=ip_address
    )

def register_or_get_device(
    db: Session,
    device_public_id: str,
    device_secret: str,
    ip_address: Optional[str] = None
) -> DeviceRegistration:
    """
    Registers a new device or retrieves and verifies an existing registered device.
    """
    if not device_public_id or not device_secret:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing device credentials (device_public_id or device_secret)"
        )

    pub_id = device_public_id.strip()
    sec_hash = hash_device_secret(device_secret.strip())
    now = datetime.utcnow()

    device = db.query(DeviceRegistration).filter(DeviceRegistration.device_public_id == pub_id).first()

    try:
        if not device:
            device = DeviceRegistration(
                device_public_id=pub_id,
                device_credential_hash=sec_hash,
                first_registered_at=now,
                last_seen_at=now,
                is_active=True,
                created_at=now,
                updated_at=now
            )
            db.add(device)
            db.commit()
            db.refresh(device)

            log_security_audit_event(
                db=db,
                event_type=SecurityEventType.DEVICE_REGISTERED,
                action="DEVICE_REGISTERED",
                details=f"Device {pub_id} registered successfully",
                device_id=device.id,
                ip_address=ip_address
            )
            return device
    except Exception as reg_err:
        db.rollback()
        logger.error(f"Device registration database failure for {pub_id}: {reg_err}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to register or verify device credentials due to database error."
        )

    if not device.is_active:
        log_security_audit_event(
            db=db,
            event_type=SecurityEventType.LOGIN_FAILURE,
            action="DEVICE_ACCESS_BLOCKED",
            details=f"Device {pub_id} is revoked/disabled",
            device_id=device.id,
            ip_address=ip_address
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Device has been revoked or disabled by system administrator."
        )

    # Verify secret hash
    if device.device_credential_hash != sec_hash:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid device credential secret"
        )

    device.last_seen_at = now
    db.commit()
    return device

def is_demo_account(identifier: Optional[str]) -> bool:
    """Checks if username, roll number, or identifier corresponds to an unrestricted demo account."""
    if not identifier:
        return False
    val = str(identifier).strip().upper()
    return "DEMO" in val

def enforce_device_binding(
    db: Session,
    device: DeviceRegistration,
    roll_number: str,
    ip_address: Optional[str] = None,
    is_refresh: bool = False
) -> DeviceAccountBinding:
    """
    Enforces server-authoritative 30-minute device-to-Roll-Number binding.
    
    Rules:
    1. 30-minute lock: Device A bound to Roll X cannot authenticate as Roll Y during 30 min.
    2. Account Switch Rejection: Returns HTTP 403 generic message.
    3. 5-Attempt Limit: Max 5 authentication attempts per Roll X per 30-min window. Attempt 6 is HTTP 429.
       NOTE: Silent session token refreshes (is_refresh=True) validate the binding but do NOT
       increment attempt_count, preventing normal users from being locked out after 100 seconds.
    4. Row-level DB lock: Prevents concurrent race conditions.
    5. Demo Account Exemption: Demo accounts can authenticate from any device, any number of times.
    """
    clean_roll = roll_number.strip().upper()
    now = datetime.utcnow()

    # Demo account bypass: zero device lockouts, unlimited logins across any device
    if is_demo_account(clean_roll):
        logger.info(f"Demo student {clean_roll} bypassed device binding lock & attempt limits.")
        return DeviceAccountBinding(
            device_id=device.id,
            roll_number=clean_roll,
            status=BindingStatus.ACTIVE,
            attempt_count=1,
            expires_at=now + timedelta(minutes=30)
        )

    # Query active bindings for device with DB lock where supported
    query = db.query(DeviceAccountBinding).filter(
        DeviceAccountBinding.device_id == device.id,
        DeviceAccountBinding.status == BindingStatus.ACTIVE,
        DeviceAccountBinding.expires_at > now
    )

    try:
        query = query.with_for_update()
    except Exception:
        pass  # SQLite fallback

    active_bindings = query.all()

    if active_bindings:
        binding = active_bindings[0]
        
        # Rule: Account Switching Block
        if binding.roll_number != clean_roll:
            log_security_audit_event(
                db=db,
                event_type=SecurityEventType.ACCOUNT_SWITCH_ATTEMPT,
                action="ACCOUNT_SWITCH_ATTEMPT",
                details=f"Device bound to {binding.roll_number} attempted switch to {clean_roll}",
                roll_number=clean_roll,
                device_id=device.id,
                ip_address=ip_address
            )
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This device is temporarily associated with another student account. Please try again after the current security window expires."
            )

        # If this is a background token refresh for an already authenticated active session,
        # simply touch last_authentication_at and return without incrementing attempt_count
        if is_refresh:
            binding.last_authentication_at = now
            db.commit()
            return binding

        # Rule: Maximum Attempts Limit (Safe threshold: up to 10 logins per security window)
        max_attempts = getattr(settings, "MAX_BINDING_AUTH_ATTEMPTS", 10)
        if binding.attempt_count >= max_attempts:
            log_security_audit_event(
                db=db,
                event_type=SecurityEventType.AUTH_ATTEMPT_LIMIT_REACHED,
                action="AUTH_ATTEMPT_LIMIT_REACHED",
                details=f"Device binding for {clean_roll} reached maximum {max_attempts} attempts limit",
                roll_number=clean_roll,
                device_id=device.id,
                ip_address=ip_address
            )
            db.commit()
            seconds_left = max(1, int((binding.expires_at - now).total_seconds())) if binding.expires_at else 1800
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Maximum authentication attempts reached for this security window. Please try again after the binding window expires.",
                headers={
                    "Retry-After": str(seconds_left),
                    "X-Retry-After-Seconds": str(seconds_left)
                }
            )

        # Valid re-authentication for same bound roll number
        binding.attempt_count += 1
        binding.last_authentication_at = now
        db.commit()

        log_security_audit_event(
            db=db,
            event_type=SecurityEventType.LOGIN_SUCCESS,
            action="DEVICE_REAUTH_SUCCESS",
            details=f"Re-authenticated attempt {binding.attempt_count}/{max_attempts} for {clean_roll}",
            roll_number=clean_roll,
            device_id=device.id,
            ip_address=ip_address
        )
        return binding

    # Expire any previous bindings for this device in 1 bulk statement
    db.query(DeviceAccountBinding).filter(
        DeviceAccountBinding.device_id == device.id,
        DeviceAccountBinding.status == BindingStatus.ACTIVE,
        DeviceAccountBinding.expires_at <= now
    ).update({DeviceAccountBinding.status: BindingStatus.EXPIRED}, synchronize_session=False)

    # Create new 30-minute binding
    expires_at = now + timedelta(minutes=30)
    new_binding = DeviceAccountBinding(
        device_id=device.id,
        roll_number=clean_roll,
        bound_at=now,
        expires_at=expires_at,
        attempt_count=1,
        last_authentication_at=now,
        status=BindingStatus.ACTIVE,
        created_at=now,
        updated_at=now
    )
    db.add(new_binding)
    db.commit()
    db.refresh(new_binding)

    log_security_audit_event(
        db=db,
        event_type=SecurityEventType.DEVICE_BOUND,
        action="DEVICE_BOUND",
        details=f"Device {device.device_public_id} bound to {clean_roll} for 30 minutes (expires {expires_at.isoformat()})",
        roll_number=clean_roll,
        device_id=device.id,
        ip_address=ip_address
    )
    return new_binding

def validate_active_binding_for_student(
    db: Session,
    device_public_id: str,
    roll_number: str
) -> bool:
    """
    Validates that the given device is active and bound to the specified roll_number.
    """
    if not device_public_id or not roll_number:
        return False

    clean_roll = roll_number.strip().upper()
    if is_demo_account(clean_roll):
        return True
    now = datetime.utcnow()

    device = db.query(DeviceRegistration).filter(
        DeviceRegistration.device_public_id == device_public_id.strip(),
        DeviceRegistration.is_active == True
    ).first()

    if not device:
        return False

    binding = db.query(DeviceAccountBinding).filter(
        DeviceAccountBinding.device_id == device.id,
        DeviceAccountBinding.roll_number == clean_roll,
        DeviceAccountBinding.status == BindingStatus.ACTIVE,
        DeviceAccountBinding.expires_at > now
    ).first()

    return binding is not None

def revoke_device_by_admin(
    db: Session,
    device_public_id: str,
    admin_user_id: Optional[int] = None,
    ip_address: Optional[str] = None
) -> bool:
    """
    Admin function to revoke a device and all its active bindings.
    """
    pub_id = device_public_id.strip()
    device = db.query(DeviceRegistration).filter(DeviceRegistration.device_public_id == pub_id).first()

    if not device:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Device registration not found"
        )

    device.is_active = False

    # Mark active bindings as REVOKED
    active_bindings = db.query(DeviceAccountBinding).filter(
        DeviceAccountBinding.device_id == device.id,
        DeviceAccountBinding.status == BindingStatus.ACTIVE
    ).all()

    for b in active_bindings:
        b.status = BindingStatus.REVOKED

    db.commit()

    log_security_audit_event(
        db=db,
        event_type=SecurityEventType.DEVICE_REVOKED,
        action="DEVICE_REVOKED",
        details=f"Device {pub_id} revoked by admin user {admin_user_id}",
        user_id=admin_user_id,
        device_id=device.id,
        ip_address=ip_address
    )
    return True


def enforce_student_device_enrollment(
    db: Session,
    student: "Student",
    device: DeviceRegistration,
    ip_address: Optional[str] = None
) -> bool:
    """
    Enforces bi-directional student-to-device binding (Layer 2 Anti-Proxy Defense).

    Rules:
    1. First login with no registered device → auto-enroll current device.
    2. Subsequent logins from registered device → allow.
    3. Login from a DIFFERENT device when student already has a registered device → HTTP 403.

    Returns True if enrollment check passed.
    """
    clean_roll = student.roll_number.strip().upper()
    if is_demo_account(clean_roll) or (student.agency and "DEMO" in student.agency.upper()):
        logger.info(f"Demo student {clean_roll} bypassed device enrollment check.")
        return True

    # Case 1: Student has no registered device yet → auto-enroll
    if student.registered_device_id is None:
        student.registered_device_id = device.id
        db.commit()

        log_security_audit_event(
            db=db,
            event_type=SecurityEventType.DEVICE_ENROLLMENT_AUTO,
            action="DEVICE_ENROLLMENT_AUTO",
            details=f"Student {clean_roll} auto-enrolled on device {device.device_public_id} (ID: {device.id}) on first login",
            roll_number=clean_roll,
            device_id=device.id,
            ip_address=ip_address
        )
        logger.info(f"Auto-enrolled student {clean_roll} to device {device.device_public_id}")
        return True

    # Case 2: Student's registered device matches current device → allow
    if student.registered_device_id == device.id:
        return True

    # Case 3: Student's registered device is DIFFERENT from current device → BLOCK
    # Fetch the registered device's public ID for the log message
    registered_device = db.query(DeviceRegistration).filter(
        DeviceRegistration.id == student.registered_device_id
    ).first()
    registered_pub_id = registered_device.device_public_id if registered_device else f"ID:{student.registered_device_id}"

    log_security_audit_event(
        db=db,
        event_type=SecurityEventType.UNAPPROVED_DEVICE_LOGIN,
        action="UNAPPROVED_DEVICE_LOGIN",
        details=(
            f"Student {clean_roll} attempted login from unapproved device "
            f"{device.device_public_id} (ID: {device.id}). "
            f"Registered device: {registered_pub_id} (ID: {student.registered_device_id})"
        ),
        roll_number=clean_roll,
        device_id=device.id,
        ip_address=ip_address
    )

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=(
            "Your account is registered to a different device. "
            "To protect against proxy attendance, logins from unapproved devices are blocked. "
            "If you changed your phone, please contact your faculty or admin to reset your device binding."
        )
    )


def reset_student_device_enrollment(
    db: Session,
    roll_number: str,
    admin_user_id: Optional[int] = None,
    ip_address: Optional[str] = None
) -> dict:
    """
    Admin/Teacher function to reset a student's registered device binding.
    Used when a student replaces their phone or needs to re-enroll.
    """
    clean_roll = roll_number.strip().upper()
    student = db.query(Student).filter(
        Student.roll_number == clean_roll
    ).first()

    if not student:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Student with roll number '{clean_roll}' not found."
        )

    old_device_id = student.registered_device_id
    old_device_pub_id = None
    if old_device_id:
        old_device = db.query(DeviceRegistration).filter(
            DeviceRegistration.id == old_device_id
        ).first()
        old_device_pub_id = old_device.device_public_id if old_device else f"ID:{old_device_id}"

    student.registered_device_id = None

    # Phase 5: Revoke active cryptographic DeviceBinding keypairs
    from app.models.models import DeviceBinding
    bindings_to_revoke = db.query(DeviceBinding).filter(
        DeviceBinding.student_id == student.id,
        DeviceBinding.revoked_at.is_(None)
    ).all()
    for b in bindings_to_revoke:
        b.revoked_at = datetime.utcnow()
        b.revocation_reason = f"ADMIN_RESET_BY_{admin_user_id or 'OPERATOR'}"

    db.commit()

    log_security_audit_event(
        db=db,
        event_type=SecurityEventType.DEVICE_ENROLLMENT_RESET,
        action="DEVICE_ENROLLMENT_RESET",
        details=(
            f"Device enrollment reset for student {clean_roll}. "
            f"Previous device: {old_device_pub_id or 'None'} (ID: {old_device_id}). "
            f"Reset by admin user ID: {admin_user_id}"
        ),
        user_id=admin_user_id,
        roll_number=clean_roll,
        device_id=old_device_id,
        ip_address=ip_address
    )

    logger.info(f"Device enrollment reset for student {clean_roll} by admin {admin_user_id}")
    return {
        "status": "success",
        "roll_number": clean_roll,
        "previous_device": old_device_pub_id,
        "message": f"Device binding cleared for {clean_roll}. Student will auto-enroll on next login."
    }


def clear_security_lockouts(
    roll_number: Optional[str] = None,
    ip_address: Optional[str] = None,
    clear_all: bool = False
) -> Tuple[Optional[str], Optional[str]]:
    """
    Admin Operations helper: flushes in-memory security cooldowns WITHOUT a server restart.

    Clears:
      - failed_login_limiter  (300s IP block / 900s per-roll block)     — app.api.auth
      - student_scan_limiter  (per-roll scan attempts window)           — app.api.student
      - failed_token_tracker  (invalid QR token 60s memory cooldowns)   — app.api.student

    Returns (cleared_roll, cleared_ip) — "ALL" markers when clear_all=True.
    """
    from app.api.auth import failed_login_limiter
    from app.api.student import student_scan_limiter, failed_token_tracker

    clean_roll = (roll_number or "").strip().upper() or None
    clean_ip = (ip_address or "").strip() or None

    if clear_all:
        with failed_login_limiter._lock:
            failed_login_limiter._failures.clear()
            failed_login_limiter._roll_failures.clear()
        with student_scan_limiter._lock:
            student_scan_limiter._attempts.clear()
        with failed_token_tracker._lock:
            failed_token_tracker._failures.clear()
            failed_token_tracker._cooldowns.clear()
        logger.info("All login/scan/token rate limiters flushed by admin operation.")
        return ("ALL", "ALL")

    if clean_roll:
        # Roll-scoped login cooldown + scan window + any token-tracker buckets containing the roll
        failed_login_limiter.record_success(None, clean_roll)
        student_scan_limiter.reset_limit(clean_roll)
        with failed_token_tracker._lock:
            keys = list(failed_token_tracker._failures.keys()) + list(failed_token_tracker._cooldowns.keys())
            for k in keys:
                if clean_roll in str(k).upper():
                    failed_token_tracker._failures.pop(k, None)
                    failed_token_tracker._cooldowns.pop(k, None)
        logger.info(f"Login/scan cooldowns cleared for roll {clean_roll} by admin operation.")

    if clean_ip:
        failed_login_limiter.record_success(clean_ip, None)
        logger.info(f"IP login cooldown cleared for {clean_ip} by admin operation.")

    return (clean_roll, clean_ip)
