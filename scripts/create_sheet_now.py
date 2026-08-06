import os
import sys
import json
import pickle

os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'
os.environ['OAUTHLIB_RELAX_TOKEN_SCOPE'] = '1'

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND_DIR = os.path.join(BASE_DIR, "backend")
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from google_auth_oauthlib.flow import InstalledAppFlow
from app.services.gsheets_service import GoogleSheetsService
from scripts.export_students_to_gsheet import fetch_students_from_db, update_system_settings_spreadsheet_id

def main():
    scopes = [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive'
    ]
    creds_json = os.path.join(BACKEND_DIR, "credentials.json")
    token_path = os.path.join(BACKEND_DIR, "token.pickle")
    token_path_root = os.path.join(BASE_DIR, "token.pickle")

    print("==================================================")
    print("      CREATING GOOGLE SHEET & ADDING STUDENTS     ")
    print("==================================================")

    creds = None
    if os.path.exists(token_path):
        try:
            with open(token_path, 'rb') as f:
                creds = pickle.load(f)
        except Exception: creds = None
    elif os.path.exists(token_path_root):
        try:
            with open(token_path_root, 'rb') as f:
                creds = pickle.load(f)
        except Exception: creds = None

    if not creds or not creds.valid:
        print("[*] Launching 1-click Google Sign-in...")
        flow = InstalledAppFlow.from_client_secrets_file(creds_json, scopes)
        creds = flow.run_local_server(port=0, open_browser=True)
        with open(token_path, 'wb') as f:
            pickle.dump(creds, f)
        with open(token_path_root, 'wb') as f:
            pickle.dump(creds, f)

    students = fetch_students_from_db()
    print(f"[*] Found {len(students)} students in DB. Populating Google Sheet...")

    res = GoogleSheetsService.create_and_populate_student_sheet(
        credentials_json=creds_json,
        students=students,
        title="Student Roster - AI QR Attendance System"
    )

    if res.get("success"):
        sp_id = res['spreadsheet_id']
        url = res['url']
        update_system_settings_spreadsheet_id(sp_id)

        print("\n" + "="*65)
        print("🎉 SUCCESS! GOOGLE SHEET CREATED SUCCESSFULLY!")
        print(f"Spreadsheet ID : {sp_id}")
        print(f"Spreadsheet URL: {url}")
        print("="*65 + "\n")
    else:
        print(f"\n[!] Sheet creation failed: {res.get('error')}")

if __name__ == "__main__":
    main()
