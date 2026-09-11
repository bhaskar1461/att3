import sys
import os

sys.path.insert(0, os.path.abspath('backend'))
from app.core.database import SessionLocal
from app.models.models import (
    DeviceAccountBinding, BindingStatus,
    DeviceRegistration, Student, StudentOnboarding
)

db = SessionLocal()

# 1. Reset all active device-to-roll bindings
bindings = db.query(DeviceAccountBinding).all()
unlocked_bindings = 0
for b in bindings:
    b.status = BindingStatus.EXPIRED
    b.attempt_count = 0
    unlocked_bindings += 1

# 2. Reset student registered devices (bi-directional lock)
students = db.query(Student).all()
unlinked_students = 0
for s in students:
    if s.registered_device_id is not None:
        s.registered_device_id = None
        unlinked_students += 1

# 3. Clear device_uuid on StudentOnboarding
onboardings = db.query(StudentOnboarding).all()
cleared_onboardings = 0
for o in onboardings:
    if o.device_uuid is not None:
        o.device_uuid = None
        cleared_onboardings += 1

# 4. Ensure all registered devices are active (unbanned/unrevoked)
devices = db.query(DeviceRegistration).all()
reactivated_devices = 0
for d in devices:
    if not d.is_active:
        d.is_active = True
        reactivated_devices += 1

db.commit()
db.close()

print(f"1. Unlocked & reset {unlocked_bindings} device-account binding records.")
print(f"2. Reset registered_device_id for {unlinked_students} students.")
print(f"3. Cleared device_uuid for {cleared_onboardings} onboarding records.")
print(f"4. Reactivated {reactivated_devices} devices.")
print("\n>>> ALL DEVICES AND ACCOUNTS ARE FULLY UNLOCKED AND READY! <<<")
