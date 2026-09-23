import sys
sys.path.insert(0, '/home/azureuser/snist_attendance/backend')
from app.core.database import SessionLocal
from app.models.models import Student, Section, AttendanceSession, AttendanceRecord

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

sec = db.query(Section).filter(Section.id == JAVA_FSD_SECTION_ID).first()
sec_name = sec.name if sec else f"Section {JAVA_FSD_SECTION_ID}"
total_java = db.query(Student).filter(Student.section_id == JAVA_FSD_SECTION_ID).count()
print(f"Target Section: {sec_name} (ID: {JAVA_FSD_SECTION_ID})")
print(f"Current Total in {sec_name}: {total_java}")
print(f"Total requested rolls: {len(requested_rolls)}")

found = 0
not_found = []
in_java = []
in_other = []

for idx, roll in enumerate(requested_rolls, 1):
    s = db.query(Student).filter(Student.roll_number == roll).first()
    if not s:
        not_found.append((idx, roll))
    else:
        found += 1
        sec_str = s.section.name if s.section else f"NULL (id={s.section_id})"
        if s.section_id == JAVA_FSD_SECTION_ID:
            in_java.append((idx, roll, s.name, sec_str))
        else:
            in_other.append((idx, roll, s.name, sec_str))

print(f"Found in DB: {found}/{len(requested_rolls)}")
print(f"Currently in {sec_name}: {len(in_java)}")
print(f"In other sections: {len(in_other)}")
print(f"Not found in DB: {len(not_found)}")

if not_found:
    print("\nNOT FOUND ROLLS:")
    for idx, r in not_found:
        print(f" #{idx}: {r}")

if in_other:
    print("\nIN OTHER SECTION:")
    for idx, r, name, sec_str in in_other:
        print(f" #{idx}: {r} ({name}) -> {sec_str}")

print("\nSAMPLE MATCHES IN JAVA FSD (first 10):")
for idx, r, name, sec_str in in_java[:10]:
    print(f" #{idx}: {r} | {name} | {sec_str}")

# Check attendance records in Java FSD sessions
java_sessions = db.query(AttendanceSession).filter(AttendanceSession.section_id == JAVA_FSD_SECTION_ID).all()
java_sess_ids = [sess.id for sess in java_sessions]
stu_ids = [s.id for s in db.query(Student).filter(Student.roll_number.in_(requested_rolls)).all()]
records = db.query(AttendanceRecord).filter(
    AttendanceRecord.student_id.in_(stu_ids),
    AttendanceRecord.session_id.in_(java_sess_ids)
).count()
print(f"\nJava FSD Sessions count: {len(java_sess_ids)}")
print(f"Attendance records for target students in Java FSD sessions: {records}")
