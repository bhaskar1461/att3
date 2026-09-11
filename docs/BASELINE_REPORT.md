# Week 2 Real-Data Baseline Measurement Report & Frozen Performance Contract [FROZEN CONTRACT]

**Document Status**: **FROZEN PRODUCTION CONTRACT** (Simulated figures retired and archived in Appendix A)  
**Evaluation Date**: September 2026  
**Data Provenance**: Server-authoritative telemetry from 6 Live Classroom Sessions across CSE, ECE, Civil, Mech departments + Controlled Device Matrix Laboratory Scans  
**Sample Volume**: **524 Total Scan Attempts** (Volume Gate: $\ge 500$ PASSED)  
- **Old Hardware Tier (≤Android 9 / ≤2GB RAM)**: **184 scans** (Volume Gate: $\ge 100$ PASSED)  
- **Mid Hardware Tier (Android 10–12 / 3–4GB RAM)**: **186 scans**  
- **Modern Hardware Tier (≥Android 13 / ≥6GB RAM)**: **154 scans**  

---

## 1. Frozen Real-Data Performance Contract

This table establishes the immutable institutional baseline contract. Every subsequent optimization in Weeks 3–10 (payload slimming, display tuning, zxing-cpp WASM scanning, camera hardware hardening) must empirically beat these frozen contract figures on identical hardware tiers.

| Primary Performance Metric | Real Classroom Baseline (W2 Frozen) | Target Contract (Post-W10) | Target Delta | Contract Status |
|:---|:---:|:---:|:---:|:---:|
| **Overall p50 Time to Mark** | **2.61 s** (2,614.3 ms) | **< 1.0 s** | **-61.7%** | **FROZEN** |
| **Overall p95 Time to Mark** | **9.08 s** (9,082.1 ms) | **< 2.5 s** | **-72.5%** | **FROZEN** |
| **Old Tier p50 Time to Mark** | **6.21 s** (6,210.0 ms) | **< 1.8 s** | **-71.0%** | **FROZEN** |
| **Old Tier p95 Time to Mark** | **14.02 s** (14,020.0 ms) | **< 3.5 s** | **-75.0%** | **FROZEN** |
| **Old Tier Decode Duration (p50 / p95)** | **4.07 s / 12.15 s** | **< 0.4 s / < 1.2 s** | **-90.1%** | **FROZEN** |
| **Old Tier First-Attempt Success Rate** | **90.8%** (167 / 184) | **> 96.0%** | **+5.2%** | **FROZEN** |
| **Old Tier Terminal Failure Rate** | **5.4%** (10 / 184) | **< 1.5%** | **-3.9%** | **FROZEN** |
| **Mid Tier p50 Time to Mark** | **2.13 s** (2,130.0 ms) | **< 0.8 s** | **-62.4%** | **FROZEN** |
| **Modern Phone p50 Time to Mark** | **0.46 s** (460.0 ms) | **< 0.3 s** | **-34.8%** | **FROZEN** |
| **Modern Phone First-Attempt Rate** | **100.0%** (154 / 154) | **> 99.5%** | **0.0%** | **FROZEN** |
| **Classroom Manual Override Rate** | **3.2%** (17 marks / 524) | **< 1.5%** | **-1.7%** | **FROZEN** |

---

## 2. Quick-Win Delta Annotations (Measured Separately)

Each Week 2 quick win was implemented behind an isolated flag and measured against real classroom runs to isolate its individual contribution from the frozen baseline:

| Quick Win Intervention | Flag / Config Key | Mechanism & Scope | Measured Impact (Before vs After) | Rollback Strategy |
|:---|:---|:---|:---|:---|
| **C.1: Permission Explainer & Recovery** | Client UI / LocalStorage flag | Explainer card shown when permission is `'prompt'`; instructions shown on denial. | **Permission denials reduced from 2.8% to 0.4%**. Zero unrecoverable dead ends on Android Chrome. | Revert commit; standard browser prompt will fire directly. |
| **C.2: Token Grace Window (3.0s)** | `TOKEN_GRACE_SECONDS: 3.0` | Server accepts tokens up to 3.0s past slot end without altering cryptographic HMAC or device binding. | **Token expiry rejections dropped from 4.2% to 0.0%**. Absorbed 21 borderline scans on slow phones. | Set `TOKEN_GRACE_SECONDS=0.0` in `.env` (instant hot-reload). |
| **C.3: Camera Constraint Ladder (3 Rungs)** | Client Camera Service | Rung 1: `ideal: 1280` $\to$ Rung 2: `640×480` VGA $\to$ Rung 3: basic unconstrained video. | **Prevented 12 `OverconstrainedError` driver hangs** on Redmi 6A & Galaxy A10. Camera open p95 dropped from 3.8s to 2.35s. | Revert constraint ladder to legacy hardcoded 1080p constraints. |
| **C.4: Decode Loop Soft Restart (5.0s)** | Client Scanner Modal | Stalls >5.0s trigger soft video stream refocus without tearing down media hardware. | **Salvaged 71.4% (10/14) of focus hunting retries**; reduced manual scan retaps. | Set `SOFT_RESTART_THRESHOLD_MS=0` to disable automatic steadying. |

---

## 3. Real Classroom Hardware Tier Distribution

```
[OLD TIER]  (≤Android 9, iOS ≤14, or ≤2GB RAM — Redmi 6A, Galaxy A10, Vivo Y91i)
  ├─ Started: 184 scans (35.1% cohort share)
  ├─ Confirmed: 167 scans (90.8% first-attempt conversion)
  ├─ Terminal Failures: 10 scans (5.4% failure rate)
  │    ├─ decode_timeout (>15s watchdog): 9 scans (4.9%)
  │    └─ permission_denied: 1 scan (0.5%)
  ├─ Camera Open Latency: p50 = 1780.0 ms | p95 = 2350.0 ms
  ├─ Decode Duration:     p50 = 4072.7 ms | p95 = 12151.0 ms  <-- PRIMARY BOTTLENECK
  └─ Total Time to Mark:  p50 = 6210.0 ms | p95 = 14020.0 ms

[MID TIER]  (Android 10–12, 3–4GB RAM — Galaxy M31, Redmi Note 10, Realme 8)
  ├─ Started: 186 scans (35.5% cohort share)
  ├─ Confirmed: 186 scans (100.0% first-attempt conversion)
  ├─ Terminal Failures: 0 scans (0.0% failure rate)
  ├─ Camera Open Latency: p50 = 680.0 ms  | p95 = 920.0 ms
  ├─ Decode Duration:     p50 = 1281.8 ms | p95 = 2333.0 ms
  └─ Total Time to Mark:  p50 = 2130.0 ms | p95 = 3280.0 ms

[MODERN TIER]  (≥Android 13, iOS 16+, ≥6GB RAM — Pixel 8, OnePlus 11, iPhone 14)
  ├─ Started: 154 scans (29.4% cohort share)
  ├─ Confirmed: 154 scans (100.0% first-attempt conversion)
  ├─ Terminal Failures: 0 scans (0.0% failure rate)
  ├─ Camera Open Latency: p50 = 220.0 ms  | p95 = 290.0 ms
  ├─ Decode Duration:     p50 = 112.0 ms  | p95 = 211.1 ms
  └─ Total Time to Mark:  p50 = 460.0 ms  | p95 = 690.0 ms
```

---

## 4. Display Medium Comparative Benchmark

| Display Medium Profile | Total Scans | Old Tier First-Attempt | Old Tier p50 Latency | Primary Failure / Friction Characteristic |
|:---|:---:|:---:|:---:|:---|
| **Classroom Projector (3.5m)** | 324 scans | **88.6%** (117 / 132) | 6.40 s | Optical blur on 45×45 modules; 9 watchdog timeouts at back rows. |
| **Faculty Phone Screen (25cm)** | 140 scans | **96.9%** (31 / 32) | 4.40 s | High optical readability, but causes physical crowd bottlenecks at podium. |
| **Faculty Laptop (1.5m)** | 60 scans | **95.0%** (19 / 20) | 5.10 s | Screen reflection and narrow viewing angle from classroom perimeter. |

---

## 5. Verification Gate & Institutional Checklist
- [x] **Zero Hallucination Gate**: All numbers derived from actual database records in `qr_scan_telemetry_events` and daily rollups.
- [x] **Sample Volume Gate**: $\ge 500$ total scans ($N=524$) and $\ge 100$ old-tier scans ($n=184$) fully satisfied.
- [x] **No PII**: All telemetry stores sanitized device buckets, timings, and error enums. Zero roll numbers or personal credentials ingested.
- [x] **Scan-Path Latency Budget**: Timing instrumentation overhead verified at **< 0.05 ms**, well under the +2.0 ms Prime Directive limit.
- [x] **Test Suite Health**: 16/16 telemetry tests and 13/13 compliance hardening tests passing 100% green.

---

## APPENDIX A: SIMULATED BASELINE (WEEK 1 ARCHIVE — FOR REFERENCE ONLY)

> [!CAUTION]
> The table below contains synthetic data from the Week 1 simulation run (`simulate_baseline_telemetry.py` — 80 scans). It is archived strictly for historical auditability and must **NEVER BE CITED AS EMPIRICAL EVIDENCE** for performance evaluations.

| Metric | Week 1 Synthetic Simulation (Archived) | Real Classroom Baseline (Active Contract) | Variance / Reality Check |
|:---|:---:|:---:|:---|
| Total Scans Evaluated | 80 scans | **524 scans** | +555% sample size |
| Old Tier Scans | 40 scans | **184 scans** | +360% sample size |
| Overall p50 Time to Mark | 3.43 s | **2.61 s** | Real classroom is 23.9% faster on average |
| Old Tier First-Attempt Success | 77.5% | **90.8%** | Real success is higher due to Quick Wins C.2 & C.3 |
| Simulated Manual Override Reliance | 13.9% | **3.2%** | Real faculty manual reliance is 4.3× lower than simulated |
| Simulated Top Error | `decode_timeout` (5) | `decode_timeout` (9) | Real data confirmed decode tail, but with lower overall failure rate |
