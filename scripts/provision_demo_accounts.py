import sys
import os

# Add backend directory to sys.path
backend_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'backend'))
if backend_path not in sys.path:
    sys.path.insert(0, backend_path)

from datetime import datetime
from app.core.database import SessionLocal
from app.core.security import get_password_hash
from app.models.models import (
    User, UserRole, Teacher, Student, TeacherAssignment, 
    StudentOnboarding, OnboardingState, Department, AcademicYear, Section, Subject
)

def provision_demo_accounts():
    db = SessionLocal()
    try:
        print("=== Provisioning SNIST Demo Accounts ===")

        # Find or use CSE-CS department and CS-A section
        dept = db.query(Department).filter(Department.code == "CSE-CS").first()
        if not dept:
            dept = db.query(Department).first()

        year = db.query(AcademicYear).filter(AcademicYear.name == "3rd Year").first()
        if not year:
            year = db.query(AcademicYear).first()

        section = db.query(Section).filter(Section.name == "CS-A").first()
        if not section:
            section = db.query(Section).first()

        subject = db.query(Subject).filter(Subject.code == "CS(CET)").first()
        if not subject:
            subject = db.query(Subject).first()

        print(f"Assigning to Dept: {dept.code} (ID: {dept.id}), Year: {year.name}, Section: {section.name} (ID: {section.id}), Subject: {subject.name} (ID: {subject.id})")

        # ---------------------------------------------------------------------
        # 1. DEMO TEACHER PROVISIONING
        # ---------------------------------------------------------------------
        teacher_username = "demoteacher"
        teacher_password = "DemoTeacher@2026"
        teacher_email = "demoteacher@sreenidhi.edu.in"
        teacher_code = "DEMO_FAC01"
        teacher_name = "Demo Faculty"

        t_user = db.query(User).filter(User.username == teacher_username).first()
        if not t_user:
            t_user = User(
                username=teacher_username,
                email=teacher_email,
                password_hash=get_password_hash(teacher_password),
                role=UserRole.TEACHER,
                is_active=True,
                must_change_password=False,
                created_at=datetime.utcnow()
            )
            db.add(t_user)
            db.flush()
            print(f"[CREATED] Demo Teacher User: {teacher_username}")
        else:
            t_user.password_hash = get_password_hash(teacher_password)
            t_user.email = teacher_email
            t_user.role = UserRole.TEACHER
            t_user.is_active = True
            t_user.must_change_password = False
            print(f"[UPDATED] Demo Teacher User: {teacher_username}")

        teacher = db.query(Teacher).filter(Teacher.user_id == t_user.id).first()
        if not teacher:
            teacher = Teacher(
                user_id=t_user.id,
                teacher_code=teacher_code,
                name=teacher_name,
                department_id=dept.id,
                mobile="9999999998"
            )
            db.add(teacher)
            db.flush()
            print(f"[CREATED] Demo Teacher Profile: {teacher_name} ({teacher_code})")
        else:
            teacher.name = teacher_name
            teacher.teacher_code = teacher_code
            teacher.department_id = dept.id
            print(f"[UPDATED] Demo Teacher Profile: {teacher_name}")

        # Teacher Assignment to CS-A and CS(CET)
        assignment = db.query(TeacherAssignment).filter(
            TeacherAssignment.teacher_id == teacher.id,
            TeacherAssignment.section_id == section.id,
            TeacherAssignment.subject_id == subject.id
        ).first()
        if not assignment:
            assignment = TeacherAssignment(
                teacher_id=teacher.id,
                subject_id=subject.id,
                section_id=section.id
            )
            db.add(assignment)
            print(f"[ASSIGNED] Demo Teacher assigned to Section {section.name} for Subject {subject.name}")

        # ---------------------------------------------------------------------
        # 2. DEMO STUDENT PROVISIONING (No device binding, unlimited logins)
        # ---------------------------------------------------------------------
        student_username = "demostudent"
        student_roll = "DEMOSTUDENT"
        student_password = "DemoStudent@2026"
        student_email = "demostudent@sreenidhi.edu.in"
        student_name = "Demo Student"

        s_user = db.query(User).filter(User.username == student_username).first()
        if not s_user:
            s_user = User(
                username=student_username,
                email=student_email,
                password_hash=get_password_hash(student_password),
                role=UserRole.STUDENT,
                is_active=True,
                must_change_password=False,
                created_at=datetime.utcnow()
            )
            db.add(s_user)
            db.flush()
            print(f"[CREATED] Demo Student User: {student_username}")
        else:
            s_user.password_hash = get_password_hash(student_password)
            s_user.email = student_email
            s_user.role = UserRole.STUDENT
            s_user.is_active = True
            s_user.must_change_password = False
            print(f"[UPDATED] Demo Student User: {student_username}")

        student = db.query(Student).filter(Student.roll_number == student_roll).first()
        if not student:
            student = Student(
                user_id=s_user.id,
                roll_number=student_roll,
                name=student_name,
                department_id=dept.id,
                academic_year_id=year.id,
                section_id=section.id,
                email=student_email,
                mobile="9999999997",
                agency="Demo",
                registered_device_id=None,
                created_at=datetime.utcnow()
            )
            db.add(student)
            db.flush()
            print(f"[CREATED] Demo Student Profile: {student_name} ({student_roll})")
        else:
            student.user_id = s_user.id
            student.name = student_name
            student.department_id = dept.id
            student.academic_year_id = year.id
            student.section_id = section.id
            student.email = student_email
            student.agency = "Demo"
            student.registered_device_id = None # Keep unbound!
            print(f"[UPDATED] Demo Student Profile: {student_roll} (registered_device_id cleared to None)")

        # Ensure StudentOnboarding is in ACTIVATED state
        onboarding = db.query(StudentOnboarding).filter(StudentOnboarding.roll_number == student_roll).first()
        if not onboarding:
            onboarding = StudentOnboarding(
                roll_number=student_roll,
                name=student_name,
                email=student_email,
                section_id=section.id,
                state=OnboardingState.ACTIVATED,
                pin_hash=get_password_hash(student_password),
                device_uuid=None,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow()
            )
            db.add(onboarding)
            print(f"[CREATED] Demo Student Onboarding: {student_roll} (State: ACTIVATED)")
        else:
            onboarding.state = OnboardingState.ACTIVATED
            onboarding.pin_hash = get_password_hash(student_password)
            onboarding.device_uuid = None
            print(f"[UPDATED] Demo Student Onboarding: {student_roll} (State: ACTIVATED)")

        db.commit()
        print("\n>>> ALL DEMO ACCOUNTS SUCCESSFULLY PROVISIONED AND CONFIGURED! <<<")
        print("\n--- CREDENTIALS SUMMARY ---")
        print(f"1. DEMO TEACHER:")
        print(f"   Username : {teacher_username}")
        print(f"   Password : {teacher_password}")
        print(f"   Role     : TEACHER")
        print(f"   Class    : Section {section.name} - Subject {subject.name}")
        print(f"2. DEMO STUDENT:")
        print(f"   Username : {student_username} (or {student_roll})")
        print(f"   Password : {student_password}")
        print(f"   Role     : STUDENT")
        print(f"   Class    : Section {section.name}")
        print(f"   Device   : UNBOUND (Can log in from any phone/browser, unlimited times)")

    except Exception as e:
        db.rollback()
        print(f"[ERROR] Failed to provision demo accounts: {e}")
        raise e
    finally:
        db.close()

if __name__ == "__main__":
    provision_demo_accounts()
