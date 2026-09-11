# Operational Runbook: Short-Token QR Pilot Operations & Incident SOP [WEEK 4]

**System**: SNIST ERP Attendance Engine (FastAPI + React 18 PWA)  
**Document Status**: **OFFICIAL OPERATING PROCEDURE FOR ADMINS & HODs**  
**Revision**: 1.0 (Production Pilot Week 4)  
**Scope**: ather-os.de5.net (Prod) & dev-ather-os.de5.net (Dev)  

---

## 1. Flag Semantics & Architectural Governance

Classroom attendance is mission-critical: **no lecture may be interrupted by experimental features**. The Short-Token QR system is governed by a server-authoritative, runtime-readable configuration flag.

### 1.1 Flag Modes (`QR_TOKEN_FORMAT`)

| Mode Setting | QR Generation (Teacher Terminal) | Student Ingestion (Scan Endpoint) | Purpose & Intended Use |
|:---|:---|:---|:---|
| **`legacy`** | Generates 96-char full HMAC (`SNIST-SES\|...`) with 45×45 grid. | Accepts both legacy and short tokens. | Safe emergency fallback; zero behavioral delta from pre-W3 production. |
| **`dual`** *(Default)* | Generates **short** for pilot cohorts, **legacy** for non-pilot cohorts. | Accepts both legacy and short tokens. | Staged cohort pilot with zero impact on non-pilot departments. |
| **`short`** | Generates slim URL parameter token (`?s=...&v=...`) with 25×25 grid. | Accepts both legacy and short tokens. | Full campus rollout mode once pilot criteria are achieved. |

### 1.2 Dual-Mode Cohort Routing Logic
When `QR_TOKEN_FORMAT="dual"`, the backend dynamically evaluates:
1. `QR_PILOT_SECTIONS`: Comma-separated list of section IDs (e.g. `"1,2"`). If the session belongs to a listed section $\to$ **`short` format** emitted.
2. `QR_PILOT_DEPARTMENTS`: Comma-separated list of department codes (e.g. `"CSE,ECE"`). If the session's department matches $\to$ **`short` format** emitted.
3. All other sections/departments $\to$ **`legacy` format** emitted.

---

## 2. Daily Monitoring Rhythm (The Operator's Checklist)

The on-duty system administrator and departmental coordinators must execute the following 3-stage daily monitoring protocol:

### 2.1 Morning Pre-Flight (08:00 – 08:30 IST)
- [ ] Open **Scanner Health Dashboard** at `https://ather-os.de5.net/admin/telemetry`.
- [ ] Filter by `token_format = 'short'` to review overnight test traffic and previous afternoon sessions.
- [ ] Verify **Ingest Lag < 5 seconds** (telemetry worker healthy).
- [ ] Confirm today's pilot sections are properly configured in `SystemSettings`.

### 2.2 Live Lecture Watch (During Pilot Hours)
- [ ] Monitor real-time `/telemetry/scanner-health` during attendance windows (09:15, 11:30, 14:00).
- [ ] Check metric split:
  * **Old-bucket first-attempt success**: Must remain $\ge 90.0\%$.
  * **Overall p50 time-to-mark**: Must remain $\le 1.8\text{s}$.
  * **Manual-mark rate**: Must remain $\le 3.0\%$.

### 2.3 Alert Triggers (Check 3× Daily: 10:30, 13:30, 16:30 IST)
Trigger immediate operational diagnosis if any of the following occur:
1. **New Error Type**: Any error appearing in telemetry that is not in the recognized taxonomy (`decode_timeout`, `token_expired`, `camera_initialization_failed`, `camera_permission_denied`).
2. **Old-Bucket Drop**: Pilot old-bucket success rate falls below matched control legacy rate ($<89.0\%$).
3. **5xx Scan Spikes**: Any HTTP 500/502/504 errors on `/api/v1/student/scan-session`.
4. **Token Expiry Surge**: `token_expired` rate exceeds $2.0\%$ in any individual session.

---

## 3. Instant Rollback SOP (<60s SLA for Admin / HOD)

If a classroom incident occurs or pilot metrics degrade, execute the instantaneous rollback drill. **No server restart or code deployment is required.**

### 3.1 Option A: Database Hot-Flip (Immediate — Execution Time < 50ms)
Run the following SQL statement against the production database:
```sql
-- Instantaneous Rollback to Legacy QR Generation
INSERT INTO system_settings (`key`, `value`, `updated_at`)
VALUES ('QR_TOKEN_FORMAT', 'legacy', NOW())
ON DUPLICATE KEY UPDATE `value` = 'legacy', `updated_at` = NOW();
```

Or via Python CLI on the application host:
```bash
python -c "from app.core.database import SessionLocal; from app.models.models import SystemSettings; db=SessionLocal(); s=db.query(SystemSettings).filter_by(key='QR_TOKEN_FORMAT').first(); s.value='legacy' if s else db.add(SystemSettings(key='QR_TOKEN_FORMAT', value='legacy')); db.commit(); print('Successfully flipped to LEGACY')"
```

### 3.2 In-Flight Session Guarantees Post-Rollback
- **Active Sessions Continue Seamlessly**: The teacher terminal does not crash or logout; on its next 10s rotation cycle, it immediately renders the legacy full QR code.
- **In-Flight Tokens Validated**: Any student phone that captured the short QR right before the flip can submit their token without rejection—the backend validator accepts both formats unconditionally.
- **Zero Double-Scanning**: Prior scan records remain permanently present in the database.

---

## 4. Student & Faculty Communications Brief

To maintain calm operational discipline, distribute the following pre-approved notice across official department channels:

> **Faculty & Student Announcement**:  
> *"As part of our continuous system performance upgrades, the attendance QR code is transitioning to a high-efficiency compact format across selected lecture halls this week. The new QR code is smaller, less dense, and scans significantly faster—especially on older smartphone models and at long distances from classroom projectors. **No student or faculty action is required.** Your login, camera interface, and scanning procedure remain completely unchanged. In the rare event of scanning difficulties, report to your session coordinator immediately."*

---

## 5. Housekeeping & Maintenance SOP

1. **Short Token Registry Table Maintenance**:
   Run the scheduled cleanup script nightly at 02:00 IST to purge expired tokens older than 24 hours:
   ```bash
   python -c "from app.core.database import SessionLocal; from app.services.qr_token import ShortTokenService; db=SessionLocal(); purged=ShortTokenService.cleanup_expired_tokens(db); print(f'Purged {purged} expired short tokens')"
   ```
2. **Database Index Verification**:
   Ensure `INDEX uq_short_code` on `qr_short_token_registry` is healthy. Lookups must execute as $O(1)$ unique index seeks ($<0.02\text{ms}$).
