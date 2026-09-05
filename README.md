# 🎓 SNIST AI QR Attendance & ERP System

[![FastAPI](https://img.shields.io/badge/FastAPI-0.104.1-009688.svg?style=flat&logo=FastAPI&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-18.2.0-61DAFB.svg?style=flat&logo=react&logoColor=black)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.2.2-3178C6.svg?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MySQL](https://img.shields.io/badge/MySQL-8.0-4479A1.svg?style=flat&logo=mysql&logoColor=white)](https://www.mysql.com/)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3.3-38B2AC.svg?style=flat&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![License: Institutional](https://img.shields.io/badge/License-Institutional_SNIST-059669.svg)](#license)

An enterprise-grade, high-concurrency, offline-capable **AI-Powered QR Attendance & Academic ERP Management System** engineered for **Sreenidhi Institute of Science and Technology (SNIST)**. 

The platform modernizes classroom attendance with **rotating HMAC-SHA256 projector QR codes**, enforces strict **hardware device-to-student binding locks**, provides **self-service student onboarding**, manages **dual-channel SMTP failover**, streams real-time data to **remote MySQL** and **Google Sheets**, and guards the infrastructure with a **two-layer real-time security alerting system**.

---

## 📑 Table of Contents

- [1. System Architecture](#1-system-architecture)
- [2. Core Subsystems & Capabilities](#2-core-subsystems--capabilities)
  - [2.1 Classroom Projector Rotating QR Engine](#21-classroom-projector-rotating-qr-engine)
  - [2.2 Hardware Device Binding & Anti-Fraud Security](#22-hardware-device-binding--anti-fraud-security)
  - [2.3 Self-Service Student Onboarding & Magic Links](#23-self-service-student-onboarding--magic-links)
  - [2.4 Faculty Timetable & Schedule Notifications](#24-faculty-timetable--schedule-notifications)
  - [2.5 Dual-Channel SMTP Infrastructure & Quota Load Balancing](#25-dual-channel-smtp-infrastructure--quota-load-balancing)
  - [2.6 Two-Layer Security Alerting & Detection System](#26-two-layer-security-alerting--detection-system)
  - [2.7 High-Performance SRE & Database Optimization](#27-high-performance-sre--database-optimization)
  - [2.8 Real-Time Google Sheets & Master Excel Registers](#28-real-time-google-sheets--master-excel-registers)
- [3. Architecture Decision Records (ADRs)](#3-architecture-decision-records-adrs)
- [4. Tech Stack](#4-tech-stack)
- [5. Repository Structure](#5-repository-structure)
- [6. Database Schema & Data Models](#6-database-schema--data-models)
- [7. Complete API Reference](#7-complete-api-reference)
- [8. Production Deployment & Operations](#8-production-deployment--operations)
- [9. Automated Test Suite & Verification](#9-automated-test-suite--verification)
- [10. Environment Configuration (.env)](#10-environment-configuration-env)
- [11. License & Institutional Attribution](#11-license--institutional-attribution)

---

## 1. System Architecture

```mermaid
flowchart TB
    subgraph Clients ["Client Layer (PWA / Responsive)"]
        SP[Student Portal PWA\nCamera Scanner + Rotating QR]
        TD[Teacher Dashboard\n60FPS Scanner + Session Controls]
        PB[Projector Broadcast View\n10s Rotating HMAC QR Modal]
        AD[Admin Management Portal\nRosters, Credentials, Security Audit]
    end

    subgraph Edge ["Edge & Reverse Proxy Layer"]
        NG[Nginx SSL Reverse Proxy\nather-os.de5.net / Azure VM]
        CF[Cloudflare Tunnel Fallback\nLocal Dev & Edge Defense]
    end

    subgraph AppLayer ["FastAPI Application Layer (backend/app)"]
        AUTH[Auth Router & RBAC Guard\nSUPER_ADMIN / TEACHER / STUDENT]
        DEV[Device Security Guard\nUUID Hardware Lock & 30m Lockout]
        QR_ENG[HMAC-SHA256 Rotating QR Engine\n10s Window + 20s Server Buffer]
        ALERT_ENG[Security Alert Service\nLayer 1 Inline + Layer 2 Hourly Digest]
        EMAIL_SVC[Dual-Channel SMTP Dispatcher\nGmail Primary + Zoho Secondary]
        SHEET_SVC[Atomic Google Sheets Sync\nWorksheet Batch Update]
        EXCEL_SVC[Master Excel Generator\nOfficial 75% Attendance Thresholds]
        ONBOARD_SVC[Student Onboarding & Magic Link Engine\nOTP + PIN + Rebind Approvals]
    end

    subgraph Persistence ["Persistence & Storage Layer"]
        MYSQL[(Remote MySQL 8.0\nseg-dev.sreenidhi.edu.in:3306/seg_demo)]
        GSHEET[(Google Sheets API v4\nLive Attendance Spreadsheet)]
        EXCEL_STORE[(Master Excel Registers\nOfficial Institutional Archives)]
    end

    Clients --> Edge
    Edge --> AppLayer
    AppLayer --> Persistence
```

---

## 2. Core Subsystems & Capabilities

### 2.1 Classroom Projector Rotating QR Engine
- **Rotating HMAC-SHA256 Tokenization**: Rather than static QR codes susceptible to photograph-sharing on messaging apps, the teacher's projector displays an ultra-high-resolution dynamic QR code that regenerates every **10 seconds**.
- **Cryptographic Signing**: Each payload contains `{"session_id", "timestamp", "window_index", "salt"}` signed with server-side `QR_SECRET_KEY` using HMAC-SHA256.
- **Clock Skew Tolerance**: Accommodates mobile network latencies with a server-side **20-second verification buffer** while strictly rejecting tokens older than 30 seconds or from outside the current session.
- **Projector UI/UX**: High-contrast, fullscreen-capable SVG QR renderer with live animated countdown rings, classroom operating instructions, and background recovery guards.

### 2.2 Hardware Device Binding & Anti-Fraud Security
- **Strict Device-to-Student Lock**: Enforces a strict 1:1 binding between client hardware (`x-device-public-id` generated from non-resettable device entropy) and the student's canonical `SAP ID` / Roll Number.
- **30-Minute Account Switching Lockout**: If a student attempts to log out and log in with a friend's credentials on the same physical device, the system immediately locks the device for **30 minutes**, returns `HTTP 403 Forbidden`, and writes an immutable audit record to `qr_audit_logs`.
- **Incognito & Cookie-Clear Defense**: Device identity persists in IndexedDB + cryptographically verified signed device tokens, preventing bypass through private tabs or browser data wiping.
- **Self-Service Device Rebinds**: Students replacing broken/new phones can request a device rebind (limited to 5 per semester), subject to admin approval.

### 2.3 Self-Service Student Onboarding & Magic Links
- **Excel Roster Import**: Administrators upload standard department Excel rosters containing Student Name, Roll Number, Email, and Section.
- **Asynchronous Magic Link Dispatch**: Students receive a secure, one-time institutional magic login link valid for 48 hours.
- **2-Factor Verification**: Students verify via a 6-digit email OTP (10-minute expiry) and set a permanent 4-to-6 digit numeric PIN.
- **Auto-Healing Authentication Sync**: Pre-authenticated students with valid onboarding records automatically synchronize into `qr_users` upon their first login.

### 2.4 Faculty Timetable & Schedule Notifications
- **Anti-Spam Faculty Inbox Protection**: When batches of 50+ student magic links are dispatched, the class in-charge is **never CC'd** on student emails.
- **Dedicated Timetable Allotment Email**: The assigned teacher receives **one consolidated schedule email** summarizing:
  - Subject Name & Institutional Code (e.g. *Career Enhancement Training — CET*)
  - Department, Section & Student Headcount (e.g. *CSE-CS, CS-A, 51 Students*)
  - Weekly Class Days & Period Block (e.g. *Every Monday, Tuesday, Wednesday — 4 Periods*)
  - Next Session Date & Lab Venue (e.g. *CSE-CS Projector Lab*)
  - One-click Faculty Portal Login & Setup Guide.

### 2.5 Dual-Channel SMTP Infrastructure & Quota Load Balancing
To eliminate single-point-of-failure risks and overcome institutional Gmail sending quotas:
- **Channel 1 (`DEFAULT`)**: Google Gmail SMTP (`smtp.gmail.com:587`, STARTTLS) dedicated to Student Magic Links, Faculty Class Schedules, and System Notices.
- **Channel 2 (`OTP` / `AUTH`)**: Zoho Mail SSL (`smtp.zoho.in:465`, SSL) dedicated to 6-Digit OTP Verification Codes and Login Credential Dispatches.
- **Automatic Bidirectional Failover**: If the designated primary provider fails (rate limit, quota exceeded, or network blip), `send_single_email` automatically and transparently fails over to the secondary provider, guaranteeing 100% email delivery.

### 2.6 Two-Layer Security Alerting & Detection System
- **Operator Notification Channel**: Instant delivery to `23311a05y6@cse.sreenidhi.edu.in`.
- **Layer 1 (Sub-Second Real-Time Alerts)**:
  - **Account Switch Spikes**: Alerts on the 3rd attempt from the same device in a 10-minute window.
  - **Privilege Escalation**: Immediately alerts when a Student JWT attempts to query Teacher or Super Admin endpoints (`PRIVESC_ATTEMPT`).
  - **Token Tampering**: Alerts when >10 failed HMAC tokens originate from a source IP in 5 minutes (`FAILED_HMAC`).
  - **Scan Flooding**: Alerts when >30 scan requests are made in 5 minutes (`SCAN_FLOOD_429`).
  - **Non-Blocking Guarantee**: Offloaded to a background thread pool executor (`ThreadPoolExecutor`), adding `<0.5ms` to request latency.
  - **Anti-Fatigue Cooldown**: 10-minute cooldown per `(event_type, subject)` prevents alert inbox flooding.
- **Layer 2 (Hourly Safety Net Digest Bot)**:
  - Runs in a background `asyncio` loop within FastAPI `lifespan` during class hours (**09:00 – 17:00 IST on Weekdays**).
  - Queries `qr_audit_logs` for all security incidents in the past 60 minutes.
  - **Zero-Event Silence**: If 0 incidents occurred, **zero emails are sent** (no "all clear" noise).
  - Rollup HTML summary table displays timestamp (IST), event type, actor, hardware signature, client IP, and suppressed event counters.
- **Operator Test Endpoint**: `POST /api/v1/admin/security-alerts/test-send` (guarded by `require_admin`).

### 2.7 High-Performance SRE & Database Optimization
- **N+1 Query Elimination**:
  - Student QR batch scan: Reduced from **~240 SQL queries down to 2 batch queries** (99.2% reduction).
  - Historical sessions dashboard: Reduced from **59 queries down to 3 queries** (94.9% reduction).
  - Admin student listings: Reduced from **7 queries down to 1 query** using SQLAlchemy `joinedload()`.
- **Composite Database Indexes**: Deployed 15 composite B-tree indexes on remote MySQL (`seg_demo`) including `(device_id, binding_status, expires_at)` and `(session_id, student_id)`, converting full table scans into constant-time $O(1)$ index lookups.
- **Bounded LRU Session Cache**: In-memory thread-safe `BoundedLRUSessionCache` (cap=500 sessions, TTL=30s) prevents redundant database lookups during rapid multi-student scans.
- **Frontend Code Splitting**: Initial student JS bundle reduced from **697.33 kB to ~70 kB gzipped** (64.6% reduction) by isolating scanner libraries into on-demand chunks (`vendor-scanner`).
- **WebP Asset Optimization**: Brand assets converted from JPEG (19 KB) to WebP (5.5 KB) with `<picture>` fallback and lazy decoding.

### 2.8 Real-Time Google Sheets & Master Excel Registers
- **Atomic Google Sheets Sync**: Upgraded from cell-by-cell writes to atomic batch range updates (`worksheet.update`), eliminating Google API rate-limit timeouts.
- **Official Institutional Excel Register**: Automatically updates official multi-period attendance sheets with formulas, percentage calculations, and 75% regulatory attendance thresholds.

---

## 3. Architecture Decision Records (ADRs)

| ADR | Title | Decision Summary |
| :--- | :--- | :--- |
| **ADR-001** | Stateless Client PWA with Server-Side Verification | All attendance verification is server-authoritative; the client PWA stores no secrets. |
| **ADR-002** | Canonical Identity Governance | Enforce `SAP ID` / University Roll Number as the immutable canonical identifier. |
| **ADR-003** | Server-Authoritative IST Time Enforcement | All attendance timestamps and security expirations use server IST (`Asia/Kolkata`) / UTC. Never trust client device clocks. |
| **ADR-004** | Hardware Device Binding Lock | Enforce 30-minute lock per physical device signature to prevent attendance proxying and account switching. |
| **ADR-005** | Dual-Channel SMTP Transport | Separate high-volume transactional OTPs from institutional magic links and notices with automatic failover. |
| **ADR-006** | Non-Blocking Event-Driven Security Alerting | Security alerts must reach operators in seconds without blocking or degrading attendance scan latency. |

---

## 4. Tech Stack

### Backend
- **Core Framework**: FastAPI 0.104.1 (Python 3.11+)
- **ORM & Database**: SQLAlchemy 2.0, PyMySQL 1.1, MySQL 8.0 / SQLite (fallback test runner)
- **Security & Crypto**: PyJWT, Passlib (Bcrypt), Cryptography (AES-GCM / HMAC-SHA256)
- **Templating & Email**: Jinja2 (HTML Email Templates), Python standard `smtplib` + `ssl`
- **Spreadsheets & Data**: `gspread` (Google Sheets API v4), `openpyxl` (Master Excel Register)
- **Process Management**: Uvicorn (ASGI), Gunicorn, Docker Compose

### Frontend
- **Framework**: React 18.2 + TypeScript 5.2 + Vite 5.0
- **Styling**: Tailwind CSS 3.3 (Institutional Emerald, Sapphire & Dark Glassmorphism)
- **PWA & Offline**: `vite-plugin-pwa`, Workbox Service Workers, IndexedDB
- **Camera Scanning**: Native browser `BarcodeDetector` API + `html5-qrcode` fallback
- **Icons & UI**: Lucide React, Canvas-Confetti, Headless UI

### Infrastructure & Deployment
- **Cloud Provider**: Microsoft Azure Virtual Machine (Ubuntu 22.04 LTS)
- **Domain & SSL**: `https://ather-os.de5.net` (Let's Encrypt SSL / Edge Nginx Proxy)
- **Containerization**: Docker & Docker Compose (`backend`, `frontend`, `proxy`)
- **Remote Enterprise DB**: SEG Internal MySQL Server (`seg-dev.sreenidhi.edu.in:3306/seg_demo`)

---

## 5. Repository Structure

```text
attendance_system/
├── backend/
│   ├── app/
│   │   ├── api/                     # FastAPI API Routers
│   │   │   ├── admin.py             # Super Admin CRUD & System Settings
│   │   │   ├── admin_credentials.py # Bulk Credential Dispatch & Resends
│   │   │   ├── admin_onboarding.py  # Student Onboarding & Excel Import
│   │   │   ├── attendance.py        # QR Verification & Batch Attendance Processing
│   │   │   ├── auth.py              # OAuth2 JWT Login, OTP & RBAC Guards
│   │   │   ├── devices.py           # Device Registration & Binding APIs
│   │   │   ├── onboarding.py        # Public Student Onboarding Wizard APIs
│   │   │   ├── reports.py           # Attendance Summaries & Analytics
│   │   │   ├── student.py           # Student Dashboard & Timetable APIs
│   │   │   └── teacher.py           # Teacher Dashboard, Sessions & GSheet Sync
│   │   ├── core/                    # Core Infrastructure & Settings
│   │   │   ├── config.py            # Pydantic Application Settings & Env Vars
│   │   │   ├── database.py          # SQLAlchemy SessionLocal & Connection Pool
│   │   │   ├── device_security.py   # Hardware Binding & Device Guard Logic
│   │   │   ├── frappe_sync.py       # Frappe/ERPNext Webhook Synchronization
│   │   │   └── security.py          # Password Hashes, JWTs, Server IST Times
│   │   ├── models/                  # SQLAlchemy ORM Models
│   │   │   └── models.py            # Users, Students, Devices, Sessions, Audit Logs
│   │   └── services/                # Business Logic & External Integrations
│   │       ├── email_service.py     # Dual SMTP Dispatcher & Template Renderer
│   │       ├── excel_service.py     # Official Master Excel Attendance Service
│   │       ├── gsheets_service.py   # Atomic Batch Google Sheets Synchronizer
│   │       ├── onboarding_service.py# Magic Link Tokens & OTP Generation
│   │       ├── qr_service.py        # Dynamic HMAC QR Token Generator & Decoder
│   │       └── security_alert_service.py # Two-Layer Real-Time Alert & Digest Engine
│   ├── data/                        # Static Assets, Templates & Outputs
│   │   ├── master_templates/        # Official Attendance Register Templates
│   │   └── templates/               # Jinja2 Responsive HTML Email Templates
│   │       ├── student_magic_link_email.html
│   │       ├── student_otp_email.html
│   │       ├── student_credentials_email.html
│   │       ├── teacher_class_allotment_email.html
│   │       ├── security_alert_email.html
│   │       └── security_digest_email.html
│   ├── tests/                       # Automated Test Suites
│   │   ├── test_onboarding_and_credentials.py
│   │   ├── test_security_alerts.py
│   │   └── test_vulnerability_verification.py
│   ├── main.py                      # Application Entrypoint & Lifespan Handler
│   └── requirements.txt             # Python Package Dependencies
├── frontend/
│   ├── src/
│   │   ├── components/              # Reusable React UI Components
│   │   │   ├── Navbar.tsx
│   │   │   ├── ProjectorBroadcastModal.tsx # Dynamic Projector QR Modal
│   │   │   ├── QRScannerModal.tsx
│   │   │   ├── StudentClassScannerModal.tsx
│   │   │   └── admin/               # Admin Portal Management Components
│   │   │       ├── BatchCredentialsDispatcher.tsx
│   │   │       ├── DeviceRebindApprovalTable.tsx
│   │   │       └── OnboardingManager.tsx
│   │   ├── pages/                   # Application Routed Views
│   │   │   ├── AdminDashboard.tsx   # Institutional Rosters & System Settings
│   │   │   ├── Login.tsx            # Multi-Role Authentication View
│   │   │   ├── Management.tsx       # Paginated Student & Faculty Management
│   │   │   ├── OnboardingWizard.tsx # Student 2FA Setup & PIN Creation
│   │   │   ├── StudentPortal.tsx    # Live Schedule, Rotating QR & Attendance
│   │   │   └── TeacherDashboard.tsx # Real-Time Scanner, Roster & Session Controls
│   │   ├── services/                # Axios API Client & Offline Sync Queue
│   │   ├── App.tsx                  # React Router & Role-Based Protected Routes
│   │   ├── main.tsx                 # DOM Entrypoint & Service Worker Registration
│   │   └── index.css                # Tailwind CSS Design System & Utility Tokens
│   ├── public/                      # Static Assets & PWA Manifest
│   ├── index.html                   # HTML5 Shell with Preload Hints
│   └── vite.config.ts               # Vite Build Configuration & Chunk Splitting
├── docs/                            # Deep-Dive System Documentation
│   ├── ARCHITECTURE.md              # Detailed Engineering & Dataflow Blueprint
│   ├── SECURITY_MODEL.md            # Threat Model, Hardware Lock & Crypto Specs
│   ├── API_REFERENCE.md             # Complete OpenAPI / Swagger API Specifications
│   └── OPERATIONS_AND_DEPLOYMENT.md # Production Runbook & Pre-Flight Guides
├── scripts/                         # Operational & DevOps Automation Scripts
│   ├── apply_performance_indexes.py# Remote MySQL Index Deployment Tool
│   ├── dev_server.py                # Local Development Proxy & SPA Server
│   ├── monday_preflight_check.py    # Automated 7-Second Pre-Flight Verification
│   ├── nginx_ather.conf             # Production Nginx Reverse Proxy Config
│   ├── seed_data.py                 # Initial Database Seed & Demo User Generator
│   ├── start_production.sh          # Azure VM Production Daemon Script
│   └── verify_pilot_e2e_live.py     # 8-Phase Live Production Smoke Test
├── .env.example                     # Sanitized Configuration Environment Template
├── .gitignore                       # Git Exclusion Rules (Secrets, Logs, Tarballs)
└── docker-compose.yml               # Multi-Container Production Orchestration
```

---

## 6. Database Schema & Data Models

The system interfaces with an enterprise MySQL relational schema. Key entities include:

```mermaid
erDiagram
    qr_users ||--o{ qr_teachers : "profile"
    qr_users ||--o{ qr_students : "profile"
    qr_users ||--o{ qr_audit_logs : "actor"
    
    qr_departments ||--o{ qr_sections : "contains"
    qr_departments ||--o{ qr_subjects : "offers"
    
    qr_sections ||--o{ qr_students : "enrolls"
    qr_sections ||--o{ qr_attendance_sessions : "holds"
    qr_sections ||--o{ qr_teacher_assignments : "assigns"
    
    qr_teachers ||--o{ qr_attendance_sessions : "conducts"
    qr_teachers ||--o{ qr_teacher_assignments : "assigned_to"
    
    qr_attendance_sessions ||--o{ qr_attendance_records : "records"
    qr_students ||--o{ qr_attendance_records : "attends"
    
    device_registrations ||--o{ device_account_bindings : "binds"
    qr_students ||--o{ device_account_bindings : "owns"
    
    student_onboardings ||--o{ device_rebind_requests : "requests"
```

### Table Specifications
1. **`qr_users`**: Institutional user identities, hashed passwords (`bcrypt`), user roles (`SUPER_ADMIN`, `TEACHER`, `STUDENT`), and account active states.
2. **`qr_students`**: Academic records, canonical roll number (`SAP ID`), section assignment, department, semester, and registered mobile numbers.
3. **`qr_teachers`**: Faculty records, teacher code, department, and linked personal Google Sheet spreadsheet IDs.
4. **`qr_attendance_sessions`**: Live class sessions, teacher ID, section ID, subject code, multi-period duration, session status (`OPEN`, `LOCKED`), and server start/lock timestamps.
5. **`qr_attendance_records`**: Immutable attendance entries, session ID, student ID, verification method (`QR_SCAN`, `PROJECTOR_SCAN`, `MANUAL`), and server IST timestamp.
6. **`device_registrations` & `device_account_bindings`**: Unique hardware signatures, browser fingerprints, 30-minute lockouts, and active binding states.
7. **`student_onboardings`**: Self-service onboarding progress, 48-hour magic token hashes, 6-digit OTP verification codes, and PIN states.
8. **`qr_audit_logs`**: Tamper-proof append-only audit trail recording `ACCOUNT_SWITCH_ATTEMPT`, `DEVICE_REVOKED`, `FAILED_HMAC`, `PRIVESC_ATTEMPT`, `SCAN_FLOOD_429`, and `SECURITY_ALERT_SENT`.

---

## 7. Complete API Reference

A summarized catalog of the RESTful API endpoints exposed under `/api/v1`:

### Authentication & Sessions (`/api/v1/auth`)
- `POST /auth/login`: Form-encoded login returning OAuth2 JWT access token. Enforces device binding and rate limits.
- `POST /auth/refresh`: Refreshes expired tokens using active device secret.
- `GET /auth/me`: Returns current user identity, role, and academic profile.
- `GET /auth/magic-token-info?token={token}`: Validates 48-hour onboarding magic link.
- `POST /auth/magic-login`: Exchanges valid magic token for authenticated session.

### Classroom Attendance (`/api/v1/attendance`)
- `POST /attendance/scan`: Verifies dynamic HMAC student QR code.
- `POST /attendance/scan-projector`: Student scans teacher projector QR; verifies 10s rotating window and grants attendance.
- `POST /attendance/batch-scan`: Vectorized multi-student batch QR processing.

### Faculty Controls (`/api/v1/teacher`)
- `GET /teacher/dashboard`: Active classes, timetable, and department rosters.
- `POST /teacher/sessions/start`: Initiates live attendance session with designated period block.
- `GET /teacher/sessions/{id}/projector-token`: Generates 10-second rotating HMAC projector QR token.
- `POST /teacher/sessions/{id}/lock`: Locks session, commits attendance, and triggers Google Sheets/Excel background sync.
- `POST /teacher/sessions/{id}/sync-sheet`: Re-triggers Google Sheets sync on-demand.
- `GET /teacher/historical-sessions`: Paginated historical class logs with student attendance counts.

### Student Portal (`/api/v1/student`)
- `GET /student/dashboard`: Student profile, aggregate attendance percentage, and current active session banner.
- `GET /student/qr-token`: Generates short-lived 30-second HMAC dynamic student QR code.
- `GET /student/today-schedule`: Today's class timetable and allocated periods.

### Super Admin Operations (`/api/v1/admin`)
- `GET /admin/students`: Paginated student roster with eager section loading.
- `GET /admin/teachers`: Paginated faculty roster.
- `POST /admin/teachers/assign`: Assigns faculty to subject/section and triggers timetable email notification.
- `GET /admin/audit-logs`: Keyset-cursor / paginated access to `qr_audit_logs`.
- `POST /admin/security-alerts/test-send`: Dispatches synthetic verification alert to operator email.

### Student Onboarding & Credentials (`/api/v1/onboard` & `/api/v1/admin/credentials`)
- `POST /onboard/send-otp`: Dispatches 6-digit verification code via Zoho OTP channel.
- `POST /onboard/verify-otp-and-set-pin`: Verifies OTP, sets student PIN, and binds hardware device.
- `POST /onboard/request-rebind`: Student submits device replacement request.
- `POST /admin/credentials/dispatch`: Dispatches batch magic links to students and notifies class in-charge.
- `POST /admin/credentials/approve-rebind`: Super Admin approves device rebind request.

---

## 8. Production Deployment & Operations

The system is deployed in production on an **Azure Virtual Machine** running Docker Compose behind an Nginx edge reverse proxy:

```bash
# Production Host: ather-os.de5.net (Azure VM)
# Status: ONLINE & HEALTHY (Port 8001 -> Uvicorn ASGI Backend, Port 80 -> SPA Frontend)
```

### 1. Build and Run via Docker Compose
```bash
# 1. Clone repository
git clone https://github.com/bhaskar1461/attendance_system-.git
cd attendance_system-

# 2. Configure production environment
cp .env.example .env
cp .env.example backend/.env
# Edit .env and backend/.env with production credentials

# 3. Build and launch services
docker compose up -d --build

# 4. View container logs
docker compose logs -f backend
```

### 2. Manual Host Setup (Systemd / Tmux)
```bash
# Backend Virtual Environment
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Run Uvicorn ASGI Server
uvicorn app.main:app --host 0.0.0.0 --port 8001 --workers 2

# Frontend Build
cd ../frontend
npm install
npm run build
```

### 3. Automated 7-Second Pre-Flight Verification
Run the automated pre-flight smoke test before class sessions:
```bash
python scripts/monday_preflight_check.py
```
**Output**:
```text
============================================================
  SNIST ERP — PRODUCTION PRE-FLIGHT VERIFICATION
  Target: https://ather-os.de5.net
============================================================
[1/6] Probing System Health & Remote Database...  [PASS] (210ms)
[2/6] Verifying Faculty Authentication...         [PASS] (HTTP 200)
[3/6] Resolving Timetable & Student Headcount...  [PASS] (51 Students)
[4/6] Testing Dynamic Projector Rotating QR...   [PASS] (10s Window Active)
[5/6] Probing Student Portal & Schedule APIs...   [PASS] (CET 4 Periods Block)
[6/6] Verifying Edge Nginx SSL & Cache Headers... [PASS] (Valid Certificate)
------------------------------------------------------------
VERDICT: ALL 6 CHECKS PASSED (SYSTEM IS GO FOR CLASSROOM USE)
============================================================
```

---

## 9. Automated Test Suite & Verification

The repository includes comprehensive unit, integration, security, and performance test suites:

### Running Tests
```bash
# Set PYTHONPATH to include backend
$env:PYTHONPATH="backend"  # PowerShell
# export PYTHONPATH="backend"  # Linux / macOS

# 1. Run Two-Layer Security Alerting Tests (10/10 passed)
python -m unittest backend/tests/test_security_alerts.py

# 2. Run Onboarding, Magic Link & Dual SMTP Tests (10/10 passed)
python -m unittest backend/tests/test_onboarding_and_credentials.py

# 3. Run Complete Backend Test Suite
pytest backend/tests -v
```

### Test Coverage Highlights
- **Threshold Burst Simulation**: 5 consecutive account switches on one device trigger exactly 1 alert email on the 3rd attempt; 4th and 5th are suppressed by cooldown.
- **Hourly Digest Anti-Spam**: Asserts 0 emails are sent when 0 security incidents occur during the hour.
- **Dual SMTP Failover**: Verifies automatic failover from primary Gmail to secondary Zoho when quota/network errors occur.
- **Non-Blocking Verification**: Asserts alerting engine executes in background threads without blocking API response times.

---

## 10. Environment Configuration (.env)

A sanitized `.env.example` is provided in the repository root. Key variables include:

```ini
# Cryptographic Keys
SECRET_KEY=generate_with_openssl_rand_hex_32
QR_SECRET_KEY=generate_with_openssl_rand_hex_32
ALGORITHM=HS256

# Remote Enterprise Database
DATABASE_URL=mysql+pymysql://db_user:db_password@seg-dev.sreenidhi.edu.in:3306/seg_demo

# Domain & Ingress
FRONTEND_URL=https://ather-os.de5.net

# Primary SMTP Channel (Helpdesk Gmail)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=helpdesk@sreenidhi.edu.in
SMTP_PASSWORD=your_gmail_app_password
SMTP_USE_TLS=True

# Secondary SMTP Channel (Proofsy Zoho Mail)
SMTP_OTP_HOST=smtp.zoho.in
SMTP_OTP_PORT=465
SMTP_OTP_USER=certificates@proofsy.tech
SMTP_OTP_PASSWORD=your_zoho_smtp_password
SMTP_OTP_USE_SSL=true

# Two-Layer Security Alert System
SECURITY_ALERT_EMAIL=23311a05y6@cse.sreenidhi.edu.in
SECURITY_ALERTS_ENABLED=true
SECURITY_ALERT_COOLDOWN_MIN=10
SECURITY_DIGEST_ENABLED=true
SECURITY_DIGEST_START_HOUR=9
SECURITY_DIGEST_END_HOUR=17
```

---

## 11. License & Institutional Attribution

This software is developed for and proprietary to **Sreenidhi Institute of Science and Technology (SNIST)**, Hyderabad, India.

All rights reserved. Unauthorized copying, modification, distribution, or commercial use without prior written consent from the institution is strictly prohibited.
