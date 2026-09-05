from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload
from datetime import timedelta
from pydantic import BaseModel
from typing import Optional, List, Dict

from app.core.database import get_db
import logging
from app.core.security import verify_password, get_password_hash, create_access_token, decode_access_token
from app.models.models import User, UserRole, Teacher, Student, Department, StudentOnboarding

logger = logging.getLogger("snist_erp.auth")

router = APIRouter(prefix="/auth", tags=["Authentication"])

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")

class LoginRequest(BaseModel):
    username: str
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str
    role: str
    username: str
    full_name: str
    user_id: int

class UserResponse(BaseModel):
    id: int
    username: str
    email: Optional[str] = None
    role: str
    full_name: str

class PasswordChangeRequest(BaseModel):
    old_password: str
    new_password: str

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    username: str = payload.get("sub")
    if username is None:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    # Eagerly load user profiles in 1 query to prevent lazy loading in downstream endpoints
    user = db.query(User).options(
        joinedload(User.student_profile),
        joinedload(User.teacher_profile)
    ).filter(User.username == username).first()
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="User inactive or not found")
    return user

def require_teacher(request: Request, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    if current_user.role not in [UserRole.TEACHER, UserRole.SUPER_ADMIN]:
        # Student JWT attempting privilege escalation to faculty endpoints
        # WHY: Immediately records and alerts operator on active authorization bypass attempts.
        if current_user.role == UserRole.STUDENT:
            try:
                from app.core.device_security import record_audit_log
                ip_addr = request.client.host if request.client else None
                record_audit_log(
                    db=db,
                    user_id=current_user.id,
                    roll_number=current_user.username,
                    event_type="PRIVESC_ATTEMPT",
                    action="UNAUTHORIZED_FACULTY_ENDPOINT_ACCESS",
                    details=f"Student account {current_user.username} attempted unauthorized access to {request.method} {request.url.path}",
                    ip_address=ip_addr
                )
            except Exception as e:
                logger.warning(f"Failed to log PRIVESC_ATTEMPT: {e}")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Faculty or Administrative privileges required"
        )
    return current_user

def require_admin(request: Request, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    if current_user.role != UserRole.SUPER_ADMIN:
        # Non-admin attempting access to Super Admin route
        # WHY: Logs and alerts on unauthorized administrative access attempts.
        try:
            from app.core.device_security import record_audit_log
            ip_addr = request.client.host if request.client else None
            record_audit_log(
                db=db,
                user_id=current_user.id,
                roll_number=current_user.username,
                event_type="PRIVESC_ATTEMPT",
                action="UNAUTHORIZED_ADMIN_ENDPOINT_ACCESS",
                details=f"User {current_user.username} (Role: {current_user.role}) attempted unauthorized access to {request.method} {request.url.path}",
                ip_address=ip_addr
            )
        except Exception as e:
            logger.warning(f"Failed to log PRIVESC_ATTEMPT: {e}")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Super Admin privileges required"
        )
    return current_user

import time
import threading
from collections import defaultdict

class FailedLoginRateLimiter:
    """
    In-memory thread-safe rate limiter tracking consecutive failed login attempts per client IP.
    Blocks any IP accumulating 5 failed attempts within 300 seconds (5 minutes) to protect against
    pre-class lockout storms and credential spraying.
    """
    def __init__(self, max_failures: int = 5, block_duration_seconds: int = 300):
        self.max_failures = max_failures
        self.block_duration = block_duration_seconds
        self._failures: Dict[str, List[float]] = defaultdict(list)
        self._lock = threading.Lock()

    def check_rate_limit(self, ip_address: Optional[str]) -> None:
        if not ip_address:
            return
        now = time.time()
        with self._lock:
            valid_attempts = [t for t in self._failures[ip_address] if now - t < self.block_duration]
            self._failures[ip_address] = valid_attempts
            if len(valid_attempts) >= self.max_failures:
                retry_after = int(self.block_duration - (now - valid_attempts[0]))
                # Hook rate-limit trigger for security digest tracking
                # WHY: Tracks credential spraying attempts for rollup in hourly digest.
                try:
                    from app.services.security_alert_service import alert_tracker, EVENT_LOGIN_RATE_LIMIT
                    alert_tracker.record_and_evaluate(EVENT_LOGIN_RATE_LIMIT, ip_address or "UNKNOWN_IP", ip_address or "UNKNOWN_IP")
                except Exception:
                    pass
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=f"Too many failed login attempts from this network. Please wait {max(1, retry_after)} seconds before trying again."
                )

    def record_failure(self, ip_address: Optional[str]) -> None:
        if not ip_address:
            return
        now = time.time()
        with self._lock:
            self._failures[ip_address].append(now)

    def record_success(self, ip_address: Optional[str]) -> None:
        if not ip_address:
            return
        with self._lock:
            self._failures.pop(ip_address, None)

failed_login_limiter = FailedLoginRateLimiter(max_failures=5, block_duration_seconds=300)

from app.core.device_security import (
    register_or_get_device,
    enforce_device_binding,
    log_security_audit_event,
    SecurityEventType
)

class RefreshRequest(BaseModel):
    device_public_id: Optional[str] = None
    device_secret: Optional[str] = None

@router.post("/login", response_model=Token)
async def login_for_access_token(request: Request, db: Session = Depends(get_db)):
    username = ""
    password = ""
    device_public_id = request.headers.get("x-device-public-id", "").strip()
    device_secret = request.headers.get("x-device-secret", "").strip()

    content_type = request.headers.get("content-type", "")
    if "application/json" in content_type:
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid or malformed JSON payload")
        username = body.get("username", "")
        password = body.get("password", "")
        if not device_public_id:
            device_public_id = str(body.get("device_public_id", "")).strip()
        if not device_secret:
            device_secret = str(body.get("device_secret", "")).strip()
    else:
        form = await request.form()
        username = form.get("username", "")
        password = form.get("password", "")
        if not device_public_id:
            device_public_id = str(form.get("device_public_id", "")).strip()
        if not device_secret:
            device_secret = str(form.get("device_secret", "")).strip()

    username = (username or "").strip()
    password = (password or "").strip()
    ip_address = request.client.host if request.client else None

    # Enforce IP-based rate limiting to thwart pre-class student lockout storms
    failed_login_limiter.check_rate_limit(ip_address)

    user = db.query(User).filter(
        or_(
            User.username == username,
            User.email == username,
            User.username.ilike(username),
            User.email.ilike(username),
            User.email.ilike(f"{username}@%")
        )
    ).first()

    # 1. Enforce Student Device Binding Security LOCKOUT BEFORE/DURING login
    if user and user.role == UserRole.STUDENT:
        if not device_public_id or not device_secret:
            # Deterministic fallback tied to client connection/browser characteristics,
            # NEVER tied to the student username (which would allow multi-account bypass!)
            import hashlib
            client_ua = request.headers.get("user-agent", "generic_student_browser")
            client_ip = ip_address or "127.0.0.1"
            conn_sig = hashlib.sha256(f"{client_ip}_{client_ua}".encode()).hexdigest()[:16]
            device_public_id = f"DEV-CONN-{conn_sig.upper()}"
            device_secret = hashlib.sha256(f"{device_public_id}_SECRET_SALT_2026".encode()).hexdigest()

        # Register/retrieve device
        device = register_or_get_device(
            db=db,
            device_public_id=device_public_id,
            device_secret=device_secret,
            ip_address=ip_address
        )

        roll_number = username.upper()
        if user.student_profile and user.student_profile.roll_number:
            roll_number = user.student_profile.roll_number.upper()

        # Enforce 30-minute device lock & 5-attempt limit
        enforce_device_binding(
            db=db,
            device=device,
            roll_number=roll_number,
            ip_address=ip_address
        )

    # 2. Verify password (strict - no hardcoded student backdoor)
    is_valid_pw = False
    if user:
        is_valid_pw = verify_password(password, user.password_hash)
        # Self-healing fallback: Check student onboarding PIN if out of sync
        if not is_valid_pw and user.role == UserRole.STUDENT:
            try:
                onboarding_rec = db.query(StudentOnboarding).filter(
                    StudentOnboarding.roll_number == user.username
                ).first()
                if onboarding_rec and onboarding_rec.pin_hash:
                    if verify_password(password, onboarding_rec.pin_hash):
                        is_valid_pw = True
                        user.password_hash = onboarding_rec.pin_hash
                        db.commit()
            except Exception as sync_err:
                logger.warning(f"Failed to check onboarding pin_hash fallback: {sync_err}")

    if not user or not is_valid_pw:
        failed_login_limiter.record_failure(ip_address)
        log_security_audit_event(
            db=db,
            event_type=SecurityEventType.LOGIN_FAILURE,
            action="LOGIN_FAILURE",
            details=f"Failed login attempt for username '{username}'",
            user_id=user.id if user else None,
            ip_address=ip_address
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    failed_login_limiter.record_success(ip_address)

    full_name = user.username
    if user.role == UserRole.TEACHER and user.teacher_profile:
        full_name = user.teacher_profile.name
    elif user.role == UserRole.STUDENT and user.student_profile:
        full_name = user.student_profile.name

    # 3. Create short-lived token for students (30 seconds) or standard for staff
    access_token = create_access_token(
        data={"sub": user.username, "role": user.role.value, "user_id": user.id}
    )

    log_security_audit_event(
        db=db,
        event_type=SecurityEventType.LOGIN_SUCCESS,
        action="LOGIN_SUCCESS",
        details=f"User '{user.username}' logged in successfully as {user.role.value}",
        user_id=user.id,
        roll_number=user.username if user.role == UserRole.STUDENT else None,
        ip_address=ip_address
    )

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "role": user.role.value,
        "username": user.username,
        "full_name": full_name,
        "user_id": user.id
    }

@router.post("/refresh", response_model=Token)
async def refresh_student_token(
    request: Request,
    req: Optional[RefreshRequest] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    ip_address = request.client.host if request.client else None
    
    if current_user.role == UserRole.STUDENT:
        device_public_id = request.headers.get("x-device-public-id", "").strip()
        device_secret = request.headers.get("x-device-secret", "").strip()
        if req and not device_public_id:
            device_public_id = (req.device_public_id or "").strip()
            device_secret = (req.device_secret or "").strip()

        if not device_public_id or not device_secret:
            import hashlib
            client_ua = request.headers.get("user-agent", "generic_student_browser")
            client_ip = ip_address or "127.0.0.1"
            conn_sig = hashlib.sha256(f"{client_ip}_{client_ua}".encode()).hexdigest()[:16]
            device_public_id = f"DEV-CONN-{conn_sig.upper()}"
            device_secret = hashlib.sha256(f"{device_public_id}_SECRET_SALT_2026".encode()).hexdigest()

        device = register_or_get_device(db, device_public_id, device_secret, ip_address)
        roll_number = current_user.username.upper()
        if current_user.student_profile:
            roll_number = current_user.student_profile.roll_number.upper()

        enforce_device_binding(db, device, roll_number, ip_address)

    full_name = current_user.username
    if current_user.role == UserRole.TEACHER and current_user.teacher_profile:
        full_name = current_user.teacher_profile.name
    elif current_user.role == UserRole.STUDENT and current_user.student_profile:
        full_name = current_user.student_profile.name

    new_token = create_access_token(
        data={"sub": current_user.username, "role": current_user.role.value, "user_id": current_user.id}
    )

    return {
        "access_token": new_token,
        "token_type": "bearer",
        "role": current_user.role.value,
        "username": current_user.username,
        "full_name": full_name,
        "user_id": current_user.id
    }

@router.post("/logout")
def logout_user(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    ip_address = request.client.host if request.client else None
    log_security_audit_event(
        db=db,
        event_type=SecurityEventType.SESSION_EXPIRED,
        action="LOGOUT",
        details=f"User {current_user.username} logged out. Device binding retained.",
        user_id=current_user.id,
        roll_number=current_user.username if current_user.role == UserRole.STUDENT else None,
        ip_address=ip_address
    )
    return {
        "status": "SUCCESS",
        "message": "User session invalidated successfully. Note: 30-minute device lock remains active."
    }

@router.get("/me", response_model=UserResponse)
def read_users_me(current_user: User = Depends(get_current_user)):
    full_name = current_user.username
    if current_user.role == UserRole.TEACHER and current_user.teacher_profile:
        full_name = current_user.teacher_profile.name
    elif current_user.role == UserRole.STUDENT and current_user.student_profile:
        full_name = current_user.student_profile.name

    return {
        "id": current_user.id,
        "username": current_user.username,
        "email": current_user.email,
        "role": current_user.role.value,
        "full_name": full_name
    }

@router.post("/change-password")
def change_password(req: PasswordChangeRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not verify_password(req.old_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Incorrect old password")
    current_user.password_hash = get_password_hash(req.new_password)
    db.commit()
    return {"message": "Password updated successfully"}


# --- Faculty & User Magic Link Login with Password Setting ---

class MagicLoginRequest(BaseModel):
    token: str
    new_password: Optional[str] = None
    device_public_id: Optional[str] = None
    device_secret: Optional[str] = None

class GenerateMagicLinkRequest(BaseModel):
    identifier: str
    expires_days: int = 7


@router.get("/magic-token-info")
def get_magic_token_info(token: str, db: Session = Depends(get_db)):
    """Validates a magic login token and returns user details before signing in."""
    from app.core.security import verify_magic_login_token
    payload = verify_magic_login_token(token)
    if not payload or not payload.get("sub"):
        raise HTTPException(
            status_code=400,
            detail="Invalid or expired magic link. Please use your username & password or request a new link."
        )

    username = payload["sub"]
    user = db.query(User).options(
        joinedload(User.student_profile),
        joinedload(User.teacher_profile)
    ).filter(User.username == username).first()

    if not user or not user.is_active:
        raise HTTPException(status_code=400, detail="User account is inactive or not found.")

    full_name = user.username
    if user.role == UserRole.TEACHER and user.teacher_profile:
        full_name = user.teacher_profile.name
    elif user.role == UserRole.STUDENT and user.student_profile:
        full_name = user.student_profile.name

    return {
        "valid": True,
        "username": user.username,
        "full_name": full_name,
        "email": user.email,
        "role": user.role.value
    }


@router.post("/magic-login")
def login_via_magic_link(req: MagicLoginRequest, request: Request, db: Session = Depends(get_db)):
    """
    Authenticates a user via secure magic link token.
    Allows the user (e.g. Mrs. N. Sowjanya) to choose / update their password directly.
    """
    from app.core.security import verify_magic_login_token, get_password_hash, create_access_token
    payload = verify_magic_login_token(req.token)
    if not payload or not payload.get("sub"):
        raise HTTPException(
            status_code=400,
            detail="Invalid or expired magic link. Please sign in with your username and password."
        )

    username = payload["sub"]
    user = db.query(User).options(
        joinedload(User.student_profile),
        joinedload(User.teacher_profile)
    ).filter(User.username == username).first()

    if not user or not user.is_active:
        raise HTTPException(status_code=400, detail="User account is inactive or not found.")

    # Update password if user chose one
    password_updated = False
    if req.new_password and req.new_password.strip():
        pwd = req.new_password.strip()
        if len(pwd) < 4:
            raise HTTPException(status_code=400, detail="Password must be at least 4 characters long.")
        user.password_hash = get_password_hash(pwd)
        user.must_change_password = False
        password_updated = True
        db.commit()

    # Track device if student
    if user.role == UserRole.STUDENT:
        device_public_id = (req.device_public_id or "").strip()
        device_secret = (req.device_secret or "").strip()
        ip_address = request.client.host if request.client else None
        user_agent = request.headers.get("user-agent")
        if device_public_id:
            device = register_or_get_device(db, device_public_id, device_secret, ip_address, user_agent)
            lock_success, lockout_remaining, bound_sap = enforce_device_binding(db, device.id, user.username)
            if not lock_success:
                raise HTTPException(
                    status_code=403,
                    detail=f"Device locked to another student account ({bound_sap}). Please wait {lockout_remaining} minute(s)."
                )

    access_token = create_access_token(data={"sub": user.username, "role": user.role.value})

    full_name = user.username
    if user.role == UserRole.TEACHER and user.teacher_profile:
        full_name = user.teacher_profile.name
    elif user.role == UserRole.STUDENT and user.student_profile:
        full_name = user.student_profile.name

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "role": user.role.value,
        "username": user.username,
        "full_name": full_name,
        "user_id": user.id,
        "password_updated": password_updated,
    }


@router.post("/generate-magic-link")
def generate_magic_link_endpoint(
    req: GenerateMagicLinkRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generates a secure login magic link for a teacher or user (Admin only)."""
    if current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Super Admin permission required.")

    from app.core.security import create_magic_login_token
    from app.core.config import settings

    ident = req.identifier.strip()
    user = db.query(User).filter(
        or_(User.username == ident, User.email == ident)
    ).first()
    if not user:
        raise HTTPException(status_code=404, detail=f"User '{ident}' not found.")

    token = create_magic_login_token(username=user.username, role=user.role.value, expires_days=req.expires_days)

    frontend_url = settings.FRONTEND_URL
    if not frontend_url:
        host = request.headers.get("host", "localhost:8000")
        scheme = request.headers.get("x-forwarded-proto", "https")
        frontend_url = f"{scheme}://{host}"

    magic_link = f"{frontend_url.rstrip('/')}/login?magic_token={token}"
    return {
        "status": "SUCCESS",
        "username": user.username,
        "email": user.email,
        "role": user.role.value,
        "magic_link": magic_link,
        "token": token,
        "expires_days": req.expires_days
    }

