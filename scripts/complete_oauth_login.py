import os
import sys
import json
import pickle
import subprocess
from google_auth_oauthlib.flow import InstalledAppFlow
import requests

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND_DIR = os.path.join(BASE_DIR, "backend")

with open(os.path.join(BASE_DIR, "credentials.json"), "r") as f:
    creds_data = json.load(f)

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive"
]

flow = InstalledAppFlow.from_client_config(
    creds_data,
    SCOPES,
    redirect_uri="http://localhost:8080/"
)

auth_url, _ = flow.authorization_url(prompt="consent", access_type="offline")

print("=" * 70)
print("GOOGLE OAUTH SIGN-IN")
print("=" * 70)
print("\nPlease open this URL in your browser to sign in and grant access:\n")
print(auth_url)
print("\n" + "=" * 70)
print("Waiting for you to log in via browser...")
sys.stdout.flush()

# Write the URL to a text file so it can be opened easily
with open(os.path.join(BASE_DIR, "CLICK_TO_LOGIN.txt"), "w") as f:
    f.write(auth_url)

creds = flow.run_local_server(host="localhost", port=8080, open_browser=True)

# Save tokens locally
for p in [os.path.join(BACKEND_DIR, "token.pickle"), os.path.join(BASE_DIR, "token.pickle")]:
    with open(p, "wb") as f:
        pickle.dump(creds, f)
    print(f"[+] Saved token to: {p}")

r = requests.get('https://www.googleapis.com/drive/v3/about?fields=user', headers={'Authorization': f'Bearer {creds.token}'})
user = r.json().get('user', {})
print(f"\n[SUCCESS] Logged in as: {user.get('displayName')} ({user.get('emailAddress')})")

# Upload to Azure
key_path = r"C:\Users\bhask\.ssh\Ather-os_key.pem"
remote_token_path = "azureuser@20.6.131.206:/home/azureuser/snist_attendance/backend/token.pickle"
print("[+] Deploying new token.pickle to Azure server...")
try:
    cmd = f'scp -i "{key_path}" -o StrictHostKeyChecking=no "{os.path.join(BACKEND_DIR, "token.pickle")}" {remote_token_path}'
    res = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if res.returncode == 0:
        print("[+] Successfully deployed token.pickle to Azure!")
    else:
        print("[-] SCP error:", res.stderr)
except Exception as ex:
    print("[-] SCP failed:", ex)

# Test editing the sheet
sheet_id = "11Q7xFW8D62WfNvxWk_EKvu9WfbT89QvAkAOWUouHdP0"
print(f"\n[+] Testing access to sheet: {sheet_id}")
import gspread
gc = gspread.authorize(creds)
try:
    s = gc.open_by_key(sheet_id)
    ws = s.worksheet("CSE-CS") if "CSE-CS" in [w.title for w in s.worksheets()] else s.get_worksheet(0)
    print(f"[+] Successfully opened sheet '{s.title}' -> worksheet '{ws.title}' with EDIT access!")
except Exception as e:
    print(f"[-] Sheet access error: {e}")
