# SNIST ERP ATTENDANCE SYSTEM — OPERATIONS RUNBOOK (OPS_RUNBOOK.md)

> **Audience**: System Administrators, Campus IT Staff, Faculty Operations Leads  
> **Release Target**: Production (`ather-os.de5.net`) & Dev/Staging (`dev-ather-os.de5.net`)  
> **Classification**: Master Institutional Runbook  
> **Associated Artifacts**: [FINAL_CONTRACT_REPORT.md](file:///c:/Users/bhask/Desktop/att2/docs/FINAL_CONTRACT_REPORT.md), [CONFIG_REFERENCE.md](file:///c:/Users/bhask/Desktop/att2/docs/CONFIG_REFERENCE.md), [EVIDENCE_INDEX.md](file:///c:/Users/bhask/Desktop/att2/docs/EVIDENCE_INDEX.md)

---

## 1. Daily Administrative Rhythm

| Time (IST) | Action / Responsibility | Tools / URLs | Expected Normal State |
|---|---|---|---|
| **08:45 AM** | **Pre-Class Health Inspection**: Verify FastAPI daemon, MySQL connection pool, and Scanner Health dashboard. | Admin Portal -> **Scanner Health** Tab (`/admin`) | Engine: `WASM (zxing-cpp)`. Health: Green. PWA service worker active. |
| **09:30 AM** | **Morning Session Peak Monitoring**: Observe concurrent student scan load during Period 1 classroom check-ins. | Scanner Health Funnel & Realtime Telemetry | Overall p50 latency $< 1.0\text{s}$, first-attempt rate $> 97\%$. Zero 500 errors. |
| **01:15 PM** | **Afternoon Handover Check**: Verify morning attendance synchronization to Google Sheets and local DB. | Admin Reports -> Attendance Sync (`/reports`) | Sync status: 100% completed. Unsynced queue: 0. |
| **04:30 PM** | **End-of-Day Rollup & Anomaly Review**: Inspect daily manual-mark reliance and review any AMBER/RED flagged sessions. | Admin Portal -> Raw Session Audit Modal | Manual reliance $< 3.0\%$. Zero unexplained RED anomalies. |
| **05:15 PM** | **Automated HOD Digest Review**: Verify automated dispatch of daily security digest to departmental heads. | SMTP Mailer / Notification Logs | Digest emails delivered; no bounce-backs. |

---

## 2. Emergency Incident Playbook

### Incident 1: Projector Optical Decode Stalled (Back Rows Unable to Scan)
* **Symptom**: Students seated $> 10\text{m}$ report "scanning..." spinner without decode; camera times out after 10s.
* **Immediate Mitigation**:
  1. **Zoom/Scale**: Ensure Teacher projector screen is displaying in Full-Screen Mode (`F11` in Teacher Portal).
  2. **Display Setting Verification**: Verify `QR_RENDER_VERSION=v2` (high-contrast, edge-to-edge, ECC L).
  3. **Temporary Faculty Action**: Instruct faculty to click "Show Larger QR" or step toward the center aisle with phone display if projector lamp lumen output is degraded ($< 1500\text{ ANSI lumens}$).
  4. **Degradation Ladder**: Advise students on older Android devices to switch to 2x zoom mode (available via single-tap in PWA).

### Incident 2: WASM Worker Crash or Loading Failure on Legacy Devices
* **Symptom**: Telemetry shows spike in `WASM_WORKER_ERROR` or older devices fallback to `jsqr`.
* **Immediate Mitigation (Instant Zero-Downtime Rollback)**:
  * In `backend/.env` (or Admin Feature Flags), set:
    ```bash
    SCANNER_ENGINE=jsqr
    ```
  * Reload backend process (`systemctl restart snist-erp` or pm2 reload).
  * **Result**: All PWAs immediately receive `SCANNER_ENGINE=jsqr` on their next config heartbeat and switch to pure JS decoding without requiring client app updates.

### Incident 3: High Manual-Mark Volume Triggered (AMBER / RED Alert)
* **Symptom**: Teacher triggers AMBER ($\ge 15\%$) or RED ($\ge 30\%$) warning during a single session.
* **Procedure**:
  1. Open **Admin Portal -> Scanner Health -> Audit Logs**.
  2. Locate the flagged session ID. Check `manual_reason` distribution (e.g. `scanner_failed`, `device_lost`, `camera_permission_denied`).
  3. If `scanner_failed` dominates: Dispatch IT technician to inspect classroom projector optical contrast and room ambient light.
  4. If `late_join` or `device_lost` dominates without physical justification: Forward session audit trail to Department HOD for faculty inquiry.

### Incident 4: Campus Internet Outage During Lecture Period
* **Symptom**: Classroom WiFi disconnects mid-session; students see "Offline — scan queued locally".
* **Procedure**:
  1. Inform students and faculty that the PWA **automatically queues scans in IndexedDB**.
  2. Do **NOT** panic-mark the entire class manually.
  3. Ensure students stay logged into the PWA. As soon as connectivity is restored (or when students connect to mobile data/campus WiFi), queued scans automatically flush via `POST /api/v1/student/scan-session` with `is_offline_submission=True`.
  4. **Critical Time Window**: Submissions must arrive within **10 minutes** of session lock (`SUBMIT_GRACE_MINUTES=10`).

---

## 3. Classroom Setup & 15m Hall-Room Specification Excerpt

To achieve the certified 15-meter range across tiered lecture halls, classrooms must adhere to the following physical baseline:

```
[Projector Screen (≥ 100 in / 2.5m diag)]
   │
   ├────── 0m - 5m:   Front Row    (Any device, < 0.3s decode)
   ├────── 5m - 10m:  Mid Hall     (Standard 1x zoom, < 0.6s decode)
   └────── 10m - 15m: Rear Rows    (Requires 2x zoom / ZXing-C++ WASM, < 1.5s decode)
```

1. **Screen Diagonal**: Minimum 100 inches ($2.54\text{m}$) for lecture halls with depth $> 10\text{m}$.
2. **Projector Brightness**: Minimum $3,000\text{ ANSI Lumens}$. Rooms with direct sunlight must lower front-row window blinds.
3. **Aspect Ratio & Margin**: 1:1 square canvas, zero surrounding border padding (`margin=0`), black modules on pure white `#FFFFFF` background.
4. **Resolution**: Native $1080\text{p}$ ($1920 \times 1080$). Never use VGA analog cables; use digital HDMI or DisplayPort connections to prevent horizontal ghosting and phase jitter.

---

## 4. Manual-Mark Standard Operating Procedure

Manual attendance marking is a restricted, audited fallback. It must never be used as the primary attendance method.

1. **When Permitted**:
   * Student device battery dead or physically broken during class.
   * Student camera hardware failure (sensor initialization failure / permission denied).
   * Verified transfer or late-admission student pending enrollment roster update.
2. **Procedure for Faculty**:
   * Open Teacher Portal -> Active Session.
   * Click **Manual Mark Attendance**.
   * Enter Student **Roll Number** / **SAP ID**.
   * Select mandatory **Reason Enum**:
     * `scanner_failed` (Requires entering detail in notes)
     * `device_lost`
     * `late_join`
     * `other`
   * Click Submit. If session manual marks exceed 25, acknowledge the administrative confirmation modal.
3. **Audit Trail**: The mark is permanently tagged with `scan_mode = 'MANUAL'` and marked with `(M)` across all reports.

---

## 5. System Capacity & Concurrency Limits

* **Peak Concurrent Active Faculty Sessions**: 120 simultaneous classroom projections.
* **Peak Scan Ingestion Rate**: Up to 600 scans per second across campus during period boundaries.
* **Fast-Path Memory Token Validation**: $< 0.05\text{ms}$ per token.
* **Async Ingestion Queue**: 2,000 in-memory queue slots serviced by 10 background database worker threads (`AsyncAttendanceWriter`).
* **Connection Pool**: 25 bounded concurrent DB execution tokens.

---

## 6. Device Binding V2 Operational Procedures (Phase 3 Dev-Only)

> **Feature Gate**: Controlled by environment variable `BINDING_V2=true/false` (Default: `false` / OFF on production).

### 6.1 Student Device Enrollment & Idempotent Refresh
- **First-Time Setup**: When a student logs into the PWA on an authorized personal smartphone, the client generates a non-extractable ECDSA P-256 keypair and registers the public key via `POST /api/v1/binding/enroll`. The server assigns an institutional `key_id` and records `enrolled_via='self'`.
- **Same-Device Logins**: When the same student logs in again on the same device, the PWA presents the identical public key. The server returns `status: "BINDING_REFRESH"`. No friction, no email OTP, and zero duplicate database rows.

### 6.2 Student Rebind Friction (New Device or Clear-Site-Data)
- **Friction Protocol**: If an active binding already exists and a student attempts to enroll a *different* public key (e.g., replacement phone), the server responds with `status: "REBIND_REQUIRED"` and automatically dispatches a 6-digit hashed OTP to their institutional email (`expires_at: +10 minutes`).
- **Student Action**: The student enters the 6-digit verification code. Upon validation, the server atomically revokes the previous binding (`revoked_reason='rebind'`) and activates the new key in a single database transaction.
- **Churn Rate Limit**: A student may perform at most **2 rebinds in any rolling 30-day window** (`ENROLL_LIMIT_30_DAYS=2`). Exceeding this threshold returns HTTP 429 (`CHURN_LIMIT_EXCEEDED`) and instructs the student to consult their department HOD.

### 6.3 Administrative Revocation SOP (Lost / Stolen / Factory-Reset Phones)
If a student loses their phone, fractures the device screen, or exceeds the churn limit due to a hardware replacement, Department Administrators or Super Admins can execute an administrative reset:
1. Open Admin Portal -> **Device Management** (or call `POST /api/v1/binding/admin/revoke/{student_id}`).
2. Enter the student's **Roll Number** / **SAP ID** and specify the reason.
3. The server sets `revoked_at = NOW()` with `revoked_reason = 'admin_reset'`.
4. **Exemption**: Admin resets are **exempt** from the student's 30-day churn quota.
5. The student can now enroll their replacement device immediately on their next login without OTP friction.

### 6.4 Reviewing Churn Anomalies
1. Call `GET /api/v1/binding/admin/churn-anomalies` to retrieve a list of students with elevated device replacement activity.
2. Status Codes:
   - `AMBER`: Exactly 2 rebinds in 30 days (approaching ceiling).
   - `RED`: $>2$ rebinds in 30 days (locked out from self-serve rebind).
3. Investigate potential device sharing, proxy attempts, or recurring hardware faults.

