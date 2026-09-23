import sys
sys.path.insert(0, '/home/azureuser/snist_attendance/backend')
from app.core.database import SessionLocal
from app.models.models import Student, AttendanceRecord, AttendanceSession

db = SessionLocal()

JAVA_FSD_SECTION_ID = 35

requested_rolls = [
    "24311A66Q4", "24311A66R5", "24311A6245", "24311A6252", "25315A0514",
    "24311A05L7", "24311A05P9", "24311A05CP", "25315A0542", "24311A05EX",
    "24312A05DT", "24311A6750", "24311A67F7", "24311A67G1", "24311A0420",
    "24311A04L2", "24311A04L3", "24311A04M9", "24311A04N7", "24311A04Q7",
    "24311A04DQ", "24311A0220", "25315A0202", "24311A1202", "25315A1203",
    "24311A12C0", "24311A12F6", "24311A0306", "24311A0313", "24311A0319",
    "24311A0331"
]

java_sessions = db.query(AttendanceSession).filter(AttendanceSession.section_id == JAVA_FSD_SECTION_ID).all()
java_sess_ids = [sess.id for sess in java_sessions]
stu_map = {s.id: s for s in db.query(Student).filter(Student.roll_number.in_(requested_rolls)).all()}

records = db.query(AttendanceRecord).filter(
    AttendanceRecord.student_id.in_(list(stu_map.keys())),
    AttendanceRecord.session_id.in_(java_sess_ids)
).all()

print(f"Total records found: {len(records)}")
for r in records:
    st = stu_map.get(r.student_id)
    print(f"Student: {st.roll_number} ({st.name}) | Session: {r.session_id} | Status: {r.status} | Marked: {r.marked_at}")
