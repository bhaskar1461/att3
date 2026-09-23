import sys
sys.path.insert(0, "/home/azureuser/snist_attendance/backend")
from app.core.database import SessionLocal
from app.core.device_security import reset_student_device_enrollment
from app.models.models import Student, User, StudentOnboarding
from app.core.security import get_password_hash

with SessionLocal() as db:
    for roll in ["23311A6636", "23311A05Y6"]:
        try:
            res = reset_student_device_enrollment(db, roll)
            print(f"Reset device binding for {roll}: success")
        except Exception as e:
            print(f"Reset for {roll}: {e}")

    # Also verify password for 23311A6636
    u = db.query(User).filter(User.username == "23311A6636").first()
    if u:
        print(f"23311A6636 user found, role={u.role}, active={u.is_active}")
