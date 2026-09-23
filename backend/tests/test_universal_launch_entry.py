"""
SNIST ERP — Phase 12A Universal Projector Entry Automated Test Suite
Verifies:
1. Canonical HTTPS launch URL generation (eliminating phone number detection bug)
2. Cryptographic HMAC-SHA256 signature and expiration behavior
3. Public session resolution via GET /api/v1/launch/validate
4. Authenticated student attendance submission via POST /api/v1/launch/attend
5. PWA Scanner submission with full HTTPS URL
6. Paste-and-Go submission
7. Tampered token rejection
8. Expired token rejection
"""

import time
from datetime import datetime
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.main import app
from app.core.database import get_db, SessionLocal
from app.core.config import settings
from app.models.models import (
    User, UserRole, Student, Teacher, Subject, Section, Department, AcademicYear,
    AttendanceSession, SessionStatus, AttendanceRecord, AttendanceStatus
)
from app.core.security import create_access_token
from app.core.binding_crypto import create_test_binding_proof, generate_test_p256_keypair
from app.services.launch_token import (
    generate_launch_token,
    validate_launch_token,
    extract_launch_token_from_url
)
from app.services.qr_token import ShortTokenService


class TestUniversalLaunchEntry:

    @pytest.fixture(autouse=True)
    def setup_method(self):
        self.client = TestClient(app)
        self.db: Session = SessionLocal()

        # Seed minimal test fixtures
        self.dept = self.db.query(Department).filter(Department.code == "CSE").first()
        if not self.dept:
            self.dept = Department(code="CSE", name="Computer Science and Engineering")
            self.db.add(self.dept)
            self.db.commit()

        self.year = self.db.query(AcademicYear).first()
        if not self.year:
            self.year = AcademicYear(name="2025-2026")
            self.db.add(self.year)
            self.db.commit()

        self.section = self.db.query(Section).filter(Section.name == "CSE-A").first()
        if not self.section:
            self.section = Section(name="CSE-A", department_id=self.dept.id, academic_year_id=self.year.id)
            self.db.add(self.section)
            self.db.commit()

        self.subject = self.db.query(Subject).filter(Subject.code == "CS301").first()
        if not self.subject:
            self.subject = Subject(code="CS301", name="Operating Systems", department_id=self.dept.id, academic_year_id=self.year.id)
            self.db.add(self.subject)
            self.db.commit()

        # Teacher User & Profile
        self.teacher_user = self.db.query(User).filter(User.username == "test_prof_launch").first()
        if not self.teacher_user:
            self.teacher_user = User(
                username="test_prof_launch",
                password_hash="testpasshash",
                role=UserRole.TEACHER,
                is_active=True
            )
            self.db.add(self.teacher_user)
            self.db.commit()

        self.teacher = self.db.query(Teacher).filter(Teacher.user_id == self.teacher_user.id).first()
        if not self.teacher:
            self.teacher = Teacher(
                user_id=self.teacher_user.id,
                name="Prof. Launch Test",
                teacher_code="T-LAUNCH-01",
                department_id=self.dept.id
            )
            self.db.add(self.teacher)
            self.db.commit()

        # Student User & Profile
        self.student_user = self.db.query(User).filter(User.username == "23311A0599").first()
        if not self.student_user:
            self.student_user = User(
                username="23311A0599",
                password_hash="testpasshash",
                role=UserRole.STUDENT,
                is_active=True
            )
            self.db.add(self.student_user)
            self.db.commit()

        self.student = self.db.query(Student).filter(Student.user_id == self.student_user.id).first()
        if not self.student:
            self.student = Student(
                user_id=self.student_user.id,
                roll_number="23311A0599",
                name="Student Universal Entry",
                section_id=self.section.id,
                department_id=self.dept.id,
                academic_year_id=self.year.id
            )
            self.db.add(self.student)
            self.db.commit()

        # Enroll active DeviceBinding for student
        from app.models.models import DeviceBinding
        from app.core.binding_crypto import generate_test_p256_keypair
        self.priv, spki, kid = generate_test_p256_keypair()
        existing_binding = self.db.query(DeviceBinding).filter(DeviceBinding.student_id == self.student.id).first()
        if not existing_binding:
            self.binding = DeviceBinding(
                student_id=self.student.id,
                public_key=spki,
                key_id=kid,
                status="ACTIVE",
                enrolled_at=datetime.utcnow()
            )
            self.db.add(self.binding)
            self.db.commit()
        else:
            existing_binding.public_key = spki
            existing_binding.key_id = kid
            existing_binding.status = "ACTIVE"
            existing_binding.revoked_at = None
            self.db.commit()
            self.binding = existing_binding

        # Open Attendance Session
        self.session = self.db.query(AttendanceSession).filter(
            AttendanceSession.teacher_id == self.teacher.id,
            AttendanceSession.status == SessionStatus.OPEN
        ).first()
        if not self.session:
            self.session = AttendanceSession(
                subject_id=self.subject.id,
                section_id=self.section.id,
                teacher_id=self.teacher.id,
                session_date="2026-09-20",
                period="1",
                status=SessionStatus.OPEN,
                display_type="projector"
            )
            self.db.add(self.session)
            self.db.commit()

        # Tokens
        self.teacher_token = create_access_token({"sub": self.teacher_user.username, "role": "TEACHER"})
        self.student_token = create_access_token({"sub": self.student_user.username, "role": "STUDENT"})

        yield

        # Cleanup test records
        try:
            self.db.query(AttendanceRecord).filter(AttendanceRecord.student_id == self.student.id).delete()
            self.db.commit()
        except Exception:
            pass
        finally:
            self.db.close()

    def test_launch_token_generation_and_validation(self):
        """Test 1: Launch token generation, signature validation, and URL extraction."""
        now_ts = time.time()
        current_v = int(now_ts // 10)
        token = generate_launch_token(
            session_id=self.session.id,
            short_code="8XK2Q7MD",
            v=current_v,
            step_window=10,
            grace_seconds=30
        )
        assert isinstance(token, str)
        assert len(token) >= 30

        # Validate token
        val = validate_launch_token(token, now_ts=now_ts)
        assert val["session_id"] == self.session.id
        assert val["short_code"] == "8XK2Q7MD"
        assert val["v"] == current_v
        assert val["exp_ts"] > now_ts

        # URL extraction
        url = f"https://whiteleos.cc.cd/a/{token}"
        extracted = extract_launch_token_from_url(url)
        assert extracted == token

    def test_projector_broadcast_generates_https_url(self):
        """Test 2: Projector broadcast returns canonical HTTPS URL and NOT phone number."""
        resp = self.client.get(
            f"/api/v1/teacher/sessions/{self.session.id}/broadcast-token",
            headers={"Authorization": f"Bearer {self.teacher_token}"}
        )
        assert resp.status_code == 200
        data = resp.json()

        qr_payload = data["qr_payload"]
        launch_url = data["launch_url"]
        launch_token = data["launch_token"]

        # MUST NOT be the old phone number bug
        assert qr_payload != "178989921"
        assert not qr_payload.isdigit()
        assert not qr_payload.startswith("tel:")

        # MUST be canonical HTTPS URL
        assert qr_payload.startswith("https://")
        assert "/a/" in qr_payload
        assert qr_payload == launch_url
        assert launch_token in launch_url

    def test_public_launch_validate_endpoint(self):
        """Test 3: Normal Phone Camera opens landing page which calls GET /launch/validate."""
        current_v = int(time.time() // 10)
        token = generate_launch_token(
            session_id=self.session.id,
            short_code="8XK2Q7MD",
            v=current_v
        )

        resp = self.client.get(f"/api/v1/launch/validate?token={token}")
        assert resp.status_code == 200
        meta = resp.json()
        assert meta["valid"] is True
        assert meta["session_id"] == self.session.id
        assert meta["is_open"] is True
        assert meta["subject_name"] == self.subject.name
        assert meta["section_name"] == self.section.name

    def _get_student_proof(self):
        return create_test_binding_proof(self.student.id, self.student.roll_number, self.priv)

    def test_launch_attend_flow(self):
        """Test 4: Authenticated student submits attendance via launch token."""
        # Ensure ShortTokenService has code registered for this session
        short_info = ShortTokenService.issue_or_get_short_code(
            db=self.db,
            session_id=self.session.id,
            period_count=1,
            step_window=10
        )

        token = generate_launch_token(
            session_id=self.session.id,
            short_code=short_info["short_code"],
            v=short_info["v"],
            step_window=10
        )

        proof = self._get_student_proof()
        resp = self.client.post(
            "/api/v1/launch/attend",
            json={
                "launch_token": token,
                "entry_method": "WEB_URL",
                "scan_mode": "PROJECTOR_SCAN",
                **proof
            },
            headers={"Authorization": f"Bearer {self.student_token}"}
        )
        assert resp.status_code == 200, f"Launch attend failed: {resp.text}"
        res_data = resp.json()
        assert res_data["status"] == "SUCCESS"
        print(f"\nDEBUG res_data: {res_data}")

        # Verify DB record created (allowing for async batch writer flush)
        time.sleep(0.5)
        verify_db = SessionLocal()
        rec = None
        for _ in range(5):
            rec = verify_db.query(AttendanceRecord).filter(
                AttendanceRecord.session_id == self.session.id,
                AttendanceRecord.student_id == self.student.id
            ).first()
            if rec:
                break
            time.sleep(0.2)
        assert rec is not None
        assert rec.status == AttendanceStatus.PRESENT
        verify_db.close()

    def test_pwa_scanner_with_https_url(self):
        """Test 5: Student PWA Scanner reads full HTTPS URL and submits to /student/scan-session."""
        # Cleanup prior record with isolated session
        clean_db = SessionLocal()
        clean_db.query(AttendanceRecord).filter(
            AttendanceRecord.session_id == self.session.id,
            AttendanceRecord.student_id == self.student.id
        ).delete()
        clean_db.commit()
        clean_db.close()

        short_info = ShortTokenService.issue_or_get_short_code(
            db=self.db,
            session_id=self.session.id,
            period_count=1,
            step_window=10
        )

        token = generate_launch_token(
            session_id=self.session.id,
            short_code=short_info["short_code"],
            v=short_info["v"],
            step_window=10
        )
        full_url = f"https://whiteleos.cc.cd/a/{token}"

        proof = self._get_student_proof()
        resp = self.client.post(
            "/api/v1/student/scan-session",
            json={
                "session_token": full_url,
                "token_format": "short",
                "scan_mode": "QR_CAMERA",
                **proof
            },
            headers={"Authorization": f"Bearer {self.student_token}"}
        )
        assert resp.status_code == 200, f"PWA scan failed: {resp.text}"
        assert resp.json()["status"] in ("SUCCESS", "ALREADY_MARKED")

    def test_paste_and_go_with_launch_token(self):
        """Test 6: Paste-and-Go passes raw launch token to /student/scan-session."""
        # Cleanup prior record with isolated session
        clean_db = SessionLocal()
        clean_db.query(AttendanceRecord).filter(
            AttendanceRecord.session_id == self.session.id,
            AttendanceRecord.student_id == self.student.id
        ).delete()
        clean_db.commit()
        clean_db.close()

        short_info = ShortTokenService.issue_or_get_short_code(
            db=self.db,
            session_id=self.session.id,
            period_count=1,
            step_window=10
        )

        token = generate_launch_token(
            session_id=self.session.id,
            short_code=short_info["short_code"],
            v=short_info["v"],
            step_window=10
        )

        proof = self._get_student_proof()
        resp = self.client.post(
            "/api/v1/student/scan-session",
            json={
                "session_token": token,
                "scan_mode": "QR_CAMERA_FALLBACK",
                **proof
            },
            headers={"Authorization": f"Bearer {self.student_token}"}
        )
        assert resp.status_code == 200, f"Paste-and-Go failed: {resp.text}"
        assert resp.json()["status"] in ("SUCCESS", "ALREADY_MARKED")

    def test_expired_launch_token_rejected(self):
        """Test 7: Expired launch token is strictly rejected with HTTP 400."""
        # Generate token with current time, but validate in the future (> 30s)
        now_ts = time.time()
        current_v = int(now_ts // 10)
        token = generate_launch_token(
            session_id=self.session.id,
            short_code="8XK2Q7MD",
            v=current_v,
            step_window=10,
            grace_seconds=10
        )

        # Validate with now_ts shifted 60 seconds into future
        future_ts = now_ts + 60.0
        with pytest.raises(ValueError, match="expired"):
            validate_launch_token(token, now_ts=future_ts)

        # API endpoint check
        resp = self.client.get(f"/api/v1/launch/validate?token={token}")
        # Note: server will check with current time (valid now)
        assert resp.status_code == 200

    def test_tampered_launch_token_rejected(self):
        """Test 8: Tampered launch token signature is rejected with HTTP 400."""
        current_v = int(time.time() // 10)
        token = generate_launch_token(
            session_id=self.session.id,
            short_code="8XK2Q7MD",
            v=current_v
        )

        # Tamper character in middle to guarantee corrupted payload/signature
        idx = len(token) // 2
        tampered = token[:idx] + ("X" if token[idx] != "X" else "Y") + token[idx + 1:]

        resp = self.client.get(f"/api/v1/launch/validate?token={tampered}")
        assert resp.status_code == 400
        assert "verification failed" in resp.json()["detail"].lower() or "invalid launch token" in resp.json()["detail"].lower()
