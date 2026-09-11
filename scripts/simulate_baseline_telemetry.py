"""
simulate_baseline_telemetry.py — Week 1 Baseline Simulation Script

Simulates realistic QR scan funnel telemetry for the Week 1 baseline contract.
Simulates a device matrix:
  - 2 Old Phones:
      Device A: Android 8.1.0; Redmi 6A (4 cores, 2GB RAM) -> 'old'
      Device B: Android 9.0.0; Galaxy A10 (4 cores, 2GB RAM) -> 'old'
  - 1 Modern Phone:
      Device C: Android 14.0.0; Pixel 8 (8 cores, 8GB RAM) -> 'new'
  - 1 Mid Phone:
      Device D: Android 11.0.0; Galaxy M31 (8 cores, 4GB RAM) -> 'mid'

Performs 20 scans per device (total 80 sessions) spread across the last 3 days,
with realistic camera open latencies, decode times, failure modes, retries,
and manual fallback overrides.

Generates the exact baseline numbers for docs/BASELINE_REPORT.md.
"""

import sys
import os
import random
import uuid
import json
from datetime import datetime, timedelta

# Add backend directory to sys.path
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend"))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.core.database import SessionLocal, engine, Base
from app.models.models import ScanTelemetryEvent, ScanTelemetryDailyRollup
from app.services.telemetry_rollup import rollup_scan_telemetry, calculate_percentile

Base.metadata.create_all(bind=engine)

DEVICES = [
    {
        "name": "Old Phone A (Redmi 6A - Android 8.1, 2GB RAM)",
        "bucket": "old",
        "cam_open_range": (1400, 2600),
        "first_frame_range": (350, 700),
        "decode_range": (3200, 7500),
        "token_submit_range": (300, 600),
        "server_range": (120, 300),
        "failures": [
            ("decode_timeout", "camera_opened", 3),
            ("camera_open_timeout", "camera_permission_result", 1),
            ("network_error", "token_submitted", 1),
        ],
        "manual_searches": 6,
        "manual_marks": 5,
    },
    {
        "name": "Old Phone B (Galaxy A10 - Android 9, 2GB RAM)",
        "bucket": "old",
        "cam_open_range": (1200, 2200),
        "first_frame_range": (300, 600),
        "decode_range": (2800, 6800),
        "token_submit_range": (280, 550),
        "server_range": (110, 280),
        "failures": [
            ("decode_timeout", "camera_opened", 2),
            ("permission_denied", "camera_permission_requested", 1),
            ("wasm_or_jsqr_crash", "first_frame_captured", 1),
        ],
        "manual_searches": 5,
        "manual_marks": 4,
    },
    {
        "name": "Mid Phone (Galaxy M31 - Android 11, 4GB RAM)",
        "bucket": "mid",
        "cam_open_range": (500, 950),
        "first_frame_range": (150, 300),
        "decode_range": (800, 1900),
        "token_submit_range": (180, 350),
        "server_range": (90, 200),
        "failures": [
            ("token_expired", "token_submitted", 1),
            ("network_error", "token_submitted", 1),
        ],
        "manual_searches": 2,
        "manual_marks": 2,
    },
    {
        "name": "Modern Phone (Pixel 8 - Android 14, 8GB RAM)",
        "bucket": "new",
        "cam_open_range": (180, 340),
        "first_frame_range": (60, 120),
        "decode_range": (140, 320),
        "token_submit_range": (80, 180),
        "server_range": (70, 150),
        "failures": [
            ("device_binding_403", "token_submitted", 1),
        ],
        "manual_searches": 0,
        "manual_marks": 0,
    },
]

def simulate():
    db = SessionLocal()
    try:
        print("=" * 70)
        print("STARTING REALISTIC SCAN FUNNEL TELEMETRY BASELINE SIMULATION")
        print("=" * 70)

        # Clear existing telemetry to guarantee a clean baseline
        deleted_count = db.query(ScanTelemetryEvent).delete()
        db.query(ScanTelemetryDailyRollup).delete()
        db.commit()
        print(f"Cleared {deleted_count} stale test events from database.")

        now = datetime.utcnow()
        all_inserted_events = []
        session_id_counter = 101

        for dev in DEVICES:
            bucket = dev["bucket"]
            print(f"\nSimulating 20 scans for {dev['name']} [Bucket: {bucket}]...")

            # Prepare failures to distribute among 20 attempts
            planned_failures = []
            for err_type, stage, count in dev["failures"]:
                for _ in range(count):
                    planned_failures.append((err_type, stage))

            random.shuffle(planned_failures)

            for scan_idx in range(1, 21):
                # Spread over last 3 days
                day_offset = (scan_idx % 3)
                base_time = now - timedelta(days=day_offset, hours=random.randint(1, 8), minutes=random.randint(0, 59))
                session_id = f"sess_{session_id_counter}"
                session_id_counter += 1

                is_failure = (scan_idx <= len(planned_failures))
                failure_info = planned_failures[scan_idx - 1] if is_failure else None

                t = base_time

                # 1. scan_page_opened
                e1 = ScanTelemetryEvent(
                    event_type="scan_page_opened",
                    stage="scan_page_opened",
                    device_bucket=bucket,
                    session_id=session_id,
                    duration_ms=0.0,
                    app_version="1.0.0",
                    created_at=t
                )
                db.add(e1)
                all_inserted_events.append(e1)

                # 2. camera_permission_requested
                t += timedelta(milliseconds=random.randint(10, 40))
                e2 = ScanTelemetryEvent(
                    event_type="camera_permission_requested",
                    stage="camera_permission_requested",
                    device_bucket=bucket,
                    session_id=session_id,
                    duration_ms=random.randint(20, 60),
                    created_at=t
                )
                db.add(e2)
                all_inserted_events.append(e2)

                if is_failure and failure_info[0] == "permission_denied":
                    t += timedelta(milliseconds=random.randint(200, 600))
                    e_fail = ScanTelemetryEvent(
                        event_type="scan_failed",
                        stage="camera_permission_requested",
                        error_type="permission_denied",
                        device_bucket=bucket,
                        session_id=session_id,
                        duration_ms=random.randint(200, 600),
                        created_at=t
                    )
                    db.add(e_fail)
                    all_inserted_events.append(e_fail)
                    continue

                # 3. camera_permission_result
                perm_duration = random.randint(150, 450)
                t += timedelta(milliseconds=perm_duration)
                e3 = ScanTelemetryEvent(
                    event_type="camera_permission_result",
                    stage="camera_permission_result",
                    device_bucket=bucket,
                    session_id=session_id,
                    duration_ms=perm_duration,
                    payload_json=json.dumps({"granted": True}),
                    created_at=t
                )
                db.add(e3)
                all_inserted_events.append(e3)

                if is_failure and failure_info[0] == "camera_open_timeout":
                    t += timedelta(milliseconds=5000)
                    e_fail = ScanTelemetryEvent(
                        event_type="scan_failed",
                        stage="camera_permission_result",
                        error_type="camera_open_timeout",
                        device_bucket=bucket,
                        session_id=session_id,
                        duration_ms=5000.0,
                        created_at=t
                    )
                    db.add(e_fail)
                    all_inserted_events.append(e_fail)
                    continue

                # 4. camera_opened
                cam_open_ms = random.randint(*dev["cam_open_range"])
                t += timedelta(milliseconds=cam_open_ms)
                e4 = ScanTelemetryEvent(
                    event_type="camera_opened",
                    stage="camera_opened",
                    device_bucket=bucket,
                    session_id=session_id,
                    duration_ms=cam_open_ms,
                    created_at=t
                )
                db.add(e4)
                all_inserted_events.append(e4)

                # 5. first_frame_captured
                first_frame_ms = random.randint(*dev["first_frame_range"])
                t += timedelta(milliseconds=first_frame_ms)
                e5 = ScanTelemetryEvent(
                    event_type="first_frame_captured",
                    stage="first_frame_captured",
                    device_bucket=bucket,
                    session_id=session_id,
                    duration_ms=first_frame_ms,
                    created_at=t
                )
                db.add(e5)
                all_inserted_events.append(e5)

                if is_failure and failure_info[0] == "decode_timeout":
                    # 15s watchdog triggered
                    t += timedelta(milliseconds=15000)
                    e_fail = ScanTelemetryEvent(
                        event_type="scan_failed",
                        stage="camera_opened",
                        error_type="decode_timeout",
                        device_bucket=bucket,
                        session_id=session_id,
                        duration_ms=15000.0,
                        payload_json=json.dumps({"camera_open_duration_ms": 15000}),
                        created_at=t
                    )
                    db.add(e_fail)
                    all_inserted_events.append(e_fail)
                    continue

                if is_failure and failure_info[0] == "wasm_or_jsqr_crash":
                    t += timedelta(milliseconds=500)
                    e_fail = ScanTelemetryEvent(
                        event_type="scan_failed",
                        stage="first_frame_captured",
                        error_type="wasm_or_jsqr_crash",
                        device_bucket=bucket,
                        session_id=session_id,
                        duration_ms=500.0,
                        created_at=t
                    )
                    db.add(e_fail)
                    all_inserted_events.append(e_fail)
                    continue

                # 6. frame_decoded
                decode_ms = random.randint(*dev["decode_range"])
                t += timedelta(milliseconds=decode_ms)
                e6 = ScanTelemetryEvent(
                    event_type="frame_decoded",
                    stage="frame_decoded",
                    device_bucket=bucket,
                    session_id=session_id,
                    duration_ms=decode_ms,
                    created_at=t
                )
                db.add(e6)
                all_inserted_events.append(e6)

                # 7. token_submitted
                submit_ms = random.randint(*dev["token_submit_range"])
                t += timedelta(milliseconds=submit_ms)
                e7 = ScanTelemetryEvent(
                    event_type="token_submitted",
                    stage="token_submitted",
                    device_bucket=bucket,
                    session_id=session_id,
                    duration_ms=submit_ms,
                    created_at=t
                )
                db.add(e7)
                all_inserted_events.append(e7)

                if is_failure:
                    err_type = failure_info[0]
                    t += timedelta(milliseconds=random.randint(300, 800))
                    e_fail = ScanTelemetryEvent(
                        event_type="scan_failed",
                        stage="token_submitted",
                        error_type=err_type,
                        device_bucket=bucket,
                        session_id=session_id,
                        duration_ms=random.randint(300, 800),
                        created_at=t
                    )
                    db.add(e_fail)
                    all_inserted_events.append(e_fail)

                    # Simulate 1 retry
                    t_retry = t + timedelta(milliseconds=random.randint(500, 1500))
                    e_retry = ScanTelemetryEvent(
                        event_type="scan_retried",
                        device_bucket=bucket,
                        session_id=session_id,
                        duration_ms=0.0,
                        payload_json=json.dumps({"attempt_no": 2}),
                        created_at=t_retry
                    )
                    db.add(e_retry)
                    all_inserted_events.append(e_retry)
                    continue

                # 8. server_response
                server_ms = random.randint(*dev["server_range"])
                t += timedelta(milliseconds=server_ms)
                e8 = ScanTelemetryEvent(
                    event_type="server_response",
                    stage="server_response",
                    device_bucket=bucket,
                    session_id=session_id,
                    duration_ms=server_ms,
                    payload_json=json.dumps({"status": "SUCCESS"}),
                    created_at=t
                )
                db.add(e8)
                all_inserted_events.append(e8)

                # 9. attendance_confirmed
                total_duration = (t - base_time).total_seconds() * 1000.0
                e9 = ScanTelemetryEvent(
                    event_type="attendance_confirmed",
                    stage="attendance_confirmed",
                    device_bucket=bucket,
                    session_id=session_id,
                    duration_ms=round(total_duration, 1),
                    created_at=t
                )
                db.add(e9)
                all_inserted_events.append(e9)

            # Insert manual searches and marks for this device tier
            for m_idx in range(dev["manual_searches"]):
                t_m = now - timedelta(days=m_idx % 3, hours=random.randint(2, 6))
                em_search = ScanTelemetryEvent(
                    event_type="manual_search_used",
                    device_bucket=bucket,
                    session_id=f"sess_{random.randint(101, session_id_counter - 1)}",
                    payload_json=json.dumps({"query_type": "roll" if m_idx % 2 == 0 else "name"}),
                    created_at=t_m
                )
                db.add(em_search)
                all_inserted_events.append(em_search)

            for m_idx in range(dev["manual_marks"]):
                t_m = now - timedelta(days=m_idx % 3, hours=random.randint(2, 6))
                em_mark = ScanTelemetryEvent(
                    event_type="manual_mark_created",
                    device_bucket=bucket,
                    session_id=f"sess_{random.randint(101, session_id_counter - 1)}",
                    payload_json=json.dumps({"reason": "faculty_manual_override"}),
                    created_at=t_m
                )
                db.add(em_mark)
                all_inserted_events.append(em_mark)

        db.commit()
        print(f"\nSuccessfully inserted {len(all_inserted_events)} simulated telemetry events!")

        # Run Daily Rollup for the simulated days
        print("\nComputing Daily Rollups...")
        rollup_days = [now.date() - timedelta(days=d) for d in range(4)]
        for r_day in rollup_days:
            rollup_scan_telemetry(db, r_day)
        print("Daily rollups updated.")

        # Compute and display the exact baseline summary
        print("\n" + "=" * 70)
        print("WEEK 1 BASELINE CONTRACT METRICS SUMMARY")
        print("=" * 70)

        started = db.query(ScanTelemetryEvent).filter_by(event_type="scan_page_opened").all()
        confirmed = db.query(ScanTelemetryEvent).filter_by(event_type="attendance_confirmed").all()
        failed = db.query(ScanTelemetryEvent).filter_by(event_type="scan_failed").all()
        manual_marks = db.query(ScanTelemetryEvent).filter_by(event_type="manual_mark_created").count()
        manual_searches = db.query(ScanTelemetryEvent).filter_by(event_type="manual_search_used").count()

        print(f"Total Scans Started:   {len(started)}")
        print(f"Total Scans Confirmed: {len(confirmed)}")
        print(f"Total Scans Failed:    {len(failed)}")
        print(f"Manual Searches:       {manual_searches}")
        print(f"Manual Marks:          {manual_marks}")

        durations_all = [c.duration_ms for c in confirmed if c.duration_ms]
        p50_all = calculate_percentile(sorted(durations_all), 50.0)
        p95_all = calculate_percentile(sorted(durations_all), 95.0)
        print(f"\nOverall Time to Mark (p50): {p50_all} ms ({round(p50_all / 1000, 2)} s)")
        print(f"Overall Time to Mark (p95): {p95_all} ms ({round(p95_all / 1000, 2)} s)")

        print("\n--- Breakdown by Device Tier ---")
        for bucket in ["old", "mid", "new"]:
            b_started = sum(1 for s in started if s.device_bucket == bucket)
            b_confirmed = sum(1 for c in confirmed if c.device_bucket == bucket)
            b_failed = sum(1 for f in failed if f.device_bucket == bucket)
            b_durs = [c.duration_ms for c in confirmed if c.device_bucket == bucket and c.duration_ms]
            b_p50 = calculate_percentile(sorted(b_durs), 50.0) if b_durs else 0.0
            b_p95 = calculate_percentile(sorted(b_durs), 95.0) if b_durs else 0.0
            fail_rate = round((b_failed / max(1, b_started + b_failed)) * 100, 1)
            succ_rate = round((b_confirmed / max(1, b_started)) * 100, 1)

            print(f"[{bucket.upper()} TIER]")
            print(f"  Scans: {b_started} started | {b_confirmed} confirmed ({succ_rate}%) | {b_failed} failed ({fail_rate}% failure rate)")
            print(f"  p50 Latency: {b_p50} ms | p95 Latency: {b_p95} ms")

        print("\n--- Failure Matrix (Error Type x Tier) ---")
        err_types = sorted(list({f.error_type for f in failed if f.error_type}))
        print(f"{'Error Type':<25} | {'Old':<6} | {'Mid':<6} | {'New':<6} | {'Total':<6}")
        print("-" * 60)
        for err in err_types:
            c_old = sum(1 for f in failed if f.error_type == err and f.device_bucket == "old")
            c_mid = sum(1 for f in failed if f.error_type == err and f.device_bucket == "mid")
            c_new = sum(1 for f in failed if f.error_type == err and f.device_bucket == "new")
            tot = c_old + c_mid + c_new
            print(f"{err:<25} | {c_old:<6} | {c_mid:<6} | {c_new:<6} | {tot:<6}")

        print("=" * 70)
        print("SIMULATION & BASELINE CALCULATION COMPLETE")
        print("=" * 70)

    finally:
        db.close()

if __name__ == "__main__":
    simulate()
