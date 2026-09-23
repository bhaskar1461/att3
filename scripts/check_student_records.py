import sys
sys.path.insert(0, '/home/azureuser/snist_attendance/backend')
from app.core.database import SessionLocal
from app.models.models import Student, AttendanceRecord, AttendanceSession

db = SessionLocal()

requested_rolls = [
    "23311A6636", "24311A6616", "24311A6681", "24311A66M2", "24311A66P5",
    "24311A66Q2", "24311A66R4", "24311A66AL", "24311A66W2", "24311A66W9",
    "24311A66X1", "24311A6215", "24311A6216", "24311A6230", "24311A6236",
    "24311A6260", "24311A6263", "24311A05E1", "24311A05BP", "24311A05FD",
    "24311A6723", "24311A6736", "22311A6754", "24311A6796", "24311A67H3",
    "24311A04B3", "24311A04E4", "23311A04N0", "24311A04CX", "24311A04EA",
    "24311A0203", "24311A0219", "24311A0228", "24311A1207", "24311A1228",
    "24311A1281", "24311A1293", "24311A12D9", "24311A12F0", "24311A12G0",
    "24311A0312", "24311A0314", "24311A0317", "24311A0318", "24311A0321",
    "24311A0327", "24311A0339"
]

students = db.query(Student).filter(Student.roll_number.in_(requested_rolls)).all()
stu_ids = [s.id for s in students]

# Check sessions for section 36
sec36_sessions = db.query(AttendanceSession).filter(AttendanceSession.section_id == 36).all()
sec36_sess_ids = [sess.id for sess in sec36_sessions]

records = db.query(AttendanceRecord).filter(
    AttendanceRecord.student_id.in_(stu_ids),
    AttendanceRecord.session_id.in_(sec36_sess_ids)
).all()

print(f"Agentic AI sessions: {sec36_sess_ids}")
print(f"Attendance records found for these 47 students in Agentic AI sessions: {len(records)}")
for r in records[:10]:
    s = next((st for st in students if st.id == r.student_id), None)
    print(f"Record: student={s.roll_number if s else r.student_id}, session={r.session_id}, status={r.status}, marked_at={r.marked_at}")
