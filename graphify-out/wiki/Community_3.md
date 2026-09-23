# Community 3

> 98 nodes · cohesion 0.03

## Key Concepts

- **AttendanceSession** (194 connections) — `backend/app/models/models.py`
- **get_server_ist_date()** (81 connections) — `backend/app/core/security.py`
- **test_attendance_mvp_full.py** (43 connections) — `backend/tests/test_attendance_mvp_full.py`
- **generate_encrypted_qr_payload_v2()** (31 connections) — `backend/app/core/security.py`
- **TestAttendanceMVPFull** (30 connections) — `backend/tests/test_attendance_mvp_full.py`
- **TestDateBoundQRAndHistoricalEditing** (28 connections) — `backend/tests/test_date_bound_qr_and_historical_editing.py`
- **TestProjectorRotatingQR** (26 connections) — `backend/tests/test_projector_rotating_qr.py`
- **TestMakeupAttendance** (22 connections) — `backend/tests/test_makeup_attendance.py`
- **TestAttendanceCardReflection** (20 connections) — `backend/tests/test_attendance_card_reflection.py`
- **get_dashboard_stats()** (10 connections) — `backend/app/api/admin.py`
- **get_admin_daily_sheet()** (10 connections) — `backend/app/api/attendance.py`
- **get_class_sheet_matrix()** (9 connections) — `backend/app/api/reports.py`
- **.test_post_attendance_selfie_upload_and_skip_decoupling()** (9 connections) — `backend/tests/test_attendance_mvp_full.py`
- **get_session_attendance_report()** (8 connections) — `backend/app/api/reports.py`
- **setup_today_attendance_session()** (8 connections) — `scripts/dispatch_cs_today_class_and_credentials.py`
- **.test_first_week_empty_state_threshold()** (7 connections) — `backend/tests/test_compliance_hardening.py`
- **.test_13_admin_scan_override()** (6 connections) — `backend/tests/test_date_bound_qr_and_historical_editing.py`
- **.test_10_qr_mismatch_rejection()** (6 connections) — `backend/tests/test_device_binding.py`
- **.test_controlled_camera_fallback()** (5 connections) — `backend/tests/test_attendance_mvp_full.py`
- **.test_duplicate_attendance_idempotency()** (5 connections) — `backend/tests/test_attendance_mvp_full.py`
- **.test_student_inside_geofence_attendance_accepted()** (5 connections) — `backend/tests/test_attendance_mvp_full.py`
- **.test_student_missing_gps_rejected_when_session_has_gps()** (5 connections) — `backend/tests/test_attendance_mvp_full.py`
- **.test_student_outside_geofence_rejected()** (5 connections) — `backend/tests/test_attendance_mvp_full.py`
- **.test_e2e_full_attendance_and_security_lifecycle()** (5 connections) — `backend/tests/test_e2e_integration.py`
- **run_verification()** (5 connections) — `scripts/verify_tomorrow_setup.py`
- *... and 73 more nodes in this community*

## Relationships

- [Community 0](Community_0.md) (134 shared connections)
- [Community 4](Community_4.md) (59 shared connections)
- [Community 1](Community_1.md) (43 shared connections)
- [Community 6](Community_6.md) (22 shared connections)
- [Community 20](Community_20.md) (14 shared connections)
- [Community 52](Community_52.md) (13 shared connections)
- [Community 10](Community_10.md) (11 shared connections)
- [Community 32](Community_32.md) (10 shared connections)
- [Community 39](Community_39.md) (9 shared connections)
- [Community 13](Community_13.md) (9 shared connections)
- [Community 35](Community_35.md) (8 shared connections)
- [Community 73](Community_73.md) (7 shared connections)

## Source Files

- `backend/app/api/admin.py`
- `backend/app/api/attendance.py`
- `backend/app/api/reports.py`
- `backend/app/core/security.py`
- `backend/app/models/models.py`
- `backend/tests/test_attendance_card_reflection.py`
- `backend/tests/test_attendance_mvp_full.py`
- `backend/tests/test_compliance_hardening.py`
- `backend/tests/test_date_bound_qr_and_historical_editing.py`
- `backend/tests/test_device_binding.py`
- `backend/tests/test_e2e_integration.py`
- `backend/tests/test_makeup_attendance.py`
- `backend/tests/test_projector_rotating_qr.py`
- `backend/tests/test_vulnerability_verification.py`
- `scripts/dispatch_cs_today_class_and_credentials.py`
- `scripts/verify_tomorrow_setup.py`

## Audit Trail

- EXTRACTED: 403 (71%)
- INFERRED: 163 (29%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*