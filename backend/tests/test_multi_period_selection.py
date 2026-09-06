import pytest
import os
import sys

# Ensure backend path is in sys.path
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.api.teacher import _extract_period_count
from app.core.database import SessionLocal
from app.models.models import AttendanceSession, AttendanceRecord, Student, Teacher, User, UserRole, SessionStatus, AttendanceStatus
from app.api.attendance import manual_mark_attendance, ManualMarkRequest
from fastapi import BackgroundTasks

def test_extract_period_count_patterns():
    """Verify robust extraction of period counts from all common format strings."""
    assert _extract_period_count("Period 1") == 1
    assert _extract_period_count("Period 4") == 1
    assert _extract_period_count("Period 1-4 (4 Periods)") == 4
    assert _extract_period_count("Period 1-2 (2 Periods)") == 2
    assert _extract_period_count("Period 5-7 (3 Periods)") == 3
    assert _extract_period_count("Period 1, 2, 3 (3 Periods)") == 3
    assert _extract_period_count("Period 1, 3 (2 Periods)") == 2
    assert _extract_period_count("Period 1-4") == 4
    assert _extract_period_count("Period 5-8") == 4
    assert _extract_period_count("Period 1, 2") == 2
    assert _extract_period_count("") == 1

def test_manual_marking_with_multi_period():
    """Verify that manual marking applies the session's multi-period count to the record."""
    db = SessionLocal()
    try:
        # Fetch or create a test session with 4 periods
        teacher = db.query(Teacher).filter(Teacher.id == 4).first()
        student = db.query(Student).filter(Student.section_id == 1).first()
        assert teacher is not None
        assert student is not None

        # Check existing tomorrow's session (ID 32) or create one
        session = db.query(AttendanceSession).filter(
            AttendanceSession.section_id == 1,
            AttendanceSession.session_date == "2026-09-07"
        ).first()

        assert session is not None
        assert _extract_period_count(session.period) == 4

        # Simulate teacher user marking student present
        teacher_user = db.query(User).filter(User.id == teacher.user_id).first()
        bg_tasks = BackgroundTasks()

        req = ManualMarkRequest(
            session_id=session.id,
            roll_number=student.roll_number,
            status="PRESENT",
            period_count=None # Leave None to auto-extract from session.period
        )

        res = manual_mark_attendance(
            req=req,
            background_tasks=bg_tasks,
            db=db,
            current_user=teacher_user
        )

        assert res["status"] == "SUCCESS"
        assert "4" in res["message"]

        # Check AttendanceRecord
        record = db.query(AttendanceRecord).filter(
            AttendanceRecord.session_id == session.id,
            AttendanceRecord.student_id == student.id
        ).first()

        assert record is not None
        assert record.status == AttendanceStatus.PRESENT
        assert record.period_count == 4

        # Clean up test record so student is clean for tomorrow
        db.delete(record)
        db.commit()

    finally:
        db.close()
