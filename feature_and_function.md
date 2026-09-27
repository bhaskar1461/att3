# SNIST ERP AI QR-Attendance System — Complete Feature & Function Specification (`feature_and_function.md`)

> **Document Purpose**: Comprehensive, end-to-end architectural, operational, and functional knowledge base of the SNIST ERP AI QR-Attendance codebase. Designed to give an autonomous AI agent, developer, or system auditor full understanding of the entire app logic from start to end without ambiguity.

---

## Table of Contents
1. [Executive System Overview](#1-executive-system-overview)
2. [Core Institutional Rules & Invariants](#2-core-institutional-rules--invariants)
3. [End-to-End Operational Lifecycle (Start to End)](#3-end-to-end-operational-lifecycle-start-to-end)
   - [Phase 1: Institutional Roster & Academic Setup](#phase-1-institutional-roster--academic-setup)
   - [Phase 2: Identity Onboarding & Credential Dispatch](#phase-2-identity-onboarding--credential-dispatch)
   - [Phase 3: Cryptographic Device Binding & Hardware Proof (V2)](#phase-3-cryptographic-device-binding--hardware-proof-v2)
   - [Phase 4: Classroom Attendance Session Lifecycle (Faculty)](#phase-4-classroom-attendance-session-lifecycle-faculty)
   - [Phase 5: Student QR Attendance Scanning Pipeline](#phase-5-student-qr-attendance-scanning-pipeline)
   - [Phase 6: Verification, Ingestion Pipeline & Job Polling (Backend)](#phase-6-verification-ingestion-pipeline--job-polling-backend)
   - [Phase 7: Multi-Target Synchronization & Academic Exports](#phase-7-multi-target-synchronization--academic-exports)
   - [Phase 8: Governance, JNTUH Compliance & Security Forensics](#phase-8-governance-jntuh-compliance--security-forensics)
4. [Backend Architectural Map & Service Directory](#4-backend-architectural-map--service-directory)
5. [Frontend PWA Architectural Map & Component Directory](#5-frontend-pwa-architectural-map--component-directory)
6. [Data Model & Relational Schema Directory](#6-data-model--relational-schema-directory)
7. [Error Handling Taxonomy & Recovery Protocols (Section 3.1)](#7-error-handling-taxonomy--recovery-protocols-section-31)
8. [Configuration & Environment Matrix](#8-configuration--environment-matrix)

---

## 1. Executive System Overview

The **SNIST ERP AI Attendance System** is an enterprise-grade academic operating system built to automate classroom attendance verification across 10,000+ students and hundreds of faculty members. The system was developed to replace slow, proxy-vulnerable manual roll calls with an ultra-fast, cryptographically verifiable, dynamic QR-code scanning pipeline capable of processing 60+ scans per classroom within seconds.

### High-Level Technology Stack
* **Backend**: FastAPI (Python 3.11+ ASGI), SQLAlchemy ORM, MySQL 8 / MariaDB (with SQLite compatibility in dev/test), AnyIO threadpools, Cryptography (ECDSA P-256), Jinja2 HTML email engine.
* **Frontend**: React 18, TypeScript, Vite, TailwindCSS, Progressive Web App (PWA) with Workbox service worker caching, HTML5 Canvas, BarcodeDetector API / ZXing WASM scanner engine with jsQR fallback.
* **Biometrics & AI**: ArcFace / DeepFace facial recognition verification pipeline for post-scan attendance selfies.
* **External Integrations**: Frappe ERP (`snist_erp` DocTypes), Google Sheets API (v4 batch update appends), SMTP / Proofsy transactional email gateways.

```mermaid
graph TD
    subgraph Client Surfaces
        FD[Faculty Dashboard & Projector QR]
        SP[Student PWA & Mobile Scanner]
        AD[Admin Security & Governance Portal]
    end

    subgraph FastAPI Application Layer
        AUTH[Auth Router & JWT Service]
        SCAN[Student Scan Ingestion Endpoint]
        PIPE[Attendance Verification Pipeline]
        SESS[Teacher Session Controller]
        DEV[Device Binding V2 Controller]
    end

    subgraph Data & Storage Layer
        DB[(MySQL / MariaDB Database)]
        IDB[(Client IndexedDB - Private Keys)]
        MEM[AsyncIO Future Waiters Registry]
    end

    subgraph Downstream Sync Targets
        GS[Google Sheets Master Register]
        FR[Frappe ERP snist_erp API]
        EX[Dedicated Excel Registers]
    end

    FD -->|Starts Session / Broadcasts QR| SESS
    SP -->|Signs & Submits Scan Token| SCAN
    SCAN --> PIPE
    PIPE --> MEM
    PIPE --> DB
    PIPE -->|Async Trigger| GS
    PIPE -->|Async Trigger| FR
    PIPE -->|Async Trigger| EX
    SP -.->|Retrieves ECDSA P-256 Key| IDB
    AD --> DEV
    AUTH --> DB
```

---

## 2. Core Institutional Rules & Invariants

Every subsystem in the codebase enforces the following seven global invariants:

### INV-1: No Unintended Student Lockouts
* **Principle**: Existing students using legacy bound devices must never be locked out during cutover windows.
* **Mechanism**: During the active grace window (`LEGACY_BINDING_GRACE_UNTIL`), legacy devices scanning a session receive HTTP 409 `binding_upgrade_required` alongside an enrollment ticket code (`ticket_code`). The student PWA immediately launches an inline enrollment flow ($\le 30\text{s}$) without requiring administrative support. Post-grace devices receive HTTP 410 `binding_revoked_post_grace`. Cryptographically proven V2 devices authenticate with zero disruption.

### INV-2: Zero Lost or Duplicated Marks (Idempotency)
* **Principle**: Campus network drops, client timeout retries, or rapid double-taps must never double-count or drop attendance marks.
* **Mechanism**: Every scan submission carries a deterministic client idempotency key:
  $$\text{Idempotency-Key} = \text{device\_uuid} : \text{sha256(qr.token)[0:16]}$$
  The backend caches this key in the database for 24 hours. Any replay of an already processed key immediately returns the original HTTP 200 payload stamped with the HTTP response header `Idempotent-Replay: true`.

### INV-3: Event Loop Health & Non-Blocking Async
* **Principle**: A single slow database query or synchronous sleep must never block the central FastAPI `asyncio` event loop.
* **Mechanism**: Zero `time.sleep()` or blocking I/O is permitted in `async def` request paths. All blocking functions (synchronous DB ORM queries, file storage, email dispatch, Excel rendering) are offloaded to worker threads via Starlette's `run_in_threadpool(...)` and annotated `# sync-only — run via run_in_threadpool`.

### INV-4: Visible Failures (No Silent Errors)
* **Principle**: Failures must never leave the user staring at an unresponsive spinner or silent black screen.
* **Mechanism**: Every terminal failure maps to a dedicated, high-contrast feedback card rendered in a permanently reserved overlay slot (zero layout shift). Each card provides:
  1. A clear human explanation of the problem.
  2. A **Primary Action** button (e.g., "Retry Submit", "Rescan QR", "Upgrade Binding").
  3. A **Secondary Action** button (e.g., "Dismiss", "Close Scanner").

### INV-5: Zero Hard Page Reloads
* **Principle**: `window.location.reload()` is strictly banished from the scanner feature.
* **Mechanism**: Hard page reloads destroy camera stream pointers, wipe temporary application memory, trigger OS camera permission renegotiations, and break PWA background sync. All state recovery occurs through the explicit `RESET_SCANNER` action in the scanner Finite State Machine (FSM).

### INV-6: Zero Circular Module Dependencies
* **Principle**: Clean separation of concerns with acyclic module graphs.
* **Mechanism**: Enforced via `npx madge --circular --extensions "ts,tsx" src`. Telemetry handlers and cross-feature services register via Inversion of Control (IoC) dependency injection at application bootstrap.

### INV-7: Configuration Safety & Fast-Fail Boot
* **Principle**: The backend server must refuse to boot if required configuration parameters are missing or contradictory.
* **Mechanism**: The FastAPI lifespan startup hook validates email template dry-renders and configuration variables. If `BINDING_V2 = False`, the server strictly asserts that `LEGACY_BINDING_GRACE_UNTIL` is configured and parses as a valid ISO-8601 timestamp; otherwise, it raises a fatal `RuntimeError`.

---

## 3. End-to-End Operational Lifecycle (Start to End)

### Phase 1: Institutional Roster & Academic Setup
1. **Administrative Seeding**: Department administrators configure departments (`Department`), academic years (`AcademicYear`), class sections (`Section`), and subjects (`Subject`).
2. **Faculty Allotment**: Teachers are assigned to sections and subjects via `TeacherAssignment` records.
3. **Master Excel Pre-Generation**: As soon as a teacher assignment is created, the system auto-provisions a dedicated class attendance register (`generate_class_attendance_register`) formatted according to SNIST institutional templates.
4. **Student Master Import**: Students are enrolled with their immutable, canonical institutional identifier: **SAP ID** and **Roll Number** (e.g., `23311A0504`).

---

### Phase 2: Identity Onboarding & Credential Dispatch
1. **Admin Dispatch**: Department admin clicks "Dispatch Magic Onboarding Links" or "Send Credentials" in the Admin Portal (`/admin/onboarding`).
2. **Token Generation**: The system generates a cryptographic 32-byte URL-safe onboarding token associated with the student profile (`OnboardingToken`).
3. **Institutional Email Routing**: The system invokes `resolve_otp_recipient(student)`. It strictly formats the recipient address to `<roll_number>@cse.sreenidhi.edu.in`. Banned test handles (`alice`, `s1`, `demostudent`, `example.com`) are rejected.
4. **Email Dispatch with Audit**: The email service sends the onboarding magic link using the Jinja2 template `student_credentials_email.html`. The event is recorded in `qr_otp_delivery_log`.
5. **Student Activation**: The student opens the magic link on their mobile device (`/onboard?token=...`), sets a secure password, and is guided directly into device registration.

---

### Phase 3: Cryptographic Device Binding & Hardware Proof (V2)
Device Binding V2 ensures that a student cannot log in or scan attendance on another student's phone (anti-proxy protection).

```mermaid
sequenceDiagram
    autonumber
    participant App as 📱 Student Browser (PWA)
    participant IDB as 💾 IndexedDB (Hardware Keystore)
    participant API as ⚡ FastAPI Backend
    participant DB as 🗄️ MySQL Database

    App->>IDB: Generate WebCrypto ECDSA P-256 Keypair (extractable: false)
    IDB-->>App: Keypair Created (CryptoKey reference)
    App->>App: Export Public Key (SPKI Format / Base64)
    App->>API: POST /api/v1/binding/enroll (Public Key, Device Metadata, Browser Profile)
    API->>API: Validate No Active Binding Conflicts
    API->>DB: Invalidate Old Bindings (Status = REVOKED, reason = 'rebind')
    API->>DB: Insert New DeviceBinding (Status = ACTIVE, public_key)
    API-->>App: HTTP 200 OK (binding_id, key_id, server_time_utc)
    App->>App: Store { binding_status: 'ACTIVE', key_id } in localStorage
```

* **Device-to-Student Lockout (30 Minutes)**: Once a device logs in with a student SAP ID, the hardware UUID is locked to that student for 30 minutes (`DeviceBindingLock`). Any attempt by another student to log in on that device produces an immediate generic HTTP 403: *"Account switching restricted on this device"*.
* **Rebind & Recovery**: If a student changes their device or loses access, they submit a rebind request (`POST /api/v1/binding/rebind-request`) which enters an administrative approval queue (`RebindRequest`) or triggers an email OTP challenge.

---

### Phase 4: Classroom Attendance Session Lifecycle (Faculty)

```mermaid
sequenceDiagram
    autonumber
    actor Teacher as 👩‍🏫 Faculty
    participant UI as 💻 Teacher Dashboard
    participant API as ⚡ FastAPI Backend
    participant DB as 🗄️ MySQL Database
    participant Screen as 📽️ Projector Display (/qr)

    Teacher->>UI: Selects Subject, Section, Period(s) & Clicks "Start Attendance"
    UI->>UI: Single-Flight Guard: Set isStartingSession = true
    UI->>UI: Capture Faculty GPS Coordinates (HTML5 Geolocation)
    UI->>API: POST /api/v1/teacher/sessions/start (subject_id, section_id, period, geo)
    API->>DB: Create AttendanceSession (status = OPEN, faculty_lat, faculty_lng, radius = 100m)
    API-->>UI: HTTP 200 OK (session_id, token_format)
    
    par Dual Token Display
        UI->>Screen: Open Projector Mode (/qr?sessionId=...)
        Screen->>API: GET /api/v1/teacher/sessions/{id}/broadcast-token
        API->>API: Generate Dual Dynamic QR (HMAC-SHA256 Token + Short Code)
        API-->>Screen: Rotating Token (TTL: 15-30 seconds)
        Screen->>Screen: Render High-Contrast SVG QR (ECC Level L, Edge-to-Edge)
    end
```

* **Dynamic Rotating QR Code**: To prevent students from photographing the screen and forwarding it over WhatsApp/Telegram, the QR payload rotates every 15 to 30 seconds.
* **Payload Structure (v2)**:
  ```json
  {
    "v": 2,
    "qr_type": "attendance",
    "token": "eyJhbGciOi...",
    "session_id": 482,
    "exp": 1727400630,
    "issued_at": 1727400600
  }
  ```
* **Fallback Short Codes**: For students seated at the far back of large lecture halls (beyond 8 meters) where high-density QR modules cannot be optical resolved, the screen simultaneously renders a 6-character rotating alphanumeric code (`qr_short_tokens`).

---

### Phase 5: Student QR Attendance Scanning Pipeline

The student scanner operates as an explicit Finite State Machine (FSM) implemented in `frontend/src/features/scanner/`:

```mermaid
stateDiagram-v2
    [*] --> IDLE
    IDLE --> SCANNING : User clicks "Scan Attendance"
    SCANNING --> LINK_CHECK : Decoded valid QR format
    SCANNING --> ERROR : Camera stream failure
    
    LINK_CHECK --> ENROLLING : Device has legacy / no binding
    LINK_CHECK --> SUBMITTING : Device binding is ACTIVE
    
    ENROLLING --> OTP_VERIFY : Enrollment ticket received
    OTP_VERIFY --> SUBMITTING : OTP verified & key generated (Auto-Resume <= 30s)
    
    SUBMITTING --> SUCCESS : Backend commits scan (HTTP 200)
    SUBMITTING --> ERROR : Terminal failure / Double timeout
    
    ERROR --> SCANNING : Primary Action (Rescan / Retry)
    ERROR --> IDLE : Secondary Action (Dismiss)
    SUCCESS --> [*]
```

#### Detailed Submission Execution Pipeline:
1. **Camera Stream Acquisition**:
   - Mobile rear camera strictly targeted via `facingMode: { exact: 'environment' }`. If the device raises `OverconstrainedError` (e.g. desktop webcam or dual-sensor glitch), it gracefully falls back to `facingMode: 'environment'`.
   - The `MediaStream` instance is maintained as a session-level singleton to avoid expensive re-initializations during sheet expansion.
2. **High-Speed Frame Decoding**:
   - Frames are decoded via `BarcodeDetector` (hardware-accelerated WebAssembly ZXing engine) with fallback to `jsQR`.
3. **Client-Side Pre-Validation**:
   - Parses payload: checks `v === 2` and `qr_type === 'attendance'`.
   - Checks clock skew: verifies `payload.exp + 30 >= now_seconds`. If expired, transitions immediately to `SCAN_FAILED` with error `qr_expired` without wasting a network round-trip.
4. **Cryptographic Signing (V2)**:
   - Retrieves the student's private key reference from IndexedDB (`WebCrypto`).
   - Signs the canonical digest: `sha256(student_id + session_id + timestamp + token)`.
5. **Staged Network Submission (`SCAN_SUBMIT_TIMEOUT_MS = 8000`)**:
   - UI displays live progress: `validating_token` $\to$ `signing` $\to$ `submitting` $\to$ `confirming`.
   - Dispatches `POST /api/v1/student/scan-session` with `Idempotency-Key` header.
6. **Silent Timeout Retry (Exactly 1)**:
   - If the first request times out at 8.0s, the client automatically dispatches exactly one silent retry with the identical `Idempotency-Key` and a fresh 8.0s budget.
   - If the second attempt fails, it transitions to the mapped actionable error card `client_abort`.
7. **Post-Enrollment Auto-Resume**:
   - If the student was unlinked and had to complete inline enrollment, the scanned QR payload is cached in `sessionStorage`.
   - Once enrollment succeeds, if the cached payload is $\le 30\text{s}$ old and unexpired, the hook **automatically resumes and submits** the attendance without forcing the student to re-aim at the screen!

---

### Phase 6: Verification, Ingestion Pipeline & Job Polling (Backend)

The backend verification pipeline in `backend/app/services/attendance_pipeline/` processes scans through four sequential gatekeepers:

```mermaid
flowchart TD
    REQ[Incoming Scan Request] --> G1[1. ScanTokenVerifier]
    G1 -->|Valid QR Signature & Slot| G2[2. GeofenceValidator]
    G1 -->|Invalid or Stale| E422[HTTP 422 qr_type_invalid / qr_expired]
    
    G2 -->|Within 100m Classroom Radius| G3[3. SessionEnrollmentValidator]
    G2 -->|Outside Radius| E403G[HTTP 403 geofence_violation]
    
    G3 -->|Enrolled in Section| G4[4. DeviceBindingValidator]
    G3 -->|Not Enrolled| E403E[HTTP 403 not_enrolled_in_section]
    
    G4 -->|V2 Signature Valid| REC[Attendance Recorder]
    G4 -->|Legacy During Grace| E409[HTTP 409 binding_upgrade_required]
    G4 -->|Legacy Post Grace| E410[HTTP 410 binding_revoked_post_grace]
    
    REC --> FUT{In-Memory Future Waiter}
    FUT -->|Committed <= 2.0s| R200[HTTP 200 OK attendance_confirmed]
    FUT -->|Writer Timeout > 2.0s| R202[HTTP 202 Accepted Job Polling URL]
```

1. **ScanTokenVerifier**: Verifies token cryptographic authenticity, session ID validity, and session status (`OPEN`). Rejects expired slots.
2. **GeofenceValidator**: Calculates the Haversine distance between student mobile GPS coordinates and the faculty's session coordinates. Asserts distance $\le \text{geofence\_radius\_m}$ (default: 100 meters).
3. **SessionEnrollmentValidator**: Asserts that the student's `section_id` matches the session's assigned section.
4. **DeviceBindingValidator**: Verifies the ECDSA P-256 signature against the student's registered public key.
5. **AttendanceRecorder & Threadsafe Future Waiter**:
   - The ingestion handler registers an `asyncio.Future` in `_job_waiters[job_id]`.
   - The asynchronous background database commit thread calls `loop.call_soon_threadsafe(fut.set_result, record_data)`.
   - If committed within 2.0 seconds, the client receives immediate HTTP 200.
   - If the database is experiencing write-lock contention, it returns HTTP 202 with `poll_url: "/api/v1/attendance/job/{job_id}"`. The client polls this endpoint every 500ms (up to 5 times) to obtain confirmation without retrying the scan.

---

### Phase 7: Multi-Target Synchronization & Academic Exports
When the faculty member clicks **"Lock Attendance Session"** (`POST /api/v1/attendance/lock-session`), the session status changes from `OPEN` to `LOCKED`. This triggers synchronous database finalization and dispatches three parallel background tasks:

1. **Frappe ERP Synchronization (`snist_erp`)**:
   - Authenticates against Frappe REST API.
   - Creates a parent `SNIST Attendance Session` record.
   - Appends child `Student Attendance` records with validated SAP IDs.
2. **Master Google Sheets Sync (`GSheetsService`)**:
   - Connects using service account credentials (`credentials.json`).
   - Appends/updates the master institutional spreadsheet matrix, mapping periods 1 through 8.
3. **Dedicated Excel Registers (`ExcelService`)**:
   - Updates the faculty member's pre-generated class register file (`.xlsx`) on server storage, recalculating cumulative present/absent counts for each student.

---

### Phase 8: Governance, JNTUH Compliance & Security Forensics
1. **JNTUH R25 Compliance Engine (`compliance_analytics.py`, `defaulters.py`)**:
   - Calculates real-time aggregate attendance percentages per student across subjects:
     $$\text{Attendance \%} = \frac{\text{Total Periods Attended} + \text{Approved Absences}}{\text{Total Sessions Conducted}} \times 100$$
   - **Compliance Bands**:
     - $\ge 75.0\%$: **Eligible** (Green). Free to take semester examinations.
     - $65.0\% - 74.9\%$: **Condonable** (Amber). Requires medical condonation fee & approved absence records.
     - $< 65.0\%$: **Detained / Defaulter** (Red). Disqualified from semester exams.
2. **Audit Logs & Security Alerts (`security_alert_service.py`)**:
   - All critical actions (account switches, concurrent scan attempts, device unbinds, manual mark overrides) generate an `AuditLog` and a `SecurityAlert`.
   - **Layer 2 Security Digest Scheduler**: A background asyncio task evaluates system health every 60 seconds. At the top of each hour (minute 0), it aggregates alerts and emails a security digest to institutional administrators.

---

## 4. Backend Architectural Map & Service Directory

All backend code resides in `backend/app/`.

### API Routers (`backend/app/api/`)
| Router Module | Route Prefix | Primary Responsibilities |
| :--- | :--- | :--- |
| [`auth.py`](file:///c:/Users/bhask/Desktop/att2/backend/app/api/auth.py) | `/api/v1/auth` | Login, password change, JWT issuance, brute-force lockout, current user extraction (`/me`). |
| [`student.py`](file:///c:/Users/bhask/Desktop/att2/backend/app/api/student.py) | `/api/v1/student` | Student scan ingestion (`/scan-session`), student profile, attendance summary, rotating student QR. |
| [`teacher.py`](file:///c:/Users/bhask/Desktop/att2/backend/app/api/teacher.py) | `/api/v1/teacher` | Start/stop sessions, broadcast rotating QR tokens, historical sessions list, assigned classes. |
| [`attendance.py`](file:///c:/Users/bhask/Desktop/att2/backend/app/api/attendance.py) | `/api/v1/attendance` | Attendance records queries, lock session, job status polling (`/job/{job_id}`), selfie storage. |
| [`binding.py`](file:///c:/Users/bhask/Desktop/att2/backend/app/api/binding.py) | `/api/v1/binding` | WebCrypto enrollment (`/enroll`), status verification, rebind requests, OTP challenges. |
| [`devices.py`](file:///c:/Users/bhask/Desktop/att2/backend/app/api/devices.py) | `/api/v1/devices` | 30-min device-to-student lockout checks, device unbinds, reset self-service caps. |
| [`admin.py`](file:///c:/Users/bhask/Desktop/att2/backend/app/api/admin.py) | `/api/v1/admin` | Roster management (students, faculty, departments, sections, subjects), dashboard stats, audit logs. |
| [`admin_onboarding.py`](file:///c:/Users/bhask/Desktop/att2/backend/app/api/admin_onboarding.py) | `/api/v1/admin/onboard` | Batch dispatching onboarding links, checking onboarding status, resending/revoking tokens. |
| [`admin_credentials.py`](file:///c:/Users/bhask/Desktop/att2/backend/app/api/admin_credentials.py) | `/api/v1/admin/credentials` | Bulk credential dispatch via institutional email templates. |
| [`reports.py`](file:///c:/Users/bhask/Desktop/att2/backend/app/api/reports.py) | `/api/v1/reports` | Low-attendance registers, daily grid matrix, CSV/Excel report exports. |
| [`compliance_analytics.py`](file:///c:/Users/bhask/Desktop/att2/backend/app/api/compliance_analytics.py) | `/api/v1/compliance` | JNTUH R25 condonable bands, eligibility summaries, condonation approvals. |
| [`defaulters.py`](file:///c:/Users/bhask/Desktop/att2/backend/app/api/defaulters.py) | `/api/v1/admin/defaulters` | Defaulter list queries, threshold overrides, notification triggers. |
| [`launch.py`](file:///c:/Users/bhask/Desktop/att2/backend/app/api/launch.py) | `/api/v1/launch` | Universal launch token validation and attendance entry (`/a/:launchToken`). |
| [`telemetry.py`](file:///c:/Users/bhask/Desktop/att2/backend/app/api/telemetry.py) | `/api/v1/telemetry` | PWA client scan telemetry events, decode latency histograms, scanner health rollups. |

### Core Business Services (`backend/app/services/`)
* [`email_service.py`](file:///c:/Users/bhask/Desktop/att2/backend/app/services/email_service.py): Institutional email resolution (`<roll>@cse.sreenidhi.edu.in`), banned recipient literals guard, Jinja2 template dry-rendering, exponential backoff with jitter, delivery logging.
* [`attendance_pipeline/`](file:///c:/Users/bhask/Desktop/att2/backend/app/services/attendance_pipeline/): Modular 4-stage scan validation and asynchronous recording engine.
* [`selfie_service.py`](file:///c:/Users/bhask/Desktop/att2/backend/app/services/selfie_service.py): Base64 selfie decode, disk storage under `uploads/selfies/`, facial verification dispatch, and `selfie_records` transactional updates.
* [`gsheets_service.py`](file:///c:/Users/bhask/Desktop/att2/backend/app/services/gsheets_service.py): Google Sheets v4 API client managing classroom spreadsheet grids and synchronization.
* [`excel_service.py`](file:///c:/Users/bhask/Desktop/att2/backend/app/services/excel_service.py): OpenPyXL generator producing official SNIST attendance registers.
* [`security_alert_service.py`](file:///c:/Users/bhask/Desktop/att2/backend/app/services/security_alert_service.py): Security event dispatcher, threshold evaluator, and Layer 2 hourly security digest scheduler.

---

## 5. Frontend PWA Architectural Map & Component Directory

All frontend code resides in `frontend/src/`.

### Core Application Entry Points
* [`main.tsx`](file:///c:/Users/bhask/Desktop/att2/frontend/src/main.tsx): Mounts the React application DOM root, initializes PWA service worker registration, and injects circular telemetry dependencies via IoC.
* [`App.tsx`](file:///c:/Users/bhask/Desktop/att2/frontend/src/App.tsx): Root routing provider (`react-router-dom`) declaring authenticated and public routes wrapped with `AuthContext` and React Query providers.

### Primary Pages (`frontend/src/pages/`)
* [`TeacherDashboard.tsx`](file:///c:/Users/bhask/Desktop/att2/frontend/src/pages/TeacherDashboard.tsx): The central faculty portal. Contains timetable calendars (Day View, List View), class cards, start/lock session controls, live scanned student lists, and manual attendance marking modals.
* [`StudentPortal.tsx`](file:///c:/Users/bhask/Desktop/att2/frontend/src/pages/StudentPortal.tsx): The student landing portal. Shows aggregate attendance percentages, today's schedule, attendance history, and the primary "Scan Attendance" launcher button.
* [`PublicQrDisplay.tsx`](file:///c:/Users/bhask/Desktop/att2/frontend/src/pages/PublicQrDisplay.tsx): Standalone classroom projector surface (`/qr`). Renders edge-to-edge, ultra-high-contrast dynamic QR codes that rotate every 15-30 seconds with heartbeat synchronization.
* [`AttendanceLanding.tsx`](file:///c:/Users/bhask/Desktop/att2/frontend/src/pages/AttendanceLanding.tsx): Universal launch token handler (`/a/:launchToken`).
* [`OnboardingWizard.tsx`](file:///c:/Users/bhask/Desktop/att2/frontend/src/pages/OnboardingWizard.tsx): Guided student activation workflow for password creation and WebCrypto device binding.
* [`QrSizeTest.tsx`](file:///c:/Users/bhask/Desktop/att2/frontend/src/pages/QrSizeTest.tsx): Classroom optical calibration tool to test QR decodability from different classroom distances.

### Scanner Feature Architecture (`frontend/src/features/scanner/`)
* [`state/scannerFSM.ts`](file:///c:/Users/bhask/Desktop/att2/frontend/src/features/scanner/state/scannerFSM.ts): The canonical Finite State Machine reducer governing scanner state transitions, single-flight action guards, and Section 3.1 error code mapping.
* [`hooks/useAttendanceSubmission.ts`](file:///c:/Users/bhask/Desktop/att2/frontend/src/features/scanner/hooks/useAttendanceSubmission.ts): The central orchestration hook. Handles QR pre-validation, staged submission progress, silent timeout retry, job polling, and post-enrollment zero-rescan payload replay.
* [`hooks/useCameraStream.ts`](file:///c:/Users/bhask/Desktop/att2/frontend/src/features/scanner/hooks/useCameraStream.ts): MediaStream singleton manager enforcing rear camera locking (`exact: 'environment'`) with fallback.
* [`components/ScannerFeedbackOverlay.tsx`](file:///c:/Users/bhask/Desktop/att2/frontend/src/features/scanner/components/ScannerFeedbackOverlay.tsx): Renders staged progress and all Section 3.1 actionable error cards in a permanently reserved slot.
* [`components/ScannerControlsBar.tsx`](file:///c:/Users/bhask/Desktop/att2/frontend/src/features/scanner/components/ScannerControlsBar.tsx): Scanner action controls (torch toggle, camera flip, close). Automatically disables camera flip during submission/enrollment to prevent stream race conditions.

---

## 6. Data Model & Relational Schema Directory

Located in `backend/app/models/models.py`.

```mermaid
erDiagram
    User ||--o| Teacher : "teacher_profile"
    User ||--o| Student : "student_profile"
    Department ||--o{ Student : "students"
    Department ||--o{ Section : "sections"
    AcademicYear ||--o{ Section : "sections"
    Section ||--o{ Student : "students"
    Section ||--o{ TeacherAssignment : "assignments"
    Subject ||--o{ TeacherAssignment : "assignments"
    Teacher ||--o{ TeacherAssignment : "assignments"
    Teacher ||--o{ AttendanceSession : "sessions"
    AttendanceSession ||--o{ AttendanceRecord : "records"
    Student ||--o{ AttendanceRecord : "attendance_records"
    AttendanceRecord ||--o| SelfieRecord : "selfie"
    Student ||--o{ DeviceBinding : "device_bindings"
    Student ||--o{ EnrollmentTicket : "enrollment_tickets"
```

### Key Tables & Column Specifications
1. **`qr_users` (`User`)**:
   - `id`: Integer Primary Key.
   - `username`: Unique institutional ID (Roll Number for students, Faculty Code for teachers).
   - `email`: Institutional email address.
   - `password_hash`: Bcrypt hashed password.
   - `role`: Enum (`SUPER_ADMIN`, `TEACHER`, `STUDENT`).
   - `must_change_password`: Boolean. Enforced on first login after credential dispatch.
2. **`qr_students` (`Student`)**:
   - `id`: Integer Primary Key.
   - `roll_number`: Unique institutional Roll Number (e.g. `23311A0504`).
   - `name`: Full student name.
   - `department_id`, `academic_year_id`, `section_id`: Foreign keys structuring institutional hierarchy.
3. **`qr_attendance_sessions` (`AttendanceSession`)**:
   - `id`: Integer Primary Key.
   - `teacher_id`, `section_id`, `subject_id`: Session context.
   - `period`: Period label (e.g. "Period 3").
   - `date`: Session date (`YYYY-MM-DD`).
   - `status`: Enum (`OPEN`, `LOCKED`).
   - `faculty_latitude`, `faculty_longitude`, `geofence_radius_m`: Classroom GPS boundary.
   - `display_type`: Display target (`projector`, `laptop`).
4. **`qr_attendance_records` (`AttendanceRecord`)**:
   - `id`: Integer Primary Key.
   - `attendance_id`: Unique integer attendance identifier.
   - `session_id`, `student_id`: Session and student references.
   - `status`: Enum (`PRESENT`, `ABSENT`, `LATE`).
   - `idempotency_key`: Unique string (`<device_uuid>:<token_prefix>`) preventing duplicates.
   - `entry_method`: Mark source (`QR_SCAN`, `MANUAL_TEACHER`, `OFFLINE_SYNC`).
   - `student_latitude`, `student_longitude`, `distance_m`: Geolocation audit data.
   - `is_approved_absence`, `approved_absence_reason`: JNTUH condonation data.
5. **`device_bindings` (`DeviceBinding`)**:
   - `id`: Integer Primary Key.
   - `student_id`: Student reference.
   - `device_id`: Client-generated stable device UUID.
   - `public_key`: Base64 / SPKI encoded ECDSA P-256 public key.
   - `key_algorithm`: Default `ECDSA_P256`.
   - `status`: Enum (`ACTIVE`, `EXPIRED`, `REVOKED`, `LOCKED`).
6. **`qr_otp_delivery_log` (`QrOtpDeliveryLog`)**:
   - `id`: Integer Primary Key.
   - `student_id`: Student reference.
   - `recipient_email`: Destination email address.
   - `status`: Enum (`SENT`, `FAILED`, `COOLDOWN_REJECTED`).
   - `attempts`: Retry count (1-3).
   - `created_at`: IST timestamp.

---

## 7. Error Handling Taxonomy & Recovery Protocols (Section 3.1)

The system maps all failure conditions to the Section 3.1 standardized taxonomy:

| Error Code | HTTP Status | User-Facing Explanation | Primary Action | Secondary Action |
| :--- | :--- | :--- | :--- | :--- |
| `client_abort` | N/A (Client) | Submission timed out after silent retry. Network may be congested. | **Retry Submit** (re-sends identical idempotency payload) | **Cancel** |
| `server_token_expired`| 401 | Server session expired. Refreshing token budget. | **Re-authenticate** | **Close** |
| `binding_upgrade_required` | 409 | Legacy device detected. Quick 30s inline cryptographic upgrade required. | **Upgrade Device** (launches inline enrollment) | **Cancel** |
| `binding_revoked_post_grace`| 410 | Legacy transition grace period has ended. Contact department admin. | **Contact Admin** | **Dismiss** |
| `qr_type_invalid` | 422 | The scanned QR code is not a valid SNIST classroom attendance token. | **Rescan Projector** | **Dismiss** |
| `qr_expired` | 422 | Scanned QR code has expired. The projector rotates every 15-30s. | **Scan Fresh QR** | **Dismiss** |
| `session_not_active` | 400 | This attendance session has already been locked by the faculty member. | **View Records** | **Dismiss** |
| `otp_cooldown` | 429 | OTP already sent. Please check your inbox or wait 60s before resending. | **Wait & Retry** | **Dismiss** |
| `otp_delivery_failed` | 502 | Could not deliver OTP to institutional email. Transient mail error. | **Resend OTP** | **Contact Support** |
| `selfie_store_failed` | 500 | Attendance marked, but verification selfie failed to store. | **Retake Selfie** | **Skip Verification** |
| `network_error` | N/A (Client) | Unable to reach SNIST attendance servers. Check Wi-Fi / cellular data. | **Retry Network** | **Save Offline** |
| `camera_error` | N/A (Client) | Unable to access mobile camera. Camera may be blocked or in use. | **Grant Permission** | **Close Scanner** |

---

## 8. Configuration & Environment Matrix

Key configuration settings managed in `backend/app/core/config.py` and `.env`:

```ini
# --- Core Application ---
PROJECT_NAME="SNIST ERP Attendance System"
VERSION="2.0.0"
ENVIRONMENT="development"  # "production" | "development"
API_V1_STR="/api/v1"
DATABASE_URL="mysql+pymysql://user:password@localhost:3306/snist_attendance"

# --- Security & Auth ---
SECRET_KEY="<cryptographic-secret-key>"
ACCESS_TOKEN_EXPIRE_MINUTES=480  # 8 hours for academic day
ALGORITHM="HS256"

# --- Device Binding V2 (INV-1 & INV-7) ---
BINDING_V2=true  # When true, cryptographic ECDSA signatures enforced
LEGACY_BINDING_GRACE_UNTIL="2026-12-31T23:59:59Z"  # Grace cutoff boundary
OTP_RESEND_COOLDOWN_SECONDS=60  # Cooldown rate-limit window

# --- QR Generation & Scanner Engine ---
QR_TOKEN_FORMAT="dual"  # "dual" | "short" | "legacy"
QR_RENDER_VERSION="v2"  # High-contrast edge-to-edge rendering
QR_ECC_LEVEL="L"        # Low ECC for maximum optical scanning speed
SCANNER_ENGINE="wasm"   # "wasm" (ZXing WebAssembly) | "jsqr"

# --- JNTUH R25 Compliance Rules ---
JNTUH_ELIGIBLE_THRESHOLD=75.0
JNTUH_CONDONABLE_THRESHOLD=65.0
JNTUH_INCLUDE_APPROVED_ABSENCES=true
DEFAULT_SEMESTER_SESSIONS=60

# --- Geofence Configuration ---
DEFAULT_GEOFENCE_RADIUS_M=100.0  # 100 meter classroom boundary

# --- Background Schedulers ---
SECURITY_DIGEST_ENABLED=true  # Hourly security summary email dispatcher
```

---

## 9. Verification & Automated Test Suite Index

When verifying or modifying code within this application, execute the following test suites to guarantee 100% compliance:

```bash
# 1. Backend Verification Suite (FastAPI + SQLAlchemy)
pytest tests/test_binding_phase4_scan.py tests/test_fix2_fix3_concurrency.py tests/test_fix5_otp_routing.py

# 2. Frontend Unit & FSM State Suite (Vitest)
npx vitest run src/features/scanner/__tests__/scannerFSM.test.ts

# 3. Circular Dependency Architectural Gate (Madge)
npx madge --circular --extensions "ts,tsx" src

# 4. Production TypeScript Compilation & Vite PWA Build
npm run build
```

---
*End of Feature & Function Specification. Canonical documentation maintained for SNIST ERP AI.*
