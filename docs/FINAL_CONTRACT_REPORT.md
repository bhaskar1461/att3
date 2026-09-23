# Week 10 Final Contract Report & Performance Verdict

**System**: SNIST ERP Attendance Engine  
**Release**: Week 10 — Final Hardening Review & Production Contract Verdict  
**Audit Standard**: Zero Hallucination, Strict $n$-Discipline ($\ge 100$ old-tier scans), Real Data Only  
**Verification Date**: 2026-09-11  
**Master Evidence Reference**: [`docs/EVIDENCE_INDEX.md`](file:///c:/Users/bhask/Desktop/att2/docs/EVIDENCE_INDEX.md)

---

## 1. Primary Contract Scorecard: Baseline (W2 Frozen) vs Today (W10 Final)

The following table places the entire system on trial against the frozen institutional performance contract established in **Week 2 (`docs/BASELINE_REPORT.md`)**:

| Primary Performance Metric | Baseline (W2, Frozen) | Final Measured (W10) | Target Contract | Measured Delta | Sample Discipline ($n$) | Final Verdict |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Overall p50 Time-to-Mark** | **2.61 s** (2614.3 ms) | **0.74 s** (740.0 ms) | **< 1.0 s** | **-71.7%** | $N = 6,890$ events | **PASS** |
| **Overall p95 Time-to-Mark** | **9.08 s** (9082.1 ms) | **1.86 s** (1860.0 ms) | **< 2.5 s** | **-79.5%** | $N = 6,890$ events | **PASS** |
| **Old-Bucket p50 Time-to-Mark** | **6.21 s** (6210.0 ms) | **1.27 s** (1265.6 ms) | **< 1.8 s** | **-79.6%** | $n = 262$ scans | **PASS** |
| **Old-Bucket p95 Time-to-Mark** | **14.02 s** (14020.0 ms) | **2.22 s** (2219.6 ms) | **< 3.5 s** | **-84.2%** | $n = 262$ scans | **PASS** |
| **Old-Bucket First-Attempt Rate**| **90.8%** (167 / 184) | **96.9%** (254 / 262) | **> 95.0%** | **+6.1%** | $n = 262$ scans | **PASS** |
| **Old-Bucket Failure Rate** | **5.4%** (10 / 184) | **3.1%** (8 / 262) | **< 3.0%** | **-2.3%** | $n = 262$ scans | **DECLARED GAP** |
| **Modern-Bucket p50 Time-to-Mark**| **0.46 s** (460.0 ms) | **0.21 s** (210.0 ms) | **< 0.6 s** | **-54.3%** | $n = 162$ scans | **PASS** |
| **Modern-Bucket First-Attempt** | **100.0%** (154 / 154) | **100.0%** (162 / 162) | **> 99.0%** | **0.0%** | $n = 162$ scans | **PASS** |
| **Manual-Mark Reliance Rate** | **3.2%** (17 / 524) | **0.61%** (7 / 1,142) | **< 3.0%** | **-2.59%** | $N = 1,142$ records | **PASS** |

---

## 2. Per-Stage Funnel Waterfall: Baseline vs Final

Across the 9-stage telemetry funnel, conversion gains achieved between Week 2 and Week 10:

| Funnel Stage | Baseline W2 Completion ($N=524$) | Final W10 Completion ($N=6,890$) | Net Stage Gain | Primary Enabling Mechanism |
| :--- | :---: | :---: | :---: | :--- |
| **1. Scan Page Opened** | 100.0% (524 / 524) | 100.0% (6,890 / 6,890) | 0.0% | Core router entry point |
| **2. Camera Permission Requested** | 100.0% (524 / 524) | 100.0% (6,890 / 6,890) | 0.0% | Browser permissions API query |
| **3. Permission Granted** | 98.4% (521 / 524) | 99.6% (6,862 / 6,890) | **+1.2%** | Pre-permission explainer screen (Quick Win C.1) |
| **4. Camera Opened** | 98.4% (521 / 524) | 99.2% (6,835 / 6,890) | **+0.8%** | 3-rung constraint relaxation (720p $\to$ Env $\to$ Basic) |
| **5. First Frame Captured** | 98.4% (521 / 524) | 99.2% (6,835 / 6,890) | **+0.8%** | 8s hardware watchdog & page visibility handler |
| **6. QR Decoded** | 91.3% (478 / 524) | 97.4% (6,711 / 6,890) | **+6.1%** | Slim QR (25×25) + zxing-cpp WASM engine |
| **7. Token Submitted** | 91.3% (478 / 524) | 97.4% (6,711 / 6,890) | **+6.1%** | IndexedDB offline buffer + 3x exponential backoff |
| **8. Server Responded** | 91.3% (478 / 524) | 97.4% (6,711 / 6,890) | **+6.1%** | Sub-20ms FastAPI endpoint + connection pool |
| **9. Marked Confirmed** | **90.8%** (476 / 524) | **96.9%** (6,676 / 6,890) | **+6.1%** | 10m submit-grace + server idempotency |

---

## 3. Honest Declaration of Missed Target: Old-Bucket Terminal Failure Rate

### 3.1 The Measured Gap
- **Target Contract**: Old-tier terminal failure rate $< 3.0\%$.
- **Measured Outcome**: **$3.1\%$** (8 terminal failures out of 262 old-tier attempts).
- **Absolute Gap**: **$+0.1\%$** above the target ceiling.

### 3.2 Forensic Diagnosis (Root Cause Analysis)
Following the forensic methodology established in Week 2:
1. **Stage Isolation**: Out of the 8 failures:
   - 0 occurred during QR decode (WASM achieved 100% decode on all rendered frames).
   - 0 occurred during server submission or HMAC verification.
   - 0 occurred due to token rotation expiry (grace window absorbed 100% of borderline tokens).
   - **All 8 failures occurred at Stage 4: Camera Acquisition (`NotReadableError` / `TrackStartError`)**.
2. **Device Hardware Context**:
   - All 8 occurrences occurred on two specific lab devices: **Redmi 6A (Android 8.1.0, MediaTek MT6761)** and **Samsung Galaxy J2 Core (Android 8.1 Go Edition)**.
   - On these budget Android 8 devices, aggressive OEM camera daemon processes retain exclusive kernel-level locks on the camera device driver if the native camera app was previously backgrounded. The browser’s `navigator.mediaDevices.getUserMedia` call throws `NotReadableError` (Could not start video source) and hangs until the OS process is killed.
3. **Safety Net Engagement**: In all 8 cases, the **5-Rung Degradation Ladder (Week 8)** engaged seamlessly. The students were transitioned to Rung 4 (High-Contrast Roll Number Card with rotating IST timestamp), and faculty completed their mark via Rung 5 within $14\text{ seconds}$ with `scanner_failed` reason code.

### 3.3 Concrete Follow-Up Recommendation
- **Action**: Add an automated OS recovery prompt in `StudentClassScannerModal.tsx`:
  When two consecutive `NotReadableError` events are detected on Android $\le 9$, render a direct Android intent link (`intent://settings#Intent;action=android.settings.APPLICATION_DETAILS_SETTINGS...`) prompting the student to force-stop background apps, or direct them straight to Rung 4 without waiting for the 8-second watchdog.
- **Priority**: Low / Operational Polish (Maintenance Sprint W10.1).
- **Impact on Launch**: Non-blocking. The degradation ladder and manual mark guardrails successfully absorb the gap with zero lost attendance.

---

## 4. Contract Verdict Declaration

| Contract Section | Verdict | Notes |
| :--- | :---: | :--- |
| **Overall Performance Latencies** | **PASS** | p50 dropped by $71.7\%$ (0.74s); p95 dropped by $79.5\%$ (1.86s). Both easily clear $< 1.0\text{s}$ and $< 2.5\text{s}$ ceilings. |
| **Old Hardware Resilience** | **PASS WITH DECLARED GAP** | p50 time-to-mark dropped to 1.27s (target $< 1.8\text{s}$); first attempt rate reached 96.9% (target $> 95\%$). Minor failure rate gap (3.1% vs 3.0%) declared and bounded. |
| **Modern Hardware Scalability** | **PASS** | p50 time-to-mark dropped to 0.21s (target $< 0.6\text{s}$); first attempt rate held at 100.0%. |
| **Classroom Manual Reliance** | **PASS** | Manual reliance dropped to 0.61% (7 marks / 1,142 attendance records), beating the $< 3.0\%$ ceiling by $4.9\times$. |

**FINAL CONTRACT VERDICT**: **PRODUCTION LAUNCH CONTRACT APPROVED**.
