import os
import sys
import json
from datetime import datetime

# Add backend directory to sys.path
backend_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend")
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.core.database import SessionLocal
from app.models.models import AttendanceSession, AttendanceRecord, Student, Section, Subject, Teacher, SessionStatus
from app.core.security import get_server_ist_datetime

def prepare_tomorrow_attendance():
    db = SessionLocal()
    backup_dir = os.path.join(backend_dir, "data", "backups")
    os.makedirs(backup_dir, exist_ok=True)
    backup_path = os.path.join(backup_dir, "attendance_sessions_backup_20260906.json")

    print("[Step 1] Backing up existing sessions and records...")
    all_sessions = db.query(AttendanceSession).all()
    all_records = db.query(AttendanceRecord).all()

    backup_data = {
        "timestamp": datetime.utcnow().isoformat(),
        "total_sessions": len(all_sessions),
        "total_records": len(all_records),
        "sessions": [
            {
                "id": s.id,
                "teacher_id": s.teacher_id,
                "subject_id": s.subject_id,
                "section_id": s.section_id,
                "period": s.period,
                "session_date": s.session_date,
                "status": s.status.value if hasattr(s.status, "value") else str(s.status),
                "created_at": s.created_at.isoformat() if s.created_at else None,
                "locked_at": s.locked_at.isoformat() if s.locked_at else None
            }
            for s in all_sessions
        ],
        "records": [
            {
                "id": r.id,
                "session_id": r.session_id,
                "student_id": r.student_id,
                "roll_number": r.roll_number,
                "session_date": r.session_date,
                "status": r.status.value if hasattr(r.status, "value") else str(r.status),
                "period_count": r.period_count,
                "scanned_at": r.scanned_at.isoformat() if r.scanned_at else None,
                "scan_mode": r.scan_mode
            }
            for r in all_records
        ]
    }

    with open(backup_path, "w", encoding="utf-8") as f:
        json.dump(backup_data, f, indent=2)
    print(f" -> Successfully saved backup ({len(all_sessions)} sessions, {len(all_records)} records) to: {backup_path}")

    print("\n[Step 2] Purging old test attendance records and sessions...")
    deleted_records = db.query(AttendanceRecord).delete()
    deleted_sessions = db.query(AttendanceSession).delete()
    db.commit()
    print(f" -> Purged {deleted_records} old records and {deleted_sessions} old sessions from database.")

    print("\n[Step 3] Initializing tomorrow's fresh attendance session (2026-09-07)...")
    # CS-A is section_id 1
    # CS(CET) is subject_id 5
    # Mrs. N. Sowjanya is teacher_id 4
    tomorrow_date_str = "2026-09-07"
    
    new_session = AttendanceSession(
        teacher_id=4,
        subject_id=5,
        section_id=1,
        period="Period 1-4 (4 Periods)",
        session_date=tomorrow_date_str,
        status=SessionStatus.OPEN,
        created_at=datetime.utcnow()
    )
    db.add(new_session)
    db.commit()
    db.refresh(new_session)

    print(f" -> Successfully created active session ID {new_session.id}:")
    print(f"    Date: {new_session.session_date}")
    print(f"    Section: CS-A (ID: {new_session.section_id})")
    print(f"    Subject: Career Enhancement Training (ID: {new_session.subject_id})")
    print(f"    Teacher: Mrs. N. Sowjanya (ID: {new_session.teacher_id})")
    print(f"    Period: {new_session.period}")
    print(f"    Status: {new_session.status.value}")

    # Verify Section 1 student count
    cs_students = db.query(Student).filter(Student.section_id == 1).count()
    print(f"\n[Step 4] Verified Section 1 (CS-A) student roster: {cs_students} active students registered.")

    db.close()
    return new_session.id

if __name__ == "__main__":
    prepare_tomorrow_attendance()
