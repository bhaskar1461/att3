# SNIST ERP Attendance System
# System Architecture

**Project:** SNIST ERP Attendance System  
**Module:** Attendance  
**Document:** System Architecture  
**Version:** 1.0  
**Status:** MVP Development

---

# 1. Architecture Objective

The attendance system must be:

- Server-authoritative
- Secure against basic proxy-attendance techniques
- Fast enough for classroom use
- Compatible with modern Android/iOS browsers
- Resilient to camera failures
- GPS-aware
- Auditable
- Modular
- Ready for future face verification
- Deployable by a small development team

The architecture must preserve the existing QR attendance workflow while adding geolocation, device binding, camera-failure handling, selfie collection, and a future ONNX face-verification layer.

---

# 2. High-Level Architecture

```text
                         ┌─────────────────────┐
                         │      Faculty        │
                         │     React/PWA       │
                         └──────────┬──────────┘
                                    │
                                    │ HTTPS
                                    ▼
                         ┌─────────────────────┐
                         │      API Gateway    │
                         │      / FastAPI      │
                         └──────────┬──────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              │                     │                     │
              ▼                     ▼                     ▼
       Session Service        QR Service          Location Service
              │                     │                     │
              └─────────────────────┼─────────────────────┘
                                    │
                                    ▼
                           Attendance Service
                                    │
                    ┌───────────────┼────────────────┐
                    │               │                │
                    ▼               ▼                ▼
              Device Service   Audit Service    Selfie Service
                    │               │                │
                    └───────────────┼────────────────┘
                                    │
                                    ▼
                              MySQL Database
                                    │
                                    │
                         ┌──────────▼──────────┐
                         │   Object Storage    │
                         │    Selfie Images    │
                         └─────────────────────┘


Future:

                         ┌─────────────────────┐
                         │   Face Service      │
                         │  ONNX Runtime       │
                         └──────────┬──────────┘
                                    │
                              Embeddings
                                    │
                                    ▼
                         Face Embedding Storage
```

---

# 3. Cryptographic Device Identity Architecture

### 3.1 Conceptual Identity Triad
The system enforces strict architectural separation between three concepts:
1. **Device Identifier (`device_id`):** A stable client handle / UUID generated upon key creation, used exclusively for session routing, device registration tracking, and telemetry indexing.
2. **Cryptographic Device Identity:** A non-exportable ECDSA P-256 asymmetric keypair generated inside the client's secure hardware/runtime (WebCrypto API on Web/PWA, Android Keystore on native APK). Private keys are never exportable and never transmitted over the network. Device possession is proven cryptographically via digital signatures.
3. **Physical Hardware Identity:** Physical device hardware and silicon attributes (IMEI, MAC, serial number, screen size, user-agent, IP address, canvas fingerprints). **Physical hardware identity is strictly prohibited as an authorization factor** because:
   - Multiple students frequently use identical phone models (e.g. Samsung Galaxy A55 5G) on the same campus Wi-Fi IP, causing catastrophic false device collisions under hardware fingerprinting.
   - Browser privacy sandboxes deliberately obscure hardware identifiers.
   - Hardware fingerprints are easily spoofed or replayed.

### 3.2 Canonical Challenge-Response Protocol
Proof of possession is evaluated server-authoritatively without trusting client assertions:
```text
attendance_device_proof_v1|{challenge_id}|{device_id}|{operation}|{timestamp}|{nonce}
```
- **Replay Protection:** Nonces are consumed atomically and rejected if replayed (`DEVICE_CHALLENGE_REPLAYED` / HTTP 401).
- **TTL Window:** Challenges expire strictly after `CHALLENGE_TTL_SECONDS` (60s) (`DEVICE_CHALLENGE_EXPIRED` / HTTP 401).
- **Key Reuse Lockout:** Cross-student registration of duplicate public keys is blocked (`DEVICE_KEY_REUSE_REJECTED` / HTTP 409).
- **Single Active Device Policy:** 1 active device per student with controlled replacement (`replace_active` / OTP rebind) preserving historical attendance audit records.
