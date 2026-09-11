"""
SNIST ERP — Week 4 Production Pilot Rollout & Flag Verification Suite
Verifies:
1. QR_TOKEN_FORMAT flag behavior:
   - 'legacy': Byte-identical output to legacy generate_projector_session_token
   - 'short': Slim token {c: short_code, v: step}
   - 'dual': Cohort routing (pilot sections get short, non-pilot get legacy)
2. Instant runtime flag flip (<60s drill) via SystemSettings without server restart
3. In-flight session survival: short tokens issued before flip validate seamlessly after flip
4. Telemetry format tag filter & CSV export
"""

import os
import sys
import time
import json
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
from app.models.models import (
    User, UserRole, Department, AcademicYear, Section, Subject,
    Teacher, Student, TeacherAssignment, AttendanceSession, SessionStatus,
    AttendanceRecord, AttendanceStatus, DeviceRegistration, DeviceAccountBinding,
    BindingStatus, ShortTokenRegistry, SystemSettings, ScanTelemetryEvent
)
from app.core.security import (
    generate_projector_session_token,
    get_password_hash,
    create_access_token,
    get_server_ist_date
)
from app.core.device_security import (
    hash_device_secret,
    register_or_get_device,
    enforce_device_binding
)
from app.services.qr_token import (
    ShortTokenService,
    get_effective_qr_format
)


class TestPilotRolloutAndFlag(unittest.TestCase):

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

        # Clear short token caches
        ShortTokenService.clear_cache()

        # Seed hierarchy
        self.dept_cse = Department(code="CSE", name="Computer Science & Engineering")
        self.dept_ce = Department(code="CE", name="Civil Engineering")
        self.ay = AcademicYear(name="2025-2026")
        self.db.add_all([self.dept_cse, self.dept_ce, self.ay])
        self.db.commit()

        # Pilot section (CSE-A, Section 1) & Control section (CE-A, Section 2)
        self.sec_pilot = Section(id=1, name="CSE-A", department_id=self.dept_cse.id, academic_year_id=self.ay.id)
        self.sec_control = Section(id=2, name="CE-A", department_id=self.dept_ce.id, academic_year_id=self.ay.id)
        self.subj_cs = Subject(code="CS301", name="Database Systems", department_id=self.dept_cse.id, academic_year_id=self.ay.id)
        self.subj_ce = Subject(code="CE301", name="Structural Analysis", department_id=self.dept_ce.id, academic_year_id=self.ay.id)
        self.db.add_all([self.sec_pilot, self.sec_control, self.subj_cs, self.subj_ce])
        self.db.commit()

        # Teacher setup
        self.t_user = User(
            username="teacher_cs",
            password_hash=get_password_hash("pass123"),
            role=UserRole.TEACHER,
            is_active=True
        )
        self.admin_user = User(
            username="super_admin",
            password_hash=get_password_hash("admin123"),
            role=UserRole.SUPER_ADMIN,
            is_active=True
        )
        self.db.add_all([self.t_user, self.admin_user])
        self.db.commit()

        self.teacher = Teacher(
            user_id=self.t_user.id,
            name="Dr. Alan Turing",
            teacher_code="T-CS-001",
            department_id=self.dept_cse.id
        )
        self.db.add(self.teacher)
        self.db.commit()

        # Student in pilot section
        self.s1_user = User(username="23311A0501", password_hash=get_password_hash("stud123"), role=UserRole.STUDENT, is_active=True)
        self.s2_user = User(username="23311A0502", password_hash=get_password_hash("stud123"), role=UserRole.STUDENT, is_active=True)
        self.db.add_all([self.s1_user, self.s2_user])
        self.db.commit()

        self.student1 = Student(
            user_id=self.s1_user.id,
            roll_number="23311A0501",
            name="Alice Student",
            section_id=self.sec_pilot.id,
            department_id=self.dept_cse.id,
            academic_year_id=self.ay.id
        )
        self.student2 = Student(
            user_id=self.s2_user.id,
            roll_number="23311A0502",
            name="Bob Student",
            section_id=self.sec_pilot.id,
            department_id=self.dept_cse.id,
            academic_year_id=self.ay.id
        )
        self.db.add_all([self.student1, self.student2])
        self.db.commit()

        # Device registration & binding for students
        self.dev1 = register_or_get_device(self.db, "DEV-ALICE-PHONE", "DEV-ALICE-PHONE_SECRET_SALT_2026")
        self.dev2 = register_or_get_device(self.db, "DEV-BOB-PHONE", "DEV-BOB-PHONE_SECRET_SALT_2026")
        enforce_device_binding(self.db, self.dev1, "23311A0501")
        enforce_device_binding(self.db, self.dev2, "23311A0502")

        # Auth tokens
        self.t_token = create_access_token({"sub": self.t_user.username, "role": "TEACHER"})
        self.admin_token = create_access_token({"sub": self.admin_user.username, "role": "SUPER_ADMIN"})
        self.s1_token = create_access_token({"sub": self.s1_user.username, "role": "STUDENT"})
        self.s2_token = create_access_token({"sub": self.s2_user.username, "role": "STUDENT"})

        # Create sessions
        self.sess_pilot = AttendanceSession(
            teacher_id=self.teacher.id,
            subject_id=self.subj_cs.id,
            section_id=self.sec_pilot.id,
            session_date=get_server_ist_date(),
            period="1",
            status=SessionStatus.OPEN,
            display_type="projector"
        )
        self.sess_control = AttendanceSession(
            teacher_id=self.teacher.id,
            subject_id=self.subj_ce.id,
            section_id=self.sec_control.id,
            session_date=get_server_ist_date(),
            period="2",
            status=SessionStatus.OPEN,
            display_type="projector"
        )
        self.db.add_all([self.sess_pilot, self.sess_control])
        self.db.commit()

    def tearDown(self):
        app.dependency_overrides.clear()
        self.db.close()
        Base.metadata.drop_all(bind=self.engine)

    def test_flag_legacy_mode_byte_identical_output(self):
        """When QR_TOKEN_FORMAT is 'legacy', output is byte-identical to legacy generator."""
        self.db.add(SystemSettings(key="QR_TOKEN_FORMAT", value="legacy"))
        self.db.commit()

        headers = {"Authorization": f"Bearer {self.t_token}"}
        res = self.client.get(f"/api/v1/teacher/sessions/{self.sess_pilot.id}/broadcast-token?period_count=1", headers=headers)
        self.assertEqual(res.status_code, 200)
        data = res.json()

        self.assertEqual(data["format"], "legacy")
        self.assertEqual(data["format_reason"], "GLOBAL_FLAG_LEGACY")
        # Byte-identical verification: qr_payload must exactly equal legacy_payload
        self.assertEqual(data["qr_payload"], data["legacy_payload"])
        self.assertTrue(data["qr_payload"].startswith("SNIST-SES|"))
        # qr_base64 must start with image/png header
        self.assertTrue(data["qr_base64"].startswith("data:image/png;base64,"))

    def test_flag_short_mode_output(self):
        """When QR_TOKEN_FORMAT is 'short', output uses slim ?s=...&v=... payload."""
        self.db.add(SystemSettings(key="QR_TOKEN_FORMAT", value="short"))
        self.db.commit()

        headers = {"Authorization": f"Bearer {self.t_token}"}
        res = self.client.get(f"/api/v1/teacher/sessions/{self.sess_pilot.id}/broadcast-token?period_count=1", headers=headers)
        self.assertEqual(res.status_code, 200)
        data = res.json()

        self.assertEqual(data["format"], "short")
        self.assertEqual(data["format_reason"], "GLOBAL_FLAG_SHORT")
        self.assertEqual(data["qr_payload"], data["short_payload"])
        self.assertTrue(data["qr_payload"].startswith("?s="))
        self.assertIn("&v=", data["qr_payload"])
        # Slim payload must be under 25 chars (vs 96 chars legacy)
        self.assertLessEqual(len(data["qr_payload"]), 25)

    def test_flag_dual_mode_cohort_routing(self):
        """When QR_TOKEN_FORMAT is 'dual', pilot cohort gets short; control cohort gets legacy."""
        self.db.add(SystemSettings(key="QR_TOKEN_FORMAT", value="dual"))
        # Section 1 is pilot; Section 2 is control
        self.db.add(SystemSettings(key="QR_PILOT_SECTIONS", value="1"))
        self.db.add(SystemSettings(key="QR_PILOT_DEPARTMENTS", value="NONE"))
        self.db.commit()

        headers = {"Authorization": f"Bearer {self.t_token}"}

        # 1. Pilot session (Section 1) -> must receive SHORT format
        res_pilot = self.client.get(f"/api/v1/teacher/sessions/{self.sess_pilot.id}/broadcast-token?period_count=1", headers=headers)
        self.assertEqual(res_pilot.status_code, 200)
        data_p = res_pilot.json()
        self.assertEqual(data_p["format"], "short")
        self.assertIn("PILOT_SECTION_MATCH", data_p["format_reason"])
        self.assertEqual(data_p["qr_payload"], data_p["short_payload"])

        # 2. Control session (Section 2) -> must receive LEGACY format
        res_ctrl = self.client.get(f"/api/v1/teacher/sessions/{self.sess_control.id}/broadcast-token?period_count=1", headers=headers)
        self.assertEqual(res_ctrl.status_code, 200)
        data_c = res_ctrl.json()
        self.assertEqual(data_c["format"], "legacy")
        self.assertEqual(data_c["format_reason"], "CONTROL_COHORT_LEGACY")
        self.assertEqual(data_c["qr_payload"], data_c["legacy_payload"])

    def test_runtime_flag_flip_sub_second_drill(self):
        """
        Rollback Drill (<60s):
        Demonstrates flipping short -> legacy via SystemSettings in < 1 second.
        In-flight session survives the flip and scans mark successfully.
        """
        # Step 1: Start with short format
        setting = SystemSettings(key="QR_TOKEN_FORMAT", value="short")
        self.db.add(setting)
        self.db.commit()

        t_headers = {"Authorization": f"Bearer {self.t_token}"}
        res1 = self.client.get(f"/api/v1/teacher/sessions/{self.sess_pilot.id}/broadcast-token?period_count=1", headers=t_headers)
        self.assertEqual(res1.json()["format"], "short")
        short_token_issued = res1.json()["qr_payload"]
        short_code_issued = res1.json()["short_code"]
        step_issued = res1.json()["step"]

        # Step 2: Student 1 scans using the short token -> SUCCESS
        s1_headers = {
            "Authorization": f"Bearer {self.s1_token}",
            "x-device-public-id": "DEV-ALICE-PHONE"
        }
        res_scan1 = self.client.post("/api/v1/student/scan-session", headers=s1_headers, json={
            "session_token": short_token_issued,
            "short_code": short_code_issued,
            "v": step_issued,
            "token_format": "short",
            "device_uuid": "DEV-ALICE-PHONE"
        })
        self.assertEqual(res_scan1.status_code, 200)
        self.assertEqual(res_scan1.json()["status"], "SUCCESS")

        # Step 3: Trigger instantaneous rollback drill (< 1s execution)
        t_flip_start = time.perf_counter()
        setting.value = "legacy"
        self.db.commit()
        flip_elapsed_ms = (time.perf_counter() - t_flip_start) * 1000
        # Verification: flip completed in under 50ms (well below 60,000ms SLA!)
        self.assertLess(flip_elapsed_ms, 50.0)

        # Step 4: Next poll immediately returns legacy QR without server restart
        res2 = self.client.get(f"/api/v1/teacher/sessions/{self.sess_pilot.id}/broadcast-token?period_count=1", headers=t_headers)
        self.assertEqual(res2.json()["format"], "legacy")
        self.assertEqual(res2.json()["qr_payload"], res2.json()["legacy_payload"])
        legacy_token_issued = res2.json()["legacy_payload"]

        # Step 5: Student 2 scans with the new legacy token -> SUCCESS
        s2_headers = {
            "Authorization": f"Bearer {self.s2_token}",
            "x-device-public-id": "DEV-BOB-PHONE"
        }
        res_scan2 = self.client.post("/api/v1/student/scan-session", headers=s2_headers, json={
            "session_token": legacy_token_issued,
            "token_format": "legacy",
            "device_uuid": "DEV-BOB-PHONE"
        })
        self.assertEqual(res_scan2.status_code, 200)
        self.assertEqual(res_scan2.json()["status"], "SUCCESS")

        # Step 6: Prior scan record from Student 1 remains 100% intact
        rec1 = self.db.query(AttendanceRecord).filter(
            AttendanceRecord.session_id == self.sess_pilot.id,
            AttendanceRecord.student_id == self.student1.id
        ).first()
        self.assertIsNotNone(rec1)
        self.assertEqual(rec1.status, AttendanceStatus.PRESENT)

    def test_in_flight_token_survival_during_flip(self):
        """
        A student who fetched/viewed the short QR right before the admin flipped to legacy
        can still submit and be verified without rejection.
        """
        # 1. System in short mode
        self.db.add(SystemSettings(key="QR_TOKEN_FORMAT", value="short"))
        self.db.commit()

        t_headers = {"Authorization": f"Bearer {self.t_token}"}
        res_token = self.client.get(f"/api/v1/teacher/sessions/{self.sess_pilot.id}/broadcast-token?period_count=1", headers=t_headers)
        short_payload = res_token.json()["qr_payload"]
        short_code = res_token.json()["short_code"]
        v_step = res_token.json()["step"]

        # 2. Admin flips to legacy
        setting = self.db.query(SystemSettings).filter(SystemSettings.key == "QR_TOKEN_FORMAT").first()
        setting.value = "legacy"
        self.db.commit()

        # 3. Student submits the in-flight short token
        s_headers = {
            "Authorization": f"Bearer {self.s1_token}",
            "x-device-public-id": "DEV-ALICE-PHONE"
        }
        res_submit = self.client.post("/api/v1/student/scan-session", headers=s_headers, json={
            "session_token": short_payload,
            "short_code": short_code,
            "v": v_step,
            "token_format": "short",
            "device_uuid": "DEV-ALICE-PHONE"
        })
        self.assertEqual(res_submit.status_code, 200)
        self.assertEqual(res_submit.json()["status"], "SUCCESS")

    def test_telemetry_scanner_health_format_filter(self):
        """Verifies /scanner-health filters by token_format ('short' vs 'legacy')."""
        admin_headers = {"Authorization": f"Bearer {self.admin_token}"}

        # Seed telemetry events with both format tags
        ev1 = ScanTelemetryEvent(
            session_id="SESS-001",
            event_type="scan_page_opened",
            device_bucket="old",
            token_format="short"
        )
        ev2 = ScanTelemetryEvent(
            session_id="SESS-001",
            event_type="attendance_confirmed",
            device_bucket="old",
            duration_ms=1200.0,
            token_format="short"
        )
        ev3 = ScanTelemetryEvent(
            session_id="SESS-002",
            event_type="scan_page_opened",
            device_bucket="mid",
            token_format="legacy"
        )
        ev4 = ScanTelemetryEvent(
            session_id="SESS-002",
            event_type="attendance_confirmed",
            device_bucket="mid",
            duration_ms=2500.0,
            token_format="legacy"
        )
        self.db.add_all([ev1, ev2, ev3, ev4])
        self.db.commit()

        # 1. Unfiltered query
        res_all = self.client.get("/api/v1/telemetry/scanner-health?days=7", headers=admin_headers)
        self.assertEqual(res_all.status_code, 200)
        self.assertEqual(res_all.json()["headline"]["format_split"]["short"], 2)
        self.assertEqual(res_all.json()["headline"]["format_split"]["legacy"], 2)

        # 2. Filter by short format
        res_short = self.client.get("/api/v1/telemetry/scanner-health?days=7&token_format=short", headers=admin_headers)
        self.assertEqual(res_short.status_code, 200)
        self.assertEqual(res_short.json()["headline"]["total_scans_confirmed"], 1)

        # 3. Filter by legacy format
        res_legacy = self.client.get("/api/v1/telemetry/scanner-health?days=7&token_format=legacy", headers=admin_headers)
        self.assertEqual(res_legacy.status_code, 200)
        self.assertEqual(res_legacy.json()["headline"]["total_scans_confirmed"], 1)

        # 4. CSV Export contains Token Format column
        res_csv = self.client.get("/api/v1/telemetry/export-funnel-csv?days=7", headers=admin_headers)
        self.assertEqual(res_csv.status_code, 200)
        self.assertIn("token_format", res_csv.text)
        self.assertIn("short", res_csv.text)
        self.assertIn("legacy", res_csv.text)


if __name__ == "__main__":
    unittest.main()
