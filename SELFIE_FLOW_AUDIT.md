# SELFIE FLOW AUDIT & ROOT CAUSE ANALYSIS REPORT
**SNIST ERP Student Attendance System — Universal Front Camera & Face Detection Pipeline**  
**Document ID:** `AUDIT-SELFIE-2026-09-25`  
**Status:** FORENSIC INVESTIGATION COMPLETE — READY FOR REMEDIATION  

---

## 1. Executive Summary

A comprehensive forensic audit of the existing student post-attendance selfie flow was performed across the full stack:
- Frontend: `PostAttendanceSelfieModal.tsx`, `StudentClassScannerModal.tsx`, `AttendanceLanding.tsx`, `StudentPortal.tsx`, `api.ts`
- Backend: `attendance.py` (`/api/v1/attendance/records/{id}/selfie`), `selfie_service.py`, `student.py`, `models.py`
- Browser Hardware Layers: Android Chrome (Realme, Samsung, Xiaomi), iOS Safari, PWA / APK Webview

The audit confirms that the selfie flow is currently failing due to **five primary root causes**:
1. **Zero Face Detection Implementation**: The existing modal had no face detection engine whatsoever. It blindly scheduled a 3-second countdown 600ms after video metadata loaded regardless of whether a face was present, off-center, or multiple people were in frame.
2. **Camera Hardware Contention & Race Conditions**: The rear QR scanner camera was stopped on the exact same event-loop microtask that the front selfie camera was requested. Mobile HALs (specifically Android Camera2 on Realme/Samsung and iOS AVFoundation) lock the camera device, throwing `NotReadableError` / `TrackStartError`, resulting in instant failure ("Front selfie camera unavailable on this device").
3. **HTML5 Video `onloadedmetadata` Listener Race & iOS WebKit Freeze**: `srcObject` assignment preceded event attachment without fallback guards. On iOS Safari and low-end Android devices, metadata loaded before listener attachment or was blocked by missing `playsInline` DOM properties, stranding the UI permanently in `INITIALIZING` with a black viewfinder.
4. **Uncoordinated Disparate State Variables**: Flow control relied on disconnected booleans (`isFlashing`, `isCapturingRef`, `stream`, `cameraError`, `uploadError`), causing race conditions and unhandled cancellation when faces moved away or users retried.
5. **Form Data Double-Append & Boundary Issues**: The upload function appended both `files` and `file` fields simultaneously for backward compatibility, causing the backend to ingest frame 1 twice in burst mode.

---

## 2. End-to-End Trace of Existing Pipeline

```text
[1. QR Detection / URL Open]
    ↓ (payload token submitted to /api/v1/student/scan-session)
[2. Backend Verification]
    - Authenticated JWT validated
    - Session active & period matching
    - Cryptographic HMAC signature validated
    - GPS geofence evaluated (<100m)
    - AttendanceRecord written with status = PRESENT, selfie_status = PENDING
    - Response: { status: "SUCCESS", attendance_id: 12345, ... }
    ↓
[3. Success Callback in StudentClassScannerModal]
    - setSuccessResult(res)
    - setSelfieAttendanceId(res.attendance_id)
    - setShowSelfieModal(true)
    - stopCamera() [ASYNC HARDWARE TEARDOWN]
    ↓
[4. PostAttendanceSelfieModal Mount]
    - startCamera() called in useEffect([])
    - navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
    - ⚠️ FAILURE POINT A: Hardware collision with stopping rear camera (NotReadableError)
    - ⚠️ FAILURE POINT B: onloadedmetadata never fires on iOS Safari -> Stuck on "Initializing"
    ↓
[5. Countdown & Capture Execution]
    - ⚠️ FAILURE POINT C: Zero face detection. 600ms timer blindly starts 3-2-1 countdown!
    - Grab canvas frame using hardcoded scaling (distorts on portrait mobile)
    - Upload to /api/v1/attendance/records/{id}/selfie
    - ⚠️ FAILURE POINT D: Double appended files causing 4 frames instead of 3.
    ↓
[6. Backend Storage]
    - store_attendance_selfie writes image to data/selfies/<ROLL>_<NAME>/
    - Updates AttendanceRecord.selfie_status = "ACCEPTED"
    - Decoupled from AttendanceStatus.PRESENT
```

---

## 3. Detailed Root Causes & Failure Breakdown

### Failure Point 1: Complete Absence of Face Detection Gate
- **Location**: [`frontend/src/components/PostAttendanceSelfieModal.tsx`](file:///c:/Users/bhask/Desktop/att2/frontend/src/components/PostAttendanceSelfieModal.tsx#L140-L149)
- **Observed Code**:
  ```ts
  videoRef.current.onloadedmetadata = () => {
    try { videoRef.current?.play(); } catch {}
    setTimeout(() => {
      setCaptureStage('COUNTDOWN');
    }, 600);
  };
  ```
- **Root Cause**: The component completely lacked any Computer Vision or Face Detection model. It assumed that opening the camera meant a face was present.
- **Impact**: Photos were captured of empty classrooms, ceilings, hands, half-faces, or multiple students in frame, violating the institutional requirement.

### Failure Point 2: Camera Hardware Sensor Contention on Mobile Devices
- **Location**: [`frontend/src/components/StudentClassScannerModal.tsx`](file:///c:/Users/bhask/Desktop/att2/frontend/src/components/StudentClassScannerModal.tsx#L875-L881)
- **Observed Code**:
  ```ts
  setSuccessResult(res);
  if (res.attendance_id) {
    setSelfieAttendanceId(res.attendance_id);
    setShowSelfieModal(true);
  }
  stopCamera();
  ```
- **Root Cause**: `stopCamera()` releases the rear camera hardware asynchronously. Immediately rendering `PostAttendanceSelfieModal` invokes `getUserMedia({ video: { facingMode: 'user' } })` on the exact same tick. On Android (Realme, Samsung, Xiaomi) and iOS WebKit, simultaneous camera access requests while releasing previous sensors throws `NotReadableError: Could not start video source` or `TrackStartError`.
- **Impact**: Real devices immediately errored out with "Front selfie camera unavailable on this device. You may safely skip."

### Failure Point 3: Video Element `onloadedmetadata` Hang & iOS WebKit Freeze
- **Location**: [`frontend/src/components/PostAttendanceSelfieModal.tsx`](file:///c:/Users/bhask/Desktop/att2/frontend/src/components/PostAttendanceSelfieModal.tsx#L139-L149)
- **Observed Code**:
  ```ts
  videoRef.current.srcObject = mediaStream;
  videoRef.current.onloadedmetadata = () => { ... };
  ```
- **Root Cause**: Attaching `onloadedmetadata` after assigning `srcObject` causes race conditions where metadata is already available before listener attachment. Additionally, missing `playsinline` attributes on the DOM node caused iOS Safari to suspend video playback.
- **Impact**: The camera stream appeared black and stayed permanently stuck on "Initializing front selfie camera…".

### Failure Point 4: Fragile State Management & Re-render Race Conditions
- **Location**: State variables in `PostAttendanceSelfieModal.tsx`
- **Observed Code**: Disparate useState hooks (`captureStage`, `cameraError`, `uploadError`, `isFlashing`, `isSkipping`, `capturedFrames`).
- **Root Cause**: `startCamera` had `stream` in its `useCallback` dependency array while `useEffect` was `[]`. Every stream mutation recreated `startCamera` with stale closures.
- **Impact**: Countdown timers continued running even if the user closed the modal or switched tabs.

### Failure Point 5: Multi-frame Burst Double Upload
- **Location**: [`frontend/src/components/PostAttendanceSelfieModal.tsx`](file:///c:/Users/bhask/Desktop/att2/frontend/src/components/PostAttendanceSelfieModal.tsx#L186-L191) & [`backend/app/api/attendance.py`](file:///c:/Users/bhask/Desktop/att2/backend/app/api/attendance.py#L1588-L1592)
- **Observed Code**:
  ```ts
  formData.append('files', blob, filename);
  if (i === 0) formData.append('file', blob, filename);
  ```
  ```python
  if files: upload_list.extend(files)
  if file: upload_list.append(file)
  ```
- **Root Cause**: Frame 1 was added to both `files` and `file`, causing the backend to store 4 records instead of 3.

---

## 4. Required Remediation Plan

1. **Lightweight, Zero-Dependency Real-Time Face Detection**:
   - Implement **Dual-Tier Face Detection**:
     - **Tier 1 (Hardware-Accelerated)**: Native `window.FaceDetector` API where supported (modern Chromium/Android). Runs at 60 FPS in C++ with zero download footprint.
     - **Tier 2 (Universal Fallback)**: High-speed, lightweight client-side face detector (Pico-based cascade / skin-geometry analyzer) running at 30+ FPS in WebWorker/Canvas, compatible with iOS Safari and older Android phones.
   - **Quality Gate**:
     - Exactly 1 face detected.
     - Face centered inside the oval guide (within bounding tolerance).
     - Face minimum size requirement (at least 20% of viewport area).
     - Face stability requirement (stable across consecutive frames before starting countdown).
     - Multiple faces trigger `MULTIPLE_FACES` warning: *"Please ensure only your face is visible."*
     - If face leaves oval or disappears during countdown: countdown instantly cancels and resets to `FACE_NOT_DETECTED`.

2. **Hardware Transition Guard (Camera Switcher)**:
   - Introduce an intentional 350ms hardware cooldown between stopping the rear QR camera and requesting the front camera.
   - Use fallback constraint cascade:
     1. `{ facingMode: { exact: 'user' } }`
     2. `{ facingMode: 'user' }`
     3. `{ video: true }`
   - Prevents `NotReadableError` on Realme, Samsung, and iOS devices.

3. **Deterministic State Machine**:
   - Single authoritative enum state:
     `IDLE` → `CAMERA_INITIALIZING` → `CAMERA_READY` → `FACE_SEARCHING` → `FACE_DETECTED` → `COUNTDOWN` → `CAPTURING` → `VALIDATING` → `UPLOADING` → `SUCCESS` → `ERROR`
   - Clean transitions with explicit cancellation handlers.

4. **Platform-Adaptive Visuals**:
   - **iOS/Safari**: Face-ID-inspired smooth oval scanning reticle with soft cyan/emerald pulse, subtle haptic feedback, and modern typography.
   - **Android**: Material motion scanning sweep with pill indicators, crisp countdown typography, and Android vibration patterns.

5. **Decoupled Security Guarantee**:
   - Attendance remains `PRESENT` regardless of selfie outcome.
   - Selfie failure provides controlled retry without invalidating the attendance record or forcing a re-scan.
