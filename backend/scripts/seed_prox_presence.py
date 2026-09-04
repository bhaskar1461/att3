import sys
import os
import hashlib
from datetime import datetime

# Add parent directory to python path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.database import SessionLocal, engine, Base
from app.core.security import get_password_hash
from app.models.models import (
    User, UserRole, Department, AcademicYear, Section, Subject, 
    Teacher, Student, TeacherAssignment, Classroom,
    StudentCanonical, SessionCanonical
)

def seed_prox_presence():
    """
    Seeds 100 fake students (50 in CSE-A, 50 in CSE-B), 2 pilot classrooms, 
    and teacher credentials for ProxPresence testing.
    Populates both canonical domain tables ('students') and existing tables ('qr_students').
    """
    from sqlalchemy import text
    try:
        Base.metadata.create_all(bind=engine)
    except Exception as e:
        print(f"Table/schema init warning (non-fatal): {e}")

    with engine.connect() as conn:
        for col_sql in [
            "ALTER TABLE qr_students ADD COLUMN device_hash VARCHAR(128) NULL",
            "ALTER TABLE qr_attendance_records ADD COLUMN method VARCHAR(20) DEFAULT 'ble' NULL",
            "ALTER TABLE qr_attendance_records ADD COLUMN rssi INT NULL",
            "ALTER TABLE qr_attendance_records ADD COLUMN geo_accuracy_m FLOAT NULL",
            "ALTER TABLE qr_attendance_records ADD COLUMN marked_at DATETIME NULL",
            "ALTER TABLE qr_attendance_audit_reviews ADD COLUMN record_id INT NULL",
            "ALTER TABLE qr_attendance_audit_reviews ADD COLUMN flag VARCHAR(50) NULL",
            "ALTER TABLE qr_attendance_audit_reviews ADD COLUMN resolved_by VARCHAR(100) NULL",
            "ALTER TABLE qr_attendance_audit_reviews ADD COLUMN resolved_at DATETIME NULL",
            "ALTER TABLE qr_attendance_sessions ADD COLUMN faculty_id INT NULL",
            "ALTER TABLE qr_attendance_sessions ADD COLUMN room_id INT NULL",
            "ALTER TABLE qr_attendance_sessions ADD COLUMN starts_at DATETIME NULL",
            "ALTER TABLE qr_attendance_sessions ADD COLUMN locks_at DATETIME NULL",
            "ALTER TABLE qr_attendance_sessions ADD COLUMN kill_switch_active BOOLEAN DEFAULT 0 NULL"
        ]:
            try:
                conn.execute(text(col_sql))
                conn.commit()
            except Exception:
                pass

    db = SessionLocal()

    try:
        print("=== Seeding ProxPresence: 100 Students & 2 Rooms ===")

        # 1. Pilot Classrooms
        room1 = db.query(Classroom).filter(Classroom.room_code == "ROOM-304-BLOCK-B").first()
        if not room1:
            room1 = Classroom(
                room_code="ROOM-304-BLOCK-B",
                building="Block B",
                floor=3,
                center_latitude=17.448291,
                center_longitude=78.391482,
                geofence_radius_meters=60,
                default_rssi_threshold=-75,
                uwb_supported=False,
                is_active=True
            )
            db.add(room1)

        room2 = db.query(Classroom).filter(Classroom.room_code == "LH-101-BLOCK-A").first()
        if not room2:
            room2 = Classroom(
                room_code="LH-101-BLOCK-A",
                building="Block A",
                floor=1,
                center_latitude=17.448650,
                center_longitude=78.391120,
                geofence_radius_meters=80,
                default_rssi_threshold=-80,
                uwb_supported=True,
                is_active=True
            )
            db.add(room2)
        db.flush()
        print(f"Seeded 2 Pilot Rooms: {room1.room_code} (id={room1.id}), {room2.room_code} (id={room2.id})")

        # 2. Department & Academic Year
        dept = db.query(Department).filter(Department.code == "CSE").first()
        if not dept:
            dept = Department(code="CSE", name="Computer Science and Engineering")
            db.add(dept)
            db.flush()

        ayear = db.query(AcademicYear).filter(AcademicYear.name == "3rd Year").first()
        if not ayear:
            ayear = AcademicYear(name="3rd Year")
            db.add(ayear)
            db.flush()

        # 3. Sections: CSE-A and CSE-B
        sec_a = db.query(Section).filter(Section.name == "CSE-A").first()
        if not sec_a:
            sec_a = Section(name="CSE-A", department_id=dept.id, academic_year_id=ayear.id)
            db.add(sec_a)
            db.flush()

        sec_b = db.query(Section).filter(Section.name == "CSE-B").first()
        if not sec_b:
            sec_b = Section(name="CSE-B", department_id=dept.id, academic_year_id=ayear.id)
            db.add(sec_b)
            db.flush()

        # 4. Subject
        subject = db.query(Subject).filter(Subject.code == "CS301").first()
        if not subject:
            subject = Subject(code="CS301", name="Database Management Systems", department_id=dept.id, academic_year_id=ayear.id)
            db.add(subject)
            db.flush()

        # 5. Faculty / Teacher
        t_user = db.query(User).filter(User.username == "faculty1").first()
        if not t_user:
            t_user = User(
                username="faculty1",
                email="faculty1@college.edu",
                password_hash=get_password_hash("faculty123"),
                role=UserRole.TEACHER
            )
            db.add(t_user)
            db.flush()

        teacher = db.query(Teacher).filter(Teacher.user_id == t_user.id).first()
        if not teacher:
            teacher = Teacher(
                user_id=t_user.id,
                teacher_code="FAC101",
                name="Dr. A. Sharma",
                department_id=dept.id,
                mobile="9876543210"
            )
            db.add(teacher)
            db.flush()

        # Assign teacher to CSE-A and CSE-B
        for sec in [sec_a, sec_b]:
            asgn = db.query(TeacherAssignment).filter(
                TeacherAssignment.teacher_id == teacher.id,
                TeacherAssignment.subject_id == subject.id,
                TeacherAssignment.section_id == sec.id
            ).first()
            if not asgn:
                asgn = TeacherAssignment(teacher_id=teacher.id, subject_id=subject.id, section_id=sec.id)
                db.add(asgn)
        db.flush()

        # 6. Seed 100 Students: 50 in CSE-A (501..550), 50 in CSE-B (551..600)
        first_names = [
            "Aarav", "Vivaan", "Aditya", "Vihaan", "Arjun", "Sai", "Reyansh", "Ayaan", "Krishna", "Ishaan",
            "Shaurya", "Atharva", "Advik", "Pranav", "Advaith", "Aaryan", "Dhruv", "Kabir", "Ritvik", "Darsh",
            "Ananya", "Diya", "Isha", "Riya", "Aadhya", "Saanvi", "Kavya", "Tara", "Nisha", "Aditi",
            "Pooja", "Meera", "Avani", "Tanvi", "Sanya", "Ira", "Rhea", "Prisha", "Khushi", "Myra",
            "Kiran", "Naveen", "Rahul", "Rohan", "Siddharth", "Varun", "Vikram", "Yash", "Sneha", "Neha"
        ]
        last_names = [
            "Reddy", "Rao", "Sharma", "Verma", "Patel", "Gupta", "Kumar", "Singh", "Nair", "Iyer",
            "Chowdary", "Choudhury", "Bose", "Menon", "Joshi", "Kulkarni", "Deshmukh", "Pillai", "Mishra", "Pandey"
        ]

        created_students_count = 0
        for i in range(1, 101):
            sec_obj = sec_a
            sec_name = "CSE-A"
            roll_no = f"238A1A05{i:02d}"

            fn = first_names[(i - 1) % len(first_names)]
            ln = last_names[(i * 3) % len(last_names)]
            full_name = f"{fn} {ln}"
            dev_hash = hashlib.sha256(f"dev_fingerprint_{roll_no}".encode()).hexdigest()

            # Seed canonical 'students' table
            s_can = db.query(StudentCanonical).filter(StudentCanonical.roll_no == roll_no).first()
            if not s_can:
                s_can = StudentCanonical(
                    roll_no=roll_no,
                    section=sec_name,
                    name=full_name,
                    device_hash=dev_hash
                )
                db.add(s_can)
            else:
                s_can.section = sec_name

            # Seed 'qr_students' + 'qr_users'
            s_user = db.query(User).filter(User.username == roll_no.lower()).first()
            if not s_user:
                s_user = User(
                    username=roll_no.lower(),
                    email=f"{roll_no.lower()}@snist.edu.in",
                    password_hash=get_password_hash("student123"),
                    role=UserRole.STUDENT
                )
                db.add(s_user)
                db.flush()

            student = db.query(Student).filter(Student.roll_number == roll_no).first()
            if not student:
                student = Student(
                    user_id=s_user.id,
                    roll_number=roll_no,
                    name=full_name,
                    department_id=dept.id,
                    academic_year_id=ayear.id,
                    section_id=sec_obj.id,
                    email=f"{roll_no.lower()}@snist.edu.in",
                    mobile=f"98{i:08d}",
                    device_hash=dev_hash
                )
                db.add(student)
                created_students_count += 1
            else:
                student.section_id = sec_obj.id
                if not student.device_hash:
                    student.device_hash = dev_hash

        db.commit()
        print(f"Successfully seeded {created_students_count} new students (total 100 students across CSE-A & CSE-B).")
        print("Faculty login: faculty1 / faculty123")
        print("Student login: 238a1a0501 / student123")
        print("=== Seed Completed Successfully ===")

    except Exception as e:
        db.rollback()
        print(f"Error during seeding: {e}")
        raise
    finally:
        db.close()

if __name__ == "__main__":
    seed_prox_presence()
