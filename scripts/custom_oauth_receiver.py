import os
import sys
import json
import pickle
import subprocess
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler
import requests
from google.oauth2.credentials import Credentials

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND_DIR = os.path.join(BASE_DIR, "backend")

with open(os.path.join(BASE_DIR, "credentials.json"), "r") as f:
    creds_data = json.load(f)

web = creds_data.get("web") or creds_data.get("installed")
client_id = web["client_id"]
client_secret = web["client_secret"]
redirect_uri = "http://localhost:8080/"

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive"
]

auth_code = None

class OAuthCallbackHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        global auth_code
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        if "code" in qs:
            auth_code = qs["code"][0]
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            html = """
            <html>
            <body style="font-family: Arial, sans-serif; text-align: center; padding-top: 50px; background-color: #f4f6f9;">
                <div style="max-width: 500px; margin: auto; background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
                    <h2 style="color: #2e7d32;">Authentication Successful!</h2>
                    <p style="color: #555; font-size: 16px;">The attendance system has received your authorization.</p>
                    <p style="color: #777;">You can safely close this browser window.</p>
                </div>
            </body>
            </html>
            """
            self.wfile.write(html.encode("utf-8"))
        else:
            self.send_response(400)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            error = qs.get("error", ["Unknown error"])[0]
            self.wfile.write(f"<h2>Authentication Failed: {error}</h2>".encode("utf-8"))

    def log_message(self, format, *args):
        pass

# Generate auth URL
params = {
    "client_id": client_id,
    "redirect_uri": redirect_uri,
    "response_type": "code",
    "scope": " ".join(SCOPES),
    "access_type": "offline",
    "prompt": "consent"
}
auth_url = "https://accounts.google.com/o/oauth2/auth?" + urllib.parse.urlencode(params)

print("=" * 70)
print("GOOGLE OAUTH SIGN-IN")
print("=" * 70)
print("\nPlease click or open this URL to authenticate:\n")
print(auth_url)
print("\n" + "=" * 70)
print("Listening on http://localhost:8080/ for approval...")
sys.stdout.flush()

server = HTTPServer(("localhost", 8080), OAuthCallbackHandler)
while not auth_code:
    server.handle_request()

print(f"\n[+] Authorization code received! Exchanging for tokens...")

# Exchange code for token
token_url = "https://oauth2.googleapis.com/token"
token_payload = {
    "code": auth_code,
    "client_id": client_id,
    "client_secret": client_secret,
    "redirect_uri": redirect_uri,
    "grant_type": "authorization_code"
}
r = requests.post(token_url, data=token_payload)
token_res = r.json()

if "access_token" not in token_res:
    print(f"[-] Token exchange failed: {token_res}")
    sys.exit(1)

creds = Credentials(
    token=token_res["access_token"],
    refresh_token=token_res.get("refresh_token"),
    token_uri=token_url,
    client_id=client_id,
    client_secret=client_secret,
    scopes=SCOPES
)

# Save tokens locally
for p in [os.path.join(BACKEND_DIR, "token.pickle"), os.path.join(BASE_DIR, "token.pickle")]:
    with open(p, "wb") as f:
        pickle.dump(creds, f)
    print(f"[+] Saved token to: {p}")

r_user = requests.get('https://www.googleapis.com/drive/v3/about?fields=user', headers={'Authorization': f'Bearer {creds.token}'})
user = r_user.json().get('user', {})
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
