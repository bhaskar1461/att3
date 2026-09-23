"""
Concurrency Load Test Suite — 150/300 Simulated Students

Tests the critical invariant: under concurrent mark-attendance writes for the same session,
exactly N distinct rows are inserted, no more, no fewer, with no duplicates, no lost marks,
no NaN in stats, and clean ALREADY_MARKED handling for rescans.

Test matrix:
  A. 150-student all-at-once burst (thread pool)
  B. 150-student staggered arrival over ~2-5s (simulating real passing period)
  C. Rescan idempotency: 30 students rescanning (must get ALREADY_MARKED, never duplicate rows)
  D. Stats correctness: attendance-summary and compliance endpoints report exact counts, no NaN
  E. 2x safety margin: 300-student burst with latency percentile reporting (p50, p95)
  F. Race condition: two near-simultaneous requests for the SAME student — one wins, one gets ALREADY_MARKED
  G. Mixed burst: 150 unique + 30 rescans in same burst
"""

import os
import sys
import time
import tempfile
import unittest
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.exc import IntegrityError

from app.main import app
from app.core.database import get_db, Base
from app.models.models import (
    User, UserRole, Student, Teacher, Department, Subject, Section, AcademicYear,
    AttendanceSession, AttendanceRecord, AttendanceStatus, SessionStatus
)
from app.services.attendance_engine import invalidate_attendance_cache
from app.api.student import (
    _STUDENT_SUMMARY_CACHE,
    _STUDENT_SUMMARY_CACHE_LOCK
)
from app.core.security import create_access_token, get_password_hash


# ─── Helpers ──────────────────────────────────────────────────────────────────

def percentile(data: list, pct: float) -> float:
    if not data:
        return 0.0
    s = sorted(data)
    k = (len(s) - 1) * (pct / 100.0)
    f = int(k)
    c = min(f + 1, len(s) - 1)
    return s[f] + (k - f) * (s[c] - s[f])


class StudentData:
    """Thread-safe plain data — no ORM session binding."""
    __slots__ = ('id', 'roll_number', 'name')
    def __init__(self, sid, roll, name):
        self.id = sid
        self.roll_number = roll
        self.name = name


class TestLoadConcurrency150(unittest.TestCase):
    """
    Concurrency tests using file-based SQLite + WAL mode for realistic
    multi-connection concurrent write testing.
    """

    @classmethod
    def setUpClass(cls):
        # File-based SQLite with WAL mode — each thread gets its own connection
        cls._db_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        cls._db_path = cls._db_file.name
        cls._db_file.close()

        cls.engine = create_engine(
            f"sqlite:///{cls._db_path}",
            connect_args={"check_same_thread": False},
            pool_size=20,
            max_overflow=30,
        )

        # Enable WAL mode for concurrent reads + serialized writes
        @event.listens_for(cls.engine, "connect")
        def set_sqlite_pragma(dbapi_conn, connection_record):
            cursor = dbapi_conn.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA busy_timeout=10000")  # 10s wait on lock
            cursor.execute("PRAGMA synchronous=NORMAL")
            cursor.close()

        Base.metadata.create_all(bind=cls.engine)
        cls.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=cls.engine)

        db = cls.SessionLocal()
        try:
            dept = Department(code="CSE", name="Computer Science and Engineering")
            ay = AcademicYear(name="3rd Year")
            db.add_all([dept, ay])
            db.flush()

            sec = Section(name="Java FSD", department_id=dept.id, academic_year_id=ay.id)
            db.add(sec)
            db.flush()

            subj = Subject(
                code="CET301",
                name="Career Enhancement Training (CET)",
                department_id=dept.id,
                academic_year_id=ay.id
            )
            db.add(subj)
            db.flush()

            teacher_user = User(
                username="faculty_load_test",
                password_hash=get_password_hash("pass123"),
                role=UserRole.TEACHER
            )
            db.add(teacher_user)
            db.flush()

            teacher = Teacher(
                user_id=teacher_user.id,
                teacher_code="T_LOAD_01",
                name="Dr. Load Tester",
                department_id=dept.id
            )
            db.add(teacher)
            db.flush()

            cls.students = []
            cls.student_headers = {}
            for i in range(300):
                roll = f"23311A{i:04d}"
                user = User(
                    username=roll,
                    password_hash=get_password_hash("pass123"),
                    role=UserRole.STUDENT
                )
                db.add(user)
                db.flush()

                student = Student(
                    user_id=user.id,
                    roll_number=roll,
                    name=f"Student {i}",
                    department_id=dept.id,
                    academic_year_id=ay.id,
                    section_id=sec.id
                )
                db.add(student)
                db.flush()

                jwt = create_access_token(data={
                    "sub": roll,
                    "role": UserRole.STUDENT.value,
                    "student_id": student.id,
                    "roll_number": roll
                })
                cls.student_headers[roll] = {"Authorization": f"Bearer {jwt}"}
                cls.students.append(StudentData(student.id, roll, student.name))

            db.commit()

            cls.dept_id = dept.id
            cls.sec_id = sec.id
            cls.subj_id = subj.id
            cls.teacher_id = teacher.id
        finally:
            db.close()

    @classmethod
    def tearDownClass(cls):
        cls.engine.dispose()
        try:
            os.unlink(cls._db_path)
            # Clean up WAL/SHM files
            for ext in ("-wal", "-shm"):
                p = cls._db_path + ext
                if os.path.exists(p):
                    os.unlink(p)
        except OSError:
            pass

    def setUp(self):
        self.db = self.SessionLocal()

        def override_get_db():
            db = self.SessionLocal()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_get_db
        self.client = TestClient(app)

        with _STUDENT_SUMMARY_CACHE_LOCK:
            _STUDENT_SUMMARY_CACHE.clear()
        invalidate_attendance_cache()

    def tearDown(self):
        self.db.execute(text("DELETE FROM qr_attendance_records"))
        self.db.execute(text("DELETE FROM qr_attendance_sessions"))
        self.db.commit()
        self.db.close()
        app.dependency_overrides.clear()

        with _STUDENT_SUMMARY_CACHE_LOCK:
            _STUDENT_SUMMARY_CACHE.clear()
        invalidate_attendance_cache()

    def _create_session(self) -> int:
        today_str = datetime.now().strftime("%Y-%m-%d")
        session = AttendanceSession(
            teacher_id=self.teacher_id,
            subject_id=self.subj_id,
            section_id=self.sec_id,
            period="P1-P4",
            session_date=today_str,
            status=SessionStatus.OPEN
        )
        self.db.add(session)
        self.db.commit()
        return session.id

    def _mark_attendance_direct(self, session_id: int, sd: StudentData) -> dict:
        """
        Simulate the production concurrency path:
        check existing → insert → commit, with IntegrityError → ALREADY_MARKED recovery.

        Each thread gets its OWN session from the pool (no shared state).
        """
        db = self.SessionLocal()
        t_start = time.perf_counter()
        try:
            # Application-level duplicate check (same as production)
            existing = db.query(AttendanceRecord).filter(
                AttendanceRecord.session_id == session_id,
                AttendanceRecord.student_id == sd.id
            ).first()

            if existing:
                elapsed_ms = (time.perf_counter() - t_start) * 1000
                return {"status": "ALREADY_MARKED", "attendance_id": existing.id, "elapsed_ms": elapsed_ms}

            # Insert new record
            new_record = AttendanceRecord(
                session_id=session_id,
                student_id=sd.id,
                roll_number=sd.roll_number,
                session_date=datetime.now().strftime("%Y-%m-%d"),
                period_count=4,
                status=AttendanceStatus.PRESENT,
                scan_mode="QR_CAMERA",
                scanned_at=datetime.utcnow()
            )
            db.add(new_record)

            try:
                db.flush()
                db.commit()
                rec_id = new_record.id
                elapsed_ms = (time.perf_counter() - t_start) * 1000
                return {"status": "SUCCESS", "attendance_id": rec_id, "elapsed_ms": elapsed_ms}
            except IntegrityError:
                db.rollback()
                winner = db.query(AttendanceRecord).filter(
                    AttendanceRecord.session_id == session_id,
                    AttendanceRecord.student_id == sd.id
                ).first()
                elapsed_ms = (time.perf_counter() - t_start) * 1000
                return {
                    "status": "ALREADY_MARKED",
                    "attendance_id": winner.id if winner else None,
                    "elapsed_ms": elapsed_ms
                }
        except Exception as ex:
            try:
                db.rollback()
            except Exception:
                pass
            elapsed_ms = (time.perf_counter() - t_start) * 1000
            return {"status": "ERROR", "error": str(ex), "elapsed_ms": elapsed_ms}
        finally:
            db.close()

    # ═══════════════════════════════════════════════════════════════════════════
    # TEST A: 150-student all-at-once burst
    # ═══════════════════════════════════════════════════════════════════════════
    def test_A_150_concurrent_burst(self):
        """150 distinct students fire mark-attendance simultaneously."""
        session_id = self._create_session()
        students_150 = self.students[:150]
        results = []
        latencies = []

        with ThreadPoolExecutor(max_workers=50) as executor:
            futures = {
                executor.submit(self._mark_attendance_direct, session_id, s): s
                for s in students_150
            }
            for future in as_completed(futures):
                result = future.result()
                results.append(result)
                latencies.append(result["elapsed_ms"])

        errors = [r for r in results if r["status"] == "ERROR"]
        self.assertEqual(len(errors), 0, f"Unexpected errors: {errors[:3]}")

        success_count = len([r for r in results if r["status"] == "SUCCESS"])
        already_count = len([r for r in results if r["status"] == "ALREADY_MARKED"])
        self.assertEqual(success_count + already_count, 150)

        # Exactly 150 distinct rows in DB
        db = self.SessionLocal()
        try:
            row_count = db.query(AttendanceRecord).filter(
                AttendanceRecord.session_id == session_id
            ).count()
            self.assertEqual(row_count, 150, f"Expected 150 DB rows, got {row_count}")

            for s in students_150:
                count = db.query(AttendanceRecord).filter(
                    AttendanceRecord.session_id == session_id,
                    AttendanceRecord.student_id == s.id
                ).count()
                self.assertEqual(count, 1, f"Student {s.roll_number} has {count} rows, expected 1")
        finally:
            db.close()

        p50, p95 = percentile(latencies, 50), percentile(latencies, 95)
        print(f"\n[TEST A] 150-student burst:")
        print(f"  Results: {success_count} SUCCESS, {already_count} ALREADY_MARKED")
        print(f"  DB rows: {row_count}")
        print(f"  Latency: p50={p50:.1f}ms, p95={p95:.1f}ms, max={max(latencies):.1f}ms")
        self.assertLess(p95, 2000.0)

    # ═══════════════════════════════════════════════════════════════════════════
    # TEST B: 150-student staggered arrival
    # ═══════════════════════════════════════════════════════════════════════════
    def test_B_150_staggered_arrival(self):
        """150 students arrive in 10 batches of 15."""
        import random
        session_id = self._create_session()
        students_150 = self.students[:150]
        results = []
        latencies = []
        batches = [students_150[i:i + 15] for i in range(0, 150, 15)]

        for batch in batches:
            with ThreadPoolExecutor(max_workers=15) as executor:
                futures = [executor.submit(self._mark_attendance_direct, session_id, s) for s in batch]
                for f in as_completed(futures):
                    r = f.result()
                    results.append(r)
                    latencies.append(r["elapsed_ms"])
            time.sleep(random.uniform(0.01, 0.05))

        errors = [r for r in results if r["status"] == "ERROR"]
        self.assertEqual(len(errors), 0, f"Unexpected errors: {errors[:3]}")

        db = self.SessionLocal()
        try:
            row_count = db.query(AttendanceRecord).filter(
                AttendanceRecord.session_id == session_id
            ).count()
            self.assertEqual(row_count, 150)
        finally:
            db.close()

        p50, p95 = percentile(latencies, 50), percentile(latencies, 95)
        print(f"\n[TEST B] 150-student staggered:")
        print(f"  DB rows: {row_count}")
        print(f"  Latency: p50={p50:.1f}ms, p95={p95:.1f}ms")

    # ═══════════════════════════════════════════════════════════════════════════
    # TEST C: Rescan idempotency
    # ═══════════════════════════════════════════════════════════════════════════
    def test_C_rescan_idempotency(self):
        """30 students rescan after initial mark — must get ALREADY_MARKED, no duplicates."""
        session_id = self._create_session()
        students_30 = self.students[:30]

        # First pass: mark all 30 sequentially
        for s in students_30:
            r = self._mark_attendance_direct(session_id, s)
            self.assertIn(r["status"], ["SUCCESS", "ALREADY_MARKED"])

        db = self.SessionLocal()
        try:
            self.assertEqual(
                db.query(AttendanceRecord).filter(AttendanceRecord.session_id == session_id).count(),
                30
            )
        finally:
            db.close()

        # Rescan: all 30 concurrently
        rescan_results = []
        with ThreadPoolExecutor(max_workers=30) as executor:
            futures = [executor.submit(self._mark_attendance_direct, session_id, s) for s in students_30]
            for f in as_completed(futures):
                rescan_results.append(f.result())

        for r in rescan_results:
            self.assertEqual(r["status"], "ALREADY_MARKED", f"Rescan got {r['status']}")

        db = self.SessionLocal()
        try:
            final_count = db.query(AttendanceRecord).filter(
                AttendanceRecord.session_id == session_id
            ).count()
            self.assertEqual(final_count, 30, f"Rescan created duplicates: {final_count}")
        finally:
            db.close()

        print(f"\n[TEST C] Rescan idempotency: 30 rescans -> all ALREADY_MARKED, DB rows={final_count}")

    # ═══════════════════════════════════════════════════════════════════════════
    # TEST D: Stats accuracy — no NaN after 150-student burst
    # ═══════════════════════════════════════════════════════════════════════════
    def test_D_stats_accuracy_150(self):
        """Summary and compliance endpoints report exact counts, no NaN."""
        session_id = self._create_session()
        students_150 = self.students[:150]

        with ThreadPoolExecutor(max_workers=50) as executor:
            futures = [executor.submit(self._mark_attendance_direct, session_id, s) for s in students_150]
            for f in as_completed(futures):
                r = f.result()
                self.assertIn(r["status"], ["SUCCESS", "ALREADY_MARKED"], f"Got: {r}")

        with _STUDENT_SUMMARY_CACHE_LOCK:
            _STUDENT_SUMMARY_CACHE.clear()
        invalidate_attendance_cache()

        first = students_150[0]
        headers = self.student_headers[first.roll_number]

        res = self.client.get("/api/v1/student/attendance-summary", headers=headers)
        self.assertEqual(res.status_code, 200)
        data = res.json()

        self.assertGreater(data["total_present"], 0)
        self.assertGreater(data["total_conducted"], 0)
        self.assertGreaterEqual(data["total_conducted"], data["total_present"])

        for field in ["overall_percentage", "total_absent"]:
            val = data[field]
            self.assertIsNotNone(val)
            self.assertFalse(str(val).lower() in ["nan", "none", "null"],
                             f"{field} must not be NaN, got {val}")

        res_comp = self.client.get(f"/api/v1/compliance/student/{first.roll_number}", headers=headers)
        self.assertEqual(res_comp.status_code, 200)
        agg = res_comp.json().get("aggregate", {})
        self.assertGreater(agg.get("total_present_sessions", 0), 0)

        pct = agg.get("aggregate_percentage")
        if pct is not None:
            self.assertFalse(str(pct).lower() in ["nan", "none", "null"])

        print(f"\n[TEST D] Stats accuracy:")
        print(f"  Summary: present={data['total_present']}, conducted={data['total_conducted']}, "
              f"absent={data['total_absent']}, pct={data['overall_percentage']}%")
        print(f"  Compliance: present_sessions={agg.get('total_present_sessions')}, "
              f"pct={pct}")

    # ═══════════════════════════════════════════════════════════════════════════
    # TEST E: 2x safety margin — 300 students
    # ═══════════════════════════════════════════════════════════════════════════
    def test_E_300_student_safety_margin(self):
        """300-student burst (2x). Report latency percentiles."""
        session_id = self._create_session()
        all_300 = self.students[:300]
        results = []
        latencies = []

        t_start = time.perf_counter()
        with ThreadPoolExecutor(max_workers=100) as executor:
            futures = {executor.submit(self._mark_attendance_direct, session_id, s): s for s in all_300}
            for future in as_completed(futures):
                r = future.result()
                results.append(r)
                latencies.append(r["elapsed_ms"])
        t_total = (time.perf_counter() - t_start) * 1000

        errors = [r for r in results if r["status"] == "ERROR"]
        success = len([r for r in results if r["status"] == "SUCCESS"])
        already = len([r for r in results if r["status"] == "ALREADY_MARKED"])

        self.assertEqual(len(errors), 0, f"Errors at 300: {errors[:3]}")

        db = self.SessionLocal()
        try:
            row_count = db.query(AttendanceRecord).filter(
                AttendanceRecord.session_id == session_id
            ).count()
            self.assertEqual(row_count, 300)
        finally:
            db.close()

        p50, p95, p99 = percentile(latencies, 50), percentile(latencies, 95), percentile(latencies, 99)
        print(f"\n[TEST E] 300-student 2x safety margin:")
        print(f"  Results: {success} SUCCESS, {already} ALREADY_MARKED")
        print(f"  DB rows: {row_count}")
        print(f"  Wall time: {t_total:.0f}ms")
        print(f"  Latency: p50={p50:.1f}ms, p95={p95:.1f}ms, p99={p99:.1f}ms, max={max(latencies):.1f}ms")
        self.assertLess(p95, 2000.0)

    # ═══════════════════════════════════════════════════════════════════════════
    # TEST F: Race condition — same student, two simultaneous requests
    # ═══════════════════════════════════════════════════════════════════════════
    def test_F_same_student_race_condition(self):
        """Two threads for the SAME student. One SUCCESS, one ALREADY_MARKED. Never duplicates."""
        session_id = self._create_session()
        target = self.students[0]
        results = []
        barrier = threading.Barrier(2)

        def race():
            barrier.wait()
            return self._mark_attendance_direct(session_id, target)

        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(race) for _ in range(2)]
            for f in as_completed(futures):
                results.append(f.result())

        statuses = sorted([r["status"] for r in results])
        errors = [r for r in results if r["status"] == "ERROR"]

        self.assertEqual(len(errors), 0, f"Race errors: {errors}")
        self.assertIn("SUCCESS", statuses)
        self.assertIn("ALREADY_MARKED", statuses)

        db = self.SessionLocal()
        try:
            count = db.query(AttendanceRecord).filter(
                AttendanceRecord.session_id == session_id,
                AttendanceRecord.student_id == target.id
            ).count()
            self.assertEqual(count, 1)
        finally:
            db.close()

        print(f"\n[TEST F] Same-student race: {statuses} -> 1 DB row (correct)")

    # ═══════════════════════════════════════════════════════════════════════════
    # TEST G: Mixed burst — 150 unique + 30 rescans = 180 requests
    # ═══════════════════════════════════════════════════════════════════════════
    def test_G_mixed_burst_150_plus_30_rescans(self):
        """150 unique + 30 rescans. Exactly 150 DB rows."""
        session_id = self._create_session()
        students_150 = self.students[:150]
        rescans = students_150[:30]
        all_tasks = list(students_150) + list(rescans)

        results = []
        latencies = []

        with ThreadPoolExecutor(max_workers=60) as executor:
            futures = [executor.submit(self._mark_attendance_direct, session_id, s) for s in all_tasks]
            for f in as_completed(futures):
                r = f.result()
                results.append(r)
                latencies.append(r["elapsed_ms"])

        errors = [r for r in results if r["status"] == "ERROR"]
        self.assertEqual(len(errors), 0, f"Errors: {errors[:3]}")
        self.assertEqual(len(results), 180)

        db = self.SessionLocal()
        try:
            row_count = db.query(AttendanceRecord).filter(
                AttendanceRecord.session_id == session_id
            ).count()
            self.assertEqual(row_count, 150)
        finally:
            db.close()

        already = len([r for r in results if r["status"] == "ALREADY_MARKED"])
        success = len([r for r in results if r["status"] == "SUCCESS"])
        p50, p95 = percentile(latencies, 50), percentile(latencies, 95)

        print(f"\n[TEST G] Mixed burst (180 requests):")
        print(f"  Results: {success} SUCCESS, {already} ALREADY_MARKED")
        print(f"  DB rows: {row_count} (expected 150)")
        print(f"  Latency: p50={p50:.1f}ms, p95={p95:.1f}ms")
        self.assertGreaterEqual(already, 30)


if __name__ == "__main__":
    unittest.main(verbosity=2)
