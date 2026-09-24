import pytest
from datetime import date
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.main import app
from app.core.database import SessionLocal
from app.models.models import User, UserRole, Student, Section, Teacher, AttendanceSession, SessionStatus
from app.api.auth import create_access_token, verify_password

@pytest.fixture
def client():
    return TestClient(app)

@pytest.fixture
def db():
    session = SessionLocal()
    yield session
    session.close()

def test_cseb_students_seeded_and_credentials(db):
    """Verify that CSE-B demo students exist, are in CSE-B, and authenticate with demostudent@2026."""
    cseb_rolls = ["23311A0525", "23311A0526", "23311A0527", "23311A0528"]
    sec_b = db.query(Section).filter(Section.name == "CSE-B").first()
    assert sec_b is not None, "CSE-B section must exist"

    for roll in cseb_rolls:
        user = db.query(User).filter(User.username == roll).first()
        assert user is not None, f"User {roll} must exist"
        assert verify_password("demostudent@2026", user.password_hash), f"Password verification failed for {roll}"

        student = db.query(Student).filter(Student.roll_number == roll).first()
        assert student is not None, f"Student record for {roll} must exist"
        assert student.section_id == sec_b.id, f"Student {roll} must be in CSE-B section"

def test_section_mismatch_fast_fail_exact_error_message(client, db):
    """
    Verify that scanning a session from another section fast-fails with the exact message:
    'Not enrolled in this section. Please contact faculty incharge.'
    and never leaks device binding errors.
    """
    sec_a = db.query(Section).filter(Section.name == "CSE-A").first()
    sec_b = db.query(Section).filter(Section.name == "CSE-B").first()
    assert sec_a and sec_b

    # Get a student from CSE-A
    csea_student = db.query(Student).filter(Student.section_id == sec_a.id).first()
    assert csea_student is not None
    token_csea_student = create_access_token(data={"sub": csea_student.user.username})

    # Get a teacher
    teacher = db.query(Teacher).first()
    assert teacher is not None
    token_teacher = create_access_token(data={"sub": teacher.user.username})

    # Find or create an open session in CSE-B
    cseb_session = db.query(AttendanceSession).filter(
        AttendanceSession.section_id == sec_b.id,
        AttendanceSession.status == SessionStatus.OPEN
    ).first()

    if not cseb_session:
        cseb_session = AttendanceSession(
            section_id=sec_b.id,
            subject_id=sec_b.department_id or 1,
            teacher_id=teacher.id,
            period="1",
            session_date=str(date.today()),
            status=SessionStatus.OPEN,
            display_type="projector"
        )
        db.add(cseb_session)
        db.commit()
        db.refresh(cseb_session)

    # 1. Teacher gets rotating broadcast token for this CSE-B session
    bcast_res = client.get(
        f"/api/v1/teacher/sessions/{cseb_session.id}/broadcast-token",
        headers={"Authorization": f"Bearer {token_teacher}"}
    )
    assert bcast_res.status_code == 200
    token_payload = bcast_res.json()["qr_payload"]

    # 2. Student from CSE-A attempts to scan the CSE-B session
    scan_res = client.post(
        "/api/v1/student/scan-session",
        headers={"Authorization": f"Bearer {token_csea_student}"},
        json={
            "session_token": token_payload,
            "period_count": 1
        }
    )

    # Must fast-fail with HTTP 400 and exact user message:
    assert scan_res.status_code == 400
    assert scan_res.json()["detail"] == "Not enrolled in this section. Please contact faculty incharge."
