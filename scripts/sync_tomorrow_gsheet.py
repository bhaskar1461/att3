import os
import sys
import json

backend_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend")
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.core.database import SessionLocal
from app.models.models import Student
from app.services.gsheets_service import GoogleSheetsService

def sync_tomorrow_google_sheet():
    creds_file = os.path.join(backend_dir, "credentials.json")
    sheet_id = "113b1RKUGQGHtoViEFJjgeGxD1VzxaGgSAn0Guxh_ni8"
    
    if not os.path.exists(creds_file):
        print(f"Credentials file not found at: {creds_file}")
        return False

    client = GoogleSheetsService._get_client(creds_file)
    spreadsheet = client.open_by_key(sheet_id)
    try:
        worksheet = spreadsheet.worksheet("Attendance Register")
    except Exception:
        worksheet = spreadsheet.sheet1

    # Backup current sheet data
    old_rows = worksheet.get_all_values()
    backup_file = os.path.join(backend_dir, "data", "backups", "gsheet_backup_20260906.json")
    with open(backup_file, "w", encoding="utf-8") as f:
        json.dump(old_rows, f, indent=2)
    print(f"[Backup] Saved existing GSheet data ({len(old_rows)} rows) to: {backup_file}")

    # Fetch real 51 students from database
    db = SessionLocal()
    students = db.query(Student).filter(Student.section_id == 1).order_by(Student.roll_number).all()
    student_list = [
        {"roll_number": s.roll_number, "name": s.name, "agency": s.agency or "Regular"}
        for s in students
    ]
    db.close()
    print(f"Loaded {len(student_list)} students for Section CS-A.")

    # Prepare fresh rows with 07/09/2026 as the ONLY date
    rows = []
    # Row 1-4 Header block
    rows.append(["SREENIDHI INSTITUTE OF SCIENCE & TECHNOLOGY"])
    rows.append(["DEPARTMENT OF COMPUTER SCIENCE & ENGINEERING"])
    rows.append(["CAREER ENHANCEMENT TRAINING (CET)"])
    rows.append(["Name of the Training Agency: COIGN   |   FROM DATE: 07-09-2026   TO DATE: --"])

    # Row 5: Title + Dates
    r5 = ["LIST OF B.TECH STUDENTS  - III - I  SEM     BATCH:2024-28  AY:2026-27", "", "", "", "07/09/2026"]
    rows.append(r5)

    # Row 6: Column Headers + Period total
    r6 = ["SNO", "ROLL NO", "NAME", "Agency", "4"]
    rows.append(r6)

    # Row 7+: Students
    for idx, st in enumerate(student_list, 1):
        st_row = [idx, st["roll_number"], st["name"], st["agency"], ""] # empty cell ready for tomorrow
        rows.append(st_row)

    worksheet.clear()
    worksheet.update(values=rows, range_name="A1")

    # Apply formatting
    num_rows = len(rows)
    num_cols = max(len(rows[5]), 14)
    GoogleSheetsService._apply_sheet_formatting(spreadsheet, worksheet, num_rows, num_cols)

    print(f"[Success] Updated Google Sheet '{spreadsheet.title}' with {len(student_list)} students and tomorrow's date (07/09/2026) as first column.")
    print(f"URL: https://docs.google.com/spreadsheets/d/{sheet_id}/edit")
    return True

if __name__ == "__main__":
    sync_tomorrow_google_sheet()
