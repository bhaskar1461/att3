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
        student = db.query(Student).filter(Student.roll_number == "23311A05Y6").first()
        assert student is not None, "Test student 23311A05Y6 must exist"

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
    try:
        student = db.query(Student).filter(Student.roll_number == "23311A05Y6").first()
        assert student is not None

        schedule_res = get_student_today_schedule(db, student)
        assert "my_attendance" in schedule_res
        assert schedule_res["my_attendance"]["is_marked"] is False
        assert schedule_res["my_attendance"]["status"] == "UNMARKED"

        # Now simulate marking attendance for Session 32
        test_record = AttendanceRecord(
            session_id=32,
            student_id=student.id,
            roll_number=student.roll_number,
            session_date="2026-09-07",
            period_count=4,
            status=AttendanceStatus.PRESENT,
            scan_mode="PROJECTOR_SCAN",
            scanned_at=datetime.utcnow()
        )
        db.add(test_record)
        db.commit()

        # Re-query schedule
        updated_schedule = get_student_today_schedule(db, student)
        assert updated_schedule["my_attendance"]["is_marked"] is True
        assert updated_schedule["my_attendance"]["status"] == "PRESENT"
        assert updated_schedule["my_attendance"]["period_count"] == 4
        assert updated_schedule["my_attendance"]["marked_at"] is not None

        # Clean up test record to preserve pristine database
        db.delete(test_record)
        db.commit()
    finally:
        db.close()
