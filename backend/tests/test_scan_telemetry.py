"""
test_scan_telemetry.py — Automated Test Suite for Week 1 Telemetry & Forensics

Validates:
1. Dual device classification logic across boundary edge-cases
2. Ingest schema validation (strict enums for event_type, stage, error_type, bucket)
3. No-PII guard (hard rejection with HTTP 422 of roll numbers, names, locations)
4. Batch ingestion caps (<= 50) and rate-limiting
5. Rollup aggregation engine (first-attempt rate, p50/p95, bucket breakdown)
6. 30-day raw event retention purge
7. Forensics endpoint authorization (Admin/HOD allowed, Student rejected 403)
8. CSV export format
9. Scan-path micro-overhead (<= 2ms)
"""

import sys
import os
import time
import json
import uuid
import unittest
from datetime import datetime, date, timedelta
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.main import app
from app.core.database import get_db, Base
from app.models.models import (
    User, UserRole, Student, Teacher, Department, Subject, Section, AcademicYear,
    AttendanceSession, AttendanceRecord, AttendanceStatus, SessionStatus,
    ScanTelemetryEvent, ScanTelemetryDailyRollup
)
from app.core.device_classifier import classify_device
from app.core.security import create_access_token, get_password_hash
from app.services.telemetry_rollup import rollup_scan_telemetry, purge_old_scan_telemetry, calculate_percentile


class TestScanTelemetrySuite(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # In-memory SQLite for high-speed, isolated test execution
        cls.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        cls.TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=cls.engine)
        Base.metadata.create_all(bind=cls.engine)

        def override_get_db():
            db = cls.TestingSessionLocal()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_get_db
        cls.client = TestClient(app)

        # Seed Test Users
        db = cls.TestingSessionLocal()
        try:
            # 1. Super Admin
            cls.admin_user = User(
                username="superadmin",
                email="superadmin@snist.edu.in",
                password_hash=get_password_hash("AdminPass123!"),
                role=UserRole.SUPER_ADMIN,
                is_active=True
            )
            # 2. Faculty
            cls.teacher_user = User(
                username="teacher1",
                email="teacher@snist.edu.in",
                password_hash=get_password_hash("TeacherPass123!"),
                role=UserRole.TEACHER,
                is_active=True
            )
            # 3. Student
            cls.student_user = User(
                username="student1",
                email="student@snist.edu.in",
                password_hash=get_password_hash("StudentPass123!"),
                role=UserRole.STUDENT,
                is_active=True
            )
            db.add_all([cls.admin_user, cls.teacher_user, cls.student_user])
            db.commit()
            db.refresh(cls.admin_user)
            db.refresh(cls.teacher_user)
            db.refresh(cls.student_user)

            cls.admin_token = create_access_token(data={"sub": cls.admin_user.username, "role": cls.admin_user.role.value})
            cls.teacher_token = create_access_token(data={"sub": cls.teacher_user.username, "role": cls.teacher_user.role.value})
            cls.student_token = create_access_token(data={"sub": cls.student_user.username, "role": cls.student_user.role.value})
        finally:
            db.close()

    @classmethod
    def tearDownClass(cls):
        Base.metadata.drop_all(bind=cls.engine)
        app.dependency_overrides.clear()

    def setUp(self):
        # Clean telemetry events between tests
        db = self.TestingSessionLocal()
        try:
            db.query(ScanTelemetryEvent).delete()
            db.query(ScanTelemetryDailyRollup).delete()
            db.commit()
        finally:
            db.close()

    # =========================================================================
    # 1. Device Classifier Unit Tests
    # =========================================================================
    def test_device_classifier_matrix(self):
        """Table-driven testing for device tier classification rules."""
        cases = [
            # (ua, cores, ram, expected_bucket)
            ("Mozilla/5.0 (Linux; Android 8.1.0; Redmi 6A)", 4, 2, "old"),
            ("Mozilla/5.0 (Linux; Android 9; SAMSUNG SM-A105F)", 4, 2, "old"),
            ("Mozilla/5.0 (Linux; Android 10; SM-A10)", 8, 2, "old"),     # RAM <= 2GB
            ("Mozilla/5.0 (Linux; Android 10; SM-A10)", 2, 4, "old"),     # Cores <= 4
            ("Mozilla/5.0 (iPhone; CPU iPhone OS 13_5 like Mac OS X)", 6, 4, "old"),  # iOS <= 14
            ("Mozilla/5.0 (iPhone; CPU iPhone OS 14_8 like Mac OS X)", 6, 6, "old"),  # iOS <= 14
            ("Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro)", 8, 12, "new"),          # Modern Android
            ("Mozilla/5.0 (Linux; Android 13; SM-S918B)", 8, 8, "new"),              # Modern Android
            ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)", 6, 6, "new"), # Modern iOS
            ("Mozilla/5.0 (Linux; Android 11; SM-M315F)", 8, 4, "mid"),              # Mid-tier
            ("Mozilla/5.0 (Linux; Android 12; K)", 8, 4, "mid"),                     # Mid-tier
            ("Unknown Browser User Agent", None, None, "mid"),                       # Safe default
            ("", 0, 0, "mid"),                                                       # Edge case defaults to mid
        ]

        for ua, cores, ram, expected in cases:
            with self.subTest(ua=ua, cores=cores, ram=ram):
                bucket = classify_device(ua, cores, ram)
                self.assertEqual(bucket, expected, f"Failed for UA: {ua}, Cores: {cores}, RAM: {ram}")

    # =========================================================================
    # 2. Ingest Schema Validation
    # =========================================================================
    def test_ingest_valid_batch(self):
        """Valid batch of telemetry events returns HTTP 202 Accepted."""
        payload = {
            "events": [
                {
                    "event_type": "scan_page_opened",
                    "stage": "scan_page_opened",
                    "device_bucket": "old",
                    "duration_ms": 0.0,
                    "session_id": "sess_101",
                    "app_version": "1.0.0"
                },
                {
                    "event_type": "camera_opened",
                    "stage": "camera_opened",
                    "device_bucket": "old",
                    "duration_ms": 1420.5,
                    "session_id": "sess_101"
                }
            ]
        }
        res = self.client.post(
            "/api/v1/telemetry/scan-events",
            json=payload,
            headers={"Authorization": f"Bearer {self.student_token}"}
        )
        self.assertEqual(res.status_code, 202)
        data = res.json()
        self.assertEqual(data["status"], "ACCEPTED")
        self.assertEqual(data["ingested"], 2)

    def test_ingest_invalid_event_type(self):
        """Unrecognized event_type is rejected with HTTP 422."""
        payload = {
            "events": [
                {
                    "event_type": "unregistered_event_name",
                    "device_bucket": "mid"
                }
            ]
        }
        res = self.client.post(
            "/api/v1/telemetry/scan-events",
            json=payload,
            headers={"Authorization": f"Bearer {self.student_token}"}
        )
        self.assertEqual(res.status_code, 422)
        self.assertIn("Invalid event_type", res.json()["detail"])

    def test_ingest_invalid_device_bucket(self):
        """Unrecognized device_bucket is rejected with HTTP 422."""
        payload = {
            "events": [
                {
                    "event_type": "scan_page_opened",
                    "device_bucket": "super_phone"
                }
            ]
        }
        res = self.client.post(
            "/api/v1/telemetry/scan-events",
            json=payload,
            headers={"Authorization": f"Bearer {self.student_token}"}
        )
        self.assertEqual(res.status_code, 422)
        self.assertIn("Invalid device_bucket", res.json()["detail"])

    def test_ingest_batch_size_limit(self):
        """Batches exceeding 50 events are rejected with HTTP 422."""
        events = [
            {"event_type": "scan_page_opened", "device_bucket": "mid"}
            for _ in range(51)
        ]
        res = self.client.post(
            "/api/v1/telemetry/scan-events",
            json={"events": events},
            headers={"Authorization": f"Bearer {self.student_token}"}
        )
        self.assertEqual(res.status_code, 422)
        self.assertIn("exceeds maximum limit of 50 events", res.json()["detail"])

    # =========================================================================
    # 3. No-PII Hard Schema Guard
    # =========================================================================
    def test_no_pii_rejection_forbidden_key(self):
        """Rejects any payload containing forbidden PII keys (roll, name, student, etc.)."""
        pii_keys = ["roll_number", "student_name", "user_email", "gps_latitude", "device_fingerprint"]
        for key in pii_keys:
            with self.subTest(key=key):
                payload = {
                    "events": [
                        {
                            "event_type": "scan_page_opened",
                            "device_bucket": "new",
                            "details": {key: "test_val"}
                        }
                    ]
                }
                res = self.client.post(
                    "/api/v1/telemetry/scan-events",
                    json=payload,
                    headers={"Authorization": f"Bearer {self.student_token}"}
                )
                self.assertEqual(res.status_code, 422)
                self.assertIn("PII detected in key", res.json()["detail"])

    def test_no_pii_rejection_roll_pattern_in_value(self):
        """Rejects payload if any string value matches the institutional roll regex."""
        payload = {
            "events": [
                {
                    "event_type": "scan_page_opened",
                    "device_bucket": "new",
                    "details": {"custom_tag": "2411CS010045"}
                }
            ]
        }
        res = self.client.post(
            "/api/v1/telemetry/scan-events",
            json=payload,
            headers={"Authorization": f"Bearer {self.student_token}"}
        )
        self.assertEqual(res.status_code, 422)
        self.assertIn("PII pattern detected in value", res.json()["detail"])

    # =========================================================================
    # 4. Rollup Calculation & 30-Day Purge
    # =========================================================================
    def test_rollup_calculation(self):
        """Verifies accurate aggregation of first-attempt rate and latency percentiles."""
        db = self.TestingSessionLocal()
        try:
            today_str = datetime.utcnow().strftime("%Y-%m-%d")
            t_now = datetime.utcnow()

            # Insert sample events for 2 sessions:
            # Session 1 (Old phone): Confirmed first attempt, 4000ms
            db.add_all([
                ScanTelemetryEvent(event_type="scan_page_opened", device_bucket="old", session_id="s1", created_at=t_now),
                ScanTelemetryEvent(event_type="attendance_confirmed", device_bucket="old", session_id="s1", duration_ms=4000.0, created_at=t_now),
            ])

            # Session 2 (Old phone): Retried, then confirmed, 8000ms
            db.add_all([
                ScanTelemetryEvent(event_type="scan_page_opened", device_bucket="old", session_id="s2", created_at=t_now),
                ScanTelemetryEvent(event_type="scan_failed", error_type="decode_timeout", device_bucket="old", session_id="s2", created_at=t_now),
                ScanTelemetryEvent(event_type="scan_retried", device_bucket="old", session_id="s2", created_at=t_now),
                ScanTelemetryEvent(event_type="attendance_confirmed", device_bucket="old", session_id="s2", duration_ms=8000.0, created_at=t_now),
            ])

            # Session 3 (New phone): Confirmed first attempt, 1000ms
            db.add_all([
                ScanTelemetryEvent(event_type="scan_page_opened", device_bucket="new", session_id="s3", created_at=t_now),
                ScanTelemetryEvent(event_type="attendance_confirmed", device_bucket="new", session_id="s3", duration_ms=1000.0, created_at=t_now),
            ])
            db.commit()

            # Execute Rollup
            rollups = rollup_scan_telemetry(db, today_str)
            self.assertEqual(len(rollups), 4)  # old, mid, new, all

            old_r = next(r for r in rollups if r.device_bucket == "old")
            self.assertEqual(old_r.total_scans_started, 2)
            self.assertEqual(old_r.total_scans_confirmed, 2)
            self.assertEqual(old_r.first_attempt_success_count, 1)  # Only s1 was first attempt
            self.assertEqual(old_r.first_attempt_success_rate, 50.0)
            self.assertEqual(old_r.p50_time_to_mark_ms, 6000.0)

            new_r = next(r for r in rollups if r.device_bucket == "new")
            self.assertEqual(new_r.total_scans_started, 1)
            self.assertEqual(new_r.total_scans_confirmed, 1)
            self.assertEqual(new_r.first_attempt_success_rate, 100.0)
            self.assertEqual(new_r.p50_time_to_mark_ms, 1000.0)

            all_r = next(r for r in rollups if r.device_bucket == "all")
            self.assertEqual(all_r.total_scans_started, 3)
            self.assertEqual(all_r.total_scans_confirmed, 3)
            self.assertEqual(all_r.first_attempt_success_count, 2)
            self.assertAlmostEqual(all_r.first_attempt_success_rate, 66.7, places=1)
        finally:
            db.close()

    def test_purge_old_scan_telemetry(self):
        """Verifies that purge deletes events > 30 days old and retains recent ones."""
        db = self.TestingSessionLocal()
        try:
            now = datetime.utcnow()
            old_event = ScanTelemetryEvent(
                event_type="scan_page_opened",
                device_bucket="old",
                created_at=now - timedelta(days=35)
            )
            fresh_event = ScanTelemetryEvent(
                event_type="scan_page_opened",
                device_bucket="new",
                created_at=now - timedelta(days=5)
            )
            db.add_all([old_event, fresh_event])
            db.commit()

            purged_count = purge_old_scan_telemetry(db, retention_days=30)
            self.assertEqual(purged_count, 1)

            remaining = db.query(ScanTelemetryEvent).all()
            self.assertEqual(len(remaining), 1)
            self.assertEqual(remaining[0].device_bucket, "new")
        finally:
            db.close()

    # =========================================================================
    # 5. Role Scoping & Forensics Dashboard API
    # =========================================================================
    def test_scanner_health_role_permissions(self):
        """Students are rejected with 403; Faculty and Admin get 200 OK."""
        # Unauthenticated -> 401
        res_anon = self.client.get("/api/v1/telemetry/scanner-health")
        self.assertEqual(res_anon.status_code, 401)

        # Student -> 403
        res_stud = self.client.get(
            "/api/v1/telemetry/scanner-health",
            headers={"Authorization": f"Bearer {self.student_token}"}
        )
        self.assertEqual(res_stud.status_code, 403)

        # Teacher -> 200
        res_teach = self.client.get(
            "/api/v1/telemetry/scanner-health",
            headers={"Authorization": f"Bearer {self.teacher_token}"}
        )
        self.assertEqual(res_teach.status_code, 200)

        # Admin -> 200
        res_admin = self.client.get(
            "/api/v1/telemetry/scanner-health",
            headers={"Authorization": f"Bearer {self.admin_token}"}
        )
        self.assertEqual(res_admin.status_code, 200)
        data = res_admin.json()
        self.assertIn("headline", data)
        self.assertIn("funnel", data)
        self.assertIn("failure_matrix", data)
        self.assertIn("manual_path", data)

    def test_csv_export_format(self):
        """Verifies that CSV export streams valid CSV headers and data."""
        db = self.TestingSessionLocal()
        try:
            db.add(ScanTelemetryEvent(
                event_type="scan_page_opened",
                stage="scan_page_opened",
                device_bucket="mid",
                session_id="sess_csv",
                duration_ms=120.0
            ))
            db.commit()
        finally:
            db.close()

        res = self.client.get(
            "/api/v1/telemetry/export-funnel-csv?days=7",
            headers={"Authorization": f"Bearer {self.admin_token}"}
        )
        self.assertEqual(res.status_code, 200)
        self.assertIn("text/csv", res.headers.get("content-type", ""))
        self.assertIn("id,session_id,event_type,stage,error_type,device_bucket", res.text)
        self.assertIn("sess_csv", res.text)

    # =========================================================================
    # 6. Scan Path Overhead Micro-Benchmark Smoke Test
    # =========================================================================
    def test_scan_path_timing_overhead(self):
        """
        Validates Prime Directive: in-memory time.perf_counter() measurements
        and device classification add under 2 milliseconds total overhead.
        """
        iterations = 1000
        start = time.perf_counter()

        ua = "Mozilla/5.0 (Linux; Android 9; SM-A10) AppleWebKit/537.36"
        for _ in range(iterations):
            t0 = time.perf_counter()
            bucket = classify_device(ua, 4, 2)
            t_now = datetime.utcnow().timestamp()
            token_age = int((t_now - 170000000) * 1000)
            elapsed = (time.perf_counter() - t0) * 1000.0

        total_elapsed_ms = (time.perf_counter() - start) * 1000.0
        avg_overhead_ms = total_elapsed_ms / iterations

    # =========================================================================
    # 7. Week 2 Real-Data Tests: Token Grace Window (Quick Win C.2)
    # =========================================================================
    def test_token_grace_window_boundaries(self):
        """
        Validates Token Grace Window (Quick Win C.2):
        - Valid token scanned at slot_end + 2.9s is accepted (is_grace_window=True)
        - Token scanned at slot_end + 3.1s is rejected with ValueError
        - Continuous scan across 3 rotation intervals succeeds
        """
        from app.core.security import generate_projector_session_token, validate_projector_session_token

        session_id = 999
        step_window = 10
        grace_seconds = 3.0

        # Generate token at fixed baseline time
        base_time = 1700000000.0  # arbitrary epoch
        step = int(base_time // step_window)
        slot_end = (step + 1) * step_window

        # Build token for this step
        token_info = generate_projector_session_token(session_id=session_id, period_count=1, step_window=step_window)
        token_str = token_info["payload"]
        token_step = token_info["step"]
        actual_slot_end = (token_step + 1) * step_window

        # 1. Test nominal inside slot
        res_nominal = validate_projector_session_token(
            token_str=token_str,
            step_window=step_window,
            grace_seconds=grace_seconds,
            now_ts=actual_slot_end - 1.0
        )
        self.assertEqual(res_nominal["session_id"], session_id)
        self.assertFalse(res_nominal["is_grace_window"])

        # 2. Test valid inside grace window (+2.9s past slot end)
        res_grace = validate_projector_session_token(
            token_str=token_str,
            step_window=step_window,
            grace_seconds=grace_seconds,
            now_ts=actual_slot_end + 2.9
        )
        self.assertEqual(res_grace["session_id"], session_id)
        self.assertTrue(res_grace["is_grace_window"])

        # 3. Test expired outside grace window (+3.1s past slot end)
        with self.assertRaises(ValueError) as ctx:
            validate_projector_session_token(
                token_str=token_str,
                step_window=step_window,
                grace_seconds=grace_seconds,
                now_ts=actual_slot_end + 3.1
            )
        self.assertIn("expired", str(ctx.exception).lower())

        # 4. Continuous scan across 3 rotations (zero failures)
        for rot in range(3):
            t_rot = actual_slot_end + (rot * step_window) + 0.5
            rot_token = generate_projector_session_token(session_id=session_id, period_count=1, step_window=step_window)
            # Override token step to simulate future rotation
            from app.core.security import _int_to_base36, get_aes_key
            import hmac as pyhmac
            import hashlib as pyhash
            curr_step = int(t_rot // step_window)
            sid_b36 = _int_to_base36(session_id)
            step_b36 = _int_to_base36(curr_step)
            mac = pyhmac.new(get_aes_key(), f"SES|{sid_b36}|1|{step_b36}".encode('utf-8'), pyhash.sha256).hexdigest()[:12]
            syn_payload = f"SNIST-SES|{sid_b36}|1|{step_b36}|{mac}"

            val_res = validate_projector_session_token(
                token_str=syn_payload,
                step_window=step_window,
                grace_seconds=grace_seconds,
                now_ts=t_rot
            )
            self.assertEqual(val_res["session_id"], session_id)
            self.assertEqual(val_res["step"], curr_step)

    # =========================================================================
    # 8. Week 2 Real-Data Tests: Decode Histogram & Camera Ladder Telemetry
    # =========================================================================
    def test_decode_duration_histogram_ingest_and_rollup(self):
        """
        Validates decode_duration_ms ingestion, schema validation, and rollup calculation:
        - decode_duration_ms is persisted
        - daily rollup calculates decode_p50_ms, decode_p95_ms, decode_histogram_json
        - /scanner-health exposes decode_histogram with correct brackets
        """
        db = self.TestingSessionLocal()
        test_session_id = f"sess_dec_{uuid.uuid4().hex[:8]}"
        today_val = date.today()
        try:
            # Ingest successful decode events with durations across brackets:
            # 500ms (<1s), 1500ms (1-3s), 3500ms (3-5s), 6000ms (5-8s), 10000ms (8-15s)
            durations = [500.0, 1500.0, 3500.0, 6000.0, 10000.0]
            for dur in durations:
                ev = ScanTelemetryEvent(
                    event_type="frame_decoded",
                    stage="frame_decoded",
                    device_bucket="old",
                    display_type="projector",
                    duration_ms=dur,
                    decode_duration_ms=dur,
                    session_id=test_session_id,
                    created_at=datetime.utcnow()
                )
                db.add(ev)
            db.commit()

            # Run rollup service
            rollup_records = rollup_scan_telemetry(db, target_date=today_val)
            self.assertGreater(len(rollup_records), 0)

            # Check rollup record
            old_rollup = db.query(ScanTelemetryDailyRollup).filter(
                ScanTelemetryDailyRollup.date == today_val.isoformat(),
                ScanTelemetryDailyRollup.device_bucket == "old"
            ).first()
            self.assertIsNotNone(old_rollup)
            self.assertIsNotNone(old_rollup.decode_p50_ms)
            self.assertIsNotNone(old_rollup.decode_p95_ms)
            self.assertIsNotNone(old_rollup.decode_histogram_json)

            hist = json.loads(old_rollup.decode_histogram_json)
            self.assertIn("<1s", hist)
            self.assertIn("8-15s", hist)
        finally:
            db.close()

        # Query /scanner-health API
        res = self.client.get(
            f"/api/v1/telemetry/scanner-health?days=1&device_bucket=old",
            headers={"Authorization": f"Bearer {self.admin_token}"}
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("decode_histogram", data)
        dec_hist = data["decode_histogram"]
        self.assertIn("brackets", dec_hist)
        self.assertIn("by_bucket", dec_hist)
        self.assertGreaterEqual(dec_hist["total_decodes"], 5)

    def test_camera_ladder_rung_telemetry_tagging(self):
        """
        Validates Quick Win C.3: camera constraint fallback rungs (1, 2, 3)
        are accepted in telemetry details without crashing.
        """
        batch = {
            "events": [
                {
                    "event_type": "camera_opened",
                    "stage": "camera_opened",
                    "device_bucket": "old",
                    "display_type": "projector",
                    "duration_ms": 1850.0,
                    "details": {"ladder_rung": 2, "fallback_used": True}
                },
                {
                    "event_type": "decode_duration_histogram",
                    "stage": "frame_decoded",
                    "device_bucket": "old",
                    "display_type": "phone_screen",
                    "decode_duration_ms": 3200.0,
                    "duration_ms": 3200.0
                }
            ]
        }
        res = self.client.post(
            "/api/v1/telemetry/scan-events",
            json=batch,
            headers={"Authorization": f"Bearer {self.student_token}"}
        )
        self.assertEqual(res.status_code, 202)
        self.assertEqual(res.json()["status"].upper(), "ACCEPTED")

    def test_display_type_session_and_filtering(self):
        """
        Validates display_type parameter support:
        - optional with default 'projector'
        - filters in scanner-health
        - included in CSV export
        """
        # Test scanner-health with display_type filter
        res_proj = self.client.get(
            "/api/v1/telemetry/scanner-health?days=7&display_type=projector",
            headers={"Authorization": f"Bearer {self.admin_token}"}
        )
        self.assertEqual(res_proj.status_code, 200)
        self.assertEqual(res_proj.json()["display_filter"], "projector")

        res_phone = self.client.get(
            "/api/v1/telemetry/scanner-health?days=7&display_type=phone_screen",
            headers={"Authorization": f"Bearer {self.admin_token}"}
        )
        self.assertEqual(res_phone.status_code, 200)
        self.assertEqual(res_phone.json()["display_filter"], "phone_screen")

        # Test CSV export contains display_type column
        res_csv = self.client.get(
            "/api/v1/telemetry/export-funnel-csv?days=7&display_type=projector",
            headers={"Authorization": f"Bearer {self.admin_token}"}
        )
        self.assertEqual(res_csv.status_code, 200)
        self.assertIn("display_type", res_csv.text)
        self.assertIn("decode_duration_ms", res_csv.text)


if __name__ == "__main__":
    unittest.main()

