"""
Antideploy Deployment Script for SNIST ERP Attendance System
Follows specification from https://antideploy.com/agent.md
"""
import os
import sys
import json
import time
import argparse
import tarfile
import tempfile
import urllib.request
import urllib.error
from typing import Optional, Dict, Any, List

API_BASE = "https://antideploy.com/api/v1"
CONFIG_PATH = os.path.expanduser("~/.antideploy/config.json")
WORKSPACE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
APP_NAME = "att2"

EXCLUDE_DIRS = {
    ".git", ".agents", ".vscode", ".idea", "__pycache__", ".pytest_cache",
    ".coverage", "htmlcov", "node_modules", "scratch", ".wrangler",
    "graphify", "graphify-out", "certs", "keycloak", "bin", "fixtures"
}

EXCLUDE_EXTENSIONS = {
    ".tar.gz", ".zip", ".log", ".db", ".sqlite", ".sqlite3",
    "-wal", "-shm", ".pyc", ".pyo", ".pyd", ".bin"
}

EXCLUDE_FILES = {
    "cloudflared.exe",
    ".env",
    "backend/.env",
    "token.pickle",
    "qr_rgba.bin"
}

def is_excluded(rel_path: str) -> bool:
    normalized = rel_path.replace("\\", "/").strip("/")
    parts = normalized.split("/")

    for part in parts:
        if part in EXCLUDE_DIRS:
            return True

    # Check filename
    filename = parts[-1]
    if "cloudflared" in filename.lower():
        return True
    if filename in EXCLUDE_FILES:
        return True
    
    # Check extensions
    for ext in EXCLUDE_EXTENSIONS:
        if filename.endswith(ext):
            return True

    # Check specific paths
    if len(parts) == 1 and (filename.endswith(".png") or filename.endswith(".jpg")):
        return True
    if "backend/data/selfies" in normalized:
        return True
    if "frontend/node_modules" in normalized:
        return True

    return False


def create_archive(output_path: str) -> int:
    """Creates a gzipped tar archive of the workspace excluding forbidden / dev files."""
    file_count = 0
    with tarfile.open(output_path, "w:gz") as tar:
        for root, dirs, files in os.walk(WORKSPACE_DIR):
            dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]

            for file in files:
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, WORKSPACE_DIR)
                if is_excluded(rel_path):
                    continue

                file_size = os.path.getsize(full_path)
                if file_size > 28 * 1024 * 1024:
                    print(f"Skipping large file >28MB: {rel_path} ({file_size} bytes)", flush=True)
                    continue

                tar_name = rel_path.replace("\\", "/")
                tar.add(full_path, arcname=tar_name)
                file_count += 1

    return file_count


def get_stored_token() -> Optional[str]:
    """Reads bearer token from ~/.antideploy/config.json if it exists."""
    if not os.path.exists(CONFIG_PATH):
        return None
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data.get("token")
    except Exception as e:
        print(f"Failed to read existing config: {e}", flush=True)
        return None


def save_token(token: str) -> None:
    """Saves bearer token to ~/.antideploy/config.json with 0600 permissions."""
    os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump({"token": token}, f, indent=2)
    try:
        os.chmod(CONFIG_PATH, 0o600)
    except Exception:
        pass


def api_request(endpoint: str, method: str = "GET", headers: Optional[Dict[str, str]] = None, data: Optional[bytes] = None) -> Any:
    """Executes an HTTP request to the Antideploy API."""
    url = f"{API_BASE}{endpoint}" if endpoint.startswith("/") else endpoint
    req_headers = headers.copy() if headers else {}
    
    req = urllib.request.Request(url, data=data, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            content_type = resp.headers.get("Content-Type", "")
            resp_body = resp.read()
            if "application/json" in content_type:
                return json.loads(resp_body.decode("utf-8"))
            return resp_body
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(body)
            raise AntideployAPIError(e.code, parsed)
        except json.JSONDecodeError:
            raise AntideployAPIError(e.code, {"error": body})
    except urllib.error.URLError as e:
        raise ConnectionError(f"Network error connecting to Antideploy: {e.reason}")


class AntideployAPIError(Exception):
    def __init__(self, status_code: int, data: Dict[str, Any]):
        super().__init__(f"HTTP {status_code}: {data}")
        self.status_code = status_code
        self.data = data


def check_reachability() -> bool:
    """Checks unauthenticated reachability to https://antideploy.com/api/v1."""
    try:
        api_request("/", method="GET")
        return True
    except AntideployAPIError:
        return True
    except Exception as e:
        print(f"Reachability check failed: {e}", flush=True)
        return False


def authenticate(device_code: Optional[str] = None, user_code: Optional[str] = None, verification_uri_complete: Optional[str] = None) -> str:
    """Authenticates via stored token or initiates Device Code Flow."""
    token = get_stored_token()
    if token:
        try:
            api_request("/applications", headers={"Authorization": f"Bearer {token}"})
            print("[Auth] Existing token verified from ~/.antideploy/config.json.", flush=True)
            return token
        except AntideployAPIError as e:
            if e.status_code == 401:
                print("[Auth] Stored token has expired or is invalid. Re-authenticating...", flush=True)
            else:
                raise

    interval = 5
    expires_in = 900

    if not device_code or not user_code or not verification_uri_complete:
        print("[Auth] Initiating Device Code Authorization Flow...", flush=True)
        payload = json.dumps({"clientName": "Antigravity"}).encode("utf-8")
        resp = api_request(
            "/device/code",
            method="POST",
            headers={"Content-Type": "application/json"},
            data=payload
        )
        device_code = resp["deviceCode"]
        user_code = resp["userCode"]
        verification_uri_complete = resp.get("verificationUriComplete") or f"{resp.get('verificationUri')}?code={user_code}"
        interval = resp.get("interval", 5)
        expires_in = resp.get("expiresIn", 900)

    print("\n" + "=" * 65, flush=True)
    print("Open " + verification_uri_complete, flush=True)
    print(f"Confirm the code reads {user_code}, then click Approve.", flush=True)
    print("=" * 65 + "\n", flush=True)

    poll_payload = json.dumps({"deviceCode": device_code}).encode("utf-8")
    start_time = time.time()

    while time.time() - start_time < expires_in:
        time.sleep(interval)
        try:
            token_resp = api_request(
                "/device/token",
                method="POST",
                headers={"Content-Type": "application/json"},
                data=poll_payload
            )
            token = token_resp["token"]
            save_token(token)
            print("\n[Auth] Device successfully authorized! Token saved to ~/.antideploy/config.json.", flush=True)
            return token
        except AntideployAPIError as e:
            err = e.data.get("error") or e.data.get("code")
            if err == "authorization_pending":
                sys.stdout.write(".")
                sys.stdout.flush()
                continue
            elif err == "slow_down":
                interval += 5
                continue
            elif err == "access_denied":
                raise RuntimeError("Authorization refused by user. Cannot continue.")
            elif err == "expired_token":
                print("\n[Auth] Device code expired. Requesting a new code...", flush=True)
                return authenticate()
            else:
                raise RuntimeError(f"Unexpected authorization error: {e.data}")

    raise TimeoutError("Authorization timed out after 15 minutes.")


def get_or_create_application(token: str, app_name: str) -> Dict[str, Any]:
    """Retrieves existing application or provisions a new application."""
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    try:
        apps = api_request("/applications", headers=headers)
        app_list = apps if isinstance(apps, list) else (apps.get("applications") or apps.get("items") or [])
        for app in app_list:
            if app.get("name") == app_name:
                app_id = app.get("applicationId") or app.get("id")
                print(f"[App] Using existing application '{app_name}' (ID: {app_id}).", flush=True)
                return app
    except Exception as e:
        print(f"[App] Notice during application lookup: {e}", flush=True)

    print(f"[App] Creating application '{app_name}'...", flush=True)
    create_payload = json.dumps({"name": app_name}).encode("utf-8")
    try:
        new_app = api_request("/applications", method="POST", headers=headers, data=create_payload)
        app_id = new_app.get("applicationId") or new_app.get("id")
        print(f"[App] Created application '{app_name}' (ID: {app_id}).", flush=True)
        return new_app
    except AntideployAPIError as e:
        if e.status_code == 409:
            app_id = e.data.get("applicationId") or e.data.get("id")
            if app_id:
                print(f"[App] Using existing application '{app_name}' (ID: {app_id}) from 409 conflict resolution.", flush=True)
                return {"applicationId": app_id, "id": app_id, "name": app_name}
        raise


def encode_multipart_formdata(fields: Dict[str, str], files: Dict[str, tuple]) -> tuple[bytes, str]:
    """Encodes fields and files into multipart/form-data body and Content-Type header."""
    boundary = "----AntideployBoundary" + os.urandom(16).hex()
    body = bytearray()
    for name, value in fields.items():
        body.extend(f"--{boundary}\r\n".encode("utf-8"))
        body.extend(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"))
        body.extend(f"{value}\r\n".encode("utf-8"))
    for name, (filename, data, content_type) in files.items():
        body.extend(f"--{boundary}\r\n".encode("utf-8"))
        body.extend(f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'.encode("utf-8"))
        body.extend(f"Content-Type: {content_type}\r\n\r\n".encode("utf-8"))
        body.extend(data)
        body.extend(b"\r\n")
    body.extend(f"--{boundary}--\r\n".encode("utf-8"))
    content_type_header = f"multipart/form-data; boundary={boundary}"
    return bytes(body), content_type_header


def configure_secrets(token: str, app_id: str) -> None:
    """Configures project environment secrets."""
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    payload = {
        "env": {
            "ENVIRONMENT": "production",
            "JNTUH_ELIGIBLE_THRESHOLD": "75.0",
            "JNTUH_CONDONABLE_THRESHOLD": "65.0",
            "JNTUH_INCLUDE_APPROVED_ABSENCES": "True"
        }
    }
    try:
        api_request(
            f"/secrets?applicationId={app_id}",
            method="PUT",
            headers=headers,
            data=json.dumps(payload).encode("utf-8")
        )
        print("[Secrets] Configured base application environment secrets.", flush=True)
    except AntideployAPIError as e:
        print(f"[Secrets] Warning: Secrets update returned {e.status_code} ({e.data}). Continuing...", flush=True)


def deploy_archive(token: str, app_id: str, archive_path: str) -> str:
    """Pushes the tar.gz binary package to Antideploy via multipart/form-data."""
    archive_size_mb = os.path.getsize(archive_path) / (1024 * 1024)
    print(f"[Deploy] Uploading archive ({archive_size_mb:.2f} MB)...", flush=True)

    with open(archive_path, "rb") as f:
        archive_data = f.read()

    multipart_body, content_type_header = encode_multipart_formdata(
        fields={},
        files={"archive": ("archive.tar.gz", archive_data, "application/gzip")}
    )

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": content_type_header
    }

    resp = api_request(
        f"/deploy?applicationId={app_id}",
        method="POST",
        headers=headers,
        data=multipart_body
    )
    task_id = resp.get("taskId")
    if not task_id:
        raise RuntimeError(f"Deploy response missing taskId: {resp}")
    
    print(f"[Deploy] Deployment task created: {task_id}", flush=True)
    return task_id


def watch_deployment(token: str, task_id: str) -> Dict[str, Any]:
    """Polls deployment progress until terminal state (success/failed)."""
    headers = {"Authorization": f"Bearer {token}"}
    print("[Deploy] Watching deployment progress...", flush=True)
    last_status = None

    while True:
        try:
            status_data = api_request(f"/deployments/{task_id}", headers=headers)
        except AntideployAPIError as e:
            print(f"[Deploy] Status poll warning: {e}", flush=True)
            time.sleep(3)
            continue

        status = status_data.get("status")
        if status != last_status:
            print(f"[Deploy] Status: {status}", flush=True)
            last_status = status

        if status == "success":
            print("\n[Deploy] Deployment SUCCEEDED!", flush=True)
            return status_data
        elif status == "failed":
            error_msg = status_data.get("error", "No error details")
            log = status_data.get("log", "")
            print(f"\n[Deploy] Deployment FAILED: {error_msg}", flush=True)
            if log:
                print(f"Log excerpt:\n{log[-2000:]}", flush=True)
            raise RuntimeError(f"Deployment failed: {error_msg}")
        
        time.sleep(3)


def check_health(token: str, app_id: str) -> Dict[str, Any]:
    """Queries platform health status for the application."""
    headers = {"Authorization": f"Bearer {token}"}
    try:
        health = api_request(f"/health?applicationId={app_id}", headers=headers)
        print(f"[Health] Application health status: {health}", flush=True)
        return health
    except AntideployAPIError as e:
        print(f"[Health] Health check warning: {e}", flush=True)
        return {"status": "unknown"}


def main():
    parser = argparse.ArgumentParser(description="Antideploy deployment runner")
    parser.add_argument("--device-code", help="Existing device code")
    parser.add_argument("--user-code", help="Existing user code")
    parser.add_argument("--url", help="Existing verification URL")
    args = parser.parse_args()

    print("=== SNIST Attendance Antideploy Deployment System ===", flush=True)
    
    # Step 0: Check reachability
    print("Step 0: Checking reachability to https://antideploy.com/api/v1...", flush=True)
    if not check_reachability():
        print("This environment blocks outbound requests to antideploy.com. Add antideploy.com to the allowed domains.", flush=True)
        sys.exit(1)
    print("Step 0: Reachability confirmed.", flush=True)

    # Step 1 & 2: Authenticate
    token = authenticate(device_code=args.device_code, user_code=args.user_code, verification_uri_complete=args.url)

    # Step 3: Get or create application
    app = get_or_create_application(token, APP_NAME)
    app_id = app.get("applicationId") or app.get("id")

    # Step 4: Configure environment secrets
    configure_secrets(token, app_id)

    # Step 5: Package workspace
    tar_path = os.path.join(tempfile.gettempdir(), f"{APP_NAME}_deploy.tar.gz")
    print(f"[Package] Packaging workspace into {tar_path}...", flush=True)
    file_count = create_archive(tar_path)
    size_mb = os.path.getsize(tar_path) / (1024 * 1024)
    print(f"[Package] Packaged {file_count} files ({size_mb:.2f} MB).", flush=True)

    # Step 6: Deploy
    task_id = deploy_archive(token, app_id, tar_path)

    # Step 7: Watch progress
    deploy_info = watch_deployment(token, task_id)
    url = deploy_info.get("url") or app.get("url") or f"https://{APP_NAME}.antideploy.com"

    # Step 8: Health check
    time.sleep(2)
    check_health(token, app_id)

    print("\n" + "=" * 65, flush=True)
    print(f"DEPLOYMENT COMPLETE: {url}", flush=True)
    print("You can manage and inspect your application at https://antideploy.com/console", flush=True)
    print("You can revoke this token at any time at https://antideploy.com/tokens", flush=True)
    print("=" * 65 + "\n", flush=True)

    if os.path.exists(tar_path):
        try:
            os.remove(tar_path)
        except Exception:
            pass


if __name__ == "__main__":
    main()
