# SNIST ERP ATTENDANCE ENGINE — FINAL EXECUTIVE BRIEFING & DEMO SCRIPT (FINAL_PRESENTATION_DECK.md)

> **Audience**: Head of Department (HOD), Academic Dean, Faculty Advisory Council  
> **Session Length**: 15 Minutes (10 min Briefing & Demo + 5 min Q&A)  
> **Presenter**: Lead Engineering Architect & Telemetry Custodian  
> **Status**: APPROVED FOR PRESENTATION  
> **Associated Artifacts**: [FINAL_CONTRACT_REPORT.md](file:///c:/Users/bhask/Desktop/att2/docs/FINAL_CONTRACT_REPORT.md), [THREAT_MODEL_FINAL.md](file:///c:/Users/bhask/Desktop/att2/docs/THREAT_MODEL_FINAL.md), [KNOWN_LIMITS.md](file:///c:/Users/bhask/Desktop/att2/docs/KNOWN_LIMITS.md)

---

## 1. The Story Arc (5 Minutes)

### Slide 1: The Problem We Inherited (Week 0)
* **The Reality**: Faculty were spending 12 to 15 minutes per 50-minute lecture period taking roll call or dealing with frozen classroom scanner apps.
* **The Friction**: Students in the back rows (8–15 meters away) couldn't scan the dense 96-character QR codes projected on dim screens.
* **The Vulnerability**: Proxy attendance was rampant via WhatsApp screenshots and students logging into absent peers' accounts.

### Slide 2: The Engineering Journey (Weeks 1 – 9)
* **Week 1–2**: Built deep telemetry. Discovered that 78.4% of total time-to-mark was lost in optical camera focus and decode hunting, not backend API speed. Frozen real classroom baseline ($N=524$).
* **Week 3–5**: Invented Crockford Base32 slim tokens ($1.1 \times 10^{12}$ combinations, 8 characters). Shrunk QR density by 73% (from 45×45 to 21×21 modules). Upgraded display rendering to edge-to-edge high contrast.
* **Week 6–7**: Compiled `zxing-cpp` to WebAssembly (WASM). Certified 15-meter hall-room optical decode range on real hardware.
* **Week 8–9**: Hardened the degradation ladder, instituted manual-mark anomaly thresholds (15% Amber, 30% Red), certified 600 req/sec load, and deployed offline IndexedDB resilience.

### Slide 3: The Contract Scorecard (Today)
* **Time-to-Mark**: Slashed from **2.61s down to 0.74s** ($p50$, **-71.7%** reduction).
* **Old-Tier Hardware**: Old budget smartphones went from **6.22s down to 1.27s** ($p50$, **-79.6%** reduction).
* **Manual Override Reliance**: Dropped from **3.20% down to 0.61%** (well below our $< 3.0\%$ target).
* **The Declared Miss**: Old-tier terminal failure rate ended at **3.1%** vs our $< 3.0\%$ target due to legacy Android 8 camera driver panics. We declare it openly, explain the hardware diagnosis, and present the bounded manual fallback.

---

## 2. The 15-Minute Live Demonstration Script

> [!IMPORTANT]
> Rehearsed on live lab devices: 1 Projector Laptop (`prof_cse`), 1 Modern Phone (Pixel 7 / iPhone 13), 1 Legacy Phone (Redmi 6A / Galaxy J2 running Android 8).

### Act I: Session Creation & Instant Optical Decode (Minutes 0:00 – 3:30)
* **0:00**: Presenter logs into Teacher Portal on projector laptop. Clicks "Start Live Class" for CSE-A Operating Systems.
* **0:45**: Projector displays the rotating, high-contrast slim QR code. Presenter points out the rotation countdown timer (10s slot) and the clean 21×21 module geometry.
* **1:15**: Student with modern phone opens PWA at a distance of **8 meters**. Points camera at screen.
* **1:30**: **BEEP!** Green confirmation modal pops up in **0.21 seconds**. Attendance marked present.
* **2:15**: Presenter points to Teacher screen: attendance counter increments to 1 in real time via WebSocket sync.

### Act II: 15-Meter Long-Range Hall Scan on Old Phone (Minutes 3:30 – 6:30)
* **3:30**: Presenter walks to the very back row of the lecture hall (**14.5 meters** from the screen) holding the low-end Redmi 6A.
* **4:15**: Opens the PWA scanner. Taps the screen once to activate **2x Digital Zoom**.
* **4:45**: WASM Web Worker locks onto the high-contrast Crockford QR code.
* **5:15**: **BEEP!** Attendance verified in **1.27 seconds**.
* **5:45**: Presenter highlights: *"Even at 14.5 meters on a 6-year-old budget phone, attendance was captured in under 1.5 seconds without the student leaving their seat."*

### Act III: Forced Hardware Degradation & Audited Manual Mark (Minutes 6:30 – 9:00)
* **6:30**: Presenter demonstrates what happens when a student's camera hardware is physically taped over or broken (simulating sensor failure).
* **7:00**: Scanner watchdog reaches 10 seconds. Camera degradation ladder triggers: *"Camera unable to focus? Switch to manual check-in."*
* **7:30**: Student informs teacher. Teacher opens Teacher Portal -> "Manual Mark Attendance".
* **8:00**: Teacher enters roll number `24311A6201`, selects mandatory reason `scanner_failed`, enters note *"Lens scratch"*, and submits.
* **8:30**: Mark is recorded with prominent `(M)` badge. Presenter shows that if teacher tries to mark > 15% of the class manually, the session status immediately triggers an **AMBER** advisory warning.

### Act IV: The Live Executive Dashboard & Contract Proof (Minutes 9:00 – 11:00)
* **9:00**: Switch to the Admin Portal on main screen. Open the **Scanner Health Dashboard**.
* **9:30**: Click **"Contract Verdict (Baseline vs Today)"**.
* **10:00**: Present the side-by-side waterfall table:
  * Camera Open: $1,180\text{ms} \to 280\text{ms}$
  * Decode Duration: $940\text{ms} \to 192\text{ms}$
  * Total p50: $2.61\text{s} \to 0.74\text{s}$
* **10:30**: Open **Audit Logs Tab**: Show the immutable record of all scans, device bindings, and the adversarial drill traces.

---

## 3. Tough HOD Questions Pre-Answered (Q&A Defense)

### Q1: "Isn't an 8-character code guessable? What stops a student from writing a bot to guess codes?"
* **Answer**:
  * An 8-character Crockford Base32 token represents $32^8 \approx 1,099,511,627,776$ (~1.10 trillion) combinations.
  * Tokens are only valid for **10 seconds** (`step_window=10`).
  * Our server-side rate limiters immediately clamp any student submitting more than **6 scans per minute** (HTTP 429), and block any IP sending **15 invalid tokens in 60s**.
  * A brute-force attacker has less than a $1 \text{ in } 73\text{ billion}$ probability of guessing a valid token before lockout.
  * **Artifact Reference**: [EV-W03-01](file:///c:/Users/bhask/Desktop/att2/docs/EVIDENCE_INDEX.md#EV-W03-01), [SECURITY_DIFF_SHORT_TOKEN.md](file:///c:/Users/bhask/Desktop/att2/docs/SECURITY_DIFF_SHORT_TOKEN.md).

### Q2: "Can't a present student photograph the screen and WhatsApp it to their absent friend in the hostel?"
* **Answer**:
  * The QR code changes every **10 seconds**. With sub-second network transit, photographing, uploading, sending via WhatsApp, downloading, and scanning from another screen takes at least 12 to 18 seconds.
  * By the time the hostel student scans the screenshot, the token is expired and rejected with HTTP 400 (`Expired projector token`).
  * Furthermore, even if sent via live screen-share within 5 seconds, screen-to-screen re-photographing introduces moiré distortion and rolling shutter artifacts that fail decoding within the remaining 3 seconds.
  * **Artifact Reference**: [EV-W10-01](file:///c:/Users/bhask/Desktop/att2/docs/EVIDENCE_INDEX.md#EV-W10-01), [THREAT_MODEL_FINAL.md](file:///c:/Users/bhask/Desktop/att2/docs/THREAT_MODEL_FINAL.md#3-adversarial-red-team-mini-drill).

### Q3: "What happens when the campus WiFi goes down during class?"
* **Answer**:
  * The system is offline-resilient. The PWA caches credentials in `IndexedDB`.
  * Scans captured during network drops are stored securely with client timestamps.
  * When connectivity returns, the PWA automatically synchronizes queued attendance via `POST /api/v1/student/scan-session` within a strict **10-minute grace window** post-class (`SUBMIT_GRACE_MINUTES=10`).
  * **Artifact Reference**: [EV-W09-02](file:///c:/Users/bhask/Desktop/att2/docs/EVIDENCE_INDEX.md#EV-W09-02), [test_week9_scale_and_offline.py](file:///c:/Users/bhask/Desktop/att2/backend/tests/test_week9_scale_and_offline.py).

### Q4: "How do we know faculty won't abuse the manual mark feature to mark their favorite students?"
* **Answer**:
  * Every manual mark requires a mandatory typed reason enum (`scanner_failed`, `device_lost`, `late_join`).
  * Manual marks are permanently branded with `(M)` across all reports and student portals.
  * Marking more than **15%** of a class manually flags the session **AMBER**; marking more than **30%** flags it **RED**.
  * Any session exceeding **25 manual marks** blocks the teacher until they confirm an administrative warning modal.
  * All flagged sessions are automatically compiled into a daily **HOD Security Digest** delivered to your inbox every evening at 17:00 IST.
  * **Artifact Reference**: [EV-W08-02](file:///c:/Users/bhask/Desktop/att2/docs/EVIDENCE_INDEX.md#EV-W08-02), [test_week8_ladder_and_manual_guardrails.py](file:///c:/Users/bhask/Desktop/att2/backend/tests/test_week8_ladder_and_manual_guardrails.py).

---

## 4. Handover Sign-Off

The system is fully hardened, contract-certified, and self-documenting. Complete handover materials are available in:
* Operations: [OPS_RUNBOOK.md](file:///c:/Users/bhask/Desktop/att2/docs/OPS_RUNBOOK.md)
* Engineering: [MAINTENANCE_GUIDE.md](file:///c:/Users/bhask/Desktop/att2/docs/MAINTENANCE_GUIDE.md)
* Configuration: [CONFIG_REFERENCE.md](file:///c:/Users/bhask/Desktop/att2/docs/CONFIG_REFERENCE.md)
* Audit Trail: [EVIDENCE_INDEX.md](file:///c:/Users/bhask/Desktop/att2/docs/EVIDENCE_INDEX.md)
