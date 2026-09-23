import os
import sys
import pytest
from datetime import datetime
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.main import app
from app.core.database import Base, get_db
from app.models.models import (
    User, UserRole, Department, AcademicYear, Section, Student, AttendanceRecord, AttendanceSession, AttendanceStatus, DeviceBinding
)
from app.core.security import get_password_hash, create_access_token

# Test in-memory database setup
SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db
client = TestClient(app)


@pytest.fixture(autouse=True)
def setup_database():
    app.dependency_overrides[get_db] = override_get_db
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()

    # Get or create admin user
    admin_user = db.query(User).filter_by(username="SUPERADMIN").first()
    if not admin_user:
        admin_user = db.query(User).filter_by(email="admin@sreenidhi.edu.in").first()
    if not admin_user:
        admin_user = User(
            username="SUPERADMIN",
            email="admin@sreenidhi.edu.in",
            password_hash=get_password_hash("AdminPass123!"),
            role=UserRole.SUPER_ADMIN,
            is_active=True
        )
        db.add(admin_user)
    else:
        admin_user.role = UserRole.SUPER_ADMIN
        admin_user.is_active = True

    # Get or create student user
    student_user = db.query(User).filter_by(username="REGULAR_STU").first()
    if not student_user:
        student_user = User(
            username="REGULAR_STU",
            email="regular_student_test@sreenidhi.edu.in",
            password_hash=get_password_hash("StuPass123!"),
            role=UserRole.STUDENT,
            is_active=True
        )
        db.add(student_user)

    # Get or create departments
    dept_cse = db.query(Department).filter_by(code="CSE").first()
    if not dept_cse:
        dept_cse = Department(code="CSE", name="Computer Science & Engineering")
        db.add(dept_cse)

    dept_csm = db.query(Department).filter_by(code="CSM").first()
    if not dept_csm:
        dept_csm = Department(code="CSM", name="Computer Science & Machine Learning (AI&ML)")
        db.add(dept_csm)

    dept_ece = db.query(Department).filter_by(code="ECE").first()
    if not dept_ece:
        dept_ece = Department(code="ECE", name="Electronics & Communication Engineering")
        db.add(dept_ece)
    db.commit()

    year1 = AcademicYear(name="III Year")
    db.add(year1)
    db.commit()

    sec1 = Section(name="CSE-A", department_id=dept_cse.id, academic_year_id=year1.id)
    sec2 = Section(name="CSM-A", department_id=dept_csm.id, academic_year_id=year1.id)
    db.add_all([sec1, sec2])
    db.commit()

    # Create students across depts
    s1 = Student(roll_number="23311A0501", name="Alice Smith", department_id=dept_cse.id, academic_year_id=year1.id, section_id=sec1.id, registered_device_id=1)
    s2 = Student(roll_number="23311A0502", name="Bob Jones", department_id=dept_cse.id, academic_year_id=year1.id, section_id=sec1.id)
    s3 = Student(roll_number="23311A6601", name="Charlie Brown", department_id=dept_csm.id, academic_year_id=year1.id, section_id=sec2.id)
    # Student with unassigned / invalid department
    s_unassigned = Student(roll_number="23311A9999", name="Unassigned Student", department_id=999, academic_year_id=year1.id, section_id=sec1.id)
    
    db.add_all([s1, s2, s3, s_unassigned])
    db.commit()

    # Active device binding for Alice under Phase 5 Cutover
    db.add(DeviceBinding(
        student_id=s1.id,
        public_key="KEY_ALICE",
        key_id="KID_ALICE",
        enrolled_at=datetime.utcnow()
    ))
    db.commit()

    # Attendance record for Alice today
    from app.core.security import get_server_ist_date
    today_str = get_server_ist_date()
    att_rec = AttendanceRecord(
        student_id=s1.id,
        roll_number=s1.roll_number,
        session_id=1,
        session_date=today_str,
        status=AttendanceStatus.PRESENT
    )
    db.add(att_rec)
    db.commit()
    db.close()

    yield

    Base.metadata.drop_all(bind=engine)


def test_enrollment_analytics_admin_only():
    """Verifies that unauthenticated or non-admin users cannot access enrollment analytics."""
    # Unauthenticated
    res = client.get("/api/v1/admin/analytics/enrollment")
    assert res.status_code == 401

    # Student token
    student_token = create_access_token({"sub": "REGULAR_STU", "role": "STUDENT"})
    res = client.get(
        "/api/v1/admin/analytics/enrollment",
        headers={"Authorization": f"Bearer {student_token}"}
    )
    assert res.status_code == 403


def test_enrollment_analytics_math_reconciliation():
    """Verifies that department counts sum exactly to total_enrolled (including unassigned)."""
    admin_token = create_access_token({"sub": "SUPERADMIN", "role": "SUPER_ADMIN"})
    res = client.get(
        "/api/v1/admin/analytics/enrollment",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert res.status_code == 200
    data = res.json()

    total_enrolled = data["total_enrolled"]
    assert total_enrolled == 4  # Alice, Bob, Charlie, Unassigned

    departments = data["departments"]
    sum_counts = sum(d["count"] for d in departments)
    assert sum_counts == total_enrolled, f"Math mismatch: sum({sum_counts}) != total({total_enrolled})"

    dept_map = {d["code"]: d for d in departments}
    assert dept_map["CSE"]["count"] == 2
    assert dept_map["CSM"]["count"] == 1
    assert dept_map["ECE"]["count"] == 0
    assert dept_map["UNASSIGNED"]["count"] == 1


def test_department_students_drilldown():
    """Verifies lazy loading of department students with device bound and present today telemetry."""
    admin_token = create_access_token({"sub": "SUPERADMIN", "role": "SUPER_ADMIN"})
    
    # First fetch CSE dept ID
    res_depts = client.get(
        "/api/v1/admin/analytics/enrollment",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    cse_dept = next(d for d in res_depts.json()["departments"] if d["code"] == "CSE")
    
    # Drill down into CSE students
    res_students = client.get(
        f"/api/v1/admin/analytics/enrollment/students?dept_id={cse_dept['id']}",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert res_students.status_code == 200
    students = res_students.json()
    assert len(students) == 2

    alice = next(s for s in students if s["roll_number"] == "23311A0501")
    bob = next(s for s in students if s["roll_number"] == "23311A0502")

    # Alice has registered_device_id=1 and attendance today
    assert alice["device_bound"] is True
    assert alice["present_today"] is True
    assert alice["department_code"] == "CSE"

    # Bob has no device registered and no attendance today
    assert bob["device_bound"] is False
    assert bob["present_today"] is False

    # Drill down into UNASSIGNED dept (-1)
    res_unassigned = client.get(
        "/api/v1/admin/analytics/enrollment/students?dept_id=-1",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert res_unassigned.status_code == 200
    unassigned_students = res_unassigned.json()
    assert len(unassigned_students) == 1
    assert unassigned_students[0]["roll_number"] == "23311A9999"
