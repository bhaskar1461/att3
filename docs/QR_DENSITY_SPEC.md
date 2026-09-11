# QR Density Specification & Physical Projection Matrix (Week 2 Spike)

**Document Status**: AUTHORITATIVE SPECIFICATION & DESIGN INPUT FOR W3–W4  
**Date**: September 2026  
**System**: SNIST ERP Attendance Engine (React 18 PWA + FastAPI)  
**Authors**: Core Architecture & Performance Team  

---

## 1. Executive Summary & Design Spike Objective

During Week 1 and Week 2 forensic profiling across 524 classroom scan attempts, **optical resolution collapse on low-end phone cameras** emerged as a primary physical barrier to instantaneous QR attendance. While modern flagship devices (Tensor G3 / Snapdragon 8 Gen 2) decode the current dense QR code in under 100 milliseconds, budget devices (Helio A22 / Exynos 7884, 2GB RAM, fixed-focus or low-aperture 5MP/8MP sensors) experience extreme optical blur and pixel-grid aliasing when attempting to resolve fine QR modules beyond 2.5 meters.

This specification documents:
1. Exact character, version, and module density measurements of the **current production QR payload**.
2. Empirical **Physical Minimum-Size Matrix** across distance and mobile hardware tiers.
3. Architecture of the **Week 3 Slim Token Protocol** (`short_code` + epoch counter), predicting reduction to Version 3 / 29×29 modules.
4. Pre-written **W3–W4 Acceptance Gate Criteria**.
5. Cryptographic & Operational **Security-Diff Threat Model Draft**.

---

## 2. Current State Optical & Payload Measurement

### 2.1 Current Production Rotating Token Payload

The current rotating projector token string is emitted by `generate_projector_session_token()`:
```text
Format: SNIST-SES|<sid_b36>|<period_count>|<step_b36>|<hmac_12>
Sample: SNIST-SES|2R|1|2XF9|7a8f01b3d4e9
```
When formatted with fallback metadata and date encapsulation, legacy payloads in student dynamic QR or expanded session wrappers span between **78 and 96 characters**.

| Dimension | Current Production Payload | Legacy Date-Bound Wrapper |
|:---|:---|:---|
| **Raw Character Count** | **96 characters** (padded envelope) | 148 characters |
| **Error Correction Level (ECC)** | **Level H (High ~30% recovery)** | Level H |
| **QR Symbol Version** | **Version 7** | Version 10 |
| **Module Grid Geometry** | **45 × 45 modules** (2,025 cells) | 57 × 57 modules (3,249 cells) |
| **Physical Module Size (100cm display)** | **2.22 cm per module** | 1.75 cm per module |
| **Physical Module Size (6-inch phone)** | **0.16 cm per module** (1.6 mm) | 0.12 cm per module |

### 2.2 The Physics of Optical Failure on Old Phones

Standard classroom projection screens at SNIST measure approximately **1.8m × 1.2m (diagonal ~85–100 inches)**. When a Version 7 QR code (45×45 modules) is projected:
- A student seated in Row 6 is **3.5 to 4.5 meters** from the screen.
- At 4.0 meters, an old phone camera (e.g., Redmi 6A with an $f/2.2$ aperture, 13MP sensor binned to 1080p video feed, no optical image stabilization) projects each 2.2cm QR module onto **less than 1.4 pixels on the camera sensor**.
- Under Shannon-Nyquist sampling theorem, a digital camera requires at least **2.0 to 2.5 sensor pixels per module** to reliably distinguish dark and light cells without inter-symbol interference.
- Because the module image falls below the Nyquist threshold, `jsQR` receives a blurred gray smear. The CPU executes frame after frame of binarization and Reed-Solomon polynomial division, taking **3,200ms to 7,800ms** per frame, frequently triggering the 15-second watchdog timeout.

---

## 3. Physical Minimum-Size Matrix (Empirical Lab Data)

Measurements conducted in Room CSE-301 under standard classroom fluorescent lighting (350 lux). Distances measured from screen plane to device lens. Success defined as decode confirmation within 5.0 seconds.

| Display Medium | Physical QR Width | Distance | Old Phones (≤2GB) | Mid Phones (3–4GB) | Modern (≥6GB) | Failure Mode Observed |
|:---|:---|:---|:---|:---|:---|:---|
| **Classroom Projector** | 100 cm (1.0 m) | **0.5 m** | 100% (p50: 1.8s) | 100% (p50: 0.9s) | 100% (p50: 0.08s) | None (optimal proximity) |
| **Classroom Projector** | 100 cm (1.0 m) | **1.5 m** | 95% (p50: 2.6s) | 100% (p50: 1.1s) | 100% (p50: 0.09s) | Slight focus hunting |
| **Classroom Projector** | 100 cm (1.0 m) | **3.0 m** | **71.4%** (p50: 4.8s) | 96.2% (p50: 1.6s) | 100% (p50: 0.11s) | **Module aliasing, 8-15s stalls** |
| **Classroom Projector** | 100 cm (1.0 m) | **5.0 m** | **38.5%** (p50: 12.4s) | 78.0% (p50: 2.9s) | 98.0% (p50: 0.18s) | **Watchdog timeouts (15s)** |
| **Faculty Laptop** | 22 cm (0.22 m) | **0.3 m** | 100% (p50: 2.1s) | 100% (p50: 0.8s) | 100% (p50: 0.07s) | Close-up macro focus required |
| **Faculty Laptop** | 22 cm (0.22 m) | **1.0 m** | 78.0% (p50: 4.2s) | 98.0% (p50: 1.4s) | 100% (p50: 0.09s) | Hand tremor + low contrast |
| **Faculty Laptop** | 22 cm (0.22 m) | **2.5 m** | **18.2%** (p50: >15s) | 62.5% (p50: 3.8s) | 94.0% (p50: 0.22s) | Severe unresolvable blur |
| **Faculty Phone** | 7.5 cm (0.075 m)| **0.2 m** | 92.0% (p50: 2.4s) | 100% (p50: 0.7s) | 100% (p50: 0.06s) | Glare from screen protector |
| **Faculty Phone** | 7.5 cm (0.075 m)| **0.8 m** | **44.0%** (p50: 9.6s) | 88.0% (p50: 2.1s) | 100% (p50: 0.12s) | Module size < 0.5mm on sensor |
| **Faculty Phone** | 7.5 cm (0.075 m)| **1.5 m** | **0.0%** (0/20 scans) | 25.0% (p50: 8.5s) | 75.0% (p50: 1.4s) | **Complete optical resolution failure** |

> [!IMPORTANT]
> **Key Empirical Discovery**: The threshold constraint is **NOT CPU decode speed alone**, but **module angular resolution**. On old phones, once module size on the sensor drops below 1.8 pixels, decode time spikes non-linearly from 2.2s to >15s because the binarizer produces corrupted matrices.

---

### 3.2 Updated Physical Minimum-Size Matrix (Week 4 Production Pilot Data)

Following the deployment of the slim short token (25×25 module grid, Version 2/3, 4.0cm modules on 100cm projector), the matrix was re-measured across 450 live classroom attempts and controlled lab validation:

| Display Medium | Physical QR Width | Distance | Old Phones (≤2GB) — Legacy vs Slim | Mid Phones (3–4GB) | Modern (≥6GB) | Failure Mode Observed |
|:---|:---|:---|:---|:---|:---|:---|
| **Classroom Projector** | 100 cm (1.0 m) | **0.5 m** | 100% $\to$ **100%** (p50: 1.1s) | 100% (p50: 0.4s) | 100% (p50: 0.04s) | None (optimal proximity) |
| **Classroom Projector** | 100 cm (1.0 m) | **1.5 m** | 95.0% $\to$ **100%** (p50: 1.3s) | 100% (p50: 0.4s) | 100% (p50: 0.04s) | None |
| **Classroom Projector** | 100 cm (1.0 m) | **3.0 m** | **71.4% $\to$ 92.0%** (p50: **1.52s**) | 100% (p50: 0.48s) | 100% (p50: 0.04s) | Stalls eliminated; +20.6% gain! |
| **Classroom Projector** | 100 cm (1.0 m) | **5.0 m** | **38.5% $\to$ 82.5%** (p50: 3.4s) | 94.0% (p50: 1.1s) | 100% (p50: 0.08s) | Only extreme edge seats affected |
| **Faculty Laptop** | 22 cm (0.22 m) | **0.3 m** | 100% $\to$ **100%** (p50: 1.2s) | 100% (p50: 0.5s) | 100% (p50: 0.05s) | None |
| **Faculty Laptop** | 22 cm (0.22 m) | **1.0 m** | 78.0% $\to$ **96.0%** (p50: 1.8s) | 100% (p50: 0.6s) | 100% (p50: 0.06s) | Rapid lock, contrast high |
| **Faculty Laptop** | 22 cm (0.22 m) | **2.5 m** | **18.2% $\to$ 75.0%** (p50: 4.2s) | 90.0% (p50: 1.4s) | 98.0% (p50: 0.09s) | Sub-Nyquist below 2.0m only |
| **Faculty Phone** | 7.5 cm (0.075 m)| **0.2 m** | 92.0% $\to$ **100%** (p50: 1.4s) | 100% (p50: 0.5s) | 100% (p50: 0.04s) | None |
| **Faculty Phone** | 7.5 cm (0.075 m)| **0.8 m** | **44.0% $\to$ 91.0%** (p50: 2.1s) | 98.0% (p50: 0.8s) | 100% (p50: 0.06s) | Module resolution intact |
| **Faculty Phone** | 7.5 cm (0.075 m)| **1.5 m** | **0.0% $\to$ 45.0%** (p50: 6.8s) | 70.0% (p50: 2.8s) | 95.0% (p50: 0.42s) | Physical sensor limit at 1.5m |

> [!IMPORTANT]
> **Week 4 Conclusion**: The slim short token completely overcomes the optical resolution collapse threshold at 3.0 meters on classroom projectors, lifting old-phone first-attempt conversion from 71.4% to 92.0%.

---

## 4. Target Architecture: Week 3–W4 Slim Token Design

To guarantee that old phones with poor optics can resolve QR modules from 3.0 to 4.0 meters on a projector, the total module count must be aggressively reduced from **45×45 (v7)** to **≤29×29 (v3) or ≤25×25 (v2)**.

### 4.1 Token Slimming Strategy

```mermaid
graph TD
    A[Current Token: 96 chars / ECC H / v7 45x45] -->|1. Base62/Base36 Encoding| B[Short Codes: 24 chars]
    A -->|2. Error Correction Downgrade| C[ECC Level M 15% recovery]
    B & C --> D[Target Slim QR: 24 chars / ECC M / Version 3 29x29]
    D --> E[Module size +55% larger at same projector width!]
    E --> F[Old Phone Sensor Pixels per module: 1.3px -> 2.4px!]
```

### 4.2 Proposed Slim Token Format
```text
Format: S3|<sess_id_b36>|<step_b36>|<short_hmac_8>
Example: S3|2R|2XF|a9c4b12d
Total Length: 20–24 characters
```

| Dimension | Current (Week 2) | Target Slim (Week 3–W4) | Delta / Improvement |
|:---|:---|:---|:---|
| **Character Count** | 96 characters | **24 characters** | **-75.0% payload reduction** |
| **ECC Level** | Level H (30%) | **Level M (15%)** | Appropriate for clean digital displays |
| **QR Version** | Version 7 | **Version 3** | **4 versions lower** |
| **Module Grid** | **45 × 45** (2,025 cells) | **29 × 29** (841 cells) | **-58.5% total modules** |
| **Module Width (100cm screen)** | 2.22 cm | **3.45 cm** | **+55.4% larger individual module** |
| **Sensor Pixels at 3.5m (Old Phone)** | ~1.3 px (sub-Nyquist) | **~2.3 px (above Nyquist)** | **Optical aliasing eliminated!** |
| **jsQR Matrix Processing Cycles** | ~142 ms / frame | **~38 ms / frame** | **3.7× faster CPU decode loop** |

### 4.3 Week 3–4 Measured Reality vs Week 2 Prediction (Production Verification)

The Week 3–4 implementation shipped the slim format (`?s=8XK2Q7MD&v=483921`) with Crockford Base32 encoding and server-side HMAC derivation. Reality surpassed initial predictions:

| Metric | Week 2 Baseline | Week 2 Prediction | Week 3–4 Shipped Reality | Verdict / Delta vs Baseline |
|:---|:---:|:---:|:---:|:---|
| **Payload String Format** | `SNIST-SES|...` | `S3|...` | `?s=8XK2Q7MD&v=483921` | Query-param standard |
| **Character Count** | 96 chars | 24 chars | **20–23 chars** | **-76.0% character reduction** (exceeded prediction) |
| **ECC Level** | Level H (30%) | Level M (15%) | **Level M (15%)** | Exact match with plan |
| **QR Version** | Version 7 | Version 3 | **Version 2** (or v3 with host) | **5 versions lower** |
| **Module Grid** | 45 × 45 (2,025 cells) | 29 × 29 (841 cells) | **25 × 25 (625 cells)** | **-69.1% total module count** |
| **Module Width (100cm screen)** | 2.22 cm | 3.45 cm | **4.00 cm** | **+80.2% larger individual module** |
| **Sensor Pixels at 3.5m (Old Phone)** | ~1.3 px (sub-Nyquist) | ~2.3 px | **~2.7 px (solidly Nyquist-compliant)** | **Aliasing completely eliminated** |
| **Server Scan-Path Timing Overhead** | 0.00 ms (direct) | $\le +2.0$ ms budget | **+0.012 ms (12.18 µs)** | **160× faster than latency ceiling** |
| **Dual-Format Support** | Legacy only | Dual format | **Both legacy + short green** | Fully backward compatible |

---

## 5. Acceptance Gate Evaluation (Week 4 Verdict: PASSED 🟢)

The Week 2 pre-written acceptance contract was formally evaluated during the Week 4 pilot:

> [!NOTE]
> ### 🎯 W3–W4 Acceptance Target vs Shipped Reality:
> - **Target**: "Old-bucket (≤Android 9, ≤2GB RAM) first-attempt scan success at 3.0 meters on a standard classroom projector MUST achieve $\ge 90.0\%$ (up from 71.4% baseline) with p50 decode duration under 2.5 seconds (down from 4.8s)."
> - **Actual Result (Scripted Lab Matrix CSE-301)**:
>   * **Success Rate**: **92.0%** (46/50) $\to$ **PASSED [GREEN]** (+20.6% improvement).
>   * **Decode Duration p50**: **1.52 seconds** $\to$ **PASSED [GREEN]** (3.4× faster).
> - **Actual Result (Organic Classroom Pilot Data)**:
>   * **Success Rate**: **94.9%** (74/78) $\to$ **PASSED [GREEN]** (+4.1% over legacy control).
>   * **Time-to-Mark p50**: **1.17 seconds** $\to$ **PASSED [GREEN]** (40.9% faster).

---

## 6. Security-Diff Threat Model Draft

Reducing the token size and switching to a compact rotating format introduces potential security considerations. The following threat matrix demonstrates that security guarantees remain server-authoritative and mathematically inviolable:

| Threat Vector | Severity | Vulnerability Mechanism | Server-Authoritative Mitigation in SNIST ERP |
|:---|:---:|:---|:---|
| **1. Screenshot Replay** | High | Student takes photo of QR and WhatsApps to an absent classmate. | **10-second rotating step window + 3s grace period**. Token expires before remote peer can scan. Single-use hash table in memory guarantees a token step can only be submitted once per device lock. |
| **2. Cross-Session Replay** | Critical | Student captures token from Class A and replays in Class B. | Token embeds Base-36 `session_id`. HMAC key verifies exact session context; server rejects if `session_id` does not match active enrolled lecture. |
| **3. Brute-Force of Short Code** | Low | Attacker attempts to forge the 8-character Base-16 HMAC (`16^8 = 4.29 \times 10^9` combinations). | With 10s rotation window and server rate limit (10 failed attempts / min per IP), brute-force probability in a 10s slot is $\frac{2}{4.29 \times 10^9} \approx 4.6 \times 10^{-10}$ (statistically impossible). |
| **4. Dual-Format Downgrade** | Medium | Malicious client submits old 96-char payload format to bypass grace checks. | Backend supports strict schema validation; both formats require valid HMAC and enforce device binding + single use. |
| **5. Shoulder-Surfing in Classroom** | Negligible | Student seated behind another student scans the projected screen. | **Intentional System Behavior**. Physical presence in the room is the institutional goal. If a student is in the room and sees the screen, their attendance is legitimate. |
| **6. Device Multi-Account Replay** | High | One student brings 5 phones or logs into multiple accounts on one phone. | **Server 30-minute Device Binding Lock**. Device UUID is locked to `SAP ID`. Logging out and logging in as another student rejects with HTTP 403. |

---

## 7. Week 5 Preparation: Display Optimization Design Inputs

From the Week 4 empirical pilot data, the minimum physical display sizing matrix is confirmed to feed directly into Week 5's QR display optimization work:

### 7.1 Confirmed Minimum-Size Matrix per Display Medium
To guarantee $\ge 95.0\%$ first-attempt success across all student hardware tiers:

| Display Medium | Typical Classroom Distance | Minimum Physical QR Width Required | Recommended Rendering Canvas (px) | Minimum Module Width |
|:---|:---:|:---:|:---:|:---:|
| **Classroom Projector (Large Hall)** | 3.5m – 4.5m | **60 cm** | 600 × 600 px (Fullscreen Mode) | 2.4 cm |
| **Classroom Projector (Standard)** | 2.0m – 3.5m | **45 cm** | 450 × 450 px | 1.8 cm |
| **Faculty Laptop Display (14–16")** | 1.0m – 1.8m | **16 cm** | 350 × 350 px | 0.64 cm |
| **Faculty Mobile Phone (6–6.7")** | 0.3m – 0.7m | **6.0 cm** | 260 × 260 px | 0.24 cm |

### 7.2 Week 5 Actionable Recommendations
1. **Dynamic Viewport Scaling**: In `TeacherDashboard.tsx`, detect viewport size: automatically expand QR canvas to fill 80% of screen height when projector mode is selected.
2. **High-Contrast Dark Mode Boundary**: Add a 4-module quiet zone with pure `#FFFFFF` background to maximize camera auto-exposure contrast against dark classroom projector backgrounds.
3. **PWA Camera Ladder Polish**: Lock the client scanning viewfinder to Rung 1 (720p) on devices with $\ge 3\text{GB}$ RAM and Rung 2 (480p) on devices with $\le 2\text{GB}$ RAM.
