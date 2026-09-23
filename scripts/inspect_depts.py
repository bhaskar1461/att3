import sys
sys.path.insert(0, '/home/azureuser/snist_attendance/backend')
from app.core.database import SessionLocal
from app.models.models import Student, Department, Section

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

dept_counts = {}
for roll in requested_rolls:
    s = db.query(Student).filter(Student.roll_number == roll).first()
    dept = db.query(Department).filter(Department.id == s.department_id).first() if s.department_id else None
    dept_name = dept.code if dept else "NULL"
    dept_counts[dept_name] = dept_counts.get(dept_name, 0) + 1

print("Department breakdown for the 47 students:")
for d, cnt in sorted(dept_counts.items()):
    print(f"  {d}: {cnt} students")

# Check if there are other students in the DB who have section_id = NULL
unassigned = db.query(Student).filter(Student.section_id == None).count()
print(f"Currently unassigned students (section_id=NULL): {unassigned}")
