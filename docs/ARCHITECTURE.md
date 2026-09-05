# 🏛️ System Architecture & Engineering Blueprint

This document details the software architecture, data pipelines, caching strategies, and concurrency patterns powering the **SNIST AI QR Attendance & ERP System**.

---

## 1. High-Level Architectural Patterns

The system adheres to standard enterprise architectural principles:
1. **Stateless API Gateway Pattern**: The FastAPI backend maintains no in-memory user sessions. All authentication state is encapsulated in cryptographically signed JWT tokens and server-authoritative database bindings.
2. **Event-Driven Security Observability**: Any security-relevant request (failed token HMAC, account switch, rate limit breach, privilege escalation) is recorded to an append-only audit trail (`qr_audit_logs`) and dispatched asynchronously to the alert engine.
3. **Defense-in-Depth & Non-Blocking Isolation**: All external network I/O (SMTP email dispatch, Google Sheets API synchronization, Frappe ERP webhooks) is strictly isolated behind thread pools or FastAPI `BackgroundTasks`. An external network timeout or provider outage can **never** block or delay the student attendance scan path.

---

## 2. Classroom Rotating QR Code Pipeline

```mermaid
sequenceDiagram
    autonumber
    actor Teacher as Faculty (Projector)
    participant Client as Frontend (Modal)
    participant API as FastAPI Backend
    actor Student as Student (Phone)
    participant DB as Remote MySQL

    Teacher->>Client: Clicks "Projector Broadcast"
    loop Every 10 Seconds
        Client->>API: GET /api/v1/teacher/sessions/{id}/projector-token
        API->>API: Compute window_index = floor(IST_now / 10s)
        API->>API: Generate HMAC-SHA256(session_id:window_index:salt, QR_SECRET_KEY)
        API-->>Client: Returns rotating token + time_remaining_ms
        Client->>Client: Render dynamic SVG QR + Animated Progress Ring
    end

    Student->>Client: Scans Projector QR with camera
    Student->>API: POST /api/v1/attendance/scan-projector (token, student_jwt, device_headers)
    API->>API: Validate student JWT & Device Binding Lock
    API->>API: Verify token HMAC against current window OR current-1 window (20s tolerance)
    API->>DB: Check duplicate AttendanceRecord(session_id, student_id) [Indexed O(1)]
    API->>DB: INSERT INTO qr_attendance_records
    API-->>Student: HTTP 200 OK ("Attendance marked successfully!")
```

### Key Guarantees
- **Anti-Photo Sharing**: QR codes expire within 10 seconds. Even if a student photographs the screen and sends it via WhatsApp, by the time a remote student receives and scans it, the server rejects it as expired.
- **Clock Drift Tolerance**: Server calculates valid HMAC signatures for both window $W_t$ and window $W_{t-1}$, granting legitimate students in the classroom a seamless 20-second submission window.

---

## 3. Hardware Device Binding & Account Switching Lockout

```mermaid
flowchart TD
    A[Student Login Request] --> B[Extract x-device-public-id & Client IP]
    B --> C{Device Registered in device_registrations?}
    C -- No --> D[Register New Device Hardware Signature]
    C -- Yes --> E[Query Active Binding: device_account_bindings]
    D --> E
    E --> F{Active Binding Exists within 30 Minutes?}
    F -- No --> G[Create Binding: Device -> Student SAP ID]
    G --> H[Return JWT Access Token]
    F -- Yes --> I{Binding SAP ID == Login SAP ID?}
    I -- Yes --> J[Extend Binding Last Auth Timestamp]
    J --> H
    I -- No --> K["ACCOUNT SWITCHING DETECTED!"]
    K --> L["Enforce 30-Minute Lockout on Device"]
    K --> M["Write ACCOUNT_SWITCH_ATTEMPT to qr_audit_logs"]
    K --> N["Invoke SecurityAlertService.hook_audit_event()"]
    K --> O["Reject Request with HTTP 403 Forbidden"]
```

---

## 4. Two-Layer Security Alerting Engine

The alerting engine guarantees that critical incidents reach the operator immediately without alert fatigue:

### Layer 1: In-Memory Sliding TTL Tracker (`SecurityAlertTracker`)
- Maintained as a thread-safe in-memory structure protected by `threading.Lock()`.
- Keyed on `(event_type, subject_id, source_id)`.
- Evicts timestamps older than the sliding window (e.g. 10 minutes for account switching, 5 minutes for HMAC failures).
- Once threshold $N$ is reached, the alert is triggered and a **10-minute cooldown timer** is activated for that key.
- Subsequent violations during the cooldown increment a **suppressed event counter** instead of sending duplicate emails.

### Layer 2: Hourly Digest Bot (`_hourly_security_digest_scheduler`)
- Scheduled via native Python `asyncio` task started during FastAPI `lifespan`.
- Wakes up every 60 minutes.
- Checks operating schedule: **09:00 to 17:00 IST on Weekdays**. If outside window, skips execution.
- Queries `qr_audit_logs` for `created_at >= NOW() - 1 HOUR`.
- If zero events are found, it terminates silently (zero spam).
- If incidents occurred, it flushes the suppressed event counters from Layer 1 and sends a formatted HTML digest table to `SECURITY_ALERT_EMAIL`.

---

## 5. Dual-Channel SMTP Transport & Failover

```mermaid
flowchart LR
    A[Dispatch Request: send_single_email] --> B{Channel Specified?}
    B -- "OTP / AUTH" --> C[Route to Secondary SMTP: Zoho Mail port 465 SSL]
    B -- "DEFAULT" --> D[Route to Primary SMTP: Google Gmail port 587 TLS]
    
    C --> E{Delivery Success?}
    E -- Yes --> F[Return Status: SENT]
    E -- "Quota / RateLimit / Network Error" --> G["Failover to Primary: Google Gmail"]
    G --> H{Failover Success?}
    H -- Yes --> F
    H -- No --> I[Log Error & Return Status: FAILED]
    
    D --> J{Delivery Success?}
    J -- Yes --> F
    J -- "Quota / RateLimit / Network Error" --> K["Failover to Secondary: Zoho Mail"]
    K --> L{Failover Success?}
    L -- Yes --> F
    L -- No --> I
```

---

## 6. SRE Database Index Topology

To support 1,000+ simultaneous students scanning during morning class transitions without database exhaustion, 15 specialized B-tree indexes were provisioned on remote MySQL:

| Table | Index Name | Columns Indexed | Purpose |
| :--- | :--- | :--- | :--- |
| `device_account_bindings` | `idx_dev_bind_lookup` | `(device_id, binding_status, expires_at)` | Eliminates full table scan on 30-min device lockout check |
| `device_account_bindings` | `idx_dev_bind_user` | `(user_id, binding_status)` | Instant resolution of student active device bindings |
| `attendance_records` | `idx_att_rec_session_student` | `(session_id, student_id)` | Constant-time $O(1)$ duplicate attendance check |
| `attendance_records` | `idx_att_rec_student` | `(student_id, created_at)` | Fast aggregation for student monthly attendance percentages |
| `students` | `idx_student_section` | `(section_id)` | Eliminates table scans during classroom roster resolution |
| `students` | `idx_student_roll` | `(roll_number)` | $O(1)$ student lookup during HMAC and batch scanning |
| `qr_audit_logs` | `idx_audit_created_at` | `(created_at)` | High-speed range queries for hourly security digest |
| `qr_audit_logs` | `idx_audit_event_type` | `(event_type)` | Filtered audit analysis on specific security incidents |
