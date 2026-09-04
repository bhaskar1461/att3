import os
import sys
import pytest
from datetime import datetime, timedelta

# Ensure backend directory is in sys.path
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
root_dir = os.path.dirname(backend_dir)
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.core.database import Base, get_db
from app.models.models import (
    User, UserRole, Department, AcademicYear, Section, Subject,
    Teacher, Student, TeacherAssignment, AttendanceSession,
    AttendanceRecord, Classroom, AttendanceAuditReview, DeviceRegistration, DeviceAccountBinding,
    BindingStatus
)
from app.core.security import (
    get_password_hash, create_access_token, get_server_ist_date,
    generate_proximity_challenge
)

# In-memory test SQLite DB
SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db
client = TestClient(app)

class TestProximityAttendanceEngine:
    def setup_method(self):
        app.dependency_overrides[get_db] = override_get_db

    @classmethod
    def setup_class(cls):
        Base.metadata.create_all(bind=engine)
        db = TestingSessionLocal()

        # Seed Department, Year, Section, Subject
        dept = Department(code="CSE", name="Computer Science")
        db.add(dept)
        db.commit()

        year = AcademicYear(name="3rd Year")
        db.add(year)
        db.commit()

        sec_a = Section(name="CSE-A", department_id=dept.id, academic_year_id=year.id)
        sec_b = Section(name="CSE-B", department_id=dept.id, academic_year_id=year.id)
        db.add_all([sec_a, sec_b])
        db.commit()

        subj = Subject(code="CS301", name="Operating Systems", department_id=dept.id, academic_year_id=year.id)
        db.add(subj)
        db.commit()

        # Seed Classroom (SNIST Block B Room 304)
        room = Classroom(
            room_code="ROOM-304-BLOCK-B",
            building="Block B",
            floor=3,
            center_latitude=17.448291,
            center_longitude=78.391482,
            geofence_radius_meters=60,
            default_rssi_threshold=-75,
            uwb_supported=False,
            is_active=True
        )
        db.add(room)
        db.commit()

        # Seed Teacher
        t_user = User(username="teacher1", password_hash=get_password_hash("pass"), role=UserRole.TEACHER)
        db.add(t_user)
        db.commit()
        teacher = Teacher(user_id=t_user.id, teacher_code="FAC101", name="Prof. Sharma", department_id=dept.id)
        db.add(teacher)
        db.commit()

        # Teacher assignment to Section A
        assignment = TeacherAssignment(teacher_id=teacher.id, subject_id=subj.id, section_id=sec_a.id)
        db.add(assignment)
        db.commit()

        # Seed Students: Student 1 in Section A, Student 2 in Section B
        s1_user = User(username="student1", password_hash=get_password_hash("pass"), role=UserRole.STUDENT)
        s2_user = User(username="student2", password_hash=get_password_hash("pass"), role=UserRole.STUDENT)
        db.add_all([s1_user, s2_user])
        db.commit()

        s1 = Student(
            user_id=s1_user.id, roll_number="22911A0501", name="Rajesh Kumar",
            department_id=dept.id, academic_year_id=year.id, section_id=sec_a.id
        )
        s2 = Student(
            user_id=s2_user.id, roll_number="22911A0599", name="Vikram Singh",
            department_id=dept.id, academic_year_id=year.id, section_id=sec_b.id
        )
        db.add_all([s1, s2])
        db.commit()

        cls.dept_id = dept.id
        cls.year_id = year.id
        cls.sec_a_id = sec_a.id
        cls.sec_b_id = sec_b.id
        cls.subj_id = subj.id
        cls.room_id = room.id
        cls.teacher_id = teacher.id
        cls.s1_id = s1.id
        cls.s1_roll = s1.roll_number
        cls.s2_id = s2.id
        cls.s2_roll = s2.roll_number
        cls.session_id = None
        cls.challenge_nonce = None
        cls.short_code = None
        db.close()

    @property
    def teacher_token(self):
        return create_access_token({"sub": "teacher1", "role": "TEACHER"}, expires_delta=timedelta(hours=1))

    @property
    def student1_token(self):
        return create_access_token({"sub": "student1", "role": "STUDENT"}, expires_delta=timedelta(hours=1))

    @property
    def student2_token(self):
        return create_access_token({"sub": "student2", "role": "STUDENT"}, expires_delta=timedelta(hours=1))

    def test_01_list_classrooms(self):
        resp = client.get("/api/v1/attendance/classrooms", headers={"Authorization": f"Bearer {self.teacher_token}"})
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1
        assert any(r["room_code"] == "ROOM-304-BLOCK-B" for r in data)

    def test_02_start_proximity_session(self):
        resp = client.post(
            "/api/v1/attendance/session/start-proximity",
            headers={"Authorization": f"Bearer {self.teacher_token}"},
            json={
                "subject_id": self.subj_id,
                "section_id": self.sec_a_id,
                "period": "Period 1",
                "classroom_id": self.room_id
            }
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "OPEN"
        assert "challenge_nonce" in data
        assert len(data["challenge_nonce"]) == 16
        assert "manual_fallback_code" in data
        assert len(data["manual_fallback_code"]) == 4
        assert "broadcast_payload" in data
        assert data["broadcast_payload"].startswith(f"SNIST|{data['session_id']}|")

        TestProximityAttendanceEngine.session_id = data["session_id"]
        TestProximityAttendanceEngine.challenge_nonce = data["challenge_nonce"]
        TestProximityAttendanceEngine.short_code = data["manual_fallback_code"]

    def test_03_get_live_challenge(self):
        resp = client.get(
            f"/api/v1/attendance/session/{self.session_id}/live-challenge",
            headers={"Authorization": f"Bearer {self.teacher_token}"}
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["session_id"] == self.session_id
        assert "challenge_nonce" in data
        assert data["total_enrolled"] == 1  # Student 1 is in Section A
        assert data["total_marked"] == 0

    def test_04_proximity_submit_success(self):
        # Student 1 submits within room coordinates and RSSI -72 dBm (above threshold -75)
        resp = client.post(
            "/api/v1/attendance/proximity-submit",
            headers={"Authorization": f"Bearer {self.student1_token}"},
            json={
                "session_id": self.session_id,
                "challenge_nonce": self.challenge_nonce,
                "latitude": 17.448295,
                "longitude": 78.391480,
                "location_accuracy_meters": 5.0,
                "median_rssi": -72,
                "rssi_samples": [-70, -72, -73],
                "proximity_tier": "BLE"
            }
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "SUCCESS"
        assert data["roll_number"] == self.s1_roll
        assert data["verified_scan_mode"] == "PROXIMITY_BLE"

        # Verify DB record
        db = TestingSessionLocal()
        rec = db.query(AttendanceRecord).filter(
            AttendanceRecord.session_id == self.session_id,
            AttendanceRecord.student_id == self.s1_id
        ).first()
        assert rec is not None
        assert rec.status.value == "PRESENT"
        assert rec.verified_scan_mode == "PROXIMITY_BLE"
        assert rec.measured_rssi == -72
        db.close()

    def test_05_proximity_submit_invalid_challenge(self):
        # Forged or expired challenge nonce
        resp = client.post(
            "/api/v1/attendance/proximity-submit",
            headers={"Authorization": f"Bearer {self.student1_token}"},
            json={
                "session_id": self.session_id,
                "challenge_nonce": "deadbeef12345678",
                "latitude": 17.448295,
                "longitude": 78.391480,
                "median_rssi": -70
            }
        )
        assert resp.status_code == 400
        assert "Invalid or expired proximity challenge nonce" in resp.json()["detail"]

    def test_06_proximity_submit_outside_geofence(self):
        # 10 km away
        resp = client.post(
            "/api/v1/attendance/proximity-submit",
            headers={"Authorization": f"Bearer {self.student1_token}"},
            json={
                "session_id": self.session_id,
                "challenge_nonce": self.challenge_nonce,
                "latitude": 17.550000,
                "longitude": 78.500000,
                "median_rssi": -70
            }
        )
        assert resp.status_code == 400
        assert "Outside classroom geofence" in resp.json()["detail"]

    def test_07_proximity_submit_section_mismatch(self):
        # Student 2 belongs to Section B, while session is for Section A
        resp = client.post(
            "/api/v1/attendance/proximity-submit",
            headers={"Authorization": f"Bearer {self.student2_token}"},
            json={
                "session_id": self.session_id,
                "challenge_nonce": self.challenge_nonce,
                "latitude": 17.448295,
                "longitude": 78.391480,
                "median_rssi": -70
            }
        )
        assert resp.status_code == 400
        assert "does not belong to class section" in resp.json()["detail"]

    def test_08_proximity_submit_weak_rssi_rejected(self):
        # Student 1 with RSSI -90 dBm (< -75 - 10)
        resp = client.post(
            "/api/v1/attendance/proximity-submit",
            headers={"Authorization": f"Bearer {self.student1_token}"},
            json={
                "session_id": self.session_id,
                "challenge_nonce": self.challenge_nonce,
                "latitude": 17.448295,
                "longitude": 78.391480,
                "median_rssi": -90
            }
        )
        assert resp.status_code == 400
        assert "proximity signal too weak" in resp.json()["detail"].lower()

    def test_09_proximity_submit_borderline_rssi_accepted_and_audit_flagged(self):
        # Student 1 with RSSI -78 dBm (within 10 dB below -75: -85 to -75 is borderline)
        resp = client.post(
            "/api/v1/attendance/proximity-submit",
            headers={"Authorization": f"Bearer {self.student1_token}"},
            json={
                "session_id": self.session_id,
                "challenge_nonce": self.challenge_nonce,
                "latitude": 17.448295,
                "longitude": 78.391480,
                "median_rssi": -78,
                "is_mock_location": True
            }
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "SUCCESS"

        # Verify that audit review entries were logged
        db = TestingSessionLocal()
        reviews = db.query(AttendanceAuditReview).filter(
            AttendanceAuditReview.session_id == self.session_id,
            AttendanceAuditReview.student_id == self.s1_id
        ).all()
        assert len(reviews) >= 1
        event_types = [r.event_type for r in reviews]
        assert "BORDERLINE_RSSI" in event_types
        assert "MOCK_LOCATION_FLAG" in event_types
        db.close()

    def test_10_device_account_switch_lockout(self):
        # Device DEV-XYZ is bound to Student 2. Student 1 attempts to submit from DEV-XYZ -> HTTP 403
        db = TestingSessionLocal()
        dev = DeviceRegistration(device_public_id="DEV-XYZ", device_credential_hash="hash", is_active=True)
        db.add(dev)
        db.commit()

        binding = DeviceAccountBinding(
            device_id=dev.id,
            roll_number=self.s2_roll,
            expires_at=datetime.utcnow() + timedelta(minutes=30),
            status=BindingStatus.ACTIVE
        )
        db.add(binding)
        db.commit()
        db.close()

        resp = client.post(
            "/api/v1/attendance/proximity-submit",
            headers={
                "Authorization": f"Bearer {self.student1_token}",
                "x-device-public-id": "DEV-XYZ"
            },
            json={
                "session_id": self.session_id,
                "challenge_nonce": self.challenge_nonce,
                "latitude": 17.448295,
                "longitude": 78.391480,
                "median_rssi": -70
            }
        )
        assert resp.status_code == 403
        assert "temporarily associated with another student account" in resp.json()["detail"]

    def test_11_manual_short_code_submit(self):
        # Fallback using 4-character rotating short code
        resp = client.post(
            "/api/v1/attendance/manual-code-submit",
            headers={"Authorization": f"Bearer {self.student1_token}"},
            json={
                "session_id": self.session_id,
                "code": self.short_code,
                "latitude": 17.448295,
                "longitude": 78.391480
            }
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "SUCCESS"
        assert data["verified_scan_mode"] == "PROXIMITY_CODE"

    def test_12_get_audit_reviews(self):
        resp = client.get(
            f"/api/v1/attendance/sessions/{self.session_id}/audit-reviews",
            headers={"Authorization": f"Bearer {self.teacher_token}"}
        )
        assert resp.status_code == 200
        reviews = resp.json()
        assert len(reviews) >= 1
        assert any(r["event_type"] == "BORDERLINE_RSSI" for r in reviews)

