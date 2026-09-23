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
    from app.models.models import Department, Section, Subject, TeacherAssignment, AcademicYear
    db = SessionLocal()
    session = None
    record = None
    try:
        # 1. Ensure Teacher exists
        teacher = db.query(Teacher).first()
        if not teacher:
            dept = db.query(Department).first()
            if not dept:
                dept = Department(code="CSE", name="CSE")
                db.add(dept)
                db.commit()
            t_user = User(username="t_multi_p", password_hash="hash", role=UserRole.TEACHER)
            db.add(t_user)
            db.commit()
            teacher = Teacher(user_id=t_user.id, teacher_code="T_MP", name="Teacher MP", department_id=dept.id)
            db.add(teacher)
            db.commit()

        teacher_user = db.query(User).filter(User.id == teacher.user_id).first()
        if not teacher_user:
            teacher_user = User(username=f"t_{teacher.id}", password_hash="hash", role=UserRole.TEACHER)
            db.add(teacher_user)
            db.commit()
            teacher.user_id = teacher_user.id
            db.commit()

        # 2. Ensure Section exists
        section = db.query(Section).first()
        if not section:
            ay = db.query(AcademicYear).first()
            if not ay:
                ay = AcademicYear(name="2025-2026")
                db.add(ay)
                db.commit()
            section = Section(name="SEC-MP", department_id=teacher.department_id, academic_year_id=ay.id)
            db.add(section)
            db.commit()

        # 3. Ensure Teacher Assignment exists
        assignment = db.query(TeacherAssignment).filter(
            TeacherAssignment.teacher_id == teacher.id,
            TeacherAssignment.section_id == section.id
        ).first()
        if not assignment:
            subject = db.query(Subject).first()
            if not subject:
                subject = Subject(code="CS_MP", name="MP Subject", department_id=teacher.department_id)
                db.add(subject)
                db.commit()
            assignment = TeacherAssignment(teacher_id=teacher.id, subject_id=subject.id, section_id=section.id)
            db.add(assignment)
            db.commit()

        # 4. Ensure Student exists in section
        student = db.query(Student).filter(Student.section_id == section.id).first()
        if not student:
            s_u = User(username="s_multi_p", password_hash="hash", role=UserRole.STUDENT)
            db.add(s_u)
            db.commit()
            student = Student(user_id=s_u.id, roll_number="23SN1AMP01", name="MP Student", section_id=section.id)
            db.add(student)
            db.commit()

        # 5. Create test session with 4 periods
        session = AttendanceSession(
            teacher_id=teacher.id,
            subject_id=assignment.subject_id,
            section_id=section.id,
            period="Period 1-4 (4 Periods)",
            session_date="2026-09-07",
            status=SessionStatus.OPEN
        )
        db.add(session)
        db.commit()

        assert _extract_period_count(session.period) == 4

        # Simulate teacher user marking student present
        bg_tasks = BackgroundTasks()

        req = ManualMarkRequest(
            session_id=session.id,
            roll_number=student.roll_number,
            status="PRESENT",
            period_count=None, # Auto-extracts from session.period
            reason="scanner_failed"
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

    finally:
        if record:
            try:
                db.delete(record)
                db.commit()
            except Exception:
                pass
        if session:
            try:
                db.delete(session)
                db.commit()
            except Exception:
                pass
        db.close()

def test_update_session_period_endpoint():
    """Verify that update_session_period API endpoint changes session period and cascades period_count to records."""
    from app.api.teacher import update_session_period, UpdateSessionPeriodRequest
    from app.models.models import Department, Section, Subject, TeacherAssignment, AcademicYear

    db = SessionLocal()
    session = None
    records = []
    try:
        # Get or create teacher
        teacher = db.query(Teacher).first()
        assert teacher is not None

        # Create session with 1 period
        session = AttendanceSession(
            teacher_id=teacher.id,
            subject_id=1,
            section_id=1,
            period="Period 1",
            session_date="2026-09-19",
            status=SessionStatus.OPEN
        )
        db.add(session)
        db.commit()

        # Add 3 student records with period_count=1
        for i in range(3):
            rec = AttendanceRecord(
                session_id=session.id,
                student_id=100 + i,
                roll_number=f"TEST_ROLL_{i}",
                session_date="2026-09-19",
                status=AttendanceStatus.PRESENT,
                period_count=1
            )
            db.add(rec)
            records.append(rec)
        db.commit()

        # Call update_session_period to change to 4 periods
        req = UpdateSessionPeriodRequest(
            period="Period 1-4 (4 Periods)",
            period_count=4
        )
        bg = BackgroundTasks()
        res = update_session_period(
            session_id=session.id,
            req=req,
            background_tasks=bg,
            db=db,
            current_teacher=teacher
        )

        assert res["session_id"] == session.id
        assert res["period_count"] == 4
        assert res["period"] == "Period 1-4 (4 Periods)"
        assert res["updated_records_count"] == 3

        # Verify records in database all updated to 4
        for rec in records:
            db.refresh(rec)
            assert rec.period_count == 4

    finally:
        for r in records:
            try:
                db.delete(r)
            except Exception:
                pass
        if session:
            try:
                db.delete(session)
            except Exception:
                pass
        db.commit()
        db.close()

def test_delete_session_endpoint():
    """Verify that delete_session API endpoint removes the session and cascades to records."""
    from app.api.teacher import delete_session
    from fastapi import HTTPException

    db = SessionLocal()
    session = None
    records = []
    try:
        # Get teacher
        teacher = db.query(Teacher).first()
        assert teacher is not None

        # Create session
        session = AttendanceSession(
            teacher_id=teacher.id,
            subject_id=1,
            section_id=1,
            period="Period 2",
            session_date="2026-09-21",
            status=SessionStatus.OPEN
        )
        db.add(session)
        db.commit()

        # Add 2 student records
        for i in range(2):
            rec = AttendanceRecord(
                session_id=session.id,
                student_id=200 + i,
                roll_number=f"DEL_TEST_{i}",
                session_date="2026-09-21",
                status=AttendanceStatus.PRESENT,
                period_count=1
            )
            db.add(rec)
            records.append(rec)
        db.commit()

        session_id = session.id

        # Verify deletion by authorized teacher
        res = delete_session(
            session_id=session_id,
            db=db,
            current_teacher=teacher
        )

        assert res["status"] == "SUCCESS"
        assert res["session_id"] == session_id
        assert res["deleted_records_count"] == 2

        # Verify session is gone from DB
        deleted_session = db.query(AttendanceSession).filter(AttendanceSession.id == session_id).first()
        assert deleted_session is None

        # Verify records are gone from DB
        remaining_records = db.query(AttendanceRecord).filter(AttendanceRecord.session_id == session_id).count()
        assert remaining_records == 0

        # Verify 404 on already deleted session
        try:
            delete_session(session_id=session_id, db=db, current_teacher=teacher)
            assert False, "Expected 404 HTTPException"
        except HTTPException as he:
            assert he.status_code == 404

        session = None
        records = []

    finally:
        for r in records:
            try:
                db.delete(r)
            except Exception:
                pass
        if session:
            try:
                db.delete(session)
            except Exception:
                pass
        db.commit()
        db.close()

