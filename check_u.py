import sys
sys.path.insert(0, "/home/azureuser/snist_attendance/backend")
from app.core.database import SessionLocal
from app.models.models import User, StudentOnboarding, CredentialItem
with SessionLocal() as db:
    u = db.query(User).filter(User.username == "24311A6670").first()
    print("User password_hash:", u.password_hash)
    onb = db.query(StudentOnboarding).filter(StudentOnboarding.roll_number == "24311A6670").first()
    if onb:
        print("Onboarding pin_hash:", onb.pin_hash, "state:", onb.state)
    cred = db.query(CredentialItem).filter(CredentialItem.roll_number == "24311A6670").first()
    if cred:
        print("CredentialItem temp_password_hash:", cred.temp_password_hash, "pin_hash:", cred.pin_hash)
