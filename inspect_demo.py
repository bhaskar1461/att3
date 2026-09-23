import sys
sys.path.insert(0, "/home/azureuser/snist_attendance/backend")
from app.core.database import SessionLocal
from app.models.models import User, Teacher, Student, Section, AttendanceSession, TeacherAssignment

with SessionLocal() as db:
    teacher_user = db.query(User).filter(User.username == "demoteacher").first()
    if teacher_user:
        teacher = db.query(Teacher).filter(Teacher.user_id == teacher_user.id).first()
        print(f"demoteacher: user_id={teacher_user.id}, teacher_id={teacher.id if teacher else None}")
        if teacher:
            sessions = db.query(AttendanceSession).filter(AttendanceSession.teacher_id == teacher.id).all()
            print(f"Active/Recent sessions for teacher: {len(sessions)}")
            for s in sessions[:5]:
                print(f"  Session id={s.id}, section_id={s.section_id}, status={s.status}, subject_id={s.subject_id}")
            ta = db.query(TeacherAssignment).filter(TeacherAssignment.teacher_id == teacher.id).all()
            print(f"Teacher assignments: {len(ta)}")
            for a in ta:
                print(f"  Assignment id={a.id}, section_id={a.section_id}, subject_id={a.subject_id}")

    # Check sections
    sections = db.query(Section).all()
    print(f"\nSections count: {len(sections)}")
    for sec in sections[:10]:
        print(f"  Section id={sec.id}, name={sec.name}, dept_id={sec.department_id}, academic_year_id={sec.academic_year_id}")
