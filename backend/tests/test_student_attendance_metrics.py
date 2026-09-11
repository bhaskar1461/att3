import pytest
from datetime import datetime, timedelta
from app.core.database import SessionLocal
from app.models.models import (
    Student, AttendanceSession, AttendanceRecord, AttendanceStatus, SessionStatus, Section, Subject
)
from app.api.student import get_student_attendance_summary, get_student_today_schedule
from app.core.security import get_server_ist_date

def test_student_attendance_metrics_zero_state():
    """Verify that when no records exist, metrics return honest zeros rather than mock fallbacks."""
    db = SessionLocal()
    try:
        # Use an isolated student with no conducted sessions or records
        student = Student(id=999999, section_id=999999, roll_number="MOCK_ZERO")

        summary = get_student_attendance_summary(db, student)
        assert summary["total_present"] == 0
        assert summary["total_absent"] == 0
        assert summary["total_conducted"] == 0
        assert summary["overall_percentage"] == 0.0
        assert summary["has_records"] is False
    finally:
        db.close()

def test_student_today_schedule_and_confirmation():
    """Verify schedule returns my_attendance and properly tracks marked status."""
    db = SessionLocal()
    mock_section_id = 999998
    test_student = Student(id=999998, section_id=mock_section_id, roll_number="TEST_STUDENT_998", name="Test Student")
    today_session = None
    test_record = None
    try:
        schedule_res = get_student_today_schedule(db, test_student)
        assert "my_attendance" in schedule_res
        assert schedule_res["my_attendance"]["is_marked"] is False
        assert schedule_res["my_attendance"]["status"] == "UNMARKED"

        # Create session for mock section
        today_session = AttendanceSession(
            section_id=mock_section_id,
            subject_id=1,
            teacher_id=1,
            session_date=get_server_ist_date(),
            period="Period 1-4 (4 Periods)",
            status=SessionStatus.OPEN
        )
        db.add(today_session)
        db.commit()

        # Still unmarked
        schedule_res = get_student_today_schedule(db, test_student)
        assert schedule_res["my_attendance"]["is_marked"] is False
        assert schedule_res["my_attendance"]["status"] == "UNMARKED"

        # Simulate marking attendance
        test_record = AttendanceRecord(
            session_id=today_session.id,
            student_id=test_student.id,
            roll_number=test_student.roll_number,
            session_date=get_server_ist_date(),
            period_count=4,
            status=AttendanceStatus.PRESENT,
            scan_mode="PROJECTOR_SCAN",
            scanned_at=datetime.utcnow()
        )
        db.add(test_record)
        db.commit()

        # Re-query schedule
        updated_schedule = get_student_today_schedule(db, test_student)
        assert updated_schedule["my_attendance"]["is_marked"] is True
        assert updated_schedule["my_attendance"]["status"] == "PRESENT"
        assert updated_schedule["my_attendance"]["period_count"] == 4
        assert updated_schedule["my_attendance"]["marked_at"] is not None

    finally:
        if test_record:
            db.delete(test_record)
        if today_session:
            db.delete(today_session)
        db.commit()
        db.close()

