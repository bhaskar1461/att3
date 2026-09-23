"""
SNIST ERP — QR Payload & Optical Verification Script
Automated evidence verification: fetches live projector QR, decodes optical matrix with OpenCV,
and verifies payload format meets all Phase 12A requirements.
"""

import sys
import re
import io
import base64
import numpy as np
from PIL import Image
import cv2
import requests

BASE_URL = "https://whiteleos.cc.cd"
API_URL = f"{BASE_URL}/api/v1"

def run_verification():
    print("[1/5] Authenticating as faculty to access active broadcast...")
    session = requests.Session()
    # Trust self-signed cert in dev/test
    session.verify = False
    import urllib3
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

    login_resp = session.post(
        f"{API_URL}/auth/login",
        data={"username": "faculty_cse", "password": "faculty123"},
        headers={"Content-Type": "application/x-www-form-urlencoded"}
    )
    if login_resp.status_code != 200:
        # Fallback to faculty_cse1
        login_resp = session.post(
            f"{API_URL}/auth/login",
            data={"username": "faculty_cse1", "password": "faculty123"},
            headers={"Content-Type": "application/x-www-form-urlencoded"}
        )
    assert login_resp.status_code == 200, f"Faculty login failed: {login_resp.text}"
    token = login_resp.json()["access_token"]
    session.headers.update({"Authorization": f"Bearer {token}"})

    print("[2/5] Fetching or creating open attendance session...")
    assigned_resp = session.get(f"{API_URL}/teacher/assigned-classes")
    assert assigned_resp.status_code == 200, f"Failed to get assigned classes: {assigned_resp.text}"
    assigned = assigned_resp.json()
    assert len(assigned) > 0, "No assigned classes found for faculty"
    target_class = assigned[0]

    start_resp = session.post(
        f"{API_URL}/teacher/sessions/start",
        json={
            "subject_id": target_class["subject_id"],
            "section_id": target_class["section_id"],
            "period": "Period 1",
            "display_type": "projector"
        }
    )
    assert start_resp.status_code in [200, 201], f"Failed to start session: {start_resp.text}"
    session_info = start_resp.json()
    session_id = session_info["session_id"]
    print(f"      Active Session ID: {session_id}")

    print("[3/5] Requesting projector broadcast token & QR image...")
    bcast_resp = session.get(f"{API_URL}/teacher/sessions/{session_id}/broadcast-token")
    assert bcast_resp.status_code == 200, f"Broadcast token failed: {bcast_resp.text}"
    bcast_data = bcast_resp.json()

    qr_payload = bcast_data.get("qr_payload")
    launch_url = bcast_data.get("launch_url")
    launch_token = bcast_data.get("launch_token")
    qr_base64 = bcast_data.get("qr_base64")

    print(f"      qr_payload: {qr_payload}")
    print(f"      launch_url: {launch_url}")
    print(f"      launch_token: {launch_token[:20]}... (len={len(launch_token)})")

    print("[4/5] Optically decoding generated base64 QR image with OpenCV...")
    assert qr_base64 and qr_base64.startswith("data:image/png;base64,"), "Invalid qr_base64 format"
    b64_img_data = qr_base64.split(",")[1]
    img_bytes = base64.b64decode(b64_img_data)
    pil_img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    cv_img = np.array(pil_img)

    detector = cv2.QRCodeDetector()
    decoded_text, bbox, straight_qrcode = detector.detectAndDecode(cv_img)
    if not decoded_text:
        # Fallback to standard camera resolution (500x500)
        resized = cv2.resize(cv_img, (500, 500), interpolation=cv2.INTER_AREA)
        decoded_text, bbox, straight_qrcode = detector.detectAndDecode(resized)
    if not decoded_text:
        # Fallback to grayscale + contrast enhancement
        gray = cv2.cvtColor(cv_img, cv2.COLOR_RGB2GRAY)
        padded = cv2.copyMakeBorder(gray, 20, 20, 20, 20, cv2.BORDER_CONSTANT, value=255)
        decoded_text, bbox, straight_qrcode = detector.detectAndDecode(padded)

    print(f"      Decoded QR Payload: '{decoded_text}'")

    print("[5/5] Executing stringent security and format assertions...")
    # 1. Must NOT be the numeric phone number bug
    assert "178989921" != decoded_text, f"CRITICAL BUG PERSISTS: Decoded as 178989921!"
    assert not decoded_text.startswith("tel:"), f"BUG: Decoded as telephone URI!"
    assert not decoded_text.isdigit(), f"BUG: Decoded as pure number!"

    # 2. Must begin with https://
    assert decoded_text.startswith("https://"), f"FAIL: Expected https:// prefix, got '{decoded_text}'"

    # 3. Must match canonical HTTPS URL format
    url_pattern = r"^https:\/\/[a-zA-Z0-9.-]+\/a\/[A-Za-z0-9_-]{30,}$"
    assert re.match(url_pattern, decoded_text), f"FAIL: URL pattern mismatch for '{decoded_text}'"

    # 4. Decoded text must match returned launch_url
    assert decoded_text == launch_url, f"Decoded text '{decoded_text}' != launch_url '{launch_url}'"

    # 5. Must validate against public launch endpoint
    validate_resp = session.get(f"{API_URL}/launch/validate?token={launch_token}")
    assert validate_resp.status_code == 200, f"Public launch validate failed: {validate_resp.text}"
    val_data = validate_resp.json()
    assert val_data["valid"] is True
    assert val_data["session_id"] == session_id
    assert val_data["is_open"] is True

    print("\n=======================================================")
    print(" [PASSED] ALL QR PAYLOAD & OPTICAL ASSERTIONS SUCCEEDED")
    print(f" Final Decoded QR: {decoded_text}")
    print(" The iPhone camera will now detect this as an HTTPS URL!")
    print("=======================================================")

if __name__ == "__main__":
    run_verification()
