# 🛡️ ProxPresence — Multi-Tier Attendance PWA

**ProxPresence** is a production-grade, multi-tier student attendance system engineered for high-density college campuses. It combines Web Bluetooth (BLE) proximity detection, HMAC-signed TOTP-style rotating codes, and server-authoritative security invariants to validate 100+ students concurrently in seconds, eliminating scan queues and preventing attendance fraud.

---

## 🏗️ System Architecture & Tech Stack

```
                        ┌─────────────────────────────────────────────────────────┐
                        │                ProxPresence Architecture                │
                        └─────────────────────────────────────────────────────────┘

        [ Student Devices (PWA) ]                          [ Faculty Device / Projector ]
      (iOS WebKit / Android Chrome)                             (Faculty HUD Dashboard)
                   │                                                        │
         1. Proximity BLE Scan                                   1. Start Open Session
         2. Auto-fallback to Code                                2. Broadcast Room Beacon
         3. See Faculty Manual                                   3. Display 4-Char Rotating Code
                   │                                             4. One-Tap Kill Switch
                   ▼                                                        │
      ┌─────────────────────────┐                                           │
      │    FastAPI Gateway      │◄──────────────────────────────────────────┘
      │  (/attendance/mark, etc)│
      └────────────┬────────────┘
                   │
                   ▼  (DB write only < 20ms)
      ┌─────────────────────────┐
      │  PostgreSQL / MySQL DB  │ ◄── Device Binding (30-min Lock)
      │  (SQLAlchemy 2.0 Engine)│ ◄── Audit Reviews Queue
      └────────────┬────────────┘ ◄── Rotating Codes (SHA-256 Hashes)
                   │
                   ▼  (Background Task upon Session Finalize ONLY)
      ┌─────────────────────────────────────────────────────────┐
      │          Sheets Batch Worker + Exponential Backoff       │
      │           (1 Batch Update at Close + DLQ Logging)       │
      └────────────────────────────┬────────────────────────────┘
                                   ▼
                      [ Google Sheets API v2 ]
```

### **Backend**
- **Runtime**: Python 3.11+
- **API Framework**: FastAPI with Pydantic v2 validation and type hints
- **ORM & Database**: SQLAlchemy 2.0, supporting PostgreSQL, MySQL (`pymysql`), and SQLite
- **Database Migrations**: Alembic (`alembic upgrade head`)
- **Security & Cryptography**: HMAC-SHA256 rotating codes, SHA-256 code hashing, 30-min device-to-student bindings, server-authoritative IST time
- **Rate-Limit Resilient Sync**: Single batchUpdate Google Sheets API worker triggered strictly on session finalize, with exponential backoff (3 retries: 1s, 2s, 4s) and `sheets_sync_dlq` dead-letter queue

### **Frontend**
- **Application**: React 18 + TypeScript + Vite Progressive Web App (PWA)
- **Offline & Caching**: Service Worker (`dist/sw.js`), Workbox caching
- **Admin**: Faculty HUD Dashboard with Projector Mode, SVG countdown ring, live breakdown counters, audit queue resolution, and reconciliation modal
- **Student Flow**: One-tap attendance, pre-permission instructional modal, WebKit/iOS Bluetooth auto-detection with silent Tier 2 fallback, and friendly 403 device-lock copy

---

## 🗄️ Core Domain Models

| Model Table | Primary Attributes | Constraints & Purpose |
|---|---|---|
| `students` (`qr_students`) | `id`, `roll_no`, `section`, `name`, `device_hash` | Canonical institutional roster; unique roll numbers |
| `sessions` (`qr_attendance_sessions`) | `id`, `faculty_id`, `room_id`, `section`, `starts_at`, `locks_at`, `status`, `kill_switch_active` | Class lecture session tracking and lifecycle |
| `qr_attendance_records` | `id`, `session_id`, `student_id`, `method (ble\|code\|manual)`, `rssi`, `geo_accuracy_m`, `marked_at` | Unique `(session_id, student_id)` — strictly idempotent |
| `qr_attendance_audit_reviews` | `id`, `session_id`, `student_id`, `record_id`, `flag (rssi_borderline\|geo_coarse\|manual)`, `resolved_by` | Audit log for edge signals flagged for teacher review |
| `device_bindings` | `id`, `device_hash`, `student_id`, `bound_at`, `expires_at` | 30-minute lock per session (`1 Device ↔ 1 Student`) |
| `rotating_codes` | `id`, `session_id`, `code_hash`, `generated_at`, `valid_until` | TOTP-style 4-char codes (SHA-256 hash stored, never plaintext) |
| `sheets_sync_dlq` | `id`, `session_id`, `spreadsheet_id`, `payload_json`, `retry_count`, `error_message`, `status` | Dead-letter queue capturing failed finalize syncs |

---

## 📡 Tiered Attendance Pipeline

Every tier has an automated, fail-safe degradation chain:

```
  Tier 1 (BLE Proximity)
    │  Web Bluetooth scan of room beacon
    │  - RSSI ≥ -85 dBm: Accepted immediately
    │  - -75 dBm to -85 dBm: Accepted, flagged to audit_reviews ('rssi_borderline')
    │  - RSSI < -85 dBm: Rejected with distance guidance
    │
    ▼ (Fallback if Bluetooth off, denied, or WebKit/iOS without Web Bluetooth)
  Tier 2 (Rotating Code)
    │  4-character unambiguous uppercase code (no 0, 1, I, O)
    │  - 15-second rotation period (HMAC-SHA256 TOTP-style)
    │  - Server grace window: ±30s tolerance (tolerance_windows = 2)
    │  - t-14s, t-15s, t-16s pass; t-31s strictly rejected
    │
    ▼ (Fallback if student lacks device or code expired)
  Tier 3 (Faculty Manual Search)
       Faculty HUD one-tap check-in; always available; always logged as 'manual'
```

> **iOS / WebKit Notice**: Since iOS Safari does not natively support Web Bluetooth, the Student PWA automatically inspects `navigator.bluetooth`. On iOS/WebKit devices, it silently skips Tier 1 and immediately presents Tier 2 (Rotating Code) with clear, friendly instruction copy.

---

## 🔒 5 Non-Negotiable Security Invariants

Enforced in `backend/app/core/security.py` and `backend/app/api/prox_presence.py`:

1. **Geofence Coarse Gate**: `radius = geofence_radius_meters + 25m tolerance`. Used solely as a campus/building filter; never as room-level proof. Denied location permission defaults to coarse fallback with an audit flag (`geo_coarse`), never crashing or rejecting the student.
2. **Section Match**: `student.section == session.section`. Rejects students from other classes with HTTP 403.
3. **Device Binding (30-Min Lock)**: One `device_hash` is bound to exactly one student per 30-minute session window. Account switching or buddy check-in on the same phone returns a friendly HTTP 403:  
   *"Security Lock: one phone per student per 30-minute session. Please see faculty for manual check-in."*
4. **Rotating Code HMAC Verifier**: Codes are computed dynamically as `HMAC-SHA256(server_secret, session_id + time_bucket)` and verified with SHA-256 hashes. Codes and session secrets are **never** stored in plaintext.
5. **Fast Attendance Write (< 20ms DB Write Only)**: Attendance writes strictly persist to the local database and return HTTP 200 to students in milliseconds. Google Sheets sync is **never** invoked per-scan.

---

## ⚡ Rate-Limit Hardening: Batch-Only Sheets Sync

Google Sheets API v4 enforces strict project read/write quotas (60 requests/minute). ProxPresence protects this boundary:

1. **`sheets_sync_mode = "session_finalize"`**: Zero API calls during student scanning.
2. **Single `batchUpdate`**: All student rows for the session are aggregated into one single API request when the faculty presses **Finalize Session**.
3. **Exponential Backoff**: If Google Sheets is temporarily down (HTTP 503/429), the worker automatically retries up to 3 times with exponential backoff (1s, 2s, 4s).
4. **Dead-Letter Queue (`sheets_sync_dlq`)**: If all 3 retries fail, the entire payload is preserved in `sheets_sync_dlq` with status `FAILED` for administrative replay, preventing data loss.

---

## 🖥️ Faculty HUD Dashboard

Accessible from the Teacher portal:

- **Projector Mode**: One-tap toggle that maximizes the 4-character rotating code in large, high-contrast, room-readable typography.
- **SVG Countdown Ring**: Circular visual countdown animating the 15-second code expiration.
- **Pre-Flight Checklist**: Real-time status indicators for:
  - 🟢 Server Health (`/health` API responsive)
  - 🟢 Beacon Advertising (Room Bluetooth beacon active)
  - 🟢 Manual Mode Armed (Faculty search ready as backup)
- **One-Tap Kill Switch**: If classroom error rate exceeds 10% or RF interference occurs, faculty can activate the emergency Kill Switch to switch the room to manual check-in mode immediately.
- **Live Telemetry Counters**: Real-time breakdown of `BLE`, `Code`, and `Manual` check-ins, error rate %, and pending audit review count.
- **Audit Review Queue**: Displays borderline RSSI or coarse GPS flags with one-tap `Resolve` action.
- **Finalize Session & Reconciliation Modal**: Locks the session, fires the background Google Sheets batch update, and displays an immediate reconciliation report (Total DB Records vs. Sheets Rows vs. Flagged Audit Count) before closing.

---

## 📲 Student PWA Experience

- **One-Tap "Proximity Attendance"**: Quick primary action on the student home screen.
- **Pre-Permission Guidance**: Friendly modal preparing the student before the browser requests location and Bluetooth permissions.
- **Auto-Detection**: Seamlessly detects Web Bluetooth support and transitions to the 4-character code entry when on iOS WebKit.
- **Graceful Error Handling**: If geolocation is denied by the student, the system accepts the check-in and logs a `geo_coarse` audit flag rather than rejecting the student.
- **Security Lock Copy**: Friendly, clear messaging when device-binding lockout triggers.

---

## 🚀 Deployment Guide

### 1. Prerequisites
- Python 3.11+
- Node.js 18+ and npm
- MySQL / PostgreSQL / SQLite

### 2. Backend Installation
```bash
# Clone and enter workspace
git clone https://github.com/your-org/proxpresence.git
cd proxpresence/backend

# Create virtual environment
python -m venv .venv
.venv\Scripts\activate       # On Linux/macOS: source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### 3. Database Setup & Alembic Migrations
```bash
# Apply Alembic schema migrations
alembic upgrade head

# Seed 100 students (CSE-A), 2 pilot classrooms, and faculty credentials
python scripts/seed_prox_presence.py
```

### 4. Frontend PWA Build
```bash
cd ../frontend
npm install
npm run build
```
This builds the production SPA into `frontend/dist/` with the Service Worker (`dist/sw.js`).

### 5. Running the Application
```bash
# From workspace root
cd backend
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```
The FastAPI backend serves the REST API, handles root endpoints (`/session/start`, `/attendance/mark`, `/health`), and mounts the production PWA frontend at `http://localhost:8000`.

---

## 🧪 Automated Testing & Verification

The test suite enforces 100% clean test passes:

```bash
# Run complete test suite (71 passing tests)
python -m pytest backend/tests/

# Run ProxPresence API unit tests (13 tests)
python -m pytest backend/tests/test_prox_presence_api.py

# Run Rotating Code edge tests (t-14s, t-15s, t-16s pass; t-31s fails)
python -m pytest backend/tests/test_code_rotation.py
```

### Running the 100-Student Concurrency Load Test
```bash
# Standalone automated load test (100 concurrent marks in < 2 seconds)
python backend/tests/locustfile.py

# Or via Locust CLI against live server
locust -f backend/tests/locustfile.py --headless -u 100 -r 10 -t 10s --host http://localhost:8000
```

**Load Test Telemetry Output:**
```
======================================================================
ProxPresence Concurrency Load Test: 100 Students in <= 10.0s
======================================================================
Total Requests Executed:    100
Wall-Clock Duration:        1.602s (Budget: <= 10.0s)
HTTP 200 OK:                100/100
HTTP 429 Rate-Limits:       0 (Zero Invariant)
Failed Responses:           0 (Zero Invariant)
DB Records Persisted:       102 (All >= 100)
Average Request Latency:    151.87ms
>>> SUCCESS: All 100 Concurrent Marks Invariants Satisfied <<<
```

---

## 📋 Faculty Dry-Run Checklist

Follow this checklist before and during each class session:

### 1. Pre-Flight Verification (5 Minutes Before Class)
- [ ] Log in to Faculty HUD at `http://localhost:8000` (Credentials: `faculty1` / `faculty123`).
- [ ] Confirm Pre-Flight Checklist in HUD shows:
  - 🟢 **Server Health**: Online (green indicator)
  - 🟢 **Beacon Advertising**: Broadcasting room beacon (e.g. `ROOM-304-BLOCK-B`)
  - 🟢 **Manual Mode**: Armed & ready for search
- [ ] Select Subject, Section (`CSE-A`), and Period (1-8).
- [ ] Click **Start Attendance Session**.

### 2. Classroom Display & Projection
- [ ] Switch projector display to the Faculty HUD window.
- [ ] Click **Projector Mode** in the HUD toolbar to enlarge the rotating code.
- [ ] Verify the SVG circular countdown ring is smoothly ticking down every 15 seconds.
- [ ] Announce to students: *"Open ProxPresence on your phone and tap Proximity Attendance."*

### 3. Student Ingestion & Live Monitoring
- [ ] Monitor HUD live counters:
  - Watch `BLE Check-ins` and `Code Check-ins` increment in real time.
  - Verify `Error Rate %` remains below 5%.
- [ ] **Bluetooth Issues**: If a student cannot connect via Bluetooth (e.g. iPhone WebKit or disabled radio), instruct them to enter the 4-digit code shown on the projector screen.
- [ ] **Device Lock Issues**: If a student sees *"Security Lock: one phone per student..."*, they are using a phone already used by a classmate. Use HUD **Manual Search** to mark them.
- [ ] **Audit Queue**: Review any borderline RSSI entries in the HUD Audit Queue and tap **Approve** or **Clear**.

### 4. Emergency Kill Switch (If Needed)
- [ ] If wireless interference exceeds 10% error rate, tap **Kill Switch (Manual Only)** in the HUD.
- [ ] The room immediately switches to manual check-in mode. All students are directed to check in at the podium.

### 5. Session Finalization & Sync
- [ ] Once all students are checked in, click **Finalize Session**.
- [ ] Confirm the prompt to lock the session.
- [ ] Verify the **Reconciliation Report Modal**:
  - `Total Marked in DB`: matches head count
  - `Method Breakdown`: shows BLE / Code / Manual distribution
  - `Google Sheets Sync Status`: `QUEUED_BATCH` (single batchUpdate dispatched)
- [ ] Close the session window. Google Sheets sync executes as an asynchronous background worker with exponential retry and DLQ protection.
