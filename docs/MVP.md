# SNIST Attendance System — MVP Specification

**Project:** SNIST ERP Attendance System  
**Document:** MVP Specification  
**Version:** 1.0  
**Status:** Development Specification  
**Primary Goal:** Build a reliable QR-based attendance system with server-verified geolocation, controlled camera-failure fallback, device binding, and secure selfie collection for future face verification.

---

# 1. MVP Objective

The MVP extends the existing SNIST QR attendance system without replacing the current QR workflow.

The system must:

1. Allow faculty to start an attendance session.
2. Automatically capture the faculty's location when the session starts.
3. Create a configurable geofence around the faculty's location.
4. Generate a short-lived rotating QR code.
5. Allow students to scan the QR code.
6. Verify the student's identity, device, session, QR token, and location.
7. Handle camera-permission failures gracefully.
8. Provide a controlled fallback when the student's camera cannot be used.
9. Record exactly how attendance was marked.
10. Collect a selfie after successful attendance for future face-recognition development.
11. Keep face recognition completely separate from attendance decisions during the initial MVP.
12. Preserve sufficient audit information to investigate proxy-attendance attempts.

---

# 2. MVP Scope

## Included

### Attendance

- Faculty session creation
- Session start/end
- Rotating QR generation
- QR validation
- Student attendance marking
- Duplicate attendance prevention
- Attendance audit logging

### Location

- Faculty GPS capture at session creation
- Configurable geofence
- Default radius: 100 meters
- Student GPS verification
- Server-side distance calculation
- Location accuracy validation
- Location verification logging

### Camera

- Browser camera permission handling
- Camera initialization status
- Black-screen/error detection
- Camera retry
- Camera switching
- 30-second recovery period
- Controlled fallback workflow

### Device Security & Cryptographic Device Identity

- **Core Identity Distinction:**
  - `Device Identifier`: Unique client UUID handle (`device_id`) used for session routing and telemetry.
  - `Cryptographic Device Identity`: Non-exportable hardware/Keystore/WebCrypto ECDSA P-256 asymmetric keypair proving possession via digital signature verification. Private keys never leave the client device.
  - `Physical Hardware Identity`: Physical phone hardware / silicon attributes (IMEI, MAC, serial number, screen, UA, browser fingerprint) — strictly prohibited as authorization factors to eliminate false collisions across identical phone models (e.g. 10 Samsung Galaxy A55 5G devices).
- **Web/PWA & APK Cross-Platform Support:** WebCrypto API on Web/PWA, Android Keystore on native APK.
- **Server-Authoritative Possession Verification:** Single-use canonical challenge format:
  `attendance_device_proof_v1|{challenge_id}|{device_id}|{operation}|{timestamp}|{nonce}`.
- **Cross-Student Key Reuse Prevention:** Immediate rejection (`DEVICE_KEY_REUSE_REJECTED` / HTTP 409) if a public key is registered by another student.
- **Single-Device Policy & Controlled Recovery:** 1 active device per student with controlled replacement (`replace_active` / OTP rebind) preserving historical attendance audit records.

### Selfie Collection (Automatic Post-Attendance Capture)

- **QR-First Architecture**: Selfie camera strictly opens *after* backend confirms QR attendance authorization.
- **Front-Camera Initialization**: Automatically transitions from rear QR camera to front selfie camera with a 350ms hardware sensor cooldown to prevent Camera2 HAL / AVFoundation contention.
- **Client-Side Face Detection Quality Gate**: Real-time detection (via hardware-accelerated `window.FaceDetector` API or fast YCbCr skin chrominance + Laplacian sharpness fallback) enforcing:
  - Exactly one face in frame (multiple faces trigger alert)
  - Face centered inside the oval reticle
  - Adequate facial scale (12% to 85% bounding box area ratio)
  - Acceptable ambient luminance (35–245 Rec.601) and minimal blur
- **Face Stability Buffer & 3-Second Countdown**: Requires 3 consecutive valid frames before triggering countdown; if the face leaves the oval or drops during 3-2-1, countdown cancels immediately and resets to searching.
- **Automatic Shutterless Capture**: Zero button presses needed; captures automatically at countdown 0 with a subtle Web Audio shutter click and white screen flash.
- **Platform-Adaptive Scanning UX**:
  - *iOS / Safari*: Apple-inspired smooth oval scanning reticle with glowing boundary sweep and soft haptic feedback.
  - *Android*: Material 3 motion styling, pulsating radar ripples, and Material haptic feedback.
- **Decoupled Security & Failure Independence**: Attendance validity (`PRESENT`) is never revoked if selfie capture fails or is skipped; controlled retry reopens front camera without re-scanning QR.
- **HTTP Compression Negotiation**: Respects `Accept-Encoding: gzip`, never forces unsupported encodings (`zstd` is never forced), with uncompressed identity fallback.
- **Secure Image Upload**: Validates dimensions and file sizes (< 5MB), archives to private object storage under `data/selfies/{ROLL}_{NAME}/...` with audit logging.

### Future Face Recognition Preparation

- Secure selfie storage
- Image lifecycle management
- Face-processing pipeline preparation
- Embedding storage architecture
- Support for canonical + recent embeddings

---

# 3. Explicitly NOT Included in MVP

The following features must NOT be implemented as attendance requirements in the first MVP.

## Face-based attendance

The system must NOT reject attendance because a student's face does not match.

Face verification belongs to a later phase.

## Automatic face recognition

The MVP does not require:

- ONNX face verification
- Face embedding comparison
- Liveness detection
- Face-based attendance decisions
- Continuous face tracking

## Model training

The MVP does not train a face-recognition model.

Collected selfies are training/verification data candidates for future development.

## Advanced anti-spoofing

Do not attempt to implement a complete biometric anti-spoofing system in the MVP.

---

# 4. High-Level Architecture

```text
                         ┌─────────────────────┐
                         │       Faculty       │
                         │      Browser/PWA     │
                         └──────────┬──────────┘
                                    │
                              Start Session
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │       FastAPI       │
                         │       Backend       │
                         └──────────┬──────────┘
                                    │
                     ┌──────────────┼──────────────┐
                     │              │              │
                     ▼              ▼              ▼
                  Session          QR          Location
                  Service         Service       Service
                     │              │              │
                     └──────────────┼──────────────┘
                                    │
                                    ▼
                                Database
                                    │
                                    │
                         ┌──────────▼──────────┐
                         │      Student        │
                         │       PWA           │
                         └──────────┬──────────┘
                                    │
                           Scan rotating QR
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │ Attendance Service  │
                         └──────────┬──────────┘
                                    │
                ┌───────────────────┼───────────────────┐
                │                   │                   │
                ▼                   ▼                   ▼
             QR Check           GPS Check          Device Check
                │                   │                   │
                └───────────────────┼───────────────────┘
                                    │
                                    ▼
                            Attendance Record
                                    │
                                    ▼
                             Selfie Capture
                                    │
                                    ▼
                            Secure Storage
```
