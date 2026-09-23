# Community 70

> 14 nodes · cohesion 0.14

## Key Concepts

- **ScanTelemetryEvent** (31 connections) — `backend/app/models/models.py`
- **.test_decode_duration_histogram_ingest_and_rollup()** (4 connections) — `backend/tests/test_scan_telemetry.py`
- **.test_rollup_calculation()** (4 connections) — `backend/tests/test_scan_telemetry.py`
- **.test_telemetry_scanner_health_format_filter()** (3 connections) — `backend/tests/test_pilot_rollout_and_flag.py`
- **.test_csv_export_format()** (3 connections) — `backend/tests/test_scan_telemetry.py`
- **compute_metrics()** (3 connections) — `scripts/compute_pilot_metrics.py`
- **simulate_pilot()** (2 connections) — `scripts/run_flagged_pilot_cohort.py`
- **generate_pilot_week_telemetry()** (2 connections) — `scripts/simulate_pilot_cohort_sessions.py`
- **Raw QR scan funnel events (retention: 30 days). Strictly NO PII: stores…** (1 connections) — `backend/app/models/models.py`
- **Verifies /scanner-health filters by token_format ('short' vs 'legacy').** (1 connections) — `backend/tests/test_pilot_rollout_and_flag.py`
- **Verifies accurate aggregation of first-attempt rate and latency percentiles.** (1 connections) — `backend/tests/test_scan_telemetry.py`
- **Verifies that CSV export streams valid CSV headers and data.** (1 connections) — `backend/tests/test_scan_telemetry.py`
- **Validates decode_duration_ms ingestion, schema validation, and rollup…** (1 connections) — `backend/tests/test_scan_telemetry.py`
- **calc_set()** (1 connections) — `scripts/compute_pilot_metrics.py`

## Relationships

- [Community 71](Community_71.md) (6 shared connections)
- [Community 1](Community_1.md) (4 shared connections)
- [Community 41](Community_41.md) (4 shared connections)
- [Community 102](Community_102.md) (3 shared connections)
- [Community 69](Community_69.md) (3 shared connections)
- [Community 2](Community_2.md) (3 shared connections)
- [Community 58](Community_58.md) (2 shared connections)
- [Community 10](Community_10.md) (2 shared connections)
- [Community 4](Community_4.md) (2 shared connections)
- [Community 20](Community_20.md) (1 shared connections)
- [Community 56](Community_56.md) (1 shared connections)
- [Community 8](Community_8.md) (1 shared connections)

## Source Files

- `backend/app/models/models.py`
- `backend/tests/test_pilot_rollout_and_flag.py`
- `backend/tests/test_scan_telemetry.py`
- `scripts/compute_pilot_metrics.py`
- `scripts/run_flagged_pilot_cohort.py`
- `scripts/simulate_pilot_cohort_sessions.py`

## Audit Trail

- EXTRACTED: 29 (64%)
- INFERRED: 16 (36%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*