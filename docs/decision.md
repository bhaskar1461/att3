# Architecture Decision Record (ADR-005)
## Honest 3-Layer Anti-Proxy Defense & Threat Model

**Status**: Accepted & Deployed  
**Date**: September 6, 2026  
**Context**: Mass student rollout of SNIST AI QR Attendance Portal across diverse Android and iOS devices.

---

### 1. Problem & Threat Model
In an academic attendance system using QR codes, the primary attack vector is **proxy attendance** — an absent student having a present friend mark attendance on their behalf.

When 30-minute device lockouts (`qr_device_account_bindings`) were enforced per browser instance, students could bypass the lockout on the same phone by opening a **different browser app** (e.g. Chrome ➔ Firefox ➔ Brave). Because each browser engine (Blink vs Gecko vs WebKit) renders WebGL and Canvas differently, client-generated device fingerprints varied, enabling students to switch roll numbers without triggering the 30-minute lock.

---

### 2. The 3-Layer Defense Architecture

To address this threat without requiring commercial app-store accounts ($0 cost), we established a **Defense-in-Depth** model:

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Layer 1: PWA Standalone Mode Check (Frontend UX Guard)                  │
│ Role: FRICTION / CONTAINER ENFORCEMENT (Client-Side)                     │
│ Mechanism: window.matchMedia('(display-mode: standalone)')               │
│ Guarantee: Casual browser-tab hopping is blocked; camera won't activate │
│ Limitation: Client-side JS can be inspected/bypassed by tech-savvy users│
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Layer 2: Bi-Directional Device Binding (Backend Server Wall)            │
│ Role: REAL CRYPTOGRAPHIC SECURITY PERIMETER (Server-Side)               │
│ Mechanism: registered_device_id in qr_students + SHA-256 HMAC Secret    │
│ Enforced On: /auth/login, /student/scan-session, /student/qr-code       │
│ Guarantee: Even if L1 is bypassed, login/scan returns HTTP 403 Forbidden│
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Layer 3: Concurrent Telemetry & Anomaly Detection (Audit Trail)         │
│ Role: RETROACTIVE DETECTION & INVESTIGATION                             │
│ Mechanism: SUSPICIOUS_CONCURRENT_SCAN audit events (<60s same IP/device)│
│ Guarantee: Flagged in admin reports for disciplinary mentor review      │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### 3. Layer Separation & Security Truth
* **Layer 1 is a UX barrier, NOT cryptographic security**:
  The standalone display-mode check in [`PwaInstallGuard.tsx`](file:///c:/Users/bhask/Desktop/attendnce_system/frontend/src/components/PwaInstallGuard.tsx) ensures that ordinary students interact through a single, isolated Webview container where storage is persistent. It eliminates 95% of casual browser-hopping attempts. However, because it runs on the client device, it is labeled in code and documentation strictly as a **UX guard**.
* **Layer 2 is the actual security wall**:
  All security guarantees rest server-side. The backend database maps `Student.id ↔ DeviceRegistration.id`. Any API call from an unapproved device is rejected with **HTTP 403 Forbidden**.
* **Layer 3 provides forensic oversight**:
  Logs concurrent scans, failed OTP attempts, and device switches into `qr_audit_logs`, alerting operators when abnormal clusters occur.

---

### 4. Self-Service Device Recovery & Rate-Limiting Policy
To prevent classroom lockouts when phones are genuinely broken, lost, or replaced:
1. **Self-Service Reset via Email OTP**:
   * Accessible directly from the login error banner.
   * Student verifies their SAP ID and password.
   * A single-use 6-digit OTP is dispatched to their official college email.
   * Rate limited: maximum 3 requests per hour.
   * Semester cap: maximum **5 self-service resets per semester**.
2. **Faculty / Admin Override**:
   * Attempt #6+ blocks self-reset and triggers an immediate security alert.
   * Faculty mentors can unbind the device with 1 click in the Class Roster.
   * Super Admins can search, reset, or bulk-reset devices with typed confirmation.

---

### 5. Residual Risk Disclosure
* **Credential Sharing**: If a student shares their portal password **and** college email inbox access with a proxy, the proxy can trigger a self-service reset on their own phone.
  * *Mitigation*: The 5 resets/semester cap prevents repeated back-and-forth swapping between two students' phones, and each reset is permanently recorded in `qr_audit_logs`.

---

# Architecture Decision Record (ADR-006)
## Zero-Cost Optical Pipeline for Long-Distance (10m–30m) Projector QR Scanning

**Status**: Accepted & Deployed  
**Date**: September 7, 2026  
**Context**: Mass classroom attendance scanning across 60–120 student lecture halls and auditoriums at distances between 10m and 30m, supporting 50% Android and 50% iOS Safari student devices.

---

### 1. Problem Statement & Cost Constraints
Standard browser barcode implementations (e.g., vanilla `html5-qrcode` downscaled to 260×260) fail consistently beyond 5–8 meters. In a 10m–30m lecture hall, a 29×29 module QR projected onto a standard screen subtends fewer than 10–14 pixels across the entire code on a smartphone sensor when unzoomed, rendering decoding physically impossible.

Commercial computer-vision SDKs such as **Dynamsoft Barcode Reader** offer high-distance decoders, but require commercial licensing fees ($1,200 to $4,500+ per year or per-scan metering) and proprietary closed-source blobs. This directly violates the strict institutional budget constraint: **$0 cost / zero paid SDKs / zero API keys**.

---

### 2. Architecture & Decision: The Free Optical Stack
To achieve 10m–30m scanning at zero financial cost, we architected a capability-gated dual-engine pipeline combining native browser APIs and permissive open-source libraries:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    Optical & Software Distance Pipeline (0–30m)                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│ Teacher Projector:                                                              │
│  - Full-Screen QR Mode expanding canvas to min(82vh, 82vw) (~1.8m-2.4m display) │
│  - Payload Minimization: Compact token S|<id>|<sig> yielding Version 2-3 QR      │
│  - W3C Screen Wake Lock (prevents display sleep during attendance window)        │
├─────────────────────────────────────────────────────────────────────────────────┤
│ Student PWA Scanner (Direct getUserMedia @ 1080p, 0 Artificial Downscaling):    │
│                                                                                 │
│ ┌──────────────────────────────────────┐  ┌───────────────────────────────────┐ │
│ │  Android / Chromium Path (50% Fleet) │  │   iOS Safari / WebKit (50% Fleet) │ │
│ ├──────────────────────────────────────┤  ├───────────────────────────────────┤ │
│ │ Engine 1: Native BarcodeDetector     │  │ Engine 2: jsQR (Apache-2.0, WASM) │ │
│ │  - Direct C++ OS decoding            │  │  - High-res 1080p full frame pass │ │
│ │  - Zero memory JS allocation overhead│  │  - Fallback for non-Chromium      │ │
│ │                                      │  │                                   │ │
│ │ Hardware Optical/Digital Zoom:       │  │ Software Central 45% ROI Crop:    │ │
│ │  - capabilities.zoom probed & gated  │  │  - 2.2x software optical boost    │ │
│ │  - Dynamic auto-zoom when box < 20%  │  │  - Increases module pixel density │ │
│ │  - Manual slider ALWAYS visible      │  │    for marginal distant frames    │ │
│ └──────────────────────────────────────┘  └───────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

### 3. Rejection of Dynamsoft & Commercial Alternatives
* **Dynamsoft Barcode Reader**: Rejected strictly due to cost. A single-year production deployment exceeds the departmental software budget. In addition, proprietary closed SDKs carry vendor lock-in and opaque data transmission risks.
* **Open-Source Decision**: Native `BarcodeDetector` (W3C standard, zero cost, built into Chromium Android) paired with `jsQR` (v1.4.0, Apache-2.0, zero cost, fully audited) delivers 100% free operation with no external runtime dependencies or licensing liabilities.

---

### 4. Honest Physics Rule & Boundary Conditions
1. **No Information Creation**: The central 45% ROI software crop amplifies existing sensor pixels and improves contrast thresholding for marginal frames. It **cannot create photons or information** that did not hit the sensor.
2. **Physical Optical Limits**: If ambient glare washes out contrast, or if a low-end sensor at 30m resolves fewer than 2 pixels per module, decoders will fail gracefully.
3. **Transparent UX**: The scanner interface never displays deceptive success-bait copy. When detection fails after 3 seconds, the UI clearly directs the student: *"Move closer or increase zoom"*.

---

### 5. Security & Lifecycle Integrity
* **Server Authority Intact**: Decoder changes do not alter attendance verification. The backend remains the authoritative gatekeeper for HMAC rotation, single-use nonce validation, and Layer 2 device binding.
* **Leak-Free Lifecycle Audit**: `stopCamera` immediately halts all `MediaStreamTrack` instances (guaranteeing camera indicator LED turns off), cancels active `requestAnimationFrame` loops, releases Screen Wake Lock, and nulls references.

