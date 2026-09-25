# SNIST ERP Attendance System
# Product Requirements Document (PRD)

**Product:** SNIST ERP Attendance System  
**Module:** Attendance  
**Document:** Product Requirements Document  
**Version:** 1.0  
**Status:** MVP Development  
**Owner:** SNIST ERP Development Team  
**Primary Platform:** Web / PWA  
**Backend:** FastAPI  
**Database:** MySQL  
**Frontend:** React + TypeScript  

---

# 1. Product Overview

The SNIST ERP Attendance System is a secure, web-based attendance platform designed to replace unreliable/manual attendance workflows with a fast, auditable, QR-based system.

The system uses multiple independent verification signals:

- Student authentication
- Faculty identity
- Rotating QR codes
- Server-side session validation
- Cryptographic device identity (WebCrypto ECDSA P-256 / Android Keystore; zero reliance on spoofable hardware fingerprints)
- GPS/geofencing
- Camera availability detection
- Controlled camera-failure fallback
- Audit logging
- Optional selfie collection
- Future face verification

The initial MVP must remain QR-based.

Face recognition is a future enhancement and must not become a dependency for attendance during the initial rollout.

---

# 2. Product Goals

## Primary Goals

1. Make attendance fast enough for a real classroom.
2. Prevent simple QR sharing/proxy attendance.
3. Ensure attendance can only be recorded for a valid faculty session.
4. Verify that the student is physically near the session location.
5. Handle camera failures without unnecessarily preventing legitimate students from attending.
6. Maintain complete auditability.
7. Prepare the system for future face verification.
8. Maintain compatibility with the existing SNIST ERP architecture.

---

# 3. Non-Goals

The MVP will NOT attempt to:

- Replace QR attendance with face recognition.
- Automatically mark attendance based on a face alone.
- Train a proprietary facial-recognition model.
- Provide perfect GPS anti-spoofing.
- Provide perfect biometric anti-spoofing.
- Perform continuous facial surveillance.
- Use IP geolocation as the primary attendance geofence.
- Store unnecessary biometric information.
- Allow client-side code to directly mark attendance.

---

# 4. Target Users

## 4.1 Faculty

Faculty members:

- Start attendance sessions.
- Display the QR code.
- Monitor attendance.
- End sessions.
- View session results.

---

## 4.2 Students

Students:

- Open the attendance module.
- Scan the faculty QR.
- Provide location permission.
- Complete attendance verification.
- Receive attendance confirmation.
- Optionally provide a selfie for the future face-verification system.

---

## 4.3 Super Admin

Super Admins:

- Monitor attendance activity.
- Investigate suspicious attempts.
- View audit logs.
- Manage system configuration.
- Manage devices.
- Manage student/faculty records.
- Manage attendance sessions where authorized.

---

# 5. Core User Journey

## Faculty

```text
Login
  ↓
Select Teaching Assignment
  ↓
Start Attendance
  ↓
Grant Location Permission
  ↓
Capture Faculty Location
  ↓
Create Attendance Session
  ↓
Generate Rotating QR
  ↓
Display QR
  ↓
Students Scan
  ↓
Monitor Attendance
  ↓
End Session
```

## Student

```text
Login / Launch
  ↓
Open Attendance (Web/PWA, Android APK, Native Camera URL, or Paste-and-Go)
  ↓
Scan Rotating QR / Submit Token
  ↓
Backend Validates Session, Device Cryptographic Proof, GPS & Geofence
  ↓
Attendance Marked PRESENT (Authoritative Decision)
  ↓
Front Camera Automatically Opens (350ms Hardware Cooldown)
  ↓
Platform-Adaptive Oval Reticle (iOS Face-Scan UX / Android Material Motion)
  ↓
Client-Side Face Detection Starts
  ↓
Quality Gate: Exactly 1 face, centered, proper size, good lighting
  ↓
Face Stability Buffer Confirmed (3 consecutive frames)
  ↓
3-Second Auto Countdown (immediate cancellation if face leaves frame)
  ↓
Automatic Shutterless Capture at 0
  ↓
Image Quality Validation & Resizing (max 1080px, <5MB)
  ↓
Secure Upload to /api/v1/attendance/records/{id}/selfie
  ↓
Confirmation Displayed (Attendance remains PRESENT even if selfie fails/skipped)
```
