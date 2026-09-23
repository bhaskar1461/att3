import sys
sys.path.insert(0, "/home/azureuser/snist_attendance/backend")
from app.core.database import SessionLocal
from app.models.models import Teacher, TeacherAssignment, Subject, Section

with SessionLocal() as db:
    teachers = db.query(Teacher).all()
    print("=== Teachers ===")
    for t in teachers:
        tas = db.query(TeacherAssignment).filter(TeacherAssignment.teacher_id == t.id).all()
        print(f"Teacher id={t.id}, name={t.name}, code={t.teacher_code}, dept_id={t.department_id}, assignments={len(tas)}")
        for a in tas:
            sec = db.query(Section).filter(Section.id == a.section_id).first()
            sub = db.query(Subject).filter(Subject.id == a.subject_id).first()
            print(f"   -> Sec: {sec.name if sec else a.section_id}, Sub: {sub.name if sub else a.subject_id}")

    subs = db.query(Subject).all()
    print(f"\nSubjects count: {len(subs)}")
    for s in subs:
        print(f"   Subject id={s.id}, name={s.name}, code={s.code}")
