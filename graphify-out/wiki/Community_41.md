# Community 41

> 25 nodes · cohesion 0.08

## Key Concepts

- **TestScanTelemetrySuite** (24 connections) — `backend/tests/test_scan_telemetry.py`
- **.test_device_classifier_matrix()** (3 connections) — `backend/tests/test_scan_telemetry.py`
- **.test_scan_path_timing_overhead()** (3 connections) — `backend/tests/test_scan_telemetry.py`
- **.test_camera_ladder_rung_telemetry_tagging()** (2 connections) — `backend/tests/test_scan_telemetry.py`
- **.test_display_type_session_and_filtering()** (2 connections) — `backend/tests/test_scan_telemetry.py`
- **.test_ingest_batch_size_limit()** (2 connections) — `backend/tests/test_scan_telemetry.py`
- **.test_ingest_invalid_device_bucket()** (2 connections) — `backend/tests/test_scan_telemetry.py`
- **.test_ingest_invalid_event_type()** (2 connections) — `backend/tests/test_scan_telemetry.py`
- **.test_ingest_valid_batch()** (2 connections) — `backend/tests/test_scan_telemetry.py`
- **.test_no_pii_rejection_forbidden_key()** (2 connections) — `backend/tests/test_scan_telemetry.py`
- **.test_no_pii_rejection_roll_pattern_in_value()** (2 connections) — `backend/tests/test_scan_telemetry.py`
- **.test_scanner_health_role_permissions()** (2 connections) — `backend/tests/test_scan_telemetry.py`
- **Table-driven testing for device tier classification rules.** (1 connections) — `backend/tests/test_scan_telemetry.py`
- **Valid batch of telemetry events returns HTTP 202 Accepted.** (1 connections) — `backend/tests/test_scan_telemetry.py`
- **Unrecognized event_type is rejected with HTTP 422.** (1 connections) — `backend/tests/test_scan_telemetry.py`
- **Unrecognized device_bucket is rejected with HTTP 422.** (1 connections) — `backend/tests/test_scan_telemetry.py`
- **Batches exceeding 50 events are rejected with HTTP 422.** (1 connections) — `backend/tests/test_scan_telemetry.py`
- **Rejects any payload containing forbidden PII keys (roll, name, student, etc.).** (1 connections) — `backend/tests/test_scan_telemetry.py`
- **Rejects payload if any string value matches the institutional roll regex.** (1 connections) — `backend/tests/test_scan_telemetry.py`
- **Students are rejected with 403; Faculty and Admin get 200 OK.** (1 connections) — `backend/tests/test_scan_telemetry.py`
- **Validates Prime Directive: in-memory time.perf_counter() measurements and…** (1 connections) — `backend/tests/test_scan_telemetry.py`
- **Validates Quick Win C.3: camera constraint fallback rungs (1, 2, 3) are…** (1 connections) — `backend/tests/test_scan_telemetry.py`
- **Validates display_type parameter support: - optional with default 'projector' -…** (1 connections) — `backend/tests/test_scan_telemetry.py`
- **.setUp()** (1 connections) — `backend/tests/test_scan_telemetry.py`
- **.tearDownClass()** (1 connections) — `backend/tests/test_scan_telemetry.py`

## Relationships

- [Community 70](Community_70.md) (4 shared connections)
- [Community 0](Community_0.md) (2 shared connections)
- [Community 13](Community_13.md) (2 shared connections)
- [Community 1](Community_1.md) (1 shared connections)
- [Community 102](Community_102.md) (1 shared connections)
- [Community 52](Community_52.md) (1 shared connections)
- [Community 71](Community_71.md) (1 shared connections)
- [Community 6](Community_6.md) (1 shared connections)

## Source Files

- `backend/tests/test_scan_telemetry.py`

## Audit Trail

- EXTRACTED: 33 (89%)
- INFERRED: 4 (11%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*