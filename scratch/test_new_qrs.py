import os
import sys
import re
import cv2
import numpy as np
import base64
import requests

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
html_path = os.path.join(BASE_DIR, "frontend", "dist", "qr10.html")
with open(html_path, "r", encoding="utf-8") as f:
    html = f.read()

qrs = re.findall(r'src="data:image/png;base64,([^"]+)"', html)
detector = cv2.QRCodeDetector()

# Login as teacher
res_login = requests.post('http://localhost:8080/api/v1/auth/login', json={
    'username': 'teacher1',
    'password': 'teacher123'
})
token = res_login.json()['access_token']
headers = {'Authorization': f'Bearer {token}'}

print(f"Testing scans for first 3 QR codes on Civil Session 12...")
for i in range(3):
    b64 = qrs[i]
    img = cv2.imdecode(np.frombuffer(base64.b64decode(b64), np.uint8), cv2.IMREAD_COLOR)
    payload, _, _ = detector.detectAndDecode(img)
    
    r = requests.post('http://localhost:8080/api/v1/attendance/scan', headers=headers, json={
        'session_id': 12,
        'qr_payload': payload,
        'period_count': 4
    })
    print(f"QR #{i+1}: status_code={r.status_code}, response={r.json()}")
