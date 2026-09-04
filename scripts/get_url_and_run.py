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

    flow = InstalledAppFlow.from_client_secrets_file(creds_json, scopes)
    flow.redirect_uri = 'http://localhost:8088/'
    auth_url, state = flow.authorization_url(prompt='consent', access_type='offline')

    print("==================================================")
    print("AUTHORIZATION_URL:")
    print(auth_url)
    print("==================================================")
    sys.stdout.flush()

    creds = flow.run_local_server(host='localhost', port=8088, open_browser=False)
    with open(token_path, 'wb') as f:
        pickle.dump(creds, f)
    with open(token_path_root, 'wb') as f:
        pickle.dump(creds, f)

    students = fetch_students_from_db()
    res = GoogleSheetsService.create_and_populate_student_sheet(
        credentials_json=creds_json,
        students=students,
        title="Student Roster - AI QR Attendance System"
    )

    if res.get("success"):
        sp_id = res['spreadsheet_id']
        url = res['url']
        update_system_settings_spreadsheet_id(sp_id)
        print("🎉 SUCCESS! Spreadsheet URL:", url)
        sys.stdout.flush()

if __name__ == "__main__":
    main()
