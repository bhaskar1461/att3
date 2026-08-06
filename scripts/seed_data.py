import sys
import os
from datetime import datetime

# Add parent directory to python path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.database import SessionLocal, engine, Base
from app.core.security import get_password_hash
from app.models.models import (
    User, UserRole, Department, AcademicYear, Section, Subject, 
    Teacher, Student, TeacherAssignment, SystemSettings
)

def seed_database():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    try:
        print("--- Seeding AI QR Attendance System Database ---")

        # 1. Super Admin
        admin_user = db.query(User).filter(User.username == "admin").first()
        if not admin_user:
            admin_user = User(
                username="admin",
                email="admin@college.edu",
                password_hash=get_password_hash("admin123"),
                role=UserRole.SUPER_ADMIN
            )
            db.add(admin_user)
            db.flush()
            print("Created Super Admin user: admin / admin123")
        else:
            admin_user.password_hash = get_password_hash("admin123")
            print("Updated Super Admin user password: admin / admin123")

        # 2. Departments
        depts_data = [
            ("CSE", "Computer Science and Engineering"),
            ("ECE", "Electronics and Communication Engineering"),
            ("IT", "Information Technology"),
            ("EEE", "Electrical and Electronics Engineering"),
            ("MECH", "Mechanical Engineering")
        ]
        dept_objs = {}
        for code, name in depts_data:
            d = db.query(Department).filter(Department.code == code).first()
            if not d:
                d = Department(code=code, name=name)
                db.add(d)
                db.flush()
            dept_objs[code] = d
        print("Seeded Departments")

        # 3. Academic Years
        years_data = ["1st Year", "2nd Year", "3rd Year", "4th Year"]
        year_objs = {}
        for y_name in years_data:
            y = db.query(AcademicYear).filter(AcademicYear.name == y_name).first()
            if not y:
                y = AcademicYear(name=y_name)
                db.add(y)
                db.flush()
            year_objs[y_name] = y
        print("Seeded Academic Years")

        # 4. Sections
        cse_dept = dept_objs["CSE"]
        yr_3 = year_objs["3rd Year"]

        sec_a = db.query(Section).filter(Section.name == "CSE-A").first()
        if not sec_a:
            sec_a = Section(name="CSE-A", department_id=cse_dept.id, academic_year_id=yr_3.id)
            db.add(sec_a)
            db.flush()
        print("Seeded Section CSE-A")

        # 5. Subjects
        subjects_data = [
            ("CS301", "Database Management Systems"),
            ("CS302", "Operating Systems"),
            ("CS303", "Computer Networks"),
            ("CS304", "Web Technologies")
        ]
        sub_objs = []
        for code, name in subjects_data:
            s = db.query(Subject).filter(Subject.code == code).first()
            if not s:
                s = Subject(code=code, name=name, department_id=cse_dept.id, academic_year_id=yr_3.id)
                db.add(s)
                db.flush()
            sub_objs.append(s)
        print("Seeded Subjects")

        # 6. Teachers
        t_user = db.query(User).filter(User.username == "teacher1").first()
        if not t_user:
            t_user = User(
                username="teacher1",
                email="teacher1@college.edu",
                password_hash=get_password_hash("teacher123"),
                role=UserRole.TEACHER
            )
            db.add(t_user)
            db.flush()

            teacher = Teacher(
                user_id=t_user.id,
                teacher_code="NT001",
                name="Prof. Srinivas Rao",
                department_id=cse_dept.id,
                mobile="9876543210"
            )
            db.add(teacher)
            db.flush()

            # Assign teacher to Database Management Systems for CSE-A
            assignment = TeacherAssignment(
                teacher_id=teacher.id,
                subject_id=sub_objs[0].id,
                section_id=sec_a.id
            )
            db.add(assignment)
            print("Created Teacher user: teacher1 / teacher123 and assigned to DBMS")
        else:
            t_user.password_hash = get_password_hash("teacher123")
            print("Updated Teacher user password: teacher1 / teacher123")

        # 7. Students (Roll Numbers 21311A0501 to 21311A0510)
        sample_students = [
            ("21311A0501", "Aarav Sharma", "aarav@student.edu"),
            ("21311A0502", "Aditi Verma", "aditi@student.edu"),
            ("21311A0503", "Akash Reddy", "akash@student.edu"),
            ("21311A0504", "Ananya Kulkarni", "ananya@student.edu"),
            ("21311A0505", "Bhaavik Patel", "bhaavik@student.edu"),
            ("21311A0506", "Chetan Gupta", "chetan@student.edu"),
            ("21311A0507", "Deepika Rao", "deepika@student.edu"),
            ("21311A0508", "Eshwar Teja", "eshwar@student.edu"),
            ("21311A0509", "Farhan Ahmed", "farhan@student.edu"),
            ("21311A0510", "Gayathri Devi", "gayathri@student.edu"),
        ]

        for roll, name, email in sample_students:
            s_user = db.query(User).filter(User.username == roll).first()
            if not s_user:
                s_user = User(
                    username=roll,
                    email=email,
                    password_hash=get_password_hash(roll), # Password = Roll Number
                    role=UserRole.STUDENT
                )
                db.add(s_user)
                db.flush()

                student = Student(
                    user_id=s_user.id,
                    roll_number=roll,
                    name=name,
                    department_id=cse_dept.id,
                    academic_year_id=yr_3.id,
                    section_id=sec_a.id,
                    email=email,
                    agency="Regular"
                )
                db.add(student)
            else:
                s_user.password_hash = get_password_hash(roll)

        print("Seeded 10 Sample Students")

        # 8. System Settings
        default_settings = [
            ("GOOGLE_SPREADSHEET_ID", "", "Google Sheets Spreadsheet ID"),
            ("ATTENDANCE_TIME_WINDOW", "09:00 - 16:30", "Configured Attendance Timings"),
            ("LATE_THRESHOLD_MINUTES", "15", "Late threshold in minutes")
        ]
        for key, val, desc in default_settings:
            st = db.query(SystemSettings).filter(SystemSettings.key == key).first()
            if not st:
                db.add(SystemSettings(key=key, value=val, description=desc))

        db.commit()
        print("--- Database Seeding Complete ---")

        # Sync DB file to backend/data/attendance_system.db as well if path differs
        import shutil
        main_db = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend", "attendance_system.db")
        data_db_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend", "data")
        os.makedirs(data_db_dir, exist_ok=True)
        data_db = os.path.join(data_db_dir, "attendance_system.db")
        if os.path.exists(main_db) and main_db != data_db:
            shutil.copy2(main_db, data_db)
            print(f"Synced DB to Docker/data location: {data_db}")

    except Exception as e:
        db.rollback()
        print(f"Error seeding database: {str(e)}")
    finally:
        db.close()

if __name__ == "__main__":
    seed_database()
