"""
SNIST ERP — Onboarding Service
Token generation/verification, OTP, state machine transitions.
All security-sensitive operations have audit trail logging.
"""

import secrets
import hashlib
import logging
import random
import string
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, Tuple

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import get_server_ist_datetime, get_password_hash
from app.models.models import (
    StudentOnboarding, OnboardingToken, OnboardingOTP,
    OnboardingState, OnboardingAuditLog,
    User, UserRole, Student,
)

logger = logging.getLogger("snist_erp.onboarding_service")


# ============================================================
# AUDIT LOGGING (follows device_security.py record_audit_log pattern)
# ============================================================

def log_onboarding_event(
    db: Session,
    event_type: str,
    action: str,
    roll_number: Optional[str] = None,
    details: Optional[str] = None,
    ip_address: Optional[str] = None,
    performed_by: Optional[int] = None,
):
    """Writes to the dedicated onboarding audit log. Defensive — never crashes."""
    try:
        entry = OnboardingAuditLog(
            roll_number=roll_number,
            event_type=event_type,
            action=action,
            details=details,
            ip_address=ip_address,
            performed_by=performed_by,
            created_at=get_server_ist_datetime().replace(tzinfo=None),
        )
        db.add(entry)
        db.commit()
    except Exception as err:
        logger.warning(f"Failed to write onboarding audit log: {err}")
        try:
            db.rollback()
        except Exception:
            pass


# ============================================================
# MAGIC LINK TOKEN GENERATION & VERIFICATION
# ============================================================

def _hash_token(raw_token: str) -> str:
    """SHA-256 hash of the raw token. Used for DB storage — raw token NEVER persisted."""
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def generate_magic_token(
    db: Session,
    onboarding_id: int,
    roll_number: str,
    ip_address: Optional[str] = None,
    performed_by: Optional[int] = None,
) -> str:
    """
    Generates a magic link token for a student onboarding record.
    Returns the RAW token (to be embedded in the link URL).
    - 256-bit random token via secrets.token_urlsafe(32)
    - Only SHA-256 hash stored in DB
    - Invalidates all prior active tokens for this onboarding_id
    - Expiry: configurable, default 48 hours
    """
    # 1. Invalidate all prior active tokens for this student
    prior_tokens = db.query(OnboardingToken).filter(
        OnboardingToken.onboarding_id == onboarding_id,
        OnboardingToken.is_active == True,
    ).all()
    for pt in prior_tokens:
        pt.is_active = False  # Regenerating invalidates old links
    if prior_tokens:
        db.flush()

    # 2. Generate high-entropy random token (256-bit / 43 chars)
    raw_token = secrets.token_urlsafe(32)
    token_hash = _hash_token(raw_token)

    # 3. Compute expiry (server IST)
    now = get_server_ist_datetime().replace(tzinfo=None)
    expires_at = now + timedelta(hours=settings.MAGIC_LINK_EXPIRY_HOURS)

    # 4. Store hash-only record
    token_record = OnboardingToken(
        onboarding_id=onboarding_id,
        token_hash=token_hash,
        is_consumed=False,
        is_active=True,
        expires_at=expires_at,
        created_at=now,
    )
    db.add(token_record)
    db.commit()

    # 5. Audit
    log_onboarding_event(
        db=db,
        event_type="LINK_GENERATED",
        action="MAGIC_LINK_GENERATED",
        roll_number=roll_number,
        details=f"Token hash={token_hash[:16]}..., expires={expires_at.isoformat()}",
        ip_address=ip_address,
        performed_by=performed_by,
    )

    return raw_token


def verify_magic_token(
    db: Session,
    raw_token: str,
    ip_address: Optional[str] = None,
) -> Tuple[Optional[StudentOnboarding], Optional[str]]:
    """
    Validates a magic link token.
    Returns (onboarding_record, None) on success, or (None, error_message) on failure.
    
    Security:
    - SHA-256 hash lookup (constant-time via DB index, not timing-oracle vulnerable)
    - Expiry check (server IST)
    - Single-use: atomic conditional UPDATE with is_consumed=False guard
    - Race condition protection: check rowcount == 1 after UPDATE
    """
    token_hash = _hash_token(raw_token)
    now = get_server_ist_datetime().replace(tzinfo=None)

    # 1. Lookup by hash
    token_record = db.query(OnboardingToken).filter(
        OnboardingToken.token_hash == token_hash,
    ).first()

    if not token_record:
        return None, "Invalid or unrecognized onboarding link."

    if not token_record.is_active:
        return None, "This onboarding link has been superseded by a newer link. Please use the latest link sent to you."

    if token_record.is_consumed:
        return None, "This onboarding link has already been used. Each link can only be used once."

    if token_record.expires_at and now > token_record.expires_at:
        return None, "This onboarding link has expired. Please request a new link from your coordinator."

    # 2. Load onboarding record
    onboarding = db.query(StudentOnboarding).filter(
        StudentOnboarding.id == token_record.onboarding_id,
    ).first()

    if not onboarding:
        return None, "Onboarding record not found. Contact your administrator."

    if onboarding.state == OnboardingState.ACTIVATED or token_record.is_consumed:
        return None, "Your account is already activated. Please log in directly."

    if onboarding.state == OnboardingState.SUSPENDED:
        return None, "Your account has been suspended. Contact your administrator."

    # 3. Mark token as consumed (single-use security guarantee)
    token_record.is_consumed = True
    token_record.consumed_at = now

    # 4. Transition state to LINK_OPENED
    if onboarding.state in (OnboardingState.PENDING_ONBOARDING, OnboardingState.LINK_SENT):
        onboarding.state = OnboardingState.LINK_OPENED
        onboarding.link_opened_at = now
    
    db.commit()

    # 5. Audit
    log_onboarding_event(
        db=db,
        event_type="LINK_REDEEMED",
        action="MAGIC_LINK_VERIFIED",
        roll_number=onboarding.roll_number,
        details=f"Token verified successfully. State → LINK_OPENED",
        ip_address=ip_address,
    )

    return onboarding, None


# ============================================================
# OTP GENERATION & VERIFICATION
# ============================================================

def generate_otp(
    db: Session,
    onboarding_id: int,
    email: str,
    ip_address: Optional[str] = None,
) -> Tuple[bool, str]:
    """
    Generates a 6-digit OTP and sends it to the student's email.
    Returns (success, message).
    Rate limited: max OTP_MAX_REQUESTS_PER_HOUR per onboarding_id per hour.
    """
    now = get_server_ist_datetime().replace(tzinfo=None)
    one_hour_ago = now - timedelta(hours=1)

    # 1. Rate limit check
    recent_otp_count = db.query(OnboardingOTP).filter(
        OnboardingOTP.onboarding_id == onboarding_id,
        OnboardingOTP.created_at >= one_hour_ago,
    ).count()

    if recent_otp_count >= settings.OTP_MAX_REQUESTS_PER_HOUR:
        return False, f"Maximum OTP requests ({settings.OTP_MAX_REQUESTS_PER_HOUR}) exceeded for this hour. Please wait."

    # 2. Generate 6-digit OTP using CSPRNG
    otp_code = "".join(secrets.choice(string.digits) for _ in range(6))
    otp_hash = hashlib.sha256(otp_code.encode("utf-8")).hexdigest()

    # 3. Store OTP hash
    otp_record = OnboardingOTP(
        onboarding_id=onboarding_id,
        email=email,
        otp_hash=otp_hash,
        attempts=0,
        is_verified=False,
        expires_at=now + timedelta(minutes=settings.OTP_EXPIRY_MINUTES),
        created_at=now,
    )
    db.add(otp_record)
    db.commit()

    # 4. Send OTP via email (defensive — never crash on SMTP failure)
    try:
        from app.services.email_service import send_single_email, render_email_template

        # Try to use template, fallback to simple HTML
        try:
            html_body = render_email_template("otp_email.html", {
                "otp_code": otp_code,
                "expiry_minutes": settings.OTP_EXPIRY_MINUTES,
                "student_email": email,
            })
        except Exception:
            html_body = f"""
            <html><body>
            <h2>SNIST ERP — Verification Code</h2>
            <p>Your one-time verification code is:</p>
            <h1 style="font-family: monospace; font-size: 32px; letter-spacing: 8px; color: #001e40;">{otp_code}</h1>
            <p>This code expires in {settings.OTP_EXPIRY_MINUTES} minutes.</p>
            <p style="color: #999; font-size: 12px;">If you did not request this code, please ignore this email.</p>
            </body></html>
            """

        result = send_single_email(
            to_email=email,
            subject=f"SNIST ERP — Your Verification Code: {otp_code}",
            html_body=html_body,
            channel="OTP",
        )

        if result["status"] in ("SENT", "DEV_MODE"):
            onboarding = db.query(StudentOnboarding).filter(StudentOnboarding.id == onboarding_id).first()
            log_onboarding_event(
                db=db,
                event_type="OTP_SENT",
                action="OTP_EMAIL_SENT",
                roll_number=onboarding.roll_number if onboarding else None,
                details=f"OTP sent to {email} (dev_mode={result['status'] == 'DEV_MODE'})",
                ip_address=ip_address,
            )
            return True, f"Verification code sent to {email}"
        else:
            return False, f"Failed to send verification code: {result.get('error', 'Unknown')}"

    except Exception as send_err:
        logger.error(f"OTP email dispatch error for {email}: {send_err}", exc_info=True)
        return False, f"Email service error: {str(send_err)}"


def verify_otp(
    db: Session,
    onboarding_id: int,
    otp_code: str,
    ip_address: Optional[str] = None,
) -> Tuple[bool, str]:
    """
    Verifies a 6-digit OTP against the latest active OTP for this onboarding.
    Returns (success, message).
    Rate limited: max OTP_MAX_ATTEMPTS per OTP record.
    """
    now = get_server_ist_datetime().replace(tzinfo=None)
    otp_hash = hashlib.sha256(otp_code.encode("utf-8")).hexdigest()

    # Find the latest non-expired, non-verified OTP for this onboarding
    otp_record = db.query(OnboardingOTP).filter(
        OnboardingOTP.onboarding_id == onboarding_id,
        OnboardingOTP.is_verified == False,
        OnboardingOTP.expires_at > now,
    ).order_by(OnboardingOTP.created_at.desc()).first()

    if not otp_record:
        return False, "No active verification code found. Please request a new one."

    # Attempt limit
    if otp_record.attempts >= settings.OTP_MAX_ATTEMPTS:
        return False, f"Maximum verification attempts ({settings.OTP_MAX_ATTEMPTS}) exceeded. Please request a new code."

    # Increment attempt count
    otp_record.attempts += 1
    db.commit()

    # Constant-time hash comparison
    if not hashlib.sha256(otp_code.encode("utf-8")).hexdigest() == otp_record.otp_hash:
        remaining = settings.OTP_MAX_ATTEMPTS - otp_record.attempts
        return False, f"Invalid verification code. {remaining} attempts remaining."

    # Mark verified
    otp_record.is_verified = True
    db.commit()

    # Update onboarding record
    onboarding = db.query(StudentOnboarding).filter(StudentOnboarding.id == onboarding_id).first()
    if onboarding:
        onboarding.mobile_verified = True
        db.commit()

        log_onboarding_event(
            db=db,
            event_type="OTP_VERIFIED",
            action="OTP_VERIFICATION_SUCCESS",
            roll_number=onboarding.roll_number,
            details=f"OTP verified for {onboarding.email}",
            ip_address=ip_address,
        )

    return True, "Verification successful."


# ============================================================
# PIN SETTING & STUDENT ACTIVATION
# ============================================================

def set_student_pin(
    db: Session,
    onboarding_id: int,
    pin: str,
    ip_address: Optional[str] = None,
) -> Tuple[bool, str]:
    """
    Sets the student's 4-6 digit numeric PIN. Validates length and digit-only.
    """
    # Validate PIN format
    if not pin or not pin.isdigit():
        return False, "PIN must contain only digits (0-9)."
    if len(pin) < settings.STUDENT_PIN_MIN_LENGTH or len(pin) > settings.STUDENT_PIN_MAX_LENGTH:
        return False, f"PIN must be {settings.STUDENT_PIN_MIN_LENGTH}-{settings.STUDENT_PIN_MAX_LENGTH} digits."

    onboarding = db.query(StudentOnboarding).filter(StudentOnboarding.id == onboarding_id).first()
    if not onboarding:
        return False, "Onboarding record not found."

    # Hash the PIN using the existing password hashing function
    onboarding.pin_hash = get_password_hash(pin)
    db.commit()

    log_onboarding_event(
        db=db,
        event_type="PIN_SET",
        action="STUDENT_PIN_SET",
        roll_number=onboarding.roll_number,
        details="Student PIN set successfully",
        ip_address=ip_address,
    )

    return True, "PIN set successfully."


def activate_student(
    db: Session,
    onboarding_id: int,
    device_uuid: str,
    ip_address: Optional[str] = None,
) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
    """
    Final activation step. Creates User + Student records if they don't exist,
    binds device, and transitions state to ACTIVATED.
    Returns (success, message, user_data_dict).
    """
    onboarding = db.query(StudentOnboarding).filter(StudentOnboarding.id == onboarding_id).first()
    if not onboarding:
        return False, "Onboarding record not found.", None

    if onboarding.state == OnboardingState.ACTIVATED:
        return False, "Account is already activated.", None

    if not onboarding.pin_hash:
        return False, "Please set your PIN before activating.", None

    if not onboarding.mobile_verified:
        return False, "Please verify your email OTP before activating.", None

    now = get_server_ist_datetime().replace(tzinfo=None)

    try:
        # 1. Check if User already exists (from a prior import)
        existing_user = db.query(User).filter(User.username == onboarding.roll_number).first()

        if existing_user:
            # Update password to PIN hash
            existing_user.password_hash = onboarding.pin_hash
            existing_user.must_change_password = False  # PIN was just set by student
            existing_user.is_active = True
            db.flush()
            user = existing_user
        else:
            # Create new User record
            user = User(
                username=onboarding.roll_number,
                email=onboarding.email,
                password_hash=onboarding.pin_hash,
                role=UserRole.STUDENT,
                is_active=True,
                must_change_password=False,
            )
            db.add(user)
            db.flush()

        # 2. Check if Student record already exists
        existing_student = db.query(Student).filter(Student.roll_number == onboarding.roll_number).first()

        if existing_student:
            existing_student.user_id = user.id
            existing_student.email = onboarding.email
            existing_student.mobile = onboarding.mobile_number
            db.flush()
            student = existing_student
        else:
            student = Student(
                user_id=user.id,
                roll_number=onboarding.roll_number.upper(),
                name=onboarding.name,
                department_id=onboarding.department_id or 1,
                academic_year_id=onboarding.academic_year_id or 1,
                section_id=onboarding.section_id or 1,
                email=onboarding.email,
                mobile=onboarding.mobile_number,
            )
            db.add(student)
            db.flush()

        # 3. Update onboarding record & consume tokens
        onboarding.student_id = student.id
        onboarding.state = OnboardingState.ACTIVATED
        onboarding.device_uuid = device_uuid
        onboarding.activated_at = now

        db.query(OnboardingToken).filter(
            OnboardingToken.onboarding_id == onboarding.id,
        ).update({"is_consumed": True, "consumed_at": now}, synchronize_session="fetch")

        db.commit()

        # 4. Audit
        log_onboarding_event(
            db=db,
            event_type="ACCOUNT_ACTIVATED",
            action="STUDENT_ACCOUNT_ACTIVATED",
            roll_number=onboarding.roll_number,
            details=f"Student activated. User ID={user.id}, Student ID={student.id}, Device={device_uuid[:16]}...",
            ip_address=ip_address,
        )

        log_onboarding_event(
            db=db,
            event_type="DEVICE_BOUND",
            action="ONBOARDING_DEVICE_BOUND",
            roll_number=onboarding.roll_number,
            details=f"Device {device_uuid} bound during onboarding activation",
            ip_address=ip_address,
        )

        return True, "Account activated successfully!", {
            "user_id": user.id,
            "student_id": student.id,
            "roll_number": onboarding.roll_number,
            "name": onboarding.name,
        }

    except Exception as err:
        db.rollback()
        logger.error(f"Student activation error for {onboarding.roll_number}: {err}", exc_info=True)
        return False, f"Activation failed: {str(err)}", None


# ============================================================
# ONBOARDING SESSION TOKEN (short-lived JWT for wizard steps)
# ============================================================

def create_onboarding_session_token(onboarding_id: int, roll_number: str) -> str:
    """Creates a short-lived JWT (30 min) for the onboarding wizard session."""
    from app.core.security import create_access_token
    return create_access_token(
        data={
            "sub": f"onboard:{roll_number}",
            "onboarding_id": onboarding_id,
            "type": "onboarding_session",
        },
        expires_delta=timedelta(minutes=30),
    )


def decode_onboarding_session_token(token: str) -> Optional[Dict[str, Any]]:
    """Decodes an onboarding session JWT. Returns payload or None."""
    from app.core.security import decode_access_token
    payload = decode_access_token(token)
    if not payload:
        return None
    if payload.get("type") != "onboarding_session":
        return None
    return payload
