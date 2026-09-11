import os
import sys

sys.path.insert(0, '/home/azureuser/snist_attendance/backend')
from app.core.database import SessionLocal
from app.models.models import Teacher, SystemSettings, AttendanceSession

db = SessionLocal()

print("=== SYSTEM SETTINGS (MySQL) ===")
try:
    settings = db.query(SystemSettings).all()
    for s in settings:
        print(f"Key: {s.key} = {s.value}")
except Exception as e:
    print("Err settings:", e)

print("\n=== TEACHERS (MySQL) ===")
try:
    teachers = db.query(Teacher).all()
    for t in teachers:
        print(f"ID: {t.id}, Name: {t.name}, Sheet ID: {getattr(t, 'google_sheet_id', 'NO_ATTR')}")
except Exception as e:
    print("Err teachers:", e)

print("\n=== LATEST ATTENDANCE SESSIONS ===")
try:
    sessions = db.query(AttendanceSession).order_by(AttendanceSession.id.desc()).limit(5).all()
    for s in sessions:
        print(f"Session ID: {s.id}, Date: {s.session_date}, Period: {s.period}, Status: {s.status}, Teacher: {s.teacher.name if s.teacher else 'None'}")
except Exception as e:
    print("Err sessions:", e)

db.close()
