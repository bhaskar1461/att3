import os
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND_DIR = os.path.join(BASE_DIR, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app.core.database import SessionLocal, engine
from app.models.models import AttendanceRecord, AttendanceSession, AttendanceStatus
from app.services.gsheets_service import GoogleSheetsService
from app.core.config import settings
from sqlalchemy import text

def deduplicate_and_sync():
    db = SessionLocal()
    try:
        print("=== 1. CHECKING FOR DUPLICATE ATTENDANCE RECORDS ===")
        all_recs = db.query(AttendanceRecord).order_by(AttendanceRecord.session_id, AttendanceRecord.roll_number, AttendanceRecord.id.desc()).all()
        
        seen = set()
        to_delete = []
        for r in all_recs:
            key = (r.session_id, r.roll_number.strip().upper())
            if key in seen:
                to_delete.append(r)
            else:
                seen.add(key)
        
        print(f"Found {len(to_delete)} duplicate records across database.")
        for r in to_delete:
            print(f"  Deleting duplicate ID {r.id}: Session {r.session_id}, Roll {r.roll_number}, Status {r.status}")
            db.delete(r)
        
        db.commit()
        print("[+] Duplicate cleanup committed.")

        # Ensure Jangapally Varshith (24311A6204) in session 32 is marked ABSENT
        s32_rec = db.query(AttendanceRecord).filter(
            AttendanceRecord.session_id == 32,
            AttendanceRecord.roll_number == "24311A6204"
        ).first()
        if s32_rec:
            s32_rec.status = AttendanceStatus.ABSENT
            s32_rec.period_count = 0
            db.commit()
            print(f"[+] Jangapally Varshith in session 32 updated to ABSENT (0 periods).")

        # Add unique index if not present
        print("\n=== 2. ADDING UNIQUE CONSTRAINT TO PREVENT FUTURE DUPLICATES ===")
        with engine.connect() as conn:
            try:
                conn.execute(text("CREATE UNIQUE INDEX uq_session_student ON attendance_records (session_id, student_id)"))
                conn.commit()
                print("[+] Successfully created UNIQUE INDEX uq_session_student on attendance_records(session_id, student_id).")
            except Exception as e:
                print(f"[-] Note on unique index creation: {e}")

        # 3. Synchronize Session 32 to Google Sheet
        print("\n=== 3. SYNCING SESSION 32 (07/09/2026) TO GOOGLE SHEET ===")
        creds = settings.GOOGLE_CREDENTIALS_FILE or os.path.join(BACKEND_DIR, "credentials.json")
        sheet_id = "1CDeeivsdptGtgJpgK6XN9o6AKqy6HAIucv45D0Os6ZY"
        
        all_s32_recs = db.query(AttendanceRecord).filter(AttendanceRecord.session_id == 32).all()
        present_rolls = [
            r.roll_number for r in all_s32_recs 
            if r.status.value in ["PRESENT", "1", "2", "3", "4", "5", "6", "7", "8"]
        ]
        all_rolls = [r.roll_number for r in all_s32_recs]
        print(f"Session 32 counts: {len(all_rolls)} total, {len(present_rolls)} present: {present_rolls}")

        success = GoogleSheetsService.sync_session_to_gsheet(
            credentials_json=creds,
            spreadsheet_id=sheet_id,
            date_str="07/09/2026",
            present_rolls=present_rolls,
            all_section_rolls=all_rolls,
            period_total="4"
        )
        print(f"Google Sheet sync result: {success}")

    finally:
        db.close()

if __name__ == "__main__":
    deduplicate_and_sync()
