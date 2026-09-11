import os
import sys
import json

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND_DIR = os.path.join(BASE_DIR, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app.core.config import settings
from app.services.gsheets_service import GoogleSheetsService

def main():
    print("==================================================")
    print("      GOOGLE SERVICE ACCOUNT KEY VALIDATOR        ")
    print("==================================================")

    creds_path = settings.GOOGLE_CREDENTIALS_FILE or os.getenv("GOOGLE_CREDENTIALS_FILE")
    if not creds_path:
        default_json = os.path.join(BACKEND_DIR, "credentials.json")
        if os.path.exists(default_json):
            creds_path = default_json

    if not creds_path or not os.path.exists(creds_path):
        print("\n[!] ERROR: No Google Credentials JSON file found.")
        print(f"    Expected path: {os.path.join(BACKEND_DIR, 'credentials.json')}")
        print("    Please save your downloaded Service Account JSON key to 'backend/credentials.json'.\n")
        return

    print(f"[*] Found credentials file: {creds_path}")

    try:
        with open(creds_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        print(f"[OK] Valid JSON format!")
        if isinstance(data, dict) and data.get("type") == "service_account":
            print(f"    Credential Type       : Service Account Key")
            print(f"    Project ID            : {data.get('project_id', 'Unknown')}")
            print(f"    Service Account Email : {data.get('client_email', 'Unknown')}")
        elif isinstance(data, dict) and ("installed" in data or "web" in data):
            client_info = data.get("installed") or data.get("web") or {}
            print(f"    Credential Type       : OAuth 2.0 Client ID (User Authentication)")
            print(f"    Project ID            : {client_info.get('project_id', 'Unknown')}")
            print(f"    Client ID             : {client_info.get('client_id', 'Unknown')}")
        else:
            print(f"    Credential Type       : Custom / Unknown JSON structure")

        print("\n[*] Testing Google Sheets API connection by creating a test sheet...")
        test_students = [
            {"roll_number": "TEST01", "name": "Test Student", "department": "CSE", "academic_year": "3rd Year", "section": "CSE-A", "email": "test@student.edu", "mobile": "", "agency": "Regular"}
        ]

        res = GoogleSheetsService.create_and_populate_student_sheet(
            credentials_json=creds_path,
            students=test_students,
            title="API Connection Test - Attendance System"
        )

        if res.get("success"):
            print("\n" + "="*60)
            print("[SUCCESS] GOOGLE SERVICE ACCOUNT KEY IS WORKING PERFECTLY!")
            print(f"Spreadsheet ID : {res['spreadsheet_id']}")
            print(f"Spreadsheet URL: {res['url']}")
            print("="*60 + "\n")
        else:
            print(f"\n[!] Connection test failed: {res.get('error')}")
            print("    Please ensure 'Google Sheets API' and 'Google Drive API' are enabled in Google Cloud Console.")

    except Exception as e:
        print(f"\n[!] Invalid Service Account JSON file: {e}")

if __name__ == "__main__":
    main()
