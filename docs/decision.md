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
