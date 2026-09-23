"""
Script to safely de-enroll 31 students from Section 35 (Java Full Stack Development).
Saves a pre-update JSON backup, removes section binding, writes AuditLogs, and verifies counts.
"""
import os
import sys
import json
from datetime import datetime

sys.path.insert(0, '/home/azureuser/snist_attendance/backend')
from app.core.database import SessionLocal
from app.models.models import Student, StudentOnboarding, AuditLog, Section

JAVA_FSD_SECTION_ID = 35

TARGET_ROLLS = [
    "24311A66Q4", "24311A66R5", "24311A6245", "24311A6252", "25315A0514",
    "24311A05L7", "24311A05P9", "24311A05CP", "25315A0542", "24311A05EX",
    "24312A05DT", "24311A6750", "24311A67F7", "24311A67G1", "24311A0420",
    "24311A04L2", "24311A04L3", "24311A04M9", "24311A04N7", "24311A04Q7",
    "24311A04DQ", "24311A0220", "25315A0202", "24311A1202", "25315A1203",
    "24311A12C0", "24311A12F6", "24311A0306", "24311A0313", "24311A0319",
    "24311A0331"
]

def main():
    db = SessionLocal()
    try:
        sec = db.query(Section).filter(Section.id == JAVA_FSD_SECTION_ID).first()
        sec_name = sec.name if sec else f"Section {JAVA_FSD_SECTION_ID}"
        print(f"Target Section: {sec_name} (ID: {JAVA_FSD_SECTION_ID})")

        initial_java_count = db.query(Student).filter(Student.section_id == JAVA_FSD_SECTION_ID).count()
        print(f"Initial students in {sec_name}: {initial_java_count}")

        # 1. Fetch and backup target students
        students = db.query(Student).filter(Student.roll_number.in_(TARGET_ROLLS)).all()
        print(f"Found {len(students)} matching students out of {len(TARGET_ROLLS)} requested.")
        assert len(students) == len(TARGET_ROLLS), f"Mismatch: expected {len(TARGET_ROLLS)}, found {len(students)}"

        backup_data = []
        for s in students:
            backup_data.append({
                "id": s.id,
                "user_id": s.user_id,
                "roll_number": s.roll_number,
                "name": s.name,
                "department_id": s.department_id,
                "academic_year_id": s.academic_year_id,
                "section_id": s.section_id,
                "email": s.email,
                "agency": s.agency
            })

        backup_file = f"/home/azureuser/snist_attendance/backups/java_fsd_de_enrolled_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.json"
        os.makedirs(os.path.dirname(backup_file), exist_ok=True)
        with open(backup_file, "w") as f:
            json.dump(backup_data, f, indent=2)
        print(f"✓ Created safety backup: {backup_file}")

        # 2. De-enroll students from Section 35
        updated_count = 0
        for s in students:
            if s.section_id == JAVA_FSD_SECTION_ID:
                s.section_id = None
                updated_count += 1

                # Update onboarding table if present
                onboarding = db.query(StudentOnboarding).filter(StudentOnboarding.roll_number == s.roll_number).first()
                if onboarding and onboarding.section_id == JAVA_FSD_SECTION_ID:
                    onboarding.section_id = None

                # Log audit event
                audit = AuditLog(
                    user_id=s.user_id,
                    roll_number=s.roll_number,
                    event_type="SECTION_STUDENT_REMOVED",
                    action="REMOVED_FROM_JAVA_FSD",
                    details=f"Student {s.roll_number} ({s.name}) de-enrolled from {sec_name} per institutional directive",
                    created_at=datetime.utcnow()
                )
                db.add(audit)

        db.commit()
        print(f"✓ Successfully de-enrolled {updated_count} students from {sec_name}.")

        # 3. Post-execution verification
        final_java_count = db.query(Student).filter(Student.section_id == JAVA_FSD_SECTION_ID).count()
        expected_final = initial_java_count - updated_count
        print(f"Final students in {sec_name}: {final_java_count} (Expected: {expected_final})")
        assert final_java_count == expected_final, f"Expected {expected_final}, got {final_java_count}"

        # Verify none of the 31 students are in Section 35
        remaining_in_java = db.query(Student).filter(
            Student.roll_number.in_(TARGET_ROLLS),
            Student.section_id == JAVA_FSD_SECTION_ID
        ).count()
        print(f"Target students remaining in {sec_name}: {remaining_in_java}")
        assert remaining_in_java == 0, "All target students must have section_id != 35"

        print("\n========================================================")
        print(" [SUCCESS] ALL 31 STUDENTS SAFELY REMOVED FROM JAVA FSD")
        print("========================================================")

    except Exception as e:
        db.rollback()
        print(f"ERROR: {e}")
        raise
    finally:
        db.close()

if __name__ == "__main__":
    main()
