"""
Probe script: Extract empirical churn and device binding telemetry from live database.
Adheres strictly to zero PII: only counts, ratios, distributions, and sanitized hashes.
"""

import os
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime

# Adjust path to import backend app
backend_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend")
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.core.database import SessionLocal, engine
from app.models.models import (
    AuditLog, DeviceRegistration, DeviceAccountBinding, Student, AttendanceRecord,
    SecurityEventType
)
from sqlalchemy import text

def run_telemetry_probe():
    db = SessionLocal()
    try:
        print("=" * 70)
        print("DEVICE BINDING TELEMETRY & CHURN ANALYSIS (ZERO PII)")
        print("=" * 70)

        # 1. Audit Log Event Distribution
        print("\n--- 1. AUDIT LOG EVENT BREAKDOWN ---")
        audit_events = db.execute(text(
            "SELECT event_type, action, COUNT(*) as cnt "
            "FROM qr_audit_logs "
            "GROUP BY event_type, action "
            "ORDER BY cnt DESC"
        )).fetchall()
        for ev, act, cnt in audit_events:
            print(f"  {ev or 'NULL':<30} | {act or 'NULL':<30} | {cnt:>5}")

        # 2. Device Security Specific Events
        print("\n--- 2. DEVICE SECURITY / BINDING 403 COUNTS ---")
        sec_events = db.execute(text(
            "SELECT action, COUNT(*) as cnt "
            "FROM qr_audit_logs "
            "WHERE action IN ('ACCOUNT_SWITCH_ATTEMPT', 'UNAPPROVED_DEVICE_LOGIN', 'DEVICE_ACCESS_BLOCKED', 'AUTH_ATTEMPT_LIMIT_REACHED') "
            "   OR event_type IN ('ACCOUNT_SWITCH_ATTEMPT', 'UNAPPROVED_DEVICE_LOGIN', 'DEVICE_REVOKED') "
            "GROUP BY action"
        )).fetchall()
        for act, cnt in sec_events:
            print(f"  {act:<35} : {cnt:>5}")

        # 3. Student Device Multiplicity (Distribution of devices per student)
        print("\n--- 3. MULTI-DEVICE STUDENT DISTRIBUTION ---")
        # Query distinct device_ids per roll_number from DeviceAccountBinding
        student_binding_counts = db.execute(text(
            "SELECT roll_number, COUNT(DISTINCT device_id) as dev_count, COUNT(*) as total_bindings "
            "FROM qr_device_account_bindings "
            "GROUP BY roll_number"
        )).fetchall()

        dist = Counter()
        churner_rolls = set()
        stable_rolls = set()
        for r_num, d_count, b_count in student_binding_counts:
            dist[d_count] += 1
            if d_count > 1:
                churner_rolls.add(r_num)
            else:
                stable_rolls.add(r_num)

        print(f"  Total students with recorded bindings: {len(student_binding_counts)}")
        for dev_cnt in sorted(dist.keys()):
            pct = (dist[dev_cnt] / len(student_binding_counts)) * 100 if student_binding_counts else 0
            print(f"  Students with {dev_cnt} device(s): {dist[dev_cnt]:>3} ({pct:>5.1f}%)")

        print(f"  Stable cohort (1 device): {len(stable_rolls)}")
        print(f"  Churner cohort (>1 device): {len(churner_rolls)}")

        # Also check Student.registered_device_id distribution
        reg_dev_stats = db.execute(text(
            "SELECT "
            "  COUNT(*) as total_students, "
            "  SUM(CASE WHEN registered_device_id IS NOT NULL THEN 1 ELSE 0 END) as enrolled_count, "
            "  SUM(CASE WHEN registered_device_id IS NULL THEN 1 ELSE 0 END) as unenrolled_count "
            "FROM qr_students"
        )).fetchone()
        print(f"  Students with registered_device_id: {reg_dev_stats[1]}/{reg_dev_stats[0]} ({reg_dev_stats[1]/reg_dev_stats[0]*100:.1f}%)")

        # 4. Correlation: Device Churn vs Manual-Mark Rate
        print("\n--- 4. CHURN COHORT VS STABLE COHORT MANUAL-MARK CORRELATION ---")
        
        # Manual marks in AttendanceRecord: scan_mode = 'MANUAL'
        all_attendance = db.execute(text(
            "SELECT roll_number, scan_mode, COUNT(*) as cnt "
            "FROM qr_attendance_records "
            "GROUP BY roll_number, scan_mode"
        )).fetchall()

        student_att = defaultdict(lambda: {"QR": 0, "MANUAL": 0, "TOTAL": 0})
        for roll, mode, cnt in all_attendance:
            student_att[roll]["TOTAL"] += cnt
            if mode == "MANUAL":
                student_att[roll]["MANUAL"] += cnt
            else:
                student_att[roll]["QR"] += cnt

        def get_cohort_stats(rolls, label):
            tot_scans = 0
            tot_manual = 0
            student_rates = []
            for r in rolls:
                if r in student_att and student_att[r]["TOTAL"] > 0:
                    t = student_att[r]["TOTAL"]
                    m = student_att[r]["MANUAL"]
                    tot_scans += t
                    tot_manual += m
                    student_rates.append(m / t)
            
            rate = (tot_manual / tot_scans * 100) if tot_scans > 0 else 0.0
            print(f"  [{label}] Students: {len(student_rates)}, Total Marks: {tot_scans}, Manual Marks: {tot_manual}, Manual Rate: {rate:.2f}%")
            return rate

        stable_rate = get_cohort_stats(stable_rolls, "STABLE (1 Device)")
        churn_rate = get_cohort_stats(churner_rolls, "CHURNER (>1 Device)")

        # 5. Server-side Query Performance: EXPLAIN device binding queries
        print("\n--- 5. LOOKUP QUERY EXPLAIN & TIMING (<= 5ms budget) ---")
        # Measure latency of device lookup + binding lookup
        test_queries = [
            ("DeviceRegistration by device_public_id", 
             "EXPLAIN SELECT * FROM qr_device_registrations WHERE device_public_id = 'DEV-CONN-1234567890ABCDEF'",
             "SELECT * FROM qr_device_registrations WHERE device_public_id = 'DEV-CONN-1234567890ABCDEF'"),
            ("DeviceAccountBinding active lookup", 
             "EXPLAIN SELECT * FROM qr_device_account_bindings WHERE device_id = 1 AND status = 'ACTIVE' AND expires_at > NOW()",
             "SELECT * FROM qr_device_account_bindings WHERE device_id = 1 AND status = 'ACTIVE' AND expires_at > NOW()"),
            ("Student registered_device_id lookup",
             "EXPLAIN SELECT id, registered_device_id FROM qr_students WHERE roll_number = '23311A0501'",
             "SELECT id, registered_device_id FROM qr_students WHERE roll_number = '23311A0501'")
        ]

        for q_label, explain_sql, exec_sql in test_queries:
            print(f"\n  Query: {q_label}")
            try:
                exp_res = db.execute(text(explain_sql)).fetchall()
                for row in exp_res:
                    print(f"    EXPLAIN: {row}")
                
                # Measure 50 iterations
                t0 = time.perf_counter()
                for _ in range(50):
                    db.execute(text(exec_sql)).fetchall()
                t1 = time.perf_counter()
                avg_ms = ((t1 - t0) / 50) * 1000
                print(f"    Average Execution Latency: {avg_ms:.3f} ms (Budget: <= 5.0 ms)")
            except Exception as ex:
                print(f"    Query test error: {ex}")

        # 6. Schema Capability Check
        print("\n--- 6. SCHEMA CAPABILITY EVALUATION ---")
        # Can current schema represent one active binding per student + revocation?
        # Check constraints on qr_device_account_bindings
        idx_res = db.execute(text("SHOW INDEX FROM qr_device_account_bindings")).fetchall()
        print("  Indexes on qr_device_account_bindings:")
        for idx in idx_res:
            key_name = idx[2]
            col_name = idx[4]
            non_unique = idx[1]
            print(f"    Index: {key_name:<25} Column: {col_name:<20} Unique: {non_unique == 0}")

    finally:
        db.close()

if __name__ == "__main__":
    run_telemetry_probe()
