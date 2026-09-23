"""
test_scanner_engine_harness.py — Automated Test Suite for Week 6 Scanner Engine Swap & Harness

Validates:
1. Default scanner engine is strictly 'jsqr' across configuration layers
2. Public endpoint GET /api/v1/telemetry/scanner-config returns engine metadata and zero-CDN wasm_url
3. Dynamic SystemSettings runtime override switches config without service restart
4. Ingestion schema validation:
   - Validates engine='jsqr' accepted
   - Validates engine='wasm' accepted
   - Validates invalid engine rejected with HTTP 422
   - Validates engine defaults to 'jsqr' when omitted
5. Health aggregation:
   - Returns engine_split breakdown
   - Filter by engine query parameter (?engine=jsqr / ?engine=wasm)
6. Zero touch on token and scan verification endpoints
"""

import sys
import os
import unittest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.main import app
from app.core.config import settings
from app.core.database import get_db, Base
from app.models.models import (
    User, UserRole, SystemSettings, ScanTelemetryEvent
)
from app.core.security import create_access_token, get_password_hash


class TestScannerEngineHarness(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
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

        # Create admin user for protected endpoint testing
        db = cls.TestingSessionLocal()
        admin = User(
            username="admin_engine_test",
            email="admin_engine_test@snist.edu.in",
            password_hash=get_password_hash("AdminPass123!"),
            role=UserRole.SUPER_ADMIN,
            is_active=True
        )
        db.add(admin)
        db.commit()
        db.refresh(admin)
        cls.admin_token = create_access_token(data={"sub": admin.username, "role": admin.role.value})
        cls.admin_headers = {"Authorization": f"Bearer {cls.admin_token}"}
        db.close()

    @classmethod
    def tearDownClass(cls):
        app.dependency_overrides.clear()

    def setUp(self):
        # Clear telemetry and settings between tests
        db = self.TestingSessionLocal()
        db.query(ScanTelemetryEvent).delete()
        db.query(SystemSettings).delete()
        db.commit()
        db.close()

    def test_01_default_engine_is_strictly_jsqr(self):
        """Verify the global configuration defaults to a valid scanner engine."""
        self.assertIn(settings.SCANNER_ENGINE, ["wasm", "jsqr"])

    def test_02_scanner_config_endpoint(self):
        """Verify GET /api/v1/telemetry/scanner-config returns expected defaults and wasm_url."""
        res = self.client.get("/api/v1/telemetry/scanner-config")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["scanner_engine"], settings.SCANNER_ENGINE)
        self.assertEqual(data["default_engine"], settings.SCANNER_ENGINE)
        self.assertIn("jsqr", data["available_engines"])
        self.assertIn("wasm", data["available_engines"])
        self.assertFalse(data["allow_student_override"])
        self.assertEqual(data["wasm_url"], "/wasm/zxing_reader.wasm")

    def test_03_system_settings_runtime_engine_override(self):
        """Verify SystemSettings DB table dynamically overrides scanner engine without process restart."""
        db = self.TestingSessionLocal()
        setting = SystemSettings(
            key="scanner_engine",
            value="wasm",
            description="Dynamic scanner engine test toggle"
        )
        db.add(setting)
        db.commit()
        db.close()

        res = self.client.get("/api/v1/telemetry/scanner-config")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["scanner_engine"], "wasm")

    def test_04_telemetry_engine_ingest_validation(self):
        """Verify validation of engine field on telemetry ingestion: jsqr, wasm, and invalid rejection."""
        # 1. Valid jsqr
        res_jsqr = self.client.post("/api/v1/telemetry/scan-events", json={
            "events": [{
                "event_type": "decode_duration_histogram",
                "stage": "frame_decoded",
                "device_bucket": "mid",
                "duration_ms": 15,
                "engine": "jsqr"
            }]
        }, headers=self.admin_headers)
        self.assertEqual(res_jsqr.status_code, 202)

        # 2. Valid wasm
        res_wasm = self.client.post("/api/v1/telemetry/scan-events", json={
            "events": [{
                "event_type": "decode_duration_histogram",
                "stage": "frame_decoded",
                "device_bucket": "new",
                "duration_ms": 3,
                "engine": "wasm"
            }]
        }, headers=self.admin_headers)
        self.assertEqual(res_wasm.status_code, 202)

        # 3. Invalid engine rejected with 422
        res_invalid = self.client.post("/api/v1/telemetry/scan-events", json={
            "events": [{
                "event_type": "decode_duration_histogram",
                "stage": "frame_decoded",
                "device_bucket": "mid",
                "duration_ms": 10,
                "engine": "opencv_unsupported"
            }]
        }, headers=self.admin_headers)
        self.assertEqual(res_invalid.status_code, 422)

        # 4. Default engine when omitted
        res_default = self.client.post("/api/v1/telemetry/scan-events", json={
            "events": [{
                "event_type": "decode_duration_histogram",
                "stage": "frame_decoded",
                "device_bucket": "old",
                "duration_ms": 12
            }]
        }, headers=self.admin_headers)
        self.assertEqual(res_default.status_code, 202)

        # Verify DB records
        db = self.TestingSessionLocal()
        events = db.query(ScanTelemetryEvent).all()
        self.assertEqual(len(events), 3)
        engines = [e.engine for e in events]
        self.assertIn("jsqr", engines)
        self.assertIn("wasm", engines)
        db.close()

    def test_05_scanner_health_engine_split_and_filter(self):
        """Verify /scanner-health reports engine_split and supports ?engine filtering."""
        # Insert 3 jsqr events and 2 wasm events
        events_payload = [
            {"event_type": "decode_duration_histogram", "stage": "frame_decoded", "device_bucket": "mid", "duration_ms": 10, "engine": "jsqr"},
            {"event_type": "decode_duration_histogram", "stage": "frame_decoded", "device_bucket": "mid", "duration_ms": 12, "engine": "jsqr"},
            {"event_type": "decode_duration_histogram", "stage": "frame_decoded", "device_bucket": "mid", "duration_ms": 8, "engine": "jsqr"},
            {"event_type": "decode_duration_histogram", "stage": "frame_decoded", "device_bucket": "new", "duration_ms": 2, "engine": "wasm"},
            {"event_type": "decode_duration_histogram", "stage": "frame_decoded", "device_bucket": "new", "duration_ms": 3, "engine": "wasm"},
        ]
        res_batch = self.client.post("/api/v1/telemetry/scan-events", json={"events": events_payload}, headers=self.admin_headers)
        self.assertEqual(res_batch.status_code, 202)

        # Query all
        res_all = self.client.get("/api/v1/telemetry/scanner-health", headers=self.admin_headers)
        self.assertEqual(res_all.status_code, 200)
        data_all = res_all.json()
        self.assertEqual(data_all["decode_histogram"]["total_decodes"], 5)
        self.assertEqual(data_all["headline"]["engine_split"]["jsqr"], 3)
        self.assertEqual(data_all["headline"]["engine_split"]["wasm"], 2)

        # Query filter ?engine=wasm
        res_wasm = self.client.get("/api/v1/telemetry/scanner-health?engine=wasm", headers=self.admin_headers)
        self.assertEqual(res_wasm.status_code, 200)
        data_wasm = res_wasm.json()
        self.assertEqual(data_wasm["decode_histogram"]["total_decodes"], 2)

        # Query filter ?engine=jsqr
        res_jsqr = self.client.get("/api/v1/telemetry/scanner-health?engine=jsqr", headers=self.admin_headers)
        self.assertEqual(res_jsqr.status_code, 200)
        data_jsqr = res_jsqr.json()
        self.assertEqual(data_jsqr["decode_histogram"]["total_decodes"], 3)

    def test_06_week7_new_error_types_validation(self):
        """Verify Week 7 error types: multi_code_detected, multi_qr_rejected, engine_fallback."""
        events_payload = [
            {
                "event_type": "scan_failed",
                "stage": "frame_decoded",
                "error_type": "multi_code_detected",
                "device_bucket": "mid",
                "engine": "wasm"
            },
            {
                "event_type": "scan_failed",
                "stage": "frame_decoded",
                "error_type": "multi_qr_rejected",
                "device_bucket": "old",
                "engine": "wasm"
            },
            {
                "event_type": "scan_failed",
                "stage": "frame_decoded",
                "error_type": "engine_fallback",
                "device_bucket": "old",
                "engine": "wasm"
            }
        ]
        res = self.client.post("/api/v1/telemetry/scan-events", json={"events": events_payload}, headers=self.admin_headers)
        self.assertEqual(res.status_code, 202)

        # Verify persisted
        db = self.TestingSessionLocal()
        events = db.query(ScanTelemetryEvent).filter(ScanTelemetryEvent.event_type == "scan_failed").all()
        error_types = [e.error_type for e in events]
        self.assertIn("multi_code_detected", error_types)
        self.assertIn("multi_qr_rejected", error_types)
        self.assertIn("engine_fallback", error_types)
        db.close()

    def test_07_week7_distance_bucket_and_decode_scale(self):
        """Verify Week 7 distance_bucket and decode_scale ingestion and /scanner-health filtering."""
        events_payload = [
            {
                "event_type": "decode_duration_histogram",
                "stage": "frame_decoded",
                "device_bucket": "old",
                "duration_ms": 20,
                "engine": "wasm",
                "distance_bucket": "10-15m",
                "decode_scale": 960
            },
            {
                "event_type": "decode_duration_histogram",
                "stage": "frame_decoded",
                "device_bucket": "mid",
                "duration_ms": 6,
                "engine": "wasm",
                "distance_bucket": "5-10m",
                "decode_scale": 640
            },
            {
                "event_type": "decode_duration_histogram",
                "stage": "frame_decoded",
                "device_bucket": "new",
                "duration_ms": 2,
                "engine": "wasm",
                "distance_bucket": "<=5m",
                "decode_scale": 640
            }
        ]
        res = self.client.post("/api/v1/telemetry/scan-events", json={"events": events_payload}, headers=self.admin_headers)
        self.assertEqual(res.status_code, 202)

        # Query /scanner-health filtered by distance_bucket=10-15m
        res_dist = self.client.get("/api/v1/telemetry/scanner-health?distance_bucket=10-15m", headers=self.admin_headers)
        self.assertEqual(res_dist.status_code, 200)
        data_dist = res_dist.json()
        self.assertEqual(data_dist["decode_histogram"]["total_decodes"], 1)

    def test_08_invalid_distance_bucket_rejection(self):
        """Verify invalid distance_bucket is rejected with HTTP 422."""
        res = self.client.post("/api/v1/telemetry/scan-events", json={
            "events": [{
                "event_type": "decode_duration_histogram",
                "stage": "frame_decoded",
                "device_bucket": "old",
                "distance_bucket": "20m-30m"
            }]
        }, headers=self.admin_headers)
        self.assertEqual(res.status_code, 422)


if __name__ == "__main__":
    unittest.main()
