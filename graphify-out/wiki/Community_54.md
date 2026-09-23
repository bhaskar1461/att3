# Community 54

> 19 nodes · cohesion 0.16

## Key Concepts

- **ExcelAttendanceService** (18 connections) — `backend/app/services/excel_service.py`
- **.record_attendance_in_excel()** (10 connections) — `backend/app/services/excel_service.py`
- **._find_layout()** (5 connections) — `backend/app/services/excel_service.py`
- **.parse_student_import_excel()** (5 connections) — `backend/app/services/excel_service.py`
- **._find_or_create_date_column()** (4 connections) — `backend/app/services/excel_service.py`
- **._normalize_date()** (4 connections) — `backend/app/services/excel_service.py`
- **._find_student_row()** (3 connections) — `backend/app/services/excel_service.py`
- **.get_all_roll_numbers()** (3 connections) — `backend/app/services/excel_service.py`
- **Any** (3 connections)
- **TestExcelService** (3 connections) — `backend/tests/test_excel.py`
- **.test_excel_attendance_update()** (2 connections) — `backend/tests/test_excel.py`
- **Locates student row by Roll Number. Returns row index or -1.** (1 connections) — `backend/app/services/excel_service.py`
- **Locates today's date column in the date row. If not found, appends a new column…** (1 connections) — `backend/app/services/excel_service.py`
- **Service for reading/writing attendance to the official SNIST Excel register.…** (1 connections) — `backend/app/services/excel_service.py`
- **Updates attendance in the official SNIST Excel workbook. Preserves all…** (1 connections) — `backend/app/services/excel_service.py`
- **Returns all roll numbers from the Excel sheet.** (1 connections) — `backend/app/services/excel_service.py`
- **Normalize a date cell value into d/m/yy format for comparison.** (1 connections) — `backend/app/services/excel_service.py`
- **Parses uploaded student Excel file to import students into system DB. Works…** (1 connections) — `backend/app/services/excel_service.py`
- **Finds the layout of the SNIST Excel sheet. Returns: (date_row, header_row,…** (1 connections) — `backend/app/services/excel_service.py`

## Relationships

- [Community 24](Community_24.md) (3 shared connections)
- [Community 32](Community_32.md) (3 shared connections)
- [Community 4](Community_4.md) (3 shared connections)
- [Community 15](Community_15.md) (2 shared connections)
- [Community 97](Community_97.md) (2 shared connections)
- [Community 9](Community_9.md) (1 shared connections)

## Source Files

- `backend/app/services/excel_service.py`
- `backend/tests/test_excel.py`

## Audit Trail

- EXTRACTED: 36 (88%)
- INFERRED: 5 (12%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*