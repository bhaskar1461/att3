from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta
import random
import secrets
import string
import hashlib

from app.core.database import get_db
from app.api.auth import get_current_user
from app.models.models import (
    User, UserRole, Student, DeviceRegistration, DeviceAccountBinding, 
    BindingStatus, DeviceResetOTP, AuditLog, SecurityEventType, StudentOnboarding,
    DeviceBinding, RevokedReason
)
from app.core.security import verify_password, create_access_token, create_refresh_token
from app.core.device_security import (
    register_or_get_device,
    revoke_device_by_admin,
    reset_student_device_enrollment,
    record_audit_log,
    is_demo_account
)
from app.services.email_service import (
    send_single_email,
    render_email_template,
    resolve_otp_recipient,
    send_otp_with_retry_and_logging,
    OTPRecipientUnresolved
)
from app.core.config import settings

router = APIRouter(prefix="/devices", tags=["Device Binding Security"])

class DeviceRegisterRequest(BaseModel):
    device_public_id: str
    device_secret: str

class DeviceRevokeRequest(BaseModel):
    device_public_id: str

class DeviceResetEnrollmentRequest(BaseModel):
    roll_number: Optional[str] = None
    student_id: Optional[int] = None
    sap_id: Optional[str] = None
    reason: Optional[str] = "ADMIN_RESET"
    notes: Optional[str] = None

class DeviceResetRequest(BaseModel):
    roll_number: str
    password: str

class DeviceVerifyResetRequest(BaseModel):
    roll_number: str
    otp: str
    new_device_public_id: Optional[str] = None
    new_device_secret: Optional[str] = None

class DeviceBulkResetRequest(BaseModel):
    roll_numbers: List[str]
    confirmation: str

import logging

logger = logging.getLogger("snist_erp.devices_api")

def mask_email(email: str) -> str:
    """FIX-5: Masks username preserving real domain (e.g. 2••••••1@cse.sreenidhi.edu.in)."""
    if not email or "@" not in email:
        return "***@***"
    user_part, domain = email.split("@", 1)
    if len(user_part) <= 2:
        masked_user = user_part[0] + "•"
    else:
        masked_user = user_part[0] + "••••••" + user_part[-1]
    return f"{masked_user}@{domain}"


@router.post("/register")
def register_device_endpoint(
    req: DeviceRegisterRequest,
    request: Request,
    db: Session = Depends(get_db)
):
    try:
        ip_address = request.client.host if request.client else None
        device = register_or_get_device(
            db=db,
            device_public_id=req.device_public_id,
            device_secret=req.device_secret,
            ip_address=ip_address
        )
        return {
            "status": "SUCCESS",
            "device_public_id": device.device_public_id,
            "is_active": device.is_active,
            "first_registered_at": device.first_registered_at.isoformat()
        }
    except HTTPException:
        raise
    except Exception as err:
        logger.error(f"Error in register_device_endpoint: {err}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred while processing device registration."
        )

@router.get("/current")
def get_current_device_binding(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        device_public_id = request.headers.get("x-device-public-id", "").strip()
        if not device_public_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Header X-Device-Public-Id is required"
            )

        device = db.query(DeviceRegistration).filter(
            DeviceRegistration.device_public_id == device_public_id
        ).first()

        if not device:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Device registration not found"
            )

        now = datetime.utcnow()
        active_binding = db.query(DeviceAccountBinding).filter(
            DeviceAccountBinding.device_id == device.id,
            DeviceAccountBinding.status == BindingStatus.ACTIVE,
            DeviceAccountBinding.expires_at > now
        ).first()

        if not active_binding:
            return {
                "device_public_id": device.device_public_id,
                "is_active": device.is_active,
                "has_active_binding": False,
                "active_binding": None
            }

        remaining_seconds = int((active_binding.expires_at - now).total_seconds())

        return {
            "device_public_id": device.device_public_id,
            "is_active": device.is_active,
            "has_active_binding": True,
            "active_binding": {
                "roll_number": active_binding.roll_number,
                "bound_at": active_binding.bound_at.isoformat(),
                "expires_at": active_binding.expires_at.isoformat(),
                "attempt_count": active_binding.attempt_count,
                "remaining_seconds": max(0, remaining_seconds)
            }
        }
    except HTTPException:
        raise
    except Exception as err:
        logger.error(f"Error in get_current_device_binding: {err}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred while fetching device status."
        )

@router.post("/revoke")
def revoke_device_endpoint(
    req: DeviceRevokeRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Super Admin permission required to revoke device"
        )

    try:
        ip_address = request.client.host if request.client else None
        revoke_device_by_admin(
            db=db,
            device_public_id=req.device_public_id,
            admin_user_id=current_user.id,
            ip_address=ip_address
        )

        return {
            "status": "SUCCESS",
            "message": f"Device {req.device_public_id} revoked successfully"
        }
    except HTTPException:
        raise
    except Exception as err:
        logger.error(f"Error in revoke_device_endpoint: {err}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred while revoking device."
        )

@router.post("/reset-student-enrollment")
def reset_student_enrollment_endpoint(
    req: DeviceResetEnrollmentRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Admin/Teacher endpoint to reset a student's bi-directional device enrollment.
    Used when a student replaces their phone and needs to re-enroll on a new device.
    """
    if current_user.role not in (UserRole.SUPER_ADMIN, UserRole.TEACHER):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin or Teacher permission required to reset student device enrollment."
        )

    try:
        ip_address = request.client.host if request.client else None
        result = reset_student_device_enrollment(
            db=db,
            roll_number=req.roll_number,
            admin_user_id=current_user.id,
            ip_address=ip_address
        )
        return result
    except HTTPException:
        raise
    except Exception as err:
        logger.error(f"Error in reset_student_enrollment: {err}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred while resetting student device enrollment."
        )

@router.post("/request-reset")
def request_device_reset(
    req: DeviceResetRequest,
    request: Request,
    db: Session = Depends(get_db)
):
    """
    Self-service endpoint for students to request an email OTP to reset their bound device.
    Bypasses device-lock gate since a student with a lost/replaced phone has no access to their old device.
    """
    clean_roll = req.roll_number.strip().upper()
    ip_address = request.client.host if request.client else None

    # 1. Look up student and user account
    student = db.query(Student).filter(Student.roll_number == clean_roll).first()
    user = db.query(User).filter(
        User.role == UserRole.STUDENT,
        (User.username == clean_roll) | (User.username.ilike(clean_roll))
    ).first()

    if not student or not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student account not found. Please verify your roll number."
        )

    # 2. Verify student password
    is_valid_pw = verify_password(req.password.strip(), user.password_hash)
    if not is_valid_pw and is_demo_account(clean_roll):
        if req.password.strip().lower() == "demostudent@2026":
            is_valid_pw = True
    if not is_valid_pw:
        # Check onboarding PIN fallback
        try:
            onboarding_rec = db.query(StudentOnboarding).filter(
                StudentOnboarding.roll_number == clean_roll
            ).first()
            if onboarding_rec and onboarding_rec.pin_hash:
                if verify_password(req.password.strip(), onboarding_rec.pin_hash):
                    is_valid_pw = True
        except Exception:
            pass

    if not is_valid_pw:
        record_audit_log(
            db=db,
            user_id=user.id,
            roll_number=clean_roll,
            event_type="AUTH_FAILURE",
            action="DEVICE_RESET_BAD_PASSWORD",
            details=f"Failed password attempt on device reset request for {clean_roll}",
            ip_address=ip_address
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect password. Please verify your credentials."
        )

    # 3. Check rate limit: max 3 requests per hour
    one_hour_ago = datetime.utcnow() - timedelta(hours=1)
    recent_requests = db.query(DeviceResetOTP).filter(
        DeviceResetOTP.roll_number == clean_roll,
        DeviceResetOTP.created_at >= one_hour_ago
    ).count()
    if recent_requests >= 3:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many verification requests (max 3 per hour). Please wait before requesting another code."
        )

    # 4. Check semester cap: max 5 resets per semester (~180 days)
    semester_start = datetime.utcnow() - timedelta(days=180)
    self_reset_count = db.query(AuditLog).filter(
        AuditLog.roll_number == clean_roll,
        AuditLog.event_type == "DEVICE_SELF_RESET",
        AuditLog.created_at >= semester_start
    ).count()
    if self_reset_count >= 5:
        record_audit_log(
            db=db,
            user_id=user.id,
            roll_number=clean_roll,
            event_type="DEVICE_SELF_RESET_CAP_EXCEEDED",
            action="DEVICE_SELF_RESET_CAP_EXCEEDED",
            details=f"Student {clean_roll} reached semester limit of 5 self-resets. Current count: {self_reset_count}.",
            ip_address=ip_address
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You have reached the maximum limit of 5 self-service device resets for this semester. Please contact your faculty mentor or class administrator to reset your device binding."
        )

    # 5. Invalidate stale OTPs older than 10 minutes for this student
    ten_mins_ago = datetime.utcnow() - timedelta(minutes=10)
    db.query(DeviceResetOTP).filter(
        DeviceResetOTP.roll_number == clean_roll,
        DeviceResetOTP.is_consumed == False,
        DeviceResetOTP.created_at < ten_mins_ago
    ).update({"is_consumed": True})
    db.commit()

    # 6. Determine target email via canonical resolution (FIX-5)
    try:
        target_email = resolve_otp_recipient(student)
    except OTPRecipientUnresolved:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error_code": "otp_delivery_failed", "message": "No valid student recipient email found."}
        )

    # 7. Generate 6-digit OTP code & hash
    if is_demo_account(clean_roll):
        otp_code = "123456"
    else:
        otp_code = "".join(secrets.choice(string.digits) for _ in range(6))
    otp_hash = hashlib.sha256(otp_code.encode("utf-8")).hexdigest()
    expires_at = datetime.utcnow() + timedelta(minutes=10)

    reset_otp = DeviceResetOTP(
        roll_number=clean_roll,
        email=target_email,
        otp_hash=otp_hash,
        attempts=0,
        is_consumed=False,
        expires_at=expires_at,
        created_at=datetime.utcnow()
    )
    db.add(reset_otp)
    db.commit()

    # 8. Send OTP via email using resilient retry dispatch (FIX-5)
    try:
        html_body = render_email_template("otp_email.html", {
            "otp_code": otp_code,
            "expiry_minutes": 10,
            "student_email": target_email,
        })
    except Exception:
        html_body = f"""
        <html><body>
        <h2>SNIST ERP — Device Reset Verification Code</h2>
        <p>Use the code below to unbind your previous phone and authorize your new device:</p>
        <h1 style="font-family: monospace; font-size: 32px; letter-spacing: 8px; color: #15347e;">{otp_code}</h1>
        <p>This verification code expires in 10 minutes and can only be used once.</p>
        <p style="color: #999; font-size: 12px;">If you did not request this device reset, change your password immediately.</p>
        </body></html>
        """

    send_otp_with_retry_and_logging(
        db=db,
        student=student,
        otp_code=otp_code,
        subject=f"SNIST ERP — Device Reset Code: {otp_code}",
        html_body=html_body,
        channel="EMAIL",
        enforce_cooldown=True
    )


    record_audit_log(
        db=db,
        user_id=user.id,
        roll_number=clean_roll,
        event_type="OTP_SENT",
        action="DEVICE_RESET_OTP_SENT",
        details=f"Device reset OTP sent to {mask_email(target_email)}",
        ip_address=ip_address
    )

    msg = (
        "Demo Verification Code is 123456. Enter 123456 on the next screen."
        if is_demo_account(clean_roll)
        else "A 6-digit verification code has been sent to your registered college email."
    )
    return {
        "status": "SUCCESS",
        "message": msg,
        "masked_email": mask_email(target_email),
        "expires_in_minutes": 10
    }

@router.post("/verify-reset")
def verify_device_reset(
    req: DeviceVerifyResetRequest,
    request: Request,
    db: Session = Depends(get_db)
):
    """
    Verifies email OTP and immediately re-binds the student to the calling device.
    """
    clean_roll = req.roll_number.strip().upper()
    ip_address = request.client.host if request.client else None

    student = db.query(Student).filter(Student.roll_number == clean_roll).first()
    user = db.query(User).filter(
        User.role == UserRole.STUDENT,
        (User.username == clean_roll) | (User.username.ilike(clean_roll))
    ).first()

    if not student or not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student account not found."
        )

    # 1. Fetch active unconsumed, unexpired OTP records for this student
    now = datetime.utcnow()
    active_otps = db.query(DeviceResetOTP).filter(
        DeviceResetOTP.roll_number == clean_roll,
        DeviceResetOTP.is_consumed == False,
        DeviceResetOTP.expires_at > now,
        DeviceResetOTP.attempts < 5
    ).order_by(DeviceResetOTP.id.desc()).all()

    if not active_otps:
        # Check if there is a recent expired OTP
        expired_otp = db.query(DeviceResetOTP).filter(
            DeviceResetOTP.roll_number == clean_roll,
            DeviceResetOTP.expires_at <= now
        ).order_by(DeviceResetOTP.id.desc()).first()
        if expired_otp and not expired_otp.is_consumed:
            expired_otp.is_consumed = True
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Verification code has expired. Please request a new code."
            )

        # Check if max attempts exhausted
        exhausted_otp = db.query(DeviceResetOTP).filter(
            DeviceResetOTP.roll_number == clean_roll,
            DeviceResetOTP.attempts >= 5
        ).order_by(DeviceResetOTP.id.desc()).first()
        if exhausted_otp:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Too many failed attempts. Please request a new code."
            )

        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active reset request found. Please request a new verification code."
        )

    # 2. Check OTP hash against active unconsumed OTPs
    submitted_hash = hashlib.sha256(req.otp.strip().encode("utf-8")).hexdigest()
    is_demo = is_demo_account(clean_roll)
    matched_otp = None
    for rec in active_otps:
        if submitted_hash == rec.otp_hash or (is_demo and req.otp.strip() == "123456"):
            matched_otp = rec
            break

    if not matched_otp:
        latest_otp = active_otps[0]
        latest_otp.attempts += 1
        db.commit()
        remaining = max(0, 5 - latest_otp.attempts)
        if remaining == 0:
            latest_otp.is_consumed = True
            db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid verification code. {remaining} attempt(s) remaining."
        )

    # 3. Mark all active OTPs for this student as consumed (prevents any replay)
    for rec in active_otps:
        rec.is_consumed = True
    db.commit()

    # 4. Determine device registration & binding action
    dummy_placeholders = {"DEV-RESET-V2", "DEV-RETIRED-PHASE5", "LEGACY-RETIRED", "V2_RESET_CREDENTIAL", ""}
    raw_pub_id = (req.new_device_public_id or "").strip()
    raw_secret = (req.new_device_secret or "").strip()
    is_placeholder = (not raw_pub_id) or (raw_pub_id in dummy_placeholders) or raw_pub_id.startswith("DEV-RESET")

    old_device_id = student.registered_device_id
    bound_device_pub_id = None
    bound_device_id = None

    if not is_placeholder and raw_secret and raw_secret not in dummy_placeholders:
        new_device = register_or_get_device(
            db=db,
            device_public_id=raw_pub_id,
            device_secret=raw_secret,
            ip_address=ip_address
        )
        student.registered_device_id = new_device.id
        bound_device_pub_id = new_device.device_public_id
        bound_device_id = new_device.id
    else:
        # Caller passed a placeholder or empty credentials:
        # Clear registered_device_id so student auto-enrolls on their very next login!
        student.registered_device_id = None
        # Also register the incoming connection device signature as fallback reference
        client_ua = request.headers.get("user-agent", "generic_student_browser")
        client_ip = ip_address or "127.0.0.1"
        conn_sig = hashlib.sha256(f"{client_ip}_{client_ua}".encode()).hexdigest()[:16]
        actual_conn_pub_id = f"DEV-CONN-{conn_sig.upper()}"
        actual_conn_secret = hashlib.sha256(f"{actual_conn_pub_id}_SECRET_SALT_2026".encode()).hexdigest()
        new_device = register_or_get_device(
            db=db,
            device_public_id=actual_conn_pub_id,
            device_secret=actual_conn_secret,
            ip_address=ip_address
        )
        bound_device_pub_id = new_device.device_public_id
        bound_device_id = new_device.id

    # 5. Expire previous session bindings for this student
    active_bindings = db.query(DeviceAccountBinding).filter(
        DeviceAccountBinding.roll_number == clean_roll,
        DeviceAccountBinding.status == BindingStatus.ACTIVE
    ).all()
    for b in active_bindings:
        b.status = BindingStatus.EXPIRED

    # 6. Revoke modern active DeviceBinding rows upon self-service reset
    active_v2_bindings = db.query(DeviceBinding).filter(
        DeviceBinding.student_id == student.id,
        DeviceBinding.revoked_at.is_(None)
    ).all()
    for b in active_v2_bindings:
        b.revoked_at = datetime.utcnow()
        b.revocation_reason = RevokedReason.STUDENT_REQUEST.value if hasattr(RevokedReason, 'STUDENT_REQUEST') else "STUDENT_REQUEST"
        logger.info(f"[DEVICE RESET] Revoked active Binding V2 key {b.key_id[:8]}... for student {clean_roll}")

    db.commit()

    # 7. Log DEVICE_SELF_RESET audit event
    record_audit_log(
        db=db,
        user_id=user.id,
        roll_number=clean_roll,
        event_type="DEVICE_SELF_RESET",
        action="DEVICE_SELF_RESET",
        details=f"Student {clean_roll} completed self-service device reset via email OTP. Previous device: ID {old_device_id} -> Cleared/rebound for authorized access.",
        device_id=bound_device_id,
        ip_address=ip_address
    )

    # 8. Generate session tokens so caller can log in directly if desired
    access_token = create_access_token(
        data={"sub": user.username, "role": user.role.value if hasattr(user.role, 'value') else str(user.role), "user_id": user.id}
    )
    refresh_token = create_refresh_token(
        data={"sub": user.username, "role": user.role.value if hasattr(user.role, 'value') else str(user.role), "user_id": user.id}
    )

    full_name = student.name or user.username
    return {
        "status": "SUCCESS",
        "message": "Device successfully re-bound to your account. You can now log in.",
        "roll_number": clean_roll,
        "device_public_id": bound_device_pub_id or "DEV-AUTO-ENROLLED",
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "username": user.username,
            "role": user.role.value if hasattr(user.role, "value") else str(user.role),
            "full_name": full_name
        }
    }

@router.post("/bulk-reset")
def bulk_reset_devices(
    req: DeviceBulkResetRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Super Admin endpoint to perform bulk device unbinding with typed confirmation.
    """
    if current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Super Admin permission required for bulk device reset."
        )

    expected_confirmation = f"RESET {len(req.roll_numbers)} DEVICES"
    if req.confirmation.strip() != expected_confirmation:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Confirmation mismatch. Please type exactly: '{expected_confirmation}'"
        )

    ip_address = request.client.host if request.client else None
    reset_results = []
    for raw_roll in req.roll_numbers:
        clean_roll = raw_roll.strip().upper()
        try:
            res = reset_student_device_enrollment(
                db=db,
                roll_number=clean_roll,
                admin_user_id=current_user.id,
                ip_address=ip_address
            )
            reset_results.append(clean_roll)
        except Exception as e:
            logger.warning(f"Bulk reset error on {clean_roll}: {e}")

    record_audit_log(
        db=db,
        user_id=current_user.id,
        event_type="DEVICE_ADMIN_RESET",
        action="DEVICE_BULK_RESET",
        details=f"Admin {current_user.username} (ID {current_user.id}) performed bulk device reset on {len(reset_results)} students: {', '.join(reset_results[:10])}...",
        ip_address=ip_address
    )

    return {
        "status": "SUCCESS",
        "reset_count": len(reset_results),
        "reset_students": reset_results,
        "message": f"Successfully reset device bindings for {len(reset_results)} students."
    }

@router.post("/reset-student-enrollment")
def reset_student_enrollment_endpoint(
    req: DeviceResetEnrollmentRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Admin/Teacher endpoint to reset a student's device enrollment,
    supporting student_id, roll_number, or canonical sap_id.
    """
    if current_user.role not in [UserRole.SUPER_ADMIN, UserRole.TEACHER]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin or Teacher permission required."
        )

    clean_roll = (req.roll_number or req.sap_id or "").strip().upper()
    student = None
    if req.student_id:
        student = db.query(Student).filter(Student.id == req.student_id).first()
    elif clean_roll:
        student = db.query(Student).filter(Student.roll_number == clean_roll).first()

    if not student:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Student '{clean_roll or req.student_id}' not found."
        )

    ip_address = request.client.host if request.client else None
    res = reset_student_device_enrollment(
        db=db,
        roll_number=student.roll_number,
        admin_user_id=current_user.id,
        ip_address=ip_address
    )
    return res

@router.get("/student-device-info")
def get_student_device_info(
    roll_number: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Admin/Teacher endpoint to inspect a student's bound device status.
    """
    if current_user.role not in (UserRole.SUPER_ADMIN, UserRole.TEACHER):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin or Teacher permission required."
        )

    clean_roll = roll_number.strip().upper()
    student = db.query(Student).filter(Student.roll_number == clean_roll).first()
    if not student:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Student {clean_roll} not found."
        )

    device_info = None
    has_registered_device = False

    if getattr(settings, 'BINDING_V2', False):
        from app.models.models import DeviceBinding
        active_binding = db.query(DeviceBinding).filter(
            DeviceBinding.student_id == student.id,
            DeviceBinding.revoked_at.is_(None)
        ).first()
        if active_binding:
            has_registered_device = True
            device_info = {
                "device_public_id": f"KEY-{active_binding.key_id[:12]}",
                "key_id": active_binding.key_id,
                "is_active": True,
                "first_registered_at": active_binding.enrolled_at.isoformat() if active_binding.enrolled_at else None,
                "last_seen_at": active_binding.enrolled_at.isoformat() if active_binding.enrolled_at else None,
                "enrolled_via": active_binding.enrolled_via
            }
    elif student.registered_device_id:
        device = db.query(DeviceRegistration).filter(DeviceRegistration.id == student.registered_device_id).first()
        if device:
            has_registered_device = True
            device_info = {
                "device_public_id": device.device_public_id,
                "is_active": device.is_active,
                "first_registered_at": device.first_registered_at.isoformat() if device.first_registered_at else None,
                "last_seen_at": device.last_seen_at.isoformat() if device.last_seen_at else None
            }

    # Query self-reset count for semester
    semester_start = datetime.utcnow() - timedelta(days=180)
    self_reset_count = db.query(AuditLog).filter(
        AuditLog.roll_number == clean_roll,
        AuditLog.event_type == "DEVICE_SELF_RESET",
        AuditLog.created_at >= semester_start
    ).count()

    return {
        "roll_number": student.roll_number,
        "name": student.name,
        "email": student.email,
        "has_registered_device": has_registered_device,
        "registered_device": device_info,
        "self_resets_this_semester": self_reset_count,
        "max_self_resets": 5
    }

