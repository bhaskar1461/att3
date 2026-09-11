import os, sys
BASE_DIR = r"c:\Users\bhask\Desktop\attendnce_system"
sys.path.insert(0, os.path.join(BASE_DIR, "backend"))
from app.services.gsheets_service import GoogleSheetsService
from app.core.config import settings

creds = settings.GOOGLE_CREDENTIALS_FILE or os.path.join(BASE_DIR, "backend", "credentials.json")
client = GoogleSheetsService._get_client(creds)
for sid in ["1vzYlYhjQnutZfPLStHGw--CeF0_MjCWE", "1CDeeivsdptGtgJpgK6XN9o6AKqy6HAIucv45D0Os6ZY", "113b1RKUGQGHtoViEFJjgeGxD1VzxaGgSAn0Guxh_ni8"]:
    try:
        sh = client.open_by_key(sid)
        print(f"{sid}: Title='{sh.title}', Worksheets={[w.title for w in sh.worksheets()]}")
    except Exception as e:
        print(f"{sid}: FAILED: {e}")
