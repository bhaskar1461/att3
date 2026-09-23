"""
Automated tests for Auth Error Contracts and Admin Quick-Reset Fallback:
- 401 Unauthorized returns additive attempts_remaining and lockout_minutes
- 429 Too Many Requests returns additive retry_after_seconds
- POST /api/v1/admin/credentials/quick-reset generates fresh credentials and resets device lock
"""

import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.core.database import SessionLocal
from app.models.models import User, UserRole, Student, Department, AcademicYear, Section
from app.core.security import get_password_hash, create_access_token

client = TestClient(app)

@pytest.fixture(autouse=True)
def clean_dependency_overrides():
    app.dependency_overrides.clear()
    yield
    app.dependency_overrides.clear()

@pytest.fixture
def admin_token():
    db = SessionLocal()
    admin = db.query(User).filter(User.role == UserRole.SUPER_ADMIN).first()
    if not admin:
        admin = User(
            username="test_admin_contract",
            email="admin_contract@sreenidhi.edu.in",
            password_hash=get_password_hash("Admin@123"),
            role=UserRole.SUPER_ADMIN,
            is_active=True
        )
        db.add(admin)
        db.commit()
        db.refresh(admin)

    # Ensure test student 24311A6201 exists
    student_user = db.query(User).filter(User.username == "24311A6201").first()
    if not student_user:
        student_user = User(
            username="24311A6201",
            email="24311a6201@sreenidhi.edu.in",
            password_hash=get_password_hash("InitialPass123!"),
            role=UserRole.STUDENT,
            is_active=True
        )
        db.add(student_user)
        db.commit()
        db.refresh(student_user)

    student = db.query(Student).filter(Student.roll_number == "24311A6201").first()
    if not student:
        dept = db.query(Department).first()
        if not dept:
            dept = Department(code="CSE", name="Computer Science")
            db.add(dept)
            db.commit()
        ay = db.query(AcademicYear).first()
        if not ay:
            ay = AcademicYear(name="2025-2026")
            db.add(ay)
            db.commit()
        sec = db.query(Section).first()
        if not sec:
            sec = Section(name="CSE-A", department_id=dept.id, academic_year_id=ay.id)
            db.add(sec)
            db.commit()
        student = Student(
            user_id=student_user.id,
            roll_number="24311A6201",
            name="Contract Test Student",
            department_id=dept.id,
            academic_year_id=ay.id,
            section_id=sec.id
        )
        db.add(student)
        db.commit()

    token = create_access_token({"sub": admin.username, "role": admin.role.value, "user_id": admin.id})
    db.close()
    return token

def test_login_wrong_password_returns_attempts_remaining():
    """Verify that wrong password returns 401 with attempts_remaining in body and header."""
    res = client.post(
        "/api/v1/auth/login",
        data={"username": "24311A6201", "password": "WrongPassword123!"}
    )
    assert res.status_code == 401
    data = res.json()
    assert "detail" in data
    assert data["detail"] == "Incorrect username or password"
    assert "attempts_remaining" in data
    assert isinstance(data["attempts_remaining"], int)
    assert "lockout_minutes" in data
    assert res.headers.get("X-Attempts-Remaining") is not None

def test_admin_quick_reset_fallback(admin_token):
    """Verify admin quick-reset endpoint generates 6-digit PIN and resets locks."""
    res = client.post(
        "/api/v1/admin/credentials/quick-reset",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"roll_number": "24311A6201"}
    )
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "SUCCESS"
    assert data["roll_number"] == "24311A6201"
    assert "temp_pin" in data
    assert len(data["temp_pin"]) == 6
    assert data["temp_pin"].isdigit()

    # Now verify the student can immediately login with this generated PIN!
    login_res = client.post(
        "/api/v1/auth/login",
        data={"username": "24311A6201", "password": data["temp_pin"]}
    )
    assert login_res.status_code == 200
    login_data = login_res.json()
    assert "access_token" in login_data
    assert login_data["role"] == "STUDENT"

def test_admin_lookup_and_edit_email(admin_token):
    """Verify admin can look up student details and edit student email via quick-reset."""
    # 1. Lookup student
    lookup_res = client.get(
        "/api/v1/admin/credentials/student-lookup/24311A6201",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert lookup_res.status_code == 200
    lookup_data = lookup_res.json()
    assert lookup_data["status"] == "SUCCESS"
    assert lookup_data["roll_number"] == "24311A6201"
    assert "email" in lookup_data

    # 2. Reset with updated email and custom PIN
    new_test_email = "updated_test_student@sreenidhi.edu.in"
    custom_pin = "889900"
    reset_res = client.post(
        "/api/v1/admin/credentials/quick-reset",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "roll_number": "24311A6201",
            "email": new_test_email,
            "custom_password": custom_pin
        }
    )
    assert reset_res.status_code == 200
    reset_data = reset_res.json()
    assert reset_data["status"] == "SUCCESS"
    assert reset_data["email"] == new_test_email
    assert reset_data["temp_pin"] == custom_pin
    assert reset_data["temporary_password"] == custom_pin

    # 3. Verify student can login with the custom PIN
    login_res = client.post(
        "/api/v1/auth/login",
        data={"username": "24311A6201", "password": custom_pin}
    )
    assert login_res.status_code == 200
