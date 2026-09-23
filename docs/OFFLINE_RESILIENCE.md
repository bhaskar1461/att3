# SNIST ERP — Offline & Flaky-Network Resilience Specification
**Week 9 Architecture & Operational Guide**
**Document Version:** 1.0 (Production Hardened)
**Effective Date:** September 11, 2026

---

## 1. Executive Summary

In high-density academic environments (such as engineering colleges with 7 departments and 250+ students moving between lecture halls, laboratories, and outdoor corridors), network reliability fluctuates drastically. In basement classrooms, legacy concrete halls, and high-contention Wi-Fi zones, network drops during or immediately after QR code acquisition are commonplace.

Week 9 introduces **end-to-end offline tolerance and network resilience** without compromising institutional anti-proxy integrity:
1. **Client-Side 3-Attempt Submit Retry with Exponential Backoff**: Immediate submit $\to$ 2s delay $\to$ 4s delay (~10s window).
2. **Persistent IndexedDB Submission Buffer**: Scans failing network calls are transparently stored in `snist_offline_attendance_db` with `localStorage` fallback.
3. **Bounded Server Submit-Grace Policy**: Server accepts offline-queued submissions up to `SUBMIT_GRACE_MINUTES = 10` after teacher locks the session.
4. **Strict Server-Authoritative Idempotency**: Re-submitting the same token 10 times in a network retry storm returns HTTP 200 `ALREADY_MARKED` with zero double-counting.
5. **Cached Session Hint**: Displays last known class details to students offline, eliminating blank screen confusion.
6. **Faculty Offline Manual Mark Buffer**: Faculty can continue marking students manually without internet; actions queue locally and synchronize once reconnected.

---

## 2. Client-Side Resilience Architecture

```
                       [ QR Scanned by Student ]
                                   │
                    ┌──────────────┴──────────────┐
              [ Device Online? ]            [ Device Offline ]
                    │                               │
           Yes ─────┴───── No                       │
            │              │                        │
  [ Attempt 1: Immediate ] │                        │
            │              │                        │
       Network Error?      │                        │
            │              │                        │
    [ Attempt 2: +2s ]     │                        │
            │              │                        │
       Network Error?      │                        │
            │              │                        │
    [ Attempt 3: +4s ]     │                        │
            │              │                        │
   All Retries Failed ─────┴────────────────────────┘
            │
            ▼
┌────────────────────────────────────────────────────────┐
│ IndexedDB Persistent Store (snist_offline_attendance)   │
│ - Unique client_id                                     │
│ - Encrypted / short session token                      │
│ - Device UUID & Student SAP ID                         │
│ - Local queue timestamp                                │
└────────────────────────────────────────────────────────┘
            │
      [ Event: Online / User Taps 'Retry Now' ]
            │
            ▼
┌────────────────────────────────────────────────────────┐
│ Background Auto-Flush (POST /student/scan-session)      │
│ - is_offline_submission: true                          │
│ - queued_at: timestamp                                 │
└────────────────────────────────────────────────────────┘
            │
     Server Evaluates:
     - Is session active OR within locked_at + 10 mins?
     - Single-use token cryptographically valid?
     - Device bound to student?
            │
    ┌───────┴───────┐
    ▼               ▼
 [ SUCCESS ]   [ ALREADY_MARKED ]
    │               │
    └───────┬───────┘
            ▼
  Remove from IndexedDB
```

### 2.1 Retry Loop Specification
When a student camera captures a valid QR payload:
- **Attempt 1**: Dispatched immediately.
- **Attempt 2**: Dispatched after $2\,000\text{ ms}$ if Attempt 1 encountered `TypeError: Failed to fetch` or socket termination.
- **Attempt 3**: Dispatched after $4\,000\text{ ms}$ if Attempt 2 failed.
- **Visual Feedback**: The modal viewfinder display dynamically updates with `"Submitting attendance... (Attempt X of 3)"`.
- **Terminal 4xx Guard**: Non-retryable errors (HTTP 403 Device Binding mismatch, Section mismatch, or invalid credentials) abort immediately without cycling retries.

### 2.2 Storage Hierarchy
- **Primary**: IndexedDB `snist_offline_attendance_db` (Store: `submissions`, indexed on `client_id` and `queued_at`).
- **Secondary Fallback**: If IndexedDB is blocked (e.g. strict private browsing or disabled storage), data automatically spills to `localStorage` key `snist_offline_submissions_backup`.

---

## 3. Server-Side Bounded Submit-Grace Policy

### 3.1 Policy Configuration (`backend/app/core/config.py`)
```python
SUBMIT_GRACE_MINUTES: int = 10
```

### 3.2 Verification Logic (`backend/app/api/student.py`)
When a submission arrives with `is_offline_submission = True`:
```python
if session.is_locked:
    grace_limit = (session.locked_at or session.created_at) + timedelta(minutes=settings.SUBMIT_GRACE_MINUTES)
    if now_ist > grace_limit:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Attendance session expired and exceeded offline submit grace window ({settings.SUBMIT_GRACE_MINUTES} min)."
        )
```
- Active sessions always accept submissions within valid token lifespan.
- Locked sessions accept submissions strictly until `session.locked_at + 10 minutes`.
- Submissions arriving at $+10\text{m }01\text{s}$ are permanently rejected with HTTP 400.

---

## 4. Anti-Proxy Security Preservation Analysis

A core institutional concern when introducing offline tolerance is whether bad actors can bypass anti-proxy controls. The table below details why the bounded submit-grace policy introduces **zero security degradation**:

| Vector | Potential Risk | SNIST ERP Mitigation | Verdict |
| :--- | :--- | :--- | :--- |
| **Replay / Multi-Submit** | Student sends same token multiple times or shares screenshot | Tokens are single-use per student. Server checks `AttendanceRecord(student_id, session_id)`. Subsequent requests return `ALREADY_MARKED` with zero extra periods. | **Immune** |
| **Remote Screenshot Sharing** | Student sends screenshot of QR to friend outside college | Short tokens rotate every 15–30 seconds. Even with offline delay, the token must be cryptographically valid for that slot issued by the faculty projector session. | **Immune** |
| **Account Switching** | Student scans for 5 friends on one device | Strict 30-minute device-to-student lock (`device_uuid` $\to$ `SAP ID`). Server rejects secondary accounts on same device with HTTP 403 Forbidden. | **Immune** |
| **Unbounded Late Mark** | Student queues a scan at 9:00 AM and submits at 5:00 PM | Hard server boundary: `locked_at + SUBMIT_GRACE_MINUTES (10m)`. Submissions arriving after +10m are rejected. | **Immune** |
| **Server Clock Tampering** | Client manipulates device clock to appear within window | All validations use server-authoritative IST (`Asia/Kolkata`) / UTC time. Client timestamps are ignored for validity calculations. | **Immune** |

---

## 5. Faculty Offline Manual Mark Queue

When faculty members conduct classes in areas with intermittent Wi-Fi, manual overrides in `ManualSearchModal` or `TeacherDashboard` do not fail:
1. If `apiRequest('/attendance/manual-mark')` throws a network failure or `!navigator.onLine`, the payload is appended to `snist_faculty_offline_manual_marks`.
2. The UI confirms: `"Saved offline: Roll 21051A0501 marked PRESENT (Will sync when online)"`.
3. An online listener (`window.addEventListener('online')`) and manual sync trigger automatically drains the queue with `POST /attendance/manual-mark`.
4. High-volume manual mark caps ($>15\%$ warning, $>30\%$ red flag) are preserved during sync.

---

## 6. Telemetry & Observability

Offline events are tracked in the centralized telemetry pipeline without logging student PII:
- Stage `attendance_queued_offline`: Emitted when scan is buffered locally.
- Stage `attendance_confirmed`: Emitted with `is_offline: true` once synced.
- Failure `network_error`: Logged when retries are exhausted before queueing.

This data feeds directly into the Scanner Health rollup and HOD Anomaly dashboard.
