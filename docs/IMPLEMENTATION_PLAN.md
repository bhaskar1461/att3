# SNIST ERP Attendance System
# Implementation Plan

**Project:** SNIST ERP Attendance System  
**Module:** Attendance  
**Document:** Implementation Plan  
**Version:** 1.0  
**Status:** MVP Development  
**Primary Objective:** Implement the QR + GPS attendance MVP, camera-failure fallback, and selfie collection without disrupting the existing attendance system.

---

# 1. Implementation Strategy

The implementation must be incremental.

Do not attempt to build QR, GPS, device binding, camera fallback, selfie capture, face embeddings, and ONNX verification simultaneously.

The implementation sequence is:

```text
Existing System Audit
        ↓
Database / Backend Foundation
        ↓
Faculty Session + GPS
        ↓
QR Validation
        ↓
Student GPS Validation
        ↓
Cryptographic Device Identity (ECDSA P-256 / Keystore)
        ↓
Attendance Transaction
        ↓
Camera Recovery
        ↓
Camera Fallback
        ↓
Selfie Collection
        ↓
Testing
        ↓
Deployment
        ↓
Future Face Pipeline
```

---

# 2. Cryptographic Device Identity Delivery Phases

1. **Phase 1 — Non-Exportable Client Keypair Generation:**
   - Web/PWA: WebCrypto `crypto.subtle.generateKey` ECDSA P-256 with `extractable: false`, persisted in IndexedDB.
   - Android APK: Android Keystore with Hardware-backed Keymaster/StrongBox.
   - Client generates a UUID `device_id` handle for routing/telemetry.
   - Private keys never leave the client device under any circumstances.
2. **Phase 2 — Server Registration & Key Uniqueness Enforcement:**
   - Endpoint: `POST /api/v1/attendance/devices/register`.
   - Enforces cross-student public key uniqueness (`DEVICE_KEY_REUSE_REJECTED` / HTTP 409).
   - Enforces 1 active device per student policy (`replace_active` / OTP rebind).
3. **Phase 3 — Server-Authoritative Challenge Generation:**
   - Endpoint: `POST /api/v1/attendance/devices/challenge`.
   - Generates canonical message: `attendance_device_proof_v1|{challenge_id}|{device_id}|{operation}|{timestamp}|{nonce}`.
   - Strict 60-second TTL with HMAC authentication.
4. **Phase 4 — Possession Proof & Scan-Path Verification:**
   - Endpoint: `POST /api/v1/attendance/devices/verify` & `POST /api/v1/student/scan-session`.
   - Verifies raw IEEE P1363 64-byte ECDSA signature over canonical message in <0.06ms.
   - Single-use atomic nonce consumption prevents replay attacks (`DEVICE_CHALLENGE_REPLAYED` / HTTP 401).
   - Zero reliance on spoofable hardware fingerprints (IMEI, MAC, IP, UA, canvas).
