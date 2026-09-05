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

            # Generate temp password
            temp_password = _generate_temp_password()
            temp_hash = get_password_hash(temp_password)

            # Update User record if exists
            if user:
                user.password_hash = temp_hash
                user.must_change_password = True

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
