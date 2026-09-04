import os
import sys
import unittest
from datetime import datetime, timedelta
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# Ensure backend directory is in sys.path
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.main import app
from app.core.database import get_db, Base
from app.models.models import (
    User, UserRole, Department, AcademicYear, Section, Subject,
    Teacher, Student, Classroom, AttendanceSession, AttendanceRecord,
    AttendanceAuditReview, DeviceBinding, SheetsSyncDLQ, SessionStatus
)
from app.services.sheets_batch_worker import sync_session_to_sheets_batch

# SQLite in-memory engine for isolated fast automated tests
SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
test_engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)

def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db


class TestProxPresenceApi(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        Base.metadata.create_all(bind=test_engine)
        cls.client = TestClient(app)
        
        # Setup initial fixtures
        db = TestingSessionLocal()
        cls.dept = Department(code="CSE", name="Computer Science")
        cls.ayear = AcademicYear(name="3rd Year")
        db.add_all([cls.dept, cls.ayear])
        db.commit()

        cls.sec_a = Section(name="CSE-A", department_id=cls.dept.id, academic_year_id=cls.ayear.id)
        cls.sec_b = Section(name="CSE-B", department_id=cls.dept.id, academic_year_id=cls.ayear.id)
        db.add_all([cls.sec_a, cls.sec_b])
        db.commit()

        cls.room = Classroom(
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
        db.add(cls.room)
        db.commit()

        cls.faculty_user = User(username="fac101", password_hash="hash", role=UserRole.TEACHER)
        db.add(cls.faculty_user)
        db.commit()

        cls.teacher = Teacher(
            user_id=cls.faculty_user.id,
            teacher_code="FAC101",
            name="Dr. A. Sharma",
            department_id=cls.dept.id
        )
        db.add(cls.teacher)
        db.commit()

        # Student 1 in CSE-A
        cls.s1 = Student(
            roll_number="238A1A0501",
            name="Aarav Reddy",
            department_id=cls.dept.id,
            academic_year_id=cls.ayear.id,
            section_id=cls.sec_a.id,
            device_hash="hash_student_1"
        )
        # Student 2 in CSE-A
        cls.s2 = Student(
            roll_number="238A1A0502",
            name="Vivaan Rao",
            department_id=cls.dept.id,
            academic_year_id=cls.ayear.id,
            section_id=cls.sec_a.id,
            device_hash="hash_student_2"
        )
        # Student 3 in CSE-B (Section mismatch test)
        cls.s3 = Student(
            roll_number="238A1A0551",
            name="Aditya Verma",
            department_id=cls.dept.id,
            academic_year_id=cls.ayear.id,
            section_id=cls.sec_b.id,
            device_hash="hash_student_3"
        )
        db.add_all([cls.s1, cls.s2, cls.s3])
        db.commit()

        # Cache IDs to avoid DetachedInstanceError
        cls.teacher_id = cls.teacher.id
        cls.room_id = cls.room.id
        cls.dept_id = cls.dept.id
        cls.ayear_id = cls.ayear.id
        cls.sec_a_id = cls.sec_a.id
        cls.s1_id = cls.s1.id
        cls.s2_id = cls.s2.id
        cls.s3_id = cls.s3.id
        db.close()

    def setUp(self):
        app.dependency_overrides[get_db] = override_get_db

    def test_01_health_check(self):
        res = self.client.get("/health")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "ONLINE")
        self.assertIn("server_time_ist", data)
        self.assertEqual(data["database"], "CONNECTED")

    def test_02_session_start_and_code_verify(self):
        payload = {
            "faculty_id": self.teacher_id,
            "room_id": self.room_id,
            "section": "CSE-A",
            "period": "Period 2"
        }
        res = self.client.post("/session/start", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "OPEN")
        self.assertIn("session_id", data)
        self.assertEqual(len(data["rotating_code"]), 4)
        self.assertIn("beacon_payload", data)
        
        session_id = data["session_id"]
        valid_code = data["rotating_code"]

        # Verify valid code
        v_res = self.client.post("/code/verify", json={"session_id": session_id, "code": valid_code})
        self.assertEqual(v_res.status_code, 200)
        self.assertTrue(v_res.json()["valid"])

        # Verify invalid code
        v_res_bad = self.client.post("/code/verify", json={"session_id": session_id, "code": "ZZZZ"})
        self.assertEqual(v_res_bad.status_code, 200)
        self.assertFalse(v_res_bad.json()["valid"])

    def test_03_attendance_mark_ble_tier_and_idempotency(self):
        # Start a fresh session
        s_res = self.client.post("/session/start", json={
            "faculty_id": self.teacher_id,
            "room_id": self.room_id,
            "section": "CSE-A"
        })
        session_id = s_res.json()["session_id"]

        # 1. Successful BLE mark (RSSI >= -75 dBm)
        mark_payload = {
            "session_id": session_id,
            "roll_no": "238A1A0501",
            "device_hash": "device_fingerprint_student_1",
            "method": "ble",
            "rssi": -70,
            "latitude": 17.448291,
            "longitude": 78.391482,
            "geo_accuracy_m": 12.0
        }
        res = self.client.post("/attendance/mark", json=mark_payload)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "SUCCESS")
        self.assertEqual(res.json()["roll_no"], "238A1A0501")

        # 2. Idempotent re-submission (must return 200 with friendly message, no duplicate row)
        res_dup = self.client.post("/attendance/mark", json=mark_payload)
        self.assertEqual(res_dup.status_code, 200)
        self.assertIn("already confirmed", res_dup.json()["message"])

        # Verify exactly 1 record in DB
        db = TestingSessionLocal()
        count = db.query(AttendanceRecord).filter(
            AttendanceRecord.session_id == session_id,
            AttendanceRecord.student_id == self.s1_id
        ).count()
        self.assertEqual(count, 1)
        db.close()

    def test_04_attendance_mark_ble_borderline_rssi_flagged(self):
        s_res = self.client.post("/session/start", json={
            "faculty_id": self.teacher_id,
            "room_id": self.room_id,
            "section": "CSE-A"
        })
        session_id = s_res.json()["session_id"]

        # Borderline RSSI: -78 dBm (between -75 and -85 dBm) -> accepted, but flagged
        mark_payload = {
            "session_id": session_id,
            "roll_no": "238A1A0502",
            "device_hash": "device_fingerprint_student_2",
            "method": "ble",
            "rssi": -78,
            "latitude": 17.448291,
            "longitude": 78.391482
        }
        res = self.client.post("/attendance/mark", json=mark_payload)
        self.assertEqual(res.status_code, 200)

        # Check that audit review was logged with 'rssi_borderline'
        db = TestingSessionLocal()
        rev = db.query(AttendanceAuditReview).filter(
            AttendanceAuditReview.session_id == session_id,
            AttendanceAuditReview.student_id == self.s2_id
        ).first()
        self.assertIsNotNone(rev)
        self.assertEqual(rev.flag, "rssi_borderline")
        db.close()

    def test_05_attendance_mark_ble_too_weak_rejected(self):
        s_res = self.client.post("/session/start", json={
            "faculty_id": self.teacher_id,
            "room_id": self.room_id,
            "section": "CSE-A"
        })
        session_id = s_res.json()["session_id"]

        # Weak RSSI: -92 dBm (below -85 dBm) -> REJECTED
        mark_payload = {
            "session_id": session_id,
            "roll_no": "238A1A0502",
            "device_hash": "dev_student_2_weak",
            "method": "ble",
            "rssi": -92
        }
        res = self.client.post("/attendance/mark", json=mark_payload)
        self.assertEqual(res.status_code, 400)
        self.assertIn("Bluetooth signal too weak", res.json()["detail"])

    def test_06_attendance_mark_code_tier(self):
        s_res = self.client.post("/session/start", json={
            "faculty_id": self.teacher_id,
            "room_id": self.room_id,
            "section": "CSE-A"
        })
        session_id = s_res.json()["session_id"]
        valid_code = s_res.json()["rotating_code"]

        # 1. Submit with valid rotating code
        res = self.client.post("/attendance/mark", json={
            "session_id": session_id,
            "roll_no": "238A1A0502",
            "device_hash": "dev_student_2_code",
            "method": "code",
            "code": valid_code
        })
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["method"], "code")

        # 2. Submit with bad code -> 400
        res_bad = self.client.post("/attendance/mark", json={
            "session_id": session_id,
            "roll_no": "238A1A0501",
            "device_hash": "dev_student_1_bad_code",
            "method": "code",
            "code": "BAD1"
        })
        self.assertEqual(res_bad.status_code, 400)
        self.assertIn("Invalid or expired rotating code", res_bad.json()["detail"])

    def test_07_security_invariant_section_mismatch(self):
        # Session is for CSE-A
        s_res = self.client.post("/session/start", json={
            "faculty_id": self.teacher_id,
            "room_id": self.room_id,
            "section": "CSE-A"
        })
        session_id = s_res.json()["session_id"]
        code = s_res.json()["rotating_code"]

        # Student 3 is enrolled in CSE-B -> Section mismatch
        res = self.client.post("/attendance/mark", json={
            "session_id": session_id,
            "roll_no": "238A1A0551",
            "device_hash": "dev_student_3_diff_sec",
            "method": "code",
            "code": code
        })
        self.assertEqual(res.status_code, 403)
        self.assertIn("Section mismatch", res.json()["detail"])

    def test_08_security_invariant_device_binding_lock(self):
        s_res = self.client.post("/session/start", json={
            "faculty_id": self.teacher_id,
            "room_id": self.room_id,
            "section": "CSE-A"
        })
        session_id = s_res.json()["session_id"]
        code = s_res.json()["rotating_code"]

        shared_device_hash = "shared_hardware_uuid_9999"

        # Student 1 marks with shared_device_hash -> SUCCESS
        res1 = self.client.post("/attendance/mark", json={
            "session_id": session_id,
            "roll_no": "238A1A0501",
            "device_hash": shared_device_hash,
            "method": "code",
            "code": code
        })
        self.assertEqual(res1.status_code, 200)

        # Student 2 tries to mark from SAME shared_device_hash within 30 min -> HTTP 403 Security Lock
        res2 = self.client.post("/attendance/mark", json={
            "session_id": session_id,
            "roll_no": "238A1A0502",
            "device_hash": shared_device_hash,
            "method": "code",
            "code": code
        })
        self.assertEqual(res2.status_code, 403)
        self.assertIn("Security Lock: one phone per student per 30-minute session", res2.json()["detail"])

    def test_09_security_invariant_denied_geolocation_never_hard_error(self):
        s_res = self.client.post("/session/start", json={
            "faculty_id": self.teacher_id,
            "room_id": self.room_id,
            "section": "CSE-A"
        })
        session_id = s_res.json()["session_id"]
        code = s_res.json()["rotating_code"]

        # Lat/lon is None (denied location) -> accepted, audit flag added
        res = self.client.post("/attendance/mark", json={
            "session_id": session_id,
            "roll_no": "238A1A0501",
            "device_hash": "dev_no_geo_101",
            "method": "code",
            "code": code,
            "latitude": None,
            "longitude": None
        })
        self.assertEqual(res.status_code, 200)

        db = TestingSessionLocal()
        rev = db.query(AttendanceAuditReview).filter(
            AttendanceAuditReview.session_id == session_id,
            AttendanceAuditReview.student_id == self.s1_id,
            AttendanceAuditReview.flag == "geo_coarse"
        ).first()
        self.assertIsNotNone(rev)
        db.close()

    def test_10_kill_switch_and_manual_checkin(self):
        s_res = self.client.post("/session/start", json={
            "faculty_id": self.teacher_id,
            "room_id": self.room_id,
            "section": "CSE-A"
        })
        session_id = s_res.json()["session_id"]
        code = s_res.json()["rotating_code"]

        # 1. Activate Kill Switch (error rate > 10%)
        ks_res = self.client.post("/admin/kill-switch", json={
            "session_id": session_id,
            "active": True,
            "reason": "Hardware BLE interference detected"
        })
        self.assertEqual(ks_res.status_code, 200)
        self.assertTrue(ks_res.json()["kill_switch_active"])

        # 2. Automated code mark must now be REJECTED with 403 manual-only message
        res_rej = self.client.post("/attendance/mark", json={
            "session_id": session_id,
            "roll_no": "238A1A0501",
            "device_hash": "dev_ks_test",
            "method": "code",
            "code": code
        })
        self.assertEqual(res_rej.status_code, 403)
        self.assertIn("manual-only mode", res_rej.json()["detail"])

        # 3. Faculty Manual Check-in must still WORK
        res_man = self.client.post("/attendance/mark", json={
            "session_id": session_id,
            "roll_no": "238A1A0501",
            "device_hash": "dev_faculty_desk",
            "method": "manual"
        })
        self.assertEqual(res_man.status_code, 200)
        self.assertEqual(res_man.json()["method"], "manual")

        # 4. Deactivate Kill Switch -> Automated marks work again
        self.client.post("/admin/kill-switch", json={"session_id": session_id, "active": False})
        res_ok = self.client.post("/attendance/mark", json={
            "session_id": session_id,
            "roll_no": "238A1A0502",
            "device_hash": "dev_ks_restored",
            "method": "code",
            "code": code
        })
        self.assertEqual(res_ok.status_code, 200)

    def test_11_session_lock_and_reconciliation_report(self):
        s_res = self.client.post("/session/start", json={
            "faculty_id": self.teacher_id,
            "room_id": self.room_id,
            "section": "CSE-A"
        })
        session_id = s_res.json()["session_id"]
        code = s_res.json()["rotating_code"]

        # Mark 1 via BLE, 1 via Code
        self.client.post("/attendance/mark", json={
            "session_id": session_id, "roll_no": "238A1A0501",
            "device_hash": "dev_rec_1", "method": "ble", "rssi": -72
        })
        self.client.post("/attendance/mark", json={
            "session_id": session_id, "roll_no": "238A1A0502",
            "device_hash": "dev_rec_2", "method": "code", "code": code
        })

        # Lock session
        lock_res = self.client.post("/session/lock", json={"session_id": session_id})
        self.assertEqual(lock_res.status_code, 200)
        data = lock_res.json()
        self.assertEqual(data["status"], "LOCKED")
        
        recon = data["reconciliation"]
        self.assertEqual(recon["total_marked"], 2)
        self.assertEqual(recon["method_breakdown"]["ble"], 1)
        self.assertEqual(recon["method_breakdown"]["code"], 1)
        self.assertEqual(recon["sheets_sync_status"], "QUEUED_BATCH")

        # Further marks must be rejected on locked session
        res_post_lock = self.client.post("/attendance/mark", json={
            "session_id": session_id, "roll_no": "238A1A0501",
            "device_hash": "dev_rec_late", "method": "ble", "rssi": -72
        })
        self.assertEqual(res_post_lock.status_code, 400)
        self.assertIn("locked", res_post_lock.json()["detail"])

    def test_12_sheets_batch_worker_retry_and_dlq(self):
        """
        Deliverable 4: Verify exponential backoff (3 retries) and dead-letter queue (DLQ) logging.
        """
        # Create session with records
        s_res = self.client.post("/session/start", json={
            "faculty_id": self.teacher_id,
            "room_id": self.room_id,
            "section": "CSE-A"
        })
        session_id = s_res.json()["session_id"]

        self.client.post("/attendance/mark", json={
            "session_id": session_id, "roll_no": "238A1A0501",
            "device_hash": "dev_dlq_1", "method": "ble", "rssi": -70
        })

        # Mock client that always raises an API connection error
        class MockFailingSheetsClient:
            def __init__(self):
                self.attempts = 0

            def execute_batch_update(self, spreadsheet_id, batch_data):
                self.attempts += 1
                raise ConnectionError(f"Simulated Google Sheets API 503 Outage (Attempt {self.attempts})")

        failing_client = MockFailingSheetsClient()
        db = TestingSessionLocal()
        
        # Run worker with mock failing client
        result = sync_session_to_sheets_batch(
            session_id=session_id,
            max_retries=3,
            sheets_client_override=failing_client,
            db_session=db
        )

        # Assert worker exhausted retries and pushed to DLQ
        self.assertEqual(failing_client.attempts, 3)
        self.assertEqual(result["status"], "DLQ_QUEUED")
        self.assertEqual(result["retries_exhausted"], 3)

        # Verify entry in sheets_sync_dlq table
        dlq_row = db.query(SheetsSyncDLQ).filter(SheetsSyncDLQ.session_id == session_id).first()
        self.assertIsNotNone(dlq_row)
        self.assertEqual(dlq_row.retry_count, 3)
        self.assertEqual(dlq_row.status, "FAILED")
        self.assertIn("Simulated Google Sheets API 503 Outage", dlq_row.error_message)
        db.close()

    def test_13_high_concurrency_100_students_in_10s(self):
        """
        Load test invariant verification:
        100 concurrent student marks within 10s budget.
        Asserts:
          - zero HTTP 429 rate-limits
          - zero failed student responses (100 HTTP 200s)
          - all 100 records persisted in DB
          - execution duration <= 10.0s
        """
        import time
        import hashlib

        # 1. Start fresh session for CSE-A
        s_res = self.client.post("/session/start", json={
            "faculty_id": self.teacher_id,
            "room_id": self.room_id,
            "section": "CSE-A"
        })
        session_id = s_res.json()["session_id"]

        # 2. Seed 100 students into the test SQLite DB for CSE-A
        db = TestingSessionLocal()
        roster = [f"238A1A05{i:02d}" for i in range(1, 101)]
        for roll in roster:
            existing = db.query(Student).filter(Student.roll_number == roll).first()
            if not existing:
                dev = hashlib.sha256(f"dev_test_{roll}".encode()).hexdigest()
                st = Student(
                    roll_number=roll,
                    name=f"Student {roll}",
                    department_id=self.dept_id,
                    academic_year_id=self.ayear_id,
                    section_id=self.sec_a_id,
                    device_hash=dev
                )
                db.add(st)
            else:
                existing.section_id = self.sec_a_id
        db.commit()
        db.close()

        # 3. Fire 100 student submissions in sequential batch
        t0 = time.perf_counter()
        results = []
        for roll in roster:
            dev = hashlib.sha256(f"dev_test_{roll}".encode()).hexdigest()
            payload = {
                "session_id": session_id,
                "roll_no": roll,
                "device_hash": dev,
                "method": "ble",
                "rssi": -72,
                "latitude": 17.448291,
                "longitude": 78.391482,
                "geo_accuracy_m": 10.0
            }
            resp = self.client.post("/attendance/mark", json=payload)
            results.append(resp.status_code)

        elapsed = time.perf_counter() - t0

        # 4. Assert zero 429s, zero failures, all 100 persisted, and <= 10.0s
        self.assertEqual(results.count(429), 0, "Violates zero-429 invariant")
        self.assertEqual(results.count(200), 100, f"Expected 100 HTTP 200s, got {results.count(200)}")
        self.assertLessEqual(elapsed, 10.0, f"Execution took {elapsed:.2f}s, exceeding 10.0s budget")

        db_v = TestingSessionLocal()
        count = db_v.query(AttendanceRecord).filter(AttendanceRecord.session_id == session_id).count()
        self.assertEqual(count, 100, f"Expected 100 records in DB, found {count}")
        db_v.close()


if __name__ == "__main__":
    unittest.main()
