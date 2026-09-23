# Community 4

> 95 nodes · cohesion 0.05

## Key Concepts

- **AttendanceRecord** (133 connections) — `backend/app/models/models.py`
- **SessionStatus** (97 connections) — `backend/app/models/models.py`
- **teacher.py** (75 connections) — `backend/app/api/teacher.py`
- **SystemSettings** (38 connections) — `backend/app/models/models.py`
- **test_multi_period_selection.py** (31 connections) — `backend/tests/test_multi_period_selection.py`
- **TestPilotRolloutAndFlag** (25 connections) — `backend/tests/test_pilot_rollout_and_flag.py`
- **test_qr_data_handling.py** (23 connections) — `backend/tests/test_qr_data_handling.py`
- **run_v2_rollback_drill()** (23 connections) — `scripts/run_render_v2_rollback_drill.py`
- **get_session_broadcast_token()** (21 connections) — `backend/app/api/teacher.py`
- **_extract_period_count()** (19 connections) — `backend/app/api/teacher.py`
- **update_session_period()** (18 connections) — `backend/app/api/teacher.py`
- **test_student_attendance_metrics.py** (18 connections) — `backend/tests/test_student_attendance_metrics.py`
- **Session** (15 connections)
- **sync_roster_from_sheet()** (15 connections) — `backend/app/api/teacher.py`
- **_async_full_session_sync()** (14 connections) — `backend/app/api/teacher.py`
- **delete_session()** (14 connections) — `backend/app/api/teacher.py`
- **lock_session()** (14 connections) — `backend/app/api/teacher.py`
- **backend/scripts/prepare_tomorrow_attendance.py** (14 connections) — `backend/scripts/prepare_tomorrow_attendance.py`
- **get_student_today_schedule()** (12 connections) — `backend/app/api/student.py`
- **get_current_class()** (12 connections) — `backend/app/api/teacher.py`
- **sync_all_dates_from_gsheet()** (12 connections) — `scripts/sync_all_dates_from_gsheet.py`
- **start_attendance_session()** (11 connections) — `backend/app/api/teacher.py`
- **pytest** (11 connections)
- **get_student_attendance_summary()** (10 connections) — `backend/app/api/student.py`
- **trigger_session_sheet_sync()** (10 connections) — `backend/app/api/teacher.py`
- *... and 70 more nodes in this community*

## Relationships

- [Community 0](Community_0.md) (139 shared connections)
- [Community 3](Community_3.md) (59 shared connections)
- [Community 1](Community_1.md) (56 shared connections)
- [Community 6](Community_6.md) (35 shared connections)
- [Community 20](Community_20.md) (24 shared connections)
- [Community 32](Community_32.md) (23 shared connections)
- [Community 10](Community_10.md) (22 shared connections)
- [Community 2](Community_2.md) (19 shared connections)
- [Community 13](Community_13.md) (15 shared connections)
- [Community 8](Community_8.md) (12 shared connections)
- [Community 18](Community_18.md) (10 shared connections)
- [Community 5](Community_5.md) (10 shared connections)

## Source Files

- `backend/app/api/attendance.py`
- `backend/app/api/student.py`
- `backend/app/api/teacher.py`
- `backend/app/models/models.py`
- `backend/app/services/qr_token.py`
- `backend/scripts/prepare_tomorrow_attendance.py`
- `backend/tests/test_multi_period_selection.py`
- `backend/tests/test_pilot_rollout_and_flag.py`
- `backend/tests/test_qr_data_handling.py`
- `backend/tests/test_qr_display_and_rotation.py`
- `backend/tests/test_student_attendance_metrics.py`
- `scripts/check_student_activity_today.py`
- `scripts/clean_bhaskar_data.py`
- `scripts/exact_2_to_4_audit.py`
- `scripts/prepare_tomorrow_attendance.py`
- `scripts/run_render_v2_rollback_drill.py`
- `scripts/sync_all_dates_from_gsheet.py`

## Audit Trail

- EXTRACTED: 445 (62%)
- INFERRED: 275 (38%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*