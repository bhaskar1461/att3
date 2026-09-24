# att2 ERP — CompreFace Face Verification & Anti-Replay Integration Plan

**Status**: Planned (Deferred for execution after Phase 1 data collection)  
**Target Environment**: `att2` Production/Staging ERP  
**Inference Engine**: CompreFace `SubCenter-ArcFace-r100-gpu` on NVIDIA RTX 3060 Laptop GPU (Port `8001`)  
**Active API Key**: `e3b4f89b-4523-476c-b8dd-d84e0f66c9f6` (Model Name: `att2`)

---

## 1. Executive Summary & Core Principle

The face verification system will be deployed in a **strict 3-stage phased rollout**.

> [!IMPORTANT]
> **Cardinal Rule**: Attendance validity must NEVER be put at risk during data collection. In Phase 1, student attendance is immediately recorded as `PRESENT` upon QR scan. The selfie capture is post-attendance, with an explicit skip option if camera permissions fail.

---

## 2. Architecture & Security Boundary

```
┌───────────────────────────────────────────────────────────┐
│ Student Phone (att2 Frontend / PWA)                       │
│ 1. Scans classroom dynamic QR code                        │
│ 2. Attendance immediately marked PRESENT in database      │
│ 3. Post-Attendance: Safe Selfie Modal prompts for photo   │
│    (With option to skip; attendance is never cancelled)   │
└─────────────────────────────┬─────────────────────────────┘
                              │ POST /attendance/records/{id}/selfie
                              ▼
┌───────────────────────────────────────────────────────────┐
│ att2 Backend (FastAPI on Port 8000)                       │
│ 1. Validates JWT / student identity                       │
│ 2. Saves image to `data/selfies/YYYY/MM/<session>/<id>/`  │
│ 3. Logs metadata to `selfie_records` table                │
│ 4. (Phase 3 only): Calls CompreFace via private API key   │
└─────────────────────────────┬─────────────────────────────┘
                              │ POST /api/v1/recognition/recognize
                              ▼
┌───────────────────────────────────────────────────────────┐
│ CompreFace Engine (Docker on Port 8001 / RTX 3060 GPU)    │
│ 1. SubCenter-ArcFace-r100 extracts 512-dim embedding      │
│ 2. Calculates cosine similarity with enrolled student     │
│ 3. Returns match confidence score (e.g. 0.94) in <150ms   │
└───────────────────────────────────────────────────────────┘
```

### Security Boundary:
- **Never expose the CompreFace API key or URL in the frontend.**
- The student's browser/PWA only communicates with the `att2` backend via authenticated endpoints (`/api/v1/attendance/records/{id}/selfie`).
- CompreFace runs privately on localhost:8001 (or internal network), shielded from public access.

---

## 3. The 3-Phase Implementation Plan

### Phase 1: Safe Data Collection (Zero-Risk Initial Rollout)
*Goal: Gather real-world student selfies across various phones, classroom lighting, and angles without interfering with attendance.*

1. **Frontend ([`frontend/src/pages/AttendanceLanding.tsx`](file:///c:/Users/bhask/Desktop/att2/frontend/src/pages/AttendanceLanding.tsx))**:
   - Once attendance status confirms `PRESENT`, trigger [`PostAttendanceSelfieModal.tsx`](file:///c:/Users/bhask/Desktop/att2/frontend/src/components/PostAttendanceSelfieModal.tsx).
   - Display clear messaging: *"Attendance Recorded! Take a quick selfie for institutional photo records."*
   - Provide a prominent **"Skip"** button. If tapped, call `/records/{id}/selfie-skip`.
2. **Backend ([`backend/app/services/selfie_service.py`](file:///c:/Users/bhask/Desktop/att2/backend/app/services/selfie_service.py))**:
   - Persist incoming photos to `data/selfies/YYYY/MM/<session_id>/<student_id>/<uuid>.jpg`.
   - Insert row into `selfie_records` (`quality_status="ACCEPTED"`, `status="UPLOADED"`).
   - Update `attendance_records.selfie_status = "ACCEPTED"`.
   - Ensure exceptions or failed uploads return a polite message while leaving `attendance_records.status = "PRESENT"`.

---

### Phase 2: Offline Dataset Benchmarking & Model Tuning
*Goal: Scientifically validate accuracy and tune the similarity threshold before turning on enforcement.*

1. **Student Reference Enrollment**:
   - Ingest clean reference photos (from admission records or student portal profile) into CompreFace under each student's Roll Number:
     ```http
     POST /api/v1/recognition/faces?subject={ROLL_NUMBER}
     x-api-key: e3b4f89b-4523-476c-b8dd-d84e0f66c9f6
     ```
2. **Batch Accuracy Benchmark (`scripts/benchmark_selfie_dataset.py`)**:
   - Run an automated evaluation script over all images in `data/selfies/`.
   - Measure:
     - **True Match Distribution**: Average similarity score for legitimate students (target: $\ge 0.92$).
     - **False Rejection Rate (FRR)**: Percentage of legitimate selfies scoring below threshold.
     - **Lighting / Angle Edge Cases**: Detect dark rooms, motion blur, glasses vs no-glasses.
3. **Establish Threshold**:
   - Set optimal operational threshold (e.g. `SIMILARITY_THRESHOLD = 0.85` or `0.88`).

---

### Phase 3: Active Verification & Anti-Spoofing
*Goal: Enforce face matching and prevent proxy attendance.*

1. **Client-Side Anti-Replay Liveness Guard**:
   - Incorporate the lightweight 2-step randomized challenge into `PostAttendanceSelfieModal.tsx`:
     - Challenge pool: *Turn Head Left*, *Turn Head Right*, *Smile*, *Blink*.
     - Dynamic 4.5-second countdown timer per challenge.
     - Blocks photo printouts, pre-recorded video playback, and screen replays.
     - Keeps client payload tiny ($<0.1\text{ ms}$ math calculations on existing MediaPipe landmarks).
2. **Backend Verification Flow**:
   - In `selfie_service.py`, forward the validated selfie to CompreFace:
     - If `similarity >= 0.85` and `subject == student.roll_number`:
       - `record.selfie_status = "VERIFIED"`
     - If `similarity < 0.85`:
       - Flag record as `SUSPECT_PROXY` for faculty review in `TeacherDashboard.tsx`.

---

## 4. Key Configuration Values

Add to [`c:\Users\bhask\Desktop\att2\.env`](file:///c:/Users/bhask/Desktop/att2/.env) when enabling Phase 2/3:

```env
# CompreFace Biometric Engine
COMPREFACE_URL=http://localhost:8001
COMPREFACE_API_KEY=e3b4f89b-4523-476c-b8dd-d84e0f66c9f6
COMPREFACE_SIMILARITY_THRESHOLD=0.85
COMPREFACE_ENABLED=false   # Set to true when entering Phase 3
```

---

## 5. Summary Checklist for When We Resume

- [ ] Connect `PostAttendanceSelfieModal` to `AttendanceLanding.tsx`.
- [ ] Run classroom test to collect 50–100 real student selfies.
- [ ] Run `scripts/benchmark_selfie_dataset.py` against the CompreFace `att2` model.
- [ ] Verify accuracy and false rejection rate.
- [ ] Toggle `COMPREFACE_ENABLED=true` for live proxy protection.
