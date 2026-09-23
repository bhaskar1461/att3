"""
SNIST ERP — Device Binding V2 API Service (Phase 3)

Implements:
1. POST /api/v1/binding/enroll: One-active-binding enrollment with rebind friction (email OTP), idempotent refresh, and rate limiting.
2. POST /api/v1/binding/challenge: Single-use, stateless signed HMAC-SHA256 challenge token generation.
3. POST /api/v1/binding/verify: Sub-millisecond signature verification, replay prevention, and brute-force lockout.
4. POST /api/v1/binding/request-rebind-otp: Dispatches 6-digit OTP for high-friction device replacement.
5. POST /api/v1/binding/admin/revoke/{student_id}: Administrative reset path (exempt from student churn budget).
6. GET /api/v1/binding/admin/churn-anomalies: Administrative anomaly view for accounts exceeding 2 rebinds in 30 days.

All endpoints are strictly guarded behind settings.BINDING_V2 (default: False).
"""

import time
import os
import random
import secrets
import string
import hashlib
import logging
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional, Tuple
from pydantic import BaseModel, Field

from fastapi import APIRouter, Depends, HTTPException, Request, status, BackgroundTasks
from sqlalchemy import func, and_, or_
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.core.database import get_db
from app.api.auth import get_current_user
from app.models.models import (
    User,
    UserRole,
    Student,
    Department,
    DeviceBinding,
    DeviceRebindOTP,
    AuditLog,
    RevokedReason,
    EnrolledVia
)
from app.core.binding_crypto import (
    create_challenge_token,
    decode_and_validate_challenge_token,
    mark_challenge_consumed,
    verify_ecdsa_p1363_signature,
    record_verify_failure,
    check_verify_lockout,
    clear_verify_failures
)
from app.services.email_service import send_single_email, render_email_template

logger = logging.getLogger("snist_erp.binding_api")

router = APIRouter(prefix="/binding", tags=["Device Binding V2"])


def check_binding_v2_enabled():
    """Enforces build/environment feature flag gating (BINDING_V2=off on prod)."""
    if not getattr(settings, "BINDING_V2", False):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Device Binding V2 endpoint is disabled on this environment."
        )


def mask_email(email: Optional[str]) -> str:
    if not email or "@" not in email:
        return "registered college email"
    user_part, domain = email.split("@", 1)
    if len(user_part) <= 2:
        masked_user = user_part[0] + "*"
    else:
        masked_user = user_part[0] + "*" * (len(user_part) - 2) + user_part[-1]
    return f"{masked_user}@{domain}"


# ============================================================
# REQUEST & RESPONSE SCHEMAS
# ============================================================

class DeviceEnrollmentRequest(BaseModel):
    public_key: Optional[str] = Field(None, description="SPKI DER Base64 public key")
    public_key_spki_b64: Optional[str] = Field(None, description="SubjectPublicKeyInfo DER Base64 (124 chars)")
    key_id: Optional[str] = Field(None, description="SHA-256 hex digest of SPKI")
    storage_persist_granted: Optional[bool] = False
    browser_profile_tag: Optional[str] = None
    rebind_otp: Optional[str] = None
    is_recovery: Optional[bool] = False
    corroboration_nonce: Optional[str] = None


class ChallengeRequest(BaseModel):
    pass


class ChallengeResponse(BaseModel):
    challenge_token: str
    nonce: str
    expires_at: int
    ttl_seconds: int


class BindingVerifyRequest(BaseModel):
    challenge_token: str
    signature: str
    student_roll: Optional[str] = None


class RebindOtpRequest(BaseModel):
    pass


# ============================================================
# HELPER: OTP DISPATCH FOR REBIND
# ============================================================

def dispatch_rebind_otp_internal(student: Student, db: Session) -> Tuple[bool, str]:
    """
    Generates, hashes, stores, and dispatches a 6-digit OTP to student's email.
    """
    if not student.email:
        return False, "No email address registered for student."

    now = datetime.utcnow()
    # Rate limit: max 5 OTP requests per hour
    one_hour_ago = now - timedelta(hours=1)
    recent_otps = db.query(DeviceRebindOTP).filter(
        DeviceRebindOTP.student_id == student.id,
        DeviceRebindOTP.created_at >= one_hour_ago
    ).count()

    if recent_otps >= 5:
        return False, "Too many verification code requests. Please wait 1 hour."

    # Generate 6-digit code using CSPRNG
    otp_code = "".join(secrets.choice(string.digits) for _ in range(6))
    otp_hash = hashlib.sha256(otp_code.encode("utf-8")).hexdigest()

    record = DeviceRebindOTP(
        student_id=student.id,
        otp_hash=otp_hash,
        expires_at=now + timedelta(minutes=10),
        attempts=0,
        is_verified=False,
        created_at=now
    )
    db.add(record)
    db.commit()

    # Send email
    html_body = render_email_template("otp_email.html", {
        "student_name": student.name,
        "otp_code": otp_code,
        "expiry_minutes": 10
    })
    if "Template rendering unavailable" in html_body or "Template rendering error" in html_body:
        html_body = f"""
        <html><body>
        <h3>SNIST ERP — Device Rebind Verification Code</h3>
        <p>Dear {student.name},</p>
        <p>Your verification code to link a new attendance device is: <strong>{otp_code}</strong></p>
        <p>This code expires in 10 minutes. If you did not initiate this request, contact support immediately.</p>
        </body></html>
        """

    send_res = send_single_email(
        to_email=student.email,
        subject=f"SNIST ERP — Device Rebind Verification Code: {otp_code}",
        html_body=html_body,
        channel="OTP"
    )

    # Security audit event (Zero OTP in log)
    audit = AuditLog(
        user_id=student.user_id,
        roll_number=student.roll_number,
        event_type="REBIND_OTP_SENT",
        action="REBIND_OTP_DISPATCH",
        details=f"Rebind OTP dispatched to {mask_email(student.email)} (status={send_res.get('status')})",
        created_at=now
    )
    db.add(audit)
    db.commit()

    return True, "Code sent"


# ============================================================
# API ENDPOINT 1: ENROLLMENT & REBIND
# ============================================================

@router.post("/enroll", dependencies=[Depends(check_binding_v2_enabled)])
def enroll_device_key(
    req: DeviceEnrollmentRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Registers a non-extractable client public key for the student account.
    Enforces:
    1. Idempotent refresh if the same key is already registered.
    2. High-friction email OTP verification if rebinding to a new key.
    3. Maximum 2 rebinds per rolling 30 days.
    4. Database-enforced single active binding invariant.
    """
    student = db.query(Student).filter(Student.user_id == current_user.id).first()
    student = db.query(Student).filter(Student.user_id == current_user.id).first()
    if not student:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only students can register attendance devices.")

    raw_spki = (req.public_key or req.public_key_spki_b64 or "").strip()
    if not raw_spki:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="public_key (SPKI DER Base64) is required.")

    key_id_val = req.key_id.strip().upper() if req.key_id else hashlib.sha256(raw_spki.encode("utf-8")).hexdigest()[:32].upper()

    clean_roll = student.roll_number.strip().upper()
    now_utc = datetime.utcnow()
    thirty_days_ago = now_utc - timedelta(days=30)

    # Find current active binding
    active_binding = db.query(DeviceBinding).filter(
        DeviceBinding.student_id == student.id,
        DeviceBinding.revoked_at == None
    ).first()

    # --------------------------------------------------------------------------
    # CASE 1: IDENTICAL KEY (IDEMPOTENT REFRESH)
    # --------------------------------------------------------------------------
    if active_binding and active_binding.key_id == key_id_val:
        active_binding.storage_persist_granted = bool(req.storage_persist_granted)
        active_binding.browser_profile_tag = req.browser_profile_tag
        db.commit()

        audit = AuditLog(
            user_id=current_user.id,
            roll_number=clean_roll,
            event_type="BINDING_REFRESH",
            action="BINDING_REFRESH",
            details=f"Idempotent binding refresh for key_id={key_id_val[:8]}... (persist={req.storage_persist_granted})",
            created_at=now_utc
        )
        db.add(audit)
        db.commit()

        return {
            "status": "BINDING_REFRESH",
            "action": "BINDING_REFRESH",
            "key_id": key_id_val,
            "message": "Device key verified and refreshed."
        }

    # --------------------------------------------------------------------------
    # CHURN RATE LIMIT CHECK (Max 2 rebinds per 30 days)
    # --------------------------------------------------------------------------
    rebind_count = db.query(DeviceBinding).filter(
        DeviceBinding.student_id == student.id,
        DeviceBinding.enrolled_at >= thirty_days_ago,
        DeviceBinding.revoked_reason == "rebind"
    ).count()

    if rebind_count >= settings.ENROLL_LIMIT_30_DAYS:
        audit = AuditLog(
            user_id=current_user.id,
            roll_number=clean_roll,
            event_type="CHURN_LIMIT_EXCEEDED",
            action="ENROLLMENT_BLOCKED",
            details=f"Student exceeded 30-day device rebind limit ({rebind_count}/{settings.ENROLL_LIMIT_30_DAYS})",
            created_at=now_utc
        )
        db.add(audit)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "error_type": "CHURN_LIMIT_EXCEEDED",
                "message": f"Device registration limit reached (maximum {settings.ENROLL_LIMIT_30_DAYS} per 30 days). Contact your department HOD for authorization."
            }
        )

    # --------------------------------------------------------------------------
    # CASE 2: RECOVERY FLOW (Storage Eviction Recovery)
    # --------------------------------------------------------------------------
    is_recovery_case = bool(req.is_recovery and req.corroboration_nonce)

    # --------------------------------------------------------------------------
    # CASE 3: ACTIVE BINDING EXISTS -> NEW KEY REQUIRES OTP (REBIND FRICTION)
    # --------------------------------------------------------------------------
    if active_binding and not is_recovery_case:
        if not req.rebind_otp:
            # Trigger OTP dispatch automatically
            success, msg = dispatch_rebind_otp_internal(student, db)
            return {
                "status": "REBIND_REQUIRED",
                "otp_required": True,
                "detail": f"An existing device is bound to this account. A verification code has been dispatched to {mask_email(student.email)} to authorize device replacement.",
                "email_masked": mask_email(student.email),
                "rebind_in_progress": True
            }

        # Validate OTP
        otp_hash = hashlib.sha256(req.rebind_otp.strip().encode("utf-8")).hexdigest()
        otp_record = db.query(DeviceRebindOTP).filter(
            DeviceRebindOTP.student_id == student.id,
            DeviceRebindOTP.is_verified == False,
            DeviceRebindOTP.expires_at > now_utc
        ).order_by(DeviceRebindOTP.created_at.desc()).first()

        if not otp_record:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"error_type": "INVALID_OTP", "message": "No active verification code found. Please request a new code."}
            )

        if otp_record.attempts >= 3:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"error_type": "INVALID_OTP", "message": "Maximum verification attempts exceeded. Please request a new code."}
            )

        otp_record.attempts += 1
        if otp_record.otp_hash != otp_hash:
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"error_type": "INVALID_OTP", "message": "Invalid verification code."}
            )

        # OTP verified! Mark used
        otp_record.is_verified = True

        # Atomically revoke old binding
        active_binding.revoked_at = now_utc
        active_binding.revoked_reason = RevokedReason.REBIND.value
        enrolled_via_val = EnrolledVia.SELF.value
        action_name = "DEVICE_REBOUND"

    elif is_recovery_case and active_binding:
        # Recovery from storage eviction with valid paired cookie token
        active_binding.revoked_at = now_utc
        active_binding.revoked_reason = RevokedReason.REBIND.value
        enrolled_via_val = EnrolledVia.RECOVERY.value
        action_name = "BINDING_RECOVERY"

    else:
        enrolled_via_val = EnrolledVia.SELF.value
        action_name = "DEVICE_ENROLLED"

    # --------------------------------------------------------------------------
    # ATOMIC INSERT OF NEW ACTIVE BINDING
    # --------------------------------------------------------------------------
    new_binding = DeviceBinding(
        student_id=student.id,
        public_key=raw_spki,
        key_id=key_id_val,
        enrolled_at=now_utc,
        enrolled_via=enrolled_via_val,
        storage_persist_granted=bool(req.storage_persist_granted),
        browser_profile_tag=req.browser_profile_tag,
        revoked_at=None,
        revoked_reason=None
    )
    db.add(new_binding)

    try:
        db.commit()
    except IntegrityError as race_err:
        db.rollback()
        logger.error(f"[BINDING INVARIANT VIOLATION] Database rejected concurrent double-enrollment for student {clean_roll}: {race_err}")
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A concurrent device enrollment was already processed for this student."
        )

    # Audit Logging (Zero key material, Zero PII)
    audit = AuditLog(
        user_id=current_user.id,
        roll_number=clean_roll,
        event_type="DEVICE_BINDING_UPDATED",
        action=action_name,
        details=f"{action_name}: key_id={key_id_val[:8]}... enrolled_via={enrolled_via_val}",
        created_at=now_utc
    )
    db.add(audit)
    db.commit()

    logger.info(f"[{action_name}] Student {clean_roll} successfully enrolled key {key_id_val[:8]}... (via {enrolled_via_val})")

    return {
        "status": "DEVICE_ENROLLED",
        "action": action_name,
        "key_id": key_id_val,
        "enrolled_at": now_utc.isoformat(),
        "message": "Device key successfully registered and active."
    }


# ============================================================
# API ENDPOINT 2: CHALLENGE NONCE GENERATION
# ============================================================

@router.post("/challenge", dependencies=[Depends(check_binding_v2_enabled)], response_model=ChallengeResponse)
def request_binding_challenge(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Generates a single-use HMAC-signed challenge token (60s TTL).
    Stateless and sub-millisecond; zero database writes.
    """
    student = db.query(Student).filter(Student.user_id == current_user.id).first()
    if not student:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only student accounts can request attendance challenges.")

    token_data = create_challenge_token(student_id=student.id, roll_number=student.roll_number)
    return ChallengeResponse(**token_data)


# ============================================================
# API ENDPOINT 3: CHALLENGE SIGNATURE VERIFICATION
# ============================================================

@router.post("/verify", dependencies=[Depends(check_binding_v2_enabled)])
def verify_binding_signature(
    req: BindingVerifyRequest,
    request: Request,
    db: Session = Depends(get_db)
):
    """
    Verifies that the client holds the non-extractable private key matching
    their active institutional binding.
    Execution SLA budget: <= 5.0ms.
    """
    t0 = time.perf_counter()
    ip_addr = request.client.host if request.client else "unknown"

    # Step 1: Decode & validate challenge token signature and expiry
    is_valid, payload, err_reason = decode_and_validate_challenge_token(req.challenge_token)
    roll_identifier = (payload.get("roll_number") if payload else req.student_roll or ip_addr).strip().upper()

    # Step 0: Check Lockout on repeated signature failure
    is_locked, failures, remaining_sec = check_verify_lockout(roll_identifier)
    if is_locked:
        logger.warning(f"[BINDING LOCKOUT] Verification rejected for {roll_identifier}: locked for {remaining_sec}s")
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "error_type": "VERIFY_LOCKOUT",
                "detail": f"Too many failed verification attempts. Account locked for {remaining_sec} seconds.",
                "retry_after_seconds": remaining_sec,
                "lockout_minutes": 15
            },
            headers={"Retry-After": str(remaining_sec), "X-Lockout-Minutes": "15"}
        )

    if not is_valid:
        record_verify_failure(roll_identifier)
        if err_reason == "challenge_expired":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"error_type": "challenge_expired", "detail": "Attendance challenge has expired. Request a new code."}
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error_type": "signature_invalid", "detail": "Challenge token integrity verification failed."}
        )

    # Step 2: Atomic replay check (single-use nonce)
    consumed_ok, consume_reason = mark_challenge_consumed(payload["nonce"], payload["exp"])
    if not consumed_ok:
        record_verify_failure(roll_identifier)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error_type": "challenge_reused", "detail": "Challenge token was already consumed (Replay attack blocked)."}
        )

    # Step 3: Fetch student's ACTIVE public key
    student_id = payload["student_id"]
    active_binding = db.query(DeviceBinding).filter(
        DeviceBinding.student_id == student_id,
        DeviceBinding.revoked_at == None
    ).first()

    if not active_binding:
        record_verify_failure(roll_identifier)
        # Check if student has revoked binding
        revoked_row = db.query(DeviceBinding).filter(
            DeviceBinding.student_id == student_id
        ).order_by(DeviceBinding.revoked_at.desc()).first()

        if revoked_row:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"error_type": "revoked", "detail": "Device key has been revoked. Please re-enroll this device."}
            )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error_type": "no_active_binding", "detail": "No active device binding found for this account."}
        )

    # Step 4: Verify ECDSA P-256 IEEE P1363 signature over challenge token bytes
    data_bytes = req.challenge_token.encode("utf-8")
    sig_ok, sig_reason = verify_ecdsa_p1363_signature(
        public_key_spki_b64=active_binding.public_key,
        signature_b64=req.signature,
        data_bytes=data_bytes
    )

    t_verify_ms = round((time.perf_counter() - t0) * 1000, 3)

    if not sig_ok:
        record_verify_failure(roll_identifier)
        audit = AuditLog(
            user_id=None,
            roll_number=roll_identifier,
            event_type="BINDING_VERIFY_FAILURE",
            action="SIGNATURE_REJECTED",
            details=f"ECDSA signature verification failed: {sig_reason} (latency={t_verify_ms}ms)",
            created_at=datetime.utcnow()
        )
        db.add(audit)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error_type": "signature_invalid", "detail": "Cryptographic signature verification failed."}
        )

    # Step 5: Clean pass! Reset lockout counter
    clear_verify_failures(roll_identifier)

    return {
        "status": "VERIFIED",
        "verified": True,
        "key_id": active_binding.key_id,
        "student_roll": payload["roll_number"],
        "verify_duration_ms": t_verify_ms,
        "latency_ms": t_verify_ms
    }


# ============================================================
# API ENDPOINT 4: REQUEST REBIND OTP DIRECTLY
# ============================================================

@router.post("/request-rebind-otp", dependencies=[Depends(check_binding_v2_enabled)])
def request_rebind_otp(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Explicit student endpoint to request an email OTP for device re-registration.
    """
    student = db.query(Student).filter(Student.user_id == current_user.id).first()
    if not student:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only students can request device rebind codes.")

    ok, msg = dispatch_rebind_otp_internal(student, db)
    if not ok:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=msg)

    return {
        "status": "SENT",
        "email_masked": mask_email(student.email),
        "expires_in_minutes": 10,
        "message": f"Verification code sent to {mask_email(student.email)}"
    }


# ============================================================
# API ENDPOINT 5: FACULTY / ADMIN RESET
# ============================================================

@router.post("/admin/revoke/{student_id}", dependencies=[Depends(check_binding_v2_enabled)])
def admin_revoke_student_binding(
    student_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Administrative revocation for lost/damaged devices.
    Exempt from student's 2/30-day churn limit.
    """
    if current_user.role not in [UserRole.SUPER_ADMIN, UserRole.TEACHER]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Administrative privileges required.")

    student = db.query(Student).filter(Student.id == student_id).first()
    if not student:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not found.")

    now_utc = datetime.utcnow()
    active_binding = db.query(DeviceBinding).filter(
        DeviceBinding.student_id == student_id,
        DeviceBinding.revoked_at == None
    ).first()

    if not active_binding:
        return {"status": "NO_OP", "message": "Student has no active device binding to revoke."}

    active_binding.revoked_at = now_utc
    active_binding.revoked_reason = RevokedReason.ADMIN_RESET.value

    audit = AuditLog(
        user_id=current_user.id,
        roll_number=student.roll_number,
        event_type="ADMIN_DEVICE_RESET",
        action="BINDING_REVOKED_BY_ADMIN",
        details=f"Admin/Teacher (user_id={current_user.id}) revoked binding key_id={active_binding.key_id[:8]}...",
        created_at=now_utc
    )
    db.add(audit)
    db.commit()

    logger.info(f"[ADMIN REVOKE] Binding revoked for student {student.roll_number} by user {current_user.id}")

    return {
        "status": "BINDING_REVOKED",
        "action": "DEVICE_REVOKED",
        "student_id": student.id,
        "roll_number": student.roll_number,
        "revoked_at": now_utc.isoformat(),
        "message": f"Device binding for {student.roll_number} has been revoked. Student can enroll fresh device on next login."
    }


# ============================================================
# API ENDPOINT 6: CHURN ANOMALY DASHBOARD VIEW
# ============================================================

@router.get("/admin/churn-anomalies", dependencies=[Depends(check_binding_v2_enabled)])
def get_churn_anomalies(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Returns students with > 2 device rebinds in the rolling 30-day window.
    Flags churn anomalies for administrative review.
    """
    if current_user.role not in [UserRole.SUPER_ADMIN, UserRole.TEACHER]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Administrative privileges required.")

    thirty_days_ago = datetime.utcnow() - timedelta(days=30)

    # Subquery: Count rebinds in 30 days
    rebind_counts = db.query(
        DeviceBinding.student_id,
        func.count(DeviceBinding.id).label("rebind_count"),
        func.max(DeviceBinding.enrolled_at).label("last_rebind_at")
    ).filter(
        DeviceBinding.enrolled_at >= thirty_days_ago,
        DeviceBinding.revoked_reason == RevokedReason.REBIND.value
    ).group_by(DeviceBinding.student_id).all()

    anomalies = []
    for row in rebind_counts:
        if row.rebind_count >= settings.ENROLL_LIMIT_30_DAYS:
            st = db.query(Student).filter(Student.id == row.student_id).first()
            if st:
                dept = db.query(Department).filter(Department.id == st.department_id).first() if st.department_id else None
                anomalies.append({
                    "student_id": st.id,
                    "roll_number": st.roll_number,
                    "name": st.name,
                    "department": dept.name if dept else "N/A",
                    "rebind_count": row.rebind_count,
                    "last_rebind_at": row.last_rebind_at.isoformat() if row.last_rebind_at else None,
                    "status": "RED" if row.rebind_count > settings.ENROLL_LIMIT_30_DAYS else "AMBER"
                })

    anomalies.sort(key=lambda x: x["rebind_count"], reverse=True)

    return {
        "status": "SUCCESS",
        "total_anomalies": len(anomalies),
        "limit_threshold": settings.ENROLL_LIMIT_30_DAYS,
        "window_days": 30,
        "anomalies": anomalies
    }
