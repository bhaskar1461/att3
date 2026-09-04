import os
import sys
import re
import cv2
import numpy as np
import base64

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND_DIR = os.path.join(BASE_DIR, "backend")
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app.core.security import decrypt_and_validate_qr_payload

detector = cv2.QRCodeDetector()
html_path = os.path.join(BASE_DIR, "frontend", "dist", "qr10.html")
with open(html_path, "r", encoding="utf-8") as f:
    html = f.read()

qrs = re.findall(r'src="data:image/png;base64,([^"]+)"', html)
print(f"Total QR codes found in qr10.html: {len(qrs)}")

for i, b64 in enumerate(qrs[:5]):
    img_data = base64.b64decode(b64)
    nparr = np.frombuffer(img_data, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    decoded_text, bbox, _ = detector.detectAndDecode(img)
    decrypted = decrypt_and_validate_qr_payload(decoded_text) if decoded_text else None
    print(f"QR #{i+1}: raw={decoded_text[:20]}... payload={decrypted}")
