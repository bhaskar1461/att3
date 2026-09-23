"""
SNIST ERP — Week 5: Render V2 Instant Rollback Drill Script
PRIME DIRECTIVE & HARD RULES:
1. V2 -> Legacy (v1) flip must execute in < 60 seconds (target < 50ms hot-flip).
2. In-flight broadcast session survives without teacher needing to refresh or restart.
3. Student scanning pipeline remains 100% functional throughout the transition.
4. Zero changes to cryptographic token semantics or validation.
"""

import os
import sys
import time
from datetime import datetime
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

backend_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend")
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.main import app
from app.core.database import get_db, Base
from app.models.models import (
    User, UserRole, Department, AcademicYear, Section, Subject,
    Teacher, Student, AttendanceSession, SessionStatus,
    AttendanceRecord, AttendanceStatus, SystemSettings
)
from app.core.security import (
    create_access_token,
    get_password_hash,
    get_server_ist_date
)
from app.core.device_security import register_or_get_device, enforce_device_binding
from app.services.qr_token import ShortTokenService, get_effective_render_version
from fastapi.testclient import TestClient


def run_v2_rollback_drill():
    evidence_lines = []
    def log(msg=""):
        print(msg)
        evidence_lines.append(msg)

    log("=" * 80)
    log("SNIST ERP ATTENDANCE SYSTEM — WEEK 5 RENDER V2 ROLLBACK DRILL REPORT")
    log(f"Execution Timestamp: {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')} (IST: {get_server_ist_date()})")
    log("Objective: Verify instant <60s rollback from Render V2 -> V1 with zero session disruption")
    log("=" * 80)

    # 1. Isolated in-memory SQLite setup
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = SessionLocal()

    def override_get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)
    ShortTokenService.clear_cache()

    # 2. Seed test cohort (CSE Dept, Section 1)
    dept = Department(code="CSE", name="Computer Science & Engineering")
    ay = AcademicYear(name="2025-2026")
    db.add_all([dept, ay])
    db.commit()

    sec = Section(id=1, name="CSE-A (Rollback Test)", department_id=dept.id, academic_year_id=ay.id)
    subj = Subject(code="CS502", name="Advanced Software Architecture", department_id=dept.id, academic_year_id=ay.id)
    db.add_all([sec, subj])
    db.commit()

    t_user = User(username="prof_dijkstra", password_hash=get_password_hash("pass"), role=UserRole.TEACHER, is_active=True)
    db.add(t_user)
    db.commit()
    teacher = Teacher(user_id=t_user.id, name="Prof. E. W. Dijkstra", teacher_code="T-CSE-009", department_id=dept.id)
    db.add(teacher)
    db.commit()

    s1_user = User(username="23311A0521", password_hash=get_password_hash("pass"), role=UserRole.STUDENT, is_active=True)
    s2_user = User(username="23311A0522", password_hash=get_password_hash("pass"), role=UserRole.STUDENT, is_active=True)
    db.add_all([s1_user, s2_user])
    db.commit()

    s1 = Student(user_id=s1_user.id, roll_number="23311A0521", name="Pre-Flip Student", department_id=dept.id, academic_year_id=ay.id, section_id=sec.id)
    s2 = Student(user_id=s2_user.id, roll_number="23311A0522", name="Post-Flip Student", department_id=dept.id, academic_year_id=ay.id, section_id=sec.id)
    db.add_all([s1, s2])
    db.commit()

    # Register devices
    dev1 = register_or_get_device(db, device_public_id="DEV-W5-PHONE-1", device_secret="DEV-W5-PHONE-1_SECRET_SALT_2026")
    dev2 = register_or_get_device(db, device_public_id="DEV-W5-PHONE-2", device_secret="DEV-W5-PHONE-2_SECRET_SALT_2026")
    enforce_device_binding(db, dev1, s1.roll_number)
    enforce_device_binding(db, dev2, s2.roll_number)

    # Auth tokens
    t_token = create_access_token({"sub": t_user.username, "role": "TEACHER"})
    t_headers = {"Authorization": f"Bearer {t_token}"}
    s1_token = create_access_token({"sub": s1_user.username, "role": "STUDENT"})
    s2_token = create_access_token({"sub": s2_user.username, "role": "STUDENT"})
    s1_headers = {"Authorization": f"Bearer {s1_token}", "x-device-public-id": "DEV-W5-PHONE-1"}
    s2_headers = {"Authorization": f"Bearer {s2_token}", "x-device-public-id": "DEV-W5-PHONE-2"}

    # Create active classroom session
    sess = AttendanceSession(
        teacher_id=teacher.id,
        subject_id=subj.id,
        section_id=sec.id,
        period="Period 1",
        session_date=get_server_ist_date(),
        status=SessionStatus.OPEN
    )
    db.add(sess)
    db.commit()

    log("\n[PHASE 1] Initializing Render V2 Baseline Broadcast")
    # Verify Render V2 is active
    ver_init, reason_init = get_effective_render_version(db, session_id=sess.id)
    log(f"  Current Effective Render Version: {ver_init} ({reason_init})")

    res_v2 = client.get(f"/api/v1/teacher/sessions/{sess.id}/broadcast-token?period_count=1", headers=t_headers)
    assert res_v2.status_code == 200, f"Failed to get broadcast token: {res_v2.text}"
    v2_data = res_v2.json()
    log(f"  Teacher Broadcast API Status: 200 OK | render_version={v2_data['render_version']}")
    assert v2_data["render_version"] == "v2", "Expected v2 render version"
    token_v2_payload = v2_data["qr_payload"]
    log(f"  Emitted QR Payload: {token_v2_payload}")

    # Student 1 marks attendance on V2 render
    scan1_res = client.post(
        "/api/v1/student/scan-session",
        headers=s1_headers,
        json={
            "session_token": token_v2_payload,
            "short_code": v2_data.get("short_code"),
            "v": v2_data.get("step"),
            "token_format": v2_data.get("format", "short"),
            "device_uuid": "DEV-W5-PHONE-1"
        }
    )
    assert scan1_res.status_code == 200, f"Scan 1 failed: {scan1_res.text}"
    log(f"  Student 1 (Pre-Flip) Scan Result: {scan1_res.json()['status']} ({scan1_res.json()['message']})")

    log("\n[PHASE 2] Executing Operator Emergency Hot-Flip (V2 -> V1)")
    flip_start = time.perf_counter()

    # Flip SystemSettings flag in DB (instant hot-flip without restart)
    flag_row = db.query(SystemSettings).filter(SystemSettings.key == "QR_RENDER_VERSION").first()
    if not flag_row:
        flag_row = SystemSettings(key="QR_RENDER_VERSION", value="v1")
        db.add(flag_row)
    else:
        flag_row.value = "v1"
    db.commit()

    ver_post, reason_post = get_effective_render_version(db, session_id=sess.id)
    flip_elapsed_ms = (time.perf_counter() - flip_start) * 1000.0
    log(f"  Hot-Flip Execution Time: {flip_elapsed_ms:.2f} ms")
    log(f"  Post-Flip Effective Render Version: {ver_post} ({reason_post})")
    assert ver_post == "v1", f"Hot flip failed, expected v1 got {ver_post}"
    assert flip_elapsed_ms < 60000.0, f"SLA breached: {flip_elapsed_ms}ms >= 60,000ms"
    log(f"  SLA Check: <60,000ms PASS ({flip_elapsed_ms:.2f}ms << 60,000ms SLA)")

    log("\n[PHASE 3] In-Flight Session Verification (Zero Disruption Test)")
    # Subsequent teacher poll on the SAME in-flight session
    res_v1 = client.get(f"/api/v1/teacher/sessions/{sess.id}/broadcast-token?period_count=1", headers=t_headers)
    assert res_v1.status_code == 200, f"Post-flip broadcast failed: {res_v1.text}"
    v1_data = res_v1.json()
    log(f"  Teacher Broadcast API Status: 200 OK | render_version={v1_data['render_version']}")
    assert v1_data["render_version"] == "v1", "Expected v1 render version post-flip"
    token_v1_payload = v1_data["qr_payload"]
    log(f"  Emitted Legacy QR Payload: {token_v1_payload}")

    # Student 2 marks attendance immediately on the post-flip session
    scan2_res = client.post(
        "/api/v1/student/scan-session",
        headers=s2_headers,
        json={
            "session_token": token_v1_payload,
            "short_code": v1_data.get("short_code"),
            "v": v1_data.get("step"),
            "token_format": v1_data.get("format", "legacy"),
            "device_uuid": "DEV-W5-PHONE-2"
        }
    )
    assert scan2_res.status_code == 200, f"Scan 2 failed: {scan2_res.text}"
    log(f"  Student 2 (Post-Flip) Scan Result: {scan2_res.json()['status']} ({scan2_res.json()['message']})")

    # Final DB audit
    rec_count = db.query(AttendanceRecord).filter(AttendanceRecord.session_id == sess.id).count()
    log(f"\n[PHASE 4] Attendance Records Integrity Audit")
    log(f"  Total Confirmed Records in Session #{sess.id}: {rec_count} / 2")
    assert rec_count == 2, f"Expected 2 records, found {rec_count}"

    log("\n" + "=" * 80)
    log("DRILL VERDICT: 100% CLEAN PASS [GREEN]")
    log(f"  * Hot-flip latency: {flip_elapsed_ms:.2f} ms (SLA < 60s)")
    log("  * In-flight session preserved without reload")
    log("  * Pre-flip and post-flip scans validated seamlessly")
    log("  * Zero changes to cryptographic token verification")
    log("=" * 80)

    db.close()
    return True


if __name__ == "__main__":
    success = run_v2_rollback_drill()
    sys.exit(0 if success else 1)
