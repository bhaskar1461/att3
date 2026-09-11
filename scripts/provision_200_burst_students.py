import sys
import os
from datetime import datetime

backend_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'backend'))
if backend_path not in sys.path:
    sys.path.insert(0, backend_path)

from app.core.database import SessionLocal
from app.core.security import get_password_hash
from app.models.models import (
    User, UserRole, Student, StudentOnboarding, OnboardingState,
    Department, AcademicYear, Section, Subject, AttendanceSession, SessionStatus
)

def setup_200_burst_environment():
    db = SessionLocal()
    try:
        dept = db.query(Department).filter(Department.code == "CSE-CS").first() or db.query(Department).first()
        year = db.query(AcademicYear).filter(AcademicYear.name == "3rd Year").first() or db.query(AcademicYear).first()
        section = db.query(Section).filter(Section.name == "CS-A").first() or db.query(Section).first()
        subject = db.query(Subject).filter(Subject.code == "CS(CET)").first() or db.query(Subject).first()

        print(f"=== Provisioning 200 Burst Students for Section '{section.name}' (Dept: {dept.code}) ===")
        password_plain = "BurstStudent@2026"
        p_hash = get_password_hash(password_plain)

        existing_rolls = set(r[0] for r in db.query(Student.roll_number).all())
        new_users = []
        new_students = []
        new_onboardings = []

        now = datetime.utcnow()

        for i in range(1, 201):
            roll = f"DEMO_BURST_{i:03d}"
            if roll in existing_rolls:
                continue

            username = roll.lower()
            email = f"{username}@sreenidhi.edu.in"

            u = User(
                username=roll,
                email=email,
                password_hash=p_hash,
                role=UserRole.STUDENT,
                is_active=True,
                must_change_password=False,
                created_at=now
            )
            db.add(u)
            db.flush()

            stu = Student(
                user_id=u.id,
                roll_number=roll,
                name=f"Burst Student {i:03d}",
                department_id=dept.id,
                academic_year_id=year.id,
                section_id=section.id,
                email=email,
                mobile="9999000000",
                agency="Demo",
                created_at=now
            )
            db.add(stu)

            onb = StudentOnboarding(
                roll_number=roll,
                name=f"Burst Student {i:03d}",
                email=email,
                section_id=section.id,
                state=OnboardingState.ACTIVATED,
                pin_hash=p_hash,
                created_at=now,
                updated_at=now
            )
            db.add(onb)

        db.commit()
        total_students = db.query(Student).count()
        print(f"[SUCCESS] Provisioning complete. Total Students in DB: {total_students}")

        # Ensure an active session exists for CS-A today
        today_str = datetime.now().strftime("%Y-%m-%d")
        session = db.query(AttendanceSession).filter(
            AttendanceSession.section_id == section.id,
            AttendanceSession.status == SessionStatus.OPEN
        ).first()

        if not session:
            # Check for teacher
            from app.models.models import Teacher
            teacher = db.query(Teacher).first()
            session = AttendanceSession(
                teacher_id=teacher.id,
                subject_id=subject.id,
                section_id=section.id,
                session_date=today_str,
                period="4 Periods",
                status=SessionStatus.OPEN,
                created_at=now
            )
            db.add(session)
            db.commit()
            print(f"[CREATED] New OPEN session for testing: ID={session.id}, Date={today_str}")
        else:
            print(f"[REUSED] Existing OPEN session: ID={session.id}, Date={session.session_date}")

        return session.id

    finally:
        db.close()

if __name__ == "__main__":
    setup_200_burst_environment()
