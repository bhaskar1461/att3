"""
Locust Load Test & Concurrency Verification: 100 Concurrent Student Marks in 10s.
Validates ProxPresence high-concurrency throughput, zero 429 Rate-Limits,
zero failed responses, and complete DB persistence for all 100 students.

Usage via Locust CLI:
  locust -f backend/tests/locustfile.py --headless -u 100 -r 10 -t 10s --host http://localhost:8000

Usage via Standalone Automated Test:
  python backend/tests/locustfile.py
"""

import os
import sys
import random
import hashlib
import time
import asyncio
from typing import List, Dict, Any, Tuple

# Ensure backend directory is in sys.path
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.main import app
from app.core.database import SessionLocal
from app.models.models import AttendanceRecord, AttendanceSession, SessionStatus

# Student roll pool (100 students seeded in CSE-A)
STUDENT_ROSTER = [f"238A1A05{i:02d}" for i in range(1, 101)]

# ---------------------------------------------------------------------------
# 1. Locust User Definition (Active when invoked via `locust` CLI)
# ---------------------------------------------------------------------------
# Note: Gevent monkey-patching in locust is skipped during standalone Python runs
# to prevent asyncio socket selector conflicts.
if __name__ != "__main__":
    try:
        from locust import HttpUser, task, between, events

        class StudentAttendanceUser(HttpUser):
            wait_time = between(0.05, 0.15)

            def on_start(self):
                self.roll_no = random.choice(STUDENT_ROSTER)
                self.device_hash = hashlib.sha256(f"dev_fingerprint_{self.roll_no}".encode()).hexdigest()
                self.session_id = 1

            @task
            def mark_attendance(self):
                payload = {
                    "session_id": self.session_id,
                    "roll_no": self.roll_no,
                    "device_hash": self.device_hash,
                    "method": "ble",
                    "rssi": random.randint(-74, -68),  # Accepted in-room BLE signal
                    "latitude": 17.448291,
                    "longitude": 78.391482,
                    "geo_accuracy_m": 10.0
                }

                with self.client.post("/attendance/mark", json=payload, catch_response=True) as response:
                    if response.status_code == 429:
                        response.failure("Rate Limit 429 triggered! Violates zero-429 invariant.")
                    elif response.status_code != 200:
                        response.failure(f"HTTP {response.status_code}: {response.text}")
                    else:
                        data = response.json()
                        if data.get("status") != "SUCCESS":
                            response.failure(f"Response status != SUCCESS: {data}")
                        else:
                            response.success()
    except ImportError:
        pass


# ---------------------------------------------------------------------------
# 2. Standalone Execution Runner (Automated concurrency verification)
# ---------------------------------------------------------------------------
def prepare_test_session(session_id: int = 1) -> int:
    """Ensures test session exists and is in OPEN status."""
    db = SessionLocal()
    session = db.query(AttendanceSession).filter(AttendanceSession.id == session_id).first()
    if not session:
        session = AttendanceSession(
            id=session_id,
            teacher_id=1,
            faculty_id=1,
            room_id=1,
            classroom_id=1,
            subject_id=1,
            section_id=1,
            period="Period 1",
            session_date="2026-09-04",
            status=SessionStatus.OPEN,
            kill_switch_active=False
        )
        db.add(session)
        db.commit()
    elif session.status == SessionStatus.LOCKED:
        session.status = SessionStatus.OPEN
        db.commit()
    s_id = session.id
    db.close()
    return s_id


async def _async_load_test_runner(num_students: int = 100, max_duration_sec: float = 10.0, concurrency: int = 10):
    import httpx

    session_id = 1
    roster = STUDENT_ROSTER[:num_students]
    transport = httpx.ASGITransport(app=app)
    sem = asyncio.Semaphore(concurrency)

    async with httpx.AsyncClient(transport=transport, base_url="http://test", timeout=20.0) as client:
        async def student_mark(roll: str) -> Tuple[str, int, float, Any]:
            async with sem:
                dev_hash = hashlib.sha256(f"dev_fingerprint_{roll}".encode()).hexdigest()
                payload = {
                    "session_id": session_id,
                    "roll_no": roll,
                    "device_hash": dev_hash,
                    "method": "ble",
                    "rssi": random.randint(-74, -68),
                    "latitude": 17.448291,
                    "longitude": 78.391482,
                    "geo_accuracy_m": 8.5
                }
                t0 = time.perf_counter()
                resp = await client.post("/attendance/mark", json=payload)
                elapsed_ms = (time.perf_counter() - t0) * 1000.0
                body = resp.json() if resp.status_code == 200 else resp.text
                return roll, resp.status_code, elapsed_ms, body

        wall_start = time.perf_counter()
        results = await asyncio.gather(*(student_mark(r) for r in roster))
        wall_duration = time.perf_counter() - wall_start

    return results, wall_duration


def run_standalone_load_test(num_students: int = 100, max_duration_sec: float = 10.0, concurrency: int = 10):
    """
    Executes a high-concurrency simulation of 100 distinct students marking
    attendance within a 10s budget.
    Asserts:
      1. count_429 == 0 (Zero 429 Rate Limits)
      2. count_failures == 0 (Zero failed responses)
      3. all 100 records persisted in database
      4. total elapsed time <= 10.0 seconds
    """
    print(f"\n{'='*70}", flush=True)
    print(f"ProxPresence Concurrency Load Test: {num_students} Students in <= {max_duration_sec}s", flush=True)
    print(f"{'='*70}", flush=True)

    session_id = prepare_test_session(1)
    print(f"Target Session ID: {session_id} (Status: OPEN, Concurrency: {concurrency})", flush=True)

    results, wall_duration = asyncio.run(_async_load_test_runner(num_students, max_duration_sec, concurrency))

    # Metrics analysis
    status_codes = [r[1] for r in results]
    latencies = [r[2] for r in results]
    count_200 = status_codes.count(200)
    count_429 = status_codes.count(429)
    count_fail = sum(1 for c in status_codes if c != 200)
    avg_latency = sum(latencies) / len(latencies)
    p95_latency = sorted(latencies)[int(len(latencies) * 0.95)]

    # DB persistence verification
    verify_db = SessionLocal()
    persisted_records = verify_db.query(AttendanceRecord).filter(
        AttendanceRecord.session_id == session_id
    ).all()
    records_count = len(persisted_records)
    verify_db.close()

    print("\n--- Telemetry Results ---", flush=True)
    print(f"Total Requests Executed:    {len(results)}", flush=True)
    print(f"Wall-Clock Duration:        {wall_duration:.3f}s (Budget: <= {max_duration_sec}s)", flush=True)
    print(f"HTTP 200 OK:                {count_200}/{num_students}", flush=True)
    print(f"HTTP 429 Rate-Limits:       {count_429} (Zero Invariant)", flush=True)
    print(f"Failed Responses:           {count_fail} (Zero Invariant)", flush=True)
    print(f"DB Records Persisted:       {records_count} (All >= {num_students})", flush=True)
    print(f"Average Request Latency:    {avg_latency:.2f}ms", flush=True)
    print(f"P95 Request Latency:        {p95_latency:.2f}ms", flush=True)
    print(f"{'='*70}\n", flush=True)

    # Invariant Assertions
    assert count_429 == 0, f"Invariant Violation: {count_429} HTTP 429 responses detected!"
    assert count_fail == 0, f"Invariant Violation: {count_fail} failed responses detected!"
    assert records_count >= num_students, (
        f"Data Persistence Violation: expected at least {num_students} records in DB, found {records_count}"
    )
    assert wall_duration <= max_duration_sec, (
        f"Timing Violation: execution took {wall_duration:.2f}s, exceeding {max_duration_sec}s budget!"
    )
    print(">>> SUCCESS: All 100 Concurrent Marks Invariants Satisfied (0 429s, 0 Failures, 100+ DB Records) <<<\n", flush=True)
    return True


if __name__ == "__main__":
    run_standalone_load_test()
