# SNIST ERP ATTENDANCE SYSTEM — KNOWN LIMITATIONS & OPERATIONAL BOUNDS (KNOWN_LIMITS.md)

> **Document Status**: RELEASE ACCEPTED (Week 10 Intellectual Honesty Declaration)  
> **Classification**: Engineering Transparency & Institutional Boundaries  
> **Scope**: Physical, Hardware, Optical, and Cryptographic Boundaries  
> **Associated Artifacts**: [FINAL_CONTRACT_REPORT.md](file:///c:/Users/bhask/Desktop/att2/docs/FINAL_CONTRACT_REPORT.md), [THREAT_MODEL_FINAL.md](file:///c:/Users/bhask/Desktop/att2/docs/THREAT_MODEL_FINAL.md)

---

## 1. Executive Statement

In strict accordance with the **Prime Directive of Week 10**, this document catalogues every known weak point, physical constraint, and contract miss of the SNIST ERP attendance engine. A system with documented, bounded limitations is dependable; a system that quietly re-words or hides its failures is a liability.

---

## 2. Declared Contract Gap: Old-Tier Terminal Failure Rate (3.1% vs < 3.0%)

* **Contract Target**: Terminal failure rate on old-tier Android hardware $< 3.0\%$.
* **Measured Production Reality**: **3.1%** ($n = 262$ attempts, 8 terminal failures).
* **Forensic Diagnosis**:
  * Root cause lies entirely in Android 8.0/8.1 Camera2 driver implementations on ultra-budget devices (specifically Xiaomi Redmi 6A with MediaTek Helio A22 and Samsung Galaxy J2 Core).
  * On these chipsets, rapid switching between video preview streams and canvas frame grabs occasionally triggers an uncatchable native OS daemon panic (`android.hardware.camera.provider@2.4-service` deadlock).
* **Owner-Ready Recommendation**:
  1. Maintain the Week 8 Camera Degradation Ladder (10s watchdog reset followed by prompt to use the audited manual marking fallback).
  2. Do **not** attempt further client-side hacks to resurrect frozen Android 8 OS camera daemons, as aggressive polling increases battery drain and thermal throttling on legacy chipsets.

---

## 3. Optical & Physical Distance Boundaries

* **Maximum Certified Range**: **15.0 meters** from classroom projector screen.
* **Physical Prerequisites**:
  * Screen size must be $\ge 100\text{ inches}$ ($2.54\text{m}$ diagonal).
  * Projector luminosity must be $\ge 3,000\text{ ANSI Lumens}$.
  * Projection aspect ratio must be 1:1 square canvas with zero border padding.
* **Degradation Boundary**:
  * In classrooms with degraded projector lamps ($< 1,500\text{ ANSI Lumens}$) or direct sunlight washing out the projection screen, maximum optical decode range drops to **8.5 – 10.0 meters**.
  * Students in the rear rows of unshaded, dim-projector rooms must either use 2x digital zoom or step into the central aisle to scan.

---

## 4. Offline Submission Window Boundary (10 Minutes)

* **Policy Rule**: `SUBMIT_GRACE_MINUTES = 10`.
* **Behavior**: Scans recorded offline during classroom WiFi outages are accepted up to **10 minutes post-session lock** (`locked_at`).
* **Boundary Consequence**:
  * Any offline scan submitted at $+10\text{m }01\text{s}$ or later is **permanently rejected** with HTTP 400 (`Attendance session is locked. Submission grace window (10m) has expired.`).
  * Students who delay syncing until evening hours or home arrival will forfeit their attendance mark and must seek administrative manual review.
* **Security Rationale**: A wider offline window would enable students to screenshot tokens, travel home, and replay them hours later under the pretext of an offline queue.

---

## 5. Device-Sharing Inter-Period Boundary (30 Minutes)

* **Policy Rule**: `DEVICE_BINDING_MINUTES = 30`.
* **Behavior**: A phone bound to Student A cannot be used by Student B for 30 minutes.
* **Boundary Consequence**:
  * If Student A attends Period 1 (09:30 – 10:20), logs out, and physically hands their phone to Student B for Period 2 (10:30 – 11:20), Student B **can** authenticate, as $> 30\text{ minutes}$ have elapsed since Student A's initial binding.
* **Mitigating Detective Control**: The Admin Compliance Tab flags devices associated with more than 2 distinct SAP IDs within a rolling 7-day period for dean/HOD academic audit.

---

## 6. WASM Linear Memory on Sub-1GB RAM Devices

* **Hardware Boundary**: Smartphones with total system RAM $< 1\text{GB}$ running Android Go editions.
* **Behavior**:
  * The `zxing-cpp` WebAssembly binary requests a 16MB linear memory buffer on instantiation.
  * On severely resource-constrained devices with heavy background application pressure, Chrome WebView may fail to allocate the WebAssembly memory page.
* **Mitigating Fallback**: The frontend automatically intercepts WASM initialization rejections and falls back to the pure JavaScript `jsqr` engine within 150ms.
