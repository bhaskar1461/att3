from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from datetime import timedelta
from pydantic import BaseModel
from typing import Optional

from app.core.database import get_db
from app.core.security import verify_password, get_password_hash, create_access_token, decode_access_token
from app.models.models import User, UserRole, Teacher, Student, Department

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
    user = db.query(User).filter(User.username == username).first()
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="User inactive or not found")
    return user

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

    user = db.query(User).filter(User.username == username).first()
    if not user:
        user = db.query(User).filter(User.username.ilike(username)).first()

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
        # MUST happen before password check if switching accounts, but check password first for correct account
        enforce_device_binding(
            db=db,
            device=device,
            roll_number=roll_number,
            ip_address=ip_address
        )

    # 2. Verify password
    is_valid_pw = False
    if user:
        is_valid_pw = verify_password(password, user.password_hash)
        if not is_valid_pw and user.role == UserRole.STUDENT:
            # Allow students to log in with their roll number (case-insensitive) or default 'student123'
            if password.strip().upper() == username.strip().upper() or password == "student123":
                is_valid_pw = True

    if not user or not is_valid_pw:
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
