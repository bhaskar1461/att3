import os
import sys
import subprocess

KEY_PATH = r"C:\Users\bhask\.ssh\Ather-os_key.pem"
HOST = "20.6.131.206"
USER = "azureuser"

remote_script = """
import sys
sys.path.insert(0, "/home/azureuser/snist_attendance/backend")
from app.core.database import SessionLocal
from app.models.models import User, Student, StudentOnboarding, CredentialItem, DeviceAccountBinding, BindingStatus
from app.core.security import get_password_hash, verify_password

ROLL = "23311A05Y6"
NEW_PW = "123456"
new_hash = get_password_hash(NEW_PW)

with SessionLocal() as db:
    user = db.query(User).filter(User.username == ROLL).first()
    if not user:
        user = db.query(User).filter(User.username.ilike(ROLL)).first()
    
    if user:
        user.password_hash = new_hash
        user.is_active = True
        user.must_change_password = False
        print(f"Updated User {user.username} (ID: {user.id}) password_hash.")
    else:
        print(f"WARNING: User record for {ROLL} not found in User table!")

    # Check and update StudentOnboarding
    onboarding = db.query(StudentOnboarding).filter(StudentOnboarding.roll_number == ROLL).first()
    if not onboarding:
        onboarding = db.query(StudentOnboarding).filter(StudentOnboarding.roll_number.ilike(ROLL)).first()
    if onboarding:
        onboarding.pin_hash = new_hash
        print(f"Updated StudentOnboarding {onboarding.roll_number} pin_hash.")

    # Check and update CredentialItem
    cred = db.query(CredentialItem).filter(CredentialItem.sap_id == ROLL).order_by(CredentialItem.id.desc()).first()
    if not cred:
        cred = db.query(CredentialItem).filter(CredentialItem.sap_id.ilike(ROLL)).order_by(CredentialItem.id.desc()).first()
    if cred:
        cred.temp_password_hash = new_hash
        cred.temp_password = NEW_PW
        print(f"Updated CredentialItem {cred.sap_id} temp_password.")

    # Reset any active device lockout bindings to give student a clean slate
    bindings = db.query(DeviceAccountBinding).filter(
        DeviceAccountBinding.roll_number.ilike(ROLL),
        DeviceAccountBinding.status == BindingStatus.ACTIVE
    ).all()
    for b in bindings:
        b.status = BindingStatus.EXPIRED
    print(f"Expired {len(bindings)} active device account bindings for {ROLL}.")

    db.commit()

    if user:
        db.refresh(user)
        verified = verify_password(NEW_PW, user.password_hash)
        print(f"Password verification test for {user.username} with '{NEW_PW}': {verified}")
"""

def run_ssh(cmd: str):
    res = subprocess.run([
        "ssh", "-i", KEY_PATH, "-o", "StrictHostKeyChecking=no",
        f"{USER}@{HOST}", cmd
    ], capture_output=True, text=True)
    print(res.stdout)
    if res.stderr:
        print("STDERR:", res.stderr)
    return res.returncode

print(f"Executing password change for 23311A05Y6 on {HOST}...")
# Write remote_script to a local temp file and scp it
local_tmp = r"C:\Users\bhask\AppData\Local\Temp\change_pw.py"
with open(local_tmp, "w", encoding="utf-8") as f:
    f.write(remote_script)

scp_cmd = [
    "scp", "-i", KEY_PATH, "-o", "StrictHostKeyChecking=no",
    local_tmp, f"{USER}@{HOST}:/tmp/change_pw.py"
]
subprocess.run(scp_cmd, check=True)
run_ssh("/home/azureuser/snist_attendance/venv/bin/python /tmp/change_pw.py")

