import sys
sys.path.insert(0, "/home/azureuser/snist_attendance/backend")
from app.core.database import SessionLocal
from app.models.models import Section, Subject, TeacherAssignment, User, Student, DeviceAccountBinding
from app.core.security import get_password_hash

with SessionLocal() as db:
    # 1. Inspect sections
    print("=== Sections ===")
    for s in db.query(Section).all():
        print(f"Section id={s.id}, name={s.name}")

    # 2. Add assignments for demoteacher (id=5) if not already present
    demo_tid = 5
    for a in db.query(TeacherAssignment).filter(TeacherAssignment.teacher_id.in_([22, 23, 24])).all():
        exists = db.query(TeacherAssignment).filter(
            TeacherAssignment.teacher_id == demo_tid,
            TeacherAssignment.section_id == a.section_id,
            TeacherAssignment.subject_id == a.subject_id
        ).first()
        if not exists:
            new_a = TeacherAssignment(
                teacher_id=demo_tid,
                section_id=a.section_id,
                subject_id=a.subject_id
            )
            db.add(new_a)
            print(f"Added assignment for demoteacher: section={a.section_id}, subject={a.subject_id}")
    db.commit()

    # 3. Create or update DEMOSTUDENT
    # Password: demostudent@2026
    pw_hash = get_password_hash("demostudent@2026")
    demo_stu_user = db.query(User).filter(User.username == "DEMOSTUDENT").first()
    if not demo_stu_user:
        demo_stu_user = User(
            username="DEMOSTUDENT",
            email="demostudent@sreenidhi.edu.in",
            password_hash=pw_hash,
            role="STUDENT",
            is_active=True,
            must_change_password=False
        )
        db.add(demo_stu_user)
        db.commit()
        db.refresh(demo_stu_user)
        print(f"Created DEMOSTUDENT user id={demo_stu_user.id}")
    else:
        demo_stu_user.password_hash = pw_hash
        demo_stu_user.is_active = True
        demo_stu_user.must_change_password = False
        db.commit()
        print(f"Updated DEMOSTUDENT user id={demo_stu_user.id}")

    # Ensure Student profile exists
    demo_stu_profile = db.query(Student).filter(Student.user_id == demo_stu_user.id).first()
    # Find section for Agentic AI or Python FSD
    agentic_sec = db.query(Section).filter(Section.name.ilike("%Agentic%")).first() or db.query(Section).first()
    if not demo_stu_profile:
        demo_stu_profile = Student(
            user_id=demo_stu_user.id,
            roll_number="DEMOSTUDENT",
            name="Demo Student",
            department_id=agentic_sec.department_id if agentic_sec else 1,
            academic_year_id=agentic_sec.academic_year_id if agentic_sec else 3,
            section_id=agentic_sec.id if agentic_sec else 1,
            agency="DEMO"
        )
        db.add(demo_stu_profile)
        db.commit()
        print(f"Created DEMOSTUDENT student profile id={demo_stu_profile.id}, section={demo_stu_profile.section_id}")
    else:
        demo_stu_profile.section_id = agentic_sec.id if agentic_sec else demo_stu_profile.section_id
        demo_stu_profile.agency = "DEMO"
        db.commit()
        print(f"Updated DEMOSTUDENT student profile id={demo_stu_profile.id}")

    # 4. Release device binding for sample student 23311A6636 (K Anil kumar) so they can also log in if desired!
    b = db.query(DeviceAccountBinding).filter(DeviceAccountBinding.roll_number == "23311A6636").all()
    for item in b:
        db.delete(item)
    db.commit()
    print(f"Cleared device binding for 23311A6636")
