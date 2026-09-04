# 🔄 System Workflow & Sequence Diagrams - SNIST ERP & AI Attendance System

## Overview
This document illustrates the end-to-end operational workflows, security checks, background processing, and data synchronization flows across the **SNIST AI QR Attendance System & Frappe ERP**.

---

## 1. End-to-End Attendance Scanning & Locking Flow

This flow describes how a faculty member initiates a session, scans student dynamic QR codes, locks the session, and triggers multi-target synchronization (FastAPI $\rightarrow$ Frappe ERP $\rightarrow$ Google Sheets & Excel).

```mermaid
sequenceDiagram
    autonumber
    actor Teacher as 👩‍🏫 Faculty / Instructor
    participant PWA as 📱 React PWA (Client)
    actor Student as 👨‍🎓 Student Device
    participant API as ⚡ FastAPI Backend
    participant DB as 🗄️ MySQL / SQLite
    participant Frappe as 🏢 Frappe ERP (`snist_erp`)
    participant GSheets as 📊 Google Sheets API

    Student->>PWA: Display Dynamic QR Code (TOTP 30s Window)
    Teacher->>PWA: Open 60FPS Camera Scanner & Select Periods (1-8)
    PWA->>PWA: Multi-QR Batch Detection (Native BarcodeDetector / Html5Qrcode)
    PWA->>API: POST /api/v1/attendance/verify-scan (QR Token, DeviceID, Time)
    API->>API: Verify Server-Authoritative IST Time & Device Binding Lock
    API-->>PWA: HTTP 200 OK (Student Validated: Present)
    
    Teacher->>PWA: Click "Lock Attendance Session"
    PWA->>API: POST /api/v1/attendance/lock-session (Session Payload)
    API->>DB: Store Session & Student Attendance Records
    
    par Async Multi-Sync
        API->>GSheets: Append/Update Master Google Sheet Register
        API->>Frappe: POST /api/method/snist_erp.snist_erp.api.sync_attendance_session
        Frappe->>Frappe: Validate SAP ID & Create `SNIST Attendance Session` & `Student Attendance`
        Frappe-->>API: HTTP 200 OK (synced_records: N)
    end
    API-->>PWA: Session Locked & Synchronized Successfully
```

---

## 2. Authentication, Keycloak SSO & Device Binding Lock Flow

This flow enforces institutional security, Keycloak OAuth2 / JWT authentication, server-authoritative time verification, and the 30-minute device lock policy.

```mermaid
sequenceDiagram
    autonumber
    actor User as 👤 Student / Faculty
    participant PWA as 📱 React PWA
    participant Auth as 🔐 FastAPI Auth / Keycloak SSO
    participant DeviceManager as 🛡️ Device Lock Service
    participant DB as 🗄️ Database

    User->>PWA: Enter Credentials / Keycloak SSO Login
    PWA->>Auth: POST /api/v1/auth/login (Username, Password, Device UUID)
    Auth->>DeviceManager: Check Device Lock (Device UUID)
    
    alt Device Bound to Another SAP ID within 30 Minutes
        DeviceManager-->>Auth: LOCKOUT ACTIVE (Device bound to another user)
        Auth-->>PWA: HTTP 403 Forbidden ("Account switching restricted on this device")
    else Device Clear or Same User
        DeviceManager->>DB: Update Device Lock (Device UUID -> SAP ID, IST Timestamp)
        Auth->>Auth: Issue JWT Bearer Token (containing SAP ID, Role, Expiration)
        Auth-->>PWA: HTTP 200 OK (JWT Access Token + User Profile)
    end
```

---

## 3. Offline PWA Queue & Sync Recovery Flow

This flow details how the system gracefully handles campus network drops and synchronizes queued records once connectivity is restored.

```mermaid
sequenceDiagram
    autonumber
    actor Teacher as 👩‍🏫 Faculty
    participant PWA as 📱 React PWA (Offline)
    participant IDB as 💾 PWA IndexedDB Queue
    participant Net as 🌐 Network Monitor
    participant API as ⚡ FastAPI Backend
    participant Frappe as 🏢 Frappe ERP

    Teacher->>PWA: Scan Attendance while Offline
    PWA->>PWA: Detect Offline Status
    PWA->>IDB: Save Encrypted Scan Record to Local Sync Queue
    PWA-->>Teacher: Show "Saved Offline (Pending Sync)" UI Badge
    
    Net->>PWA: Event: Connection Restored (Online)
    PWA->>IDB: Fetch All Pending Queue Items
    PWA->>API: POST /api/v1/attendance/batch-sync (Queued Payload)
    API->>API: Deduplicate Scans & Validate Server IST
    API->>Frappe: Sync to Frappe ERP (`sync_attendance_session`)
    API-->>PWA: HTTP 200 OK (Sync Acknowledged)
    PWA->>IDB: Clear Synced Queue Items
    PWA-->>Teacher: Update UI "All Scans Synced Live"
```

---

## 4. Frappe Background Scheduler & Defaulter Alert Trigger Flow

This flow illustrates how Frappe RQ / Scheduler runs nightly background jobs to calculate student aggregate attendance percentages and trigger low-attendance alerts.

```mermaid
sequenceDiagram
    autonumber
    participant Cron as ⏱️ Frappe Scheduler (Nightly Cron)
    participant Worker as ⚙️ Frappe RQ Background Worker
    participant DB as 🏢 Frappe MariaDB/PostgreSQL
    participant Alert as 📬 Notification Engine (Email/SMS)

    Cron->>Worker: Trigger `calculate_daily_attendance_aggregates()`
    Worker->>DB: Query `Student Attendance` for active academic term
    Worker->>Worker: Compute Cumulative Attendance % per Student & Subject
    
    loop For Each Student
        alt Attendance Percentage < 75% Threshold
            Worker->>DB: Create `Attendance Defaulter Log`
            Worker->>Alert: Dispatch Warning Alert (Email to Parent/Student & SMS)
            Alert-->>DB: Log Dispatch Status (SENT)
        end
    end
```

---

## 5. Automated PDF Certificate Generation & Dynamic QR Verification Flow

This flow demonstrates how Jinja2 print formats generate official documents (Hall Tickets, Marks Memos, Transfer Certificates) with dynamic QR tokens for instant external verification.

```mermaid
sequenceDiagram
    autonumber
    actor Student as 👨‍Ch Student / Admin
    participant ERP as 🏢 Frappe ERP Portal
    participant Jinja as 📄 Jinja2 PDF Render Engine
    participant QR as 🔏 Verification Token Generator
    actor External as 🔍 External Verifier (Employer/University)

    Student->>ERP: Request Document (e.g., Bonafide / Marks Memo)
    ERP->>QR: Generate Unique HMAC Cryptographic Hash for Record ID
    QR-->>ERP: Embedded Verification URL (`https://snist.edu.in/verify?token=...`)
    ERP->>Jinja: Render Print Format HTML with Embedded QR Image
    Jinja-->>Student: Stream Downloadable Signed PDF Document
    
    Note over External: Verification Phase
    External->>External: Scan QR Code on Printed PDF
    External->>ERP: GET /api/method/snist_erp.verify_document?token=...
    ERP-->>External: Display Official Authenticated Student Record & Transcript
```

---

## 6. Date-Bound Dynamic Student QR Code Generation & Scanning Validation Flow

This flow details how student dynamic `V2` QR codes are generated with server-authoritative IST dates, HMAC signatures, single-use nonces, and validated against target attendance sessions.

```mermaid
sequenceDiagram
    autonumber
    actor Student as 👨‍🎓 Student
    participant StuPWA as 📱 Student PWA
    actor Teacher as 👩‍🏫 Faculty
    participant TeachPWA as 📱 Teacher PWA
    participant API as ⚡ FastAPI Backend
    participant DB as 🗄️ Database

    Student->>StuPWA: Open Attendance QR View
    StuPWA->>API: GET /api/v1/student/qr-token (JWT Token)
    API->>API: Get Server IST Date (`YYYY-MM-DD`) & Generate Nonce
    API->>API: Compute HMAC-SHA256 Payload (`V2|student_id|roll|date|ts|nonce|sig`)
    API-->>StuPWA: Return Dynamic QR Payload (Refreshes every 30s)
    
    Teacher->>TeachPWA: Scan Student QR for Active Session
    TeachPWA->>API: POST /api/v1/attendance/scan (session_id, qr_payload, period_count)
    API->>API: Decrypt & Verify HMAC Signature & TOTP Window (30s)
    
    alt QR Attendance Date != Session Date
        API-->>TeachPWA: HTTP 400 Bad Request ("QR Date does not match Selected Session Date")
    else Student Section != Session Section
        API-->>TeachPWA: HTTP 400 Bad Request ("Student does not belong to class section")
    else Duplicate Scan in Same Session
        API-->>TeachPWA: HTTP 200 OK (Status: "ALREADY_MARKED")
    else Valid Scan
        API->>DB: Insert / Update AttendanceRecord (Status: PRESENT)
        API-->>TeachPWA: HTTP 200 OK (Status: "SUCCESS", Student Profile)
    end
```

---

## 7. Historical Attendance Unlock, Edit & Admin Override Flow

This flow details how faculty unlock locked historical sessions to edit past attendance under full audit trail logging, as well as the administrative override workflow executed by Super Admins.

```mermaid
sequenceDiagram
    autonumber
    actor Teacher as 👩‍🏫 Faculty / Admin
    participant PWA as 📱 React PWA
    participant API as ⚡ FastAPI Backend
    participant DB as 🗄️ Database

    Teacher->>PWA: Attempt Scan / Edit on Historical Session
    
    alt Session is LOCKED (Teacher Role)
        PWA->>API: POST /api/v1/attendance/scan (session_id, qr_payload)
        API-->>PWA: HTTP 400 Bad Request ("Attendance session is locked for editing")
        
        Teacher->>PWA: Click "Unlock Session for Corrections"
        PWA->>API: POST /api/v1/teacher/sessions/{id}/unlock
        API->>DB: Verify Timetable Allotment & Change Status to OPEN
        API->>DB: Log `SESSION_UNLOCKED` in `AuditLog` (Teacher SAP ID, IST Timestamp)
        API-->>PWA: HTTP 200 OK ("Session unlocked successfully")
        
        Teacher->>PWA: Rescan / Edit Attendance
        PWA->>API: POST /api/v1/attendance/scan (session_id, qr_payload)
        API->>DB: Record Attendance & Log `HISTORICAL_EDIT` in `AuditLog`
        API-->>PWA: HTTP 200 OK (Status: "SUCCESS")
        
    else User Role is SUPER_ADMIN (Admin Override)
        Teacher->>PWA: Admin Direct Scan Override
        PWA->>API: POST /api/v1/attendance/scan (session_id, qr_payload)
        API->>API: Detect SUPER_ADMIN Role -> Bypass Date Match & Locked Session check
        API->>DB: Record Attendance & Log `ADMIN_OVERRIDE` in `AuditLog`
        API-->>PWA: HTTP 200 OK (Status: "SUCCESS", Note: "Admin Override Applied")
    end
```

---

## 8. Defensive Multi-Target Real-Time Sync & Graceful Degradation Flow

This flow details how attendance session locks trigger parallel multi-target synchronization (Database, Google Sheets API, Excel Register, and Frappe ERP REST endpoint) with strict exception boundaries to prevent server crashes.

```mermaid
sequenceDiagram
    autonumber
    actor Teacher as 👩‍🏫 Faculty
    participant API as ⚡ FastAPI Backend
    participant DB as 🗄️ MySQL / SQLite DB
    participant GSheets as 📊 Google Sheets (`gspread`)
    participant Excel as 📄 Excel Register (`openpyxl`)
    participant Frappe as 🏢 Frappe ERP (`snist_erp`)

    Teacher->>API: POST /api/v1/attendance/lock-session (Session Payload)
    
    rect rgb(240, 248, 255)
        Note over API,DB: Primary Core Transaction
        API->>DB: Commit Attendance Session & Student Records (DB Transaction)
        DB-->>API: DB Commit Success
    end
    
    par Async Sync Targets with Defensive Boundaries
        API->>GSheets: update_session_attendance(session_id)
        alt GSheets Success
            GSheets-->>API: Sheet Synced
        else GSheets Network Timeout / Error
            GSheets--xAPI: Exception Caught
            API->>API: Log Warning: "[GSheets Sync] Timeout/Error, retry queued"
        end
        
        API->>Excel: update_excel_register(session_id)
        alt Excel I/O Success
            Excel-->>API: Workbook Updated
        else File Lock Error
            Excel--xAPI: Exception Caught
            API->>API: Log Warning: "[Excel Sync] File lock contention, retry queued"
        end
        
        API->>Frappe: sync_session_to_frappe(session_payload)
        alt Frappe ERP Response 200 OK
            Frappe-->>API: HTTP 200 OK (synced_records: N)
        else Frappe ERP Unreachable (Connection Refused)
            Frappe--xAPI: Connection Error Caught
            API->>API: Log Error: `snist_erp.frappe_sync_client` telemetry log
        end
    end
    
    API-->>Teacher: HTTP 200 OK (Session Locked & Synced, Process Stable)
```
