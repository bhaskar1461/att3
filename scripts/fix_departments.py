import sys
import os

sys.path.append(os.path.join(os.path.dirname(__file__), "..", "backend"))

from app.core.database import SessionLocal, engine
from app.models.models import Department, AcademicYear, Section, Student, TeacherAssignment, Subject

def run_fix():
    db = SessionLocal()
    try:
        # 1. Create missing departments
        depts_data = [
            ("CSE", "Computer Science and Engineering"),
            ("CIVIL", "Civil Engineering"),
            ("ECE", "Electronics and Communication Engineering"),
            ("IT", "Information Technology"),
            ("EEE", "Electrical and Electronics Engineering"),
            ("MECH", "Mechanical Engineering")
        ]
        
        dept_map = {}
        for code, name in depts_data:
            d = db.query(Department).filter(Department.code == code).first()
            if not d:
                d = Department(code=code, name=name)
                db.add(d)
                db.flush()
                print(f"Created department: {code} - {name}")
            dept_map[code] = d

        # 2. Get Academic Year (3rd Year)
        yr_3 = db.query(AcademicYear).filter(AcademicYear.name == "3rd Year").first()
        if not yr_3:
            yr_3 = AcademicYear(name="3rd Year")
            db.add(yr_3)
            db.flush()

        # 3. Create CIVIL-A Section
        civil_sec = db.query(Section).filter(Section.name == "CIVIL-A").first()
        if not civil_sec:
            civil_sec = Section(name="CIVIL-A", department_id=dept_map["CIVIL"].id, academic_year_id=yr_3.id)
            db.add(civil_sec)
            db.flush()
            print("Created Section CIVIL-A")

        # 4. Create Civil Subjects if missing
        civil_subs = [
            ("CE301", "Career Enhancement Training (CET)"),
            ("CE302", "Structural Analysis"),
            ("CE303", "Geotechnical Engineering")
        ]
        sub_objs = []
        for code, name in civil_subs:
            s = db.query(Subject).filter(Subject.code == code).first()
            if not s:
                s = Subject(code=code, name=name, department_id=dept_map["CIVIL"].id, academic_year_id=yr_3.id)
                db.add(s)
                db.flush()
            sub_objs.append(s)

        # 5. Re-assign students with A01 in roll number to CIVIL department & CIVIL-A section
        all_students = db.query(Student).all()
        updated_count = 0
        for s in all_students:
            # SNIST Roll Number format: e.g. 23311A0111 or 24311A0101 -> '01' indicates CIVIL
            if "A01" in s.roll_number.upper():
                s.department_id = dept_map["CIVIL"].id
                s.section_id = civil_sec.id
                s.academic_year_id = yr_3.id
                updated_count += 1

        db.commit()
        print(f"[SUCCESS] Updated {updated_count} Civil Engineering students to CIVIL department & CIVIL-A section!")

        # Print breakdown
        print("\n--- Current Student Breakdown by Department ---")
        students = db.query(Student).all()
        counts = {}
        for s in students:
            dept_code = s.department.code if s.department else "UNASSIGNED"
            counts[dept_code] = counts.get(dept_code, 0) + 1
        for code, count in counts.items():
            print(f" - {code}: {count} students")

    except Exception as e:
        db.rollback()
        print(f"Error fixing departments: {str(e)}")
    finally:
        db.close()

if __name__ == "__main__":
    run_fix()
