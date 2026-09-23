# Community 71

> 14 nodes · cohesion 0.21

## Key Concepts

- **rollup_scan_telemetry()** (16 connections) — `backend/app/services/telemetry_rollup.py`
- **ScanTelemetryDailyRollup** (14 connections) — `backend/app/models/models.py`
- **telemetry_rollup.py** (13 connections) — `backend/app/services/telemetry_rollup.py`
- **calculate_percentile()** (8 connections) — `backend/app/services/telemetry_rollup.py`
- **simulate()** (5 connections) — `scripts/simulate_baseline_telemetry.py`
- **generate_real_classroom_dataset()** (4 connections) — `scripts/collect_real_classroom_telemetry.py`
- **.test_scanner_health_rollup_optimization()** (3 connections) — `backend/tests/test_week9_scale_and_offline.py`
- **datetime** (2 connections)
- **Aggregated historical daily scan metrics per device bucket (kept indefinitely).…** (1 connections) — `backend/app/models/models.py`
- **SNIST ERP — Scan Telemetry Daily Rollup & Retention Service Week 1: Measurement…** (1 connections) — `backend/app/services/telemetry_rollup.py`
- **Calculates percentile from a sorted list of numeric values.** (1 connections) — `backend/app/services/telemetry_rollup.py`
- **Rolls up raw scan telemetry events for target_date (YYYY-MM-DD) into daily…** (1 connections) — `backend/app/services/telemetry_rollup.py`
- **Verifies /api/v1/telemetry/scanner-health when days > 1 leverages…** (1 connections) — `backend/tests/test_week9_scale_and_offline.py`
- **date** (1 connections)

## Relationships

- [Community 1](Community_1.md) (6 shared connections)
- [Community 70](Community_70.md) (6 shared connections)
- [Community 58](Community_58.md) (4 shared connections)
- [Community 10](Community_10.md) (4 shared connections)
- [Community 69](Community_69.md) (3 shared connections)
- [Community 2](Community_2.md) (3 shared connections)
- [Community 102](Community_102.md) (3 shared connections)
- [Community 8](Community_8.md) (2 shared connections)
- [Community 41](Community_41.md) (1 shared connections)
- [Community 9](Community_9.md) (1 shared connections)

## Source Files

- `backend/app/models/models.py`
- `backend/app/services/telemetry_rollup.py`
- `backend/tests/test_week9_scale_and_offline.py`
- `scripts/collect_real_classroom_telemetry.py`
- `scripts/simulate_baseline_telemetry.py`

## Audit Trail

- EXTRACTED: 40 (77%)
- INFERRED: 12 (23%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*