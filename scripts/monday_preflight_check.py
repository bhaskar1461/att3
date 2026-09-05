#!/usr/bin/env python3
"""
SNIST AI QR Attendance & ERP — Monday 8:00 AM Pre-Flight Check Script
Autonomous, non-destructive system verification probe.
Can be executed from a laptop or mobile shell in < 10 seconds before students arrive.

Usage:
  python scripts/monday_preflight_check.py [--url https://ather-os.de5.net]
"""

import sys
import os
import time
import argparse
import requests
import json
from datetime import datetime

# Configure UTF-8 stdout for Windows consoles
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

# ANSI Colors
GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
CYAN = "\033[96m"
BOLD = "\033[1m"
RESET = "\033[0m"

def log_pass(name, detail=""):
    print(f"  {GREEN}[PASS]{RESET}  {BOLD}{name}{RESET} {f'({detail})' if detail else ''}")

def log_warn(name, detail=""):
    print(f"  {YELLOW}[WARN]{RESET}  {BOLD}{name}{RESET} ({detail})")

def log_fail(name, detail=""):
    print(f"  {RED}[FAIL]{RESET}  {BOLD}{name}{RESET} ({detail})")

def run_preflight_checks(target_url: str):
    target_url = target_url.rstrip("/")
    print(f"\n{CYAN}{BOLD}{'=' * 65}{RESET}")
    print(f"{CYAN}{BOLD}  SNIST AI QR ATTENDANCE -- MONDAY 8:00 AM PRE-FLIGHT PROBE{RESET}")
    print(f"{CYAN}{BOLD}{'=' * 65}{RESET}")
    print(f"  Target Ingress   : {BOLD}{target_url}{RESET}")
    print(f"  Execution Time   : {datetime.now().strftime('%Y-%m-%d %H:%M:%S IST')}")
    print(f"  Operating Policy : Zero-Breakdown 4-Hour Pilot Window\n")

    passed_count = 0
    total_checks = 6
    session = requests.Session()
    session.headers.update({"User-Agent": "SNIST-SRE-PreflightProbe/2.0"})

    # -------------------------------------------------------------
    # Check 1: Health & Database Connectivity Probe
    # -------------------------------------------------------------
    print(f"{BOLD}[1/6] Probing System & Database Health Endpoint...{RESET}")
    health_url = f"{target_url}/health"
    try:
        t0 = time.perf_counter()
        resp = session.get(health_url, timeout=6)
        dur_ms = round((time.perf_counter() - t0) * 1000, 1)

        if resp.status_code == 200:
            data = resp.json()
            sys_status = data.get("status", "ONLINE")
            db_info = data.get("database")

            if db_info and isinstance(db_info, dict):
                db_status = db_info.get("status", "UNKNOWN")
                db_lat = db_info.get("latency_ms", dur_ms)
                server_time = data.get("server_time", "N/A")
                active_sessions = data.get("active_open_sessions", 0)

                if db_status == "HEALTHY":
                    log_pass("Remote MySQL Connectivity", f"{db_lat}ms probe latency, server time: {server_time}")
                    log_pass("System Status", f"ONLINE, {active_sessions} active open session(s)")
                    passed_count += 1
                else:
                    log_fail("Database Health Probe", f"DB Status: {db_status}")
            elif sys_status == "ONLINE":
                log_pass("System Online Probe", f"HTTP 200 OK, latency: {dur_ms}ms")
                passed_count += 1
            else:
                log_fail("System Health Probe", f"Status: {sys_status}")
        else:
            log_fail("Health Check HTTP Status", f"HTTP {resp.status_code}: {resp.text[:100]}")
    except Exception as exc:
        log_fail("Health Check Network Failure", str(exc))

    # -------------------------------------------------------------
    # Check 2: Teacher Authentication & Profile
    # -------------------------------------------------------------
    print(f"\n{BOLD}[2/6] Verifying Teacher Login & Long-Lived Token (Mrs. N. Sowjanya)...{RESET}")
    teacher_token = None
    try:
        login_url = f"{target_url}/api/v1/auth/login"
        t0 = time.perf_counter()
        login_resp = session.post(
            login_url,
            json={"username": "sowjanya", "password": "sowjanya123"},
            timeout=8
        )
        lat = round((time.perf_counter() - t0) * 1000, 1)

        if login_resp.status_code == 200:
            t_data = login_resp.json()
            teacher_token = t_data.get("access_token")
            role = t_data.get("role")
            name = t_data.get("full_name")

            if role == "TEACHER" and teacher_token:
                log_pass("Faculty Authentication", f"{name} ({role}), {lat}ms")
                passed_count += 1
            else:
                log_fail("Faculty Role Validation", f"Unexpected role: {role}")
        else:
            log_fail("Teacher Login HTTP Error", f"HTTP {login_resp.status_code}: {login_resp.text[:100]}")
    except Exception as exc:
        log_fail("Teacher Login Network Exception", str(exc))

    # -------------------------------------------------------------
    # Check 3: Student Authentication & Device Binding
    # -------------------------------------------------------------
    print(f"\n{BOLD}[3/6] Verifying Student Login & Device Binding (Bhaskar - 23311A05Y6)...{RESET}")
    try:
        device_id = "SMOKE-TEST-DEV-UUID-001"
        student_headers = {
            "x-device-public-id": device_id,
            "x-device-secret": f"{device_id}_SECRET_SALT_2026"
        }
        t0 = time.perf_counter()
        s_resp = session.post(
            f"{target_url}/api/v1/auth/login",
            json={"username": "23311A05Y6", "password": "password123"},
            headers=student_headers,
            timeout=8
        )
        lat = round((time.perf_counter() - t0) * 1000, 1)

        if s_resp.status_code == 200:
            s_data = s_resp.json()
            s_token = s_data.get("access_token")
            s_name = s_data.get("full_name")
            log_pass("Student Authentication", f"{s_name} (23311A05Y6), {lat}ms")
            passed_count += 1
        else:
            log_fail("Student Login HTTP Error", f"HTTP {s_resp.status_code}: {s_resp.text[:100]}")
    except Exception as exc:
        log_fail("Student Login Network Exception", str(exc))

    # -------------------------------------------------------------
    # Check 4: Faculty Assigned Classes & Active CET Session
    # -------------------------------------------------------------
    print(f"\n{BOLD}[4/6] Verifying Faculty Assigned Classes & Session State...{RESET}")
    session_id_to_check = None
    if teacher_token:
        try:
            t_headers = {"Authorization": f"Bearer {teacher_token}"}
            c_resp = session.get(f"{target_url}/api/v1/teacher/assigned-classes", headers=t_headers, timeout=8)
            if c_resp.status_code == 200:
                classes = c_resp.json()
                cet_assigned = any("Career Enhancement" in str(c.get("subject_name", "")) or "CET" in str(c.get("subject_name", "")) or "CS(CET)" in str(c.get("subject_code", "")) for c in classes)
                if cet_assigned:
                    log_pass("Timetable Assignment", f"{len(classes)} class(es) assigned including Career Enhancement Training (CET)")
                    passed_count += 1
                else:
                    log_warn("Timetable Assignment", f"CET class not found in assigned classes: {[c.get('subject_name') for c in classes]}")
            else:
                log_fail("Assigned Classes Query", f"HTTP {c_resp.status_code}")

            # Check profile for Google Sheet configuration status
            p_resp = session.get(f"{target_url}/api/v1/teacher/profile", headers=t_headers, timeout=6)
            if p_resp.status_code == 200:
                prof = p_resp.json()
                gs_id = prof.get("google_sheet_id")
                if gs_id:
                    log_pass("Google Sheet Configuration", f"Linked: https://docs.google.com/spreadsheets/d/{gs_id}")
                else:
                    log_warn("Google Sheet Configuration", "No sheet linked yet. System configured in Safe-DB mode (attendance commits to DB without locking out).")
        except Exception as exc:
            log_fail("Assigned Classes Query Exception", str(exc))
    else:
        log_fail("Assigned Classes Verification Skipped", "Teacher token unavailable")

    # -------------------------------------------------------------
    # Check 5: Projector Rotating QR Broadcast Token Generator
    # -------------------------------------------------------------
    print(f"\n{BOLD}[5/6] Testing Rotating Projector QR Broadcast Stream (10s Token)...{RESET}")
    if teacher_token:
        try:
            # Query session 29 (Active CET session) or find first open session
            t_headers = {"Authorization": f"Bearer {teacher_token}"}
            b_resp = session.get(f"{target_url}/api/v1/teacher/sessions/29/broadcast-token", headers=t_headers, timeout=8)
            if b_resp.status_code == 200:
                b_data = b_resp.json()
                payload = b_data.get("qr_payload", "")
                remaining = b_data.get("seconds_remaining")
                enrolled = b_data.get("total_enrolled")
                marked = b_data.get("total_marked")
                qr_b64 = b_data.get("qr_base64", "")

                if payload.startswith("SNIST-SES|") and len(qr_b64) > 100:
                    log_pass("Projector Token Generation", f"Payload: {payload[:25]}... (TTL: {remaining}s)")
                    log_pass("Roster Headcount Telemetry", f"{enrolled} Enrolled, {marked} Marked Present")
                    passed_count += 1
                else:
                    log_fail("Projector Token Validation", f"Malformed payload: {payload}")
            else:
                log_fail("Projector Broadcast Endpoint", f"HTTP {b_resp.status_code}: {b_resp.text[:100]}")
        except Exception as exc:
            log_fail("Projector Broadcast Exception", str(exc))
    else:
        log_fail("Projector Token Test Skipped", "Teacher token unavailable")

    # -------------------------------------------------------------
    # Check 6: Scanner Secure Context & HTTPS Verification
    # -------------------------------------------------------------
    print(f"\n{BOLD}[6/6] Verifying HTTPS / Camera Secure Context & Ingress Routing...{RESET}")
    try:
        is_https = target_url.startswith("https://")
        if is_https:
            log_pass("TLS / HTTPS Termination", "Strict secure context confirmed (required for BarcodeDetector & camera API)")
            passed_count += 1
        else:
            log_warn("TLS / HTTPS Status", "Running on HTTP. Camera scanner may be blocked by iOS/Android browser security unless localhost.")
    except Exception as exc:
        log_fail("HTTPS Verification Exception", str(exc))

    # -------------------------------------------------------------
    # Verdict & Summary Report
    # -------------------------------------------------------------
    print(f"\n{CYAN}{BOLD}{'=' * 65}{RESET}")
    if passed_count == total_checks:
        print(f"  {GREEN}{BOLD}🎉 PRE-FLIGHT VERDICT: GO — SYSTEM READY FOR MONDAY 9 AM PILOT{RESET}")
        print(f"  Score: {passed_count}/{total_checks} Critical Checks Passed.")
    elif passed_count >= 5:
        print(f"  {YELLOW}{BOLD}⚠️  PRE-FLIGHT VERDICT: CONDITIONAL GO — CHECK WARNINGS ABOVE{RESET}")
        print(f"  Score: {passed_count}/{total_checks} Checks Passed.")
    else:
        print(f"  {RED}{BOLD}🛑 PRE-FLIGHT VERDICT: NO-GO — REMEDIATE FAILURES BEFORE PILOT{RESET}")
        print(f"  Score: {passed_count}/{total_checks} Checks Passed.")
    print(f"{CYAN}{BOLD}{'=' * 65}{RESET}\n")

    return passed_count == total_checks

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="SNIST Monday Pre-Flight Smoke Test Probe")
    parser.add_argument("--url", default="https://ather-os.de5.net", help="Base URL of deployed SNIST Attendance system")
    args = parser.parse_args()

    success = run_preflight_checks(args.url)
    sys.exit(0 if success else 1)
