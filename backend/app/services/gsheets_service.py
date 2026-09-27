import os
import json
import logging
from typing import Dict, List, Any, Optional

logger = logging.getLogger(__name__)

class GoogleSheetsService:
    @staticmethod
    def _get_client(credentials_json: str):
        """Authorizes and returns a gspread client instance (supports Service Account & OAuth2)."""
        import gspread
        from google.oauth2.service_account import Credentials

        scopes = [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive'
        ]

        # Read JSON to determine if it's Service Account or OAuth Client ID
        if os.path.exists(credentials_json):
            with open(credentials_json, 'r', encoding='utf-8') as f:
                creds_data = json.load(f)
        else:
            creds_data = json.loads(credentials_json)

        # Check credential type
        if isinstance(creds_data, dict) and creds_data.get("type") == "service_account":
            if os.path.exists(credentials_json):
                creds = Credentials.from_service_account_file(credentials_json, scopes=scopes)
            else:
                creds = Credentials.from_service_account_info(creds_data, scopes=scopes)
            return gspread.authorize(creds)
        else:
            # OAuth 2.0 Client ID Credentials (User Login)
            from google_auth_oauthlib.flow import InstalledAppFlow
            from google.auth.transport.requests import Request
            from google.oauth2.credentials import Credentials as UserCredentials

            base_dir = os.path.dirname(credentials_json) if os.path.exists(credentials_json) else os.getcwd()
            token_json_path = os.path.join(base_dir, 'token.json')
            token_path = os.path.join(base_dir, 'token.pickle')

            creds = None
            if os.path.exists(token_json_path):
                try:
                    creds = UserCredentials.from_authorized_user_file(token_json_path, scopes=scopes)
                except Exception:
                    creds = None
            elif os.path.exists(token_path):
                try:
                    # Defensive migration of existing local token
                    import pickle  # nosec B403
                    with open(token_path, 'rb') as token_file:
                        creds = pickle.load(token_file)  # nosec B301
                    # Migrate to secure JSON format immediately
                    if creds and hasattr(creds, 'to_json'):
                        with open(token_json_path, 'w', encoding='utf-8') as jf:
                            jf.write(creds.to_json())
                except Exception:
                    creds = None

            if not creds or not creds.valid:
                if creds and creds.expired and creds.refresh_token:
                    try:
                        creds.refresh(Request())
                    except Exception as e:
                        logger.warning(f"Could not refresh token: {e}")
                        creds = None
                if not creds or not creds.valid:
                    is_web = isinstance(creds_data, dict) and "web" in creds_data
                    port = 8080 if is_web else 0
                    redirect_uri = "http://localhost:8080/" if is_web else None
                    if is_web:
                        flow = InstalledAppFlow.from_client_config(creds_data, scopes, redirect_uri=redirect_uri)
                    elif os.path.exists(credentials_json):
                        flow = InstalledAppFlow.from_client_secrets_file(credentials_json, scopes)
                    else:
                        flow = InstalledAppFlow.from_client_config(creds_data, scopes)
                    creds = flow.run_local_server(host="localhost", port=port)

                # Store credentials in secure JSON format (CWE-502 remediation)
                if creds and hasattr(creds, 'to_json'):
                    with open(token_json_path, 'w', encoding='utf-8') as token_file:
                        token_file.write(creds.to_json())
                else:
                    import pickle  # nosec B403
                    with open(token_path, 'wb') as token_file:
                        pickle.dump(creds, token_file)  # nosec B301

            return gspread.authorize(creds)

    @classmethod
    def _execute_with_retry(cls, operation, max_retries: int = 3, base_delay: float = 1.0, op_name: str = "GSheets API call"):
        """
        Executes a Google Sheets API operation with exponential backoff and jitter
        to mitigate rate-limiting (HTTP 429) and transient server errors (HTTP 500/503).
        Defensive handling ensures errors are logged with diagnostic context without crashing.
        """
        import time
        import random

        last_exc = None
        for attempt in range(max_retries):
            try:
                return operation()
            except Exception as e:
                last_exc = e
                err_str = str(e).lower()
                is_transient = any(code in err_str for code in [
                    "429", "500", "502", "503", "504",
                    "quota", "rate limit", "ratelimit",
                    "timeout", "timed out", "concurrent",
                    "resource exhausted", "temporary", "service unavailable"
                ])
                if attempt < max_retries - 1 and is_transient:
                    sleep_time = (base_delay * (2 ** attempt)) + random.uniform(0.1, 0.5)
                    logger.warning(f"[{op_name}] Transient API error (attempt {attempt + 1}/{max_retries}): {e}. Retrying in {sleep_time:.2f}s...")
                    time.sleep(sleep_time)
                else:
                    if not is_transient:
                        logger.error(f"[{op_name}] Permanent/non-transient API error: {e}")
                    else:
                        logger.error(f"[{op_name}] Exhausted all {max_retries} retries: {e}")
                    raise
        if last_exc:
            raise last_exc

    @classmethod
    def _open_spreadsheet(cls, client, spreadsheet_id: str):
        """Opens a Google Spreadsheet by ID with exponential retry."""
        return cls._execute_with_retry(
            lambda: client.open_by_key(spreadsheet_id),
            op_name=f"Open spreadsheet {spreadsheet_id}"
        )

    @classmethod
    def _read_worksheet_values(cls, worksheet):
        """Reads all values from worksheet with exponential retry."""
        return cls._execute_with_retry(
            lambda: worksheet.get_all_values(),
            op_name=f"Read worksheet {getattr(worksheet, 'title', 'unknown')}"
        )

    @classmethod
    def _update_worksheet_values(cls, worksheet, values, range_name="A1", value_input_option="USER_ENTERED"):
        """Updates values in worksheet with exponential retry."""
        return cls._execute_with_retry(
            lambda: worksheet.update(values=values, range_name=range_name, value_input_option=value_input_option),
            op_name=f"Update worksheet {getattr(worksheet, 'title', 'unknown')} ({range_name})"
        )

    @classmethod
    def _batch_update_spreadsheet(cls, spreadsheet, requests):
        """Applies batch formatting requests to spreadsheet with exponential retry."""
        return cls._execute_with_retry(
            lambda: spreadsheet.batch_update({"requests": requests}),
            op_name="Batch update spreadsheet"
        )

    @classmethod
    def create_and_populate_student_sheet(
        cls,
        credentials_json: str,
        students: List[Dict[str, Any]],
        title: str = "Student Roster - AI QR Attendance System",
        share_email: Optional[str] = None
    ) -> Dict[str, Any]:
        """Creates a new Google Sheet spreadsheet and populates it with formatted student roster."""
        try:
            client = cls._get_client(credentials_json)
            spreadsheet = cls._execute_with_retry(
                lambda: client.create(title),
                op_name=f"Create spreadsheet '{title}'"
            )
            
            if share_email == "anyone":
                try:
                    spreadsheet.share(None, role="reader", type="anyone")
                except Exception as share_err:
                    logger.warning(f"Could not set public sharing: {share_err}")
            elif share_email:
                try:
                    spreadsheet.share(share_email, role="writer", type="user")
                except Exception as share_err:
                    logger.warning(f"Could not share with {share_email}: {share_err}")

            return cls.format_and_populate_snist_sheet(
                credentials_json=credentials_json,
                spreadsheet_id=spreadsheet.id,
                students=students
            )
        except Exception as e:
            logger.error(f"Failed to create Google Sheet: {str(e)}")
            return {"success": False, "error": str(e)}

    @classmethod
    def sync_all_students(
        cls,
        credentials_json: str,
        spreadsheet_id: str,
        students: List[Dict[str, Any]],
        dept_name: str = "COMPUTER SCIENCE AND ENGINEERING",
        batch_info: str = "BATCH:2024-28  AY:2026-27"
    ) -> bool:
        """Alias method for syncing all student records and formatting sheet."""
        res = cls.format_and_populate_snist_sheet(
            credentials_json=credentials_json,
            spreadsheet_id=spreadsheet_id,
            students=students,
            dept_name=dept_name,
            batch_info=batch_info
        )
        return res.get("success", False)

    @classmethod
    def format_and_populate_snist_sheet(
        cls,
        credentials_json: str,
        spreadsheet_id: str,
        students: List[Dict[str, Any]],
        dept_name: str = "COMPUTER SCIENCE AND ENGINEERING",
        batch_info: str = "BATCH:2024-28  AY:2026-27"
    ) -> Dict[str, Any]:
        """
        Formats and populates the Google Sheet to match the exact SNIST Attendance Register layout:
          Row 1: SREENIDHI INSTITUTE OF SCIENCE & TECHNOLOGY
          Row 2: DEPARTMENT OF <DEPT_NAME>
          Row 3: CAREER ENHANCEMENT TRAINING (CET)
          Row 4: Name of the Training Agency: COIGN   |   FROM DATE: 15-06-2026   TO DATE: --
          Row 5: LIST OF B.TECH STUDENTS  - III - I  SEM     <BATCH_INFO>  | Date Columns (Col E+)
          Row 6: SNO | ROLL NO | NAME | Agency | 4 | 4 | 4 ...
          Row 7+: Student Rows (1, 21311A0501, Aarav Sharma, Regular, 4, A, ...)
        """
        if not credentials_json or not spreadsheet_id:
            return {"success": False, "error": "Credentials or Spreadsheet ID missing"}

        try:
            client = cls._get_client(credentials_json)
            spreadsheet = cls._open_spreadsheet(client, spreadsheet_id)
            
            try:
                worksheet = spreadsheet.worksheet("Attendance Register")
            except Exception:
                worksheet = spreadsheet.sheet1
                try:
                    worksheet.update_title("Attendance Register")
                except Exception:
                    pass

            # Read existing grid if present to preserve date columns and data
            existing_vals = cls._read_worksheet_values(worksheet)

            import re
            def is_valid_date(val: str) -> bool:
                s = str(val).strip()
                return bool(re.match(r'^\d{1,4}[/\.-]\d{1,2}[/\.-]\d{1,4}$', s))

            existing_dates = []
            existing_period_totals = []
            existing_marks = {}  # (roll_number, col_idx) -> val

            if len(existing_vals) >= 6:
                row5 = existing_vals[4]
                row6 = existing_vals[5]
                for col_idx in range(4, len(row5)):
                    date_val = str(row5[col_idx]).strip()
                    if date_val and is_valid_date(date_val):
                        period_tot = row6[col_idx] if col_idx < len(row6) else "4"
                        existing_dates.append(date_val)
                        existing_period_totals.append(period_tot)

                for r_idx in range(6, len(existing_vals)):
                    r_data = existing_vals[r_idx]
                    if len(r_data) >= 2:
                        roll = str(r_data[1]).strip().upper()
                        for col_idx in range(4, len(r_data)):
                            val = r_data[col_idx]
                            if val and col_idx < len(row5) and is_valid_date(row5[col_idx]):
                                d_idx = len(existing_dates) - 1
                                existing_marks[(roll, d_idx)] = val

            # Default date columns if none exist or none were valid
            if not existing_dates:
                existing_dates = ["15/6/26", "16/6/26", "17/6/26", "22/6/26", "23/6/26", "24/6/26", "29/6/26", "30/7/26"]
                existing_period_totals = ["4"] * len(existing_dates)

            worksheet.clear()

            rows = []
            # Row 1-4 Header block
            rows.append(["SREENIDHI INSTITUTE OF SCIENCE & TECHNOLOGY"])
            rows.append([f"DEPARTMENT OF {dept_name.upper()}"])
            rows.append(["CAREER ENHANCEMENT TRAINING (CET)"])
            rows.append(["Name of the Training Agency: COIGN   |   FROM DATE: 15-06-2026   TO DATE: --"])

            # Row 5: Title + Dates
            r5 = [f"LIST OF B.TECH STUDENTS  - III - I  SEM     {batch_info}", "", "", ""]
            r5.extend(existing_dates)
            rows.append(r5)

            # Row 6: Column Headers + Period totals under dates
            r6 = ["SNO", "ROLL NO", "NAME", "Agency"]
            r6.extend(existing_period_totals)
            rows.append(r6)

            # Row 7+: Students
            for idx, student in enumerate(students, 1):
                roll = str(student.get("roll_number", "")).strip().upper()
                name = student.get("name", "")
                agency = student.get("agency", "Regular")

                st_row = [idx, roll, name, agency]
                for d_idx in range(len(existing_dates)):
                    val = existing_marks.get((roll, d_idx), "A")  # Default 'A' (Absent)
                    st_row.append(val)
                rows.append(st_row)

            cls._update_worksheet_values(worksheet, rows, range_name="A1")

            num_rows = len(rows)
            num_cols = max(len(rows[5]), 14)  # Guarantee banner spans wide across sheet
            cls._apply_sheet_formatting(spreadsheet, worksheet, num_rows, num_cols)

            logger.info(f"Successfully formatted SNIST Attendance Register (ID: {spreadsheet_id})")
            return {
                "success": True,
                "spreadsheet_id": spreadsheet_id,
                "url": f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit",
                "student_count": len(students)
            }

        except Exception as e:
            logger.error(f"Failed to format SNIST sheet: {str(e)}")
            return {"success": False, "error": str(e)}

    @staticmethod
    def _col_to_letter(col_idx: int) -> str:
        """Converts 1-based column index to letter (1 -> A, 27 -> AA, 28 -> AB, etc.)"""
        result = ""
        while col_idx > 0:
            col_idx, remainder = divmod(col_idx - 1, 26)
            result = chr(65 + remainder) + result
        return result

    @staticmethod
    def _get_worksheet(
        spreadsheet, 
        section_name: Optional[str] = None, 
        roll_number: Optional[str] = None,
        rolls: Optional[List[str]] = None
    ):
        """
        Retrieves active worksheet, prioritizing:
        1. Exact or normalized match on section_name (e.g. 'IT-A' -> 'IT-A LATEST', 'IT-B' -> 'IT-B LATEST')
        2. Worksheet containing roll_number or any roll in rolls in Col B (index 1)
        3. Prioritized defaults ('CSE-CS', 'Attendance Register')
        4. Fallback to sheet1
        """
        if section_name:
            import re
            sec_raw = str(section_name).strip().upper()
            match = re.search(r'\b([A-Z0-9]+)[-_ ]*([A-Z0-9]+)\b', sec_raw)
            if match:
                canonical_sec = f"{match.group(1)}-{match.group(2)}"
                norm_sec = f"{match.group(1)}{match.group(2)}"
            else:
                canonical_sec = sec_raw
                norm_sec = sec_raw.replace(" ", "").replace("-", "")

            # 1. Exact match on title or normalized title
            for ws in spreadsheet.worksheets():
                ws_norm = ws.title.strip().upper().replace(" ", "").replace("-", "")
                if ws_norm == norm_sec:
                    return ws

            # 2. Check if canonical_sec is in ws.title (e.g. 'IT-B' in 'IT-B LATEST')
            for ws in spreadsheet.worksheets():
                ws_title = ws.title.strip().upper()
                if canonical_sec in ws_title or norm_sec in ws_title.replace(" ", "").replace("-", ""):
                    return ws

        target_rolls = set()
        if roll_number:
            target_rolls.add(str(roll_number).strip().upper())
        if rolls:
            for r in rolls:
                if r:
                    target_rolls.add(str(r).strip().upper())

        if target_rolls:
            for ws in spreadsheet.worksheets():
                try:
                    ws_rolls = {str(r).strip().upper() for r in ws.col_values(2)}
                    if target_rolls & ws_rolls:
                        return ws
                except Exception:
                    continue

        for title in ["CSE-CS", "Attendance Register"]:
            try:
                return spreadsheet.worksheet(title)
            except Exception:
                pass
        return spreadsheet.sheet1

    @classmethod
    def _apply_sheet_formatting(cls, spreadsheet, worksheet, num_rows: int, num_cols: int):
        """Applies exact college template colors, column widths, text alignments, and border styles."""
        try:
            sheet_id = getattr(worksheet, 'id', 0)
            if isinstance(sheet_id, str) and sheet_id.isdigit():
                sheet_id = int(sheet_id)
            elif not isinstance(sheet_id, int):
                sheet_id = 0

            target_cols = max(num_cols, 14)

            # Exact college template colors
            c_row1 = {"red": 198/255.0, "green": 217/255.0, "blue": 240/255.0}  # #C6D9F0 Soft pastel blue
            c_row2 = {"red": 253/255.0, "green": 233/255.0, "blue": 217/255.0}  # #FDE9D9 Soft peach
            c_row3 = {"red": 218/255.0, "green": 238/255.0, "blue": 243/255.0}  # #DAEEF3 Soft cyan
            c_row4 = {"red": 184/255.0, "green": 204/255.0, "blue": 228/255.0}  # #B8CCE4 Soft blue
            c_row5_left = {"red": 253/255.0, "green": 233/255.0, "blue": 217/255.0}  # #FDE9D9 Soft peach
            c_row5_dates = {"red": 164/255.0, "green": 194/255.0, "blue": 244/255.0}  # #A4C2F4 Soft periwinkle/blue
            c_yellow = {"red": 1.0, "green": 1.0, "blue": 0.0}  # #FFFF00 Bright yellow
            c_sec_blue = {"red": 164/255.0, "green": 194/255.0, "blue": 244/255.0}  # #A4C2F4 Soft blue
            c_soft_green = {"red": 182/255.0, "green": 215/255.0, "blue": 168/255.0}  # #B6D7A8 Soft green
            c_white = {"red": 1.0, "green": 1.0, "blue": 1.0}
            c_black = {"red": 0.0, "green": 0.0, "blue": 0.0}

            requests = [
                # 1. Unmerge rows 0-5 across full width to clear any frozen-column-crossing merges
                {
                    "unmergeCells": {
                        "range": {"sheetId": sheet_id, "startRowIndex": 0, "endRowIndex": 5, "startColumnIndex": 0, "endColumnIndex": target_cols}
                    }
                },
                # 2. Merge A1:E1, A2:E2, A3:E3, A4:E4, A5:E5 strictly within frozen boundary (0 to 5)
                {"mergeCells": {"range": {"sheetId": sheet_id, "startRowIndex": 0, "endRowIndex": 1, "startColumnIndex": 0, "endColumnIndex": 5}, "mergeType": "MERGE_ALL"}},
                {"mergeCells": {"range": {"sheetId": sheet_id, "startRowIndex": 1, "endRowIndex": 2, "startColumnIndex": 0, "endColumnIndex": 5}, "mergeType": "MERGE_ALL"}},
                {"mergeCells": {"range": {"sheetId": sheet_id, "startRowIndex": 2, "endRowIndex": 3, "startColumnIndex": 0, "endColumnIndex": 5}, "mergeType": "MERGE_ALL"}},
                {"mergeCells": {"range": {"sheetId": sheet_id, "startRowIndex": 3, "endRowIndex": 4, "startColumnIndex": 0, "endColumnIndex": 5}, "mergeType": "MERGE_ALL"}},
                {"mergeCells": {"range": {"sheetId": sheet_id, "startRowIndex": 4, "endRowIndex": 5, "startColumnIndex": 0, "endColumnIndex": 5}, "mergeType": "MERGE_ALL"}},

                # 3. Column Widths
                {"updateDimensionProperties": {"range": {"sheetId": sheet_id, "dimension": "COLUMNS", "startIndex": 0, "endIndex": 1}, "properties": {"pixelSize": 55}, "fields": "pixelSize"}},
                {"updateDimensionProperties": {"range": {"sheetId": sheet_id, "dimension": "COLUMNS", "startIndex": 1, "endIndex": 2}, "properties": {"pixelSize": 110}, "fields": "pixelSize"}},
                {"updateDimensionProperties": {"range": {"sheetId": sheet_id, "dimension": "COLUMNS", "startIndex": 2, "endIndex": 3}, "properties": {"pixelSize": 300}, "fields": "pixelSize"}},
                {"updateDimensionProperties": {"range": {"sheetId": sheet_id, "dimension": "COLUMNS", "startIndex": 3, "endIndex": 4}, "properties": {"pixelSize": 90}, "fields": "pixelSize"}},
                {"updateDimensionProperties": {"range": {"sheetId": sheet_id, "dimension": "COLUMNS", "startIndex": 4, "endIndex": 5}, "properties": {"pixelSize": 90}, "fields": "pixelSize"}},
                {"updateDimensionProperties": {"range": {"sheetId": sheet_id, "dimension": "COLUMNS", "startIndex": 5, "endIndex": target_cols}, "properties": {"pixelSize": 75}, "fields": "pixelSize"}},

                # 4. Row 1: Merged A1:E1 Soft Pastel Blue
                {
                    "repeatCell": {
                        "range": {"sheetId": sheet_id, "startRowIndex": 0, "endRowIndex": 1, "startColumnIndex": 0, "endColumnIndex": 5},
                        "cell": {
                            "userEnteredFormat": {
                                "backgroundColor": c_row1,
                                "textFormat": {"bold": True, "fontSize": 12, "foregroundColor": c_black, "fontFamily": "Times New Roman"},
                                "horizontalAlignment": "CENTER", "verticalAlignment": "MIDDLE"
                            }
                        },
                        "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)"
                    }
                },
                {"repeatCell": {"range": {"sheetId": sheet_id, "startRowIndex": 0, "endRowIndex": 1, "startColumnIndex": 5, "endColumnIndex": target_cols}, "cell": {"userEnteredFormat": {"backgroundColor": c_white}}, "fields": "userEnteredFormat(backgroundColor)"}},

                # Row 2: Merged A2:E2 Soft Peach
                {
                    "repeatCell": {
                        "range": {"sheetId": sheet_id, "startRowIndex": 1, "endRowIndex": 2, "startColumnIndex": 0, "endColumnIndex": 5},
                        "cell": {
                            "userEnteredFormat": {
                                "backgroundColor": c_row2,
                                "textFormat": {"bold": True, "fontSize": 11, "foregroundColor": c_black, "fontFamily": "Calibri"},
                                "horizontalAlignment": "CENTER", "verticalAlignment": "MIDDLE"
                            }
                        },
                        "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)"
                    }
                },
                {"repeatCell": {"range": {"sheetId": sheet_id, "startRowIndex": 1, "endRowIndex": 2, "startColumnIndex": 5, "endColumnIndex": target_cols}, "cell": {"userEnteredFormat": {"backgroundColor": c_white}}, "fields": "userEnteredFormat(backgroundColor)"}},

                # Row 3: Merged A3:E3 Soft Cyan
                {
                    "repeatCell": {
                        "range": {"sheetId": sheet_id, "startRowIndex": 2, "endRowIndex": 3, "startColumnIndex": 0, "endColumnIndex": 5},
                        "cell": {
                            "userEnteredFormat": {
                                "backgroundColor": c_row3,
                                "textFormat": {"bold": True, "fontSize": 11, "foregroundColor": c_black, "fontFamily": "Calibri"},
                                "horizontalAlignment": "CENTER", "verticalAlignment": "MIDDLE"
                            }
                        },
                        "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)"
                    }
                },
                {"repeatCell": {"range": {"sheetId": sheet_id, "startRowIndex": 2, "endRowIndex": 3, "startColumnIndex": 5, "endColumnIndex": target_cols}, "cell": {"userEnteredFormat": {"backgroundColor": c_white}}, "fields": "userEnteredFormat(backgroundColor)"}},

                # Row 4: Merged A4:E4 Soft Blue
                {
                    "repeatCell": {
                        "range": {"sheetId": sheet_id, "startRowIndex": 3, "endRowIndex": 4, "startColumnIndex": 0, "endColumnIndex": 5},
                        "cell": {
                            "userEnteredFormat": {
                                "backgroundColor": c_row4,
                                "textFormat": {"bold": True, "fontSize": 10, "foregroundColor": c_black, "fontFamily": "Calibri"},
                                "horizontalAlignment": "CENTER", "verticalAlignment": "MIDDLE", "wrapStrategy": "WRAP"
                            }
                        },
                        "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)"
                    }
                },
                # Row 4 Conducted periods (Col F onwards): white background, centered bold text
                {
                    "repeatCell": {
                        "range": {"sheetId": sheet_id, "startRowIndex": 3, "endRowIndex": 4, "startColumnIndex": 5, "endColumnIndex": target_cols},
                        "cell": {
                            "userEnteredFormat": {
                                "backgroundColor": c_white,
                                "textFormat": {"bold": True, "fontSize": 10, "foregroundColor": c_black, "fontFamily": "Calibri"},
                                "horizontalAlignment": "CENTER", "verticalAlignment": "MIDDLE"
                            }
                        },
                        "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)"
                    }
                },

                # Row 5: Merged A5:E5 Soft Peach
                {
                    "repeatCell": {
                        "range": {"sheetId": sheet_id, "startRowIndex": 4, "endRowIndex": 5, "startColumnIndex": 0, "endColumnIndex": 5},
                        "cell": {
                            "userEnteredFormat": {
                                "backgroundColor": c_row5_left,
                                "textFormat": {"bold": True, "fontSize": 10, "foregroundColor": c_black, "fontFamily": "Calibri"},
                                "horizontalAlignment": "CENTER", "verticalAlignment": "MIDDLE"
                            }
                        },
                        "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)"
                    }
                },
                # Row 5 (Col F onwards): Soft periwinkle/blue
                {
                    "repeatCell": {
                        "range": {"sheetId": sheet_id, "startRowIndex": 4, "endRowIndex": 5, "startColumnIndex": 5, "endColumnIndex": target_cols},
                        "cell": {
                            "userEnteredFormat": {
                                "backgroundColor": c_row5_dates,
                                "textFormat": {"bold": True, "fontSize": 10, "foregroundColor": c_black}
                            }
                        },
                        "fields": "userEnteredFormat(backgroundColor,textFormat)"
                    }
                },

                # Row 6: SNO, ROLL NO, NAME, GENDER -> Bright Yellow (#FFFF00)
                {
                    "repeatCell": {
                        "range": {"sheetId": sheet_id, "startRowIndex": 5, "endRowIndex": 6, "startColumnIndex": 0, "endColumnIndex": 4},
                        "cell": {
                            "userEnteredFormat": {
                                "backgroundColor": c_yellow,
                                "textFormat": {"bold": True, "fontSize": 10, "foregroundColor": c_black, "fontFamily": "Calibri"},
                                "horizontalAlignment": "CENTER", "verticalAlignment": "MIDDLE"
                            }
                        },
                        "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)"
                    }
                },
                # Row 6: SECTION -> Soft Blue (#A4C2F4)
                {
                    "repeatCell": {
                        "range": {"sheetId": sheet_id, "startRowIndex": 5, "endRowIndex": 6, "startColumnIndex": 4, "endColumnIndex": 5},
                        "cell": {
                            "userEnteredFormat": {
                                "backgroundColor": c_sec_blue,
                                "textFormat": {"bold": True, "fontSize": 10, "foregroundColor": c_black, "fontFamily": "Calibri"},
                                "horizontalAlignment": "CENTER", "verticalAlignment": "MIDDLE"
                            }
                        },
                        "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)"
                    }
                },
                # Row 6: Date headers (Col F to target_cols - 1) -> Soft pastel green
                {
                    "repeatCell": {
                        "range": {"sheetId": sheet_id, "startRowIndex": 5, "endRowIndex": 6, "startColumnIndex": 5, "endColumnIndex": max(target_cols - 1, 5)},
                        "cell": {
                            "userEnteredFormat": {
                                "backgroundColor": c_soft_green,
                                "textFormat": {"bold": True, "fontSize": 10, "foregroundColor": c_black, "fontFamily": "Calibri"},
                                "horizontalAlignment": "CENTER", "verticalAlignment": "MIDDLE"
                            }
                        },
                        "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)"
                    }
                },
                # Row 6: Total column (last col) -> Bright Yellow (#FFFF00)
                {
                    "repeatCell": {
                        "range": {"sheetId": sheet_id, "startRowIndex": 5, "endRowIndex": 6, "startColumnIndex": max(target_cols - 1, 5), "endColumnIndex": target_cols},
                        "cell": {
                            "userEnteredFormat": {
                                "backgroundColor": c_yellow,
                                "textFormat": {"bold": True, "fontSize": 10, "foregroundColor": c_black, "fontFamily": "Calibri"},
                                "horizontalAlignment": "CENTER", "verticalAlignment": "MIDDLE"
                            }
                        },
                        "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)"
                    }
                },

                # Rows 7+: Data Rows
                # Col A (SNO): white, centered
                {"repeatCell": {"range": {"sheetId": sheet_id, "startRowIndex": 6, "endRowIndex": num_rows, "startColumnIndex": 0, "endColumnIndex": 1}, "cell": {"userEnteredFormat": {"backgroundColor": c_white, "textFormat": {"fontSize": 10, "foregroundColor": c_black}, "horizontalAlignment": "CENTER", "verticalAlignment": "MIDDLE"}}, "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)"}},
                # Col B (ROLL NO): white, centered
                {"repeatCell": {"range": {"sheetId": sheet_id, "startRowIndex": 6, "endRowIndex": num_rows, "startColumnIndex": 1, "endColumnIndex": 2}, "cell": {"userEnteredFormat": {"backgroundColor": c_white, "textFormat": {"fontSize": 10, "foregroundColor": c_black}, "horizontalAlignment": "CENTER", "verticalAlignment": "MIDDLE"}}, "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)"}},
                # Col C (NAME): white, LEFT-ALIGNED
                {"repeatCell": {"range": {"sheetId": sheet_id, "startRowIndex": 6, "endRowIndex": num_rows, "startColumnIndex": 2, "endColumnIndex": 3}, "cell": {"userEnteredFormat": {"backgroundColor": c_white, "textFormat": {"fontSize": 10, "foregroundColor": c_black}, "horizontalAlignment": "LEFT", "verticalAlignment": "MIDDLE"}}, "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)"}},
                # Col D (GENDER): white, centered
                {"repeatCell": {"range": {"sheetId": sheet_id, "startRowIndex": 6, "endRowIndex": num_rows, "startColumnIndex": 3, "endColumnIndex": 4}, "cell": {"userEnteredFormat": {"backgroundColor": c_white, "textFormat": {"fontSize": 10, "foregroundColor": c_black}, "horizontalAlignment": "CENTER", "verticalAlignment": "MIDDLE"}}, "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)"}},
                # Col E (SECTION): Soft Blue (#A4C2F4), centered
                {"repeatCell": {"range": {"sheetId": sheet_id, "startRowIndex": 6, "endRowIndex": num_rows, "startColumnIndex": 4, "endColumnIndex": 5}, "cell": {"userEnteredFormat": {"backgroundColor": c_sec_blue, "textFormat": {"fontSize": 10, "foregroundColor": c_black}, "horizontalAlignment": "CENTER", "verticalAlignment": "MIDDLE"}}, "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)"}},
                # Col F+ (Dates & Total): white, centered
                {"repeatCell": {"range": {"sheetId": sheet_id, "startRowIndex": 6, "endRowIndex": num_rows, "startColumnIndex": 5, "endColumnIndex": target_cols}, "cell": {"userEnteredFormat": {"backgroundColor": c_white, "textFormat": {"fontSize": 10, "foregroundColor": c_black}, "horizontalAlignment": "CENTER", "verticalAlignment": "MIDDLE"}}, "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)"}},

                # Add Grid Borders around all cells
                {
                    "updateBorders": {
                        "range": {"sheetId": sheet_id, "startRowIndex": 0, "endRowIndex": num_rows, "startColumnIndex": 0, "endColumnIndex": target_cols},
                        "top": {"style": "SOLID", "width": 1, "color": {"red": 0.4, "green": 0.4, "blue": 0.4}},
                        "bottom": {"style": "SOLID", "width": 1, "color": {"red": 0.4, "green": 0.4, "blue": 0.4}},
                        "left": {"style": "SOLID", "width": 1, "color": {"red": 0.4, "green": 0.4, "blue": 0.4}},
                        "right": {"style": "SOLID", "width": 1, "color": {"red": 0.4, "green": 0.4, "blue": 0.4}},
                        "innerHorizontal": {"style": "SOLID", "width": 1, "color": {"red": 0.7, "green": 0.7, "blue": 0.7}},
                        "innerVertical": {"style": "SOLID", "width": 1, "color": {"red": 0.7, "green": 0.7, "blue": 0.7}}
                    }
                }
            ]

            cls._batch_update_spreadsheet(spreadsheet, requests)
        except Exception as fmt_err:
            logger.warning(f"Batch formatting warning: {fmt_err}")

    @classmethod
    def _apply_borders(cls, spreadsheet, worksheet, start_row: int, end_row: int, start_col: int, end_col: int):
        """Applies crisp solid 1px dark borders to every cell in the specified range."""
        try:
            sheet_id = getattr(worksheet, 'id', 0)
            if isinstance(sheet_id, str) and sheet_id.isdigit():
                sheet_id = int(sheet_id)
            elif not isinstance(sheet_id, int):
                sheet_id = 0

            req = {
                "updateBorders": {
                    "range": {
                        "sheetId": sheet_id,
                        "startRowIndex": max(0, start_row),
                        "endRowIndex": end_row,
                        "startColumnIndex": max(0, start_col),
                        "endColumnIndex": end_col
                    },
                    "top": {"style": "SOLID", "width": 1, "color": {"red": 0.0, "green": 0.0, "blue": 0.0}},
                    "bottom": {"style": "SOLID", "width": 1, "color": {"red": 0.0, "green": 0.0, "blue": 0.0}},
                    "left": {"style": "SOLID", "width": 1, "color": {"red": 0.0, "green": 0.0, "blue": 0.0}},
                    "right": {"style": "SOLID", "width": 1, "color": {"red": 0.0, "green": 0.0, "blue": 0.0}},
                    "innerHorizontal": {"style": "SOLID", "width": 1, "color": {"red": 0.0, "green": 0.0, "blue": 0.0}},
                    "innerVertical": {"style": "SOLID", "width": 1, "color": {"red": 0.0, "green": 0.0, "blue": 0.0}}
                }
            }
            cls._batch_update_spreadsheet(spreadsheet, [req])
        except Exception as e:
            logger.warning(f"Could not apply borders to worksheet: {e}")

    @classmethod
    def record_attendance_in_gsheet(
        cls,
        credentials_json: str,
        spreadsheet_id: str,
        roll_number: str,
        date_str: str,
        status_code: str = "4",
        period_total: str = "4",
        section_name: Optional[str] = None
    ) -> bool:
        """
        Records attendance for a roll number under date_str in real-time.
        Matches SNIST layout:
          Header Row            = Dynamically located by 'ROLL'
          Total / Cumulative    = Positioned AFTER all date columns
          Student rows          = Follow header row
          Roll No col           = Col B (index 1)
          Status code           = "1"-"8" (Present) or "A" (Absent)
        """
        if not credentials_json or not spreadsheet_id:
            logger.info("Google Sheets sync skipped: Credentials or Spreadsheet ID missing.")
            return False

        try:
            from datetime import datetime

            def norm_d(d):
                s = str(d).strip()
                if not s:
                    return ""
                for fmt in ["%d/%m/%Y", "%d/%m/%y", "%d-%m-%Y", "%d-%m-%y", "%Y-%m-%d"]:
                    try:
                        dt = datetime.strptime(s, fmt)
                        return f"{dt.day}/{dt.month}/{str(dt.year)[-2:]}"
                    except ValueError:
                        continue
                parts = s.replace("-", "/").split("/")
                if len(parts) == 3:
                    day = str(int(parts[0])) if parts[0].isdigit() else parts[0]
                    month = str(int(parts[1])) if parts[1].isdigit() else parts[1]
                    year = parts[2][-2:] if len(parts[2]) == 4 else parts[2]
                    return f"{day}/{month}/{year}"
                return s

            # Sanitize and clamp status code: "A" for Absent, integer 1-4 for Present (session max is 4 periods)
            clean_status = str(status_code).strip().upper()
            if clean_status in ["A", "ABSENT"]:
                status_code_clean = "A"
            else:
                try:
                    status_code_clean = str(max(1, min(4, int(clean_status))))
                except Exception:
                    status_code_clean = "4"

            try:
                period_total_clean = str(max(1, min(4, int(period_total))))
            except Exception:
                period_total_clean = "4"

            # Format display date as D/M/YY (e.g. 15/9/26) to match the existing sheet register headers
            target_date_norm = norm_d(date_str)
            display_date = target_date_norm

            client = cls._get_client(credentials_json)
            spreadsheet = cls._open_spreadsheet(client, spreadsheet_id)
            worksheet = cls._get_worksheet(spreadsheet, section_name=section_name, roll_number=roll_number)

            vals = cls._read_worksheet_values(worksheet)
            if len(vals) < 6:
                logger.warning("Sheet does not have SNIST layout headers yet.")
                return False

            target_roll = str(roll_number).strip().upper()

            # Dynamically locate Header Row containing ROLL NO
            header_r_0idx = -1
            roll_col_0idx = 1
            for r_i, r_data in enumerate(vals[:10]):
                for c_i, cell in enumerate(r_data):
                    if "ROLL" in str(cell).upper():
                        header_r_0idx = r_i
                        roll_col_0idx = c_i
                        break
                if header_r_0idx != -1:
                    break

            if header_r_0idx == -1:
                header_r_0idx = 5

            headers = vals[header_r_0idx]
            student_start_r_0idx = header_r_0idx + 1

            # Locate Total / Cumulative column index by searching all rows up to header row
            total_c_0idx = -1
            for c_idx in range(roll_col_0idx + 1, len(headers)):
                for r_check in range(header_r_0idx + 1):
                    if c_idx < len(vals[r_check]):
                        val_str = str(vals[r_check][c_idx]).strip().lower()
                        if "total" in val_str or "cumulative" in val_str:
                            total_c_0idx = c_idx
                            break
                if total_c_0idx != -1:
                    break

            # Locate first date column index
            first_date_c_0idx = -1
            for c_idx in range(roll_col_0idx + 1, len(headers)):
                if c_idx == total_c_0idx:
                    continue
                for r_check in range(header_r_0idx + 1):
                    if c_idx < len(vals[r_check]):
                        d_str = str(vals[r_check][c_idx]).strip()
                        if ("/" in d_str or "-" in d_str) and "total" not in d_str.lower() and "cumulative" not in d_str.lower():
                            first_date_c_0idx = c_idx
                            break
                if first_date_c_0idx != -1:
                    break
            if first_date_c_0idx == -1:
                first_date_c_0idx = 6

            # Locate target date column across all header rows
            date_col_0idx = -1
            for c_idx in range(roll_col_0idx + 1, len(headers)):
                if c_idx == total_c_0idx:
                    continue
                for r_check in range(header_r_0idx + 1):
                    if c_idx < len(vals[r_check]):
                        d_val = str(vals[r_check][c_idx]).strip()
                        if d_val and norm_d(d_val) == target_date_norm:
                            date_col_0idx = c_idx
                            break
                if date_col_0idx != -1:
                    break

            # If date column not found, insert a new date column BEFORE Cumulative Attendance (or append at end)
            if date_col_0idx == -1:
                if total_c_0idx != -1:
                    date_col_0idx = total_c_0idx
                    for r_i in range(len(vals)):
                        vals[r_i].insert(date_col_0idx, "")
                    total_c_0idx += 1
                else:
                    date_col_0idx = len(headers)
                    for r_i in range(len(vals)):
                        vals[r_i].append("")

                if header_r_0idx > 0 and len(vals) > header_r_0idx - 1:
                    vals[header_r_0idx - 1][date_col_0idx] = ""
                vals[header_r_0idx][date_col_0idx] = display_date

                for r_i in range(student_start_r_0idx, len(vals)):
                    roll = str(vals[r_i][roll_col_0idx]).strip() if len(vals[r_i]) > roll_col_0idx else ""
                    sno = str(vals[r_i][0]).strip() if len(vals[r_i]) > 0 else ""
                    if roll and not roll.startswith("*") and not sno.startswith("*"):
                        vals[r_i][date_col_0idx] = "A"
                    else:
                        vals[r_i][date_col_0idx] = ""

            # Set attendance for the student
            student_found = False
            for r_idx in range(student_start_r_0idx, len(vals)):
                while len(vals[r_idx]) <= date_col_0idx:
                    vals[r_idx].append("")
                row_roll = str(vals[r_idx][roll_col_0idx]).strip().upper() if len(vals[r_idx]) > roll_col_0idx else ""
                if row_roll == target_roll:
                    vals[r_idx][date_col_0idx] = status_code_clean
                    student_found = True
                    break

            # If Total / Cumulative column is missing, create it AFTER all date columns
            if total_c_0idx == -1:
                total_c_0idx = max(len(r) for r in vals)
                for r_i in range(len(vals)):
                    while len(vals[r_i]) <= total_c_0idx:
                        vals[r_i].append("")
                if header_r_0idx > 0 and len(vals) > header_r_0idx - 1:
                    vals[header_r_0idx - 1][total_c_0idx] = "Cumulative Attendance"
                vals[header_r_0idx][total_c_0idx] = "Cumulative Attendance"

            # Update Total / Cumulative column formulas
            if total_c_0idx != -1:
                if first_date_c_0idx >= total_c_0idx:
                    first_date_c_0idx = max(4, total_c_0idx - 1)
                first_col_letter = cls._col_to_letter(first_date_c_0idx + 1)
                last_col_letter = cls._col_to_letter(total_c_0idx)
                for r_i in range(student_start_r_0idx, len(vals)):
                    row_num = r_i + 1
                    while len(vals[r_i]) <= total_c_0idx:
                        vals[r_i].append("")
                    roll = str(vals[r_i][roll_col_0idx]).strip() if len(vals[r_i]) > roll_col_0idx else ""
                    sno = str(vals[r_i][0]).strip() if len(vals[r_i]) > 0 else ""
                    if roll and not roll.startswith("*") and not sno.startswith("*"):
                        vals[r_i][total_c_0idx] = f"=SUM({first_col_letter}{row_num}:{last_col_letter}{row_num})"
                    else:
                        vals[r_i][total_c_0idx] = ""

            # Single atomic update with USER_ENTERED to evaluate formulas
            cls._update_worksheet_values(worksheet, vals, range_name="A1", value_input_option="USER_ENTERED")

            # Apply full borders to the sheet
            max_c = max(len(r) for r in vals) if vals else 37
            cls._apply_borders(spreadsheet, worksheet, start_row=max(0, header_r_0idx - 2), end_row=len(vals), start_col=0, end_col=max_c)

            if student_found:
                logger.info(f"[GSheets Sync] Roll {target_roll} on {date_str} marked '{status_code_clean}' in date col {date_col_0idx+1}, Total column updated, borders applied.")
                return True
            else:
                logger.warning(f"[GSheets Sync] Student Roll {target_roll} not found in sheet rows.")
                return False

        except Exception as e:
            logger.error(f"Failed to record attendance in Google Sheet: {str(e)}", exc_info=True)
            return False

    @classmethod
    def mark_all_absent(
        cls,
        credentials_json: str,
        spreadsheet_id: str,
        section_name: Optional[str] = None
    ) -> bool:
        """
        Resets all student attendance entries to "A" (Absent) across all date columns,
        preserving the Total column and dynamically updating formulas.
        Uses dynamic header lookup (FIX 6).
        """
        if not credentials_json or not spreadsheet_id:
            return False

        try:
            client = cls._get_client(credentials_json)
            spreadsheet = cls._open_spreadsheet(client, spreadsheet_id)
            worksheet = cls._get_worksheet(spreadsheet, section_name=section_name)

            vals = cls._read_worksheet_values(worksheet)
            if len(vals) < 6:
                return False

            # FIX 6: Dynamically locate Header Row containing ROLL NO
            header_r_0idx = -1
            roll_col_0idx = 1
            for r_i, r_data in enumerate(vals[:10]):
                for c_i, cell in enumerate(r_data):
                    if "ROLL" in str(cell).upper():
                        header_r_0idx = r_i
                        roll_col_0idx = c_i
                        break
                if header_r_0idx != -1:
                    break

            if header_r_0idx == -1:
                header_r_0idx = 5

            headers = vals[header_r_0idx]
            student_start_r_0idx = header_r_0idx + 1

            # Locate Total / Cumulative column by header text
            total_c_0idx = -1
            for c_idx in range(roll_col_0idx + 1, len(headers)):
                for r_check in range(header_r_0idx + 1):
                    if c_idx < len(vals[r_check]):
                        val_str = str(vals[r_check][c_idx]).strip().lower()
                        if "total" in val_str or "cumulative" in val_str:
                            total_c_0idx = c_idx
                            break
                if total_c_0idx != -1:
                    break

            # Locate first date column
            first_date_c_0idx = -1
            for c_idx in range(roll_col_0idx + 1, len(headers)):
                if c_idx == total_c_0idx:
                    continue
                for r_check in range(header_r_0idx + 1):
                    if c_idx < len(vals[r_check]):
                        d_str = str(vals[r_check][c_idx]).strip()
                        if ("/" in d_str or "-" in d_str) and "total" not in d_str.lower() and "cumulative" not in d_str.lower():
                            first_date_c_0idx = c_idx
                            break
                if first_date_c_0idx != -1:
                    break
            if first_date_c_0idx == -1:
                first_date_c_0idx = roll_col_0idx + 1

            # Update all student rows for all date columns to "A", skipping Total column
            for r_idx in range(student_start_r_0idx, len(vals)):
                row_len = len(vals[r_idx])
                roll = str(vals[r_idx][roll_col_0idx]).strip() if row_len > roll_col_0idx else ""
                sno = str(vals[r_idx][0]).strip() if row_len > 0 else ""
                if not (roll and not roll.startswith("*") and not sno.startswith("*")):
                    continue
                for c_idx in range(first_date_c_0idx, row_len):
                    if c_idx == total_c_0idx:
                        continue
                    vals[r_idx][c_idx] = "A"

            # Re-apply Total formula
            if total_c_0idx != -1:
                if first_date_c_0idx >= total_c_0idx:
                    first_date_c_0idx = max(roll_col_0idx + 1, total_c_0idx - 1)
                first_col_letter = cls._col_to_letter(first_date_c_0idx + 1)
                last_col_letter = cls._col_to_letter(total_c_0idx)
                for r_i in range(student_start_r_0idx, len(vals)):
                    row_num = r_i + 1
                    while len(vals[r_i]) <= total_c_0idx:
                        vals[r_i].append("")
                    roll = str(vals[r_i][roll_col_0idx]).strip() if len(vals[r_i]) > roll_col_0idx else ""
                    sno = str(vals[r_i][0]).strip() if len(vals[r_i]) > 0 else ""
                    if roll and not roll.startswith("*") and not sno.startswith("*"):
                        vals[r_i][total_c_0idx] = f"=SUM({first_col_letter}{row_num}:{last_col_letter}{row_num})"
                    else:
                        vals[r_i][total_c_0idx] = ""

            cls._update_worksheet_values(worksheet, vals, range_name="A1", value_input_option="USER_ENTERED")
            logger.info(f"Successfully marked all students as ABSENT (A) in Google Sheet ID: {spreadsheet_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to batch mark all absent: {str(e)}")
            return False

    @classmethod
    def sync_session_to_gsheet(
        cls,
        credentials_json: str,
        spreadsheet_id: str,
        date_str: str,
        present_rolls: List[str],
        all_section_rolls: List[str],
        period_total: str = "4",
        section_name: Optional[str] = None,
        session_half: Optional[str] = None
    ) -> bool:
        """
        Syncs an entire session's attendance to Google Sheet in a SINGLE atomic batch call:
        Present rolls get clamped 1-4 periods per half-day session (FN / AN), Absent rolls get "A".
        Maintains SNIST template layout:
          Header Row            = Dynamically located by 'ROLL'
          Session Halves        = Respects FN (Periods 1-4) and AN (Periods 5-8)
          Total / Cumulative    = Positioned AFTER all date columns
          Borders               = Crisp solid 1px borders on all cells
        """
        if not credentials_json or not spreadsheet_id:
            logger.info("Google Sheets session sync skipped: Credentials or Spreadsheet ID missing.")
            return False

        try:
            from datetime import datetime
            import re

            # Infer session_half ("FN", "AN", "BOTH") if not explicitly passed
            period_str_upper = str(period_total).strip().upper()
            if not session_half:
                if "1-8" in period_str_upper or "8 PERIODS" in period_str_upper or "FULL DAY" in period_str_upper or period_str_upper == "8":
                    session_half = "BOTH"
                elif "AN" in period_str_upper or "AFTERNOON" in period_str_upper:
                    session_half = "AN"
                elif "FN" in period_str_upper or "FORENOON" in period_str_upper:
                    session_half = "FN"
                elif any(p in period_str_upper for p in ["5-8", "PERIOD 5", "PERIOD 6", "PERIOD 7", "PERIOD 8"]):
                    session_half = "AN"
                elif any(p in period_str_upper for p in ["1-4", "PERIOD 1", "PERIOD 2", "PERIOD 3", "PERIOD 4"]):
                    session_half = "FN"
                else:
                    try:
                        from app.core.security import get_server_ist_datetime
                        ist_now = get_server_ist_datetime()
                        session_half = "AN" if ist_now.hour >= 13 else "FN"
                    except Exception:
                        session_half = "FN"

            # If session is full-day (8 periods / BOTH), treat as a single 8-period full-day session
            if session_half == "BOTH":
                session_half = None
                period_total = "8"

            # 1. Parse target date (day, month, year) from date_str
            target_day, target_month, target_year = None, None, 2026
            for fmt in ["%Y-%m-%d", "%d/%m/%Y", "%d/%m/%y", "%d-%m-%Y", "%d-%m-%y", "%m/%d/%Y"]:
                try:
                    dt_obj = datetime.strptime(str(date_str).strip(), fmt)
                    target_day = dt_obj.day
                    target_month = dt_obj.month
                    target_year = dt_obj.year
                    break
                except ValueError:
                    continue
            if not target_day:
                parts = str(date_str).strip().replace("-", "/").split("/")
                if len(parts) >= 2:
                    if len(parts[0]) == 4:
                        target_year, target_month, target_day = int(parts[0]), int(parts[1]), int(parts[2])
                    else:
                        target_day, target_month = int(parts[0]), int(parts[1])
                        target_year = int(parts[2]) if len(parts) > 2 else 2026

            # Clean period total: supports 1 to 8 periods (e.g. 4 for half-day, 8 for full-day)
            clean_period = str(period_total).strip().upper()
            try:
                period_total_clean = str(max(1, min(8, int(clean_period))))
            except Exception:
                m_p = re.search(r'\((\d+)\s*PERIODS?', clean_period)
                if m_p:
                    period_total_clean = str(max(1, min(8, int(m_p.group(1)))))
                else:
                    period_total_clean = "4"

            client = cls._get_client(credentials_json)
            spreadsheet = cls._open_spreadsheet(client, spreadsheet_id)
            worksheet = cls._get_worksheet(spreadsheet, section_name=section_name, rolls=(all_section_rolls or present_rolls))

            vals = cls._read_worksheet_values(worksheet)
            if len(vals) < 6:
                logger.warning("Sheet does not have SNIST layout headers yet.")
                return False

            # Dynamically locate Header Row containing ROLL NO
            header_r_0idx = -1
            roll_col_0idx = 1
            for r_i, r_data in enumerate(vals[:10]):
                for c_i, cell in enumerate(r_data):
                    if "ROLL" in str(cell).upper():
                        header_r_0idx = r_i
                        roll_col_0idx = c_i
                        break
                if header_r_0idx != -1:
                    break

            if header_r_0idx == -1:
                header_r_0idx = 5

            headers = vals[header_r_0idx]
            student_start_r_0idx = header_r_0idx + 1

            # Helper to parse any cell into (day, month, has_year, cell_half, raw_str)
            def parse_cell_dm(val):
                if val is None:
                    return None
                s = str(val).strip()
                if not s:
                    return None
                s_low = s.lower()
                if any(k in s_low for k in ["sno", "roll", "name", "gender", "section", "agency", "cumulative", "total", "cet", "coign", "sreenidhi", "department"]):
                    return None

                cell_half = None
                s_upper = s.upper()
                if "(FN)" in s_upper or " FN" in s_upper or "/FN" in s_upper:
                    cell_half = "FN"
                elif "(AN)" in s_upper or "((AN)" in s_upper or " AN" in s_upper or "/AN" in s_upper:
                    cell_half = "AN"

                for fmt in ["%d/%m/%Y", "%d/%m/%y", "%d-%m-%Y", "%d-%m-%y", "%Y-%m-%d"]:
                    try:
                        dt = datetime.strptime(s, fmt)
                        return (dt.day, dt.month, True, cell_half, s)
                    except ValueError:
                        pass
                for fmt in ["%d/%m", "%d-%m"]:
                    try:
                        dt = datetime.strptime(s, fmt)
                        return (dt.day, dt.month, False, cell_half, s)
                    except ValueError:
                        pass
                m_date = re.search(r'(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?', s)
                if m_date:
                    p0, p1, p2 = m_date.group(1), m_date.group(2), m_date.group(3)
                    d, m_val = int(p0), int(p1)
                    if 1 <= m_val <= 12 and 1 <= d <= 31:
                        return (d, m_val, p2 is not None, cell_half, s)
                return None

            # Scan all columns across header rows to detect existing date columns
            existing_date_cols = {}  # c_idx -> (day, month, has_year, cell_half, raw_str)
            date_col_0idx = -1

            for c_idx in range(roll_col_0idx + 1, len(headers)):
                for r_check in range(header_r_0idx + 1):
                    if c_idx < len(vals[r_check]):
                        cell_raw = str(vals[r_check][c_idx]).strip()
                        parsed = parse_cell_dm(cell_raw)
                        if parsed:
                            existing_date_cols[c_idx] = parsed
                            break

            # 1st preference: exact date match AND session_half match
            for c_idx, (d, m, has_yr, ch, raw_s) in existing_date_cols.items():
                if d == target_day and m == target_month:
                    if session_half in ["FN", "AN"] and ch == session_half:
                        date_col_0idx = c_idx
                        break
                    elif session_half is None and ch is None:
                        date_col_0idx = c_idx
                        break

            # 2nd preference: fallback match by date if only 1 column matches or no half-day distinctions
            if date_col_0idx == -1:
                for c_idx, (d, m, has_yr, ch, raw_s) in existing_date_cols.items():
                    if d == target_day and m == target_month:
                        date_col_0idx = c_idx
                        break

            # Check date format used in existing date columns of the sheet
            uses_year = False
            uses_compact_brackets = False
            if existing_date_cols:
                yr_count = sum(1 for _, (_, _, has_yr, _, _) in existing_date_cols.items() if has_yr)
                uses_year = yr_count > (len(existing_date_cols) // 2)
                uses_compact_brackets = any("(" in raw_s and " (" not in raw_s for _, (_, _, _, _, raw_s) in existing_date_cols.items())

            # Format display_date matching sheet style (e.g. 18/09/2026 or 18/9/26 (FN))
            bracket_sep = "" if uses_compact_brackets else " "
            suffix = f"{bracket_sep}({session_half})" if session_half in ["FN", "AN"] else ""
            if uses_year:
                # Check if 4-digit or 2-digit year is standard in this sheet
                uses_4digit_yr = any(len(raw_s.split("/")[2][:4]) == 4 for _, (_, _, has_yr, _, raw_s) in existing_date_cols.items() if has_yr and "/" in raw_s and len(raw_s.split("/")) > 2)
                yr_str = str(target_year) if uses_4digit_yr else str(target_year)[-2:]
                day_str = f"{target_day:02d}" if any(raw_s.startswith(f"{target_day:02d}") for _, (_, _, _, _, raw_s) in existing_date_cols.items()) else f"{target_day}"
                month_str = f"{target_month:02d}" if any(f"/{target_month:02d}/" in raw_s for _, (_, _, _, _, raw_s) in existing_date_cols.items()) else f"{target_month}"
                display_date = f"{day_str}/{month_str}/{yr_str}{suffix}"
            else:
                display_date = f"{target_day}/{target_month}{suffix}"

            # Locate first date column index
            first_date_c_0idx = min(existing_date_cols.keys()) if existing_date_cols else (roll_col_0idx + 1)

            # If date column not found, insert BEFORE Cumulative Attendance (or after the last date column)
            if date_col_0idx == -1:
                # Detect if an existing Cumulative Attendance / Total column exists
                existing_cum_c_0idx = -1
                for c_idx in range(roll_col_0idx + 1, len(headers)):
                    for r_check in range(header_r_0idx + 1):
                        if c_idx < len(vals[r_check]):
                            v_str = str(vals[r_check][c_idx]).strip().lower()
                            if "total" in v_str or "cumulative" in v_str:
                                existing_cum_c_0idx = c_idx
                                break
                    if existing_cum_c_0idx != -1:
                        break

                if existing_cum_c_0idx != -1:
                    # Insert right before the cumulative column so cumulative stays at the end
                    date_col_0idx = existing_cum_c_0idx
                elif existing_date_cols:
                    last_date_c_0idx = max(existing_date_cols.keys())
                    date_col_0idx = last_date_c_0idx + 1
                else:
                    date_col_0idx = roll_col_0idx + 1

                # Insert column at date_col_0idx across all rows
                for r_i in range(len(vals)):
                    if date_col_0idx < len(vals[r_i]):
                        vals[r_i].insert(date_col_0idx, "")
                    else:
                        while len(vals[r_i]) < date_col_0idx:
                            vals[r_i].append("")
                        vals[r_i].append("")

                # Clean upper banner rows above the header row
                for r_banner in range(header_r_0idx):
                    if len(vals) > r_banner and len(vals[r_banner]) > date_col_0idx:
                        vals[r_banner][date_col_0idx] = ""

                vals[header_r_0idx][date_col_0idx] = display_date

                for r_i in range(student_start_r_0idx, len(vals)):
                    roll = str(vals[r_i][roll_col_0idx]).strip() if len(vals[r_i]) > roll_col_0idx else ""
                    sno = str(vals[r_i][0]).strip() if len(vals[r_i]) > 0 else ""
                    if roll and not roll.startswith("*") and not sno.startswith("*"):
                        vals[r_i][date_col_0idx] = "A"
                    else:
                        vals[r_i][date_col_0idx] = ""
            else:
                # Column exists: preserve existing custom teacher name in header if present (e.g. 18/09/2026(FN)(V.RAVITEJA))
                curr_header = str(vals[header_r_0idx][date_col_0idx]).strip()
                if not curr_header or session_half not in curr_header.upper():
                    vals[header_r_0idx][date_col_0idx] = display_date

            present_set = {str(r).strip().upper() for r in present_rolls}

            # Update every student row in memory
            for r_idx in range(student_start_r_0idx, len(vals)):
                while len(vals[r_idx]) <= date_col_0idx:
                    vals[r_idx].append("")
                row_roll = str(vals[r_idx][roll_col_0idx]).strip().upper() if len(vals[r_idx]) > roll_col_0idx else ""
                row_sno = str(vals[r_idx][0]).strip() if len(vals[r_idx]) > 0 else ""
                if row_roll and not row_roll.startswith("*") and not row_sno.startswith("*"):
                    vals[r_idx][date_col_0idx] = period_total_clean if row_roll in present_set else "A"
                else:
                    vals[r_idx][date_col_0idx] = ""

            # Check if there is a FINAL Cumulative Attendance column strictly after date_col_0idx
            final_total_c_0idx = -1
            for c_idx in range(date_col_0idx + 1, max(len(r) for r in vals)):
                for r_check in range(header_r_0idx + 1):
                    if c_idx < len(vals[r_check]):
                        val_str = str(vals[r_check][c_idx]).strip().lower()
                        if "total" in val_str or "cumulative" in val_str:
                            final_total_c_0idx = c_idx
                            break
                if final_total_c_0idx != -1:
                    break

            # Update Final Cumulative column formula if present
            if final_total_c_0idx != -1:
                first_col_letter = cls._col_to_letter(first_date_c_0idx + 1)
                last_col_letter = cls._col_to_letter(final_total_c_0idx)
                for r_i in range(student_start_r_0idx, len(vals)):
                    row_num = r_i + 1
                    while len(vals[r_i]) <= final_total_c_0idx:
                        vals[r_i].append("")
                    roll = str(vals[r_i][roll_col_0idx]).strip() if len(vals[r_i]) > roll_col_0idx else ""
                    sno = str(vals[r_i][0]).strip() if len(vals[r_i]) > 0 else ""
                    if roll and not roll.startswith("*") and not sno.startswith("*"):
                        vals[r_i][final_total_c_0idx] = f"=SUM({first_col_letter}{row_num}:{last_col_letter}{row_num})"
                    else:
                        vals[r_i][final_total_c_0idx] = ""

            # Execute single atomic update across the entire sheet with USER_ENTERED
            cls._update_worksheet_values(worksheet, vals, range_name="A1", value_input_option="USER_ENTERED")

            # Replicate formatting from preceding date column (background color, text style) to target column
            if date_col_0idx > first_date_c_0idx:
                try:
                    cls._batch_update_spreadsheet(spreadsheet, [
                        {
                            'copyPaste': {
                                'source': {
                                    'sheetId': worksheet.id,
                                    'startRowIndex': max(0, header_r_0idx),
                                    'endRowIndex': len(vals),
                                    'startColumnIndex': date_col_0idx - 1,
                                    'endColumnIndex': date_col_0idx
                                },
                                'destination': {
                                    'sheetId': worksheet.id,
                                    'startRowIndex': max(0, header_r_0idx),
                                    'endRowIndex': len(vals),
                                    'startColumnIndex': date_col_0idx,
                                    'endColumnIndex': date_col_0idx + 1
                                },
                                'pasteType': 'PASTE_FORMAT',
                                'pasteOrientation': 'NORMAL'
                            }
                        }
                    ])
                except Exception as copy_err:
                    logger.warning(f"Could not copy column format from previous column: {copy_err}")

            # Apply full borders to the sheet
            max_c = max(len(r) for r in vals) if vals else 37
            cls._apply_borders(spreadsheet, worksheet, start_row=max(0, header_r_0idx - 2), end_row=len(vals), start_col=0, end_col=max_c)

            logger.info(f"[GSheets Batch Sync] Successfully synchronized session attendance ({len(present_set)} present, {len(all_section_rolls) - len(present_set)} absent) for {date_str} via atomic update, borders applied.")
            return True
        except Exception as e:
            logger.error(f"Failed to batch sync session to Google Sheet: {str(e)}", exc_info=True)
            return False

    @classmethod
    def mark_all_present(
        cls,
        credentials_json: str,
        spreadsheet_id: str,
        students: List[Dict[str, Any]],
        section_name: Optional[str] = None
    ) -> bool:
        """
        Marks all students as Present ("4") across all date columns in a single batch call,
        preserving the Total column and recalculating formulas.
        Uses dynamic header lookup (FIX 6).
        """
        if not credentials_json or not spreadsheet_id:
            return False

        try:
            client = cls._get_client(credentials_json)
            spreadsheet = cls._open_spreadsheet(client, spreadsheet_id)
            worksheet = cls._get_worksheet(spreadsheet, section_name=section_name)

            vals = cls._read_worksheet_values(worksheet)
            if len(vals) < 6:
                return False

            # FIX 6: Dynamically locate Header Row containing ROLL NO
            header_r_0idx = -1
            roll_col_0idx = 1
            for r_i, r_data in enumerate(vals[:10]):
                for c_i, cell in enumerate(r_data):
                    if "ROLL" in str(cell).upper():
                        header_r_0idx = r_i
                        roll_col_0idx = c_i
                        break
                if header_r_0idx != -1:
                    break

            if header_r_0idx == -1:
                header_r_0idx = 5

            headers = vals[header_r_0idx]
            student_start_r_0idx = header_r_0idx + 1

            # Locate Total / Cumulative column by header text
            total_c_0idx = -1
            for c_idx in range(roll_col_0idx + 1, len(headers)):
                for r_check in range(header_r_0idx + 1):
                    if c_idx < len(vals[r_check]):
                        val_str = str(vals[r_check][c_idx]).strip().lower()
                        if "total" in val_str or "cumulative" in val_str:
                            total_c_0idx = c_idx
                            break
                if total_c_0idx != -1:
                    break

            # Locate first date column
            first_date_c_0idx = -1
            for c_idx in range(roll_col_0idx + 1, len(headers)):
                if c_idx == total_c_0idx:
                    continue
                for r_check in range(header_r_0idx + 1):
                    if c_idx < len(vals[r_check]):
                        d_str = str(vals[r_check][c_idx]).strip()
                        if ("/" in d_str or "-" in d_str) and "total" not in d_str.lower() and "cumulative" not in d_str.lower():
                            first_date_c_0idx = c_idx
                            break
                if first_date_c_0idx != -1:
                    break
            if first_date_c_0idx == -1:
                first_date_c_0idx = roll_col_0idx + 1

            # Update all student rows for all date columns to "4", skipping Total column
            for r_idx in range(student_start_r_0idx, len(vals)):
                roll = str(vals[r_idx][roll_col_0idx]).strip() if len(vals[r_idx]) > roll_col_0idx else ""
                sno = str(vals[r_idx][0]).strip() if len(vals[r_idx]) > 0 else ""
                if not (roll and not roll.startswith("*") and not sno.startswith("*")):
                    continue
                row_len = len(vals[r_idx])
                for c_idx in range(first_date_c_0idx, row_len):
                    if c_idx == total_c_0idx:
                        continue
                    vals[r_idx][c_idx] = "4"

            # Re-apply Total formula
            if total_c_0idx != -1:
                if first_date_c_0idx >= total_c_0idx:
                    first_date_c_0idx = max(roll_col_0idx + 1, total_c_0idx - 1)
                first_col_letter = cls._col_to_letter(first_date_c_0idx + 1)
                last_col_letter = cls._col_to_letter(total_c_0idx)
                for r_i in range(student_start_r_0idx, len(vals)):
                    row_num = r_i + 1
                    while len(vals[r_i]) <= total_c_0idx:
                        vals[r_i].append("")
                    roll = str(vals[r_i][roll_col_0idx]).strip() if len(vals[r_i]) > roll_col_0idx else ""
                    sno = str(vals[r_i][0]).strip() if len(vals[r_i]) > 0 else ""
                    if roll and not roll.startswith("*") and not sno.startswith("*"):
                        vals[r_i][total_c_0idx] = f"=SUM({first_col_letter}{row_num}:{last_col_letter}{row_num})"
                    else:
                        vals[r_i][total_c_0idx] = ""

            cls._update_worksheet_values(worksheet, vals, range_name="A1", value_input_option="USER_ENTERED")
            logger.info(f"Successfully marked all students as PRESENT (4) in Google Sheet ID: {spreadsheet_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to batch mark all present: {str(e)}")
            return False




