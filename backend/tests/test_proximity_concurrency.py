import os
import sys
import time
import asyncio
import tempfile
import pytest
from datetime import datetime, timedelta
from unittest.mock import patch

# Ensure backend directory is in sys.path
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
root_dir = os.path.dirname(backend_dir)
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)

import httpx
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.core.database import Base, get_db
from app.models.models import (
    User, UserRole, Department, AcademicYear, Section, Subject,
    Teacher, Student, TeacherAssignment, AttendanceSession,
    AttendanceRecord, Classroom, AttendanceAuditReview
)
from app.core.security import (
    get_password_hash, create_access_token, get_server_ist_date
)

from sqlalchemy.pool import NullPool

# File-based SQLite DB with WAL mode to support multi-connection concurrent writes cleanly
temp_db_file = tempfile.NamedTemporaryFile(suffix="_concurrency.db", delete=False)
temp_db_file.close()
temp_db_path = temp_db_file.name.replace("\\", "/")

SQLALCHEMY_DATABASE_URL = f"sqlite:///{temp_db_path}"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False, "timeout": 60.0},
    poolclass=NullPool
)

with engine.connect() as con:
    con.exec_driver_sql("PRAGMA journal_mode=WAL;")
    con.exec_driver_sql("PRAGMA synchronous=NORMAL;")

TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db
client = TestClient(app)

class TestProximityConcurrency:
    patcher = None

    def setup_method(self):
        app.dependency_overrides[get_db] = override_get_db

    @classmethod
    def setup_class(cls):
        # Mock external Google Sheets / Excel background tasks to benchmark raw attendance throughput
        cls.patcher = patch("app.api.attendance._async_post_scan_tasks")
        cls.patcher.start()

        Base.metadata.create_all(bind=engine)
        db = TestingSessionLocal()

        dept = Department(code="CSE", name="Computer Science")
        db.add(dept)
        db.commit()

        year = AcademicYear(name="3rd Year")
        db.add(year)
        db.commit()

        sec = Section(name="CSE-CONCURRENCY", department_id=dept.id, academic_year_id=year.id)
        db.add(sec)
        db.commit()

        subj = Subject(code="CS399", name="High Throughput Distributed Systems", department_id=dept.id, academic_year_id=year.id)
        db.add(subj)
        db.commit()

        room = Classroom(
            room_code="ROOM-304-CONCURRENCY",
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

        default_pwd_hash = get_password_hash("pass123")

        t_user = User(
            username="teacher_conc",
            email="teacher_conc@snist.edu.in",
            password_hash=default_pwd_hash,
            role=UserRole.TEACHER
        )
        db.add(t_user)
        db.commit()

        teacher = Teacher(
            user_id=t_user.id,
            teacher_code="T-CONC",
            name="Prof Concurrency",
            department_id=dept.id
        )
        db.add(teacher)
        db.commit()

        assignment = TeacherAssignment(
            teacher_id=teacher.id,
            subject_id=subj.id,
            section_id=sec.id
        )
        db.add(assignment)
        db.commit()

        cls.teacher_id = teacher.id
        cls.section_id = sec.id
        cls.subject_id = subj.id
        cls.classroom_id = room.id
        cls.teacher_token = create_access_token(
            data={"sub": "teacher_conc", "role": "TEACHER", "id": t_user.id},
            expires_delta=timedelta(hours=2)
        )

        cls.students_pool = []
        for i in range(1, 201):
            roll = f"23SN1A{i:04d}"
            s_user = User(
                username=roll,
                email=f"{roll}@snist.edu.in",
                password_hash=default_pwd_hash,
                role=UserRole.STUDENT
            )
            db.add(s_user)
            db.commit()

            st = Student(
                user_id=s_user.id,
                roll_number=roll,
                name=f"Student {i}",
                department_id=dept.id,
                section_id=sec.id,
                academic_year_id=year.id
            )
            db.add(st)
            db.commit()

            token = create_access_token(
                data={"sub": roll, "role": "STUDENT", "id": s_user.id},
                expires_delta=timedelta(hours=2)
            )

            cls.students_pool.append({
                "student_id": st.id,
                "roll_number": roll,
                "token": token,
                "device_id": f"DEV-CONC-{i:04d}"
            })

        db.close()

    @classmethod
    def teardown_class(cls):
        if cls.patcher:
            cls.patcher.stop()
        try:
            engine.dispose()
            for ext in ["", "-wal", "-shm"]:
                p = temp_db_path + ext
                if os.path.exists(p):
                    os.remove(p)
        except Exception:
            pass

    def _start_fresh_session(self, period_label="Period 1"):
        res = client.post(
            "/api/v1/attendance/session/start-proximity",
            json={
                "subject_id": self.subject_id,
                "section_id": self.section_id,
                "period": period_label,
                "date": get_server_ist_date(),
                "classroom_id": self.classroom_id
            },
            headers={"Authorization": f"Bearer {self.teacher_token}"}
        )
        assert res.status_code == 200, res.text
        return res.json()

    def test_01_fifty_concurrent_students(self):
        """Simulate 50 students submitting proximity verification concurrently."""
        session_data = self._start_fresh_session("Period 1")
        session_id = session_data["session_id"]
        challenge = session_data["challenge_nonce"]
        batch = self.students_pool[0:50]

        async def run_concurrent():
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                tasks = []
                for s in batch:
                    headers = {
                        "Authorization": f"Bearer {s['token']}",
                        "x-device-public-id": s["device_id"]
                    }
                    payload = {
                        "session_id": session_id,
                        "challenge_nonce": challenge,
                        "latitude": 17.448291,
                        "longitude": 78.391482,
                        "location_accuracy_meters": 15,
                        "median_rssi": -65
                    }
                    tasks.append(ac.post("/api/v1/attendance/proximity-submit", json=payload, headers=headers))
                t0 = time.time()
                responses = await asyncio.gather(*tasks)
                duration = time.time() - t0
                return responses, duration

        responses, total_duration = asyncio.run(run_concurrent())

        status_codes = [r.status_code for r in responses]
        assert all(code == 200 for code in status_codes), f"Failed codes: {[c for c in status_codes if c != 200]}"
        assert len(responses) == 50
        print(f"\n[BENCHMARK] 50 Concurrent Students: {total_duration:.2f}s (Avg: {total_duration/50*1000:.1f}ms per req)")
        assert total_duration < 5.0

        db = TestingSessionLocal()
        records = db.query(AttendanceRecord).filter(AttendanceRecord.session_id == session_id).all()
        assert len(records) == 50
        db.close()

    def test_02_one_hundred_concurrent_students(self):
        """Simulate 100 students submitting proximity verification concurrently."""
        session_data = self._start_fresh_session("Period 2")
        session_id = session_data["session_id"]
        challenge = session_data["challenge_nonce"]
        batch = self.students_pool[0:100]

        async def run_concurrent():
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                tasks = []
                for s in batch:
                    headers = {
                        "Authorization": f"Bearer {s['token']}",
                        "x-device-public-id": s["device_id"]
                    }
                    payload = {
                        "session_id": session_id,
                        "challenge_nonce": challenge,
                        "latitude": 17.448291,
                        "longitude": 78.391482,
                        "location_accuracy_meters": 18,
                        "median_rssi": -68
                    }
                    tasks.append(ac.post("/api/v1/attendance/proximity-submit", json=payload, headers=headers))
                t0 = time.time()
                responses = await asyncio.gather(*tasks)
                duration = time.time() - t0
                return responses, duration

        responses, total_duration = asyncio.run(run_concurrent())

        status_codes = [r.status_code for r in responses]
        assert all(code == 200 for code in status_codes), f"Failed codes: {[c for c in status_codes if c != 200]}"
        assert len(responses) == 100
        print(f"\n[BENCHMARK] 100 Concurrent Students: {total_duration:.2f}s (Avg: {total_duration/100*1000:.1f}ms per req)")
        assert total_duration < 25.0

        db = TestingSessionLocal()
        records = db.query(AttendanceRecord).filter(AttendanceRecord.session_id == session_id).all()
        assert len(records) == 100
        db.close()

    def test_03_idempotent_duplicate_retries_under_concurrency(self):
        """Simulate 50 students sending duplicate requests concurrently (network retry storm)."""
        session_data = self._start_fresh_session("Period 3")
        session_id = session_data["session_id"]
        challenge = session_data["challenge_nonce"]
        batch = self.students_pool[0:50]

        async def run_first_pass():
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                tasks = []
                for s in batch:
                    headers = {
                        "Authorization": f"Bearer {s['token']}",
                        "x-device-public-id": s["device_id"]
                    }
                    payload = {
                        "session_id": session_id,
                        "challenge_nonce": challenge,
                        "latitude": 17.448291,
                        "longitude": 78.391482,
                        "location_accuracy_meters": 10,
                        "median_rssi": -60
                    }
                    tasks.append(ac.post("/api/v1/attendance/proximity-submit", json=payload, headers=headers))
                await asyncio.gather(*tasks)

        asyncio.run(run_first_pass())

        # Second pass: All 50 submit duplicate retry at exact same moment
        async def run_retry_storm():
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                tasks = []
                for s in batch:
                    headers = {
                        "Authorization": f"Bearer {s['token']}",
                        "x-device-public-id": s["device_id"]
                    }
                    payload = {
                        "session_id": session_id,
                        "challenge_nonce": challenge,
                        "latitude": 17.448291,
                        "longitude": 78.391482,
                        "location_accuracy_meters": 10,
                        "median_rssi": -60
                    }
                    tasks.append(ac.post("/api/v1/attendance/proximity-submit", json=payload, headers=headers))
                responses = await asyncio.gather(*tasks)
                return responses

        retry_responses = asyncio.run(run_retry_storm())

        for r in retry_responses:
            assert r.status_code == 200
            data = r.json()
            assert data["status"] == "SUCCESS"

        db = TestingSessionLocal()
        records = db.query(AttendanceRecord).filter(AttendanceRecord.session_id == session_id).all()
        assert len(records) == 50, f"Expected exactly 50 records, got {len(records)}"
        db.close()

    def test_04_one_hundred_fifty_burst_concurrency(self):
        """Stress test with 150 concurrent requests (100 BLE proximity + 50 rotating code submissions)."""
        session_data = self._start_fresh_session("Period 4")
        session_id = session_data["session_id"]
        challenge = session_data["challenge_nonce"]
        code = session_data["manual_fallback_code"]

        ble_students = self.students_pool[0:100]
        code_students = self.students_pool[100:150]

        async def run_150_burst():
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                tasks = []
                for s in ble_students:
                    headers = {
                        "Authorization": f"Bearer {s['token']}",
                        "x-device-public-id": s["device_id"]
                    }
                    payload = {
                        "session_id": session_id,
                        "challenge_nonce": challenge,
                        "latitude": 17.448291,
                        "longitude": 78.391482,
                        "location_accuracy_meters": 15,
                        "median_rssi": -69
                    }
                    tasks.append(ac.post("/api/v1/attendance/proximity-submit", json=payload, headers=headers))

                for s in code_students:
                    headers = {
                        "Authorization": f"Bearer {s['token']}",
                        "x-device-public-id": s["device_id"]
                    }
                    payload = {
                        "session_id": session_id,
                        "code": code,
                        "latitude": 17.448291,
                        "longitude": 78.391482,
                        "location_accuracy_meters": 20
                    }
                    tasks.append(ac.post("/api/v1/attendance/manual-code-submit", json=payload, headers=headers))

                t0 = time.time()
                responses = await asyncio.gather(*tasks)
                duration = time.time() - t0
                return responses, duration

        responses, total_duration = asyncio.run(run_150_burst())

        status_codes = [r.status_code for r in responses]
        assert all(c == 200 for c in status_codes), f"Failed codes: {[c for c in status_codes if c != 200]}"
        assert len(responses) == 150
        print(f"\n[BENCHMARK] 150 Burst Mixed Submissions: {total_duration:.2f}s (Avg: {total_duration/150*1000:.1f}ms per req)")
        assert total_duration < 30.0

        db = TestingSessionLocal()
        records = db.query(AttendanceRecord).filter(AttendanceRecord.session_id == session_id).all()
        assert len(records) == 150
        db.close()
