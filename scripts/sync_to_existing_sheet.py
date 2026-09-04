import os
import sys
import json

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND_DIR = os.path.join(BASE_DIR, "backend")
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app.services.gsheets_service import GoogleSheetsService
from scripts.export_students_to_gsheet import fetch_students_from_db, update_system_settings_spreadsheet_id

def extract_spreadsheet_id(input_str: str) -> str:
    s = input_str.strip()
    if "/d/" in s:
        parts = s.split("/d/")
        if len(parts) > 1:
            return parts[1].split("/")[0]
    return s

def sync_sheet(sheet_input: str):
    sp_id = extract_spreadsheet_id(sheet_input)
    creds_json = os.path.join(BACKEND_DIR, "credentials.json")

    students = fetch_students_from_db()
    print(f"[*] Syncing {len(students)} students to Google Sheet ID: {sp_id}")

    success = GoogleSheetsService.sync_all_students(
        credentials_json=creds_json,
        spreadsheet_id=sp_id,
        students=students
    )

    if success:
        update_system_settings_spreadsheet_id(sp_id)
        url = f"https://docs.google.com/spreadsheets/d/{sp_id}/edit"
        print("\n" + "="*65)
        print("[SUCCESS] ALL 10 STUDENTS POPULATED INTO GOOGLE SHEET!")
        print(f"Spreadsheet ID : {sp_id}")
        print(f"Spreadsheet URL: {url}")
        print("="*65 + "\n")
        return True
    else:
        print("[!] Sync failed. Please verify spreadsheet ID and permissions.")
        return False

def main():
    if len(sys.argv) > 1:
        sync_sheet(sys.argv[1])
    else:
        sheet_url_or_id = input("Enter Google Sheet URL or ID: ")
        if sheet_url_or_id:
            sync_sheet(sheet_url_or_id)

if __name__ == "__main__":
    main()
