"""
SNIST ERP — Admin Onboarding Management Router
Excel import, magic link dispatch, onboarding status, device rebind approval.
All endpoints require SUPER_ADMIN role.
"""

import uuid
import logging
from typing import Optional, List
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, Form, status
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field

from app.core.database import get_db
from app.core.config import settings
from app.core.security import get_server_ist_datetime
from app.api.auth import get_current_user
from app.models.models import (
    User, UserRole, Student, StudentOnboarding, OnboardingState,
    DeviceRebindRequest, RebindRequestStatus, OnboardingAuditLog,
)
from app.services.onboarding_service import generate_magic_token, log_onboarding_event

logger = logging.getLogger("snist_erp.api.admin_onboarding")

router = APIRouter(prefix="/admin/onboard", tags=["Admin Onboarding Management"])


# --- Auth Dependency ---

def require_admin(current_user: User = Depends(get_current_user)) -> User:
    """Requires SUPER_ADMIN role — follows existing admin.py pattern."""
    if current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Super Admin permission required")
    return current_user


# --- Request/Response Models ---

class DispatchLinksRequest(BaseModel):
    roll_numbers: Optional[List[str]] = None  # If None, dispatch to all PENDING_ONBOARDING
    section_id: Optional[int] = None
    department_id: Optional[int] = None

class ResendLinkRequest(BaseModel):
    reason: Optional[str] = None

class RebindDecisionRequest(BaseModel):
    reason: Optional[str] = None


# --- Endpoints ---

@router.post("/import-excel")
async def import_onboarding_excel(
    request: Request,
    file: UploadFile = File(...),
    department_code: Optional[str] = Form("CSE-CS"),
    department_id: Optional[int] = Form(1),
    academic_year_id: Optional[int] = Form(1),
    academic_year_name: Optional[str] = Form("III - I"),
    section_id: Optional[int] = Form(1),
    email_pattern: Optional[str] = Form("{roll}@cs.sreenidhi.edu.in", description="e.g. {roll}@cse.sreenidhi.edu.in"),
    class_incharge_email: Optional[str] = Form(None, description="Class in-charge email address"),
    dry_run: bool = Form(False),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    department_code = (department_code or "CSE-CS").strip() or "CSE-CS"
    department_id = int(department_id or 1)
    academic_year_id = int(academic_year_id or 1)
    academic_year_name = (academic_year_name or "III - I").strip() or "III - I"
    section_id = int(section_id or 1)
    email_pattern = (email_pattern or "{roll}@cs.sreenidhi.edu.in").strip() or "{roll}@cs.sreenidhi.edu.in"
    class_incharge_email = (class_incharge_email or "").strip()

    """
    Upload Excel file (CSE-CS III-I format) to create onboarding records.
    
    Excel format expected:
    - Row 6: Headers (SNO, ROLL NO, NAME, GENDER, SECTION, ...)
    - Row 7+: Student data
    - Columns: A=SNO, B=ROLL NO, C=NAME, D=GENDER, E=SECTION
    
    The admin provides:
    - email_pattern: e.g. "{roll}@cse.sreenidhi.edu.in" → replaces {roll} with lowercase roll number
    - class_incharge_email: Class in-charge faculty email (receives dedicated class allotment and timetable notification; strictly NEVER CC'd on student emails to prevent inbox flooding)
    - dry_run: if True, parses and validates but does NOT create records
    """
    import_batch_ref = str(uuid.uuid4())[:8]
    
    try:
        import openpyxl
        from io import BytesIO

        content = await file.read()
        wb = openpyxl.load_workbook(BytesIO(content), data_only=True)
        ws = wb.active

        # Parse student rows (data starts at row 7 in CSE-CS format)
        students_parsed = []
        errors = []
        
        # Auto-detect header row (look for "ROLL NO" or "ROLL" in first 10 rows)
        header_row = 6  # Default for CSE-CS format
        for r in range(1, 11):
            row_vals = [str(ws.cell(row=r, column=c).value or "").upper().strip() for c in range(1, 7)]
            if any("ROLL" in v for v in row_vals):
                header_row = r
                break
        
        data_start_row = header_row + 1

        for row_idx in range(data_start_row, ws.max_row + 1):
            sno = ws.cell(row=row_idx, column=1).value
            roll_number = ws.cell(row=row_idx, column=2).value
            name = ws.cell(row=row_idx, column=3).value
            gender = ws.cell(row=row_idx, column=4).value
            section_letter = ws.cell(row=row_idx, column=5).value

            # Skip empty rows
            if not roll_number or not name:
                continue

            roll_number = str(roll_number).strip().upper()
            name = str(name).strip().title()
            gender = str(gender).strip() if gender else None
            section_letter = str(section_letter).strip() if section_letter else None

            # Validate roll number format (basic check)
            if len(roll_number) < 6:
                errors.append({"row": row_idx, "roll": roll_number, "error": "Roll number too short"})
                continue

            # Generate email from pattern
            email = email_pattern.replace("{roll}", roll_number.lower()).replace("{ROLL}", roll_number.upper())

            students_parsed.append({
                "roll_number": roll_number,
                "name": name,
                "email": email,
                "gender": gender,
                "section": section_letter,
                "row": row_idx,
            })

        if not students_parsed:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"No valid student records found in Excel. Header row detected at row {header_row}. Errors: {errors[:5]}"
            )

        # --- Dry Run: return parsed data without creating records ---
        if dry_run:
            return {
                "status": "dry_run",
                "batch_ref": import_batch_ref,
                "total_parsed": len(students_parsed),
                "errors": errors[:20],
                "preview": students_parsed[:10],
                "email_pattern": email_pattern,
                "class_incharge": class_incharge_email,
            }

        # --- Create onboarding records ---
        created = 0
        skipped = 0
        
        for s in students_parsed:
            # Check if onboarding record already exists
            existing = db.query(StudentOnboarding).filter(
                StudentOnboarding.roll_number == s["roll_number"]
            ).first()

            # Also ensure academic Student record exists so teachers can see all enrolled students
            student_rec = db.query(Student).filter(Student.roll_number == s["roll_number"]).first()
            if not student_rec:
                user_rec = db.query(User).filter(User.username == s["roll_number"]).first()
                student_rec = Student(
                    user_id=user_rec.id if user_rec else None,
                    roll_number=s["roll_number"],
                    name=s["name"],
                    department_id=department_id or 1,
                    academic_year_id=academic_year_id or 1,
                    section_id=section_id or 1,
                    email=s["email"],
                    agency="Regular"
                )
                db.add(student_rec)
                db.flush()
            else:
                student_rec.name = s["name"]
                student_rec.email = s["email"]
                if section_id:
                    student_rec.section_id = section_id
                if department_id:
                    student_rec.department_id = department_id
                if academic_year_id:
                    student_rec.academic_year_id = academic_year_id

            if existing:
                # Skip if already activated; update if still pending
                if existing.state == OnboardingState.ACTIVATED:
                    skipped += 1
                    continue
                # Update existing pending record with new batch data
                existing.name = s["name"]
                existing.email = s["email"]
                existing.gender = s["gender"]
                existing.section = s["section"]
                existing.department = department_code
                existing.department_id = department_id
                existing.academic_year_id = academic_year_id
                existing.academic_year = academic_year_name
                existing.section_id = section_id
                existing.class_incharge_email = class_incharge_email
                existing.import_batch_ref = import_batch_ref
                existing.student_id = student_rec.id
                created += 1
            else:
                record = StudentOnboarding(
                    roll_number=s["roll_number"],
                    name=s["name"],
                    email=s["email"],
                    gender=s["gender"],
                    section=s["section"],
                    department=department_code,
                    department_id=department_id,
                    academic_year_id=academic_year_id,
                    academic_year=academic_year_name,
                    section_id=section_id,
                    class_incharge_email=class_incharge_email,
                    state=OnboardingState.PENDING_ONBOARDING,
                    import_batch_ref=import_batch_ref,
                    student_id=student_rec.id,
                    created_at=get_server_ist_datetime().replace(tzinfo=None),
                )
                db.add(record)
                created += 1

        db.commit()

        # If class in-charge email is provided, notify faculty of new student roster & class allotment
        teacher_notified = None
        if class_incharge_email and not dry_run:
            from app.services.email_service import send_teacher_class_allotment_notification
            t_res = send_teacher_class_allotment_notification(
                db=db,
                teacher_email=class_incharge_email,
                section_id=section_id,
                department_code=department_code,
                student_count=created,
                frontend_url=settings.FRONTEND_URL,
                trigger_context="IMPORT",
            )
            if t_res.get("status") in ("SENT", "DEV_MODE"):
                teacher_notified = class_incharge_email

        # Audit
        log_onboarding_event(
            db=db,
            event_type="BULK_IMPORT",
            action="EXCEL_IMPORT_COMPLETED",
            details=f"Batch {import_batch_ref}: {created} created/updated, {skipped} skipped (activated), {len(errors)} errors. File: {file.filename}" + (f", notified in-charge {teacher_notified}" if teacher_notified else ""),
            performed_by=admin.id,
        )

        return {
            "status": "success",
            "batch_ref": import_batch_ref,
            "created": created,
            "skipped": skipped,
            "teacher_notified": teacher_notified,
            "errors": errors[:20],
            "total_parsed": len(students_parsed),
        }

    except HTTPException:
        raise
    except Exception as err:
        logger.error(f"Excel import error: {err}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process Excel file: {str(err)}"
        )


@router.post("/dispatch-links")
def dispatch_magic_links(
    req: DispatchLinksRequest,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """
    Generates magic link tokens and dispatches emails to students in PENDING_ONBOARDING state.
    Batch processing with per-item error boundary.
    """
    import threading
    from app.services.email_service import send_single_email, render_email_template

    # Build query for target students
    query = db.query(StudentOnboarding).filter(
        StudentOnboarding.state.in_([OnboardingState.PENDING_ONBOARDING, OnboardingState.EXPIRED])
    )

    if req.roll_numbers:
        query = query.filter(StudentOnboarding.roll_number.in_([r.upper() for r in req.roll_numbers]))
    if req.section_id:
        query = query.filter(StudentOnboarding.section_id == req.section_id)
    if req.department_id:
        query = query.filter(StudentOnboarding.department_id == req.department_id)

    targets = query.all()

    if not targets:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No pending students found matching the criteria."
        )

    if len(targets) > settings.MAX_BATCH_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Batch too large ({len(targets)}). Maximum is {settings.MAX_BATCH_SIZE}."
        )

    # Determine frontend URL
    frontend_url = settings.FRONTEND_URL
    if not frontend_url:
        host = request.headers.get("host", "localhost:8000")
        scheme = request.headers.get("x-forwarded-proto", "https")
        frontend_url = f"{scheme}://{host}"

    # Generate tokens and queue emails (synchronous for now — batch ≤ 500)
    dispatched = 0
    failed = 0
    results = []

    import secrets
    from sqlalchemy import func
    from app.core.security import get_password_hash

    for onboarding in targets:
        try:
            clean_roll = onboarding.roll_number.strip().upper()
            from app.core.security import create_magic_login_token
            magic_token = create_magic_login_token(username=clean_roll, role="STUDENT", expires_days=7)
            magic_login_link = f"{frontend_url}/login?magic_token={magic_token}"
            login_link = f"{frontend_url}/login?ref=onboarding"

            # Always generate a fresh PIN so student has valid credentials in email
            temp_pin = f"{secrets.randbelow(900000) + 100000}"
            pin_hash = get_password_hash(temp_pin)
            onboarding.pin_hash = pin_hash
            
            # Sync / provision User record
            user_rec = db.query(User).filter(func.upper(User.username) == clean_roll).first()
            if not user_rec:
                user_rec = User(
                    username=clean_roll,
                    email=onboarding.email or f"{clean_roll.lower()}@cs.sreenidhi.edu.in",
                    password_hash=pin_hash,
                    role=UserRole.STUDENT,
                    is_active=True,
                    must_change_password=False
                )
                db.add(user_rec)
                db.flush()
            else:
                user_rec.password_hash = pin_hash
                user_rec.is_active = True

            # Render email with permanent login link and 1-click magic link
            try:
                html_body = render_email_template("magic_link_email.html", {
                    "student_name": onboarding.name,
                    "roll_number": clean_roll,
                    "magic_link": magic_login_link,
                    "login_link": login_link,
                    "temp_pin": temp_pin,
                    "pin": temp_pin,
                    "password": temp_pin,
                    "temp_password": temp_pin,
                    "department": onboarding.department,
                    "section": onboarding.section,
                })
            except Exception:
                html_body = f"""
                <html><body>
                <h2>SNIST ERP — Student Portal Access</h2>
                <p>Dear {onboarding.name} ({clean_roll}),</p>
                <p>Your student portal account is ready. Sign in with 1-click:</p>
                <p><a href="{magic_login_link}" style="display: inline-block; padding: 12px 24px; background: #059669; color: #fff; text-decoration: none; border-radius: 6px; font-weight: bold;">Instant 1-Click Sign-In →</a></p>
                <p>Or log in manually at <a href="{login_link}">{login_link}</a> using:</p>
                <p><strong>Roll Number:</strong> {clean_roll}</p>
                <p><strong>Login PIN:</strong> <strong style="font-size: 20px; color: #059669;">{temp_pin}</strong></p>
                <p style="color: #999;">Sreenidhi Institute of Science & Technology</p>
                </body></html>
                """

            result = send_single_email(
                to_email=onboarding.email,
                subject=f"SNIST — Student Portal Access Credentials ({onboarding.roll_number})",
                html_body=html_body,
                cc=None,  # Anti-Spam: strictly NEVER CC class in-charge on individual student emails
            )

            if result["status"] in ("SENT", "DEV_MODE"):
                onboarding.state = OnboardingState.LINK_SENT
                onboarding.link_sent_at = get_server_ist_datetime().replace(tzinfo=None)
                dispatched += 1
                results.append({"roll": onboarding.roll_number, "status": "sent"})
            else:
                failed += 1
                results.append({"roll": onboarding.roll_number, "status": "failed", "error": result.get("error", "")})

        except Exception as item_err:
            logger.error(f"Magic link dispatch error for {onboarding.roll_number}: {item_err}", exc_info=True)
            failed += 1
            results.append({"roll": onboarding.roll_number, "status": "failed", "error": str(item_err)})

    db.commit()

    # Notify class in-charge(s) with dedicated class schedule allotment email
    from app.services.email_service import send_teacher_class_allotment_notification
    distinct_incharges = set()
    for ob in targets:
        if ob.class_incharge_email and ob.class_incharge_email.strip():
            distinct_incharges.add(ob.class_incharge_email.strip())

    teacher_notified_list = []
    for incharge_email in distinct_incharges:
        t_res = send_teacher_class_allotment_notification(
            db=db,
            teacher_email=incharge_email,
            section_id=req.section_id or (targets[0].section_id if targets else None),
            section_name=targets[0].section if targets else None,
            department_code=targets[0].department if targets else None,
            student_count=dispatched or len(targets),
            frontend_url=frontend_url,
            trigger_context="DISPATCH",
        )
        if t_res.get("status") in ("SENT", "DEV_MODE"):
            teacher_notified_list.append(incharge_email)

    log_onboarding_event(
        db=db,
        event_type="BULK_DISPATCH",
        action="MAGIC_LINKS_DISPATCHED",
        details=f"Dispatched {dispatched} magic links, {failed} failures, notified {len(teacher_notified_list)} in-charge faculty",
        performed_by=admin.id,
    )

    return {
        "status": "success",
        "dispatched": dispatched,
        "failed": failed,
        "total": len(targets),
        "teacher_notified": teacher_notified_list,
        "results": results[:50],
    }


@router.get("/status")
def get_onboarding_status_table(
    state: Optional[str] = None,
    section_id: Optional[int] = None,
    department_id: Optional[int] = None,
    batch_ref: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Paginated onboarding status table with filters."""
    query = db.query(StudentOnboarding)

    if state:
        try:
            state_enum = OnboardingState(state)
            query = query.filter(StudentOnboarding.state == state_enum)
        except ValueError:
            pass
    if section_id:
        query = query.filter(StudentOnboarding.section_id == section_id)
    if department_id:
        query = query.filter(StudentOnboarding.department_id == department_id)
    if batch_ref:
        query = query.filter(StudentOnboarding.import_batch_ref == batch_ref)

    total = query.count()
    records = query.order_by(StudentOnboarding.created_at.desc()).offset(
        (page - 1) * page_size
    ).limit(page_size).all()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "students": [
            {
                "id": r.id,
                "roll_number": r.roll_number,
                "name": r.name,
                "email": r.email,
                "department": r.department,
                "section": r.section,
                "state": r.state.value if r.state else None,
                "link_sent_at": r.link_sent_at.isoformat() if r.link_sent_at else None,
                "link_opened_at": r.link_opened_at.isoformat() if r.link_opened_at else None,
                "activated_at": r.activated_at.isoformat() if r.activated_at else None,
                "otp_verified": r.mobile_verified,
                "pin_set": bool(r.pin_hash),
                "device_uuid": r.device_uuid[:16] + "..." if r.device_uuid else None,
                "rebind_count": r.rebind_count,
                "batch_ref": r.import_batch_ref,
            }
            for r in records
        ],
    }


@router.get("/status/{roll_number}")
def get_individual_onboarding_status(
    roll_number: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Detailed individual student onboarding status."""
    record = db.query(StudentOnboarding).filter(
        StudentOnboarding.roll_number == roll_number.upper().strip()
    ).first()

    if not record:
        raise HTTPException(status_code=404, detail=f"No onboarding record for {roll_number}")

    # Get audit trail
    audit = db.query(OnboardingAuditLog).filter(
        OnboardingAuditLog.roll_number == roll_number.upper().strip()
    ).order_by(OnboardingAuditLog.created_at.desc()).limit(20).all()

    return {
        "student": {
            "id": record.id,
            "roll_number": record.roll_number,
            "name": record.name,
            "email": record.email,
            "department": record.department,
            "section": record.section,
            "academic_year": record.academic_year,
            "gender": record.gender,
            "state": record.state.value,
            "mobile_number": record.mobile_number,
            "mobile_verified": record.mobile_verified,
            "pin_set": bool(record.pin_hash),
            "device_uuid": record.device_uuid,
            "link_sent_at": record.link_sent_at.isoformat() if record.link_sent_at else None,
            "link_opened_at": record.link_opened_at.isoformat() if record.link_opened_at else None,
            "activated_at": record.activated_at.isoformat() if record.activated_at else None,
            "rebind_count": record.rebind_count,
            "class_incharge_email": record.class_incharge_email,
        },
        "audit_trail": [
            {
                "event_type": a.event_type,
                "action": a.action,
                "details": a.details,
                "ip": a.ip_address,
                "timestamp": a.created_at.isoformat() if a.created_at else None,
            }
            for a in audit
        ],
    }


def require_admin_or_teacher(current_user: User = Depends(get_current_user)) -> User:
    """Requires SUPER_ADMIN or TEACHER role for student onboarding and credential management."""
    if current_user.role not in (UserRole.SUPER_ADMIN, UserRole.TEACHER):
        raise HTTPException(status_code=403, detail="Faculty or Administrative permission required")
    return current_user


@router.post("/resend/{roll_number}")
def resend_magic_link(
    roll_number: str,
    request: Request,
    req: Optional[ResendLinkRequest] = None,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin_or_teacher),
):
    """
    Re-sends the onboarding / welcome email anytime, for any state (activated students included).
    Sends the permanent login link (https://ather-os.de5.net/login) and PIN instructions.
    Logs audit event to qr_audit_logs.
    """
    from app.services.email_service import send_single_email, render_email_template
    from app.core.device_security import record_audit_log
    from sqlalchemy import func

    clean_roll = roll_number.upper().strip()
    record = db.query(StudentOnboarding).filter(
        func.upper(StudentOnboarding.roll_number) == clean_roll
    ).first()

    if not record:
        raise HTTPException(status_code=404, detail=f"No onboarding record for {clean_roll}")

    frontend_url = settings.FRONTEND_URL
    if not frontend_url:
        host = request.headers.get("host", "localhost:8000")
        scheme = request.headers.get("x-forwarded-proto", "https")
        frontend_url = f"{scheme}://{host}"

    # Generate 1-click magic link and permanent login link
    from app.core.security import create_magic_login_token, get_password_hash
    from app.models.models import DeviceAccountBinding, BindingStatus
    from app.api.auth import failed_login_limiter
    import secrets

    magic_token = create_magic_login_token(username=clean_roll, role="STUDENT", expires_days=7)
    magic_login_link = f"{frontend_url}/login?magic_token={magic_token}"
    login_link = f"{frontend_url}/login?ref=onboarding"

    # Always ensure a valid PIN / password exists and is provided in the email
    temp_pin = f"{secrets.randbelow(900000) + 100000}"
    pin_hash = get_password_hash(temp_pin)
    record.pin_hash = pin_hash

    user_rec = db.query(User).filter(func.upper(User.username) == clean_roll).first()
    if user_rec:
        user_rec.password_hash = pin_hash
        user_rec.is_active = True
    else:
        user_rec = User(
            username=record.roll_number,
            email=record.email or f"{record.roll_number.lower()}@cs.sreenidhi.edu.in",
            password_hash=pin_hash,
            role=UserRole.STUDENT,
            is_active=True,
            must_change_password=False
        )
        db.add(user_rec)

    # Clear/expire active 30-minute device lockouts and failed login attempts for this student
    active_bindings = db.query(DeviceAccountBinding).filter(
        DeviceAccountBinding.roll_number == clean_roll,
        DeviceAccountBinding.status == BindingStatus.ACTIVE
    ).all()
    for b in active_bindings:
        b.status = BindingStatus.EXPIRED
    failed_login_limiter.record_success(None, clean_roll)

    # Send email
    try:
        html_body = render_email_template("magic_link_email.html", {
            "student_name": record.name,
            "roll_number": clean_roll,
            "magic_link": magic_login_link,
            "login_link": login_link,
            "temp_pin": temp_pin,
            "pin": temp_pin,
            "password": temp_pin,
            "temp_password": temp_pin,
            "department": record.department,
            "section": record.section,
        })
    except Exception:
        html_body = f"""
        <html><body>
        <h2>SNIST ERP — Student Portal Access</h2>
        <p>Dear {record.name} ({clean_roll}),</p>
        <p>Your student portal account is ready. Sign in with 1-click:</p>
        <p><a href="{magic_login_link}" style="display: inline-block; padding: 12px 24px; background: #059669; color: #fff; text-decoration: none; border-radius: 6px; font-weight: bold;">Instant 1-Click Sign-In →</a></p>
        <p>Or log in manually at <a href="{login_link}">{login_link}</a> using:</p>
        <p><strong>Roll Number:</strong> {clean_roll}</p>
        <p><strong>Login PIN:</strong> <strong style="font-size: 20px; color: #059669;">{temp_pin}</strong></p>
        <p style="color: #999;">Sreenidhi Institute of Science & Technology</p>
        </body></html>
        """

    result = send_single_email(
        to_email=record.email,
        subject=f"SNIST — Student Portal Access ({clean_roll})",
        html_body=html_body,
        cc=None,  # Anti-Spam: strictly NEVER CC class in-charge
    )

    # Update state & timestamp (Student is immediately active)
    record.link_sent_at = get_server_ist_datetime().replace(tzinfo=None)
    record.state = OnboardingState.ACTIVATED
    record.activated_at = get_server_ist_datetime().replace(tzinfo=None)
    db.commit()

    # Log to qr_audit_logs per Hard Rules
    record_audit_log(
        db=db,
        user_id=admin.id,
        roll_number=clean_roll,
        event_type="ONBOARDING",
        action="RESEND_WELCOME_EMAIL",
        details=f"Staff/Admin {admin.username} resent welcome email to {clean_roll} ({record.email})",
        ip_address=request.client.host if request.client else None
    )

    return {
        "status": "ok",
        "roll_number": record.roll_number,
        "email_result": result["status"],
        "is_activated": True,
    }


@router.post("/reset-pin/{roll_number}")
def reset_student_pin(
    roll_number: str,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin_or_teacher),
):
    """
    Admin-triggered PIN reset:
    - Generates fresh 6-digit numeric PIN
    - Hashes with bcrypt and syncs to User and StudentOnboarding
    - Clears active 30-minute device lockouts and rate limiter
    - Emails new PIN and 1-click magic link to student
    - Writes audit record to qr_audit_logs
    """
    import secrets
    from sqlalchemy import func
    from app.core.security import get_password_hash, create_magic_login_token
    from app.services.email_service import send_single_email, render_email_template
    from app.core.device_security import record_audit_log
    from app.models.models import DeviceAccountBinding, BindingStatus
    from app.api.auth import failed_login_limiter

    clean_roll = roll_number.upper().strip()
    record = db.query(StudentOnboarding).filter(
        func.upper(StudentOnboarding.roll_number) == clean_roll
    ).first()

    if not record:
        raise HTTPException(status_code=404, detail=f"No student onboarding record found for {clean_roll}")

    # Generate fresh 6-digit numeric PIN
    new_pin = f"{secrets.randbelow(900000) + 100000}"
    pin_hash = get_password_hash(new_pin)

    # 1. Resolve or provision User record
    user = db.query(User).filter(func.upper(User.username) == clean_roll).first()
    student_rec = db.query(Student).filter(func.upper(Student.roll_number) == clean_roll).first()

    if not user:
        user = User(
            username=clean_roll,
            email=record.email or f"{clean_roll.lower()}@cs.sreenidhi.edu.in",
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

    if student_rec:
        student_rec.user_id = user.id
        student_rec.registered_device_id = None

    # 2. Update StudentOnboarding record
    record.pin_hash = pin_hash
    record.state = OnboardingState.ACTIVATED
    record.activated_at = get_server_ist_datetime().replace(tzinfo=None)

    # 3. Clear/expire active 30-minute device lockouts and rate limiter for this roll number
    active_bindings = db.query(DeviceAccountBinding).filter(
        DeviceAccountBinding.roll_number == clean_roll,
        DeviceAccountBinding.status == BindingStatus.ACTIVE
    ).all()
    for b in active_bindings:
        b.status = BindingStatus.EXPIRED

    failed_login_limiter.record_success(None, clean_roll)
    db.commit()

    # 4. Dispatch Email with new PIN, 1-click magic link and permanent login link
    frontend_url = settings.FRONTEND_URL
    if not frontend_url:
        host = request.headers.get("host", "localhost:8000")
        scheme = request.headers.get("x-forwarded-proto", "https")
        frontend_url = f"{scheme}://{host}"
    login_url = f"{frontend_url}/login"
    magic_token = create_magic_login_token(username=clean_roll, role="STUDENT", expires_days=7)
    magic_login_url = f"{frontend_url}/login?magic_token={magic_token}"

    try:
        html_body = render_email_template("student_credentials_email.html", {
            "name": record.name,
            "sap_id": clean_roll,
            "username": clean_roll,
            "temp_password": new_pin,
            "password": new_pin,
            "magic_link": magic_login_url,
            "portal_url": login_url,
        })
    except Exception as tmpl_err:
        logger.warning(f"Failed to render student_credentials_email: {tmpl_err}")
        html_body = f"""
        <html><body>
        <p>Dear {record.name},</p>
        <p>Your SNIST ERP login PIN has been reset: <strong style="font-size: 20px; color: #059669;">{new_pin}</strong></p>
        <p><a href="{magic_login_url}" style="display: inline-block; padding: 12px 24px; background: #059669; color: #fff; text-decoration: none; border-radius: 6px; font-weight: bold;">Instant 1-Click Sign-In →</a></p>
        <p>Or login manually: <a href='{login_url}'>{login_url}</a></p>
        </body></html>
        """

    email_res = send_single_email(
        to_email=record.email,
        subject=f"SNIST — Your Student Portal PIN has been reset ({clean_roll})",
        html_body=html_body,
        cc=None,
    )

    # 5. Record Audit Log in qr_audit_logs
    record_audit_log(
        db=db,
        user_id=admin.id,
        roll_number=clean_roll,
        event_type="SECURITY_EVENT",
        action="ADMIN_PIN_RESET",
        details=f"Staff/Admin {admin.username} reset PIN for {clean_roll} and dispatched email to {record.email}",
        ip_address=request.client.host if request.client else None
    )

    return {
        "status": "success",
        "roll_number": clean_roll,
        "email": record.email,
        "temp_pin": new_pin,
        "email_status": email_res.get("status")
    }


@router.get("/login-link/{roll_number}")
def get_student_login_link(
    roll_number: str,
    request: Request,
    admin: User = Depends(require_admin_or_teacher),
):
    """
    Returns the permanent login link for a student (zero secrets / tokens).
    Permitted for Super Admin and Teachers to copy/hand over in person.
    """
    clean_roll = roll_number.upper().strip()
    frontend_url = settings.FRONTEND_URL
    if not frontend_url:
        host = request.headers.get("host", "localhost:8000")
        scheme = request.headers.get("x-forwarded-proto", "https")
        frontend_url = f"{scheme}://{host}"

    return {
        "roll_number": clean_roll,
        "login_url": f"{frontend_url}/login?roll={clean_roll}"
    }


# --- Device Rebind Management ---

@router.get("/rebind-requests")
def list_rebind_requests(
    status_filter: Optional[str] = "PENDING",
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """List device rebind requests, default filtered to PENDING."""
    query = db.query(DeviceRebindRequest)
    if status_filter:
        try:
            status_enum = RebindRequestStatus(status_filter)
            query = query.filter(DeviceRebindRequest.status == status_enum)
        except ValueError:
            pass

    requests_list = query.order_by(DeviceRebindRequest.created_at.desc()).limit(100).all()

    return {
        "count": len(requests_list),
        "requests": [
            {
                "id": r.id,
                "roll_number": r.roll_number,
                "old_device": r.old_device_uuid[:16] + "..." if r.old_device_uuid else None,
                "new_device": r.new_device_uuid[:16] + "..." if r.new_device_uuid else None,
                "reason": r.reason,
                "status": r.status.value,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "reviewed_at": r.reviewed_at.isoformat() if r.reviewed_at else None,
            }
            for r in requests_list
        ],
    }


@router.post("/rebind/{request_id}/approve")
def approve_rebind_request(
    request_id: int,
    req: Optional[RebindDecisionRequest] = None,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Approve a device rebind request. Checks rebind count cap."""
    rebind_req = db.query(DeviceRebindRequest).filter(DeviceRebindRequest.id == request_id).first()
    if not rebind_req:
        raise HTTPException(status_code=404, detail="Rebind request not found")

    if rebind_req.status != RebindRequestStatus.PENDING:
        raise HTTPException(status_code=409, detail=f"Request already {rebind_req.status.value}")

    # Check cap
    onboarding = db.query(StudentOnboarding).filter(
        StudentOnboarding.id == rebind_req.onboarding_id
    ).first()

    if onboarding and onboarding.rebind_count >= settings.MAX_DEVICE_REBINDS_PER_SEMESTER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Maximum device rebinds ({settings.MAX_DEVICE_REBINDS_PER_SEMESTER}) exceeded for this semester."
        )

    now = get_server_ist_datetime().replace(tzinfo=None)
    rebind_req.status = RebindRequestStatus.APPROVED
    rebind_req.reviewed_by = admin.id
    rebind_req.reviewed_at = now

    # Update device binding
    if onboarding:
        onboarding.device_uuid = rebind_req.new_device_uuid
        onboarding.rebind_count += 1

    db.commit()

    log_onboarding_event(
        db=db,
        event_type="REBIND_APPROVED",
        action="DEVICE_REBIND_APPROVED",
        roll_number=rebind_req.roll_number,
        details=f"Rebind #{onboarding.rebind_count if onboarding else '?'}/{settings.MAX_DEVICE_REBINDS_PER_SEMESTER}. Old={rebind_req.old_device_uuid}, New={rebind_req.new_device_uuid}",
        performed_by=admin.id,
    )

    return {"status": "approved", "rebind_count": onboarding.rebind_count if onboarding else None}


@router.post("/rebind/{request_id}/deny")
def deny_rebind_request(
    request_id: int,
    req: Optional[RebindDecisionRequest] = None,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Deny a device rebind request."""
    rebind_req = db.query(DeviceRebindRequest).filter(DeviceRebindRequest.id == request_id).first()
    if not rebind_req:
        raise HTTPException(status_code=404, detail="Rebind request not found")

    if rebind_req.status != RebindRequestStatus.PENDING:
        raise HTTPException(status_code=409, detail=f"Request already {rebind_req.status.value}")

    now = get_server_ist_datetime().replace(tzinfo=None)
    rebind_req.status = RebindRequestStatus.DENIED
    rebind_req.reviewed_by = admin.id
    rebind_req.reviewed_at = now
    db.commit()

    log_onboarding_event(
        db=db,
        event_type="REBIND_DENIED",
        action="DEVICE_REBIND_DENIED",
        roll_number=rebind_req.roll_number,
        details=f"Denied. Reason: {req.reason if req and req.reason else 'No reason given'}",
        performed_by=admin.id,
    )

    return {"status": "denied"}
