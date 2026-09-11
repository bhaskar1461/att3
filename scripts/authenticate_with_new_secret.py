import os
import sys
import json
import pickle
from google_auth_oauthlib.flow import InstalledAppFlow
import requests

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND_DIR = os.path.join(BASE_DIR, "backend")

NEW_CREDS = {
    "web": {
        "client_id": os.getenv("GOOGLE_CLIENT_ID", "your-client-id.apps.googleusercontent.com"),
        "project_id": "attendance-system-507904",
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
        "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
        "client_secret": os.getenv("GOOGLE_CLIENT_SECRET", "your-client-secret"),
        "redirect_uris": ["http://localhost:8080/", "https://ather-os.de5.net"],
        "javascript_origins": ["https://ather-os.de5.net", "http://localhost"]
    }
}

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive"
]

def run_auth():
    print("=" * 65)
    print("Google OAuth Authentication for Project: attendance-system-507904")
    print(f"Client ID: {NEW_CREDS['web']['client_id']}")
    print("=" * 65)

    # Save to credentials.json
    with open(os.path.join(BASE_DIR, "credentials.json"), "w") as f:
        json.dump(NEW_CREDS, f, indent=2)
    with open(os.path.join(BACKEND_DIR, "credentials.json"), "w") as f:
        json.dump(NEW_CREDS, f, indent=2)
    print("[+] Updated credentials.json and backend/credentials.json with new secret.")

    flow = InstalledAppFlow.from_client_config(
        NEW_CREDS,
        SCOPES,
        redirect_uri="http://localhost:8080/"
    )

    print("\nStarting local server on http://localhost:8080/ ...")
    print("Opening your browser to authenticate with Google...")
    creds = flow.run_local_server(host="localhost", port=8080, open_browser=True)

    token_paths = [
        os.path.join(BACKEND_DIR, "token.pickle"),
        os.path.join(BASE_DIR, "token.pickle")
    ]
    for p in token_paths:
        with open(p, "wb") as f:
            pickle.dump(creds, f)
        print(f"[+] Saved token to: {p}")

    r = requests.get('https://www.googleapis.com/drive/v3/about?fields=user', headers={'Authorization': f'Bearer {creds.token}'})
    user = r.json().get('user', {})
    print(f"\n[SUCCESS] Logged in as: {user.get('displayName')} ({user.get('emailAddress')})")

if __name__ == "__main__":
    run_auth()
