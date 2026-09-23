# SNIST ERP ATTENDANCE SYSTEM — SYSTEM CONFIGURATION REFERENCE

> **Document Status**: RELEASE ACCEPTED (Week 10 Master Configuration)  
> **Classification**: Operations & Engineering Handover Specification  
> **Scope**: Backend (`FastAPI`), Worker daemons, Telemetry pipelines, and Frontend environment  
> **Associated Artifacts**: [EVIDENCE_INDEX.md](file:///c:/Users/bhask/Desktop/att2/docs/EVIDENCE_INDEX.md), [OPS_RUNBOOK.md](file:///c:/Users/bhask/Desktop/att2/docs/OPS_RUNBOOK.md)

---

## 1. Overview & Principles

The SNIST ERP Attendance System enforces zero-trust attendance authentication through server-authoritative parameters. All operational parameters are:
1. **Configurable via Environment Variables**: With sensible, security-first defaults.
2. **Defensively Typed**: Cast and validated on startup; invalid values fall back safely to defaults.
3. **Rollback-Safe**: All new algorithms (e.g. WASM engine, Crockford short tokens, V2 edge-to-edge render) feature immediate zero-downtime rollback flags.

---

## 2. Core Security & Cryptography

| Variable Name | Env Var | Type | Default | Operational Rationale & Invariant |
|---|---|---|---|---|
| `SECRET_KEY` | `SECRET_KEY` | `str` | *Hex string* | Master HMAC key for signing admin and student JWT tokens. Rotated biannually. |
| `QR_SECRET_KEY` | `QR_SECRET_KEY` | `str` | *32-byte hex* | Cryptographic root key for AES-256-GCM / HMAC-SHA256 student and projector QR payloads. |
| `ALGORITHM` | `ALGORITHM` | `str` | `"HS256"` | Canonical JWT signing algorithm. |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `ACCESS_TOKEN_EXPIRE_MINUTES` | `int` | `10080` (7 days) | Staff and Administrator session lifetime. |
| `STUDENT_TOKEN_EXPIRE_SECONDS` | `STUDENT_TOKEN_EXPIRE_SECONDS` | `int` | `900` (15m) | Short-lived student access token. Automatically refreshed during active app use. |
| `REFRESH_TOKEN_EXPIRE_HOURS` | `REFRESH_TOKEN_EXPIRE_HOURS` | `int` | `12` | Sliding refresh token window matching a standard institutional school day. |

---

## 3. QR Token Lifecycle & Rotation (Weeks 3, 4, 5)

| Variable Name | Env Var | Type | Default | Operational Rationale & Invariant |
|---|---|---|---|---|
| `TOKEN_ROTATION_SECONDS` | *Hardcoded* | `int` | `10` | Frequency at which projector QR codes rotate to a new Crockford Base32 slot `v`. |
| `TOKEN_GRACE_SECONDS` | `TOKEN_GRACE_SECONDS` | `float` | `3.0` | Sub-second sliding grace window post-slot boundary to accommodate optical decode and network transit. |
| `QR_TOKEN_FORMAT` | `QR_TOKEN_FORMAT` | `str` | `"dual"` | Allowed: `"legacy"` \| `"short"` \| `"dual"`. Dual mode accepts both legacy V1/V2 and slim Crockford-32 tokens. |
| `QR_RENDER_VERSION` | `QR_RENDER_VERSION` | `str` | `"v2"` | Allowed: `"v1"` (legacy standard) \| `"v2"` (high-contrast, edge-to-edge, ECC L, zero-chrome for 15m range). |
| `QR_ECC_LEVEL` | `QR_ECC_LEVEL` | `str` | `"L"` | Error correction level (`"L"` = ~7% overhead). Minimizes matrix density to 21×21 modules. |
| `QR_PILOT_SECTIONS` | `QR_PILOT_SECTIONS` | `str` | `"1,2"` | Comma-separated section IDs participating in dynamic pilot rollouts. |
| `QR_PILOT_DEPARTMENTS` | `QR_PILOT_DEPARTMENTS` | `str` | `"CSE,ECE"` | Comma-separated departments participating in staged features. |

---

## 4. Anti-Proxy, Device Binding & Rate Limiting (Weeks 1, 8, 9)

| Variable Name | Env Var | Type | Default | Operational Rationale & Invariant |
|---|---|---|---|---|
| `DEVICE_BINDING_MINUTES` | `DEVICE_BINDING_MINUTES` | `int` | `30` | Server-authoritative device lock duration. Prevents account-switching on the same physical phone. |
| `MAX_BINDING_AUTH_ATTEMPTS` | `MAX_BINDING_AUTH_ATTEMPTS` | `int` | `10` | Max re-authentications permitted per bound device per 15-minute window. |
| `MAX_FAILED_LOGIN_ATTEMPTS` | `MAX_FAILED_LOGIN_ATTEMPTS` | `int` | `5` | Failed password submissions before triggering 15-minute account cooldown. |
| `LOGIN_RATE_LIMIT_WINDOW_SECONDS`| `LOGIN_RATE_LIMIT_WINDOW_SECONDS`| `int`| `900` (15m) | Rolling window duration for tracking brute-force authentication attempts. |
| `STUDENT_SCAN_RATE_LIMIT` | *In-Memory* | `int` | `6` scans/min | Maximum scan attempts per roll number per minute. Prevents rogue loop scraping. |
| `FAILED_TOKEN_MAX_FAILURES` | *In-Memory* | `int` | `15` failures | Consecutive HMAC token validation failures in 60s that trigger a 60s client IP cooldown (HTTP 429). |

---

## 5. Offline Submission & Scale Resilience (Week 9)

| Variable Name | Env Var | Type | Default | Operational Rationale & Invariant |
|---|---|---|---|---|
| `SUBMIT_GRACE_MINUTES` | `SUBMIT_GRACE_MINUTES` | `int` | `10` | Bounded interval post-session-lock (`locked_at`) in which queued offline scans are accepted. |
| `ACTIVE_ROLLOUT_DEPARTMENTS` | `ACTIVE_ROLLOUT_DEPARTMENTS` | `str` | `"CSE,ECE,IT,MECH,CIVIL,EEE,AIML"` | Comma-separated departments enabled for full staged production attendance. |
| `ASYNC_ATTENDANCE_WORKERS` | *In-Memory* | `int` | `10` | Concurrent worker threads processing async attendance queue (`AsyncAttendanceWriter`). |
| `ASYNC_QUEUE_MAXSIZE` | *In-Memory* | `int` | `2000` | Bounded in-memory queue capacity for async scan ingestion before backpressure fires. |
| `SCAN_CONCURRENCY_TOKENS` | *In-Memory* | `int` | `25` | Maximum concurrent database operations allowed during student scan path. |

---

## 6. Scanner Engine & Manual Guardrails (Weeks 7, 8)

| Variable Name | Env Var | Type | Default | Operational Rationale & Invariant |
|---|---|---|---|---|
| `SCANNER_ENGINE` | `SCANNER_ENGINE` | `str` | `"wasm"` | Allowed: `"wasm"` (ZXing-C++ WebAssembly) \| `"jsqr"` (instant JS fallback). |
| `MANUAL_MARK_AMBER_THRESHOLD_PCT` | `MANUAL_MARK_AMBER_THRESHOLD_PCT` | `float` | `15.0` | Percentage of present students marked manually that triggers **AMBER** advisory status. |
| `MANUAL_MARK_RED_THRESHOLD_PCT` | `MANUAL_MARK_RED_THRESHOLD_PCT` | `float` | `30.0` | Percentage of present students marked manually that triggers **RED** audit escalation. |
| `MANUAL_MARK_MAX_PER_SESSION_CAP` | `MANUAL_MARK_MAX_PER_SESSION_CAP` | `int` | `25` | Session manual mark limit before demanding an explicit operator confirmation modal. |

---

## 7. JNTUH R25 Institutional Regulations

| Variable Name | Env Var | Type | Default | Operational Rationale & Invariant |
|---|---|---|---|---|
| `JNTUH_ELIGIBLE_THRESHOLD` | `JNTUH_ELIGIBLE_THRESHOLD` | `float` | `75.0` | Minimum semester attendance percentage required for unencumbered exam hall-ticket issue. |
| `JNTUH_CONDONABLE_THRESHOLD` | `JNTUH_CONDONABLE_THRESHOLD` | `float` | `65.0` | Condonation cutoff (65%–74.9%). Requires medical/duty certificates and VC approval. |
| `MIN_SESSIONS_THRESHOLD` | `MIN_SESSIONS_THRESHOLD` | `int` | `3` | Minimum sessions conducted before calculating defaulter percentages. |
| `DEFAULT_SEMESTER_SESSIONS` | `DEFAULT_SEMESTER_SESSIONS` | `int` | `60` | Canonical semester session baseline used for late-join and projection calculations. |
| `JNTUH_INCLUDE_APPROVED_ABSENCES`| `JNTUH_INCLUDE_APPROVED_ABSENCES`| `bool` | `True` | Whether sports/medical leaves count toward the JNTUH numerator. |

---

## 8. Telemetry Retention & Rollups (Weeks 1, 9)

| Parameter | Location | Default | Operational Rationale |
|---|---|---|---|
| Telemetry Event TTL | `qr_scan_telemetry_events` | 90 Days | Raw scan event purge window. Retains sub-second forensic traces for one full semester. |
| Daily Rollup Retention | `qr_scanner_health_daily` | 365 Days (1 Year) | Pre-aggregated percentiles and bucket health for institutional multi-semester comparisons. |
| Audit Trail Retention | `qr_audit_logs` | Indefinite | Permanent immutable security log of all admin, device, and anomaly events. |
