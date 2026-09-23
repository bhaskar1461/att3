# Community 13

> 50 nodes · cohesion 0.06

## Key Concepts

- **student.py** (77 connections) — `backend/app/api/student.py`
- **student_scan_session()** (31 connections) — `backend/app/api/student.py`
- **launch_attend()** (14 connections) — `backend/app/api/launch.py`
- **_verify_binding_proof()** (14 connections) — `backend/app/api/student.py`
- **get_student_qr()** (11 connections) — `backend/app/api/student.py`
- **_async_scan_telemetry()** (10 connections) — `backend/app/api/student.py`
- **extract_launch_token_from_url()** (10 connections) — `backend/app/services/launch_token.py`
- **clear_verify_failures()** (8 connections) — `backend/app/core/binding_crypto.py`
- **mark_challenge_consumed()** (8 connections) — `backend/app/core/binding_crypto.py`
- **classify_device()** (7 connections) — `backend/app/core/device_classifier.py`
- **get_student_pure_qr()** (6 connections) — `backend/app/api/student.py`
- **get** (6 connections)
- **StudentScanSessionRequest** (6 connections) — `backend/app/api/student.py`
- **validate_student_geofence()** (6 connections) — `backend/app/services/geofence_service.py`
- **unconsume_claim()** (6 connections) — `backend/app/services/launch_token.py`
- **.generate_pure_qr_code()** (6 connections) — `backend/app/services/qr_service.py`
- **Session** (5 connections)
- **haversine_distance()** (5 connections) — `backend/app/services/geofence_service.py`
- **collections** (5 connections)
- **_async_update_entry_method()** (4 connections) — `backend/app/api/launch.py`
- **get_scan_status()** (4 connections) — `backend/app/api/student.py`
- **get_student_profile()** (3 connections) — `backend/app/api/student.py`
- **.test_haversine_math()** (3 connections) — `backend/tests/test_attendance_mvp_full.py`
- **.test_extract_launch_token_variants()** (3 connections) — `backend/tests/test_qr_data_handling.py`
- **app_core_device_classifier** (2 connections)
- *... and 25 more nodes in this community*

## Relationships

- [Community 4](Community_4.md) (15 shared connections)
- [Community 25](Community_25.md) (14 shared connections)
- [Community 1](Community_1.md) (13 shared connections)
- [Community 8](Community_8.md) (13 shared connections)
- [Community 0](Community_0.md) (12 shared connections)
- [Community 5](Community_5.md) (11 shared connections)
- [Community 19](Community_19.md) (11 shared connections)
- [Community 3](Community_3.md) (9 shared connections)
- [Community 64](Community_64.md) (5 shared connections)
- [Community 6](Community_6.md) (5 shared connections)
- [Community 59](Community_59.md) (5 shared connections)
- [Community 32](Community_32.md) (4 shared connections)

## Source Files

- `backend/app/api/launch.py`
- `backend/app/api/student.py`
- `backend/app/core/binding_crypto.py`
- `backend/app/core/device_classifier.py`
- `backend/app/services/geofence_service.py`
- `backend/app/services/launch_token.py`
- `backend/app/services/qr_service.py`
- `backend/tests/test_attendance_mvp_full.py`
- `backend/tests/test_qr_data_handling.py`

## Audit Trail

- EXTRACTED: 191 (88%)
- INFERRED: 27 (12%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*