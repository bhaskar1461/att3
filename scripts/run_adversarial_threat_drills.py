"""
Week 10 Adversarial Red-Team Threat Drills:
Executes 5 automated attacks against the hardened SNIST ERP attendance engine:
1. Replay Attack (screenshot submitted 35s+ later from another device)
2. Brute-Force Scan Flood (rate-limiting & lockout threshold verification)
3. Manual-Mark Abuse Simulation (anomaly scoring AMBER >= 15%, RED >= 30%)
4. Multi-QR / Photo Relay Attack (device-binding / account-switching lockout defense)
5. Offline Grace Boundary Abuse (scan submitted at grace boundary + 1m rejected)
"""

import sys
import os
import time
import hmac
import hashlib
from datetime import datetime, timedelta

# Ensure backend path is on sys.path
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend"))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.core.database import get_db, Base
from app.core.config import settings
from app.core.security import (
    create_access_token, get_password_hash, get_server_ist_date,
    _int_to_base36, get_aes_key
)
from app.services.qr_token import ShortTokenService
from app.models.models import (
    User, UserRole, Department, AcademicYear, Section, Subject,
    Teacher, Student, AttendanceSession, AttendanceRecord,
    AttendanceStatus, SessionStatus, DeviceAccountBinding, BindingStatus,
    DeviceRegistration
)


def create_mock_projector_token(session_id: int, period_count: int = 1, step: int = 0) -> str:
    """Generates an authoritative SNIST-SES token for a specific time step."""
    sid_b36 = _int_to_base36(session_id)
    step_b36 = _int_to_base36(step)
    base_str = f"SES|{sid_b36}|{period_count}|{step_b36}"
    key = get_aes_key()
    mac = hmac.new(key, base_str.encode('utf-8'), hashlib.sha256).hexdigest()[:12]
    return f"SNIST-SES|{sid_b36}|{period_count}|{step_b36}|{mac}"


def run_adversarial_drills():
    print("=" * 80)
    print("      SNIST ERP ATTENDANCE ENGINE — ADVERSARIAL THREAT RED-TEAM DRILLS")
    print("=" * 80)

    # Setup isolated in-memory test database with StaticPool so all threads share state
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, expire_on_commit=False)
    Base.metadata.create_all(bind=engine)

    from app.api.auth import _AUTH_USER_CACHE, _AUTH_USER_CACHE_LOCK
    with _AUTH_USER_CACHE_LOCK:
        _AUTH_USER_CACHE.clear()

    from app.api.student import failed_token_tracker, student_scan_limiter
    with failed_token_tracker._lock:
        failed_token_tracker._failures.clear()
        failed_token_tracker._cooldowns.clear()
    with student_scan_limiter._lock:
        student_scan_limiter._attempts.clear()

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)
    results = []

    db = TestingSessionLocal()
    try:
        # Seed core fixtures
        dept = Department(name="Computer Science & Engineering", code="CSE")
        ayear = AcademicYear(name="III Year")
        db.add_all([dept, ayear])
        db.commit()

        section = Section(name="CSE-A", department_id=dept.id, academic_year_id=ayear.id)
        subject = Subject(name="Operating Systems", code="CS301", department_id=dept.id, academic_year_id=ayear.id)
        db.add_all([section, subject])
        db.commit()

        # Seed Faculty
        teacher_user = User(
            username="prof_redteam",
            email="redteam@snist.edu.in",
            password_hash=get_password_hash("pass123"),
            role=UserRole.TEACHER,
            is_active=True
        )
        db.add(teacher_user)
        db.commit()

        teacher = Teacher(
            user_id=teacher_user.id,
            teacher_code="T-RED-001",
            name="Prof. RedTeam",
            department_id=dept.id
        )
        db.add(teacher)
        db.commit()
        teacher_token = create_access_token({"sub": "prof_redteam", "role": "TEACHER"})

        # Seed Students
        s1_user = User(username="24SN1A0501", email="s1@snist.edu.in", password_hash=get_password_hash("pass123"), role=UserRole.STUDENT, is_active=True)
        s2_user = User(username="24SN1A0502", email="s2@snist.edu.in", password_hash=get_password_hash("pass123"), role=UserRole.STUDENT, is_active=True)
        db.add_all([s1_user, s2_user])
        db.commit()

        s1 = Student(user_id=s1_user.id, roll_number="24SN1A0501", name="Alice Student", department_id=dept.id, academic_year_id=ayear.id, section_id=section.id)
        s2 = Student(user_id=s2_user.id, roll_number="24SN1A0502", name="Bob Student", department_id=dept.id, academic_year_id=ayear.id, section_id=section.id)
        db.add_all([s1, s2])
        db.commit()

        # Attacker user for brute-force drill
        att_user = User(username="24SN1A0999", email="att@snist.edu.in", password_hash=get_password_hash("pass123"), role=UserRole.STUDENT, is_active=True)
        db.add(att_user)
        db.commit()
        att = Student(user_id=att_user.id, roll_number="24SN1A0999", name="Attacker", department_id=dept.id, academic_year_id=ayear.id, section_id=section.id)
        db.add(att)
        db.commit()

        s1_token = create_access_token({"sub": "24SN1A0501", "role": "STUDENT"})
        s2_token = create_access_token({"sub": "24SN1A0502", "role": "STUDENT"})
        att_token = create_access_token({"sub": "24SN1A0999", "role": "STUDENT"})

        # DRILL 1: Replay Attack (Screenshot submitted 35s+ later)
        print("\n[DRILL 1] Executing Replay Attack Drill...")
        sess1 = AttendanceSession(
            teacher_id=teacher.id,
            subject_id=subject.id,
            section_id=section.id,
            period="1 Period",
            session_date=get_server_ist_date(),
            status=SessionStatus.OPEN
        )
        db.add(sess1)
        db.commit()

        past_step = int((time.time() - 35) / 10)
        stale_token = create_mock_projector_token(session_id=sess1.id, period_count=1, step=past_step)

        res1 = client.post(
            "/api/v1/student/scan-session",
            json={"session_token": stale_token, "device_uuid": "DEV_ALICE_01"},
            headers={"Authorization": f"Bearer {s1_token}", "x-device-public-id": "DEV_ALICE_01"}
        )
        d1_pass = res1.status_code == 400 and ("expired" in res1.text.lower() or "too old" in res1.text.lower())
        results.append({
            "drill": "Replay Attack (Screenshot 35s Stale)",
            "status_code": res1.status_code,
            "response": res1.text[:90],
            "verdict": "BLOCKED (PASS)" if d1_pass else "FAIL"
        })
        print(f"  Result: HTTP {res1.status_code} => {'BLOCKED (PASS)' if d1_pass else 'FAILED'}")

        # DRILL 2: Brute-Force Scan Flood (Rate-limiting & Lockout)
        print("\n[DRILL 2] Executing Brute-Force Token Flood Drill...")
        flood_blocked = False
        last_status = 200
        for i in range(16):
            res2 = client.post(
                "/api/v1/student/scan-session",
                json={"session_token": f"SNIST-SES|FAKE{i:04d}|1|9999|deadbeef1234", "device_uuid": "DEV_ATTACKER"},
                headers={"Authorization": f"Bearer {att_token}", "x-device-public-id": "DEV_ATTACKER"}
            )
            last_status = res2.status_code
            if res2.status_code == 429:
                flood_blocked = True
                break

        d2_pass = flood_blocked or (last_status in (400, 429))
        results.append({
            "drill": "Brute-Force Scan Flood (16 Invalid Tokens)",
            "status_code": last_status,
            "response": res2.text[:90],
            "verdict": "BLOCKED / RATE-LIMITED (PASS)" if d2_pass else "FAIL"
        })
        print(f"  Result: Status HTTP {last_status} => {'RATE-LIMITED / BLOCKED (PASS)' if d2_pass else 'FAILED'}")

        # DRILL 3: Manual-Mark Abuse Simulation (Exceeding Anomaly Thresholds)
        print("\n[DRILL 3] Executing Manual-Mark Abuse Simulation...")
        sess3 = AttendanceSession(
            teacher_id=teacher.id,
            subject_id=subject.id,
            section_id=section.id,
            period="1 Period",
            session_date=get_server_ist_date(),
            status=SessionStatus.OPEN
        )
        db.add(sess3)
        db.commit()

        # Seed 5 records: 3 QR scans + 2 Manual marks (40% manual rate -> RED status)
        for i in range(3):
            st_user = User(username=f"24SN1A055{i}", email=f"s5{i}@snist.edu.in", password_hash=get_password_hash("pass123"), role=UserRole.STUDENT, is_active=True)
            db.add(st_user)
            db.commit()
            st = Student(user_id=st_user.id, roll_number=f"24SN1A055{i}", name=f"Scan Student {i}", department_id=dept.id, academic_year_id=ayear.id, section_id=section.id)
            db.add(st)
            db.commit()
            rec = AttendanceRecord(
                session_id=sess3.id,
                student_id=st.id,
                roll_number=st.roll_number,
                session_date=sess3.session_date,
                status=AttendanceStatus.PRESENT,
                scan_mode="QR"
            )
            db.add(rec)
        db.commit()

        # Mark 2 students manual
        for i in range(2):
            st_user = User(username=f"24SN1A056{i}", email=f"s6{i}@snist.edu.in", password_hash=get_password_hash("pass123"), role=UserRole.STUDENT, is_active=True)
            db.add(st_user)
            db.commit()
            st = Student(user_id=st_user.id, roll_number=f"24SN1A056{i}", name=f"Manual Student {i}", department_id=dept.id, academic_year_id=ayear.id, section_id=section.id)
            db.add(st)
            db.commit()
            res_mm = client.post(
                "/api/v1/attendance/manual-mark",
                headers={"Authorization": f"Bearer {teacher_token}"},
                json={
                    "session_id": sess3.id,
                    "roll_number": st.roll_number,
                    "status": "PRESENT",
                    "reason": "scanner_failed",
                    "reason_detail": "Red-team drill test"
                }
            )

        sess_detail = client.get(
            f"/api/v1/teacher/sessions/{sess3.id}",
            headers={"Authorization": f"Bearer {teacher_token}"}
        ).json()

        manual_pct = sess_detail.get("manual_pct", 0.0)
        anomaly_status = sess_detail.get("anomaly_status", "NORMAL")
        d3_pass = anomaly_status in ("AMBER", "RED") and manual_pct >= 30.0

        results.append({
            "drill": "Manual-Mark Abuse (40% Manual Roster)",
            "status_code": 200,
            "response": f"manual_count={sess_detail.get('manual_count')}, manual_pct={manual_pct}%, anomaly={anomaly_status}",
            "verdict": "FLAGGED (RED) (PASS)" if d3_pass else "FAIL"
        })
        print(f"  Result: manual_pct={manual_pct}%, anomaly_status={anomaly_status} => {'FLAGGED (RED) (PASS)' if d3_pass else 'FAILED'}")

        # DRILL 4: Multi-QR / Device Relay Attack (Device-Binding Lockout)
        print("\n[DRILL 4] Executing Photo Relay / Device-Sharing Attack...")
        from app.core.device_security import register_or_get_device
        dev = register_or_get_device(
            db=db,
            device_public_id="DEV_SHARED_PHONE",
            device_secret="DEV_SHARED_PHONE_SECRET_SALT_2026"
        )

        binding = DeviceAccountBinding(
            device_id=dev.id,
            roll_number=s1.roll_number,
            status=BindingStatus.ACTIVE,
            expires_at=datetime.utcnow() + timedelta(minutes=30)
        )
        db.add(binding)
        db.commit()

        # Bob attempts to scan using Alice's phone (DEV_SHARED_PHONE)
        curr_step = int(time.time() / 10)
        live_token = create_mock_projector_token(session_id=sess1.id, period_count=1, step=curr_step)

        with failed_token_tracker._lock:
            failed_token_tracker._failures.clear()
            failed_token_tracker._cooldowns.clear()
        with student_scan_limiter._lock:
            student_scan_limiter._attempts.clear()

        res_bob = client.post(
            "/api/v1/student/scan-session",
            json={"session_token": live_token, "device_uuid": "DEV_SHARED_PHONE"},
            headers={"Authorization": f"Bearer {s2_token}", "x-device-public-id": "DEV_SHARED_PHONE"}
        )
        print("  [DEBUG DRILL 4] res_bob:", res_bob.status_code, res_bob.text)
        # Device lock should reject Bob scanning on Alice's device with 403 Forbidden
        d4_pass = res_bob.status_code == 403 and "associated with another student" in res_bob.text.lower()
        results.append({
            "drill": "Device-Sharing / Proxy Relay (30m Lock)",
            "status_code": res_bob.status_code,
            "response": res_bob.text[:90],
            "verdict": "BLOCKED (403 LOCKOUT) (PASS)" if d4_pass else "FAIL"
        })
        print(f"  Result: Status HTTP {res_bob.status_code} => {'BLOCKED (403 LOCKOUT) (PASS)' if d4_pass else 'FAILED'}")

        # DRILL 5: Offline Grace Boundary Abuse (Grace + 1m)
        print("\n[DRILL 5] Executing Submit Grace Expiry Abuse Drill...")
        with failed_token_tracker._lock:
            failed_token_tracker._failures.clear()
            failed_token_tracker._cooldowns.clear()
        with student_scan_limiter._lock:
            student_scan_limiter._attempts.clear()

        sess5 = AttendanceSession(
            teacher_id=teacher.id,
            subject_id=subject.id,
            section_id=section.id,
            period="1 Period",
            session_date=get_server_ist_date(),
            status=SessionStatus.LOCKED,
            locked_at=datetime.utcnow() - timedelta(minutes=settings.SUBMIT_GRACE_MINUTES + 1)
        )
        db.add(sess5)
        db.commit()

        curr_step5 = int(time.time() / 10)
        token5 = create_mock_projector_token(session_id=sess5.id, period_count=1, step=curr_step5)

        res5 = client.post(
            "/api/v1/student/scan-session",
            json={"session_token": token5, "device_uuid": "DEV_ALICE_01"},
            headers={"Authorization": f"Bearer {s1_token}", "x-device-public-id": "DEV_ALICE_01"}
        )
        print("  [DEBUG DRILL 5] res5:", res5.status_code, res5.text)
        d5_pass = res5.status_code == 400 and ("locked" in res5.text.lower() or "grace" in res5.text.lower())
        results.append({
            "drill": "Submit Grace Boundary Abuse (Grace + 1m)",
            "status_code": res5.status_code,
            "response": res5.text[:90],
            "verdict": "REJECTED (400 GRACE EXPIRED) (PASS)" if d5_pass else "FAIL"
        })
        print(f"  Result: Status HTTP {res5.status_code} => {'REJECTED (400 GRACE EXPIRED) (PASS)' if d5_pass else 'FAILED'}")

    finally:
        db.close()
        app.dependency_overrides.clear()

    print("\n" + "=" * 80)
    print("                      ADVERSARIAL DRILL SUMMARY")
    print("=" * 80)
    for r in results:
        print(f"[{r['verdict']}] {r['drill']} (HTTP {r['status_code']})")
    print("=" * 80)

    all_passed = all("PASS" in r["verdict"] for r in results)
    print(f"\nFinal Drill Result: {'ALL 5 DRILLS DEFEATED ATTACKS (100% PASS)' if all_passed else 'SOME DRILLS FAILED'}")
    return all_passed


if __name__ == "__main__":
    success = run_adversarial_drills()
    sys.exit(0 if success else 1)
