import io
import os
import sys
import unittest
from datetime import datetime
from PIL import Image
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
from app.models.models import (
    User, UserRole, Department, AcademicYear, Section, Subject,
    Student, AttendanceSession, SessionStatus, AttendanceRecord,
    AttendanceStatus, SelfieRecord
)
from app.core.security import get_password_hash, create_access_token, get_server_ist_date, get_server_ist_datetime


def generate_test_jpeg(width: int = 120, height: int = 150) -> bytes:
    """Generate minimal valid JPEG bytes in memory."""
    buf = io.BytesIO()
    img = Image.new("RGB", (width, height), color=(73, 109, 137))
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


class TestSelfiePipeline(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(bind=self.engine)
        SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)
        self.db = SessionLocal()

        def override_get_db():
            try:
                yield self.db
            finally:
                pass

        app.dependency_overrides[get_db] = override_get_db
        self.client = TestClient(app)

        # Create basic academic environment
        dept = Department(code="CSE", name="Computer Science")
        ay = AcademicYear(name="2025-2026")
        self.db.add_all([dept, ay])
        self.db.commit()

        sec = Section(name="CSE-A", department_id=dept.id, academic_year_id=ay.id)
        subj = Subject(code="CS301", name="Data Structures", department_id=dept.id, academic_year_id=ay.id)
        self.db.add_all([sec, subj])
        self.db.commit()

        # Student 1
        self.u_stud1 = User(
            username="23KT1A0501",
            email="s1@sreenidhi.edu.in",
            password_hash=get_password_hash("pass123"),
            role=UserRole.STUDENT
        )
        self.db.add(self.u_stud1)
        self.db.commit()

        self.stud1 = Student(
            user_id=self.u_stud1.id,
            roll_number="23KT1A0501",
            name="Alice Smith",
            department_id=dept.id,
            academic_year_id=ay.id,
            section_id=sec.id
        )
        self.db.add(self.stud1)
        self.db.commit()

        # Student 2
        self.u_stud2 = User(
            username="23KT1A0502",
            email="s2@sreenidhi.edu.in",
            password_hash=get_password_hash("pass123"),
            role=UserRole.STUDENT
        )
        self.db.add(self.u_stud2)
        self.db.commit()

        self.stud2 = Student(
            user_id=self.u_stud2.id,
            roll_number="23KT1A0502",
            name="Bob Jones",
            department_id=dept.id,
            academic_year_id=ay.id,
            section_id=sec.id
        )
        self.db.add(self.stud2)
        self.db.commit()

        # Attendance Session
        self.sess = AttendanceSession(
            subject_id=subj.id,
            section_id=sec.id,
            teacher_id=1,
            period="Period 1",
            session_date=get_server_ist_date(),
            status=SessionStatus.OPEN
        )
        self.db.add(self.sess)
        self.db.commit()

        # Student 1 Attendance Record (Decoupled: already PRESENT from QR scan)
        self.att1 = AttendanceRecord(
            session_id=self.sess.id,
            student_id=self.stud1.id,
            roll_number=self.stud1.roll_number,
            session_date=get_server_ist_date(),
            status=AttendanceStatus.PRESENT,
            selfie_status="PENDING"
        )
        self.db.add(self.att1)
        self.db.commit()

        self.token_s1 = create_access_token({"sub": self.u_stud1.username, "role": "STUDENT"})
        self.token_s2 = create_access_token({"sub": self.u_stud2.username, "role": "STUDENT"})

    def tearDown(self):
        self.db.close()
        app.dependency_overrides.clear()

    def test_upload_valid_selfie_creates_record_and_keeps_present(self):
        """Test uploading a valid selfie archives image and marks selfie_status ACCEPTED while keeping PRESENT."""
        jpeg_data = generate_test_jpeg(width=300, height=400)
        
        headers = {
            "Authorization": f"Bearer {self.token_s1}",
            "X-Device-Id": "test-dev-uuid-1",
        }
        files = {
            "file": ("23KT1A0501_Alice_selfie.jpg", jpeg_data, "image/jpeg")
        }

        res = self.client.post(
            f"/api/v1/attendance/records/{self.att1.id}/selfie",
            headers=headers,
            files=files
        )
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        self.assertEqual(data["status"], "ACCEPTED")
        self.assertIn("selfie_id", data)
        self.assertIn("object_storage_key", data)

        # Verify DB record
        self.db.refresh(self.att1)
        self.assertEqual(self.att1.status, AttendanceStatus.PRESENT)
        self.assertEqual(self.att1.selfie_status, "ACCEPTED")
        self.assertTrue(self.att1.selfie_storage_key)

        # Verify SelfieRecord row
        selfie_row = self.db.query(SelfieRecord).filter(SelfieRecord.id == data["selfie_id"]).first()
        self.assertIsNotNone(selfie_row)
        self.assertEqual(selfie_row.student_id, self.stud1.id)
        self.assertEqual(selfie_row.width, 300)
        self.assertEqual(selfie_row.height, 400)
        self.assertEqual(selfie_row.status, "UPLOADED")

    def test_skip_selfie_never_revokes_present_status(self):
        """Rule 19: Skipping selfie or camera failure must never revert student from PRESENT to ABSENT."""
        headers = {
            "Authorization": f"Bearer {self.token_s1}",
            "X-Device-Id": "test-dev-uuid-1",
        }
        payload = {"reason": "CAMERA_PERMISSION_DENIED"}

        res = self.client.post(
            f"/api/v1/attendance/records/{self.att1.id}/selfie-skip",
            headers=headers,
            json=payload
        )
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        self.assertEqual(data["status"], "SKIPPED")
        self.assertEqual(data["attendance_status"], "PRESENT")

        # Verify DB record
        self.db.refresh(self.att1)
        self.assertEqual(self.att1.status, AttendanceStatus.PRESENT, "Core attendance status must remain PRESENT!")
        self.assertEqual(self.att1.selfie_status, "FAILED")

    def test_upload_empty_selfie_fails_gracefully_and_keeps_present(self):
        """Uploading empty payload is rejected with HTTP 400, but attendance remains PRESENT."""
        headers = {
            "Authorization": f"Bearer {self.token_s1}",
            "X-Device-Id": "test-dev-uuid-1",
        }
        files = {
            "file": ("empty.jpg", b"", "image/jpeg")
        }

        res = self.client.post(
            f"/api/v1/attendance/records/{self.att1.id}/selfie",
            headers=headers,
            files=files
        )
        self.assertEqual(res.status_code, 400)
        
        # Verify attendance still PRESENT
        self.db.refresh(self.att1)
        self.assertEqual(self.att1.status, AttendanceStatus.PRESENT)

    def test_upload_oversized_selfie_fails_gracefully(self):
        """Selfie exceeding 5MB is rejected with HTTP 400 without crashing."""
        headers = {
            "Authorization": f"Bearer {self.token_s1}",
            "X-Device-Id": "test-dev-uuid-1",
        }
        # Fake oversized payload (5MB + 1KB)
        oversized = b"\xff\xd8\xff" + b"0" * (5 * 1024 * 1024 + 1024)
        files = {
            "file": ("huge.jpg", oversized, "image/jpeg")
        }

        res = self.client.post(
            f"/api/v1/attendance/records/{self.att1.id}/selfie",
            headers=headers,
            files=files
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("exceeds maximum allowed size", res.json()["detail"])

        # Attendance remains intact
        self.db.refresh(self.att1)
        self.assertEqual(self.att1.status, AttendanceStatus.PRESENT)

    def test_cross_student_selfie_upload_rejected(self):
        """Student B cannot upload a selfie to Student A's attendance record."""
        jpeg_data = generate_test_jpeg()
        headers = {
            "Authorization": f"Bearer {self.token_s2}",  # Logged in as Student 2
            "X-Device-Id": "test-dev-uuid-2",
        }
        files = {
            "file": ("hack.jpg", jpeg_data, "image/jpeg")
        }

        # Attempt to target Student 1's record
        res = self.client.post(
            f"/api/v1/attendance/records/{self.att1.id}/selfie",
            headers=headers,
            files=files
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("not found", res.json()["detail"])

    def test_http_compression_negotiation(self):
        """Verify HTTP compression respects client Accept-Encoding and never forces unsupported encodings."""
        # 1. Client advertising gzip
        headers = {
            "Authorization": f"Bearer {self.token_s1}",
            "Accept-Encoding": "gzip",
        }
        res_gzip = self.client.get("/api/v1/auth/me", headers=headers)
        self.assertEqual(res_gzip.status_code, 200)

        # 2. Client advertising identity receives uncompressed response
        headers_identity = {
            "Authorization": f"Bearer {self.token_s1}",
            "Accept-Encoding": "identity",
        }
        res_identity = self.client.get("/api/v1/auth/me", headers=headers_identity)
        self.assertEqual(res_identity.status_code, 200)
        self.assertNotEqual(res_identity.headers.get("content-encoding"), "gzip")
        self.assertNotEqual(res_identity.headers.get("content-encoding"), "zstd")


if __name__ == "__main__":
    unittest.main()
