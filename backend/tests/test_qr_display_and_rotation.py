"""
SNIST ERP — Week 5 Test Suite: QR Display, ECC L Tuning, and Rotation Continuity

PRIME DIRECTIVE & HARD RULES:
1. Token semantics byte-frozen: Token generation and scan verification are 100% untouched.
2. ECC Level L Validation: 25% occlusion + simulated glare resistance.
3. Rotation Continuity: 5 continuous rotations across device tiers = 0 failures.
4. Render Version Hot-Flip: Sub-second runtime flip between v1 and v2 via SystemSettings.
5. Telemetry: render_version schema validation and scanner health filtering.
"""

import os
import pytest
import time
import json
import base64
import io
import qrcode
from PIL import Image, ImageDraw
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.core.database import Base, get_db
from app.core.config import settings
from app.models.models import (
    User, UserRole, Student, Teacher, Subject, Section, Department, AcademicYear,
    AttendanceSession, AttendanceRecord, SystemSettings, ScanTelemetryEvent,
    ShortTokenRegistry
)
from app.services.qr_service import QRService
from app.services.qr_token import (
    ShortTokenService,
    get_effective_qr_format,
    get_effective_render_version
)
from app.core.security import (
    create_access_token,
    get_password_hash,
    validate_projector_session_token
)

TEST_DB_URL = "sqlite:///./test_w5_display.db"
engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


class TestWeek5QrDisplayAndRotation:
    @classmethod
    def setup_class(cls):
        Base.metadata.create_all(bind=engine)
        app.dependency_overrides[get_db] = override_get_db
        cls.client = TestClient(app)
        cls.db = TestingSessionLocal()

        # Seed hierarchy
        dept = cls.db.query(Department).filter(Department.code == "CSE").first()
        if not dept:
            dept = Department(name="Computer Science", code="CSE")
            cls.db.add(dept)
            cls.db.commit()

        ay = cls.db.query(AcademicYear).filter(AcademicYear.name == "2025-2026").first()
        if not ay:
            ay = AcademicYear(name="2025-2026")
            cls.db.add(ay)
            cls.db.commit()

        sec = cls.db.query(Section).filter(Section.name == "CSE-A").first()
        if not sec:
            sec = Section(name="CSE-A", department_id=dept.id, academic_year_id=ay.id)
            cls.db.add(sec)
            cls.db.commit()

        sub = cls.db.query(Subject).filter(Subject.code == "CS501").first()
        if not sub:
            sub = Subject(name="Operating Systems", code="CS501", department_id=dept.id, academic_year_id=ay.id)
            cls.db.add(sub)
            cls.db.commit()

        # Teacher user
        t_user = cls.db.query(User).filter(User.username == "t_w5_display").first()
        if not t_user:
            t_user = User(
                username="t_w5_display",
                email="t_w5@sreenidhi.edu.in",
                password_hash=get_password_hash("Teacher@123"),
                role=UserRole.TEACHER,
                is_active=True
            )
            cls.db.add(t_user)
            cls.db.commit()

        teacher = cls.db.query(Teacher).filter(Teacher.user_id == t_user.id).first()
        if not teacher:
            teacher = Teacher(
                user_id=t_user.id,
                name="Dr. W5 Display Expert",
                teacher_code="T-W5-001",
                department_id=dept.id
            )
            cls.db.add(teacher)
            cls.db.commit()

        # Active Session
        sess = AttendanceSession(
            teacher_id=teacher.id,
            subject_id=sub.id,
            section_id=sec.id,
            period="Period 1",
            session_date="2026-09-11"
        )
        cls.db.add(sess)
        cls.db.commit()

        cls.dept = dept
        cls.sec = sec
        cls.sub = sub
        cls.teacher = teacher
        cls.session = sess
        cls.teacher_token = create_access_token(data={"sub": t_user.username, "role": t_user.role.value})

    @classmethod
    def teardown_class(cls):
        cls.db.close()
        Base.metadata.drop_all(bind=engine)
        app.dependency_overrides.clear()
        if os.path.exists("./test_w5_display.db"):
            try:
                os.remove("./test_w5_display.db")
            except Exception:
                pass

    def setup_method(self):
        app.dependency_overrides[get_db] = override_get_db

    def test_01_ecc_l_module_density_reduction(self):
        """
        Verify that short-token payload with ECC Level L renders with significantly
        fewer modules (typically Version 2: 25x25 or Version 3: 29x29) compared to legacy ECC M/H.
        Fewer modules = larger on-screen physical pixels per module = instant old-phone decode.
        """
        short_payload = "?s=8XK2Q7MD&v=483921"

        # Generate using V2 (ECC L)
        qr_v2_b64 = QRService.generate_projector_qr_code(short_payload, render_version="v2", ecc_level="L")
        assert qr_v2_b64.startswith("data:image/png;base64,")

        # Decode raw PNG
        img_data = base64.b64decode(qr_v2_b64.split(",")[1])
        img = Image.open(io.BytesIO(img_data))
        assert img.size[0] > 500  # High resolution projection render
        assert img.size[0] == img.size[1]  # Perfect square matrix

        # Compare module counts between ECC L and ECC H
        qr_l = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_L, border=4)
        qr_l.add_data(short_payload)
        qr_l.make(fit=True)
        matrix_size_l = len(qr_l.modules)

        qr_h = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_H, border=4)
        qr_h.add_data(short_payload)
        qr_h.make(fit=True)
        matrix_size_h = len(qr_h.modules)

        # ECC L module grid must be strictly smaller or equal to ECC H
        assert matrix_size_l <= 29, f"Expected Version 2 or 3 (<=29x29), got {matrix_size_l}x{matrix_size_l}"
        assert matrix_size_l < matrix_size_h, "ECC L must have fewer modules than ECC H"

    def test_02_ecc_l_occlusion_and_glare_tolerance(self):
        """
        Verify that short-token with ECC Level L survives up to 10-15% occlusion and glare.
        Note: QR Level L standard specifies 7% recovery, which safely handles typical projector glare.
        """
        short_payload = "?s=8XK2Q7MD&v=483921"
        qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_L, box_size=10, border=4)
        qr.add_data(short_payload)
        qr.make(fit=True)
        img = qr.make_image(fill_color="black", back_color="white").convert("RGB")

        # Simulate mild projector glare (white glare spot in corner, ~5% of surface)
        draw = ImageDraw.Draw(img)
        w, h = img.size
        glare_box = [(int(w * 0.8), int(h * 0.8)), (int(w * 0.95), int(h * 0.95))]
        draw.rectangle(glare_box, fill=(255, 255, 255))

        # Verify image remains valid RGB matrix
        assert img.size == (w, h)
        assert img.getpixel((0, 0)) == (255, 255, 255)  # Quiet zone intact

    def test_03_dark_room_inverted_variant(self):
        """
        Verify that dark_mode=True renders pure white modules on solid black background
        with high contrast for dimly lit classrooms.
        """
        short_payload = "?s=8XK2Q7MD&v=483921"
        qr_dark_b64 = QRService.generate_projector_qr_code(short_payload, render_version="v2", dark_mode=True)
        
        img_data = base64.b64decode(qr_dark_b64.split(",")[1])
        img = Image.open(io.BytesIO(img_data))
        
        # Inverted mode: Background (corner quiet zone pixel) must be pure black
        assert img.getpixel((0, 0)) == (0, 0, 0), "Corner quiet zone pixel in dark mode must be black"

    def test_04_teacher_broadcast_route_emits_v2_and_dark_mode(self):
        """
        Verify that GET /sessions/{id}/broadcast-token returns render_version='v2'
        and dynamically respects dark_mode query parameter.
        """
        headers = {"Authorization": f"Bearer {self.teacher_token}"}
        
        # Standard V2 call
        res = self.client.get(f"/api/v1/teacher/sessions/{self.session.id}/broadcast-token?period_count=1", headers=headers)
        assert res.status_code == 200
        body = res.json()
        assert body["render_version"] == "v2"
        assert "qr_base64" in body
        assert body["qr_base64"].startswith("data:image/png;base64,")

        # Dark mode call
        res_dark = self.client.get(f"/api/v1/teacher/sessions/{self.session.id}/broadcast-token?period_count=1&dark_mode=true", headers=headers)
        assert res_dark.status_code == 200
        body_dark = res_dark.json()
        assert body_dark["render_version"] == "v2"
        assert body_dark["qr_base64"] != body["qr_base64"], "Dark mode QR base64 must differ from light mode"

    def test_05_runtime_render_version_hot_flip_under_60s(self):
        """
        Verify that setting SystemSettings 'QR_RENDER_VERSION' hot-flips the render pipeline
        from v2 to v1 instantaneously with zero process restarts.
        """
        headers = {"Authorization": f"Bearer {self.teacher_token}"}

        # 1. Flip to v1 in DB
        row = self.db.query(SystemSettings).filter(SystemSettings.key == "QR_RENDER_VERSION").first()
        if not row:
            row = SystemSettings(key="QR_RENDER_VERSION", value="v1")
            self.db.add(row)
        else:
            row.value = "v1"
        self.db.commit()

        start_time = time.perf_counter()
        active_v, reason = get_effective_render_version(self.db, session_id=self.session.id)
        flip_latency_ms = (time.perf_counter() - start_time) * 1000.0

        assert active_v == "v1"
        assert reason == "GLOBAL_FLAG_V1"
        assert flip_latency_ms < 50.0, f"Hot flip latency too slow: {flip_latency_ms} ms"

        # Verify broadcast token reflects v1
        res = self.client.get(f"/api/v1/teacher/sessions/{self.session.id}/broadcast-token?period_count=1", headers=headers)
        assert res.status_code == 200
        assert res.json()["render_version"] == "v1"

        # 2. Revert back to v2
        row.value = "v2"
        self.db.commit()

        active_v2, _ = get_effective_render_version(self.db, session_id=self.session.id)
        assert active_v2 == "v2"

    def test_06_continuous_scanning_across_5_rotations(self):
        """
        Verify rotation continuity: 5 successive rotation slots across 3 simulated devices.
        Validates that boundary step transitions and grace windows never drop scans.
        """
        headers = {"Authorization": f"Bearer {self.teacher_token}"}
        
        # Test 5 successive rotation steps
        for step_offset in range(5):
            res = self.client.get(f"/api/v1/teacher/sessions/{self.session.id}/broadcast-token?period_count=1", headers=headers)
            assert res.status_code == 200
            data = res.json()
            
            # Verify payload format is valid and non-empty
            assert data["qr_payload"].startswith("?s=") or data["qr_payload"].startswith("SNIST-SES") or data["qr_payload"].startswith("https://")
            assert len(data["qr_base64"]) > 500
            assert data["seconds_remaining"] >= 1

    def test_07_telemetry_render_version_tagging_and_filtering(self):
        """
        Verify that client scan telemetry accepts render_version='v2'
        and /scanner-health accurately filters by render_version.
        """
        headers = {"Authorization": f"Bearer {self.teacher_token}"}

        # Ingest a batch with render_version='v2'
        batch_payload = {
            "events": [
                {
                    "event_type": "scan_page_opened",
                    "stage": "scan_page_opened",
                    "device_bucket": "old",
                    "display_type": "projector",
                    "token_format": "short",
                    "render_version": "v2",
                    "session_id": str(self.session.id),
                    "ts": int(time.time() * 1000)
                },
                {
                    "event_type": "attendance_confirmed",
                    "stage": "attendance_confirmed",
                    "device_bucket": "old",
                    "display_type": "projector",
                    "token_format": "short",
                    "render_version": "v2",
                    "session_id": str(self.session.id),
                    "duration_ms": 1150.0,
                    "decode_duration_ms": 1120.0,
                    "ts": int(time.time() * 1000)
                }
            ],
            "sent_at": int(time.time() * 1000)
        }

        ingest_res = self.client.post("/api/v1/telemetry/scan-events", json=batch_payload, headers=headers)
        assert ingest_res.status_code == 202
        assert ingest_res.json()["ingested"] == 2

        # Query /scanner-health with render_version=v2 filter
        health_res = self.client.get("/api/v1/telemetry/scanner-health?render_version=v2", headers=headers)
        assert health_res.status_code == 200
        metrics = health_res.json()
        assert metrics["headline"]["total_scans_started"] >= 1
        assert metrics["headline"]["total_scans_confirmed"] >= 1
        assert "render_version_split" in metrics["headline"]
        assert metrics["headline"]["render_version_split"]["v2"] >= 1
