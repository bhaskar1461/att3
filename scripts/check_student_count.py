import sys
import os

backend_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'backend'))
if backend_path not in sys.path:
    sys.path.insert(0, backend_path)

from app.core.database import SessionLocal
from app.models.models import Student, User, AttendanceSession, Section

db = SessionLocal()
try:
    print("Students in DB:", db.query(Student).count())
    print("Users in DB:", db.query(User).count())
    print("Sections:", [s.name for s in db.query(Section).all()])
    active = db.query(AttendanceSession).filter(AttendanceSession.status == "OPEN").first()
    if active:
        print(f"Active OPEN Session ID: {active.id}, Section: {active.section_id}, Date: {active.session_date}")
    else:
        latest = db.query(AttendanceSession).order_by(AttendanceSession.id.desc()).first()
        if latest:
            print(f"Latest Session ID: {latest.id}, Status: {latest.status}, Section: {latest.section_id}, Date: {latest.session_date}")
finally:
    db.close()
