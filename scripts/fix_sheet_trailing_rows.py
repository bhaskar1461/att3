import os
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND_DIR = os.path.join(BASE_DIR, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app.services.gsheets_service import GoogleSheetsService
from app.core.config import settings

def clean_trailing_rows_and_restore():
    creds = settings.GOOGLE_CREDENTIALS_FILE or os.path.join(BACKEND_DIR, "credentials.json")
    sheet_id = "1CDeeivsdptGtgJpgK6XN9o6AKqy6HAIucv45D0Os6ZY"

    print(f"Connecting to Google Sheet {sheet_id}...")
    client = GoogleSheetsService._get_client(creds)
    sh = client.open_by_key(sheet_id)
    ws = sh.worksheet("CSE-CS")
    sheet_meta_id = ws.id

    vals = ws.get_all_values()
    print(f"Sheet dimensions: {len(vals)} rows x {max(len(r) for r in vals)} columns")

    # Find student boundary
    # Rows with index 56, 57, 58 (1-indexed 57, 58, 59) are empty or notes
    for r_i in range(56, len(vals)):
        roll = str(vals[r_i][1]).strip() if len(vals[r_i]) > 1 else ""
        sno = str(vals[r_i][0]).strip() if len(vals[r_i]) > 0 else ""
        # If not a student, wipe out all columns from F onwards
        if not (roll and not roll.startswith("*") and not sno.startswith("*")):
            for c_i in range(5, len(vals[r_i])):
                vals[r_i][c_i] = ""

    # Atomic update
    ws.update(values=vals, range_name="A1", value_input_option="USER_ENTERED")
    print("[+] Cleared stray values from rows 57, 58, 59+.")

    # Now run formatting restoration
    import subprocess
    subprocess.run([sys.executable, os.path.join(BASE_DIR, "scripts", "restore_gsheet_exact_colors.py")], check=True)
    print("[+] Fully cleaned trailing rows and restored exact college styling!")

if __name__ == "__main__":
    clean_trailing_rows_and_restore()
