import os
import sys

sys.path.insert(0, '/home/azureuser/snist_attendance/backend')
from app.core.database import SessionLocal
from app.models.models import StudentOnboarding

db = SessionLocal()
students = db.query(StudentOnboarding).filter(
    StudentOnboarding.roll_number != "23311A05Y6"  # Exclude Bhaskar
).order_by(StudentOnboarding.roll_number).all()

print(f"Total Target CS Students: {len(students)}")
for i, s in enumerate(students, 1):
    print(f"{i:2d}. {s.roll_number} | {s.name:<30} | {s.email} | State: {s.state}")

db.close()
