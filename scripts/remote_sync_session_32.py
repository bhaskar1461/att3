import os
import sys

sys.path.insert(0, '/home/azureuser/snist_attendance/backend')
from app.core.database import SessionLocal
from app.models.models import AttendanceSession, AttendanceRecord, Student
from app.services.gsheets_service import GoogleSheetsService

db = SessionLocal()
session_id = 32
session = db.query(AttendanceSession).filter(AttendanceSession.id == session_id).first()
if not session:
    print(f"Session {session_id} not found!")
    sys.exit(1)

print(f"Found Session {session.id}: Date={session.session_date}, Period={session.period}, TeacherID={session.teacher_id}")

teacher_gsheet_id = (session.teacher.google_sheet_id if session.teacher else None) or "11Q7xFW8D62WfNvxWk_EKvu9WfbT89QvAkAOWUouHdP0"
print(f"Target Sheet ID: {teacher_gsheet_id}")

records = db.query(AttendanceRecord).filter(AttendanceRecord.session_id == session_id).all()
present_rolls = []
all_rolls = []
for r in records:
    st = db.query(Student).filter(Student.id == r.student_id).first()
    if st:
        all_rolls.append(st.roll_number)
        status_val = getattr(r.status, "value", str(r.status)).upper()
        if status_val in ["PRESENT", "1", "2", "3", "4", "5", "6", "7", "8"]:
            present_rolls.append(st.roll_number)

print(f"Total students: {len(all_rolls)}, Present count: {len(present_rolls)}")
creds_path = "/home/azureuser/snist_attendance/backend/credentials.json"

res = GoogleSheetsService.sync_session_to_gsheet(
    credentials_json=creds_path,
    spreadsheet_id=teacher_gsheet_id,
    date_str=str(session.session_date),
    present_rolls=present_rolls,
    all_section_rolls=all_rolls,
    period_total="4"
)
print("Sync Result:", res)
db.close()
