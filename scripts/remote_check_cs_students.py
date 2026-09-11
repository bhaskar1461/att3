import os
import sys

sys.path.insert(0, '/home/azureuser/snist_attendance/backend')
from app.core.database import SessionLocal
from app.models.models import Student, Department, Section, StudentOnboarding

db = SessionLocal()

print("=== DEPARTMENTS ===")
for d in db.query(Department).all():
    print(f"Dept ID: {d.id}, Code: {d.code}, Name: {d.name}")

print("\n=== SECTIONS ===")
for s in db.query(Section).all():
    print(f"Sec ID: {s.id}, Name: {s.name}, Dept ID: {s.department_id}")

print("\n=== CS STUDENTS ===")
cs_depts = db.query(Department).all()
for d in cs_depts:
    count = db.query(Student).filter(Student.department_id == d.id).count()
    print(f"Dept {d.name} ({d.code}): {count} students")

students = db.query(Student).all()
print(f"Total Students in DB: {len(students)}")

print("\n=== STUDENT ONBOARDING RECORDS ===")
try:
    onboardings = db.query(StudentOnboarding).all()
    print(f"Total Onboarding records: {len(onboardings)}")
    for ob in onboardings[:10]:
        print(f"  Roll: {ob.roll_number}, Name: {ob.name}, Email: {ob.email}, Dept: {ob.department}, Status: {ob.status}")
except Exception as e:
    print("Err onboardings:", e)

db.close()
