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
                    creds.refresh(Request())
                else:
                    if os.path.exists(credentials_json):
                        flow = InstalledAppFlow.from_client_secrets_file(credentials_json, scopes)
                    else:
                        flow = InstalledAppFlow.from_client_config(creds_data, scopes)
                    creds = flow.run_local_server(port=0)

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

    @classmethod
    def _apply_sheet_formatting(cls, spreadsheet, worksheet, num_rows: int, num_cols: int):
        """Applies exact pixel widths, text centering, row colors, and border styles."""
        try:
            sheet_id = getattr(worksheet, 'id', 0)
            if isinstance(sheet_id, str) and sheet_id.isdigit():
                sheet_id = int(sheet_id)
            elif not isinstance(sheet_id, int):
                sheet_id = 0

            target_cols = max(num_cols, 14)

            requests = [
                # 1. Unmerge all existing top header cells
                {
                    "unmergeCells": {
                        "range": {
                            "sheetId": sheet_id,
                            "startRowIndex": 0,
                            "endRowIndex": 5,
                            "startColumnIndex": 0,
                            "endColumnIndex": target_cols
                        }
                    }
                },
                # 2. Merge Header Rows A1:target_cols, A2:target_cols, A3:target_cols, A4:target_cols, A5:D5
                {
                    "mergeCells": {
                        "range": {"sheetId": sheet_id, "startRowIndex": 0, "endRowIndex": 1, "startColumnIndex": 0, "endColumnIndex": target_cols},
                        "mergeType": "MERGE_ALL"
                    }
                },
                {
                    "mergeCells": {
                        "range": {"sheetId": sheet_id, "startRowIndex": 1, "endRowIndex": 2, "startColumnIndex": 0, "endColumnIndex": target_cols},
                        "mergeType": "MERGE_ALL"
                    }
                },
                {
                    "mergeCells": {
                        "range": {"sheetId": sheet_id, "startRowIndex": 2, "endRowIndex": 3, "startColumnIndex": 0, "endColumnIndex": target_cols},
                        "mergeType": "MERGE_ALL"
                    }
                },
                {
                    "mergeCells": {
                        "range": {"sheetId": sheet_id, "startRowIndex": 3, "endRowIndex": 4, "startColumnIndex": 0, "endColumnIndex": target_cols},
                        "mergeType": "MERGE_ALL"
                    }
                },
                {
                    "mergeCells": {
                        "range": {"sheetId": sheet_id, "startRowIndex": 4, "endRowIndex": 5, "startColumnIndex": 0, "endColumnIndex": 4},
                        "mergeType": "MERGE_ALL"
                    }
                },

                # 3. Column Widths
                {"updateDimensionProperties": {"range": {"sheetId": sheet_id, "dimension": "COLUMNS", "startIndex": 0, "endIndex": 1}, "properties": {"pixelSize": 55}, "fields": "pixelSize"}},
                {"updateDimensionProperties": {"range": {"sheetId": sheet_id, "dimension": "COLUMNS", "startIndex": 1, "endIndex": 2}, "properties": {"pixelSize": 130}, "fields": "pixelSize"}},
                {"updateDimensionProperties": {"range": {"sheetId": sheet_id, "dimension": "COLUMNS", "startIndex": 2, "endIndex": 3}, "properties": {"pixelSize": 200}, "fields": "pixelSize"}},
                {"updateDimensionProperties": {"range": {"sheetId": sheet_id, "dimension": "COLUMNS", "startIndex": 3, "endIndex": 4}, "properties": {"pixelSize": 90}, "fields": "pixelSize"}},
                {"updateDimensionProperties": {"range": {"sheetId": sheet_id, "dimension": "COLUMNS", "startIndex": 4, "endIndex": target_cols}, "properties": {"pixelSize": 75}, "fields": "pixelSize"}},

                # 4. Color & Font Formats
                # Row 1: Navy Blue Header
                {
                    "repeatCell": {
                        "range": {"sheetId": sheet_id, "startRowIndex": 0, "endRowIndex": 1, "startColumnIndex": 0, "endColumnIndex": target_cols},
                        "cell": {
                            "userEnteredFormat": {
                                "backgroundColor": {"red": 0.08, "green": 0.20, "blue": 0.49},
                                "textFormat": {"bold": True, "fontSize": 13, "foregroundColor": {"red": 1.0, "green": 1.0, "blue": 1.0}},
                                "horizontalAlignment": "CENTER",
                                "verticalAlignment": "MIDDLE",
                                "wrapStrategy": "OVERFLOW_CELL"
                            }
                        },
                        "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)"
                    }
                },
                # Row 2: Department Title
                {
                    "repeatCell": {
                        "range": {"sheetId": sheet_id, "startRowIndex": 1, "endRowIndex": 2, "startColumnIndex": 0, "endColumnIndex": target_cols},
                        "cell": {
                            "userEnteredFormat": {
                                "backgroundColor": {"red": 0.12, "green": 0.26, "blue": 0.58},
                                "textFormat": {"bold": True, "fontSize": 11, "foregroundColor": {"red": 1.0, "green": 1.0, "blue": 1.0}},
                                "horizontalAlignment": "CENTER",
                                "verticalAlignment": "MIDDLE",
                                "wrapStrategy": "OVERFLOW_CELL"
                            }
                        },
                        "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)"
                    }
                },
                # Row 3: Sub-Header
                {
                    "repeatCell": {
                        "range": {"sheetId": sheet_id, "startRowIndex": 2, "endRowIndex": 3, "startColumnIndex": 0, "endColumnIndex": target_cols},
                        "cell": {
                            "userEnteredFormat": {
                                "backgroundColor": {"red": 0.90, "green": 0.93, "blue": 0.98},
                                "textFormat": {"bold": True, "fontSize": 10, "foregroundColor": {"red": 0.08, "green": 0.20, "blue": 0.49}},
                                "horizontalAlignment": "CENTER",
                                "verticalAlignment": "MIDDLE",
                                "wrapStrategy": "OVERFLOW_CELL"
                            }
                        },
                        "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)"
                    }
                },
                # Row 4: Training Agency details
                {
                    "repeatCell": {
                        "range": {"sheetId": sheet_id, "startRowIndex": 3, "endRowIndex": 4, "startColumnIndex": 0, "endColumnIndex": target_cols},
                        "cell": {
                            "userEnteredFormat": {
                                "backgroundColor": {"red": 0.96, "green": 0.97, "blue": 0.99},
                                "textFormat": {"bold": True, "fontSize": 9, "foregroundColor": {"red": 0.28, "green": 0.33, "blue": 0.41}},
                                "horizontalAlignment": "CENTER",
                                "verticalAlignment": "MIDDLE",
                                "wrapStrategy": "OVERFLOW_CELL"
                            }
                        },
                        "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)"
                    }
                },
                # Row 5: Section & Dates Bar
                {
                    "repeatCell": {
                        "range": {"sheetId": sheet_id, "startRowIndex": 4, "endRowIndex": 5, "startColumnIndex": 0, "endColumnIndex": target_cols},
                        "cell": {
                            "userEnteredFormat": {
                                "backgroundColor": {"red": 0.89, "green": 0.92, "blue": 0.96},
                                "textFormat": {"bold": True, "fontSize": 10, "foregroundColor": {"red": 0.09, "green": 0.14, "blue": 0.24}},
                                "horizontalAlignment": "CENTER",
                                "verticalAlignment": "MIDDLE"
                            }
                        },
                        "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)"
                    }
                },
                # Row 6: Main Data Headers
                {
                    "repeatCell": {
                        "range": {"sheetId": sheet_id, "startRowIndex": 5, "endRowIndex": 6, "startColumnIndex": 0, "endColumnIndex": target_cols},
                        "cell": {
                            "userEnteredFormat": {
                                "backgroundColor": {"red": 0.08, "green": 0.20, "blue": 0.49},
                                "textFormat": {"bold": True, "fontSize": 10, "foregroundColor": {"red": 1.0, "green": 1.0, "blue": 1.0}},
                                "horizontalAlignment": "CENTER",
                                "verticalAlignment": "MIDDLE"
                            }
                        },
                        "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)"
                    }
                },
                # Rows 7+: Data Rows Alignment
                {
                    "repeatCell": {
                        "range": {"sheetId": sheet_id, "startRowIndex": 6, "endRowIndex": num_rows, "startColumnIndex": 0, "endColumnIndex": target_cols},
                        "cell": {
                            "userEnteredFormat": {
                                "textFormat": {"fontSize": 10, "foregroundColor": {"red": 0.09, "green": 0.14, "blue": 0.24}},
                                "horizontalAlignment": "CENTER",
                                "verticalAlignment": "MIDDLE"
                            }
                        },
                        "fields": "userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment)"
                    }
                },
                # Left align Name column (Col C, index 2)
                {
                    "repeatCell": {
                        "range": {"sheetId": sheet_id, "startRowIndex": 6, "endRowIndex": num_rows, "startColumnIndex": 2, "endColumnIndex": 3},
                        "cell": {
                            "userEnteredFormat": {
                                "textFormat": {"bold": True, "fontSize": 10, "foregroundColor": {"red": 0.09, "green": 0.14, "blue": 0.24}},
                                "horizontalAlignment": "LEFT",
                                "verticalAlignment": "MIDDLE"
                            }
                        },
                        "fields": "userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment)"
                    }
                },
                # Bold Roll Number column (Col B, index 1)
                {
                    "repeatCell": {
                        "range": {"sheetId": sheet_id, "startRowIndex": 6, "endRowIndex": num_rows, "startColumnIndex": 1, "endColumnIndex": 2},
                        "cell": {
                            "userEnteredFormat": {
                                "textFormat": {"bold": True, "fontSize": 10, "foregroundColor": {"red": 0.12, "green": 0.26, "blue": 0.58}},
                                "horizontalAlignment": "CENTER",
                                "verticalAlignment": "MIDDLE"
                            }
                        },
                        "fields": "userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment)"
                    }
                },
                # Add Grid Borders around all cells
                {
                    "updateBorders": {
                        "range": {"sheetId": sheet_id, "startRowIndex": 0, "endRowIndex": num_rows, "startColumnIndex": 0, "endColumnIndex": target_cols},
                        "top": {"style": "SOLID", "width": 1, "color": {"red": 0.8, "green": 0.85, "blue": 0.9}},
                        "bottom": {"style": "SOLID", "width": 1, "color": {"red": 0.8, "green": 0.85, "blue": 0.9}},
                        "left": {"style": "SOLID", "width": 1, "color": {"red": 0.8, "green": 0.85, "blue": 0.9}},
                        "right": {"style": "SOLID", "width": 1, "color": {"red": 0.8, "green": 0.85, "blue": 0.9}},
                        "innerHorizontal": {"style": "SOLID", "width": 1, "color": {"red": 0.85, "green": 0.88, "blue": 0.92}},
                        "innerVertical": {"style": "SOLID", "width": 1, "color": {"red": 0.85, "green": 0.88, "blue": 0.92}}
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
          Date row = Row 5 (Col E+)
          Header row = Row 6
          Roll No col = Col B (Col 2)
          Status code = "4" (Present) or "A" (Absent)
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

            client = cls._get_client(credentials_json)
            spreadsheet = client.open_by_key(spreadsheet_id)
            try:
                worksheet = spreadsheet.worksheet("Attendance Register")
            except Exception:
                worksheet = spreadsheet.sheet1

            vals = worksheet.get_all_values()
            if len(vals) < 6:
                logger.warning("Sheet does not have SNIST layout headers yet.")
                return False

            row5 = vals[4]
            target_roll = str(roll_number).strip().upper()
            target_date_norm = norm_d(date_str)
            date_col_idx = -1

            for c_idx in range(4, len(row5)):
                d_val = str(row5[c_idx]).strip()
                if d_val and norm_d(d_val) == target_date_norm:
                    date_col_idx = c_idx + 1  # 1-based column
                    break

            # If date column not found, append a new date column at the end using a single atomic update
            if date_col_idx == -1:
                col_0 = max(len(row5), 4)
                date_col_idx = col_0 + 1
                for r_i in range(len(vals)):
                    while len(vals[r_i]) <= col_0:
                        vals[r_i].append("")
                vals[4][col_0] = target_date_norm
                vals[5][col_0] = period_total
                for r_i in range(6, len(vals)):
                    vals[r_i][col_0] = "A"

                # Find student row and set target status
                for r_idx in range(6, len(vals)):
                    row_roll = str(vals[r_idx][1]).strip().upper() if len(vals[r_idx]) > 1 else ""
                    if row_roll == target_roll:
                        vals[r_idx][col_0] = status_code
                        break

                worksheet.update(values=vals, range_name="A1")
                try:
                    cls._apply_sheet_formatting(spreadsheet, worksheet, len(vals), date_col_idx)
                except Exception:
                    pass
                logger.info(f"[GSheets Sync] New date column {target_date_norm} added and marked '{status_code}' for {target_roll} via single atomic update.")
                return True

            # Locate student row by Roll Number in Col B (index 1)
            student_row_idx = -1
            for r_idx in range(6, len(vals)):
                row_roll = str(vals[r_idx][1]).strip().upper() if len(vals[r_idx]) > 1 else ""
                if row_roll == target_roll:
                    student_row_idx = r_idx + 1  # 1-based row
                    break

            if student_row_idx != -1:
                worksheet.update_cell(student_row_idx, date_col_idx, status_code)
                logger.info(f"[GSheets Sync] Roll {target_roll} on {date_str} marked '{status_code}' at Row {student_row_idx}, Col {date_col_idx}")
                return True
            else:
                logger.warning(f"[GSheets Sync] Student Roll {target_roll} not found in sheet.")
                return False

        except Exception as e:
            logger.error(f"Failed to record attendance in Google Sheet: {str(e)}")
            return False

    @classmethod
    def mark_all_absent(
        cls,
        credentials_json: str,
        spreadsheet_id: str
    ) -> bool:
        """
        Resets all student attendance entries to "A" (Absent) across all date columns.
        """
        if not credentials_json or not spreadsheet_id:
            return False

        try:
            client = cls._get_client(credentials_json)
            spreadsheet = client.open_by_key(spreadsheet_id)
            try:
                worksheet = spreadsheet.worksheet("Attendance Register")
            except Exception:
                worksheet = spreadsheet.sheet1

            vals = worksheet.get_all_values()
            if len(vals) < 6:
                return False

            # Update all student rows (Row 7+) for all date columns (Col E+) to "A"
            for r_idx in range(6, len(vals)):
                row_len = len(vals[r_idx])
                for c_idx in range(4, row_len):
                    vals[r_idx][c_idx] = "A"

            worksheet.update(values=vals, range_name="A1")
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
        Present rolls get "4" (or period_total), Absent rolls get "A".
        Eliminates N+1 HTTP round-trips and Google Sheets API write quota throttling.
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

            client = cls._get_client(credentials_json)
            spreadsheet = client.open_by_key(spreadsheet_id)
            try:
                worksheet = spreadsheet.worksheet("Attendance Register")
            except Exception:
                worksheet = spreadsheet.sheet1

            vals = worksheet.get_all_values()
            if len(vals) < 6:
                logger.warning("Sheet does not have SNIST layout headers yet.")
                return False

            row5 = vals[4]
            target_date_norm = norm_d(date_str)
            date_col_0idx = -1

            # Locate date column in row 5 (columns E+, 0-based index 4+)
            for c_idx in range(4, len(row5)):
                d_val = str(row5[c_idx]).strip()
                if d_val and norm_d(d_val) == target_date_norm:
                    date_col_0idx = c_idx
                    break

            # If date column not found, append a new date column at the end
            if date_col_0idx == -1:
                date_col_0idx = max(len(row5), 4)
                for r_i in range(len(vals)):
                    while len(vals[r_i]) <= date_col_0idx:
                        vals[r_i].append("")
                vals[4][date_col_0idx] = target_date_norm
                vals[5][date_col_0idx] = str(period_total)

            present_set = {str(r).strip().upper() for r in present_rolls}

            # Update every student row in memory
            for r_idx in range(6, len(vals)):
                while len(vals[r_idx]) <= date_col_0idx:
                    vals[r_idx].append("")
                row_roll = str(vals[r_idx][1]).strip().upper() if len(vals[r_idx]) > 1 else ""
                if row_roll:
                    vals[r_idx][date_col_0idx] = str(period_total) if row_roll in present_set else "A"

            # Execute single atomic update across the entire sheet
            worksheet.update(values=vals, range_name="A1")
            try:
                cls._apply_sheet_formatting(spreadsheet, worksheet, len(vals), date_col_0idx + 1)
            except Exception:
                pass

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
        Marks all students as Present ("4") across all date columns in a single batch call.
        """
        if not credentials_json or not spreadsheet_id:
            return False

        try:
            client = cls._get_client(credentials_json)
            spreadsheet = client.open_by_key(spreadsheet_id)
            try:
                worksheet = spreadsheet.worksheet("Attendance Register")
            except Exception:
                worksheet = spreadsheet.sheet1

            vals = worksheet.get_all_values()
            if len(vals) < 6:
                return False

            # Update all student rows (Row 7+) for all date columns (Col E+) to "4"
            for r_idx in range(6, len(vals)):
                row_len = len(vals[r_idx])
                for c_idx in range(4, row_len):
                    vals[r_idx][c_idx] = "4"

            worksheet.update(values=vals, range_name="A1")
            logger.info(f"Successfully marked all students as PRESENT (4) in Google Sheet ID: {spreadsheet_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to batch mark all present: {str(e)}")
            return False



