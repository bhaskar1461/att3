import time
import os
import sys

backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend"))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.core.database import SessionLocal
from app.models.models import User, Student, Teacher, DeviceRegistration, DeviceAccountBinding, StudentOnboarding
from app.core.security import verify_password
from app.core.device_security import register_or_get_device, enforce_device_binding, enforce_student_device_enrollment
from sqlalchemy import or_, func

def profile_auth_steps():
    db = SessionLocal()
    print("--- DETAILED LOGIN STEP PROFILING ---")
    
    clean_roll = "DEMO_BURST_001"
    clean_username = clean_roll
    password = "BurstStudent@2026"
    device_public_id = "DEV-BURST-001"
    device_secret = "DEV-SECRET-001"
    ip_address = "127.0.0.1"
    
    # Step 1: User lookup query
    t0 = time.perf_counter()
    user = db.query(User).filter(
        or_(
            func.upper(User.username) == clean_roll,
            func.upper(User.email) == clean_roll,
            User.username == clean_username,
            User.email == clean_username
        )
    ).first()
    t1 = time.perf_counter()
    print(f"Step 1: User lookup query: {(t1 - t0)*1000:.2f} ms")
    
    # Step 2: Device registration query/upsert
    t0 = time.perf_counter()
    device = register_or_get_device(
        db=db,
        device_public_id=device_public_id,
        device_secret=device_secret,
        ip_address=ip_address
    )
    t1 = time.perf_counter()
    print(f"Step 2: register_or_get_device: {(t1 - t0)*1000:.2f} ms")
    
    # Step 3: Enforce device binding
    t0 = time.perf_counter()
    roll_number = clean_roll
    if user and user.student_profile and user.student_profile.roll_number:
        roll_number = user.student_profile.roll_number.upper()
    binding = enforce_device_binding(
        db=db,
        device=device,
        roll_number=roll_number,
        ip_address=ip_address
    )
    t1 = time.perf_counter()
    print(f"Step 3: enforce_device_binding: {(t1 - t0)*1000:.2f} ms")
    
    # Step 4: Password verification
    t0 = time.perf_counter()
    is_valid_pw = verify_password(password, user.password_hash)
    t1 = time.perf_counter()
    print(f"Step 4: verify_password: {(t1 - t0)*1000:.2f} ms")
    
    # Step 5: Enforce student device enrollment
    t0 = time.perf_counter()
    if user and user.student_profile and binding:
        enforce_student_device_enrollment(
            db=db,
            student=user.student_profile,
            device=device,
            ip_address=ip_address
        )
    t1 = time.perf_counter()
    print(f"Step 5: enforce_student_device_enrollment: {(t1 - t0)*1000:.2f} ms")
    
    # Step 6: Create access token
    from app.core.security import create_access_token
    t0 = time.perf_counter()
    token = create_access_token({"sub": user.username, "role": user.role.value})
    t1 = time.perf_counter()
    print(f"Step 6: create_access_token: {(t1 - t0)*1000:.2f} ms")
    
    db.close()

if __name__ == "__main__":
    profile_auth_steps()
