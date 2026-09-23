"""
SNIST ERP — Cryptographic Device Identity API Service

Endpoints:
1. POST /api/v1/attendance/devices/register:
   Registers a client-generated public key & random device_id with the authenticated student.
   Enforces MAX_ACTIVE_DEVICES_PER_STUDENT, rejects cross-student key reuse, and logs audit events.
2. POST /api/v1/attendance/devices/challenge:
   Generates a short-lived single-use canonical challenge bound to the student, device, and operation.
3. POST /api/v1/attendance/devices/verify:
   Validates ECDSA P-256 signature over the canonical challenge format. Replay-protected.
4. POST /api/v1/attendance/devices/{device_id}/revoke:
   Revokes a device identity. Preserves past attendance records; prevents future proofs.
"""

import os
import time
import base64
import uuid
import hashlib
import logging
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from cryptography.hazmat.primitives import serialization

from app.core.config import settings
from app.core.database import get_db
from app.api.auth import get_current_user
from app.api.student import require_student
from app.models.models import (
    User,
    UserRole,
    Student,
    DeviceBinding,
    DeviceRebindOTP,
    AuditLog,
    SecurityEventType
)
from app.core.binding_crypto import (
    create_challenge_token,
    decode_and_validate_challenge_token,
    mark_challenge_consumed,
    verify_ecdsa_p1363_signature,
    build_canonical_challenge_message,
    record_verify_failure,
    check_verify_lockout,
    clear_verify_failures
)
from app.core.device_security import log_security_audit_event

logger = logging.getLogger("snist_erp.attendance_devices")

router = APIRouter(prefix="/attendance/devices", tags=["Cryptographic Device Identity"])


# Active challenge store for instant challenge_id lookup (with TTL)
_ACTIVE_CHALLENGES: Dict[str, Dict[str, Any]] = {}

# ============================================================
# REQUEST & RESPONSE SCHEMAS
# ============================================================

class DeviceRegistrationRequest(BaseModel):
    device_id: Optional[str] = Field(None, description="Client-generated random UUID v4 identifier")
    public_key: Optional[str] = Field(None, description="Base64-encoded SubjectPublicKeyInfo (SPKI) DER public key")
    public_key_spki_b64: Optional[str] = Field(None, description="Alias for public_key")
    key_algorithm: Optional[str] = Field("ECDSA_P256", description="Cryptographic algorithm (ECDSA_P256)")
    key_version: Optional[int] = Field(1, description="Key version schema number")
    client_type: Optional[str] = Field("WEB", description="Client application type: WEB | PWA | ANDROID")
    device_label: Optional[str] = Field(None, description="Optional informational label")
    platform: Optional[str] = Field(None, description="Informational platform metadata (e.g. Android 14)")
    browser_family: Optional[str] = Field(None, description="Informational browser family (e.g. Chrome)")
    app_version: Optional[str] = Field(None, description="Informational client app version")
    replace_active: Optional[bool] = Field(False, description="Supersede active devices when limit is reached")
    rebind_otp: Optional[str] = Field(None, description="Single-use OTP code if replacing an existing active device")
    telemetry_metadata: Optional[Dict[str, Any]] = Field(None, description="Client telemetry metadata")


class DeviceChallengeRequest(BaseModel):
    device_id: Optional[str] = Field(None, description="Client device identifier")
    operation: Optional[str] = Field("ATTENDANCE", description="Intended operation scope")


class DeviceVerifyRequest(BaseModel):
    device_id: str = Field(..., description="Client device identifier")
    challenge_token: Optional[str] = Field(None, description="HMAC-signed challenge token from backend")
    challenge_id: Optional[str] = Field(None, description="Challenge identifier issued by backend")
    signature: str = Field(..., description="Base64-encoded raw IEEE P1363 ECDSA signature")
    operation: Optional[str] = Field("ATTENDANCE", description="Operation scope")


# ============================================================
# HELPER: INTERNAL OTP DISPATCH
# ============================================================

def _dispatch_rebind_otp(student: Student, db: Session) -> bool:
    """Dispatches 6-digit OTP for device replacement / recovery."""
    from app.api.binding import dispatch_rebind_otp_internal
    success, _ = dispatch_rebind_otp_internal(student, db)
    return success


# ============================================================
# 1. DEVICE REGISTRATION
# ============================================================

@router.post("/register")
def register_cryptographic_device(
    req: DeviceRegistrationRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_student: Student = Depends(require_student)
):
    """
    Registers a cryptographic public key and random device identifier for the authenticated student.
    Enforces:
    - Never trusts client-supplied student ID.
    - Validates public key syntax (ECDSA P-256 SPKI DER).
    - Prevents cross-student key reuse.
    - Enforces MAX_ACTIVE_DEVICES_PER_STUDENT.
    - Emits DEVICE_REGISTERED audit event.
    """
    ip_addr = request.client.host if request.client else "127.0.0.1"
    clean_roll = current_student.roll_number.strip().upper()

    # 1. Validate Public Key Format
    raw_spki = (req.public_key or req.public_key_spki_b64 or "").strip()
    if not raw_spki:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="MISSING_PUBLIC_KEY: Public key is required."
        )

    try:
        spki_der = base64.b64decode(raw_spki)
        # Attempt to load public key with cryptography library
        serialization.load_der_public_key(spki_der)
    except Exception as key_err:
        logger.warning(f"[DEVICE SECURITY] Invalid public key format from student {clean_roll}: {key_err}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="INVALID_PUBLIC_KEY: Public key must be valid SubjectPublicKeyInfo (SPKI) DER Base64."
        )

    # 2. Derive key_id (SHA-256 hex digest)
    key_id = hashlib.sha256(spki_der).hexdigest()[:32].upper()

    # 3. Validate supported algorithm and version
    algo = (req.key_algorithm or "ECDSA_P256").strip().upper()
    if algo not in ["ECDSA_P256", "ECDSA"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"UNSUPPORTED_ALGORITHM: Algorithm '{req.key_algorithm}' is not supported. Use ECDSA_P256."
        )
    key_version = req.key_version or 1
    if key_version != 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"UNSUPPORTED_KEY_VERSION: Key version '{key_version}' is not supported."
        )

    # 4. Device ID handling (Client-generated UUID or generate server-side if missing)
    device_id = (req.device_id or "").strip()
    if not device_id:
        device_id = str(uuid.uuid4())

    # 5. CROSS-STUDENT KEY REUSE PROTECTION (Critical Rule)
    # The exact same cryptographic public key must NEVER be reassigned to another student!
    other_student_binding = db.query(DeviceBinding).filter(
        DeviceBinding.student_id != current_student.id,
        DeviceBinding.key_id == key_id,
        DeviceBinding.revoked_at.is_(None),
        DeviceBinding.status == "ACTIVE"
    ).first()

    if other_student_binding:
        logger.error(
            f"[DEVICE SECURITY ALERT] Cross-student key reuse detected! "
            f"Student {clean_roll} attempted to register public key belonging to student_id={other_student_binding.student_id}"
        )
        try:
            log_security_audit_event(
                db=db,
                event_type=SecurityEventType.DEVICE_KEY_REUSE_REJECTED,
                action="CROSS_STUDENT_KEY_REUSE_ATTEMPT",
                details=f"Student {clean_roll} attempted to register cryptographic key belonging to student_id {other_student_binding.student_id}",
                roll_number=clean_roll,
                ip_address=ip_addr
            )
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="DEVICE_KEY_REUSE_REJECTED: This cryptographic key is already registered to another student account."
        )

    # 6. Idempotent re-registration check for the SAME student
    existing_binding = db.query(DeviceBinding).filter(
        DeviceBinding.student_id == current_student.id,
        DeviceBinding.key_id == key_id,
        DeviceBinding.revoked_at.is_(None)
    ).first()

    if existing_binding:
        # Same student, same key: update metadata idempotently
        existing_binding.last_seen_at = datetime.utcnow()
        if req.device_label:
            existing_binding.device_label = req.device_label
        if req.platform:
            existing_binding.platform = req.platform
        db.commit()
        return {
            "status": "ACTIVE",
            "message": "Device identity already registered and active.",
            "device_id": existing_binding.device_id or device_id,
            "key_id": key_id,
            "key_algorithm": existing_binding.key_algorithm,
            "client_type": existing_binding.client_type,
            "created_at": existing_binding.created_at.isoformat() if existing_binding.created_at else datetime.utcnow().isoformat()
        }

    # 7. MULTI-DEVICE LIMIT ENFORCEMENT & CONTROLLED RECOVERY
    max_devices = getattr(settings, "MAX_ACTIVE_DEVICES_PER_STUDENT", 1)
    active_devices = db.query(DeviceBinding).filter(
        DeviceBinding.student_id == current_student.id,
        DeviceBinding.revoked_at.is_(None),
        DeviceBinding.status == "ACTIVE"
    ).all()

    now = datetime.utcnow()
    is_rebind = False

    if len(active_devices) >= max_devices:
        if req.replace_active:
            for old_dev in active_devices:
                old_dev.status = "REVOKED"
                old_dev.revoked_at = now
                old_dev.revoked_reason = "SUPERSEDED_BY_NEW_DEVICE"
            db.commit()
            is_rebind = True
        elif req.rebind_otp:
            # Verify OTP
            otp_code = req.rebind_otp.strip()
            otp_hash = hashlib.sha256(otp_code.encode("utf-8")).hexdigest()
            otp_record = db.query(DeviceRebindOTP).filter(
                DeviceRebindOTP.student_id == current_student.id,
                DeviceRebindOTP.otp_hash == otp_hash,
                DeviceRebindOTP.expires_at > now,
                DeviceRebindOTP.is_verified == False
            ).order_by(DeviceRebindOTP.id.desc()).first()

            if not otp_record:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="INVALID_OTP: The device verification code is invalid, expired, or already used."
                )

            otp_record.is_verified = True
            is_rebind = True

            # Revoke previous active devices
            for old_dev in active_devices:
                old_dev.status = "REVOKED"
                old_dev.revoked_at = now
                old_dev.revoked_reason = "rebind"

            try:
                log_security_audit_event(
                    db=db,
                    event_type=SecurityEventType.DEVICE_REVOKED,
                    action="DEVICE_REBIND_REVOKE",
                    details=f"Student {clean_roll} verified OTP; revoked old device for replacement",
                    roll_number=clean_roll,
                    ip_address=ip_addr
                )
            except Exception:
                pass
        else:
            # Active limit reached and no OTP supplied: dispatch OTP and block silent overwrite
            _dispatch_rebind_otp(current_student, db)
            db.commit()
            try:
                log_security_audit_event(
                    db=db,
                    event_type=SecurityEventType.DEVICE_LIMIT_REACHED,
                    action="DEVICE_REGISTRATION_LIMIT_HIT",
                    details=f"Student {clean_roll} attempted to exceed active device limit of {max_devices}. Dispatched rebind OTP.",
                    roll_number=clean_roll,
                    ip_address=ip_addr
                )
            except Exception:
                pass
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="DEVICE_LIMIT_REACHED: Maximum active devices reached. Verification OTP has been dispatched to your email for device replacement."
            )

    # 8. Create new DeviceBinding record
    client_type = (req.client_type or "WEB").strip().upper()
    if client_type not in ["WEB", "PWA", "ANDROID"]:
        client_type = "WEB"

    new_binding = DeviceBinding(
        student_id=current_student.id,
        device_id=device_id,
        public_key=raw_spki,
        key_id=key_id,
        key_algorithm=algo,
        key_version=key_version,
        client_type=client_type,
        status="ACTIVE",
        enrolled_at=now,
        enrolled_via="rebind" if is_rebind else "self",
        last_seen_at=now,
        last_verified_at=None,
        device_label=req.device_label,
        platform=req.platform,
        browser_family=req.browser_family,
        app_version=req.app_version,
        registered_user_agent_metadata=request.headers.get("user-agent", ""),
        created_at=now
    )
    db.add(new_binding)
    db.commit()
    db.refresh(new_binding)

    # 9. Audit event
    event_type = SecurityEventType.DEVICE_RE_REGISTERED if is_rebind else SecurityEventType.DEVICE_REGISTERED
    try:
        log_security_audit_event(
            db=db,
            event_type=event_type,
            action="CRYPTOGRAPHIC_DEVICE_REGISTERED",
            details=f"Student {clean_roll} registered device {device_id} ({client_type}, key={key_id[:8]}...)",
            roll_number=clean_roll,
            ip_address=ip_addr
        )
    except Exception:
        pass

    return {
        "success": True,
        "status": "ACTIVE",
        "message": "Cryptographic device registered successfully.",
        "device_id": new_binding.device_id,
        "key_id": new_binding.key_id,
        "key_algorithm": new_binding.key_algorithm,
        "key_version": new_binding.key_version,
        "client_type": new_binding.client_type,
        "created_at": new_binding.created_at.isoformat()
    }


# ============================================================
# 2. DEVICE CHALLENGE ISSUANCE
# ============================================================

@router.post("/challenge")
def request_device_challenge(
    req: DeviceChallengeRequest,
    db: Session = Depends(get_db),
    current_student: Student = Depends(require_student)
):
    """
    Issues a short-lived single-use canonical challenge bound to the student, device, and operation.
    """
    clean_roll = current_student.roll_number.strip().upper()
    dev_id = (req.device_id or "").strip()

    # Look up student's active device
    if dev_id:
        binding = db.query(DeviceBinding).filter(
            DeviceBinding.student_id == current_student.id,
            DeviceBinding.device_id == dev_id
        ).first()
    else:
        binding = db.query(DeviceBinding).filter(
            DeviceBinding.student_id == current_student.id,
            DeviceBinding.revoked_at.is_(None),
            DeviceBinding.status == "ACTIVE"
        ).first()

    if not binding:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="DEVICE_KEY_MISSING: No registered device identity found for this student. Please register your device."
        )

    if binding.status == "REVOKED" or binding.revoked_at is not None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="DEVICE_REVOKED: This device has been revoked and cannot participate in attendance."
        )

    operation = (req.operation or "ATTENDANCE").strip().upper()
    c_res = create_challenge_token(
        student_id=current_student.id,
        roll_number=clean_roll,
        device_id=binding.device_id or dev_id or f"DEV-{current_student.id}",
        operation=operation
    )
    _ACTIVE_CHALLENGES[c_res["challenge_id"]] = c_res

    return {
        "challenge_token": c_res["challenge_token"],
        "challenge_id": c_res["challenge_id"],
        "device_id": binding.device_id,
        "operation": operation,
        "canonical_message": c_res["canonical_message"],
        "nonce": c_res["nonce"],
        "expires_at": c_res["expires_at"],
        "ttl_seconds": c_res["ttl_seconds"]
    }


# ============================================================
# 3. DEVICE VERIFY / PROOF OF POSSESSION
# ============================================================

@router.post("/verify")
def verify_device_proof(
    req: DeviceVerifyRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_student: Student = Depends(require_student)
):
    """
    Verifies proof of possession of the registered device's private key.
    Enforces:
    - Replay protection (single-use challenge)
    - Expiration check
    - Student and device ownership match
    - ECDSA P-256 signature verification over canonical message
    """
    clean_roll = current_student.roll_number.strip().upper()
    ip_addr = request.client.host if request.client else "127.0.0.1"
    lockout_key = f"dev_verify_{clean_roll}"

    # 1. Check brute-force lockout
    is_locked, fail_count, remaining_sec = check_verify_lockout(lockout_key)
    if is_locked:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"VERIFY_LOCKOUT: Too many failed possession proofs. Locked out for {remaining_sec}s.",
            headers={"Retry-After": str(remaining_sec)}
        )

    # 2. Fetch device binding
    binding = db.query(DeviceBinding).filter(
        DeviceBinding.student_id == current_student.id,
        DeviceBinding.device_id == req.device_id.strip()
    ).first()

    if not binding:
        record_verify_failure(lockout_key)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="DEVICE_KEY_MISSING: No device identity matches the supplied device_id."
        )

    if binding.status == "REVOKED" or binding.revoked_at is not None:
        try:
            log_security_audit_event(
                db=db,
                event_type=SecurityEventType.DEVICE_VERIFICATION_FAILED,
                action="REVOKED_DEVICE_PROOF_REJECTED",
                details=f"Student {clean_roll} attempted to verify revoked device {req.device_id}",
                roll_number=clean_roll,
                ip_address=ip_addr
            )
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="DEVICE_REVOKED: This device has been revoked and cannot be verified."
        )

    # 3. Decode challenge token / lookup challenge_id
    is_valid = False
    payload = None
    reason = "challenge_invalid_format"

    if req.challenge_token:
        is_valid, payload, reason = decode_and_validate_challenge_token(req.challenge_token)
    elif req.challenge_id:
        if req.challenge_id in _ACTIVE_CHALLENGES:
            c_info = _ACTIVE_CHALLENGES[req.challenge_id]
            now_ts = int(time.time())
            if now_ts > c_info.get("expires_at", 0):
                is_valid = False
                reason = "challenge_expired"
                payload = c_info
            else:
                is_valid = True
                reason = "ok"
                payload = c_info
        else:
            is_valid = False
            reason = "challenge_invalid_format"
            payload = None
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="CHALLENGE_REQUIRED: challenge_token or challenge_id is required."
        )

    if not is_valid:
        record_verify_failure(lockout_key)
        if reason == "challenge_expired":
            try:
                log_security_audit_event(
                    db=db,
                    event_type=SecurityEventType.DEVICE_CHALLENGE_EXPIRED,
                    action="CHALLENGE_EXPIRED",
                    details=f"Expired challenge token for student {clean_roll}",
                    roll_number=clean_roll,
                    ip_address=ip_addr
                )
            except Exception:
                pass
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="DEVICE_CHALLENGE_EXPIRED: Challenge token has expired. Please request a new challenge."
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"DEVICE_VERIFICATION_FAILED: Invalid challenge token: {reason}"
        )

    # 4. Check student ID and device ID binding
    token_student_id = payload.get("student_id")
    if token_student_id is not None and token_student_id != current_student.id:
        record_verify_failure(lockout_key)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="DEVICE_VERIFICATION_FAILED: Challenge token was not issued to this student."
        )

    token_dev_id = payload.get("device_id")
    if token_dev_id and token_dev_id != req.device_id.strip():
        record_verify_failure(lockout_key)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="DEVICE_VERIFICATION_FAILED: Challenge token was not issued for this device."
        )

    # 5. REPLAY PROTECTION: Single-use consumption
    nonce = payload.get("nonce", "")
    exp_ts = payload.get("exp") or payload.get("expires_at") or (int(time.time()) + 60)
    consumed, consume_reason = mark_challenge_consumed(nonce, exp_ts)
    if not consumed:
        record_verify_failure(lockout_key)
        try:
            log_security_audit_event(
                db=db,
                event_type=SecurityEventType.DEVICE_CHALLENGE_REPLAYED,
                action="CHALLENGE_REPLAY_ATTEMPT",
                details=f"Replay detected for student {clean_roll} on device {req.device_id}",
                roll_number=clean_roll,
                ip_address=ip_addr
            )
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="DEVICE_CHALLENGE_REPLAYED: Challenge has already been used. Replay attacks are prohibited."
        )

    # 6. Verify ECDSA signature over canonical message
    canonical_msg = payload.get("canonical_message")
    sig_valid = False
    sig_reason = ""

    if canonical_msg:
        sig_valid, sig_reason = verify_ecdsa_p1363_signature(
            binding.public_key,
            req.signature,
            canonical_msg.encode("utf-8")
        )

    # Fallback to signing challenge_token directly (backward compatibility)
    if not sig_valid and req.challenge_token:
        sig_valid, sig_reason = verify_ecdsa_p1363_signature(
            binding.public_key,
            req.signature,
            req.challenge_token.encode("utf-8")
        )

    if not sig_valid:
        record_verify_failure(lockout_key)
        try:
            log_security_audit_event(
                db=db,
                event_type=SecurityEventType.DEVICE_VERIFICATION_FAILED,
                action="DEVICE_SIGNATURE_INVALID",
                details=f"Invalid signature from student {clean_roll} on device {req.device_id}: {sig_reason}",
                roll_number=clean_roll,
                ip_address=ip_addr
            )
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"DEVICE_VERIFICATION_FAILED: Signature verification failed: {sig_reason}"
        )

    # 7. Verification Success
    clear_verify_failures(lockout_key)
    now = datetime.utcnow()
    binding.last_seen_at = now
    binding.last_verified_at = now
    db.commit()

    try:
        log_security_audit_event(
            db=db,
            event_type=SecurityEventType.DEVICE_VERIFIED,
            action="DEVICE_VERIFIED_SUCCESS",
            details=f"Cryptographic proof verified for student {clean_roll} on device {binding.device_id}",
            roll_number=clean_roll,
            ip_address=ip_addr
        )
    except Exception:
        pass

    return {
        "success": True,
        "valid": True,
        "status": "SUCCESS",
        "verified": True,
        "device_id": binding.device_id,
        "key_id": binding.key_id,
        "verified_at": now.isoformat()
    }


# ============================================================
# 4. DEVICE REVOCATION
# ============================================================

@router.post("/{device_id}/revoke")
def revoke_cryptographic_device(
    device_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Revokes a cryptographic device identity.
    Authorized users: Super Admin, Teacher, or the Student who owns the device.
    Sets status = REVOKED. Preserves all past attendance records.
    """
    ip_addr = request.client.host if request.client else "127.0.0.1"

    binding = db.query(DeviceBinding).filter(DeviceBinding.device_id == device_id.strip()).first()
    if not binding:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Device identity not found."
        )

    # Authorization check
    if current_user.role == UserRole.STUDENT:
        student = db.query(Student).filter(Student.user_id == current_user.id).first()
        if not student or binding.student_id != student.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only revoke devices registered to your own account."
            )
        roll = student.roll_number
        reason = "student_request"
    else:
        # Admin or Teacher
        st = db.query(Student).filter(Student.id == binding.student_id).first()
        roll = st.roll_number if st else "UNKNOWN"
        reason = "admin_reset"

    if binding.status == "REVOKED" and binding.revoked_at is not None:
        return {
            "success": True,
            "status": "REVOKED",
            "message": "Device is already revoked.",
            "device_id": binding.device_id,
            "state": "REVOKED"
        }

    now = datetime.utcnow()
    binding.status = "REVOKED"
    binding.revoked_at = now
    binding.revoked_reason = reason
    db.commit()

    try:
        log_security_audit_event(
            db=db,
            event_type=SecurityEventType.DEVICE_REVOKED,
            action="DEVICE_REVOKED",
            details=f"Device {device_id} for student {roll} was revoked by {current_user.username} ({current_user.role.value})",
            roll_number=roll,
            ip_address=ip_addr
        )
    except Exception:
        pass

    return {
        "success": True,
        "status": "REVOKED",
        "message": "Device identity has been revoked.",
        "device_id": binding.device_id,
        "state": "REVOKED",
        "revoked_at": now.isoformat()
    }
