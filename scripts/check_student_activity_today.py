import os
import sys
from datetime import datetime, timedelta

backend_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'backend'))
if backend_path not in sys.path:
    sys.path.insert(0, backend_path)

from app.core.database import SessionLocal
from app.models.models import AuditLog, AttendanceRecord, AttendanceSession, Student, User, DeviceAccountBinding, StudentOnboarding
from sqlalchemy import or_, and_, desc

def check_activity():
    db = SessionLocal()
    try:
        # Time window: 2:00 PM to 4:00 PM IST on 2026-09-07
        # IST = UTC + 5:30
        # 14:00 IST = 08:30 UTC
        # 16:00 IST = 10:30 UTC
        # Let's also check a slightly wider window (13:00 to 17:00 IST = 07:30 to 11:30 UTC)
        start_utc = datetime(2026, 9, 7, 8, 30, 0)
        end_utc = datetime(2026, 9, 7, 10, 30, 0)

        wide_start_utc = datetime(2026, 9, 7, 7, 30, 0)
        wide_end_utc = datetime(2026, 9, 7, 11, 30, 0)

        print("================================================================")
        print("STUDENT ACTIVITY AUDIT: 2026-09-07 14:00 to 16:00 IST (08:30 - 10:30 UTC)")
        print("================================================================\n")

        # 1. Audit Logs in 2:00 - 4:00 PM IST
        logs = db.query(AuditLog).filter(
            AuditLog.created_at >= start_utc,
            AuditLog.created_at <= end_utc
        ).order_by(AuditLog.created_at.asc()).all()

        print(f"--- 1. AUDIT LOGS (2:00 PM - 4:00 PM IST): Found {len(logs)} records ---")
        student_rolls_in_window = set()
        for l in logs:
            ist_time = l.created_at + timedelta(hours=5, minutes=30)
            roll = l.roll_number or "N/A"
            if roll and roll != "N/A" and roll != "HOURLY_DIGEST":
                student_rolls_in_window.add(roll.strip().upper())
            print(f"[{ist_time.strftime('%H:%M:%S IST')}] Roll: {roll:<15} Event: {l.event_type:<20} Action: {l.action:<25} IP: {l.ip_address} | Details: {l.details}")

        # 2. Wider window Audit Logs (1:00 PM - 5:00 PM IST)
        wide_logs = db.query(AuditLog).filter(
            AuditLog.created_at >= wide_start_utc,
            AuditLog.created_at <= wide_end_utc
        ).order_by(AuditLog.created_at.asc()).all()
        print(f"\n--- 1b. WIDER WINDOW AUDIT LOGS (1:00 PM - 5:00 PM IST): Found {len(wide_logs)} records ---")
        for l in wide_logs:
            if l not in logs:
                ist_time = l.created_at + timedelta(hours=5, minutes=30)
                roll = l.roll_number or "N/A"
                if roll and roll != "N/A" and roll != "HOURLY_DIGEST":
                    student_rolls_in_window.add(roll.strip().upper())
                print(f"[{ist_time.strftime('%H:%M:%S IST')}] Roll: {roll:<15} Event: {l.event_type:<20} Action: {l.action:<25} IP: {l.ip_address} | Details: {l.details}")

        # 3. Attendance Records for today (2026-09-07)
        records = db.query(AttendanceRecord).filter(
            or_(
                AttendanceRecord.session_date == "2026-09-07",
                and_(AttendanceRecord.scanned_at >= wide_start_utc, AttendanceRecord.scanned_at <= wide_end_utc)
            )
        ).all()
        print(f"\n--- 2. ATTENDANCE RECORDS (Today 2026-09-07): Found {len(records)} records ---")
        for r in records:
            ist_scanned = (r.scanned_at + timedelta(hours=5, minutes=30)).strftime('%H:%M:%S IST') if r.scanned_at else "N/A"
            print(f"Session {r.session_id} | Roll: {r.roll_number:<15} Scanned: {ist_scanned} | Status: {r.status} | Mode: {r.scan_mode}")
            student_rolls_in_window.add(r.roll_number.strip().upper())

        # 4. Device Account Bindings updated today
        bindings = db.query(DeviceAccountBinding).filter(
            or_(
                and_(DeviceAccountBinding.created_at >= wide_start_utc, DeviceAccountBinding.created_at <= wide_end_utc),
                and_(DeviceAccountBinding.last_authentication_at >= wide_start_utc, DeviceAccountBinding.last_authentication_at <= wide_end_utc)
            )
        ).all()
        print(f"\n--- 3. DEVICE BINDINGS (Active/Updated in Window): Found {len(bindings)} records ---")
        for b in bindings:
            ist_auth = (b.last_authentication_at + timedelta(hours=5, minutes=30)).strftime('%H:%M:%S IST') if b.last_authentication_at else "N/A"
            print(f"Roll: {b.roll_number:<15} Status: {b.status} Attempts: {b.attempt_count} Last Auth: {ist_auth} DeviceID: {b.device_id}")
            student_rolls_in_window.add(b.roll_number.strip().upper())

        # 5. Summary of unique student identities
        print("\n================================================================")
        print(f"UNIQUE STUDENTS DETECTED (Active between 1:00 PM and 5:00 PM IST): {len(student_rolls_in_window)}")
        print("================================================================")
        for i, roll in enumerate(sorted(student_rolls_in_window), 1):
            student = db.query(Student).filter(Student.roll_number == roll).first()
            name = student.name if student else "Unknown"
            sec = student.section.name if student and student.section else "N/A"
            print(f"{i:2d}. Roll: {roll:<15} Name: {name:<25} Section: {sec}")

    finally:
        db.close()

if __name__ == "__main__":
    check_activity()
