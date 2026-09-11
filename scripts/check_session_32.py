import os
import sys

sys.path.insert(0, '/home/azureuser/snist_attendance/backend')
from app.core.database import SessionLocal
from app.models.models import AttendanceSession, AttendanceRecord, Student

db = SessionLocal()
s = db.query(AttendanceSession).filter(AttendanceSession.id == 32).first()
if s:
    print(f"Session 32: Date={s.session_date}, Period={s.period}, Status={s.status}, TeacherID={s.teacher_id}")
    records = db.query(AttendanceRecord).filter(AttendanceRecord.session_id == 32).all()
    print(f"Records count: {len(records)}")
    for r in records[:5]:
        st = db.query(Student).filter(Student.id == r.student_id).first()
        print(f"  Student: {st.roll_number if st else r.student_id} -> {r.status}")
else:
    print("Session 32 not found")
db.close()
