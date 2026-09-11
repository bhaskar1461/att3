import os
import sys
from datetime import datetime, timedelta

backend_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'backend'))
if backend_path not in sys.path:
    sys.path.insert(0, backend_path)

from app.core.database import SessionLocal
from app.models.models import AuditLog, AttendanceRecord, Student, DeviceAccountBinding
from sqlalchemy import or_, and_

def exact_2_to_4_audit():
    db = SessionLocal()
    try:
        # Exact window: 14:00:00 IST to 16:00:00 IST on 2026-09-07
        # In UTC: 08:30:00 UTC to 10:30:00 UTC
        start_utc = datetime(2026, 9, 7, 8, 30, 0)
        end_utc = datetime(2026, 9, 7, 10, 30, 0)

        # Map roll -> details dict
        student_activities = {}

        # 1. Audit logs
        logs = db.query(AuditLog).filter(
            AuditLog.created_at >= start_utc,
            AuditLog.created_at <= end_utc
        ).order_by(AuditLog.created_at.asc()).all()

        for l in logs:
            roll = (l.roll_number or "").strip().upper()
            if not roll or roll in ("HOURLY_DIGEST", "UNKNOWN", "N/A"):
                continue
            if roll.startswith("DEMO"):
                continue
            ist_dt = l.created_at + timedelta(hours=5, minutes=30)
            if roll not in student_activities:
                student_activities[roll] = {
                    "first_seen": ist_dt,
                    "last_seen": ist_dt,
                    "actions": set(),
                    "scanned": False,
                    "scan_time": None
                }
            student_activities[roll]["actions"].add(l.action or l.event_type)
            if ist_dt < student_activities[roll]["first_seen"]:
                student_activities[roll]["first_seen"] = ist_dt
            if ist_dt > student_activities[roll]["last_seen"]:
                student_activities[roll]["last_seen"] = ist_dt

        # 2. Attendance Records
        records = db.query(AttendanceRecord).filter(
            AttendanceRecord.scanned_at >= start_utc,
            AttendanceRecord.scanned_at <= end_utc
        ).all()

        for r in records:
            roll = r.roll_number.strip().upper()
            ist_dt = r.scanned_at + timedelta(hours=5, minutes=30)
            if roll not in student_activities:
                student_activities[roll] = {
                    "first_seen": ist_dt,
                    "last_seen": ist_dt,
                    "actions": set(),
                    "scanned": True,
                    "scan_time": ist_dt
                }
            else:
                student_activities[roll]["scanned"] = True
                student_activities[roll]["scan_time"] = ist_dt
            student_activities[roll]["actions"].add(f"ATTENDANCE_SCAN ({r.scan_mode})")

        # 3. Device Bindings / Auth
        bindings = db.query(DeviceAccountBinding).filter(
            DeviceAccountBinding.last_authentication_at >= start_utc,
            DeviceAccountBinding.last_authentication_at <= end_utc
        ).all()

        for b in bindings:
            roll = b.roll_number.strip().upper()
            if roll.startswith("DEMO"):
                continue
            ist_dt = b.last_authentication_at + timedelta(hours=5, minutes=30)
            if roll not in student_activities:
                student_activities[roll] = {
                    "first_seen": ist_dt,
                    "last_seen": ist_dt,
                    "actions": set(),
                    "scanned": False,
                    "scan_time": None
                }
            student_activities[roll]["actions"].add("DEVICE_AUTH")
            if ist_dt < student_activities[roll]["first_seen"]:
                student_activities[roll]["first_seen"] = ist_dt
            if ist_dt > student_activities[roll]["last_seen"]:
                student_activities[roll]["last_seen"] = ist_dt

        print(f"TOTAL UNIQUE STUDENTS (2:00 PM - 4:00 PM IST): {len(student_activities)}")
        print("-------------------------------------------------------------------------")
        sorted_rolls = sorted(student_activities.keys())
        results = []
        for i, roll in enumerate(sorted_rolls, 1):
            st = db.query(Student).filter(Student.roll_number == roll).first()
            name = st.name if st else "Name Not Registered"
            sec = st.section.name if st and st.section else "N/A"
            info = student_activities[roll]
            actions_str = ", ".join(info["actions"])
            first_time = info["first_seen"].strftime("%I:%M:%S %p")
            last_time = info["last_seen"].strftime("%I:%M:%S %p")
            scan_status = "YES" if info["scanned"] else "NO (Login/Auth Only)"
            print(f"{i:2d}. {roll} | {name:<26} | Sec: {sec:<4} | Time: {first_time} - {last_time} | Scanned: {scan_status} | Actions: {actions_str}")
            results.append({
                "index": i,
                "roll": roll,
                "name": name,
                "section": sec,
                "time": f"{first_time} - {last_time}",
                "scanned": scan_status,
                "actions": actions_str
            })

    finally:
        db.close()

if __name__ == "__main__":
    exact_2_to_4_audit()
