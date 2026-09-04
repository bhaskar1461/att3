import os
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND_DIR = os.path.join(BASE_DIR, "backend")
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app.services.gsheets_service import GoogleSheetsService
from scripts.export_students_to_gsheet import fetch_students_from_db

def main():
    sp_id = "1vCCevdIHp__7x6NJYjAqsCYtvfV9R873EPFgtOtIyw4"
    creds_json = os.path.join(BACKEND_DIR, "credentials.json")

    students = fetch_students_from_db()
    print(f"[*] Formatting SNIST Attendance Register with {len(students)} students...")

    res = GoogleSheetsService.format_and_populate_snist_sheet(
        credentials_json=creds_json,
        spreadsheet_id=sp_id,
        students=students,
        dept_name="COMPUTER SCIENCE AND ENGINEERING",
        batch_info="BATCH:2024-28  AY:2026-27"
    )

    if res.get("success"):
        print("\n" + "="*65)
        print("[SUCCESS] GOOGLE SHEET FORMATTED TO MATCH SNIST REGISTER LAYOUT!")
        print(f"Spreadsheet ID : {sp_id}")
        print(f"Spreadsheet URL: {res['url']}")
        print("="*65 + "\n")
    else:
        print(f"[!] Formatting failed: {res.get('error')}")

if __name__ == "__main__":
    main()
