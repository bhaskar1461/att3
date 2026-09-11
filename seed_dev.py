"""
SNIST ERP Attendance System — Realistic Development Database Seeder
Matches Production Architecture: 252 Students across the 7 Real SNIST Departments
(CSE, CSM, ECE, IT, MECH, CIVIL, EEE) + Unassigned Edge Case,
~60 Courses, 6 Weeks of Realistic Attendance History with JNTUH R25 Bands.
"""

import os
import sys
import random
from datetime import datetime, timedelta

# Ensure backend directory is importable
backend_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend")
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.core.database import SessionLocal, engine, Base
from app.models.models import (
    User, UserRole, Department, AcademicYear, Section, Subject,
    Teacher, Student, TeacherAssignment, AttendanceSession, AttendanceRecord,
    AttendanceStatus, SessionStatus, StudentCondonation
)
from app.core.security import get_password_hash, get_server_ist_date
from app.services.attendance_engine import invalidate_attendance_cache

REAL_DEPARTMENTS = [
    {"code": "CSE", "name": "Computer Science & Engineering", "quota": 48},
    {"code": "CSM", "name": "CSE (Artificial Intelligence & Machine Learning)", "quota": 40},
    {"code": "ECE", "name": "Electronics & Communication Engineering", "quota": 44},
    {"code": "IT", "name": "Information Technology", "quota": 36},
    {"code": "MECH", "name": "Mechanical Engineering", "quota": 30},
    {"code": "CIVIL", "name": "Civil Engineering", "quota": 26},
    {"code": "EEE", "name": "Electrical & Electronics Engineering", "quota": 24},
]

REAL_COURSES = {
    "CSE": [
        ("CS301", "Data Structures & Algorithms"),
        ("CS302", "Database Management Systems"),
        ("CS303", "Operating Systems"),
        ("CS304", "Computer Organization & Architecture"),
        ("CS305", "Object-Oriented Programming with Java"),
        ("CS306", "Web Technologies & Frameworks"),
        ("CS307", "Software Engineering Principles"),
        ("CS308", "Compiler Design"),
        ("CS309", "Computer Networks & Security"),
    ],
    "CSM": [
        ("AI301", "Artificial Intelligence Foundations"),
        ("AI302", "Machine Learning Algorithms"),
        ("AI303", "Deep Learning & Neural Networks"),
        ("AI304", "Natural Language Processing"),
        ("AI305", "Computer Vision & Pattern Recognition"),
        ("AI306", "Data Mining & Predictive Analytics"),
        ("AI307", "Python for Applied AI & Data Science"),
        ("AI308", "Reinforcement Learning"),
        ("AI309", "AI Ethics, Governance & Law"),
    ],
    "ECE": [
        ("EC301", "Analog Circuits & Simulation"),
        ("EC302", "Digital Signal Processing"),
        ("EC303", "Signals, Systems & Transforms"),
        ("EC304", "Microprocessors & Microcontrollers"),
        ("EC305", "VLSI Design & Embedded Systems"),
        ("EC306", "Wireless Communications & Networks"),
        ("EC307", "Antennas & Wave Propagation"),
        ("EC308", "Optical Fiber Communications"),
        ("EC309", "Linear Integrated Circuits"),
    ],
    "IT": [
        ("IT301", "Object-Oriented Analysis & Design"),
        ("IT302", "Cloud Computing & Distributed Systems"),
        ("IT303", "Cyber Security & Digital Forensics"),
        ("IT304", "Big Data Analytics & Hadoop"),
        ("IT305", "Internet of Things (IoT) Architectures"),
        ("IT306", "Mobile Application Development"),
        ("IT307", "DevOps & Continuous Integration"),
        ("IT308", "Information Retrieval Systems"),
        ("IT309", "Blockchain Technology & Smart Contracts"),
    ],
    "MECH": [
        ("ME301", "Thermodynamics & Heat Engines"),
        ("ME302", "Fluid Mechanics & Hydraulic Machinery"),
        ("ME303", "Strength of Materials & Mechanics"),
        ("ME304", "Kinematics & Dynamics of Machinery"),
        ("ME305", "Heat Transfer Engineering"),
        ("ME306", "Manufacturing Technology & Machining"),
        ("ME307", "CAD / CAM & Automation"),
        ("ME308", "Automobile Engineering Systems"),
        ("ME309", "Refrigeration & Air Conditioning"),
    ],
    "CIVIL": [
        ("CE301", "Structural Analysis & Matrix Methods"),
        ("CE302", "Concrete Technology & Mix Design"),
        ("CE303", "Geotechnical Engineering & Foundations"),
        ("CE304", "Advanced Surveying & GIS"),
        ("CE305", "Environmental Engineering & Waste Mgmt"),
        ("CE306", "Transportation & Highway Engineering"),
        ("CE307", "Fluid Mechanics & Open Channel Flow"),
        ("CE308", "Hydrology & Water Resources"),
        ("CE309", "Design of Steel Structures"),
    ],
    "EEE": [
        ("EE301", "Electric Circuit Theory & Analysis"),
        ("EE302", "Electrical Machines & Transformers"),
        ("EE303", "Power Systems Transmission & Distribution"),
        ("EE304", "Power Electronics & Inverter Drives"),
        ("EE305", "Control Systems Engineering"),
        ("EE306", "Electromagnetic Fields & Waves"),
        ("EE307", "Renewable Energy Systems & Grid Tie"),
        ("EE308", "Switchgear & High Voltage Protection"),
    ]
}

FIRST_NAMES = [
    "Aarav", "Aditi", "Akhil", "Ananya", "Anirudh", "Anusha", "Arjun", "Bhavya", "Chaitanya",
    "Deepika", "Dinesh", "Divya", "Ganesh", "Gayatri", "Harsha", "Ishaan", "Kalyan", "Kavya",
    "Krishna", "Lakshmi", "Madhav", "Manasa", "Meghana", "Nikhil", "Nithya", "Pooja", "Pranav",
    "Priyanka", "Rahul", "Ram", "Rohit", "Sahithi", "Sai", "Sameer", "Sandeep", "Santhosh",
    "Siddharth", "Sindhu", "Sneha", "Srikanth", "Srinivas", "Surya", "Swapna", "Tarun", "Teja",
    "Vaishnavi", "Varun", "Venkatesh", "Vijay", "Vikram", "Vinay", "Yamini", "Yashwanth"
]

LAST_NAMES = [
    "Reddy", "Rao", "Sharma", "Varma", "Goud", "Kumar", "Chowdary", "Naidu", "Prasad", "Patel",
    "Gupta", "Murthy", "Kulkarni", "Joshi", "Babu", "Raju", "Singh", "Yadav", "Nair", "Iyer"
]

def seed_database():
    print("=" * 70)
    print("SNIST ERP Development Database Seeder")
    print("Connecting to database:", engine.url)
    print("=" * 70)

    # Ensure tables exist
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    try:
        # 1. Create Super Admin User
        admin_user = db.query(User).filter(User.username == "admin").first()
        if not admin_user:
            print("Creating super admin account (admin / admin123)...")
            admin_user = User(
                username="admin",
                email="helpdesk@sreenidhi.edu.in",
                password_hash=get_password_hash("admin123"),
                role=UserRole.SUPER_ADMIN,
                is_active=True
            )
            db.add(admin_user)
            db.flush()

        # 2. Create Academic Years
        academic_years = {}
        for y_name in ["1st Year", "2nd Year", "3rd Year", "4th Year"]:
            ay = db.query(AcademicYear).filter(AcademicYear.name == y_name).first()
            if not ay:
                ay = AcademicYear(name=y_name)
                db.add(ay)
                db.flush()
            academic_years[y_name] = ay

        default_ay = academic_years["3rd Year"]

        # 3. Create Departments, Sections & Faculty
        departments = {}
        sections = {}
        teachers = {}

        for d_info in REAL_DEPARTMENTS:
            code = d_info["code"]
            dept = db.query(Department).filter(Department.code == code).first()
            if not dept:
                dept = Department(code=code, name=d_info["name"])
                db.add(dept)
                db.flush()
            departments[code] = dept

            # Create Sections A & B for department
            for sec_letter in ["A", "B"]:
                sec_name = f"{code}-{sec_letter}"
                sec = db.query(Section).filter(Section.name == sec_name).first()
                if not sec:
                    sec = Section(name=sec_name, department_id=dept.id, academic_year_id=default_ay.id)
                    db.add(sec)
                    db.flush()
                sections[sec_name] = sec

            # Create Faculty for department (2 per dept)
            for f_idx in [1, 2]:
                f_username = f"faculty_{code.lower()}{f_idx}"
                f_user = db.query(User).filter(User.username == f_username).first()
                if not f_user:
                    f_user = User(
                        username=f_username,
                        email=f"{f_username}@sreenidhi.edu.in",
                        password_hash=get_password_hash("faculty123"),
                        role=UserRole.TEACHER,
                        is_active=True
                    )
                    db.add(f_user)
                    db.flush()

                    teacher = Teacher(
                        user_id=f_user.id,
                        teacher_code=f"SNIST_{code}_{f_idx:02d}",
                        name=f"Dr. {random.choice(FIRST_NAMES)} {random.choice(LAST_NAMES)}",
                        department_id=dept.id,
                        mobile=f"98480{random.randint(10000, 99999)}"
                    )
                    db.add(teacher)
                    db.flush()
                    teachers[f"{code}_{f_idx}"] = teacher

        # 4. Create ~60 Courses
        courses_by_dept = {}
        total_courses_created = 0

        for d_code, c_list in REAL_COURSES.items():
            dept = departments[d_code]
            courses_by_dept[d_code] = []
            for c_code, c_name in c_list:
                course = db.query(Subject).filter(Subject.code == c_code).first()
                if not course:
                    course = Subject(
                        code=c_code,
                        name=c_name,
                        department_id=dept.id,
                        academic_year_id=default_ay.id
                    )
                    db.add(course)
                    db.flush()
                    total_courses_created += 1
                courses_by_dept[d_code].append(course)

                # Assign course to section A and teacher 1
                t1 = teachers.get(f"{d_code}_1")
                sec_a = sections.get(f"{d_code}-A")
                if t1 and sec_a:
                    exist_asgn = db.query(TeacherAssignment).filter(
                        TeacherAssignment.teacher_id == t1.id,
                        TeacherAssignment.subject_id == course.id,
                        TeacherAssignment.section_id == sec_a.id
                    ).first()
                    if not exist_asgn:
                        db.add(TeacherAssignment(teacher_id=t1.id, subject_id=course.id, section_id=sec_a.id))

        print(f"Verified {total_courses_created} curriculum courses across 7 departments.")

        # 5. Create 252 Students
        print("Provisioning exactly 252 students across departments...")
        roll_prefix_year = "23311A"
        dept_roll_codes = {
            "CSE": "05", "CSM": "66", "ECE": "04", "IT": "12",
            "MECH": "03", "CIVIL": "01", "EEE": "02"
        }

        all_students = []
        student_counts_by_dept = {}

        # 6-week window dates: 30 days prior to today
        today_dt = datetime.strptime(get_server_ist_date(), "%Y-%m-%d")
        start_dt = today_dt - timedelta(days=42)  # 6 weeks ago
        teaching_dates = []
        curr = start_dt
        while curr <= today_dt:
            if curr.weekday() < 5:  # Monday to Friday
                teaching_dates.append(curr.strftime("%Y-%m-%d"))
            curr += timedelta(days=1)
        
        # Take latest 24 teaching sessions
        teaching_dates = teaching_dates[-24:]

        student_counter = 0

        for d_info in REAL_DEPARTMENTS:
            code = d_info["code"]
            quota = d_info["quota"]
            dept = departments[code]
            roll_code = dept_roll_codes[code]
            student_counts_by_dept[code] = 0

            for i in range(1, quota + 1):
                student_counter += 1
                roll_num = f"{roll_prefix_year}{roll_code}{i:02d}"
                sec_choice = sections[f"{code}-A"] if i <= (quota // 2) else sections[f"{code}-B"]

                # Edge case: late-join students (10% of cohort)
                is_late_join = (i % 10 == 0)
                join_date = teaching_dates[len(teaching_dates) // 3] if is_late_join else None

                student = db.query(Student).filter(Student.roll_number == roll_num).first()
                if not student:
                    first = random.choice(FIRST_NAMES)
                    last = random.choice(LAST_NAMES)
                    # Create student user
                    s_user = User(
                        username=roll_num,
                        email=f"{roll_num.lower()}@sreenidhi.edu.in",
                        password_hash=get_password_hash("student123"),
                        role=UserRole.STUDENT,
                        is_active=True
                    )
                    db.add(s_user)
                    db.flush()

                    student = Student(
                        user_id=s_user.id,
                        roll_number=roll_num,
                        name=f"{first} {last}",
                        department_id=dept.id,
                        section_id=sec_choice.id,
                        academic_year_id=default_ay.id,
                        email=f"{roll_num.lower()}@sreenidhi.edu.in",
                        mobile=f"99490{random.randint(10000, 99999)}",
                        join_date=join_date
                    )
                    db.add(student)
                    db.flush()

                all_students.append(student)
                student_counts_by_dept[code] += 1

        # Edge Case: 4 Unassigned Department Students (Dashboard Reconciliation)
        for u_idx in [1, 2, 3, 4]:
            u_roll = f"23311A99{u_idx:02d}"
            u_student = db.query(Student).filter(Student.roll_number == u_roll).first()
            if not u_student:
                u_user = User(
                    username=u_roll,
                    email=f"{u_roll.lower()}@sreenidhi.edu.in",
                    password_hash=get_password_hash("student123"),
                    role=UserRole.STUDENT,
                    is_active=True
                )
                db.add(u_user)
                db.flush()

                u_student = Student(
                    user_id=u_user.id,
                    roll_number=u_roll,
                    name=f"Unassigned Student {u_idx}",
                    department_id=None,
                    section_id=None,
                    academic_year_id=default_ay.id,
                    email=f"{u_roll.lower()}@sreenidhi.edu.in"
                )
                db.add(u_student)
                db.flush()
            all_students.append(u_student)

        db.commit()

        total_students = len(all_students)
        print(f"Total students verified: {total_students} (248 in 7 Departments + 4 Unassigned)")

        # 6. Generate 6 Weeks of Attendance History with Realistic Patterns
        print("Generating 6 weeks of attendance sessions & realistic records...")
        
        # We generate sessions for the primary course of each department's Section A
        for d_code, c_list in courses_by_dept.items():
            primary_course = c_list[0]
            sec_a = sections[f"{d_code}-A"]
            t1 = teachers.get(f"{d_code}_1")
            
            # Fetch students in this section
            sec_students = [s for s in all_students if s.section_id == sec_a.id]
            if not sec_students:
                continue

            # Create sessions for teaching dates
            for s_idx, s_date in enumerate(teaching_dates):
                session = db.query(AttendanceSession).filter(
                    AttendanceSession.subject_id == primary_course.id,
                    AttendanceSession.section_id == sec_a.id,
                    AttendanceSession.session_date == s_date
                ).first()

                if not session:
                    session = AttendanceSession(
                        teacher_id=t1.id if t1 else 1,
                        subject_id=primary_course.id,
                        section_id=sec_a.id,
                        period="Period 1-4 (4 Periods)",
                        session_date=s_date,
                        status=SessionStatus.LOCKED
                    )
                    db.add(session)
                    db.flush()

                # Generate records for each student in this section
                for st_idx, student in enumerate(sec_students):
                    # Check if session is before late-join date
                    if student.join_date and s_date < student.join_date:
                        continue

                    # Assign student persona
                    # 70% Regular (P ~ 85%), 18% Condonable (P ~ 68%), 12% Chronic Absentee (P ~ 45%)
                    modulo_type = st_idx % 10
                    if modulo_type < 7:
                        prob_present = 0.88
                    elif modulo_type < 9:
                        prob_present = 0.68  # Condonable band 65-74%
                    else:
                        prob_present = 0.45  # Detained band <65%

                    # Check if record already exists
                    rec = db.query(AttendanceRecord).filter(
                        AttendanceRecord.session_id == session.id,
                        AttendanceRecord.student_id == student.id
                    ).first()

                    if not rec:
                        is_present = (random.random() < prob_present)
                        # Medical/Sports approved absence for 5% of absent instances
                        is_approved = False
                        approved_reason = None
                        if not is_present and random.random() < 0.25:
                            is_approved = True
                            approved_reason = random.choice(["MEDICAL", "SPORTS", "OFFICIAL_DUTY"])

                        rec = AttendanceRecord(
                            session_id=session.id,
                            student_id=student.id,
                            roll_number=student.roll_number,
                            session_date=s_date,
                            period_count=4,
                            status=AttendanceStatus.PRESENT if is_present else AttendanceStatus.ABSENT,
                            is_approved_absence=is_approved,
                            approved_absence_reason=approved_reason,
                            scan_mode="QR" if is_present else "SYSTEM_ABSENT"
                        )
                        db.add(rec)

        db.commit()

        # Invalidate any cached engine metrics
        invalidate_attendance_cache()

        print("=" * 70)
        print("SEEDING COMPLETE!")
        print(f"Total Enrolled Students: {total_students}")
        for d_code, count in student_counts_by_dept.items():
            print(f" - {d_code}: {count} students, {len(courses_by_dept[d_code])} courses")
        print(" - Unassigned: 4 students")
        print("6 Weeks of Attendance History created successfully.")
        print("=" * 70)

    except Exception as exc:
        db.rollback()
        print(f"Error seeding database: {exc}")
        raise exc
    finally:
        db.close()

if __name__ == "__main__":
    seed_database()
