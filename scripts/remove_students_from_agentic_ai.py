"""
Script to safely de-enroll 47 students from Section 36 (Agentic AI and Data Engineering).
Saves a pre-update JSON backup, removes section binding, writes AuditLogs, and verifies counts.
"""
import os
import sys
import json
from datetime import datetime

sys.path.insert(0, '/home/azureuser/snist_attendance/backend')
from app.core.database import SessionLocal
from app.models.models import Student, StudentOnboarding, AuditLog, Section

AGENTIC_AI_SECTION_ID = 36

TARGET_ROLLS = [
    "23311A6636", "24311A6616", "24311A6681", "24311A66M2", "24311A66P5",
    "24311A66Q2", "24311A66R4", "24311A66AL", "24311A66W2", "24311A66W9",
    "24311A66X1", "24311A6215", "24311A6216", "24311A6230", "24311A6236",
    "24311A6260", "24311A6263", "24311A05E1", "24311A05BP", "24311A05FD",
    "24311A6723", "24311A6736", "22311A6754", "24311A6796", "24311A67H3",
    "24311A04B3", "24311A04E4", "23311A04N0", "24311A04CX", "24311A04EA",
    "24311A0203", "24311A0219", "24311A0228", "24311A1207", "24311A1228",
    "24311A1281", "24311A1293", "24311A12D9", "24311A12F0", "24311A12G0",
    "24311A0312", "24311A0314", "24311A0317", "24311A0318", "24311A0321",
    "24311A0327", "24311A0339"
]

def main():
    db = SessionLocal()
    try:
        sec = db.query(Section).filter(Section.id == AGENTIC_AI_SECTION_ID).first()
        sec_name = sec.name if sec else f"Section {AGENTIC_AI_SECTION_ID}"
        print(f"Target Section: {sec_name} (ID: {AGENTIC_AI_SECTION_ID})")

        initial_ai_count = db.query(Student).filter(Student.section_id == AGENTIC_AI_SECTION_ID).count()
        print(f"Initial students in {sec_name}: {initial_ai_count}")

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

        backup_file = f"/home/azureuser/snist_attendance/backups/agentic_ai_de_enrolled_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.json"
        os.makedirs(os.path.dirname(backup_file), exist_ok=True)
        with open(backup_file, "w") as f:
            json.dump(backup_data, f, indent=2)
        print(f"✓ Created safety backup: {backup_file}")

        # 2. De-enroll students from Section 36
        updated_count = 0
        for s in students:
            if s.section_id == AGENTIC_AI_SECTION_ID:
                s.section_id = None
                updated_count += 1

                # Update onboarding table if present
                onboarding = db.query(StudentOnboarding).filter(StudentOnboarding.roll_number == s.roll_number).first()
                if onboarding and onboarding.section_id == AGENTIC_AI_SECTION_ID:
                    onboarding.section_id = None

                # Log audit event
                audit = AuditLog(
                    user_id=s.user_id,
                    roll_number=s.roll_number,
                    event_type="SECTION_STUDENT_REMOVED",
                    action="REMOVED_FROM_AGENTIC_AI",
                    details=f"Student {s.roll_number} ({s.name}) de-enrolled from {sec_name} per institutional directive",
                    created_at=datetime.utcnow()
                )
                db.add(audit)

        db.commit()
        print(f"✓ Successfully de-enrolled {updated_count} students from {sec_name}.")

        # 3. Post-execution verification
        final_ai_count = db.query(Student).filter(Student.section_id == AGENTIC_AI_SECTION_ID).count()
        expected_final = initial_ai_count - updated_count
        print(f"Final students in {sec_name}: {final_ai_count} (Expected: {expected_final})")
        assert final_ai_count == expected_final, f"Expected {expected_final}, got {final_ai_count}"

        # Verify none of the 47 students are in Section 36
        remaining_in_ai = db.query(Student).filter(
            Student.roll_number.in_(TARGET_ROLLS),
            Student.section_id == AGENTIC_AI_SECTION_ID
        ).count()
        print(f"Target students remaining in {sec_name}: {remaining_in_ai}")
        assert remaining_in_ai == 0, "All target students must have section_id != 36"

        print("\n========================================================")
        print(" [SUCCESS] ALL 47 STUDENTS SAFELY REMOVED FROM AGENTIC AI")
        print("========================================================")

    except Exception as e:
        db.rollback()
        print(f"ERROR: {e}")
        raise
    finally:
        db.close()

if __name__ == "__main__":
    main()
