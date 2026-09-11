import os
import sys
import pickle

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND_DIR = os.path.join(BASE_DIR, "backend")

from google_auth_oauthlib.flow import InstalledAppFlow

def authenticate_google_account():
    creds_file = os.path.join(BASE_DIR, "credentials.json")
    scopes = [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive"
    ]

    print("=" * 60)
    print("Google OAuth Authentication")
    print(f"Using Client Secrets: {creds_file}")
    print("=" * 60)

    flow = InstalledAppFlow.from_client_secrets_file(creds_file, scopes)
    print("Opening browser for Google Account authentication...")
    print("Please log in with Vijay Kumar sir's account (or whichever account owns/edits the sheets).")
    
    creds = flow.run_local_server(port=0)

    # Save to both backend/token.pickle and token.pickle
    token_paths = [
        os.path.join(BACKEND_DIR, "token.pickle"),
        os.path.join(BASE_DIR, "token.pickle")
    ]
    for p in token_paths:
        with open(p, "wb") as f:
            pickle.dump(creds, f)
        print(f"[+] Successfully saved new token to: {p}")

    import requests
    r = requests.get('https://www.googleapis.com/drive/v3/about?fields=user', headers={'Authorization': f'Bearer {creds.token}'})
    user_info = r.json().get('user', {})
    print(f"[SUCCESS] Authenticated as: {user_info.get('displayName')} ({user_info.get('emailAddress')})")

if __name__ == "__main__":
    authenticate_google_account()
