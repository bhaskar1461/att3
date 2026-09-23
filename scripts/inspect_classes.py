import sys
sys.path.insert(0, '/home/azureuser/snist_attendance/backend')
from app.core.database import SessionLocal, engine
from app.models.models import Student, Section
from sqlalchemy import inspect

db = SessionLocal()

print('Count of students with section_id=36 (Agentic AI):', db.query(Student).filter(Student.section_id == 36).count())

insp = inspect(engine)
print('Matching tables in DB:')
for t in insp.get_table_names():
    if any(k in t for k in ['enroll', 'roster', 'class', 'student', 'section']):
        print(' -', t)

# Sample students in Section 36
print('\nFirst 10 students in Section 36:')
for s in db.query(Student).filter(Student.section_id == 36).limit(10).all():
    print(f'Student id={s.id}, roll={s.roll_number}, name={s.name}')
