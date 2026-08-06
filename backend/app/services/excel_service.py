import os
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from copy import copy
from datetime import datetime, date
from typing import Optional, Dict, List, Tuple, Any

from app.core.config import settings


class ExcelAttendanceService:
    """
    Service for reading/writing attendance to the official SNIST Excel register.
    
    Handles the actual SNIST format:
      Row 1-4: Merged header cells (college name, department, training, dates range)
      Row 5:   Date columns (Col E onwards) — mixed str ("15/6/26") and datetime objects
      Row 6:   Column headers: SNO | ROLL NO | NAME | Agency | (period totals under dates)
      Row 7+:  Student rows with roll numbers in Col B
    """

    # Normalizes a date value (string or datetime) to a comparable "D/M/YY" string
    @staticmethod
    def _normalize_date(val: Any) -> str:
        """Normalize a date cell value into d/m/yy format for comparison."""
        if val is None:
            return ""
        if isinstance(val, (datetime, date)):
            return f"{val.day}/{val.month}/{str(val.year)[-2:]}"
        s = str(val).strip()
        if not s:
            return ""
        # Try parsing common formats
        for fmt in ["%d/%m/%y", "%d/%m/%Y", "%d-%m-%y", "%d-%m-%Y", "%Y-%m-%d"]:
            try:
                dt = datetime.strptime(s, fmt)
                return f"{dt.day}/{dt.month}/{str(dt.year)[-2:]}"
            except ValueError:
                continue
        return s  # Return as-is if no format matched

    @staticmethod
    def _find_layout(ws) -> Tuple[int, int, int, int]:
        """
        Finds the layout of the SNIST Excel sheet.
        Returns: (date_row, header_row, roll_no_col, first_date_col)
        
        For the SNIST format:
          date_row = 5 (where date columns are)
          header_row = 6 (SNO, ROLL NO, NAME, Agency...)
          roll_no_col = 2 (Column B)
          first_date_col = 5 (Column E)
        """
        date_row = -1
        header_row = -1
        roll_no_col = -1
        first_date_col = -1

        # Scan rows 1-10 to find the row with "ROLL NO" or "ROLL NUMBER"
        for r in range(1, min(11, ws.max_row + 1)):
            for c in range(1, min(10, ws.max_column + 1)):
                val = str(ws.cell(row=r, column=c).value or "").strip().upper()
                if val in ["ROLL NO", "ROLL NUMBER", "HTNO", "HT NO", "ROLLNO", "ROLL_NUMBER", "REG NO"]:
                    header_row = r
                    roll_no_col = c
                    break
            if header_row != -1:
                break

        if header_row == -1:
            header_row = 6
            roll_no_col = 2

        # The date row is typically one row above the header row
        date_row = header_row - 1
        if date_row < 1:
            date_row = header_row  # Fallback

        # Find the first date column by scanning the date row for date-like values
        for c in range(1, ws.max_column + 1):
            val = ws.cell(row=date_row, column=c).value
            if val is None:
                continue
            if isinstance(val, (datetime, date)):
                first_date_col = c
                break
            s = str(val).strip()
            # Check if it looks like a date (contains / or - and has digits)
            if (('/' in s or '-' in s) and any(ch.isdigit() for ch in s) and len(s) >= 5):
                # Extra check: not a sentence
                if len(s) < 15:
                    first_date_col = c
                    break

        if first_date_col == -1:
            first_date_col = 5  # Fallback to column E

        return date_row, header_row, roll_no_col, first_date_col

    @staticmethod
    def _find_student_row(ws, header_row: int, roll_no_col: int, target_roll_number: str) -> int:
        """Locates student row by Roll Number. Returns row index or -1."""
        clean_target = str(target_roll_number).strip().upper()
        for r in range(header_row + 1, ws.max_row + 1):
            cell_val = str(ws.cell(row=r, column=roll_no_col).value or "").strip().upper()
            if cell_val == clean_target:
                return r
        return -1

    @classmethod
    def _find_or_create_date_column(cls, ws, date_row: int, date_str: str, first_date_col: int) -> int:
        """
        Locates today's date column in the date row.
        If not found, appends a new column after the last date column.
        Preserves styles.
        """
        target_normalized = cls._normalize_date(date_str)
        last_date_col = -1

        # Scan existing date columns
        for c in range(first_date_col, ws.max_column + 1):
            val = ws.cell(row=date_row, column=c).value
            normalized = cls._normalize_date(val)
            if not normalized:
                continue
            last_date_col = c
            if normalized == target_normalized:
                return c  # Found existing column for this date

        # Date column not found — create a new one
        if last_date_col == -1:
            target_col = ws.max_column + 1
            template_col = ws.max_column
        else:
            target_col = last_date_col + 1
            template_col = last_date_col
            if target_col <= ws.max_column:
                ws.insert_cols(target_col)

        # Write the date header
        template_header_cell = ws.cell(row=date_row, column=template_col)
        target_header_cell = ws.cell(row=date_row, column=target_col)
        target_header_cell.value = date_str

        # Copy style from template
        if template_header_cell.has_style:
            target_header_cell.font = copy(template_header_cell.font)
            target_header_cell.fill = copy(template_header_cell.fill)
            target_header_cell.border = copy(template_header_cell.border)
            target_header_cell.alignment = copy(template_header_cell.alignment)

        # Also copy the "total" value in the header_row (row below date_row)
        header_row = date_row + 1
        template_total_cell = ws.cell(row=header_row, column=template_col)
        target_total_cell = ws.cell(row=header_row, column=target_col)
        target_total_cell.value = template_total_cell.value
        if template_total_cell.has_style:
            target_total_cell.font = copy(template_total_cell.font)
            target_total_cell.fill = copy(template_total_cell.fill)
            target_total_cell.border = copy(template_total_cell.border)
            target_total_cell.alignment = copy(template_total_cell.alignment)

        # Set column width
        col_letter_template = openpyxl.utils.get_column_letter(template_col)
        col_letter_target = openpyxl.utils.get_column_letter(target_col)
        if col_letter_template in ws.column_dimensions:
            ws.column_dimensions[col_letter_target].width = ws.column_dimensions[col_letter_template].width
        else:
            ws.column_dimensions[col_letter_target].width = 8

        # Copy student row formatting
        for r in range(header_row + 1, ws.max_row + 1):
            tmpl_cell = ws.cell(row=r, column=template_col)
            targ_cell = ws.cell(row=r, column=target_col)
            if tmpl_cell.has_style:
                targ_cell.font = copy(tmpl_cell.font)
                targ_cell.fill = copy(tmpl_cell.fill)
                targ_cell.border = copy(tmpl_cell.border)
                targ_cell.alignment = copy(tmpl_cell.alignment)

        return target_col

    @classmethod
    def record_attendance_in_excel(
        cls,
        file_path: str,
        roll_number: str,
        date_str: str,
        status_code: str = "4",   # Present = 4, Absent = A
        overwrite: bool = False
    ) -> Dict[str, Any]:
        """
        Updates attendance in the official SNIST Excel workbook.
        Preserves all formatting, merged cells, fonts, borders.
        
        Args:
            file_path: Path to the Excel file
            roll_number: Student roll number (e.g., "24311A0101")
            date_str: Date string in d/m/yy format (e.g., "28/7/26")
            status_code: "4" for Present, "A" for Absent
            overwrite: If True, overwrite existing attendance value
        """
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Master attendance file not found at: {file_path}")

        wb = openpyxl.load_workbook(file_path, data_only=False)
        ws = wb.active

        date_row, header_row, roll_no_col, first_date_col = cls._find_layout(ws)
        student_row = cls._find_student_row(ws, header_row, roll_no_col, roll_number)

        if student_row == -1:
            wb.close()
            return {
                "status": "NOT_FOUND",
                "message": f"Student with Roll Number '{roll_number}' not found in Excel sheet. Attendance saved in database only.",
            }

        date_col = cls._find_or_create_date_column(ws, date_row, date_str, first_date_col)

        target_cell = ws.cell(row=student_row, column=date_col)
        existing_val = str(target_cell.value or "").strip()

        # Check duplicate
        if existing_val and not overwrite:
            if existing_val == str(status_code):
                wb.close()
                return {
                    "status": "DUPLICATE",
                    "message": f"Attendance already '{existing_val}' for {roll_number} on {date_str}",
                    "row": student_row,
                    "col": date_col,
                    "previous_value": existing_val
                }

        # Write attendance value
        if status_code == "A":
            target_cell.value = "A"
        elif status_code.isdigit():
            target_cell.value = int(status_code)
        else:
            target_cell.value = status_code

        target_cell.alignment = Alignment(horizontal="center", vertical="center")

        wb.save(file_path)
        wb.close()

        return {
            "status": "SUCCESS",
            "message": f"Recorded '{status_code}' for {roll_number} on {date_str}",
            "file_path": file_path,
            "row": student_row,
            "col": date_col,
            "written_value": status_code
        }

    @classmethod
    def get_all_roll_numbers(cls, file_path: str) -> List[str]:
        """Returns all roll numbers from the Excel sheet."""
        if not os.path.exists(file_path):
            return []
        wb = openpyxl.load_workbook(file_path, data_only=True)
        ws = wb.active
        _, header_row, roll_no_col, _ = cls._find_layout(ws)
        
        rolls = []
        for r in range(header_row + 1, ws.max_row + 1):
            val = str(ws.cell(row=r, column=roll_no_col).value or "").strip()
            if val:
                rolls.append(val.upper())
        wb.close()
        return rolls

    @classmethod
    def parse_student_import_excel(cls, file_path: str) -> List[Dict[str, Any]]:
        """
        Parses uploaded student Excel file to import students into system DB.
        Works with the SNIST format.
        """
        wb = openpyxl.load_workbook(file_path, data_only=True)
        ws = wb.active

        _, header_row, roll_no_col, _ = cls._find_layout(ws)

        # Map columns in header row
        mapping = {}
        for c in range(1, ws.max_column + 1):
            val = str(ws.cell(row=header_row, column=c).value or "").strip()
            if val:
                mapping[val.lower()] = c

        students = []
        for r in range(header_row + 1, ws.max_row + 1):
            roll = str(ws.cell(row=r, column=roll_no_col).value or "").strip()
            if not roll:
                continue

            # Find name column
            name_val = ""
            for key, col_idx in mapping.items():
                if "name" in key:
                    name_val = str(ws.cell(row=r, column=col_idx).value or "").strip()
                    break
            if not name_val:
                name_val = str(ws.cell(row=r, column=roll_no_col + 1).value or "").strip()

            email_val = ""
            mobile_val = ""
            agency_val = "Regular"
            dept_val = ""
            year_val = ""
            sec_val = ""

            for key, col_idx in mapping.items():
                val = str(ws.cell(row=r, column=col_idx).value or "").strip()
                if "email" in key: email_val = val
                elif "mobile" in key or "phone" in key: mobile_val = val
                elif "agency" in key: agency_val = val
                elif "dept" in key: dept_val = val
                elif "year" in key: year_val = val
                elif "sec" in key: sec_val = val

            students.append({
                "roll_number": roll,
                "name": name_val or f"Student {roll}",
                "email": email_val,
                "mobile": mobile_val,
                "agency": agency_val,
                "department": dept_val,
                "year": year_val,
                "section": sec_val
            })

        wb.close()
        return students
