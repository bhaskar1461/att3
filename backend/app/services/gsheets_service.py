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
            import pickle

            base_dir = os.path.dirname(credentials_json) if os.path.exists(credentials_json) else os.getcwd()
            token_path = os.path.join(base_dir, 'token.pickle')

            creds = None
            if os.path.exists(token_path):
                try:
                    with open(token_path, 'rb') as token_file:
                        creds = pickle.load(token_file)
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

                with open(token_path, 'wb') as token_file:
                    pickle.dump(creds, token_file)

            return gspread.authorize(creds)

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
            spreadsheet = client.create(title)
            
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
            spreadsheet = client.open_by_key(spreadsheet_id)
            
            try:
                worksheet = spreadsheet.worksheet("Attendance Register")
            except Exception:
                worksheet = spreadsheet.sheet1
                try:
                    worksheet.update_title("Attendance Register")
                except Exception:
                    pass

            # Read existing grid if present to preserve date columns and data
            existing_vals = worksheet.get_all_values()

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

            worksheet.update(values=rows, range_name="A1")

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
    def _get_worksheet(spreadsheet):
        """Retrieves active worksheet, prioritizing 'CSE-CS', 'Attendance Register', then sheet1."""
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

            spreadsheet.batch_update({"requests": requests})
        except Exception as fmt_err:
            logger.warning(f"Batch formatting warning: {fmt_err}")

    @classmethod
    def record_attendance_in_gsheet(
        cls,
        credentials_json: str,
        spreadsheet_id: str,
        roll_number: str,
        date_str: str,
        status_code: str = "4",
        period_total: str = "4"
    ) -> bool:
        """
        Records attendance for a roll number under date_str in real-time.
        Matches SNIST layout:
          Conducted periods row = Row 4 (Col G+)
          Title banner row      = Row 5
          Date header row       = Row 6 (Col G+)
          Total summary col     = Placed immediately after all date columns
          Student rows          = Row 7+
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

            # Sanitize and clamp status code: "A" for Absent, integer 1-8 for Present (NEVER 32)
            clean_status = str(status_code).strip().upper()
            if clean_status in ["A", "ABSENT"]:
                status_code_clean = "A"
            else:
                try:
                    status_code_clean = str(max(1, min(8, int(clean_status))))
                except Exception:
                    status_code_clean = "4"

            try:
                period_total_clean = str(max(1, min(8, int(period_total))))
            except Exception:
                period_total_clean = "4"

            # Format display date as DD/MM/YYYY
            target_date_norm = norm_d(date_str)
            display_date = target_date_norm
            for fmt in ["%Y-%m-%d", "%d/%m/%Y", "%d/%m/%y", "%d-%m-%Y", "%d-%m-%y"]:
                try:
                    dt_obj = datetime.strptime(str(date_str).strip(), fmt)
                    display_date = dt_obj.strftime("%d/%m/%Y")
                    break
                except ValueError:
                    pass

            client = cls._get_client(credentials_json)
            spreadsheet = client.open_by_key(spreadsheet_id)
            worksheet = cls._get_worksheet(spreadsheet)

            vals = worksheet.get_all_values()
            if len(vals) < 6:
                logger.warning("Sheet does not have SNIST layout headers yet.")
                return False

            target_roll = str(roll_number).strip().upper()

            # Locate Total column index in Row 6 (vals[5])
            total_c_0idx = -1
            for c_idx in range(4, len(vals[5])):
                if str(vals[5][c_idx]).strip().lower() == "total":
                    total_c_0idx = c_idx
                    break

            # Locate first date column index in Row 6 (default to Col G = index 6)
            first_date_c_0idx = 6
            for c_idx in range(4, len(vals[5])):
                d_str = str(vals[5][c_idx]).strip()
                if ("/" in d_str or "-" in d_str) and str(vals[5][c_idx]).strip().lower() != "total":
                    first_date_c_0idx = c_idx
                    break

            # Locate date column in Row 6 (vals[5])
            date_col_0idx = -1
            for c_idx in range(4, len(vals[5])):
                if c_idx == total_c_0idx:
                    continue
                d_val = str(vals[5][c_idx]).strip()
                if d_val and norm_d(d_val) == target_date_norm:
                    date_col_0idx = c_idx
                    break

            # Fallback check in Row 5 (vals[4]) in case date was previously misplaced there
            if date_col_0idx == -1 and len(vals) > 4:
                for c_idx in range(4, len(vals[4])):
                    if c_idx == total_c_0idx:
                        continue
                    d_val = str(vals[4][c_idx]).strip()
                    if d_val and norm_d(d_val) == target_date_norm:
                        date_col_0idx = c_idx
                        vals[4][c_idx] = ""
                        vals[5][c_idx] = display_date
                        break

            # If date column not found, insert a new date column BEFORE Total (or append at end)
            if date_col_0idx == -1:
                if total_c_0idx != -1:
                    date_col_0idx = total_c_0idx
                    for r_i in range(len(vals)):
                        vals[r_i].insert(date_col_0idx, "")
                    total_c_0idx += 1
                else:
                    date_col_0idx = len(vals[5])
                    for r_i in range(len(vals)):
                        vals[r_i].append("")

                if len(vals) > 3:
                    vals[3][date_col_0idx] = period_total_clean
                if len(vals) > 4:
                    vals[4][date_col_0idx] = ""
                if len(vals) > 5:
                    vals[5][date_col_0idx] = display_date

                for r_i in range(6, len(vals)):
                    roll = str(vals[r_i][1]).strip() if len(vals[r_i]) > 1 else ""
                    sno = str(vals[r_i][0]).strip() if len(vals[r_i]) > 0 else ""
                    if roll and not roll.startswith("*") and not sno.startswith("*"):
                        vals[r_i][date_col_0idx] = "A"
                    else:
                        vals[r_i][date_col_0idx] = ""

            # Set attendance for the student
            student_found = False
            for r_idx in range(6, len(vals)):
                while len(vals[r_idx]) <= date_col_0idx:
                    vals[r_idx].append("")
                row_roll = str(vals[r_idx][1]).strip().upper() if len(vals[r_idx]) > 1 else ""
                if row_roll == target_roll:
                    vals[r_idx][date_col_0idx] = status_code_clean
                    student_found = True
                    break

            # Update Total column formulas if present
            if total_c_0idx != -1:
                if first_date_c_0idx >= total_c_0idx:
                    first_date_c_0idx = max(4, total_c_0idx - 1)
                first_col_letter = cls._col_to_letter(first_date_c_0idx + 1)
                last_col_letter = cls._col_to_letter(total_c_0idx)
                if len(vals) > 3:
                    while len(vals[3]) <= total_c_0idx:
                        vals[3].append("")
                    vals[3][total_c_0idx] = f"=SUM({first_col_letter}4:{last_col_letter}4)"
                if len(vals) > 4:
                    while len(vals[4]) <= total_c_0idx:
                        vals[4].append("")
                    vals[4][total_c_0idx] = ""
                if len(vals) > 5:
                    while len(vals[5]) <= total_c_0idx:
                        vals[5].append("")
                    vals[5][total_c_0idx] = "Total"
                for r_i in range(6, len(vals)):
                    row_num = r_i + 1
                    while len(vals[r_i]) <= total_c_0idx:
                        vals[r_i].append("")
                    roll = str(vals[r_i][1]).strip() if len(vals[r_i]) > 1 else ""
                    sno = str(vals[r_i][0]).strip() if len(vals[r_i]) > 0 else ""
                    if roll and not roll.startswith("*") and not sno.startswith("*"):
                        vals[r_i][total_c_0idx] = f"=SUM({first_col_letter}{row_num}:{last_col_letter}{row_num})"
                    else:
                        vals[r_i][total_c_0idx] = ""

            # Single atomic update with USER_ENTERED to evaluate formulas
            worksheet.update(values=vals, range_name="A1", value_input_option="USER_ENTERED")

            if student_found:
                logger.info(f"[GSheets Sync] Roll {target_roll} on {date_str} marked '{status_code_clean}' in date col {date_col_0idx+1}, Total column updated.")
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
        spreadsheet_id: str
    ) -> bool:
        """
        Resets all student attendance entries to "A" (Absent) across all date columns,
        preserving the Total column and dynamically updating formulas.
        """
        if not credentials_json or not spreadsheet_id:
            return False

        try:
            client = cls._get_client(credentials_json)
            spreadsheet = client.open_by_key(spreadsheet_id)
            worksheet = cls._get_worksheet(spreadsheet)

            vals = worksheet.get_all_values()
            if len(vals) < 6:
                return False

            total_c_0idx = -1
            for c_idx in range(4, len(vals[5])):
                if str(vals[5][c_idx]).strip().lower() == "total":
                    total_c_0idx = c_idx
                    break

            first_date_c_0idx = 6
            for c_idx in range(4, len(vals[5])):
                d_str = str(vals[5][c_idx]).strip()
                if ("/" in d_str or "-" in d_str) and str(vals[5][c_idx]).strip().lower() != "total":
                    first_date_c_0idx = c_idx
                    break

            # Update all student rows (Row 7+) for all date columns to "A", skipping Total column
            for r_idx in range(6, len(vals)):
                row_len = len(vals[r_idx])
                for c_idx in range(4, row_len):
                    if c_idx == total_c_0idx:
                        continue
                    vals[r_idx][c_idx] = "A"

            # Re-apply Total formula
            if total_c_0idx != -1:
                if first_date_c_0idx >= total_c_0idx:
                    first_date_c_0idx = max(4, total_c_0idx - 1)
                first_col_letter = cls._col_to_letter(first_date_c_0idx + 1)
                last_col_letter = cls._col_to_letter(total_c_0idx)
                for r_i in range(6, len(vals)):
                    row_num = r_i + 1
                    while len(vals[r_i]) <= total_c_0idx:
                        vals[r_i].append("")
                    vals[r_i][total_c_0idx] = f"=SUM({first_col_letter}{row_num}:{last_col_letter}{row_num})"

            worksheet.update(values=vals, range_name="A1", value_input_option="USER_ENTERED")
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
        period_total: str = "4"
    ) -> bool:
        """
        Syncs an entire session's attendance to Google Sheet in a SINGLE atomic batch call:
        Present rolls get clamped 1-8 periods, Absent rolls get "A".
        Maintains SNIST template layout:
          Row 4: Conducted periods per session
          Row 6: Date header (DD/MM/YYYY)
          Total: Dynamically placed after all dates with =SUM formulas evaluated via USER_ENTERED.
        """
        if not credentials_json or not spreadsheet_id:
            logger.info("Google Sheets session sync skipped: Credentials or Spreadsheet ID missing.")
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

            # Sanitize and clamp period total strictly between 1 and 8 (default 4, NEVER 32)
            clean_period = str(period_total).strip().upper()
            try:
                period_total_clean = str(max(1, min(8, int(clean_period))))
            except Exception:
                period_total_clean = "4"

            target_date_norm = norm_d(date_str)
            display_date = target_date_norm
            for fmt in ["%Y-%m-%d", "%d/%m/%Y", "%d/%m/%y", "%d-%m-%Y", "%d-%m-%y"]:
                try:
                    dt_obj = datetime.strptime(str(date_str).strip(), fmt)
                    display_date = dt_obj.strftime("%d/%m/%Y")
                    break
                except ValueError:
                    pass

            client = cls._get_client(credentials_json)
            spreadsheet = client.open_by_key(spreadsheet_id)
            worksheet = cls._get_worksheet(spreadsheet)

            vals = worksheet.get_all_values()
            if len(vals) < 6:
                logger.warning("Sheet does not have SNIST layout headers yet.")
                return False

            # Locate Total column index in Row 6 (vals[5])
            total_c_0idx = -1
            for c_idx in range(4, len(vals[5])):
                if str(vals[5][c_idx]).strip().lower() == "total":
                    total_c_0idx = c_idx
                    break

            # Locate first date column index in Row 6 (default to Col G = index 6)
            first_date_c_0idx = 6
            for c_idx in range(4, len(vals[5])):
                d_str = str(vals[5][c_idx]).strip()
                if ("/" in d_str or "-" in d_str) and str(vals[5][c_idx]).strip().lower() != "total":
                    first_date_c_0idx = c_idx
                    break

            # Locate date column in Row 6 (vals[5])
            date_col_0idx = -1
            for c_idx in range(4, len(vals[5])):
                if c_idx == total_c_0idx:
                    continue
                d_val = str(vals[5][c_idx]).strip()
                if d_val and norm_d(d_val) == target_date_norm:
                    date_col_0idx = c_idx
                    break

            # Fallback check in Row 5 (vals[4]) in case date was previously misplaced there
            if date_col_0idx == -1 and len(vals) > 4:
                for c_idx in range(4, len(vals[4])):
                    if c_idx == total_c_0idx:
                        continue
                    d_val = str(vals[4][c_idx]).strip()
                    if d_val and norm_d(d_val) == target_date_norm:
                        date_col_0idx = c_idx
                        vals[4][c_idx] = ""
                        vals[5][c_idx] = display_date
                        break

            # If date column not found, insert a new date column BEFORE Total (or append at end)
            if date_col_0idx == -1:
                if total_c_0idx != -1:
                    date_col_0idx = total_c_0idx
                    for r_i in range(len(vals)):
                        vals[r_i].insert(date_col_0idx, "")
                    total_c_0idx += 1
                else:
                    date_col_0idx = len(vals[5])
                    for r_i in range(len(vals)):
                        vals[r_i].append("")

                if len(vals) > 3:
                    vals[3][date_col_0idx] = period_total_clean
                if len(vals) > 4:
                    vals[4][date_col_0idx] = ""
                if len(vals) > 5:
                    vals[5][date_col_0idx] = display_date

                for r_i in range(6, len(vals)):
                    roll = str(vals[r_i][1]).strip() if len(vals[r_i]) > 1 else ""
                    sno = str(vals[r_i][0]).strip() if len(vals[r_i]) > 0 else ""
                    if roll and not roll.startswith("*") and not sno.startswith("*"):
                        vals[r_i][date_col_0idx] = "A"
                    else:
                        vals[r_i][date_col_0idx] = ""
            else:
                if len(vals) > 3:
                    while len(vals[3]) <= date_col_0idx:
                        vals[3].append("")
                    if not vals[3][date_col_0idx]:
                        vals[3][date_col_0idx] = period_total_clean
                if len(vals) > 5:
                    while len(vals[5]) <= date_col_0idx:
                        vals[5].append("")
                    vals[5][date_col_0idx] = display_date

            present_set = {str(r).strip().upper() for r in present_rolls}

            # Update every student row in memory
            for r_idx in range(6, len(vals)):
                while len(vals[r_idx]) <= date_col_0idx:
                    vals[r_idx].append("")
                row_roll = str(vals[r_idx][1]).strip().upper() if len(vals[r_idx]) > 1 else ""
                row_sno = str(vals[r_idx][0]).strip() if len(vals[r_idx]) > 0 else ""
                if row_roll and not row_roll.startswith("*") and not row_sno.startswith("*"):
                    vals[r_idx][date_col_0idx] = period_total_clean if row_roll in present_set else "A"
                else:
                    vals[r_idx][date_col_0idx] = ""

            # Update Total column formulas if present
            if total_c_0idx != -1:
                if first_date_c_0idx >= total_c_0idx:
                    first_date_c_0idx = max(4, total_c_0idx - 1)
                first_col_letter = cls._col_to_letter(first_date_c_0idx + 1)
                last_col_letter = cls._col_to_letter(total_c_0idx)
                if len(vals) > 3:
                    while len(vals[3]) <= total_c_0idx:
                        vals[3].append("")
                    vals[3][total_c_0idx] = f"=SUM({first_col_letter}4:{last_col_letter}4)"
                if len(vals) > 4:
                    while len(vals[4]) <= total_c_0idx:
                        vals[4].append("")
                    vals[4][total_c_0idx] = ""
                if len(vals) > 5:
                    while len(vals[5]) <= total_c_0idx:
                        vals[5].append("")
                    vals[5][total_c_0idx] = "Total"
                for r_i in range(6, len(vals)):
                    row_num = r_i + 1
                    while len(vals[r_i]) <= total_c_0idx:
                        vals[r_i].append("")
                    roll = str(vals[r_i][1]).strip() if len(vals[r_i]) > 1 else ""
                    sno = str(vals[r_i][0]).strip() if len(vals[r_i]) > 0 else ""
                    if roll and not roll.startswith("*") and not sno.startswith("*"):
                        vals[r_i][total_c_0idx] = f"=SUM({first_col_letter}{row_num}:{last_col_letter}{row_num})"
                    else:
                        vals[r_i][total_c_0idx] = ""

            # Execute single atomic update across the entire sheet with USER_ENTERED
            worksheet.update(values=vals, range_name="A1", value_input_option="USER_ENTERED")

            logger.info(f"[GSheets Batch Sync] Successfully synchronized session attendance ({len(present_set)} present, {len(all_section_rolls) - len(present_set)} absent) for {date_str} via atomic update.")
            return True
        except Exception as e:
            logger.error(f"Failed to batch sync session to Google Sheet: {str(e)}", exc_info=True)
            return False

    @classmethod
    def mark_all_present(
        cls,
        credentials_json: str,
        spreadsheet_id: str,
        students: List[Dict[str, Any]]
    ) -> bool:
        """
        Marks all students as Present ("4") across all date columns in a single batch call,
        preserving the Total column and recalculating formulas.
        """
        if not credentials_json or not spreadsheet_id:
            return False

        try:
            client = cls._get_client(credentials_json)
            spreadsheet = client.open_by_key(spreadsheet_id)
            worksheet = cls._get_worksheet(spreadsheet)

            vals = worksheet.get_all_values()
            if len(vals) < 6:
                return False

            total_c_0idx = -1
            for c_idx in range(4, len(vals[5])):
                if str(vals[5][c_idx]).strip().lower() == "total":
                    total_c_0idx = c_idx
                    break

            first_date_c_0idx = 6
            for c_idx in range(4, len(vals[5])):
                d_str = str(vals[5][c_idx]).strip()
                if ("/" in d_str or "-" in d_str) and str(vals[5][c_idx]).strip().lower() != "total":
                    first_date_c_0idx = c_idx
                    break

            # Update all student rows (Row 7+) for all date columns to "4", skipping Total column
            for r_idx in range(6, len(vals)):
                roll = str(vals[r_idx][1]).strip() if len(vals[r_idx]) > 1 else ""
                sno = str(vals[r_idx][0]).strip() if len(vals[r_idx]) > 0 else ""
                if not (roll and not roll.startswith("*") and not sno.startswith("*")):
                    continue
                row_len = len(vals[r_idx])
                for c_idx in range(4, row_len):
                    if c_idx == total_c_0idx:
                        continue
                    vals[r_idx][c_idx] = "4"

            # Re-apply Total formula
            if total_c_0idx != -1:
                if first_date_c_0idx >= total_c_0idx:
                    first_date_c_0idx = max(4, total_c_0idx - 1)
                first_col_letter = cls._col_to_letter(first_date_c_0idx + 1)
                last_col_letter = cls._col_to_letter(total_c_0idx)
                for r_i in range(6, len(vals)):
                    row_num = r_i + 1
                    while len(vals[r_i]) <= total_c_0idx:
                        vals[r_i].append("")
                    roll = str(vals[r_i][1]).strip() if len(vals[r_i]) > 1 else ""
                    sno = str(vals[r_i][0]).strip() if len(vals[r_i]) > 0 else ""
                    if roll and not roll.startswith("*") and not sno.startswith("*"):
                        vals[r_i][total_c_0idx] = f"=SUM({first_col_letter}{row_num}:{last_col_letter}{row_num})"
                    else:
                        vals[r_i][total_c_0idx] = ""

            worksheet.update(values=vals, range_name="A1", value_input_option="USER_ENTERED")
            logger.info(f"Successfully marked all students as PRESENT (4) in Google Sheet ID: {spreadsheet_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to batch mark all present: {str(e)}")
            return False




