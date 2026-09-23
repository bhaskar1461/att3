# Community 102

> 7 nodes · cohesion 0.29

## Key Concepts

- **purge_old_scan_telemetry()** (9 connections) — `backend/app/services/telemetry_rollup.py`
- **run_coexistence_and_explain_test()** (6 connections) — `scripts/run_week9_load_certification.py`
- **.test_purge_old_scan_telemetry()** (4 connections) — `backend/tests/test_scan_telemetry.py`
- **Session** (2 connections)
- **Deletes raw scan telemetry events older than retention_days. Preserves…** (1 connections) — `backend/app/services/telemetry_rollup.py`
- **Verifies that purge deletes events > 30 days old and retains recent ones.** (1 connections) — `backend/tests/test_scan_telemetry.py`
- **Verifies sustained rollup/purge coexistence and runs EXPLAIN query plan checks.** (1 connections) — `scripts/run_week9_load_certification.py`

## Relationships

- [Community 71](Community_71.md) (3 shared connections)
- [Community 70](Community_70.md) (3 shared connections)
- [Community 58](Community_58.md) (2 shared connections)
- [Community 1](Community_1.md) (1 shared connections)
- [Community 41](Community_41.md) (1 shared connections)
- [Community 101](Community_101.md) (1 shared connections)
- [Community 15](Community_15.md) (1 shared connections)

## Source Files

- `backend/app/services/telemetry_rollup.py`
- `backend/tests/test_scan_telemetry.py`
- `scripts/run_week9_load_certification.py`

## Audit Trail

- EXTRACTED: 14 (78%)
- INFERRED: 4 (22%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*