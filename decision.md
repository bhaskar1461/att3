# 🏛️ Architecture Decision Records (ADR) - SNIST ERP & AI Attendance System

## Overview
This document records the key architectural decisions, rationale, design constraints, and trade-offs for the **SNIST AI QR Attendance System & Frappe ERP Integration**.

---

## ADR-001: Hybrid Architecture (FastAPI + Frappe Framework)

### Context
SNIST requires a real-time, zero-latency QR attendance scanning experience capable of processing 60FPS camera scanner feeds for thousands of students across 1-8 class periods daily. At the same time, the institution requires a robust, audit-compliant ERP system for academic management, student rosters, grading, certificates, and institutional governance.

### Decision
We adopt a **Hybrid Architecture**:
1. **High-Speed Scanner & Gateway Layer (FastAPI + React PWA)**:
   * Handles high-throughput multi-QR decoding (60FPS), camera feeds, dynamic TOTP token validation, offline PWA queues, and instant client feedback.
2. **Institutional System of Record (Frappe ERP Framework)**:
   * Serves as the canonical database, managing DocTypes (`Student`, `Instructor`, `Student Attendance`, `SNIST Attendance Session`, `SNIST Period`), role-based permissions (RBAC), approval workflows, background jobs, Jinja2 PDF certificates, and academic reporting.

### Consequences
* **Pros**: Sub-second UI response time for scanning while maintaining full ERP compliance and auditability.
* **Cons**: Requires synchronization mechanism (`sync_attendance_session` REST endpoint) between FastAPI and Frappe.

---

## ADR-002: Canonical Identity Governance (`SAP ID`)

### Context
Students and Faculty are identified by multiple attributes across different departments (Roll Number, Registration ID, Employee Code, Email, System ID). Inconsistent key usage causes orphaned records during sync.

### Decision
**`SAP ID`** is established as the **unique, immutable institutional identifier** across all databases, APIs, session tokens, and Frappe DocTypes.
* Roll numbers may change or reformat across semesters, but `SAP ID` remains permanent.
* Custom hooks (`validate_student_sap_id`, `validate_instructor_sap_id`) enforce strict `SAP ID` format validation (`STUxxxxx` / `FACxxxxx`) on all Frappe and FastAPI transactions.

### Consequences
* Guarantees 100% data integrity during cross-system sync between FastAPI, MySQL, SQLite, and Frappe ERP.

---

## ADR-003: Server-Authoritative IST Time Enforcement

### Context
Students may tamper with their mobile device clocks (time spoofing) to generate valid dynamic QR codes outside allowed time windows or bypass attendance deadlines.

### Decision
All attendance timestamps, dynamic QR token expirations, session locks, and security audit logs **MUST use server-authoritative IST (`Asia/Kolkata` / UTC)**.
* Client device timestamps are strictly ignored for security-sensitive logic.
* Dynamic QR codes embed TOTP tokens with a strict 30-second server-verified window.

### Consequences
* Completely eliminates local device clock manipulation fraud.

---

## ADR-004: Device Binding & Account Switching Lockout

### Context
Students may share login credentials or pass devices around to proxy-mark attendance for absent peers.

### Decision
Enforce a **strict 30-minute device-to-student lock** (`Device Identifier -> SAP ID / Roll Number`).
* When a student logs into a mobile device, the device ID is bound to their `SAP ID` for 30 minutes.
* Attempting to log into another student account on the same device within 30 minutes is rejected with a generic `HTTP 403 Forbidden` security error ("Account switching restricted on this device").

### Consequences
* Prevents proxy attendance marking in class sessions.

---

## ADR-005: Multi-Tier Storage & Asynchronous Synchronization

### Context
Campus network connectivity may fluctuate during peak hours, causing network drops during classroom attendance sessions.

### Decision
Implement a 3-Tier Storage & Sync Strategy:
1. **Client Tier (PWA IndexedDB)**: Offline storage queue holding encrypted attendance records when offline.
2. **Engine Tier (FastAPI + MySQL / SQLite)**: Immediate persistence of locked attendance sessions, live streaming to Google Sheets (`gspread`) and Excel registers (`openpyxl`).
3. **Institutional ERP Tier (Frappe Framework)**: Asynchronous REST sync via `@frappe.whitelist()` endpoint `sync_attendance_session`.

### Consequences
* Zero data loss during network outages; automated background retry queue syncs pending sessions upon reconnection.

---

## ADR-006: Date-Bound Dynamic Student QR Tokens & Administrative Override Authority

### Context
Students generating static or cached QR codes could attempt replay attacks across different dates or session periods. Conversely, administrative personnel may occasionally require emergency override capability to mark attendance during registration disputes or system audits.

### Decision
1. Dynamic QR codes (`V2` payload format) are encrypted using HMAC-SHA256 containing `student_id`, `roll_number`, `attendance_date` (`YYYY-MM-DD`), `timestamp`, and a single-use `nonce`.
2. Scanning validation verifies that the embedded `attendance_date` in the QR payload exactly matches the target session date (`session_date`).
3. **Super Admin Scan Override**: Users with the `SUPER_ADMIN` role are granted explicit administrative override authority. Scans by Super Admins bypass date mismatches and locked session constraints for audit and manual resolution purposes.

### Consequences
* Replay attacks across calendar days are completely prevented.
* Admins maintain full operational flexibility to resolve edge-case student attendance discrepancies without compromising security logic.

---

## ADR-007: Controlled Historical Attendance Editing & Audit Trail Governance

### Context
Faculty members need the ability to correct historical attendance records (e.g. absent student turned present on medical approval), but unconstrained edits endanger audit integrity and institutional compliance.

### Decision
1. Attendance sessions default to `LOCKED` status upon submission. Scanning or editing attendance against a locked session is strictly rejected (`HTTP 400 Bad Request`).
2. Historical edits require explicit session unlocking (`POST /api/v1/teacher/sessions/{id}/unlock`).
3. Unlocking a session generates an immutable entry in the `AuditLog` table with action type `SESSION_UNLOCKED` and details recording the requesting teacher's `SAP ID`, session ID, and IST timestamp.
4. Once unlocked, scans or manual edits targeting historical dates are accepted provided the student belongs to the assigned section and the teacher has active timetable allotment.

### Consequences
* Provides a complete, tamper-proof audit log for all historical attendance modifications.

---

## ADR-008: Defensive Error Handling, Telemetry & Server Crash Prevention

### Context
External API integrations (Google Sheets `gspread`, Frappe ERP REST endpoints) or local file locks (`openpyxl` Excel registers) can experience temporary network timeouts or I/O contention. If exceptions bubble up unhandled, they could crash the application server process and disrupt active classroom scanning.

### Decision
Implement strict **Defensive Error Handling Boundaries**:
1. All startup routes, database table initialization scripts, external API calls, and sync routines must be wrapped in contextual `try-except` blocks.
2. When external API dependencies fail (e.g. connection refused to Frappe ERP or Google Sheets API timeout), the failure is caught, diagnostic telemetry is logged to server logs (`snist_erp.frappe_sync_client`), and execution degrades gracefully.
3. Silent exception swallowing is forbidden—all errors are logged with full stack traces, while the core scanning transaction returns a clean `HTTP 200 OK` (with sync status warning) to maintain server stability.

### Consequences
* 99.99% system process uptime; campus scanning operates continuously even during cloud or ERP connectivity outages.

---

## ADR-009: Timetable & Section Belonging Validation

### Context
Accidental scanning of students enrolled in Section B during Section A's period, or teachers attempting to launch attendance sessions for unassigned subjects, leads to corrupted institutional attendance logs.

### Decision
Backend strict verification rules are enforced on every scan and session creation request:
1. **Section Belonging**: Verify `student.section_id == session.section_id`. If mismatched, scan is rejected with `HTTP 400 Bad Request` ("Student does not belong to class section").
2. **Timetable Allotment**: Verify `TeacherAssignment` records matching `(teacher_id, subject_id, section_id)`. Unassigned session creation or scanning is rejected with `HTTP 403 Forbidden`.

### Consequences
* Guarantees zero roster cross-contamination and enforces official SNIST academic timetable schedules.

---

## ADR-010: Reverse Proxy, Domain Tunnels & Zero-Trust Ingress Deployment

### Context
SNIST requires secure, encrypted HTTPS access for mobile devices and PWA scanner cameras across campus Wi-Fi networks without exposing internal SQLite/MySQL databases or application server ports directly.

### Decision
Deploy a multi-stage production ingress architecture:
1. **Nginx Reverse Proxy**: Handles SSL termination, gzip compression, static PWA asset serving (`/dist`), and path routing (`/api/v1` -> FastAPI backend process on port 8000).
2. **Cloudflare / Domain Tunnels**: Establishes secure outbound WebSocket/HTTP2 tunnels (`start_domain_tunnel.sh`) eliminating the need for open inbound firewall ports.
3. **Docker Compose & Systemd Services**: Orchestrates application processes, automatic restart policies, and health monitoring scripts (`scripts/start_vm_services.sh`).

### Consequences
* Delivers enterprise-grade TLS security, zero open inbound firewall ports, and seamless public/private campus domain connectivity.
