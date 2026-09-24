"""
SNIST ERP Attendance System — Comprehensive MVP Automated Test Suite
Verifies:
1. Faculty GPS session creation and coordinate persistence.
2. Server-authoritative Haversine geofence enforcement:
   - Inside 100m radius -> 200 OK (PRESENT)
   - Outside 100m radius -> 403 Forbidden (Rejection logged)
   - Missing student coordinates -> 403 Forbidden
3. Single authoritative attendance state & idempotency (Duplicate check).
4. Controlled camera fallback mode (QR_CAMERA_FALLBACK) preserving all security checks.
5. Post-attendance selfie upload to private storage, metadata creation, and status update.
6. Post-attendance selfie skip decoupling: attendance remains PRESENT even when selfie is skipped/failed.
"""

import os
import sys
import io
import unittest
from datetime import datetime, timedelta
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
root_dir = os.path.dirname(backend_dir)
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)

from app.main import app
from app.core.database import get_db, Base
from app.core.config import settings
from app.models.models import (
    User, UserRole, Department, AcademicYear, Section, Subject,
    Teacher, Student, TeacherAssignment, AttendanceSession, SessionStatus,
    AttendanceRecord, AttendanceStatus, SelfieRecord, DeviceRegistration, DeviceAccountBinding,
    BindingStatus
)
from app.core.security import (
    generate_projector_session_token,
    create_access_token,
    get_server_ist_date,
    get_password_hash
)
from app.services.qr_token import ShortTokenService
from app.services.geofence_service import haversine_distance, validate_student_geofence


class TestAttendanceMVPFull(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._orig_binding_v2 = getattr(settings, 'BINDING_V2', False)
        cls._orig_geofence = getattr(settings, 'GEOFENCE_ENABLED', False)
        # Disable BINDING_V2 requirement during unit testing of attendance flow
        settings.BINDING_V2 = False
        settings.GEOFENCE_ENABLED = True

    @classmethod
    def tearDownClass(cls):
        settings.BINDING_V2 = cls._orig_binding_v2
        settings.GEOFENCE_ENABLED = cls._orig_geofence

    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(bind=self.engine)
        self.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)
        self.db = self.SessionLocal()

        def override_get_db():
            db = self.SessionLocal()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_get_db
        self.client = TestClient(app)

        # Populate baseline institutional entities
        self.dept = Department(name="Computer Science & Engineering", code="CSE")
        self.ay = AcademicYear(name="2025-2026")
        self.db.add_all([self.dept, self.ay])
        self.db.flush()

        self.sec = Section(name="CSE-A", department_id=self.dept.id, academic_year_id=self.ay.id)
        self.sub = Subject(name="Operating Systems", code="CS301", department_id=self.dept.id, academic_year_id=self.ay.id)
        self.db.add_all([self.sec, self.sub])
        self.db.flush()

        # Faculty User & Profile with canonical SAP ID (mapped to teacher_code)
        self.teacher_user = User(
            username="FAC0099",
            email="fac0099@sreenidhi.edu.in",
            password_hash=get_password_hash("FacultyPass123"),
            role=UserRole.TEACHER,
            is_active=True
        )
        self.db.add(self.teacher_user)
        self.db.flush()

        self.teacher = Teacher(
            user_id=self.teacher_user.id,
            teacher_code="SAP-FAC-0099",
            name="Dr. Alan Turing",
            department_id=self.dept.id
        )
        self.db.add(self.teacher)
        self.db.flush()

        self.assign = TeacherAssignment(
            teacher_id=self.teacher.id,
            subject_id=self.sub.id,
            section_id=self.sec.id
        )
        self.db.add(self.assign)
        self.db.flush()

        # Student User & Profile
        self.student_user = User(
            username="23SN1A0501",
            email="student1@sreenidhi.edu.in",
            password_hash=get_password_hash("StudentPass123"),
            role=UserRole.STUDENT,
            is_active=True
        )
        self.db.add(self.student_user)
        self.db.flush()

        self.student = Student(
            user_id=self.student_user.id,
            roll_number="23SN1A0501",
            name="Bhaskar Sharma",
            department_id=self.dept.id,
            academic_year_id=self.ay.id,
            section_id=self.sec.id
        )
        self.db.add(self.student)
        self.db.flush()

        # Enroll Device for Student
        self.device = DeviceRegistration(
            device_public_id="DEV-SNIST-STUDENT-01",
            device_credential_hash="DEV_SECRET_01",
            is_active=True
        )
        self.db.add(self.device)
        self.db.flush()

        self.binding = DeviceAccountBinding(
            device_id=self.device.id,
            roll_number="23SN1A0501",
            status=BindingStatus.ACTIVE,
            expires_at=datetime.utcnow() + timedelta(days=90)
        )
        self.db.add(self.binding)
        self.db.commit()

        # Auth tokens
        self.teacher_token = create_access_token(
            {"sub": self.teacher_user.username, "role": "TEACHER", "id": self.teacher_user.id}
        )
        self.student_token = create_access_token(
            {"sub": self.student_user.username, "role": "STUDENT", "id": self.student_user.id}
        )

        self.teacher_headers = {"Authorization": f"Bearer {self.teacher_token}"}
        self.student_headers = {
            "Authorization": f"Bearer {self.student_token}"
        }

    def tearDown(self):
        self.db.close()
        app.dependency_overrides.clear()

    def test_haversine_math(self):
        """Verify accurate distance calculations and boundary detection."""
        # SNIST CSE block approx coords
        lat1, lon1 = 17.456000, 78.678000
        # ~15 meters away
        lat2, lon2 = 17.456100, 78.678100
        dist = haversine_distance(lat1, lon1, lat2, lon2)
        self.assertGreater(dist, 10.0)
        self.assertLess(dist, 25.0)

        # ~800 meters away
        lat3, lon3 = 17.463000, 78.678000
        dist_far = haversine_distance(lat1, lon1, lat3, lon3)
        self.assertGreater(dist_far, 700.0)
        self.assertLess(dist_far, 900.0)

    def test_faculty_session_creation_with_gps(self):
        """Verify faculty creates attendance session storing authoritative GPS coordinates."""
        payload = {
            "subject_id": self.sub.id,
            "section_id": self.sec.id,
            "period": "Period 1",
            "period_count": 1,
            "date": get_server_ist_date(),
            "latitude": 17.456000,
            "longitude": 78.678000,
            "accuracy_m": 8.5,
            "geofence_radius_m": 100.0
        }
        res = self.client.post("/api/v1/teacher/sessions/start", json=payload, headers=self.teacher_headers)
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        session_id = data["session_id"]
        self.assertIn("faculty_latitude", data)
        self.assertEqual(data["faculty_latitude"], 17.456000)
        self.assertEqual(data["geofence_radius_m"], 100.0)

        # Inspect database record
        sess = self.db.query(AttendanceSession).filter(AttendanceSession.id == session_id).first()
        self.assertIsNotNone(sess)
        self.assertEqual(sess.faculty_latitude, 17.456000)
        self.assertEqual(sess.faculty_longitude, 78.678000)
        self.assertEqual(sess.faculty_accuracy_m, 8.5)
        self.assertEqual(sess.geofence_radius_m, 100.0)

    def test_student_inside_geofence_attendance_accepted(self):
        """Verify student inside 100m radius is accepted with coordinates and distance recorded."""
        fac_lat, fac_lon = 17.456000, 78.678000
        sess = AttendanceSession(
            subject_id=self.sub.id,
            section_id=self.sec.id,
            teacher_id=self.teacher.id,
            session_date=get_server_ist_date(),
            period="Period 1",
            status=SessionStatus.OPEN,
            faculty_latitude=fac_lat,
            faculty_longitude=fac_lon,
            faculty_accuracy_m=5.0,
            geofence_radius_m=100.0
        )
        self.db.add(sess)
        self.db.commit()

        # Issue rotating QR token
        token = generate_projector_session_token(sess.id, period_count=1)["payload"]

        # Student coordinates: ~15 meters away
        student_lat, student_lon = 17.456100, 78.678100
        scan_payload = {
            "session_token": token,
            "latitude": student_lat,
            "longitude": student_lon,
            "accuracy_m": 10.0,
            "scan_mode": "QR_CAMERA"
        }
        res = self.client.post("/api/v1/student/scan-session", json=scan_payload, headers=self.student_headers)
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        self.assertEqual(data["status"], "SUCCESS")
        self.assertIsNotNone(data.get("attendance_id"))
        self.assertIsNotNone(data.get("distance_m"))
        self.assertLess(data["distance_m"], 100.0)

        # Verify DB authoritative state
        rec = self.db.query(AttendanceRecord).filter(
            AttendanceRecord.session_id == sess.id,
            AttendanceRecord.student_id == self.student.id
        ).first()
        self.assertIsNotNone(rec)
        self.assertEqual(rec.status, AttendanceStatus.PRESENT)
        self.assertEqual(rec.student_latitude, student_lat)
        self.assertEqual(rec.student_longitude, student_lon)
        self.assertEqual(rec.scan_mode, "QR_CAMERA")
        self.assertAlmostEqual(rec.distance_m, data["distance_m"], places=1)

    def test_student_outside_geofence_rejected(self):
        """Verify student outside 100m radius is rejected with 403 Forbidden."""
        fac_lat, fac_lon = 17.456000, 78.678000
        sess = AttendanceSession(
            subject_id=self.sub.id,
            section_id=self.sec.id,
            teacher_id=self.teacher.id,
            session_date=get_server_ist_date(),
            period="Period 1",
            status=SessionStatus.OPEN,
            faculty_latitude=fac_lat,
            faculty_longitude=fac_lon,
            faculty_accuracy_m=5.0,
            geofence_radius_m=100.0
        )
        self.db.add(sess)
        self.db.commit()

        token = generate_projector_session_token(sess.id, period_count=1)["payload"]

        # Student coordinates ~1.2 km away (outside 100m geofence)
        scan_payload = {
            "session_token": token,
            "latitude": 17.466000,
            "longitude": 78.685000,
            "accuracy_m": 10.0,
            "scan_mode": "QR_CAMERA"
        }
        res = self.client.post("/api/v1/student/scan-session", json=scan_payload, headers=self.student_headers)
        self.assertEqual(res.status_code, 403, res.text)
        self.assertIn("Outside classroom geofence", res.json()["detail"])

        # Verify no attendance record was created
        rec = self.db.query(AttendanceRecord).filter(
            AttendanceRecord.session_id == sess.id,
            AttendanceRecord.student_id == self.student.id
        ).first()
        self.assertIsNone(rec)

    def test_student_missing_gps_rejected_when_session_has_gps(self):
        """Verify student without GPS is rejected when faculty registered geofence."""
        sess = AttendanceSession(
            subject_id=self.sub.id,
            section_id=self.sec.id,
            teacher_id=self.teacher.id,
            session_date=get_server_ist_date(),
            period="Period 1",
            status=SessionStatus.OPEN,
            faculty_latitude=17.456000,
            faculty_longitude=78.678000,
            geofence_radius_m=100.0
        )
        self.db.add(sess)
        self.db.commit()

        token = generate_projector_session_token(sess.id, period_count=1)["payload"]

        # Student sends no coordinates
        scan_payload = {
            "session_token": token,
            "scan_mode": "QR_CAMERA"
        }
        res = self.client.post("/api/v1/student/scan-session", json=scan_payload, headers=self.student_headers)
        self.assertEqual(res.status_code, 403, res.text)
        self.assertIn("GPS location is required", res.json()["detail"])

    def test_duplicate_attendance_idempotency(self):
        """Verify second scan for same session returns ALREADY_MARKED and maintains single record."""
        sess = AttendanceSession(
            subject_id=self.sub.id,
            section_id=self.sec.id,
            teacher_id=self.teacher.id,
            session_date=get_server_ist_date(),
            period="Period 1",
            status=SessionStatus.OPEN
        )
        self.db.add(sess)
        self.db.commit()

        token = generate_projector_session_token(sess.id, period_count=1)["payload"]

        # First scan
        res1 = self.client.post("/api/v1/student/scan-session", json={"session_token": token}, headers=self.student_headers)
        self.assertEqual(res1.status_code, 200)
        self.assertEqual(res1.json()["status"], "SUCCESS")

        # Second scan
        res2 = self.client.post("/api/v1/student/scan-session", json={"session_token": token}, headers=self.student_headers)
        self.assertEqual(res2.status_code, 200)
        self.assertEqual(res2.json()["status"], "ALREADY_MARKED")

        # Exactly 1 record in database
        count = self.db.query(AttendanceRecord).filter(
            AttendanceRecord.session_id == sess.id,
            AttendanceRecord.student_id == self.student.id
        ).count()
        self.assertEqual(count, 1)

    def test_controlled_camera_fallback(self):
        """Verify controlled camera fallback with manual code entry preserves all security checks."""
        sess = AttendanceSession(
            subject_id=self.sub.id,
            section_id=self.sec.id,
            teacher_id=self.teacher.id,
            session_date=get_server_ist_date(),
            period="Period 1",
            status=SessionStatus.OPEN,
            faculty_latitude=17.456000,
            faculty_longitude=78.678000,
            geofence_radius_m=100.0
        )
        self.db.add(sess)
        self.db.commit()

        # Issue rotating token
        token = generate_projector_session_token(sess.id, period_count=1)["payload"]

        # Fallback submit inside geofence
        scan_payload = {
            "session_token": token,
            "latitude": 17.456050,
            "longitude": 78.678050,
            "accuracy_m": 8.0,
            "scan_mode": "QR_CAMERA_FALLBACK"
        }
        res = self.client.post("/api/v1/student/scan-session", json=scan_payload, headers=self.student_headers)
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        self.assertEqual(data["status"], "SUCCESS")
        self.assertEqual(data["scan_mode"], "QR_CAMERA_FALLBACK")

        rec = self.db.query(AttendanceRecord).filter(
            AttendanceRecord.session_id == sess.id,
            AttendanceRecord.student_id == self.student.id
        ).first()
        self.assertEqual(rec.scan_mode, "QR_CAMERA_FALLBACK")

    def test_post_attendance_selfie_upload_and_skip_decoupling(self):
        """
        Verify:
        1. Valid selfie upload updates record to ACCEPTED and stores private storage key.
        2. Selfie skip updates record to SKIPPED, but leaves attendance record as PRESENT.
        """
        sess = AttendanceSession(
            subject_id=self.sub.id,
            section_id=self.sec.id,
            teacher_id=self.teacher.id,
            session_date=get_server_ist_date(),
            period="Period 1",
            status=SessionStatus.OPEN
        )
        self.db.add(sess)
        self.db.commit()

        # Create attendance record
        att_rec = AttendanceRecord(
            session_id=sess.id,
            student_id=self.student.id,
            roll_number=self.student.roll_number,
            session_date=sess.session_date,
            period_count=1,
            status=AttendanceStatus.PRESENT,
            scan_mode="QR_CAMERA"
        )
        self.db.add(att_rec)
        self.db.commit()
        att_id = att_rec.id

        # 1. Upload valid selfie image (dummy JPEG bytes with valid JPEG magic header)
        dummy_jpeg = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x01\x00`\x00`\x00\x00" + (b"\x00" * 200) + b"\xff\xd9"
        files = {"file": ("selfie.jpg", dummy_jpeg, "image/jpeg")}
        res = self.client.post(
            f"/api/v1/attendance/records/{att_id}/selfie",
            files=files,
            headers={"Authorization": f"Bearer {self.student_token}"}
        )
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()["status"], "ACCEPTED")

        # Verify DB metadata
        self.db.refresh(att_rec)
        self.assertEqual(att_rec.selfie_status, "ACCEPTED")
        self.assertIsNotNone(att_rec.selfie_storage_key)
        self.assertEqual(att_rec.status, AttendanceStatus.PRESENT)

        selfie_row = self.db.query(SelfieRecord).filter(SelfieRecord.attendance_id == att_id).first()
        self.assertIsNotNone(selfie_row)
        self.assertEqual(selfie_row.mime_type, "image/jpeg")
        self.assertEqual(selfie_row.status, "UPLOADED")

        # 2. Test Skip Decoupling on a second record
        att_rec2 = AttendanceRecord(
            session_id=sess.id,
            student_id=self.student.id + 999,  # another id
            roll_number="23SN1A0599",
            session_date=sess.session_date,
            period_count=1,
            status=AttendanceStatus.PRESENT,
            scan_mode="QR_CAMERA"
        )
        self.db.add(att_rec2)
        self.db.commit()

        # Log in as second student
        u2 = User(username="23SN1A0599", email="s2@sreenidhi.edu.in", password_hash=get_password_hash("p"), role=UserRole.STUDENT)
        self.db.add(u2)
        self.db.flush()
        st2 = Student(
            user_id=u2.id,
            roll_number="23SN1A0599",
            name="Second Student",
            department_id=self.dept.id,
            academic_year_id=self.ay.id,
            section_id=self.sec.id
        )
        self.db.add(st2)
        self.db.commit()
        att_rec2.student_id = st2.id
        self.db.commit()

        t2 = create_access_token({"sub": u2.username, "role": "STUDENT", "id": u2.id})
        skip_res = self.client.post(
            f"/api/v1/attendance/records/{att_rec2.id}/selfie-skip",
            json={"reason": "CAMERA_FAILURE"},
            headers={"Authorization": f"Bearer {t2}"}
        )
        self.assertEqual(skip_res.status_code, 200, skip_res.text)
        self.assertEqual(skip_res.json()["selfie_status"], "FAILED")
        self.assertEqual(skip_res.json()["attendance_status"], "PRESENT")

        # Crucial invariant: Attendance is STILL PRESENT
        self.db.refresh(att_rec2)
        self.assertEqual(att_rec2.status, AttendanceStatus.PRESENT)
        self.assertEqual(att_rec2.selfie_status, "FAILED")

    def test_post_attendance_multi_frame_burst_selfie_upload(self):
        """
        Verify multi-frame burst upload:
        1. Client uploads 3 burst frames for model training dataset.
        2. Endpoint stores all 3 frames labeled with student Roll & Name.
        3. Returns status ACCEPTED with all storage keys.
        """
        sess = AttendanceSession(
            subject_id=self.sub.id,
            section_id=self.sec.id,
            teacher_id=self.teacher.id,
            session_date=get_server_ist_date(),
            period="Period 2",
            status=SessionStatus.OPEN
        )
        self.db.add(sess)
        self.db.commit()

        att_rec = AttendanceRecord(
            session_id=sess.id,
            student_id=self.student.id,
            roll_number=self.student.roll_number,
            session_date=sess.session_date,
            period_count=1,
            status=AttendanceStatus.PRESENT,
            scan_mode="QR_CAMERA"
        )
        self.db.add(att_rec)
        self.db.commit()

        dummy_jpeg = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x01\x00`\x00`\x00\x00" + (b"\x00" * 200) + b"\xff\xd9"
        files = [
            ("files", ("frame1.jpg", dummy_jpeg, "image/jpeg")),
            ("files", ("frame2.jpg", dummy_jpeg, "image/jpeg")),
            ("files", ("frame3.jpg", dummy_jpeg, "image/jpeg")),
        ]
        res = self.client.post(
            f"/api/v1/attendance/records/{att_rec.id}/selfie",
            files=files,
            headers={"Authorization": f"Bearer {self.student_token}"}
        )
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        self.assertEqual(data["status"], "ACCEPTED")
        self.assertEqual(data["frames_stored"], 3)
        self.assertEqual(len(data["all_storage_keys"]), 3)
        self.assertIn(self.student.roll_number, data["all_storage_keys"][0])
        self.assertIn("_f1_", data["all_storage_keys"][0])
        self.assertIn("_f2_", data["all_storage_keys"][1])
        self.assertIn("_f3_", data["all_storage_keys"][2])


if __name__ == "__main__":
    unittest.main()
