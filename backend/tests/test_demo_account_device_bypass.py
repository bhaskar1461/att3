import os
import sys
import pytest
from fastapi.testclient import TestClient

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.main import app
from app.core.database import SessionLocal
from app.models.models import User, Student, Teacher, UserRole, DeviceRegistration, DeviceAccountBinding, BindingStatus
from app.core.device_security import is_demo_account
from app.core.security import get_password_hash

client = TestClient(app)

def test_is_demo_account_helper():
    assert is_demo_account("DEMOSTUDENT") is True
    assert is_demo_account("demostudent") is True
    assert is_demo_account("DEMO_STUDENT") is True
    assert is_demo_account("DEMO2026") is True
    assert is_demo_account("demoteacher") is True
    assert is_demo_account("24311A6201") is False
    assert is_demo_account("21311A0501") is False
    assert is_demo_account(None) is False
    assert is_demo_account("") is False

def test_demo_teacher_login():
    db = SessionLocal()
    try:
        teacher_u = db.query(User).filter(User.username == "demoteacher").first()
        if not teacher_u:
            teacher_u = User(username="demoteacher", password_hash=get_password_hash("DemoTeacher@2026"), role=UserRole.TEACHER, is_active=True)
            db.add(teacher_u)
            db.commit()
        else:
            teacher_u.password_hash = get_password_hash("DemoTeacher@2026")
            db.commit()
    finally:
        db.close()

    response = client.post(
        "/api/v1/auth/login",
        data={
            "username": "demoteacher",
            "password": "DemoTeacher@2026"
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"}
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["role"] == "TEACHER"
    assert "access_token" in data

def test_demo_student_login_and_multi_device_unbound():
    db = SessionLocal()
    try:
        stu_u = db.query(User).filter(User.username == "demostudent").first()
        if not stu_u:
            stu_u = User(username="demostudent", password_hash=get_password_hash("DemoStudent@2026"), role=UserRole.STUDENT, is_active=True)
            db.add(stu_u)
            db.commit()
            db.refresh(stu_u)
        else:
            stu_u.password_hash = get_password_hash("DemoStudent@2026")
            db.commit()

        student = db.query(Student).filter(Student.roll_number == "DEMOSTUDENT").first()
        if not student:
            student = Student(user_id=stu_u.id, roll_number="DEMOSTUDENT", name="Demo Student")
            db.add(student)
            db.commit()
        else:
            student.registered_device_id = None
            db.commit()
    finally:
        db.close()

    # Login from Device 1
    headers_dev1 = {
        "Content-Type": "application/x-www-form-urlencoded",
        "x-device-public-id": "DEV-TEST-PHONE-1",
        "x-device-secret": "DEV-SECRET-PHONE-1"
    }
    r1 = client.post(
        "/api/v1/auth/login",
        data={
            "username": "demostudent",
            "password": "DemoStudent@2026"
        },
        headers=headers_dev1
    )
    assert r1.status_code == 200, r1.text
    data1 = r1.json()
    assert data1["role"] == "STUDENT"
    token1 = data1["access_token"]

    # Login from Device 2 (Different device fingerprint - must NOT be blocked by device mismatch)
    headers_dev2 = {
        "Content-Type": "application/x-www-form-urlencoded",
        "x-device-public-id": "DEV-TEST-LAPTOP-2",
        "x-device-secret": "DEV-SECRET-LAPTOP-2"
    }
    r2 = client.post(
        "/api/v1/auth/login",
        data={
            "username": "demostudent",
            "password": "DemoStudent@2026"
        },
        headers=headers_dev2
    )
    assert r2.status_code == 200, f"Device 2 login failed: {r2.text}"
    assert r2.json()["role"] == "STUDENT"

    # Login 10 times consecutively (must NOT hit HTTP 429 attempt limit)
    for i in range(10):
        headers_multi = {
            "Content-Type": "application/x-www-form-urlencoded",
            "x-device-public-id": f"DEV-TEST-CONCURRENT-{i}",
            "x-device-secret": f"DEV-SECRET-CONCURRENT-{i}"
        }
        res = client.post(
            "/api/v1/auth/login",
            data={
                "username": "demostudent",
                "password": "DemoStudent@2026"
            },
            headers=headers_multi
        )
        assert res.status_code == 200, f"Attempt {i+1} failed with status {res.status_code}: {res.text}"

    # Verify student registered_device_id remains None (unbound)
    db = SessionLocal()
    try:
        student = db.query(Student).filter(Student.roll_number == "DEMOSTUDENT").first()
        assert student is not None
        assert student.registered_device_id is None, "Demo student should not be bound to any registered_device_id"
    finally:
        db.close()
