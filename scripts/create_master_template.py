import os
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

def generate_official_master_attendance_template():
    output_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend", "data", "master_templates")
    os.makedirs(output_dir, exist_ok=True)
    target_file = os.path.join(output_dir, "Official_Attendance_Register.xlsx")

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Attendance Register"

    # Define Palette & Fonts
    navy_fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
    header_fill = PatternFill(start_color="0F172A", end_color="0F172A", fill_type="solid")
    date_fill = PatternFill(start_color="334155", end_color="334155", fill_type="solid")

    white_title_font = Font(name="Calibri", size=14, bold=True, color="FFFFFF")
    white_sub_font = Font(name="Calibri", size=11, bold=True, color="E2E8F0")
    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    data_font = Font(name="Calibri", size=11, bold=False, color="000000")
    bold_data_font = Font(name="Calibri", size=11, bold=True, color="000000")

    thin_border = Border(
        left=Side(style='thin', color='CBD5E1'),
        right=Side(style='thin', color='CBD5E1'),
        top=Side(style='thin', color='CBD5E1'),
        bottom=Side(style='thin', color='CBD5E1')
    )

    # 1. College Header Block
    ws.merge_cells("A1:K1")
    ws["A1"] = "SREENIDHI INSTITUTE OF SCIENCE AND TECHNOLOGY"
    ws["A1"].font = white_title_font
    ws["A1"].fill = navy_fill
    ws["A1"].alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[1].height = 30

    ws.merge_cells("A2:K2")
    ws["A2"] = "DEPARTMENT OF COMPUTER SCIENCE & ENGINEERING — OFFICIAL ATTENDANCE REGISTER"
    ws["A2"].font = white_sub_font
    ws["A2"].fill = navy_fill
    ws["A2"].alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[2].height = 22

    # Metadata Rows
    ws["A3"] = "Academic Year:"
    ws["B3"] = "2026-2027"
    ws["D3"] = "Year / Sem:"
    ws["E3"] = "III Year I Sem"
    ws["G3"] = "Section:"
    ws["H3"] = "CSE-A"

    for r in range(3, 5):
        for c in range(1, 12):
            cell = ws.cell(row=r, column=c)
            cell.font = Font(name="Calibri", size=10, bold=(c in [1, 4, 7]), color="000000")

    # 2. Main Table Headers (Row 6)
    headers = ["S.No", "Roll Number", "Student Name", "Agency", "28/07/2026", "29/07/2026", "30/07/2026"]
    ws.row_dimensions[6].height = 28

    for c_idx, h in enumerate(headers, 1):
        cell = ws.cell(row=6, column=c_idx)
        cell.value = h
        cell.font = header_font
        cell.fill = header_fill if c_idx <= 4 else date_fill
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = thin_border

    # Sample Students Data
    sample_students = [
        (1, "21311A0501", "AARAV SHARMA", "Regular", 4, 4, 4),
        (2, "21311A0502", "ADITI VERMA", "Regular", 4, 4, "A"),
        (3, "21311A0503", "AKASH REDDY", "Regular", 4, "A", 4),
        (4, "21311A0504", "ANANYA KULKARNI", "Regular", 4, 4, 4),
        (5, "21311A0505", "BHAAVIK PATEL", "Regular", "A", 4, 4),
        (6, "21311A0506", "CHETAN GUPTA", "Regular", 4, 4, 4),
        (7, "21311A0507", "DEEPIKA RAO", "Regular", 4, 4, 4),
        (8, "21311A0508", "ESHWAR TEJA", "Regular", 4, "A", 4),
        (9, "21311A0509", "FARHAN AHMED", "Regular", 4, 4, 4),
        (10, "21311A0510", "GAYATHRI DEVI", "Regular", 4, 4, 4),
    ]

    start_row = 7
    for row_idx, data in enumerate(sample_students, start=start_row):
        ws.row_dimensions[row_idx].height = 20
        fill = PatternFill(start_color="F8FAFC" if row_idx % 2 == 0 else "FFFFFF", fill_type="solid")
        for col_idx, val in enumerate(data, 1):
            cell = ws.cell(row=row_idx, column=col_idx)
            cell.value = val
            cell.font = bold_data_font if col_idx == 2 else data_font
            cell.fill = fill
            cell.border = thin_border
            cell.alignment = Alignment(horizontal="center" if col_idx in [1, 2, 4, 5, 6, 7] else "left", vertical="center")

    # Column Widths
    col_widths = {1: 8, 2: 18, 3: 26, 4: 12, 5: 14, 6: 14, 7: 14}
    for col_idx, width in col_widths.items():
        ws.column_dimensions[get_column_letter(col_idx)].width = width

    wb.save(target_file)
    print(f"Generated official master attendance register template at: {target_file}")

if __name__ == "__main__":
    generate_official_master_attendance_template()
