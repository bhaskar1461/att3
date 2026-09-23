# SNIST ERP Attendance System — Implementation Audit (Phase 0)

**Date**: 2026-09-19  
**Status**: Completed  
**Objective**: Comprehensive technical audit of the existing codebase, schema, authentication, attendance engine, camera pipeline, geolocation services, and deployment architecture prior to phase-by-phase execution.

---

## 1. Executive Summary

The repository represents a mature, production-grade attendance system integrated into the SNIST ERP ecosystem. It features:
- A **FastAPI** backend with SQLAlchemy ORM, SQLite/MariaDB compatibility, and layered security/compliance analytics.
- A **React + Vite + TypeScript PWA** frontend with service-worker offline resilience and dedicated faculty/student mobile dashboards.
- A **dual-layer device binding** infrastructure (Layer 1 anti-proxy binding + Layer 2 WebCrypto ECDSA challenge-response).
- A **server-authoritative geofencing service** utilizing spherical Haversine calculations.
- A **controlled camera recovery and fallback** mechanism ensuring continuity during hardware failure without sacrificing cryptographic or location verification.
- A **post-attendance selfie collection service** storing images in private object storage decoupled from attendance validity.

---

## 2. Feature Classification Matrix

| Domain / Feature | Status | Current Implementation Notes |
| :--- | :---: | :--- |
| **User Identity & Roles** | **EXISTS AND WORKS** | `User` (STUDENT, TEACHER, HOD, DEAN, ADMIN) with bcrypt password hashing in `backend/app/models/models.py`. |
| **Faculty Canonical SAP ID** | **EXISTS AND WORKS** | `Teacher.teacher_code` maps to the canonical institutional SAP ID. |
| **Student Institutional Profile** | **EXISTS AND WORKS** | `Student` linked to Department, Section, Academic Year, and Roll Number (`qr_students`). |
| **Teaching Assignments** | **EXISTS AND WORKS** | `TeacherAssignment` (`qr_teacher_assignments`) connects Teacher, Subject, and Section. |
| **Attendance Session Model** | **EXISTS AND WORKS** | `AttendanceSession` (`qr_attendance_sessions`) tracks period, date, status, faculty GPS (`latitude`, `longitude`, `accuracy_m`), and `geofence_radius_m`. |
| **Authoritative Geofence Calculation** | **EXISTS AND WORKS** | Backend Haversine distance calculation in `backend/app/services/geofence_service.py`. Enforces 100m radius; client distance claims are completely untrusted. |
| **Rotating QR Tokens (HMAC-SHA256)** | **EXISTS AND WORKS** | `generate_projector_session_token()` in `backend/app/core/security.py` with sliding sub-second grace window and HMAC-SHA256 signature. |
| **Device Binding V1 & V2** | **EXISTS AND WORKS** | Dual-mode support: Layer 1 random UUID auto-enrollment with 30-day lock + Layer 2 ECDSA P-256 challenge-response (`DeviceRegistration`, `DeviceAccountBinding`). |
| **Single Attendance Authority** | **EXISTS AND WORKS** | `UniqueConstraint("session_id", "student_id")` on `qr_attendance_records` + atomic transaction in `backend/app/api/student.py`. |
| **Camera State Machine & Fallback** | **EXISTS AND WORKS** | Multi-state camera handling in `StudentClassScannerModal.tsx` with retry, camera switching, degradation help sheet, and controlled `QR_CAMERA_FALLBACK` code input. |
| **Post-Attendance Selfie Capture** | **EXISTS AND WORKS** | `PostAttendanceSelfieModal.tsx` + `selfie_service.py`. Uploads to `data/selfies/YYYY/MM/<session>/<student>/<uuid>.jpg` and persists metadata in `selfie_records`. |
| **Selfie Decoupling Invariant** | **EXISTS AND WORKS** | Selfie skip or upload failure never reverts or invalidates `status = PRESENT`. |
| **Future Face Pipeline (ONNX)** | **EXISTS BUT INCOMPLETE** | Architectural spec exists in `docs/FACE_PIPELINE.md`. Separate from MVP; ONNX inference deferred until shadow mode. |
| **Automated Verification Test Suite** | **EXISTS AND WORKS** | 42 test suites in `backend/tests/`, including `test_attendance_mvp_full.py` (8/8 passing). |

---

## 3. Existing Architecture

```text
               +-------------------------------------------+
               |         React / TypeScript PWA            |
               |  (TeacherDashboard, StudentScannerModal,  |
               |     PostAttendanceSelfieModal, PWA SW)    |
               +---------------------+---------------------+
                                     |  HTTPS / REST / JSON
                                     v
               +-------------------------------------------+
               |               FastAPI App                 |
               |  +-------------------------------------+  |
               |  |  Auth / Teacher / Student / Attend. |  |
               |  |  GeofenceService (Haversine 100m)   |  |
               |  |  QR Security (HMAC-SHA256, 10s-30s) |  |
               |  |  DeviceBinding (ECDSA / Lockout)    |  |
               |  |  SelfieService (Private Storage)    |  |
               |  +-------------------------------------+  |
               +---------------------+---------------------+
                                     |
                    +----------------+----------------+
                    v                                 v
          +-------------------+             +-------------------+
          | MySQL / MariaDB   |             | Private Storage   |
          | (or SQLite dev)   |             | (data/selfies/)   |
          +-------------------+             +-------------------+
```

---

## 4. Existing Database Structure

The database schema aligns with `DATABASE_SCHEMA.md`:
- **Identity & Organization**:
  - `users`: Authenticated accounts with bcrypt hash and roles (`STUDENT`, `TEACHER`, `HOD`, `DEAN`, `ADMIN`).
  - `departments`: Department catalog.
  - `academic_years`: Academic year catalog.
  - `sections`: Student cohorts mapped to department and academic year.
  - `qr_subjects`: Academic subjects mapped to department and academic year.
  - `qr_teachers`: Faculty profile storing canonical `teacher_code` (SAP ID).
  - `qr_students`: Student profile storing unique `roll_number` and device linkage.
  - `qr_teacher_assignments`: Core academic relationship binding Teacher + Subject + Section.
- **Attendance Core**:
  - `qr_attendance_sessions`: Faculty sessions with server timestamps, `faculty_latitude`, `faculty_longitude`, `faculty_accuracy_m`, and `geofence_radius_m`.
  - `qr_attendance_records`: Authoritative attendance transactions with `UNIQUE(session_id, student_id)`, `student_latitude`, `student_longitude`, `gps_accuracy_m`, `distance_m`, `scan_mode`, `selfie_status`, and `selfie_storage_key`.
  - `selfie_records`: Private selfie metadata (object key, MIME type, file size, dimensions, quality status, timestamps).
  - `security_audit_logs`: Authoritative audit ledger logging session creation, geofence failures, and device activity.

---

## 5. Security & Verification Analysis

1. **Server-Authoritative Geofencing**:
   - Geofence calculation uses backend `haversine_distance()`.
   - Rejection is immediate (HTTP 403 Forbidden) with `GEOFENCE_VALIDATION_FAILED` audit entry when student distance exceeds `geofence_radius_m`.
   - Browser claims of distance are completely ignored.
2. **Rotating QR Security**:
   - Compact format `SNIST-SES|<session_b36>|<periods>|<step_b36>|<mac>`.
   - Refreshes every 10s (standard 30s envelope).
   - Secret key generated from AES server configuration; never transmitted to browser.
3. **Controlled Camera Fallback**:
   - When device camera fails (permission denied, black screen, sensor failure), the student can open the degradation help sheet and input the rotating token payload manually.
   - The backend validates the token, student credentials, bound device, student GPS, 100m geofence, and duplicate check identically to a QR scan, recording `scan_mode="QR_CAMERA_FALLBACK"`.
4. **Post-Attendance Selfie Decoupling**:
   - Captured strictly **after** attendance is recorded in the DB.
   - Upload failures or student skips trigger `POST /api/v1/attendance/records/{id}/selfie-skip` which marks `selfie_status = FAILED` or `SKIPPED` while maintaining `AttendanceStatus.PRESENT`.

---

## 6. Known Limits & Risks

1. **GPS Signal Indoors**: Deep indoor classrooms (e.g. basement labs) may report high GPS accuracy radius (>50m). The backend allows configurable `accuracy_m` thresholds.
2. **Google Sheets Sync**: Non-fatal Google Sheets sync errors occur in test environments without API credentials; defensive error handling prevents these from affecting DB attendance.
3. **Face Verification Integration (Phases 13-16)**: ONNX face embeddings must remain in shadow mode and must never override the authoritative QR+GPS+Device decision during MVP.

---

## 7. Phase 0 Definition of Done Checklist

- [x] Repository understood and audited
- [x] Existing attendance flow mapped and verified
- [x] Database models and schema migrations inspected
- [x] Authentication and canonical SAP ID verified
- [x] QR generator and scanner pipeline inspected
- [x] Camera state machine and fallback verified
- [x] Geolocation services and 100m Haversine limit verified
- [x] Deployment and environment settings inspected
- [x] Automated test suite verified (100% clean pass on `test_attendance_mvp_full.py`)
- [x] Implementation audit report generated in `docs/IMPLEMENTATION_AUDIT.md`
