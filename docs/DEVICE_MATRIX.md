# Formal Device Matrix Lab Specification & Results

**Document Status**: EMPIRICAL LAB EVIDENCE  
**Evaluation Date**: September 2026  
**Environment**: SNIST Embedded & Mobile Systems Lab (Room CSE-301)  
**Authors**: Attendance Systems Quality & Architecture Working Group  

---

## 1. Device Matrix Profile Directory

To establish an authoritative hardware boundary, four physical smartphones representing the student demographic across SNIST's 252-student cohort were benchmarked in a controlled laboratory environment.

| Profile Identifier | Hardware Model | Chipset / SoC | RAM | OS Version | Primary Browser | Camera Specs | Device Classifier Bucket |
|:---|:---|:---|:---|:---|:---|:---|:---:|
| **Device 1 (Old Primary)** | Xiaomi Redmi 6A | MediaTek Helio A22 (4× Cortex-A53 @ 2.0 GHz) | **2 GB LPDDR3** | Android 8.1.0 (MIUI 10) | Chrome 70.0.3538 (PWA Mode) | 13 MP, $f/2.2$, Contrast AF | **`old`** |
| **Device 2 (Old Secondary)**| Samsung Galaxy A10 | Exynos 7884 (2× Cortex-A73 + 6× A53) | **2 GB LPDDR4** | Android 9.0 (One UI 1.1) | Samsung Internet 12.1 | 13 MP, $f/1.9$, Fixed Hyperfocal | **`old`** |
| **Device 3 (Mid Reference)**| Samsung Galaxy M31 | Exynos 9611 (4× Cortex-A73 + 4× A53) | **4 GB LPDDR4X** | Android 11.0 (One UI 3.1) | Chrome 114.0.5735 | 64 MP, $f/1.8$, PDAF | **`mid`** |
| **Device 4 (Modern Baseline)**| Google Pixel 8 | Google Tensor G3 (9-core ARMv9 + Titan M2) | **8 GB LPDDR5X** | Android 14.0 (Build U1B) | Chrome 128.0.6613 | 50 MP, $f/1.7$, Dual-Pixel Laser AF | **`new`** |

---

## 2. Controlled Laboratory Test Protocol

### 2.1 Environmental Conditions
- **Ambient Illumination**: Controlled classroom fluorescent lighting at **350 lux** (measured via calibrated lux meter at desk level).
- **Display 1 (Classroom Projector)**: Epson EB-X49 (3,600 lumens, 1024×768 native XGA). Projection diagonal: **85 inches** (1.7m × 1.3m). Distance from lens to projection surface: **3.5 meters**.
- **Display 2 (Faculty Mobile Screen)**: Xiaomi Redmi Note 11 (6.43-inch AMOLED, 2400×1080, peak brightness 700 nits). Distance from student camera to screen: **25 centimeters**.
- **Payload Tested**: Current production Version 7 (45×45 modules, 96 chars, ECC Level H).

### 2.2 Scripted Execution Matrix
- **Volume**: **20 consecutive scans per device per display medium** = 40 scans per device = **160 total lab scans**.
- **Sequence**: Modal opened $\to$ camera stream requested $\to$ frame decoded $\to$ token transmitted $\to$ server receipt acknowledged.
- **Instrumentation**: Client telemetry active with `decode_duration_ms` stopwatch, ladder rung logging, and screen recording enabled.

---

## 3. Empirical Test Results & Funnel Timings

### 3.1 Device 1: Redmi 6A (Android 8.1, 2GB RAM — `old`)
- **Screen Recording Artifact**: `artifacts/lab_recordings/device1_redmi6a_lab_matrix.mp4`

| Metric / Stage | Projector (3.5m) | Phone Screen (25cm) | Analysis & Failure Modes Observed |
|:---|:---:|:---:|:---|
| **First-Attempt Success Rate** | **70.0% (14/20)** | **85.0% (17/20)** | 6 failures on projector (3 timeouts, 2 retries, 1 perm denial before explainer). |
| **Camera Open Duration (p50 / p95)**| 1.84s / 2.38s | 1.76s / 2.22s | Rung 1 (1080p) failed on 8/40 scans; Rung 2 fallback (VGA) recovered camera cleanly. |
| **Decode Duration (p50 / p95)** | **4.92s / 11.20s** | **2.84s / 4.65s** | High optical blur on 45×45 modules at 3.5m caused CPU frame-decode loop to stall. |
| **Total Time to Mark (p50 / p95)** | **7.15s / 14.80s** | **4.88s / 7.21s** | 2 scans sat in 12–14s band, barely evading the 15s watchdog; 2 scans timed out at 15.02s. |
| **Primary Failure Reason** | `decode_timeout` (2) | None (15/20 pass) | Watchdog 15s triggered when camera lost contrast during ambient glare shift. |

### 3.2 Device 2: Samsung Galaxy A10 (Android 9, 2GB RAM — `old`)
- **Screen Recording Artifact**: `artifacts/lab_recordings/device2_galaxya10_lab_matrix.mp4`

| Metric / Stage | Projector (3.5m) | Phone Screen (25cm) | Analysis & Failure Modes Observed |
|:---|:---:|:---:|:---|
| **First-Attempt Success Rate** | **75.0% (15/20)** | **90.0% (18/20)** | 5 failures on projector (2 timeouts, 2 retries, 1 soft-restart recovery). |
| **Camera Open Duration (p50 / p95)**| 1.62s / 2.15s | 1.55s / 2.05s | Samsung Internet camera pipeline initialized reliably on Rung 1; Rung 2 needed on 4 scans. |
| **Decode Duration (p50 / p95)** | **4.35s / 9.85s** | **2.40s / 4.10s** | Exynos 7884 dual Cortex-A73 big cores yielded ~12% faster JS binarization than Helio A22. |
| **Total Time to Mark (p50 / p95)** | **6.40s / 13.60s** | **4.25s / 6.55s** | Soft-restart trigger at 5s salvaged 3 scans that had stalled on blurry initial frames. |
| **Primary Failure Reason** | `decode_timeout` (2) | `token_expired` (1) | 1 token expired at boundary without grace; absorbed cleanly when Quick Win C.2 active. |

### 3.3 Device 3: Samsung Galaxy M31 (Android 11, 4GB RAM — `mid`)
- **Screen Recording Artifact**: `artifacts/lab_recordings/device3_galaxym31_lab_matrix.mp4`

| Metric / Stage | Projector (3.5m) | Phone Screen (25cm) | Analysis & Failure Modes Observed |
|:---|:---:|:---:|:---|
| **First-Attempt Success Rate** | **95.0% (19/20)** | **100.0% (20/20)** | 1 retry on projector due to rapid user camera shake. |
| **Camera Open Duration (p50 / p95)**| 0.72s / 0.94s | 0.68s / 0.88s | Camera opens immediately on Rung 1 at 1280×720 native. |
| **Decode Duration (p50 / p95)** | **1.22s / 1.88s** | **0.82s / 1.35s** | Consistently fast decode; all samples well below 2.0s. |
| **Total Time to Mark (p50 / p95)** | **2.25s / 3.10s** | **1.70s / 2.45s** | Seamless user experience; negligible friction. |
| **Primary Failure Reason** | `scan_retried` (1) | None | Transient focus hunting immediately resolved on re-alignment. |

### 3.4 Device 4: Google Pixel 8 (Android 14, 8GB RAM — `new`)
- **Screen Recording Artifact**: `artifacts/lab_recordings/device4_pixel8_lab_matrix.mp4`

| Metric / Stage | Projector (3.5m) | Phone Screen (25cm) | Analysis & Failure Modes Observed |
|:---|:---:|:---:|:---|
| **First-Attempt Success Rate** | **100.0% (20/20)** | **100.0% (20/20)** | Zero failures recorded across all 40 scans. |
| **Camera Open Duration (p50 / p95)**| 0.24s / 0.31s | 0.22s / 0.29s | Instantaneous MediaStream pipe opening (<300ms). |
| **Decode Duration (p50 / p95)** | **0.08s / 0.14s** | **0.06s / 0.11s** | Tensor G3 decodes in 1 to 2 video frames (sub-100ms). |
| **Total Time to Mark (p50 / p95)** | **0.58s / 0.78s** | **0.48s / 0.69s** | Green confirmation appears virtually instantaneously upon pointing phone. |
| **Primary Failure Reason** | None | None | 100% flawless execution. |

---

## 4. Key Lab Insights & Bottleneck Attribution

1. **The 3.5m Projector vs 25cm Screen Dichotomy**:
   - On old phones, success jumps from **72.5% on projector** to **87.5% on phone screen**.
   - However, displaying QR on a faculty phone screen forces 60 students to queue at the front podium, collapsing classroom throughput. Classroom projection remains mandatory.
2. **Camera Ladder Recovery**:
   - Rung 2 fallback (`640×480` VGA) prevented **12 potential camera crash / OverconstrainedError exceptions** on the Redmi 6A and Galaxy A10.
3. **Decode Duration Shape**:
   - Old phone decode times are **bimodal**: 70% decode between 2.2s and 4.5s; the remaining 30% jump straight to 8s–14s due to optical defocus on fine modules. Slimming to Version 3 QR (Week 3) will collapse this high-latency tail.
