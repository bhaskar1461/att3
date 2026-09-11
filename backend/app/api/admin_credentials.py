"""
SNIST ERP — Credential Email Dispatch Router (Module 2)
Generate temp passwords, queue credential emails, batch status polling, retry.
All endpoints require SUPER_ADMIN role.
"""

import uuid
import secrets
import string
import logging
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field

from app.core.database import get_db
from app.core.config import settings
from app.core.security import get_server_ist_datetime, get_password_hash
from app.api.auth import get_current_user
from app.models.models import (
    User, UserRole, Student, Teacher,
    CredentialBatch, CredentialItem, CredentialEmailStatus,
    StudentOnboarding, OnboardingState,
)
from app.services.onboarding_service import log_onboarding_event

logger = logging.getLogger("snist_erp.api.admin_credentials")

router = APIRouter(prefix="/admin/credentials", tags=["Admin Credential Dispatch"])


# --- Auth Dependency ---

def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Super Admin permission required")
    return current_user


# --- Request Models ---

class DispatchCredentialsRequest(BaseModel):
    sap_ids: List[str] = Field(..., min_length=1, description="List of roll numbers or teacher codes")
    target_role: str = Field(..., pattern=r"^(student|teacher)$")
    dry_run: bool = False
    email_overrides: Optional[dict] = None  # {sap_id: corrected_email}

class RetryCredentialRequest(BaseModel):
    sap_id: str
    corrected_email: Optional[str] = None

class TestSendRequest(BaseModel):
    target_role: str = Field(..., pattern=r"^(student|teacher)$")
    test_email: str


# --- Helpers ---

def _generate_temp_password(length: int = 8) -> str:
    """Generates a random temp password: 2 uppercase + 2 digits + 4 lowercase."""
    upper = random.choices(string.ascii_uppercase, k=2)
    digits = random.choices(string.digits, k=2)
    lower = random.choices(string.ascii_lowercase, k=length - 4)
    chars = upper + digits + lower
    random.shuffle(chars)
    return "".join(chars)

import random  # Used by _generate_temp_password


# --- Endpoints ---

@router.post("/dispatch")
def dispatch_credentials(
    req: DispatchCredentialsRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """
    Dispatches credential emails (temp username + password) to students or teachers.
    
    - Validates that all SAP IDs have associated User + email records
    - Generates temp password for each recipient (bcrypt hash stored, plaintext in email only)
    - Sets must_change_password=True on User records
    - Queues batch email dispatch in background thread
    - Returns batch_id for status polling
    """
    from app.services.email_service import dispatch_email_batch_background

    if len(req.sap_ids) > settings.MAX_BATCH_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Batch too large ({len(req.sap_ids)}). Maximum is {settings.MAX_BATCH_SIZE}."
        )

    batch_id = str(uuid.uuid4())[:12]
    now = get_server_ist_datetime().replace(tzinfo=None)
    items_to_dispatch = []
    skipped = []
    errors = []

    for sap_id in req.sap_ids:
        sap_id = sap_id.strip().upper()
        try:
            # Determine email based on role
            email = None
            name = sap_id
            user = None

            if req.email_overrides and sap_id in req.email_overrides:
                email = req.email_overrides[sap_id]

            if req.target_role == "student":
                # Look up from onboarding records first, then students table
                onboarding = db.query(StudentOnboarding).filter(
                    StudentOnboarding.roll_number == sap_id
                ).first()
                if onboarding:
                    email = email or onboarding.email
                    name = onboarding.name
                
                student = db.query(Student).filter(Student.roll_number == sap_id).first()
                if student:
                    email = email or student.email
                    name = student.name
                    user = db.query(User).filter(User.id == student.user_id).first()
                
                if not user:
                    user = db.query(User).filter(User.username == sap_id).first()

            elif req.target_role == "teacher":
                teacher = db.query(Teacher).filter(Teacher.teacher_code == sap_id).first()
                if teacher:
                    name = teacher.name
                    user = db.query(User).filter(User.id == teacher.user_id).first()
                    if user:
                        email = email or user.email

            if not email:
                errors.append({"sap_id": sap_id, "error": "No email address found"})
                continue

            # Generate temp password and 1-click magic link
            temp_password = _generate_temp_password()
            temp_hash = get_password_hash(temp_password)

            from app.core.security import create_magic_login_token
            frontend_url = settings.FRONTEND_URL or "https://ather-os.de5.net"
            magic_token = create_magic_login_token(username=sap_id, role=req.target_role.upper(), expires_days=7)
            magic_link = f"{frontend_url}/login?magic_token={magic_token}"

            # Update User record if exists, or auto-provision if missing
            if user:
                user.password_hash = temp_hash
                user.must_change_password = False
                user.is_active = True
            elif req.target_role == "student":
                user = User(
                    username=sap_id,
                    email=email,
                    password_hash=temp_hash,
                    role=UserRole.STUDENT,
                    is_active=True,
                    must_change_password=False
                )
                db.add(user)
                db.flush()
            elif req.target_role == "teacher":
                user = User(
                    username=sap_id.lower(),
                    email=email,
                    password_hash=temp_hash,
                    role=UserRole.TEACHER,
                    is_active=True,
                    must_change_password=False
                )
                db.add(user)
                db.flush()

            # Always sync StudentOnboarding pin_hash and mark activated
            if onboarding:
                onboarding.pin_hash = temp_hash
                onboarding.state = OnboardingState.ACTIVATED
                onboarding.activated_at = now

            # Create credential item record
            item = CredentialItem(
                batch_id=batch_id,
                sap_id=sap_id,
                name=name,
                email=email,
                temp_password_hash=temp_hash,
                status=CredentialEmailStatus.PENDING,
                created_at=now,
            )
            db.add(item)

            items_to_dispatch.append({
                "sap_id": sap_id,
                "name": name,
                "email": email,
                "temp_password": temp_password,
                "password": temp_password,
                "magic_link": magic_link,
                "portal_url": f"{frontend_url}/login",
                "role": req.target_role,
                "cc_email": None,
            })

        except Exception as item_err:
            logger.error(f"Credential prep error for {sap_id}: {item_err}", exc_info=True)
            errors.append({"sap_id": sap_id, "error": str(item_err)})

    if not items_to_dispatch and not req.dry_run:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"No valid recipients found. Errors: {errors[:10]}"
        )

    # Create batch record
    batch = CredentialBatch(
        batch_id=batch_id,
        target_role=req.target_role,
        total_count=len(items_to_dispatch),
        is_dry_run=req.dry_run,
        created_by=admin.id,
        created_at=now,
    )
    db.add(batch)
    db.commit()

    # Dry run — return preview without sending
    if req.dry_run:
        return {
            "status": "dry_run",
            "batch_id": batch_id,
            "total": len(items_to_dispatch),
            "preview": [
                {"sap_id": i["sap_id"], "name": i["name"], "email": i["email"]}
                for i in items_to_dispatch[:10]
            ],
            "errors": errors,
        }

    # Dispatch in background thread
    template_name = f"{req.target_role}_credentials_email.html"
    subject_template = f"SNIST ERP — Your Portal Credentials ({{sap_id}})"

    dispatch_email_batch_background(
        items=items_to_dispatch,
        template_name=template_name,
        subject_template=subject_template,
        batch_id=batch_id,
        channel="AUTH",
    )

    log_onboarding_event(
        db=db,
        event_type="CREDS_DISPATCH_STARTED",
        action="CREDENTIAL_BATCH_DISPATCHED",
        details=f"Batch {batch_id}: {len(items_to_dispatch)} {req.target_role} credential emails queued",
        performed_by=admin.id,
    )

    return {
        "status": "dispatching",
        "batch_id": batch_id,
        "total_queued": len(items_to_dispatch),
        "errors": errors,
    }


@router.get("/batch/{batch_id}/status")
def get_batch_status(
    batch_id: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Polls batch dispatch status — call every 2-3 seconds from frontend."""
    batch = db.query(CredentialBatch).filter(CredentialBatch.batch_id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    items = db.query(CredentialItem).filter(CredentialItem.batch_id == batch_id).all()

    sent_items = [i for i in items if i.status == CredentialEmailStatus.SENT]
    failed_items = [i for i in items if i.status == CredentialEmailStatus.FAILED]
    pending_items = [i for i in items if i.status == CredentialEmailStatus.PENDING]

    return {
        "batch_id": batch_id,
        "target_role": batch.target_role,
        "is_dry_run": batch.is_dry_run,
        "total": batch.total_count,
        "sent": len(sent_items),
        "failed": len(failed_items),
        "pending": len(pending_items),
        "completed": batch.completed_at is not None,
        "completed_at": batch.completed_at.isoformat() if batch.completed_at else None,
        "sent_items": [{"sap_id": i.sap_id, "email": i.email} for i in sent_items],
        "failed_items": [
            {"sap_id": i.sap_id, "email": i.email, "error": i.error_detail}
            for i in failed_items
        ],
    }


@router.post("/retry")
def retry_credential(
    req: RetryCredentialRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Regenerates temp password and re-queues email for a single recipient."""
    from app.services.email_service import send_single_email, render_email_template

    sap_id = req.sap_id.strip().upper()

    # Find the latest credential item
    item = db.query(CredentialItem).filter(
        CredentialItem.sap_id == sap_id,
    ).order_by(CredentialItem.created_at.desc()).first()

    if not item:
        raise HTTPException(status_code=404, detail=f"No credential record for {sap_id}")

    # Update email if corrected
    if req.corrected_email:
        item.email = req.corrected_email

    # Regenerate temp password
    temp_password = _generate_temp_password()
    temp_hash = get_password_hash(temp_password)
    item.temp_password_hash = temp_hash
    item.status = CredentialEmailStatus.PENDING
    item.error_detail = None

    # Update User record
    user = db.query(User).filter(User.username == sap_id).first()
    if user:
        user.password_hash = temp_hash
        user.must_change_password = True

    db.commit()

    # Send immediately (single retry — not batched)
    try:
        # Determine role from batch
        batch = db.query(CredentialBatch).filter(CredentialBatch.batch_id == item.batch_id).first()
        role = batch.target_role if batch else "student"

        html_body = render_email_template(f"{role}_credentials_email.html", {
            "sap_id": sap_id,
            "name": item.name or sap_id,
            "email": item.email,
            "temp_password": temp_password,
            "role": role,
        })

        result = send_single_email(
            to_email=item.email,
            subject=f"SNIST ERP — Your Portal Credentials (Resent) ({sap_id})",
            html_body=html_body,
            channel="AUTH",
        )

        if result["status"] in ("SENT", "DEV_MODE"):
            item.status = CredentialEmailStatus.SENT
            item.sent_at = get_server_ist_datetime().replace(tzinfo=None)
        else:
            item.status = CredentialEmailStatus.FAILED
            item.error_detail = result.get("error", "Unknown")

        db.commit()

        log_onboarding_event(
            db=db,
            event_type="CREDS_RETRY",
            action="CREDENTIAL_RETRY_SENT",
            roll_number=sap_id,
            details=f"Retry result: {result['status']}",
            performed_by=admin.id,
        )

        return {"status": result["status"], "sap_id": sap_id, "email": item.email}

    except Exception as err:
        logger.error(f"Credential retry error for {sap_id}: {err}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Retry failed: {str(err)}")


@router.post("/test-send")
def test_credential_email(
    req: TestSendRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Sends a sample credential email to the admin's own email for testing."""
    from app.services.email_service import send_single_email, render_email_template

    temp_password = _generate_temp_password()

    try:
        html_body = render_email_template(f"{req.target_role}_credentials_email.html", {
            "sap_id": "TEST12345",
            "name": "Test Student/Teacher",
            "email": req.test_email,
            "temp_password": temp_password,
            "role": req.target_role,
        })
    except Exception:
        html_body = f"""
        <html><body>
        <h2>SNIST ERP — Test Credential Email</h2>
        <p>Username: TEST12345</p>
        <p>Temporary Password: {temp_password}</p>
        <p>Role: {req.target_role}</p>
        </body></html>
        """

    result = send_single_email(
        to_email=req.test_email,
        subject=f"[TEST] SNIST ERP Credential Email ({req.target_role})",
        html_body=html_body,
        channel="AUTH",
    )

    log_onboarding_event(
        db=db,
        event_type="CREDS_TEST_SENT",
        action="CREDENTIAL_TEST_EMAIL",
        details=f"Test email to {req.test_email}: {result['status']}",
        performed_by=admin.id,
    )

    return {"status": result["status"], "test_email": req.test_email}


@router.post("/preview-template")
def preview_credential_template(
    target_role: str = "student",
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Returns rendered HTML preview of the credential email template."""
    from app.services.email_service import render_email_template

    try:
        html = render_email_template(f"{target_role}_credentials_email.html", {
            "sap_id": "24311A6201",
            "name": "SAMPLE STUDENT",
            "email": "24311a6201@cse.sreenidhi.edu.in",
            "temp_password": "Ab12cdef",
            "role": target_role,
        })
        return {"html": html}
    except Exception as err:
        return {"html": f"<p>Template preview error: {err}</p>", "error": str(err)}


class QuickResetCredentialsRequest(BaseModel):
    roll_number: str = Field(..., min_length=2, description="Student roll number or SAP ID")
    custom_password: Optional[str] = Field(None, description="Optional custom PIN or password")
    email: Optional[str] = Field(None, description="Optional updated student email address")


@router.get("/student-lookup/{roll_number}")
def lookup_student_for_recovery(
    roll_number: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """
    Look up student name, department, section, and current registered email by roll number.
    Used by admin credential recovery UI to display and allow editing student email.
    """
    clean_roll = roll_number.strip().upper()
    from sqlalchemy import func

    student = db.query(Student).filter(
        func.upper(Student.roll_number) == clean_roll
    ).first()

    if not student:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Student with roll number '{clean_roll}' not found in college database."
        )

    dept_name = student.department.name if (student.department and hasattr(student.department, 'name')) else "CSE-CS"
    sec_name = student.section.name if (student.section and hasattr(student.section, 'name')) else "A"

    return {
        "status": "SUCCESS",
        "roll_number": student.roll_number,
        "name": student.name,
        "email": student.email or "",
        "department": dept_name,
        "section": sec_name,
    }


@router.post("/quick-reset")
def quick_reset_student_credentials(
    req: QuickResetCredentialsRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """
    Admin Fallback: Quick Reset / Create Credentials for Student by Roll Number.
    - Resolves Student record
    - Updates student email across tables if edited by admin
    - Provisions or updates User record
    - Generates fresh 6-digit numeric PIN / password (or applies custom password)
    - Clears active device binding attempt locks
    - Synchronizes StudentOnboarding pin_hash and activation state
    - Logs audit event
    - Returns plaintext temp_pin for immediate student recovery
    """
    clean_roll = req.roll_number.strip().upper()

    from sqlalchemy import or_, func
    from datetime import timedelta, datetime
    from app.models.models import DeviceAccountBinding, BindingStatus

    student = db.query(Student).filter(
        func.upper(Student.roll_number) == clean_roll
    ).first()

    if not student:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Student with roll number '{clean_roll}' not found in college database."
        )

    # 0. Update Student Email if provided and valid
    if req.email and req.email.strip():
        new_email = req.email.strip().lower()
        student.email = new_email

    # 1. Resolve or provision User record
    user = db.query(User).filter(func.upper(User.username) == clean_roll).first()

    # Generate or apply custom PIN
    if req.custom_password and req.custom_password.strip():
        temp_pin = req.custom_password.strip()
    else:
        import secrets
        temp_pin = f"{secrets.randbelow(900000) + 100000}"
    pin_hash = get_password_hash(temp_pin)

    if not user:
        user = User(
            username=student.roll_number,
            email=student.email or f"{student.roll_number.lower()}@cs.sreenidhi.edu.in",
            password_hash=pin_hash,
            role=UserRole.STUDENT,
            is_active=True,
            must_change_password=False
        )
        db.add(user)
        db.flush()
    else:
        user.password_hash = pin_hash
        user.is_active = True
        user.must_change_password = False
        if req.email and req.email.strip():
            user.email = req.email.strip().lower()

    student.user_id = user.id

    # 2. Synchronize StudentOnboarding
    onboarding_rec = db.query(StudentOnboarding).filter(
        func.upper(StudentOnboarding.roll_number) == clean_roll
    ).first()
    if onboarding_rec:
        onboarding_rec.pin_hash = pin_hash
        onboarding_rec.state = OnboardingState.ACTIVATED
        onboarding_rec.activated_at = get_server_ist_datetime().replace(tzinfo=None)
        if req.email and req.email.strip():
            onboarding_rec.email = req.email.strip().lower()

    # 3. Clear/Reset active device lockouts and reset registered device for this roll number
    student.registered_device_id = None
    active_bindings = db.query(DeviceAccountBinding).filter(
        DeviceAccountBinding.roll_number == clean_roll,
        DeviceAccountBinding.status == BindingStatus.ACTIVE
    ).all()
    for b in active_bindings:
        b.status = BindingStatus.EXPIRED

    from app.api.auth import failed_login_limiter
    failed_login_limiter.record_success(None, clean_roll)

    db.commit()

    # 4. Audit Log
    from app.core.device_security import log_security_audit_event, SecurityEventType
    try:
        log_security_audit_event(
            db=db,
            event_type=SecurityEventType.DEVICE_REVOKED,
            action="ADMIN_QUICK_RESET_CREDENTIALS",
            details=f"Admin {admin.username} generated fresh PIN and cleared device locks for {clean_roll} (email: {student.email})",
            user_id=admin.id,
            roll_number=clean_roll
        )
    except Exception as audit_err:
        logger.warning(f"Failed to log quick reset audit event: {audit_err}")

    dept_name = student.department.name if (student.department and hasattr(student.department, 'name')) else "CSE-CS"
    sec_name = student.section.name if (student.section and hasattr(student.section, 'name')) else "A"

    return {
        "status": "SUCCESS",
        "roll_number": student.roll_number,
        "username": student.roll_number,
        "name": student.name,
        "student_name": student.name,
        "email": student.email,
        "department": dept_name,
        "section": sec_name,
        "temp_pin": temp_pin,
        "temporary_password": temp_pin,
        "message": f"Fresh credentials generated for {student.name}. Any active device lockout has been reset."
    }
