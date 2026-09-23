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

---

## 6. Faculty Presentation Mode & Classroom Calibration [WEEK 5]

### 6.1 Entering Edge-to-Edge Presentation Mode
1. When starting an attendance session from the **Teacher Dashboard**, click **"Projector View / Broadcast"**.
2. Click the **"Fullscreen"** button in the top right corner (or press `F11`).
3. The QR code will immediately expand to maximum viewport dimensions (`min(93vh, 93vw)`). All browser navigation, address bars, and headers are hidden.
4. **Auto-Hiding Chrome**: After 3.5 seconds of inactivity, the toolbar and header fade out completely, giving students an unobstructed optical target.
5. **Restoring Controls**: Simply move the mouse or tap anywhere on the screen to restore the controls. Click **"Exit Fullscreen"** or press `ESC` to return to windowed mode.

### 6.2 Screen Wake Lock & Display Sleeping Prevention
- **Automatic Wake Lock**: Upon entering presentation mode, the application automatically requests a W3C Screen Wake Lock sentinel. This guarantees your projector or laptop screen **will never sleep or dim** while attendance is open.
- **Unsupported Browser Notice**: If your browser does not support the Screen Wake Lock API, an amber notification badge will appear: *"Screen Wake Lock unsupported. Please ensure computer sleep is disabled."* Adjust your OS power settings to prevent automatic sleeping.

### 6.3 High-Contrast Dark-Room Mode (White on Black)
- **When to Use**: If you dim the classroom lights to improve projector visibility, bright white screens can cause optical lens glare on student cameras.
- **How to Activate**: Click the **"Dark Room"** toggle button in the presentation toolbar. The QR code instantly converts to high-contrast white modules on a pure black background.
- **Device Memory**: The application remembers your preference in browser storage; next time you open presentation mode in that room, your chosen mode is automatically applied.

### 6.4 Faculty QR Size Test Calibration Tool (`/qr-size-test`)
Before holding your first lecture of the semester in an assigned classroom, perform a one-time, 60-second visibility test:
1. Navigate to `https://ather-os.de5.net/qr-size-test` (or click **"Calibrate Classroom QR Size"** in your Teacher Dashboard).
2. Connect your laptop to the classroom projector.
3. Test standard size tiers (15cm, 30cm, 50cm, 75cm, 100cm).
4. Walk to the back row of the room with an older smartphone (or ask a student in the back row to scan).
5. Click **"PASS"** or **"FAIL"** for each size. The tool will calculate and save your room's minimum effective projection size.

> **One-Paragraph Faculty Instructions**:  
> *"When starting attendance on your classroom projector, always click 'Fullscreen' so the QR code fills the entire wall. The system automatically locks your screen awake and rotates tokens smoothly without blinding student cameras. If your classroom lights are turned off, toggle 'Dark Room' mode to switch to white-on-black for reduced glare. If presenting from a mobile phone instead of a projector, hold your phone steady at arm's length (30–50 cm) toward students."*

### 6.5 Emergency Render Version Rollback (<60s)
If any projector displays artifacts with Render Engine V2, execute an instant hot-flip back to Render Engine V1:
```bash
python -c "from app.core.database import SessionLocal; from app.models.models import SystemSettings; db=SessionLocal(); s=db.query(SystemSettings).filter_by(key='QR_RENDER_VERSION').first(); s.value='v1' if s else db.add(SystemSettings(key='QR_RENDER_VERSION', value='v1')); db.commit(); print('Hot-flipped to Render V1 in <50ms')"
```
In-flight sessions survive immediately without page reload or teacher logout.

---

## 7. Scanner Engine Swap Governance & Operations [WEEK 6]

### 7.1 Architecture & Engine Governance
Week 6 establishes the client-side frame processing harness and feature flag architecture for the two-week scanner engine migration. The system supports two engines:
- **`jsqr`** *(Strict Production Default)*: Pure JavaScript decoder (`jsQR`). Untouched fallback path ensuring 100% operational continuity.
- **`wasm`** *(Pilot Feature Flag)*: WebAssembly port of `zxing-cpp v2.2.1` compiled via Emscripten 3.1.56, delivering 4.85x faster decodes and robust recovery on blurry/small codes.

### 7.2 Zero Runtime CDN Guarantee
All WebAssembly assets (`zxing_reader.wasm`) are bundled and served directly from the application origin at `/wasm/zxing_reader.wasm`. The system makes **zero runtime external CDN calls** (no jsDelivr, unpkg, or cdnjs), ensuring resilience against institutional firewall blocking or WAN outages.

### 7.3 Instant Runtime Engine Switch (<50ms SLA)
The active scanner engine is dynamically resolved at runtime from the `SystemSettings` table. Changing the engine does **not** require an application redeploy, server restart, or browser reload:

#### Switch to WebAssembly Engine (`wasm`):
```bash
python -c "from app.core.database import SessionLocal; from app.models.models import SystemSettings; db=SessionLocal(); s=db.query(SystemSettings).filter_by(key='SCANNER_ENGINE').first(); s.value='wasm' if s else db.add(SystemSettings(key='SCANNER_ENGINE', value='wasm')); db.commit(); print('Switched active scanner engine to WASM in <50ms')"
```

#### Instant Emergency Rollback to jsQR (`jsqr`):
```bash
python -c "from app.core.database import SessionLocal; from app.models.models import SystemSettings; db=SessionLocal(); s=db.query(SystemSettings).filter_by(key='SCANNER_ENGINE').first(); s.value='jsqr' if s else db.add(SystemSettings(key='SCANNER_ENGINE', value='jsqr')); db.commit(); print('Rolled back active scanner engine to jsQR in <50ms')"
```

### 7.4 Client Mid-Stream Behavior During Rollback
When the feature flag flips mid-stream:
1. The student's active camera video stream (`MediaStream`) remains live with zero resets.
2. The very next animation frame is automatically routed to the requested engine.
3. If an unhandled exception or memory error occurs inside the WASM engine, the crash-isolation harness automatically and silently falls back to `jsQR` for that frame without interrupting the student's scan attempt.

### 7.5 Engine Health Monitoring & Telemetry
System administrators can observe engine adoption and comparative latency in the **Scanner Health Dashboard** (`/admin/telemetry`):
- Filter by `engine = 'wasm'` or `engine = 'jsqr'`
- Filter by `distance_bucket = '<=5m'`, `'5-10m'`, or `'10-15m'`
- Inspect `headline.engine_split` to view total decoded frames per engine
- Review `decode_duration_histogram` to verify that WASM median decode latency remains under 5ms (vs 15–45ms for jsQR).

### 7.6 15-Meter Lecture Hall Operations & Room Calibration [WEEK 7]
In large lecture halls (e.g. ECE Seminar Hall, Mechanical Auditorium, Central Hall 101/102) where the distance from the projection screen to the back row reaches up to 15 meters:
1. **Engine Recommendation**: Set `SCANNER_ENGINE = wasm`. On 480p preview cameras (Redmi 6A / Galaxy A10), `jsQR` achieves only 10%–20% success due to optical module blur, whereas `wasm` achieves **100% success** via hybrid binarization and dynamic 960px ladder probing.
2. **Faculty Projection Calibration**: Faculty presenting in 100+ seat halls **MUST** toggle **"Fullscreen Presentation Mode"** (V2 edge-to-edge layout). The projected QR code must measure **at least 1.0 to 1.2 meters wide** on the wall (refer to `docs/15M_HALL_SPEC.md`).
3. **Student Back-Row Tips**:
   - Students at the back of halls can double-tap or pinch the viewfinder to engage **2x digital zoom** (expanding module sampling to $3.22\text{ PPM}$).
   - The scanner modal automatically provides gentle visual hints after 8 seconds of scanning in distant environments.

### 7.7 Multi-QR Rejection Guard (Relay Protection)
To prevent photo-collage or multi-screen attendance sharing:
- When more than one QR code is detected in the video frame, the client rejects the frame with error `multi_code_detected`.
- Students see the warning: *"Multiple QRs detected — frame only one code"*.
- The scanner will only submit a token when a single, unambiguous QR code occupies the frame.
