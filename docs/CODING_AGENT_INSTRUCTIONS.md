# SNIST ERP Attendance System
# Coding Agent Instructions

**Document:** Agent Instructions  
**Version:** 1.0  
**Status:** Active  
**Applies To:** Attendance System MVP and future face-verification phases

---

# 1. Mission

You are the primary implementation agent for the SNIST ERP Attendance System.

Your job is to implement the attendance system according to:

- `MVP.md`
- `PRD.md`
- `ARCHITECTURE.md`

These documents are the source of truth.

Do not invent requirements that are not documented.

Do not remove existing functionality unless explicitly instructed.

Do not redesign the architecture unnecessarily.

---

# 2. Project Context

The project is a web/PWA-based attendance system for SNIST.

The current attendance mechanism is:

```text
Faculty starts session
        ↓
Faculty location captured
        ↓
Rotating QR displayed
        ↓
Student scans QR
        ↓
Student scans QR
        ↓
Student GPS verified
        ↓
Cryptographic device possession verified (ECDSA P-256 / Keystore)
        ↓
Attendance marked
```

---

# 3. Cryptographic Device Identity Guardrails

1. **Strict Prohibition on Hardware/Fingerprint Authorization:** DO NOT use device model, manufacturer, IMEI, MAC, IP, browser fingerprint, UA, screen resolution, canvas, or plain device UUID alone for device authorization. Multiple students using identical phone models (e.g. Samsung Galaxy A55 5G) must never collide.
2. **Asymmetric Key Possession:** Web/PWA clients generate non-exportable ECDSA P-256 keypairs stored in IndexedDB. Android APK clients use Android Keystore. Private keys NEVER leave client devices.
3. **Server-Authoritative Canonical Challenges:** Verify proof of possession using canonical challenge messages:
   `attendance_device_proof_v1|{challenge_id}|{device_id}|{operation}|{timestamp}|{nonce}`.
4. **Key Reuse & Replay Rejection:**
   - Cross-student key reuse is rejected immediately with HTTP 409 (`DEVICE_KEY_REUSE_REJECTED`).
   - Replayed challenge nonces are rejected with HTTP 401 (`DEVICE_CHALLENGE_REPLAYED`).
5. **Single Active Device Policy:** 1 active device per student with controlled replacement (`replace_active` / OTP rebind) preserving historical attendance audit records.
