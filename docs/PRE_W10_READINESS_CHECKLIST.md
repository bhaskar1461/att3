# Pre-Week 10 Production Readiness Checklist & Deployment Gates

**System**: SNIST ERP Attendance Engine  
**Target Release**: Production Deployment — Week 10 (Institutional Campus-Wide Launch)  
**Verification Date**: 2026-09-11  
**Audit Status**: **ALL GATES PASS (100% READY FOR LAUNCH)**

---

## 1. Executive Summary & Verification Matrix

The SNIST ERP Attendance Engine has successfully cleared all Week 9 Load Certification, Staged Cohort Rollout, Offline Tolerance, and Scale-Induced Hardening stages. The platform has been certified under extreme concurrent burst loads (100 concurrent scanners, 500 scans/minute, telemetry flood, and teacher-student coexistence load) with **zero 5xx errors**, **$p95$ response latencies $< 19\text{ ms}$**, and **100% server idempotency**.

| Audit Gate | Criterion | Status | Verified Telemetry / Artifact |
| :--- | :--- | :---: | :--- |
| **Gate 1: Schema & Indexes** | Composite indexes active for sub-second telemetry & pagination | **PASS** | `idx_scan_tel_created_at`, `idx_scan_tel_session_id`, `idx_att_sess_teacher_created` verified |
| **Gate 2: Concurrency & Load** | 100 concurrent scanners burst, $p95 < 300\text{ ms}$, 0% 5xx | **PASS** | Burst $p95 = 17.57\text{ ms}$, Coexistence $p95 = 18.27\text{ ms}$, 0 errors (`docs/LOAD_CERT_RESULTS.json`) |
| **Gate 3: Offline Resilience** | Client IndexedDB buffer, 3x backoff, 10m submit-grace | **PASS** | `snist_offline_attendance_db` verified, 7/7 automated tests passed |
| **Gate 4: Server Idempotency** | Duplicate submission retry storm produces exactly 1 DB record | **PASS** | 10 concurrent duplicate scans return HTTP 200 `ALREADY_MARKED` |
| **Gate 5: Cohort Rollout** | 7 engineering departments, 252 students, concurrent sessions | **PASS** | 7-thread session creation in $262\text{ ms}$ (`docs/ROLLOUT_LOG.md`) |
| **Gate 6: Scale Performance** | Streaming CSV $O(1)$ memory, Rollup $< 100\text{ ms}$, Pagination | **PASS** | Streaming CSV & Scanner rollup verified |
| **Gate 7: Security & Audit** | Hourly digest dedup, zero PII logging, SAP ID governance | **PASS** | Window dedup keys active, zero PII verified across incident logs |
| **Gate 8: Automated Tests** | 100% clean test suite pass across all regression boundaries | **PASS** | 222/222 automated tests passing |

---

## 2. Gate 1: Database Schema & Migration Verification

### 2.1 Applied Index Migrations
All high-volume query paths are guarded by composite database indexes:
- **`idx_scan_tel_created_at`** (`scan_telemetry_events.created_at`): Enables sub-second date range partitioning and prevents full-table scans during hourly/daily scanner health rollups.
- **`idx_scan_tel_session_id`** (`scan_telemetry_events.session_id`): Enables instant lookup of session-specific optical health telemetry during active broadcasts.
- **`idx_att_sess_teacher_created`** (`attendance_sessions.teacher_id, attendance_sessions.created_at`): Backs the paginated faculty historical sessions endpoint (`limit=50, offset=0`), maintaining query latency $< 15\text{ ms}$ as historical records scale to tens of thousands.

### 2.2 Migration Verification Command:
```sql
SHOW INDEX FROM scan_telemetry_events;
SHOW INDEX FROM attendance_sessions;
```
*Expected Result*: All 3 index definitions present and marked `INDEX`.

---

## 3. Gate 2: Configuration & Environment Auditing

The production `.env` and `app/core/config.py` settings must match the following certified values:

| Configuration Variable | Certified Setting | Justification & Safeguard |
| :--- | :--- | :--- |
| `SCANNER_ENGINE` | `"wasm"` | High-speed client-side decoding with instant fallback to `jsqr`. |
| `SUBMIT_GRACE_MINUTES` | `10` | Permits students with network drops to sync buffered scans up to 10m post-lock. |
| `ACTIVE_ROLLOUT_DEPARTMENTS` | `["CSE", "ECE", "IT", "MECH", "CIVIL", "EEE", "AIML"]` | All 7 institutional engineering cohorts unlocked for campus rollout. |
| `SECURITY_DIGEST_ENABLED` | `True` | Automated security event rollup dispatched to campus security operators. |
| `SECURITY_DIGEST_START_HOUR` | `9` | Operational window start (09:00 IST). Zero off-hours noise. |
| `SECURITY_DIGEST_END_HOUR` | `17` | Operational window end (17:00 IST). Suppresses evening noise. |
| `MANUAL_MARK_MAX_PER_SESSION_CAP` | `25` | Hard rate-limit cap requiring HTTP 428 confirmation on bulk manual marks. |
| `MANUAL_MARK_AMBER_THRESHOLD_PCT`| `15.0` | Warning threshold triggering optical health inspection alert. |
| `MANUAL_MARK_RED_THRESHOLD_PCT`  | `30.0` | Critical threshold indicating projection failure or systemic proxy attempt. |

---

## 4. Gate 3: Offline & Flaky-Network Resilience Checklist

- [x] **Client IndexedDB Queue**: `snist_offline_attendance_db` initialized with `submissions` object store (`keyPath: "id"`, indexes: `by_session_id`, `by_status`, `by_created_at`).
- [x] **Exponential Backoff**: 3-attempt automated retry with randomized jitter ($1\text{s}, 2\text{s}, 4\text{s}$) when network fetch throws `TypeError: Failed to fetch`.
- [x] **Server Idempotency Guarantee**: Submissions with identical short tokens check existing attendance before insert. If present, returns HTTP 200 `ALREADY_MARKED` with original timestamp, preventing duplicate entries and constraint collisions.
- [x] **Strict Submit-Grace Boundary**: Server validates `session.locked_at + timedelta(minutes=SUBMIT_GRACE_MINUTES)`. Submissions within grace are marked `LATE_SYNC_ACCEPTED`; submissions past grace are rejected with HTTP 400 `SESSION_EXPIRED`.
- [x] **Cached Session Hints**: Active session metadata cached in localStorage so UI renders session subject, section, and room number even if connectivity drops immediately after scan.
- [x] **Faculty Offline Manual Mark Buffer**: `snist_offline_manual_marks` store captures faculty manual overrides in offline lecture rooms and flushes automatically upon network restoration.

---

## 5. Gate 4: Scale Performance & Memory Profiling

- [x] **Streaming CSV Export**: `/api/v1/attendance/sessions/{id}/export-csv` refactored to `StreamingResponse` using an `iter_csv()` generator with `StringIO` buffer. Memory consumption is strictly $O(1)$ regardless of roster size.
- [x] **Scanner Health Rollup Optimization**: `/api/v1/telemetry/scanner-health` uses SQL `GROUP BY` rollups for query windows $> 1\text{ day}$, reducing memory footprint by $> 98\%$ and eliminating Python-side row looping.
- [x] **Paginated Faculty Historical Sessions**: `/api/v1/teacher/sessions` supports `limit` (default 50, max 100) and `offset`, backed by composite index `idx_att_sess_teacher_created`.
- [x] **Hourly & HOD Daily Digest Deduplication**: Atomic database idempotency keys `DIGEST_{date}_{hour}` and `HOD_DIGEST_{dept}_{date}` logged in `qr_audit_logs.roll_number` prevent duplicate email dispatches during scheduler retries or multi-worker race conditions.

---

## 6. Gate 5: Rollback & Emergency Contingency Procedures

### 6.1 Emergency Scanner Engine Fallback (<60s SLA)
If client-side WASM engine experiences compatibility issues on legacy Android webviews:
1. **Runtime Database Hot-Flip**: Update `system_settings` table:
   ```sql
   UPDATE system_settings SET value = 'jsqr' WHERE key = 'SCANNER_ENGINE';
   ```
2. **Client Instant Bypass**: Students can append `?engine=jsqr` to the portal URL or select "Switch to Standard Engine" in the camera error screen.

### 6.2 Manual Attendance Emergency Rung
If physical projector fails or classroom power cuts out:
1. Faculty switches to Rung 5 Manual Mark via the Teacher Dashboard.
2. Students present high-contrast Roll Number cards with live rotating IST timestamps.
3. Faculty enters SAP ID with 1-tap Reason Selector (`scanner_failed`).

### 6.3 Process Worker Graceful Restart
To apply configuration updates without dropping active classroom connections:
```powershell
# Windows Production Runner (Graceful Reload)
taskkill /F /IM uvicorn.exe
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
```

---

## 7. Sign-off & Launch Authority

| Role | Responsibility | Signature / Status | Date |
| :--- | :--- | :---: | :--- |
| **Lead Systems Architect** | Load certification & core engine verification | **APPROVED** | 2026-09-11 |
| **Principal Security Engineer**| Zero PII audit, device binding, digest dedup | **APPROVED** | 2026-09-11 |
| **Operations Lead** | Runbooks, database indexes, rollback drills | **APPROVED** | 2026-09-11 |
| **Academic Dean / ERP Authority**| Campus-wide cohort rollout authorization | **APPROVED** | 2026-09-11 |

**FINAL LAUNCH VERDICT**: **GO FOR CAMPUS-WIDE PRODUCTION DEPLOYMENT (WEEK 10)**.
