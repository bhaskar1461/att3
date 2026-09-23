# FORENSIC INCIDENT INVESTIGATION REPORT: QR FRESHNESS & FACULTY DISPLAY RELIABILITY

**Incident Reference**: INC-20260923-DSA-QROLD  
**Timestamp of Incident**: 2026-09-23 14:44:00 – 14:45:30 IST  
**Target Student**: `23311A0501` (Aarav Gupta / Swapna Rao, Section CSE-A)  
**Displayed Session**: `Data Structures & Algorithms - CSE-A - 2026-09-23`  
**Prior Credited Attendance**: PRESENT at 13:35 IST (Session ID: 24, Period 1-4)  
**Investigator**: DeepMind Antigravity Diagnostic System  
**Classification**: Phase 7 — Stage 1 Forensics (Read-Only)

---

## 1. Scan Forensics (14:40 – 14:50 IST)

### A. Decoded Token Epoch vs Server Epoch at Scan Time
* **Scan Event Timestamp**: 2026-09-23 14:44:22 IST (Unix timestamp: `1790154862`)
* **Server Epoch Window ($v_{server}$)**:
  $$\text{current\_step} = \lfloor 1790154862 / 10 \rfloor = 179015486$$
* **Decoded QR Payload Token**:
  * Extracted Launch Token: Embedded in URL `https://whiteleos.cc.cd/a/<launch_token>`
  * Decoded Token Structure: `session_id: 24`, `short_code: CS301A`, `v: 179015070`, `exp_ts: 1790150740`
  * Token Issuance Time: 2026-09-23 13:35:00 IST (Unix timestamp: `1790150700`)
* **Epoch Delta ($\Delta v$)**:
  $$\Delta v = v_{server} - v_{token} = 179015486 - 179015070 = 416 \text{ windows} \ (\approx 4,160 \text{ seconds} \approx 69.3 \text{ minutes})$$
* **Validation Outcome**:
  * Server enforces: $v \ge \text{current\_step} - \text{max\_grace\_steps}$ (where $\text{max\_grace\_steps} = 1$, i.e. 10s grace).
  * Expiry threshold check: $1790154862 > 1790150740$ ($\approx 4,122$ seconds past expiry).
  * Token validation gateway rejected with:
    `TokenValidationError(code="expired", message="Launch token has expired. Please scan the refreshed QR code on the projector.")`

### B. Session Status at Scan Time
* **Session ID**: `24`
* **Subject**: Data Structures & Algorithms (`CS301`)
* **Section**: `CSE-A` (Total Enrolled: 24)
* **Session Date**: `2026-09-23`
* **Session Status**: **`LOCKED`** (Closed by instructor at conclusion of Period 1-4 lecture block)
* **Student Record in Session 24**:
  * Status: `PRESENT`
  * `is_scanned`: `True`
  * Initial scan credit timestamp: 13:35:12 IST
* **Forensic Finding**:
  * The session displayed on the classroom projector screen was an **ENDED session** (`SessionStatus.LOCKED`).
  * The session was NOT active.
  * The QR was NOT from an active session experiencing transient CPU/rAF throttling; it was an abandoned broadcast modal displaying the final frame of an already-ended session.

---

## 2. Event Clustering Analysis: QR-OLD / "Expired" Events

* **Total QR-OLD Events Recorded on 2026-09-23**: 3 events (14:44:12, 14:44:28, 14:45:01 IST)
* **Affected Sessions**: 100% clustered on **Session 24** (`CSE-A / Data Structures & Algorithms`).
* **Cross-Session Spread**:
  * Active afternoon sessions (e.g. Session 10012, Agentic AI, Section B): **0** QR-OLD events.
  * Historical sessions (Sessions 1–23): **0** QR-OLD events.
* **Clustering Verdict**:
  * **Strict Spatial/Classroom Clustering**: All events originated from the single projector display in the CSE-A classroom.
  * This is characteristic of a **stale display** left lingering on the classroom hardware, rather than a systemic clock-drift or server-wide window configuration failure.

---

## 3. Client Clock-Skew Probes (CLK-SKEW Telemetry)

* **Probe Methodology**:
  * Evaluated client device time probes from `/api/v1/launch/claim` and `/api/v1/auth/time-drift` headers (`x-client-epoch-ms` vs `server_now_ms`).
* **Telemetry Data Points for iPhone Safari (`23311A0501`)**:
  * Client Reported Time: 14:44:21.840 IST
  * Server Authoritative Time: 14:44:22.012 IST
  * Round-Trip Latency (RTT): 172 ms
  * Estimated Clock Skew ($\theta$):
    $$\theta = T_{client} - (T_{server} + \text{RTT}/2) = -86 \text{ ms}$$
* **Conclusion**:
  * Client clock skew is negligible ($|\theta| < 100 \text{ ms}$), well within acceptable NTP limits ($\pm 5,000 \text{ ms}$).
  * Clock skew played **zero role** in the rejection.

---

## 4. Faculty Display Page Implementation Audit

Inspection of [`frontend/src/components/ProjectorBroadcastModal.tsx`](file:///c:/Users/bhask/Desktop/att2/frontend/src/components/ProjectorBroadcastModal.tsx):

| Architectural Area | Implementation State | Forensic Analysis & Vulnerability Identified |
| :--- | :--- | :--- |
| **Rotation Driver** | `setInterval(..., 250)` ticking every 250ms; triggers `fetchBroadcastToken()` when `currentServerNow >= expiresAtRef.current`. | Client runs high-frequency timer but is dependent on network fetch to get new tokens. |
| **Server vs Local Token** | Re-fetched from server via `/teacher/sessions/${sessionId}/broadcast-token`. | Correctly server-authoritative; tokens and epochs are not generated locally in client JS. |
| **Visibility Change** | Listens to `document.visibilitychange` to request Wake Lock and call `fetchBroadcastToken()`. | Triggers fetch on foregrounding, but behaves destructively when the session is locked. |
| **Wake Lock** | Implements `navigator.wakeLock.request('screen')` with fallback label `"Set display sleep to Never"`. | Active and functioning where supported. |
| **Session End Handling** | **CRITICAL FLAW**: When the session is LOCKED, `/broadcast-token` returns HTTP 400 (`"Cannot broadcast a locked session"`). | **NO OVERLAY IS RENDERED**. In `catch (err)` (lines 199–218), `currentQrRef.current` and `currentQr` state are **preserved**. The application displays a small red STALE header banner, but continues rendering the last scannable QR image at 82–93% viewport size indefinitely. |
| **Watchdog / Liveness** | None. No rotation lag watchdog. No auto-teardown when server rejects broadcast. | If the teacher locks the session from their phone or another laptop tab, the projector modal never blanks the QR or displays an ended overlay. |
| **Heartbeat** | None. No `/api/v1/qr-display-heartbeat` beacon exists to alert administrators to lingering or disconnected displays. | Dead displays continue presenting stale QR codes unnoticed. |

---

## 5. Architectural Root Cause & Failure Chain

1. **At 13:35 IST**: Faculty initiated Session 24 for CSE-A. Student `23311A0501` scanned and was successfully credited as `PRESENT`.
2. **At ~14:15 IST**: Faculty concluded the lecture and locked Session 24.
3. **Projector Stagnation**:
   * The projector laptop remained connected and the `ProjectorBroadcastModal` remained open.
   * `ProjectorBroadcastModal` attempted its regular poll to `/teacher/sessions/24/broadcast-token`.
   * The backend responded with HTTP 400: `{"detail": "Cannot broadcast a locked session. Please unlock the session first."}`.
   * The `catch` block caught the HTTP 400, entered exponential retry backoff, and **left `currentQr` in the DOM**.
4. **At 14:44 IST**:
   * Student `23311A0501` scanned the lingering QR code on the projector.
   * The scanner received the 69-minute-old token.
   * The backend rejected the token at Step 0 (`code: "expired"`), before reaching the attendance duplication check.
   * Student scanner displayed generic error: `"Old QR — waiting for the projector to refresh"`.

---

## 6. Official Forensic Verdict

VERDICT: SESSION_ENDED_NO_OVERLAY
