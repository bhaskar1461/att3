"""
SNIST ERP — Week 9 Part A: Concurrent Faculty Session Creation Smoke Test
Validates that 7 faculty members (one per department: CSE, ECE, IT, MECH, CIVIL, EEE, AIML)
can concurrently create attendance sessions simultaneously without race conditions,
token collisions, or database deadlocks.
"""

import sys
import os
import time
import concurrent.futures
from typing import Dict, Any

# Ensure backend path is on sys.path
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend"))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from starlette.testclient import TestClient

from app.main import app
from app.core.database import Base, get_db
from app.core.config import settings
from app.models.models import User, UserRole, Teacher, TeacherAssignment, Department, AcademicYear, Section, Subject, AttendanceSession
from app.core.security import get_password_hash, create_access_token
from app.services.qr_token import ShortTokenService

def run_concurrent_faculty_session_test():
    print("=" * 70)
    print("SNIST ERP — Week 9: Concurrent Faculty Session Creation Smoke Test")
    print("=" * 70)

    # 1. Setup in-memory test database with WAL
    test_db_url = "sqlite:///./test_concurrent_faculty.db"
    if os.path.exists("./test_concurrent_faculty.db"):
        try:
            os.remove("./test_concurrent_faculty.db")
        except Exception:
            pass

    engine = create_engine(
        test_db_url,
        connect_args={"check_same_thread": False, "timeout": 30.0},
        pool_size=20,
        max_overflow=20
    )

    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.close()

    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db

    # 2. Seed 7 departments, 7 sections, 7 teachers, 7 subjects, 7 assignments
    dept_codes = ["CSE", "ECE", "IT", "MECH", "CIVIL", "EEE", "AIML"]
    db = TestingSessionLocal()
    
    academic_year = AcademicYear(name="4th Year")
    db.add(academic_year)
    db.commit()
    db.refresh(academic_year)

    teacher_tokens = {}

    for code in dept_codes:
        dept = Department(name=f"Department of {code}", code=code)
        db.add(dept)
        db.commit()
        db.refresh(dept)

        sec = Section(name=f"{code}-A", department_id=dept.id, academic_year_id=academic_year.id)
        db.add(sec)
        db.commit()
        db.refresh(sec)

        sub = Subject(name=f"{code} Core Systems", code=f"{code}401", department_id=dept.id, academic_year_id=academic_year.id)
        db.add(sub)
        db.commit()
        db.refresh(sub)

        user = User(
            username=f"teacher_{code.lower()}",
            email=f"prof_{code.lower()}@snist.edu.in",
            password_hash=get_password_hash("FacultyPass123!"),
            role=UserRole.TEACHER,
            is_active=True
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        teacher = Teacher(
            user_id=user.id,
            teacher_code=f"FAC_{code}_01",
            name=f"Prof. {code} Chair",
            department_id=dept.id
        )
        db.add(teacher)
        db.commit()
        db.refresh(teacher)

        assignment = TeacherAssignment(
            teacher_id=teacher.id,
            subject_id=sub.id,
            section_id=sec.id
        )
        db.add(assignment)
        db.commit()

        token = create_access_token(data={"sub": user.username, "role": user.role.value})
        teacher_tokens[code] = {
            "token": token,
            "section_id": sec.id,
            "subject_id": sub.id,
            "teacher_id": teacher.id,
            "teacher_code": teacher.teacher_code
        }

    db.close()
    print(f"[Setup] Seeded {len(dept_codes)} departments, faculty accounts, sections, and subjects.")

    # 3. Concurrently create sessions across 7 threads
    client = TestClient(app)
    results = {}
    created_tokens = set()

    def create_session_worker(dept_code: str):
        info = teacher_tokens[dept_code]
        start_t = time.perf_counter()
        headers = {"Authorization": f"Bearer {info['token']}"}
        payload = {
            "subject_id": info["subject_id"],
            "section_id": info["section_id"],
            "period": "1",
            "period_count": 1,
            "display_type": "projector"
        }
        res = client.post(f"{settings.API_V1_STR}/teacher/sessions/start", json=payload, headers=headers)
        elapsed_ms = (time.perf_counter() - start_t) * 1000

        # Also probe short token generation for this session
        sess_id = res.json().get("session_id") if res.status_code == 200 else None
        token_info = None
        if sess_id:
            db_thread = TestingSessionLocal()
            token_info = ShortTokenService.issue_or_get_short_code(db_thread, sess_id)
            db_thread.close()

        return {
            "dept": dept_code,
            "status_code": res.status_code,
            "response": res.json() if res.status_code == 200 else res.text,
            "elapsed_ms": elapsed_ms,
            "session_id": sess_id,
            "token_info": token_info
        }

    print(f"\n[Execution] Firing 7 simultaneous session creation requests across {len(dept_codes)} threads...")
    t0 = time.perf_counter()
    with concurrent.futures.ThreadPoolExecutor(max_workers=7) as executor:
        futures = {executor.submit(create_session_worker, code): code for code in dept_codes}
        for future in concurrent.futures.as_completed(futures):
            res = future.result()
            results[res["dept"]] = res
    total_batch_ms = (time.perf_counter() - t0) * 1000

    print(f"[Execution] All 7 sessions processed in {total_batch_ms:.2f} ms total.\n")

    # 4. Verify results
    all_success = True
    session_ids = set()

    print(f"{'Dept':<8} | {'Status':<12} | {'Session ID':<12} | {'Short Code':<14} | {'Latency':<10}")
    print("-" * 65)
    for code in dept_codes:
        r = results[code]
        status_ok = r["status_code"] == 200 and r["session_id"] is not None
        if not status_ok:
            all_success = False
        sess_id = r["session_id"]
        if sess_id in session_ids:
            all_success = False
            print(f"ERROR: Collision detected on Session ID {sess_id}!")
        session_ids.add(sess_id)

        token = r["token_info"]["short_code"] if r["token_info"] else "NONE"
        created_tokens.add(token)

        status_label = "200 OK" if status_ok else f"ERR {r['status_code']}"
        print(f"{code:<8} | {status_label:<12} | {str(sess_id):<12} | {token:<14} | {r['elapsed_ms']:.2f} ms")

    print("-" * 65)
    print(f"Unique Sessions Created: {len(session_ids)} / 7")
    print(f"Unique Tokens Issued:   {len(created_tokens)} / 7")
    print(f"Avg Creation Latency:   {sum(r['elapsed_ms'] for r in results.values()) / 7:.2f} ms")
    print(f"Total Concurrency Wall: {total_batch_ms:.2f} ms")

    # Cleanup
    app.dependency_overrides.clear()
    if os.path.exists("./test_concurrent_faculty.db"):
        try:
            os.remove("./test_concurrent_faculty.db")
            if os.path.exists("./test_concurrent_faculty.db-wal"):
                os.remove("./test_concurrent_faculty.db-wal")
            if os.path.exists("./test_concurrent_faculty.db-shm"):
                os.remove("./test_concurrent_faculty.db-shm")
        except Exception:
            pass

    assert all_success, "One or more concurrent session creations failed!"
    assert len(session_ids) == 7, "Session ID collision or missing sessions!"
    assert len(created_tokens) == 7, "Token collision across concurrent sessions!"
    print("\n[PASS] CERTIFICATION PASSED: 7/7 Concurrent Faculty Sessions Created with Zero Collisions.")
    return True

if __name__ == "__main__":
    success = run_concurrent_faculty_session_test()
    sys.exit(0 if success else 1)
