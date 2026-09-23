# Community 39

> 25 nodes · cohesion 0.15

## Key Concepts

- **reports.py** (36 connections) — `backend/app/api/reports.py`
- **FastAPI** (23 connections)
- **ReportService** (11 connections) — `backend/app/services/report_service.py`
- **Session** (9 connections)
- **export_csv_report()** (7 connections) — `backend/app/api/reports.py`
- **export_excel_report()** (7 connections) — `backend/app/api/reports.py`
- **export_pdf_report()** (7 connections) — `backend/app/api/reports.py`
- **fetch_filtered_records()** (7 connections) — `backend/app/api/reports.py`
- **get_low_attendance_report()** (7 connections) — `backend/app/api/reports.py`
- **get_report_user()** (6 connections) — `backend/app/api/reports.py`
- **get** (6 connections)
- **stream_filtered_records()** (6 connections) — `backend/app/api/reports.py`
- **.generate_excel_report()** (4 connections) — `backend/app/services/report_service.py`
- **.generate_pdf_report()** (4 connections) — `backend/app/services/report_service.py`
- **.stream_csv_report()** (4 connections) — `backend/app/services/report_service.py`
- **Any** (3 connections)
- **.generate_csv_report()** (3 connections) — `backend/app/services/report_service.py`
- **.test_streaming_csv_export()** (3 connections) — `backend/tests/test_week9_scale_and_offline.py`
- **app_services_report_service** (2 connections)
- **Request** (1 connections)
- **Streams CSV format attendance report row-by-row with O(1) constant memory.** (1 connections) — `backend/app/services/report_service.py`
- **Generates CSV format attendance report.** (1 connections) — `backend/app/services/report_service.py`
- **Generates formatted PDF report using ReportLab.** (1 connections) — `backend/app/services/report_service.py`
- **Generates clean formatted Excel report from attendance records.** (1 connections) — `backend/app/services/report_service.py`
- **Verifies ReportService.stream_csv_report yields valid CSV rows without holding…** (1 connections) — `backend/tests/test_week9_scale_and_offline.py`

## Relationships

- [Community 0](Community_0.md) (13 shared connections)
- [Community 1](Community_1.md) (12 shared connections)
- [Community 3](Community_3.md) (9 shared connections)
- [Community 17](Community_17.md) (6 shared connections)
- [Community 4](Community_4.md) (6 shared connections)
- [Community 6](Community_6.md) (3 shared connections)
- [Community 98](Community_98.md) (2 shared connections)
- [Community 58](Community_58.md) (2 shared connections)
- [Community 8](Community_8.md) (2 shared connections)
- [Community 2](Community_2.md) (2 shared connections)
- [Community 30](Community_30.md) (2 shared connections)
- [Community 10](Community_10.md) (2 shared connections)

## Source Files

- `backend/app/api/reports.py`
- `backend/app/services/report_service.py`
- `backend/tests/test_week9_scale_and_offline.py`

## Audit Trail

- EXTRACTED: 98 (84%)
- INFERRED: 19 (16%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*