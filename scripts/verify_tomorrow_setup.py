import os
import sys

backend_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend")
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.core.database import SessionLocal
from app.api.reports import get_class_sheet_matrix
from app.models.models import User, AttendanceSession, AttendanceRecord, Student, SessionStatus

def run_verification():
    db = SessionLocal()

    # 1. Verify Active Session
    session = db.query(AttendanceSession).filter(
        AttendanceSession.section_id == 1,
        AttendanceSession.session_date == "2026-09-07",
        AttendanceSession.status == SessionStatus.OPEN
    ).first()

    print("=== 1. Active Session Check ===")
    assert session is not None, "Active session for 2026-09-07 not found!"
    print(f"Active Session ID: {session.id}")
    print(f"Date: {session.session_date}")
    print(f"Status: {session.status.value}")
    print(f"Section ID: {session.section_id}")
    print(f"Subject ID: {session.subject_id}")
    print(f"Teacher ID: {session.teacher_id}")
    print(f"Period: {session.period}")

    # 2. Verify Class Sheet Matrix API
    user = db.query(User).filter(User.username == "bhaskar").first()
    matrix = get_class_sheet_matrix(section_id=1, db=db, current_user=user)

    print("\n=== 2. Class Sheet Matrix API Check ===")
    print(f"Dates array: {matrix['dates']}")
    assert matrix['dates'] == ["2026-09-07"], f"Expected ['2026-09-07'], got {matrix['dates']}"
    assert matrix['total_dates'] == 1, f"Expected 1 date, got {matrix['total_dates']}"
    assert matrix['total_students'] == 51, f"Expected 51 students, got {matrix['total_students']}"
    print(f"Total Dates: {matrix['total_dates']}")
    print(f"Total Students: {matrix['total_students']}")

    # Check first and last student
    rows = matrix['rows']
    print(f"First Student: {rows[0]['roll_number']} - {rows[0]['name']} -> {rows[0]['daily_status']}")
    assert rows[0]['daily_status'] == {"2026-09-07": "-"}
    print(f"Last Student: {rows[-1]['roll_number']} - {rows[-1]['name']} -> {rows[-1]['daily_status']}")
    assert rows[-1]['daily_status'] == {"2026-09-07": "-"}

    print("\n[SUCCESS] Class sheet matrix returns exactly 1 active date (2026-09-07) and 51 students!")
    db.close()

if __name__ == "__main__":
    run_verification()
