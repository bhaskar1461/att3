# Telemetry Design & Failure Forensics Specification (Week 1)

## Executive Summary
This document specifies the telemetry instrumentation and failure forensics architecture for the SNIST ERP QR Attendance System (React 18 PWA + FastAPI + SQLAlchemy). Week 1 establishes an empirical baseline across diverse mobile hardware (252 students, expanding to 2,000 across 7 departments) before any QR scanner algorithm optimizations are undertaken in Weeks 2–10.

---

## Prime Directive: Zero Scan-Path Impact
**Telemetry must never compete with, block, or add latency to scanning.**
1. **Zero Database Writes on Scan Path**: The scanning request (`POST /api/v1/student/scan-session`) computes microsecond timings in memory using `time.perf_counter()` and emits an INFO log line `[SCAN_TIMINGS]`. No telemetry rows are inserted during the scan transaction.
2. **Asynchronous Background Transport**: Client-side funnel events are captured in memory and mirrored in IndexedDB (`snist_scanner_telemetry`).
3. **Budgeted Transport**: Flushed using `navigator.sendBeacon` (fallback to `fetch(..., { keepalive: true })`) in batches of $\ge 10$ events or every 10 seconds.
4. **Drop Policy & Memory Capping**: Max memory queue cap is 500 events. If the backend fails 3 times consecutively, dropped batches are permanently discarded without retry storms.

---

## 1. Funnel Stage Definitions
Every scan interaction traverses a state machine consisting of 9 sequential funnel stages:

| Order | Funnel Stage Name | Trigger / Timestamp Marker | Payload Metrics |
|:-----:|:------------------|:---------------------------|:----------------|
| 1 | `scan_page_opened` | Scanner modal mount (`StudentClassScannerModal.tsx`) | Session Preview, User Agent |
| 2 | `camera_permission_requested` | Immediate pre-call to `navigator.mediaDevices.getUserMedia` | Permission API state |
| 3 | `camera_permission_result` | Immediate resolution/rejection of permission prompt | `duration_ms` (user decision prompt time), `granted: bool` |
| 4 | `camera_opened` | Video stream active, `videoRef.current.srcObject = stream` | `duration_ms` (hardware initialization time) |
| 5 | `first_frame_captured` | First video frame painted (`video.readyState >= 2`) | `duration_ms` (time from stream attach to first readable frame) |
| 6 | `frame_decoded` | QR decoder (jsQR / worker) successfully extracts payload | `duration_ms` (decode search latency) |
| 7 | `token_submitted` | Network payload dispatch to `/api/v1/student/scan-session` | Request preparation time |
| 8 | `server_response` | Network response received from backend | `duration_ms` (server + network roundtrip), status code |
| 9 | `attendance_confirmed` | Confirmation animation rendered in UI (green checkmark) | `duration_ms` (total wall-clock elapsed from modal open) |

### Non-Funnel Companion Events
- `scan_failed`: Emitted on any terminal failure or timeout, specifying `error_type` and stage where failure occurred.
- `scan_retried`: Emitted when student taps "Try Again" or camera re-inits (`attempt_no`).
- `manual_search_used`: Emitted in `ManualSearchModal` when faculty searches roster (`query_type: "roll" | "name"`).
- `manual_mark_created`: Emitted when faculty overrides scanner with a manual roster mark.

---

## 2. Failure Error Types
Categorized error classifications:

| Error Type | Triggering Condition | Typical Device Tier |
|:-----------|:---------------------|:--------------------|
| `permission_denied` | `NotAllowedError` / `PermissionDeniedError` | All |
| `camera_unavailable` | `NotFoundError` / `NotReadableError` / device in use by another app | Old / Mid |
| `camera_open_timeout` | Stream fails to attach within 5.0 seconds | Old (budget Androids) |
| `decode_timeout` | Watchdog timer reaches 15.0 seconds without a valid QR decode | Old (poor lens focus/CPU throttle) |
| `token_expired` | Server returns HTTP 400 with "Token expired" or invalid window | All |
| `device_binding_403` | Server returns HTTP 403 (device bound to another roll number) | All |
| `rate_limited` | Server returns HTTP 429 | All |
| `server_5xx` | Backend exception or database error | All |
| `network_error` | `TypeError: Failed to fetch` or device offline | All |
| `wasm_or_jsqr_crash` | Exception caught during canvas/decoder extraction | Old |

---

## 3. Device Tier Classification Matrix
Devices are classified identically on both client (`deviceClassifier.ts`) and server (`device_classifier.py`) using the following rules:

### Tiers:
- **`old`**:
  - Android version $\le 9$, OR
  - iOS version $\le 14$, OR
  - Device RAM $\le 2$GB, OR
  - CPU Cores $\le 4$.
- **`new`**:
  - Android version $\ge 13$ AND CPU Cores $\ge 8$ AND RAM $\ge 6$GB, OR
  - iOS version $\ge 17$ AND CPU Cores $\ge 6$.
- **`mid`**:
  - Intermediate hardware specs (e.g. Android 10–12, 4GB RAM), or unknown/safe fallback.

---

## 4. Strict No-PII Schema Governance
Telemetry evaluates the performance of the software and mobile hardware, **never student identities or personal locations**.

### Automated Enforcement:
1. **Forbidden Key Patterns**: Rejects with `HTTP 422 Unprocessable Entity` any JSON object containing keys matching:
   `(?i)(roll|name|student|email|phone|mobile|gps|lat|lng|coord|fingerprint|uuid)`
2. **Institutional Roll Regex Pattern**: Rejects with `HTTP 422` any string value matching:
   `^[0-9]{2}[A-Za-z0-9]{8,10}$`
3. **Anonymous Session IDs**: Only short ephemeral session IDs (e.g., `sess_101`) or class session IDs are recorded.

---

## 5. Storage, Retention, & Rollup Architecture

### Raw Event Ingest: `POST /api/v1/telemetry/scan-events`
- Status code: `202 Accepted`
- Rate-limited to 60 batches per minute per user.
- Maximum batch size cap: 50 events per request.

### Retention Policy: 30-Day Auto Purge
- Raw events in `qr_scan_telemetry_events` are purged after 30 days via `purge_old_scan_telemetry(retention_days=30)`.
- Purge runs on the background worker budget without locking transactional tables.

### Aggregation: `qr_scan_telemetry_daily_rollup`
- Nightly rollup job aggregates raw events by `(date, device_bucket)` into permanent rows for buckets `old`, `mid`, `new`, and `all`.
- Computes:
  - `first_attempt_success_rate`
  - `p50_time_to_mark_ms` and `p95_time_to_mark_ms` (using linear interpolation)
  - `stage_dropoffs_json`
  - `failure_counts_json`
  - `manual_searches_count` and `manual_marks_count`

---

## 6. Failure Forensics Dashboard (Admin Portal)
- Accessible via Super Admin portal under the **Scanner Health** tab (`/admin`).
- Role-scoped: Super Admin & Faculty only; Students strictly rejected with `HTTP 403 Forbidden`.
- Features:
  - Timeframe selector (24h, 7d, 14d, 30d) and Device Tier filter.
  - Headline metrics: First-Attempt Success Rate, p50/p95 Time to Mark, Old Phone Failure Rate, Manual Override Rate.
  - Funnel Waterfall visualization with stage-by-stage drop-off percentages.
  - Failure Matrix table cross-referencing error types against device tiers.
  - High-Friction Classroom Session Detector: Flags any session where manual overrides exceed 15% of total attendance marks.
  - CSV Export: Streams raw funnel CSV for off-line analysis.
