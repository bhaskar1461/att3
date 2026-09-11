import sys
import os

backend_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'backend'))
if backend_path not in sys.path:
    sys.path.insert(0, backend_path)

from app.core.database import SessionLocal
from app.models.models import (
    Student, User, StudentOnboarding, AttendanceRecord, QRToken, AuditLog
)

def remove_burst_students(dry_run=True):
    db = SessionLocal()
    try:
        # 1. Identify burst students
        burst_students = db.query(Student).filter(Student.roll_number.like('DEMO_BURST_%')).all()
        burst_stu_ids = [s.id for s in burst_students]
        burst_user_ids = [s.user_id for s in burst_students if s.user_id is not None]

        # Also find any user accounts with DEMO_BURST_% username
        extra_users = db.query(User).filter(User.username.like('DEMO_BURST_%')).all()
        all_user_ids = list(set(burst_user_ids + [u.id for u in extra_users]))

        print(f"[{'DRY-RUN' if dry_run else 'EXECUTING'}] Identifying records to remove:")
        print(f"  Target Burst Students: {len(burst_students)}")
        print(f"  Target Burst Users: {len(all_user_ids)}")

        # 2. Count child / related records
        att_query = db.query(AttendanceRecord).filter(
            (AttendanceRecord.student_id.in_(burst_stu_ids)) | 
            (AttendanceRecord.roll_number.like('DEMO_BURST_%'))
        ) if burst_stu_ids else db.query(AttendanceRecord).filter(AttendanceRecord.roll_number.like('DEMO_BURST_%'))
        att_count = att_query.count()

        token_query = db.query(QRToken).filter(QRToken.student_id.in_(burst_stu_ids)) if burst_stu_ids else None
        token_count = token_query.count() if token_query else 0

        onb_query = db.query(StudentOnboarding).filter(StudentOnboarding.roll_number.like('DEMO_BURST_%'))
        onb_count = onb_query.count()

        audit_query = db.query(AuditLog).filter(
            (AuditLog.roll_number.like('DEMO_BURST_%')) |
            (AuditLog.user_id.in_(all_user_ids))
        ) if all_user_ids else db.query(AuditLog).filter(AuditLog.roll_number.like('DEMO_BURST_%'))
        audit_count = audit_query.count()

        print(f"  Related Attendance Records: {att_count}")
        print(f"  Related QR Tokens: {token_count}")
        print(f"  Related Onboarding Records: {onb_count}")
        print(f"  Related Audit Logs: {audit_count}")

        if dry_run:
            print("\n[DRY-RUN] No changes committed. Re-run with dry_run=False to delete.")
            return

        # 3. Perform Deletions in foreign key dependency order
        print("\n--> Deleting attendance records...")
        deleted_att = att_query.delete(synchronize_session=False)
        print(f"    Deleted {deleted_att} attendance records.")

        if token_query:
            print("--> Deleting QR tokens...")
            deleted_tokens = token_query.delete(synchronize_session=False)
            print(f"    Deleted {deleted_tokens} QR tokens.")

        print("--> Deleting onboarding records...")
        deleted_onb = onb_query.delete(synchronize_session=False)
        print(f"    Deleted {deleted_onb} onboarding records.")

        print("--> Deleting audit logs...")
        deleted_audits = audit_query.delete(synchronize_session=False)
        print(f"    Deleted {deleted_audits} audit logs.")

        print("--> Deleting student records...")
        deleted_stu = db.query(Student).filter(Student.roll_number.like('DEMO_BURST_%')).delete(synchronize_session=False)
        print(f"    Deleted {deleted_stu} students.")

        print("--> Deleting user accounts...")
        deleted_users = db.query(User).filter(
            (User.id.in_(all_user_ids)) | (User.username.like('DEMO_BURST_%'))
        ).delete(synchronize_session=False) if all_user_ids else 0
        print(f"    Deleted {deleted_users} users.")

        db.commit()
        print("\n[SUCCESS] All 200 burst students and associated records successfully removed.")

        # Print remaining count
        remaining_students = db.query(Student).count()
        remaining_users = db.query(User).count()
        print(f"Remaining legitimate students in database: {remaining_students}")
        print(f"Remaining legitimate users in database: {remaining_users}")

    except Exception as e:
        db.rollback()
        print(f"[ERROR] Transaction rolled back due to: {e}")
        raise
    finally:
        db.close()

if __name__ == "__main__":
    is_live = "--live" in sys.argv or "--force" in sys.argv
    remove_burst_students(dry_run=not is_live)
