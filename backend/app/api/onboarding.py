"""
SNIST ERP — Public Onboarding Router
Endpoints for the student onboarding wizard (magic link → OTP → PIN → device bind → activate).
No auth required — the magic link token IS the authentication for initial access.
"""

import logging
from typing import Optional
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field

from app.core.database import get_db
from app.core.security import get_server_ist_datetime
from app.models.models import StudentOnboarding, OnboardingState
from app.services.onboarding_service import (
    verify_magic_token,
    generate_otp,
    verify_otp,
    set_student_pin,
    activate_student,
    create_onboarding_session_token,
    decode_onboarding_session_token,
    log_onboarding_event,
)

logger = logging.getLogger("snist_erp.api.onboarding")

router = APIRouter(prefix="/onboard", tags=["Student Onboarding"])


# --- Request/Response Models ---

class VerifyTokenRequest(BaseModel):
    token: str = Field(..., min_length=10, description="Magic link raw token from URL")

class RequestOTPRequest(BaseModel):
    session_token: str = Field(..., description="Onboarding session JWT from verify-token step")

class VerifyOTPRequest(BaseModel):
    session_token: str
    otp_code: str = Field(..., min_length=6, max_length=6, pattern=r"^\d{6}$")

class SetPinRequest(BaseModel):
    session_token: str
    pin: str = Field(..., min_length=4, max_length=6, pattern=r"^\d{4,6}$")

class ActivateRequest(BaseModel):
    session_token: str
    device_uuid: str = Field(..., min_length=8, description="Device public UUID from browser")
    consent: bool = Field(..., description="Student consent to attendance policy")

class ResendLinkRequest(BaseModel):
    roll_number: str = Field(..., min_length=5)
    email: str = Field(..., min_length=5)


# --- Helpers ---

def _get_client_ip(request: Request) -> str:
    """Extracts client IP from request, respecting X-Forwarded-For."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _validate_session_token(session_token: str, db: Session) -> StudentOnboarding:
    """Validates an onboarding session JWT and returns the onboarding record."""
    payload = decode_onboarding_session_token(session_token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired onboarding session. Please restart the onboarding process."
        )

    onboarding_id = payload.get("onboarding_id")
    if not onboarding_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Malformed session token.")

    onboarding = db.query(StudentOnboarding).filter(StudentOnboarding.id == onboarding_id).first()
    if not onboarding:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Onboarding record not found.")

    if onboarding.state == OnboardingState.ACTIVATED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Account is already activated.")

    if onboarding.state == OnboardingState.SUSPENDED:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account has been suspended.")

    return onboarding


# --- Endpoints ---

@router.post("/verify-token")
def verify_onboarding_token(
    req: VerifyTokenRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Step 1: Validates magic link token and returns pre-filled student details.
    Transitions state to LINK_OPENED.
    Returns an onboarding session JWT for gating subsequent wizard steps.
    """
    client_ip = _get_client_ip(request)

    onboarding, error = verify_magic_token(db, req.token, ip_address=client_ip)

    if error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error)

    # Create short-lived session token (30 min) for wizard steps
    session_token = create_onboarding_session_token(onboarding.id, onboarding.roll_number)

    return {
        "status": "ok",
        "session_token": session_token,
        "student": {
            "roll_number": onboarding.roll_number,
            "name": onboarding.name,
            "email": onboarding.email,
            "department": onboarding.department,
            "section": onboarding.section,
            "academic_year": onboarding.academic_year,
            "gender": onboarding.gender,
        },
        "state": onboarding.state.value,
        "otp_verified": onboarding.mobile_verified,
        "pin_set": bool(onboarding.pin_hash),
    }


@router.post("/request-otp")
def request_otp(
    req: RequestOTPRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Step 2a: Sends email OTP to the student's college email.
    Rate limited: max 5 requests per hour per onboarding record.
    """
    client_ip = _get_client_ip(request)
    onboarding = _validate_session_token(req.session_token, db)

    if not onboarding.email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No email address configured for this student. Contact your coordinator."
        )

    success, message = generate_otp(
        db=db,
        onboarding_id=onboarding.id,
        email=onboarding.email,
        ip_address=client_ip,
    )

    if not success:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=message)

    return {"status": "ok", "message": message, "email_hint": _mask_email(onboarding.email)}


@router.post("/verify-otp")
def verify_otp_endpoint(
    req: VerifyOTPRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Step 2b: Verifies the 6-digit OTP code.
    Max 5 attempts per OTP. After 5 failures, a new OTP must be requested.
    """
    client_ip = _get_client_ip(request)
    onboarding = _validate_session_token(req.session_token, db)

    success, message = verify_otp(
        db=db,
        onboarding_id=onboarding.id,
        otp_code=req.otp_code,
        ip_address=client_ip,
    )

    if not success:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)

    return {"status": "ok", "message": message, "otp_verified": True}


@router.post("/set-pin")
def set_pin_endpoint(
    req: SetPinRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Step 3: Sets the student's 4-6 digit numeric PIN for daily login.
    Requires OTP verification first.
    """
    client_ip = _get_client_ip(request)
    onboarding = _validate_session_token(req.session_token, db)

    if not onboarding.mobile_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Please verify your email OTP before setting a PIN."
        )

    success, message = set_student_pin(
        db=db,
        onboarding_id=onboarding.id,
        pin=req.pin,
        ip_address=client_ip,
    )

    if not success:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)

    return {"status": "ok", "message": message, "pin_set": True}


@router.post("/activate")
def activate_student_endpoint(
    req: ActivateRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Step 4 & 5: Captures device UUID, binds device, and activates the student account.
    Creates User + Student records. Transitions state to ACTIVATED.
    """
    client_ip = _get_client_ip(request)

    if not req.consent:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You must consent to the attendance policy to activate your account."
        )

    onboarding = _validate_session_token(req.session_token, db)

    if not onboarding.mobile_verified:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="OTP verification required.")

    if not onboarding.pin_hash:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="PIN must be set before activation.")

    success, message, user_data = activate_student(
        db=db,
        onboarding_id=onboarding.id,
        device_uuid=req.device_uuid,
        ip_address=client_ip,
    )

    if not success:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)

    return {
        "status": "ok",
        "message": message,
        "activated": True,
        "user": user_data,
    }


@router.get("/status/{roll_number}")
def get_onboarding_status(
    roll_number: str,
    db: Session = Depends(get_db),
):
    """
    Public status check — returns minimal onboarding state for a given roll number.
    Does not expose sensitive data.
    """
    onboarding = db.query(StudentOnboarding).filter(
        StudentOnboarding.roll_number == roll_number.upper().strip()
    ).first()

    if not onboarding:
        return {"found": False, "state": None}

    return {
        "found": True,
        "state": onboarding.state.value,
        "activated": onboarding.state == OnboardingState.ACTIVATED,
    }


# --- Utility ---

def _mask_email(email: str) -> str:
    """Masks an email for display: 'abc@domain.com' -> 'a**@domain.com'"""
    try:
        local, domain = email.split("@")
        if len(local) <= 2:
            masked = local[0] + "*" * (len(local) - 1)
        else:
            masked = local[0] + "*" * (len(local) - 2) + local[-1]
        return f"{masked}@{domain}"
    except Exception:
        return "***@***"
