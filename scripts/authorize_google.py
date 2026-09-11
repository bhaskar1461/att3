import os
import sys
import json
import pickle

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND_DIR = os.path.join(BASE_DIR, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from google_auth_oauthlib.flow import InstalledAppFlow

def main():
    scopes = [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive'
    ]
    creds_json = os.path.join(BACKEND_DIR, "credentials.json")
    
    print("==================================================")
    print("       STARTING GOOGLE OAUTH AUTHORIZATION       ")
    print("==================================================")

    flow = InstalledAppFlow.from_client_secrets_file(creds_json, scopes)
    
    print("[*] Launching authentication in your browser...")
    print("[*] Please complete the Google Sign-In prompt in your browser.\n")
    
    creds = flow.run_local_server(host='localhost', port=8080, open_browser=True)

    # Save token in backend/ and root
    token_path1 = os.path.join(BACKEND_DIR, 'token.pickle')
    token_path2 = os.path.join(BASE_DIR, 'token.pickle')
    
    with open(token_path1, 'wb') as f:
        pickle.dump(creds, f)
    with open(token_path2, 'wb') as f:
        pickle.dump(creds, f)

    print("\n[OK] GOOGLE SIGN-IN SUCCESSFUL!")
    print("[*] Creating Google Sheet and populating 10 students...")

    from scripts.export_students_to_gsheet import main as export_main
    export_main()

if __name__ == "__main__":
    main()
