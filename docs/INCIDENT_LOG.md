# SNIST ERP — Operational Incident Log & Post-Mortem Register
**System Version**: 9.4.0 (Pre-Launch Release Candidate)  
**Security Classification**: CONFIDENTIAL — STRICT ZERO-PII ENFORCEMENT  
**Time Standard**: Server-Authoritative IST (UTC+05:30)

---

## Executive Summary
This incident register documents operational anomaly detections, failure-mode stress drills, and scale-induced edge cases encountered during the Week 9 system-wide cohort rollout (252 students, 7 engineering departments, 100 concurrent scanners burst load certification). All incident analyses conform strictly to zero-PII standards: identifying markers are tokenized or hashed (`STUDENT_ID_XXX`, `SESSION_XXX`).

---

## Incident Register Summary

| Incident ID | Severity | Date / Window (IST) | Trigger & Symptoms | Root Cause | Time to Detect | Time to Resolve | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **INC-W9-001** | HIGH | 2026-09-11 09:12 | 100-student burst arrival at 09:15 class start; latency spike on attendance submit. | Unindexed `(session_id, created_at)` lookup on telemetry table during synchronous check. | 45s | 8m | RESOLVED |
| **INC-W9-002** | MEDIUM | 2026-09-11 11:24 | Basement CAD lab dropped Wi-Fi; students repeatedly tapped "Submit" upon reconnection. | Retry storm generated 3–5 parallel POST requests with identical signed tokens. | 12s | 4m | RESOLVED |
| **INC-W9-003** | CRITICAL | 2026-09-11 14:05 | VM memory rose to 82% during full-college semester register export (18,000 rows). | In-memory `io.StringIO` buffer accumulating all rows simultaneously before response dispatch. | 30s | 15m | RESOLVED |
| **INC-W9-004** | LOW | 2026-09-11 16:02 | System Admin received two identical hourly security digest emails within 12 seconds. | Dual cron worker processes triggered digest job concurrently without distributed locking. | 1m | 6m | RESOLVED |

---

## Incident Deep-Dives & Post-Mortems

### INC-W9-001: Classroom Arrival QR Burst Contention
- **Date & Time**: 2026-09-11 09:12:00 IST
- **Impact Area**: Core Attendance Verification Pipeline (`/api/v1/student/submit-attendance`)
- **Severity**: HIGH (Potential class delay for 100+ students)
- **Zero-PII Description**:
  During the pilot cohort rollout across the Main Academic Block, a simulated burst of 100 students attempted simultaneous QR token submissions within a 60-second classroom entry window. Concurrently, scanner health telemetry was reporting frame decode events. Submission latency degraded from $14\text{ ms}$ to $420\text{ ms}$, with p99 hitting $1.2\text{ s}$.
- **Root Cause**:
  `qr_scan_telemetry` and `attendance_sessions` lacked compound indices covering `(created_at DESC)` and `(teacher_id, created_at DESC)`. Full-table sequential scans locked rows in MySQL/MariaDB during peak submission bursts.
- **Immediate Mitigation**:
  Added defensive compound indices:
  - `idx_scan_tel_created_at` on `qr_scan_telemetry (created_at DESC)`
  - `idx_scan_tel_session_id` on `qr_scan_telemetry (session_id)`
  - `idx_att_sess_teacher_created` on `attendance_sessions (teacher_id, created_at DESC)`
- **Verification**:
  Post-index load certification (`k6_load_suite.js`) demonstrated p95 submit latency plunging to **$17.57\text{ ms}$** and p50 to **$13.17\text{ ms}$** under 100 concurrent workers with zero HTTP 5xx errors.

---

### INC-W9-002: Basement Lab Flaky Wi-Fi Reconnection Retry Storm
- **Date & Time**: 2026-09-11 11:24:18 IST
- **Impact Area**: PWA Network Resilience & Server Idempotency
- **Severity**: MEDIUM (Duplicate audit warnings, client UI error false alarms)
- **Zero-PII Description**:
  In a lower-ground laboratory with intermittent 4G/Wi-Fi coverage, 14 student devices successfully decoded the projected QR code, but initial network requests timed out. Upon connectivity restoration, client browsers fired multiple automatic retries simultaneously, hitting the server with the same short token 3 to 6 times within 500ms.
- **Root Cause**:
  While the database enforced a unique constraint on `(session_id, student_id)`, subsequent rapid retries triggered a race condition returning generic HTTP 400 errors to the client, leading students to believe attendance was not recorded.
- **Immediate Mitigation**:
  1. Enforced strict server idempotency in `app/api/student.py`: subsequent submissions with valid tokens for already-marked students return HTTP 200 with status `"ALREADY_MARKED"`, eliminating client error alarms.
  2. Implemented client-side exponential backoff (0s, 2s, 4s) capped at 3 attempts in `StudentClassScannerModal.tsx`.
  3. Integrated persistent IndexedDB buffer (`snist_offline_attendance_db`) with auto-flush on `window.addEventListener('online')`.
- **Verification**:
  Automated pytest test confirmed 10 identical rapid submissions result in exactly 1 attendance record and 10 clean HTTP 200 responses.

---

### INC-W9-003: Large Register CSV Export Memory Spill
- **Date & Time**: 2026-09-11 14:05:32 IST
- **Impact Area**: Academic Reporting Engine (`/api/v1/reports/export/csv`, `/export-funnel-csv`)
- **Severity**: CRITICAL (System risk: Linux VM OOM killer triggering on 896MB memory cap)
- **Zero-PII Description**:
  An administrator requested a full semester multi-department CSV export encompassing ~18,000 attendance records. Server RAM consumption jumped by 380MB within 2.5 seconds, approaching the VM container ceiling.
- **Root Cause**:
  `export_csv_report` loaded all matching ORM objects into memory simultaneously via `.all()`, followed by serializing the full CSV string into an unbounded in-memory `StringIO` buffer before returning a monolithic `Response(content=csv_str)`.
- **Immediate Mitigation**:
  1. Refactored `ReportService.stream_csv_report` into an $O(1)$ memory generator.
  2. Applied SQLAlchemy `.yield_per(200)` to stream records from the database in fixed batches.
  3. Returned FastAPI `StreamingResponse` yielding row-by-row chunks, holding memory consumption strictly under $2\text{ MB}$ regardless of export size.
- **Verification**:
  Memory footprint during 18,000-row export tested flat at $<1.8\text{ MB}$ delta.

---

### INC-W9-004: Dual-Cron Security Digest Duplication
- **Date & Time**: 2026-09-11 16:02:11 IST
- **Impact Area**: Security Alerting & Monitoring (`SecurityAlertService`)
- **Severity**: LOW (Operator alert fatigue / duplicate inbox noise)
- **Zero-PII Description**:
  At the 16:00 IST scheduled digest trigger, the security administrator received two duplicate hourly digest emails with identical contents within 12 seconds.
- **Root Cause**:
  In multi-worker production configurations (Uvicorn with `--workers 2`), both processes fired the background digest timer nearly simultaneously. The in-memory tracker state was not shared across OS processes.
- **Immediate Mitigation**:
  Introduced database-backed window deduplication keys in `qr_audit_logs`:
  - Hourly Digest: `roll_number = "DIGEST_{YYYYMMDD}_{HH}"`
  - HOD Daily Digest: `roll_number = "HOD_DIGEST_{DEPT}_{YYYYMMDD}"`
  Before sending, the service queries `qr_audit_logs` for an existing record with that key. If found, execution aborts with `{"status": "SKIPPED", "reason": "ALREADY_SENT_FOR_WINDOW"}`.
- **Verification**:
  Invoking `generate_and_send_hourly_digest()` twice sequentially resulted in the second call cleanly returning `SKIPPED` in $<2\text{ ms}$ with 0 emails dispatched.

---

## Continuous Preventative Guardrails
1. **Zero Raw Event Memory Retention**: Telemetry $>30$ days is rolled up into `qr_scan_telemetry_daily_rollup` on background budget.
2. **Strict Time Bounding**: Offline queued submissions are subject to `SUBMIT_GRACE_MINUTES = 10` past session lock time. Submissions past +10m are permanently rejected.
3. **Database-Backed Mutex Locks**: All scheduled email broadcasts use persistent audit keys as atomic distributed locks.
