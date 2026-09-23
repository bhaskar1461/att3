# Community 58

> 18 nodes · cohesion 0.17

## Key Concepts

- **telemetry.py** (41 connections) — `backend/app/api/telemetry.py`
- **ingest_scan_telemetry_batch()** (10 connections) — `backend/app/api/telemetry.py`
- **trigger_telemetry_rollup()** (8 connections) — `backend/app/api/telemetry.py`
- **record_pwa_install_telemetry()** (7 connections) — `backend/app/api/telemetry.py`
- **assert_no_pii()** (4 connections) — `backend/app/api/telemetry.py`
- **PwaInstallTelemetryRequest** (3 connections) — `backend/app/api/telemetry.py`
- **BaseModel** (3 connections)
- **post** (3 connections)
- **ScanTelemetryBatchIn** (3 connections) — `backend/app/api/telemetry.py`
- **fastapi_responses** (3 connections)
- **_check_telemetry_rate_limit()** (2 connections) — `backend/app/api/telemetry.py`
- **Request** (2 connections)
- **ScanTelemetryEventIn** (2 connections) — `backend/app/api/telemetry.py`
- **Any** (1 connections)
- **Defensive schema guard: rejects any event payload containing roll patterns,…** (1 connections) — `backend/app/api/telemetry.py`
- **Ingests batched QR scan funnel events on the background budget. Strictly…** (1 connections) — `backend/app/api/telemetry.py`
- **Fire-and-forget ingestion of PWA client telemetry. Reuses qr_audit_logs with…** (1 connections) — `backend/app/api/telemetry.py`
- **Admin maintenance endpoint to trigger the daily rollup and 30-day purge.** (1 connections) — `backend/app/api/telemetry.py`

## Relationships

- [Community 69](Community_69.md) (8 shared connections)
- [Community 1](Community_1.md) (6 shared connections)
- [Community 8](Community_8.md) (4 shared connections)
- [Community 71](Community_71.md) (4 shared connections)
- [Community 0](Community_0.md) (3 shared connections)
- [Community 9](Community_9.md) (2 shared connections)
- [Community 10](Community_10.md) (2 shared connections)
- [Community 6](Community_6.md) (2 shared connections)
- [Community 70](Community_70.md) (2 shared connections)
- [Community 4](Community_4.md) (2 shared connections)
- [Community 102](Community_102.md) (2 shared connections)
- [Community 39](Community_39.md) (2 shared connections)

## Source Files

- `backend/app/api/telemetry.py`

## Audit Trail

- EXTRACTED: 65 (93%)
- INFERRED: 5 (7%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*