import os
import sys
import re
from datetime import datetime
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

# Ensure backend directory is in python path
backend_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend")
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.core.database import SessionLocal
from app.models.models import Student, AttendanceSession, AttendanceRecord, AttendanceStatus, SessionStatus, Teacher, Subject, Section
from app.core.config import settings
from app.services.gsheets_service import GoogleSheetsService

def parse_date_to_iso_and_display(date_raw: str):
    s = str(date_raw).strip()
    # Normalize common date formats
    for fmt in ["%d/%m/%Y", "%d/%m/%y", "%d-%m-%Y", "%d-%m-%y", "%Y-%m-%d"]:
        try:
            dt = datetime.strptime(s, fmt)
            return dt.strftime("%Y-%m-%d"), dt.strftime("%d/%m/%Y")
        except ValueError:
            continue
    parts = s.replace("-", "/").split("/")
    if len(parts) == 3:
        d = int(parts[0])
        m = int(parts[1])
        y = int(parts[2])
        if y < 100:
            y += 2000
        dt = datetime(y, m, d)
        return dt.strftime("%Y-%m-%d"), dt.strftime("%d/%m/%Y")
    raise ValueError(f"Cannot parse date: {date_raw}")

def sync_all_dates_from_gsheet():
    creds = settings.GOOGLE_CREDENTIALS_FILE or os.path.join(backend_dir, "credentials.json")
    sheet_id = "1CDeeivsdptGtgJpgK6XN9o6AKqy6HAIucv45D0Os6ZY"

    print(f"[*] Connecting to Google Sheet ID: {sheet_id}...")
    client = GoogleSheetsService._get_client(creds)
    sh = client.open_by_key(sheet_id)
    ws = None
    for title in ["CSE-CS", "Attendance Register"]:
        try:
            ws = sh.worksheet(title)
            print(f"[*] Found worksheet: {title}")
            break
        except Exception:
            pass
    if not ws:
        ws = sh.sheet1
        print(f"[*] Using sheet1: {ws.title}")

    vals = ws.get_all_values()
    if len(vals) < 7:
        print("[!] Sheet has insufficient rows.")
        return

    row4 = vals[3]
    row6 = vals[5]

    # Detect all date columns in Row 6 (starting at col index 6)
    date_columns = [] # list of dict: {col_idx, raw_str, iso_date, display_date, conducted_periods}
    for c_idx in range(6, len(row6)):
        val = str(row6[c_idx]).strip()
        if not val or val.lower() == "total":
            continue
        try:
            iso_d, disp_d = parse_date_to_iso_and_display(val)
            # Get conducted period from row 4
            p_val = "4"
            if c_idx < len(row4) and str(row4[c_idx]).strip().isdigit():
                p_val = str(max(1, min(8, int(row4[c_idx]))))
            date_columns.append({
                "col_idx": c_idx,
                "raw_str": val,
                "iso_date": iso_d,
                "display_date": disp_d,
                "conducted_periods": int(p_val)
            })
        except Exception as err:
            print(f"[-] Skipping non-date column {c_idx} '{val}': {err}")

    print(f"[+] Found {len(date_columns)} valid date sessions in Google Sheet:")
    for dc in date_columns:
        print(f"    - {dc['display_date']} ({dc['iso_date']}): {dc['conducted_periods']} periods")

    # Map sheet students by roll number: roll -> row_idx
    sheet_students = {}
    for r_idx in range(6, len(vals)):
        row = vals[r_idx]
        if len(row) > 1 and row[1].strip():
            roll = row[1].strip().upper()
            sheet_students[roll] = row

    print(f"[+] Found {len(sheet_students)} student rows in Google Sheet.")

    # 1. Synchronize into the Database (AttendanceSession and AttendanceRecord)
    db = SessionLocal()
    try:
        # Teacher Sowjanya Ma'am (id 4), Subject CET (id 1), Section CS-A (id 1)
        section = db.query(Section).filter(Section.id == 1).first()
        teacher = db.query(Teacher).filter(Teacher.id == 4).first()
        subject = db.query(Subject).filter(Subject.id == 1).first()

        db_students = db.query(Student).filter(Student.section_id == 1).order_by(Student.roll_number).all()
        print(f"[+] Found {len(db_students)} students in DB Section CS-A.")

        today_iso = datetime.now().strftime("%Y-%m-%d")

        total_records_updated = 0
        sessions_created = 0

        for dc in date_columns:
            iso_d = dc["iso_date"]
            cond_p = dc["conducted_periods"]

            session = db.query(AttendanceSession).filter(
                AttendanceSession.section_id == 1,
                AttendanceSession.session_date == iso_d
            ).first()

            if not session:
                status = SessionStatus.OPEN if iso_d == today_iso else SessionStatus.LOCKED
                session = AttendanceSession(
                    section_id=1,
                    subject_id=subject.id if subject else 1,
                    teacher_id=teacher.id if teacher else 4,
                    session_date=iso_d,
                    period=f"Period 1-{cond_p} ({cond_p} Periods)",
                    status=status
                )
                db.add(session)
                db.flush()
                sessions_created += 1

            # Update records for all students for this session
            existing_recs = db.query(AttendanceRecord).filter(AttendanceRecord.session_id == session.id).all()
            rec_map = {r.roll_number.upper(): r for r in existing_recs}

            for st in db_students:
                roll = st.roll_number.upper()
                sheet_row = sheet_students.get(roll)
                
                # Check status in sheet
                is_present = False
                p_cnt = cond_p
                if sheet_row and dc["col_idx"] < len(sheet_row):
                    cell_val = str(sheet_row[dc["col_idx"]]).strip().upper()
                    if cell_val in ["1", "2", "3", "4", "5", "6", "7", "8", "PRESENT"]:
                        is_present = True
                        if cell_val.isdigit():
                            p_cnt = max(1, min(8, int(cell_val)))
                    elif cell_val == "A" or cell_val == "ABSENT":
                        is_present = False
                    elif cell_val == "":
                        is_present = False
                
                status_enum = AttendanceStatus.PRESENT if is_present else AttendanceStatus.ABSENT
                record_periods = p_cnt if is_present else 0

                rec = rec_map.get(roll)
                if rec:
                    rec.status = status_enum
                    rec.period_count = record_periods
                    rec.session_date = iso_d
                else:
                    new_rec = AttendanceRecord(
                        session_id=session.id,
                        student_id=st.id,
                        roll_number=st.roll_number,
                        session_date=iso_d,
                        status=status_enum,
                        period_count=record_periods,
                        scan_mode="MANUAL"
                    )
                    db.add(new_rec)
                total_records_updated += 1

        db.commit()
        print(f"[+] Database Sync Complete: {sessions_created} sessions created, {total_records_updated} attendance records synchronized.")

        # 2. Synchronize Official Master Excel Register
        excel_path = os.path.join(backend_dir, "data", "master_templates", "Official_Attendance_Register.xlsx")
        os.makedirs(os.path.dirname(excel_path), exist_ok=True)

        wb = openpyxl.Workbook()
        ws_x = wb.active
        ws_x.title = "Attendance Register"

        # Define Styles
        navy_fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
        header_fill = PatternFill(start_color="0F172A", end_color="0F172A", fill_type="solid")
        date_fill = PatternFill(start_color="334155", end_color="334155", fill_type="solid")
        light_date_fill = PatternFill(start_color="475569", end_color="475569", fill_type="solid")
        total_fill = PatternFill(start_color="0284C7", end_color="0284C7", fill_type="solid")

        white_title_font = Font(name="Calibri", size=14, bold=True, color="FFFFFF")
        white_sub_font = Font(name="Calibri", size=11, bold=True, color="E2E8F0")
        header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
        data_font = Font(name="Calibri", size=11, bold=False, color="000000")
        bold_data_font = Font(name="Calibri", size=11, bold=True, color="000000")
        present_font = Font(name="Calibri", size=11, bold=True, color="166534") # Dark green
        absent_font = Font(name="Calibri", size=11, bold=True, color="991B1B") # Dark red

        present_fill = PatternFill(start_color="DCFCE7", end_color="DCFCE7", fill_type="solid") # Light green
        absent_fill = PatternFill(start_color="FEE2E2", end_color="FEE2E2", fill_type="solid") # Light red

        thin_border = Border(
            left=Side(style='thin', color='CBD5E1'),
            right=Side(style='thin', color='CBD5E1'),
            top=Side(style='thin', color='CBD5E1'),
            bottom=Side(style='thin', color='CBD5E1')
        )

        num_date_cols = len(date_columns)
        total_cols = 4 + num_date_cols + 1 # SNO, ROLL, NAME, AGENCY + Dates + Total

        # Headers
        last_letter = get_column_letter(total_cols)
        ws_x.merge_cells(f"A1:{last_letter}1")
        ws_x["A1"] = "SREENIDHI INSTITUTE OF SCIENCE AND TECHNOLOGY"
        ws_x["A1"].font = white_title_font
        ws_x["A1"].fill = navy_fill
        ws_x["A1"].alignment = Alignment(horizontal="center", vertical="center")
        ws_x.row_dimensions[1].height = 30

        ws_x.merge_cells(f"A2:{last_letter}2")
        ws_x["A2"] = "DEPARTMENT OF COMPUTER SCIENCE & ENGINEERING — OFFICIAL ATTENDANCE REGISTER"
        ws_x["A2"].font = white_sub_font
        ws_x["A2"].fill = navy_fill
        ws_x["A2"].alignment = Alignment(horizontal="center", vertical="center")
        ws_x.row_dimensions[2].height = 22

        # Metadata Rows
        ws_x["A3"] = "Academic Year:"
        ws_x["B3"] = "2026-2027"
        ws_x["D3"] = "Year / Sem:"
        ws_x["E3"] = "III Year I Sem"
        ws_x["G3"] = "Section:"
        ws_x["H3"] = "CS-A"

        ws_x["A4"] = "Subject:"
        ws_x["B4"] = "Career Enhancement Training (CET)"
        ws_x["D4"] = "Faculty:"
        ws_x["E4"] = "Mrs. N. Sowjanya"
        ws_x["G4"] = "Periods:"
        ws_x["H4"] = "4 Periods"

        # Row 5: Date Headers (Col E onwards)
        ws_x.row_dimensions[5].height = 24
        for c in range(1, 5):
            cell = ws_x.cell(row=5, column=c)
            cell.fill = header_fill
            cell.border = thin_border

        for idx, dc in enumerate(date_columns):
            c_pos = 5 + idx
            c_cell = ws_x.cell(row=5, column=c_pos)
            c_cell.value = dc["display_date"]
            c_cell.font = header_font
            c_cell.fill = date_fill
            c_cell.alignment = Alignment(horizontal="center", vertical="center")
            c_cell.border = thin_border

        # Total Header in Row 5
        tot_c_pos = 5 + num_date_cols
        tot_cell = ws_x.cell(row=5, column=tot_c_pos)
        tot_cell.value = "Total"
        tot_cell.font = header_font
        tot_cell.fill = total_fill
        tot_cell.alignment = Alignment(horizontal="center", vertical="center")
        tot_cell.border = thin_border

        # Row 6: Main Column Headers + Conducted Periods
        ws_x.row_dimensions[6].height = 26
        col_headers = ["S.No", "Roll Number", "Student Name", "Agency"]
        for c_pos, h_text in enumerate(col_headers, 1):
            cell = ws_x.cell(row=6, column=c_pos)
            cell.value = h_text
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            cell.border = thin_border

        for idx, dc in enumerate(date_columns):
            c_pos = 5 + idx
            cell = ws_x.cell(row=6, column=c_pos)
            cell.value = dc["conducted_periods"]
            cell.font = header_font
            cell.fill = light_date_fill
            cell.alignment = Alignment(horizontal="center", vertical="center")
            cell.border = thin_border

        first_date_letter = get_column_letter(5)
        last_date_letter = get_column_letter(5 + num_date_cols - 1)
        tot_col_letter = get_column_letter(tot_c_pos)

        tot_p_cell = ws_x.cell(row=6, column=tot_c_pos)
        tot_p_cell.value = f"=SUM({first_date_letter}6:{last_date_letter}6)"
        tot_p_cell.font = header_font
        tot_p_cell.fill = total_fill
        tot_p_cell.alignment = Alignment(horizontal="center", vertical="center")
        tot_p_cell.border = thin_border

        # Student Rows (Rows 7 onwards)
        start_row = 7
        for idx, s in enumerate(db_students, 1):
            row_idx = start_row + idx - 1
            ws_x.row_dimensions[row_idx].height = 20

            # Base info
            ws_x.cell(row=row_idx, column=1, value=idx).alignment = Alignment(horizontal="center", vertical="center")
            r_cell = ws_x.cell(row=row_idx, column=2, value=s.roll_number)
            r_cell.font = bold_data_font
            r_cell.alignment = Alignment(horizontal="center", vertical="center")

            n_cell = ws_x.cell(row=row_idx, column=3, value=s.name)
            n_cell.alignment = Alignment(horizontal="left", vertical="center")

            ws_x.cell(row=row_idx, column=4, value=s.agency or "Regular").alignment = Alignment(horizontal="center", vertical="center")

            for c in range(1, 5):
                ws_x.cell(row=row_idx, column=c).border = thin_border
                ws_x.cell(row=row_idx, column=c).font = data_font if c != 2 else bold_data_font

            # Date marks from Google Sheet
            roll = s.roll_number.upper()
            sheet_row = sheet_students.get(roll)

            for d_idx, dc in enumerate(date_columns):
                c_pos = 5 + d_idx
                mark_val = "A"
                if sheet_row and dc["col_idx"] < len(sheet_row):
                    raw_val = str(sheet_row[dc["col_idx"]]).strip().upper()
                    if raw_val in ["1", "2", "3", "4", "5", "6", "7", "8"]:
                        mark_val = int(raw_val)
                    elif raw_val == "PRESENT":
                        mark_val = dc["conducted_periods"]
                    elif raw_val in ["A", "ABSENT", ""]:
                        mark_val = "A"

                cell = ws_x.cell(row=row_idx, column=c_pos, value=mark_val)
                cell.border = thin_border
                cell.alignment = Alignment(horizontal="center", vertical="center")
                if mark_val == "A":
                    cell.font = absent_font
                    cell.fill = absent_fill
                else:
                    cell.font = present_font
                    cell.fill = present_fill

            # Total formula
            tot_val_cell = ws_x.cell(row=row_idx, column=tot_c_pos, value=f"=SUM({first_date_letter}{row_idx}:{last_date_letter}{row_idx})")
            tot_val_cell.font = bold_data_font
            tot_val_cell.border = thin_border
            tot_val_cell.alignment = Alignment(horizontal="center", vertical="center")

        # Column widths
        ws_x.column_dimensions["A"].width = 8
        ws_x.column_dimensions["B"].width = 18
        ws_x.column_dimensions["C"].width = 32
        ws_x.column_dimensions["D"].width = 14
        for idx in range(num_date_cols):
            ws_x.column_dimensions[get_column_letter(5 + idx)].width = 13
        ws_x.column_dimensions[tot_col_letter].width = 14

        wb.save(excel_path)
        print(f"[+] Master Excel Register updated at: {excel_path}")

    finally:
        db.close()

if __name__ == "__main__":
    sync_all_dates_from_gsheet()
