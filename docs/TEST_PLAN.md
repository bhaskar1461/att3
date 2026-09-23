# SNIST ERP Attendance System — Test Plan

## 1. Purpose

This document defines the testing strategy for the SNIST ERP Attendance System.

The system must be tested as a security-sensitive institutional application.

Testing must cover:

- Authentication
- Authorization
- Teaching Assignment validation
- Attendance sessions
- QR generation
- QR expiration
- QR replay protection
- Device binding
- GPS/geofence validation
- Duplicate prevention
- Camera failure recovery
- Controlled fallback
- Selfie collection
- Audit logging
- API security
- Concurrency
- PWA/browser compatibility
- Future face-processing integration

---

# 2. Testing Philosophy

The system should not be considered complete because:

```text
"the UI works"
```

It is complete only when:

```text
UI works
+
API works
+
database constraints work
+
security controls work
+
failure paths work
+
concurrent requests work
+
audit trail works
```

---

# 3. Test Layers

```text
                    Test Pyramid

                       E2E
                        /\
                       /  \
                      /    \
                     /      \
                Integration
                   /      \
                  /        \
                 /          \
              Unit Tests
```

Required layers:

- Unit tests
- Integration tests
- API tests
- Database tests
- Security tests
- Browser/device tests
- End-to-end tests
- Load/concurrency tests

---

# 4. Test Environments

Recommended:

```text
Development
    |
    v
Test
    |
    v
Staging
    |
    v
Production
```

Do not perform destructive testing directly against production.

---

# 5. Production Data Rule

Tests must never:

- `DELETE` production attendance
- `RESET` production database
- `DROP` production tables
- `MODIFY` real student records

Use:

- synthetic students
- test faculty accounts
- staging database
- isolated test sessions

---

# 6. Test Data

Create a controlled dataset containing:

- **Students**: 252+ test students
- **Departments**: 7 test departments
- **Faculty**: multiple faculty accounts
- **Subjects**: multiple subjects
- **Sections**: multiple sections
- **Teaching Assignments**: multiple assignments
- **Devices**: registered, unregistered, revoked
- **Attendance Sessions**: active, closed, expired, previous/missed

The exact production population should not be copied into test environments unless formally approved.

---

# 7. Test Users

Minimum:

- `student_01`
- `student_02`
- `student_03`
- `faculty_01`
- `faculty_02`
- `admin_01`
- `super_admin_01`

Special accounts:

- `inactive_student`
- `inactive_faculty`
- `revoked_device_student`
- `student_without_device`
- `student_from_wrong_section`

---

# 8. Test ID Convention

Use:

`TC-001`, `TC-002`, `TC-003`...

Categories:

- `AUTH-`
- `AUTHZ-`
- `SESSION-`
- `QR-`
- `DEVICE-`
- `GPS-`
- `ATT-`
- `CAM-`
- `SELFIE-`
- `AUDIT-`
- `API-`
- `SEC-`
- `LOAD-`
- `E2E-`
- `FACE-`

Example:

- `QR-001`
- `GPS-014`
- `ATT-023`

---

# 9. Test Result States

Each test should be marked:

- `PASS`
- `FAIL`
- `BLOCKED`
- `NOT RUN`

A failed security test must not be ignored simply because the happy path works.

---

# 10. Unit Testing

Unit tests should cover isolated business logic.

Required:

- QR signing
- QR verification
- QR expiration
- QR canonicalization
- Haversine calculation
- Geofence decision
- Device validation
- Attendance eligibility
- Duplicate handling
- Error mapping
- Input validation

---

# 11. QR Unit Tests

### QR-001 — Valid Signature
Input: Valid payload, Correct HMAC secret  
Expected: Signature valid

### QR-002 — Modified Payload
Change: `session_id`  
Expected: Signature invalid

### QR-003 — Modified Timestamp
Change timestamp/window.  
Expected: Signature invalid

### QR-004 — Modified Nonce
Change nonce.  
Expected: Signature invalid

### QR-005 — Invalid Signature
Use random signature.  
Expected: `QR_INVALID`

### QR-006 — Expired Token
Use valid signature but expired timestamp.  
Expected: `QR_EXPIRED`

### QR-007 — Future Token
Use a token outside the acceptable time window.  
Expected: `QR_INVALID` or appropriate time-window error.

### QR-008 — Wrong Session
Use valid QR from Session A against Session B.  
Expected: `QR_INVALID`

### QR-009 — Malformed Token
Submit malformed QR data.  
Expected: `400 / QR_INVALID` (No server crash)

### QR-010 — Timing-Safe Comparison
Verify that signature comparison uses a secure comparison mechanism.  
Expected: No direct insecure comparison implementation.

---

# 12. QR Replay Tests

### QR-011 — Reuse Valid Token
Submit the same valid token twice.  
Expected: First: success, Second: rejected / duplicate / replay

### QR-012 — Reuse After Expiration
Capture token and wait until expiration.  
Expected: `QR_EXPIRED`

### QR-013 — Token From Previous Session
Use token from a closed/old session.  
Expected: rejected

---

# 13. Session Tests

### SESSION-001 — Create Valid Session
Faculty with authorized Teaching Assignment.  
Expected: 201 Created, ACTIVE session

### SESSION-002 — Unauthorized Teaching Assignment
Faculty attempts to create session for another faculty's assignment.  
Expected: 403 Forbidden

### SESSION-003 — Invalid Teaching Assignment
Use nonexistent ID.  
Expected: 404 / validation error

### SESSION-004 — Missing GPS
Create session without location.  
Expected: rejected

### SESSION-005 — Invalid Latitude
Example: `latitude = 200`  
Expected: validation failure

### SESSION-006 — Invalid Longitude
Example: `longitude = 300`  
Expected: validation failure

### SESSION-007 — Invalid Accuracy
Example: `accuracy_m = -10`  
Expected: validation failure

### SESSION-008 — Close Session
Authorized faculty closes active session.  
Expected: `status = CLOSED`, `ended_at = server timestamp`

### SESSION-009 — Use Closed Session
Student submits attendance after session closure.  
Expected: `SESSION_CLOSED`

---

# 14. Server Time Tests

### TIME-001
Client sends incorrect timestamp.  
Expected: Server ignores it for security decisions.

### TIME-002
Client clock is one hour ahead.  
Expected: Attendance validation remains based on server time.

### TIME-003
Client clock is one hour behind.  
Expected: Attendance validation remains based on server time.

---

# 15. Device Tests

### DEVICE-001 — Register Device
Valid student registers device.  
Expected: ACTIVE device

### DEVICE-002 — Duplicate Device Registration
Same device registered twice.  
Expected: No duplicate device record.

### DEVICE-003 — Unregistered Device
Attendance submitted with unknown device.  
Expected: `DEVICE_NOT_REGISTERED`

### DEVICE-004 — Revoked Device
Attendance submitted with revoked device.  
Expected: `DEVICE_REVOKED`

### DEVICE-005 — Device Belongs to Another Student
Student A attempts to submit using Student B's device.  
Expected: rejected

### DEVICE-006 — Device Reset
Valid reset/revocation workflow.  
Expected: Old device: `REVOKED`, New device: `ACTIVE`. Audit event must exist.

---

# 16. GPS Tests

### GPS-001 — Valid Location Inside 100m
Student location: `distance < 100m`  
Expected: accepted

### GPS-002 — Outside 100m
Student location: `distance > 100m`  
Expected: `OUTSIDE_GEOFENCE`

### GPS-003 — Boundary
Student location approximately: `distance = geofence radius`  
Expected: Result follows documented boundary rule (must be deterministic).

### GPS-004 — Fake Client Distance
Client sends `{"distance_from_session_m": 1}` while actual coordinates are 500m away.  
Expected: Backend ignores client distance.

### GPS-005 — Missing GPS
No coordinates.  
Expected: `GPS_REQUIRED`

### GPS-006 — Invalid Coordinates
Expected: validation failure

### GPS-007 — Poor Accuracy
Location accuracy exceeds configured acceptable range.  
Expected: `GPS_INACCURATE` if policy requires rejection.

### GPS-008 — IP Location Mismatch
GPS is inside geofence but IP appears geographically elsewhere.  
Expected: IP mismatch does not automatically override GPS. The event may be logged for investigation.

---

# 17. Haversine Tests

Use known coordinate pairs. Test:
- same point
- nearby points
- 100m boundary
- 1km distance
- large geographic distance

Expected: distance calculation within accepted numerical tolerance.

---

# 18. Attendance Tests

### ATT-001 — Valid Attendance
Requirements: Authenticated student, Valid session, Valid QR, Eligible student, Active device, Valid GPS, Inside geofence, Not duplicate.  
Expected: `PRESENT`

### ATT-002 — Missing Authentication
Expected: `401`

### ATT-003 — Wrong Student Eligibility
Student not belonging to section/assignment.  
Expected: `STUDENT_NOT_ELIGIBLE`

### ATT-004 — Duplicate Attendance
Submit same student/session twice.  
Expected: First: `PRESENT`, Second: `DUPLICATE_ATTENDANCE`

### ATT-005 — Concurrent Duplicate
Send multiple simultaneous requests.  
Expected: Exactly one attendance record.

### ATT-006 — Invalid QR
Expected: `QR_INVALID`

### ATT-007 — Expired QR
Expected: `QR_EXPIRED`

### ATT-008 — Outside Geofence
Expected: `OUTSIDE_GEOFENCE`

### ATT-009 — Closed Session
Expected: `SESSION_CLOSED`

---

# 19. Database Constraint Tests

Verify:

`UNIQUE(student_id, session_id)`

Attempt:

- `INSERT attendance`
- `INSERT same attendance`

Expected: Second insert rejected.

---

# 20. Transaction Tests

Simulate failure after `attendance insert` but before `audit insert`.

Expected behavior must follow the defined transaction strategy.

For the primary attendance transaction:
Either: `attendance + required audit` or `nothing committed` depending on implementation.

No inconsistent partial state should remain.

---

# 21. Authorization Tests

### AUTHZ-001
Student accesses another student's attendance.  
Expected: `403` / appropriate denial

### AUTHZ-002
Faculty accesses another faculty's session.  
Expected: `403`

### AUTHZ-003
Faculty modifies another faculty's Teaching Assignment.  
Expected: `403`

### AUTHZ-004
Student attempts to create attendance session.  
Expected: `403`

### AUTHZ-005
Normal faculty accesses super-admin endpoint.  
Expected: `403`

---

# 22. IDOR Tests

Change `attendance_id`, `session_id`, `device_id`, `selfie_id` to another user's identifiers.

Expected: No unauthorized data returned.

---

# 23. Authentication Tests

Test:

- valid credentials
- invalid credentials
- expired token
- missing token
- revoked token
- malformed token
- session timeout
- logout

Expected: Protected endpoints remain inaccessible without valid authentication.

---

# 24. API Input Validation

Test:

- missing fields
- extra unexpected fields
- wrong types
- oversized strings
- invalid UUID
- invalid coordinates
- negative values
- NaN
- Infinity
- null values
- empty strings

The API must fail safely.

---

# 25. Camera Tests

The camera system is especially important because real devices have different browser behavior.

Test:

- permission granted
- permission denied
- permission previously blocked
- no camera
- front camera
- rear camera
- camera switching
- camera initialization failure
- black stream
- stream interrupted
- camera already in use
- browser refresh
- tab switch
- screen lock/unlock

---

# 26. Camera Permission Denied

Expected UI:

```text
Camera unavailable
        |
        +-- Explain permission
        +-- Retry
        +-- Open browser permission guidance
        +-- Controlled fallback if allowed
```

The user should not be trapped in an infinite loading state.

---

# 27. Camera Black Screen

Simulate: Camera stream exists but video frames are unusable.

Expected:

```text
Black/invalid stream detected
        |
        v
Recovery state
```

The system should not remain indefinitely in `SCANNING` without actual usable frames.

---

# 28. Camera Switch

Test: `rear -> front`, `front -> rear`

Expected: Old MediaStream stopped, New MediaStream initialized. No camera stream should remain unnecessarily active.

---

# 29. Camera Recovery Timeout

Use the configured recovery period (Initial target: ~30 seconds).

Expected:

```text
camera recovery
      |
      v
successful recovery OR controlled fallback
```

The exact timing should be configurable.

---

# 30. Camera Fallback Tests

### CAM-001
Camera fails.  
Expected: Fallback becomes available according to policy.

### CAM-002
Fallback skips GPS.  
Expected: Request rejected.

### CAM-003
Fallback skips device validation.  
Expected: Request rejected.

### CAM-004
Fallback uses invalid QR.  
Expected: Request rejected.

### CAM-005
Fallback valid request.  
Expected: `PRESENT`, `attendance_method = QR_CAMERA_FALLBACK`

---

# 31. Attendance Method Integrity

Test that:
- Camera workflow -> `QR_CAMERA`
- Fallback workflow -> `QR_CAMERA_FALLBACK`

The frontend must not be able to arbitrarily submit `attendance_method = QR_CAMERA` for a fallback request.

---

# 32. Selfie Tests

### SELFIE-001 — Valid Selfie
Expected: Upload accepted, Selfie record created

### SELFIE-002 — Invalid MIME Type
Upload: `.exe`, `.pdf`, `.js`  
Expected: Rejected

### SELFIE-003 — Oversized File
Expected: Rejected

### SELFIE-004 — Malformed Image
Expected: Rejected without server crash.

### SELFIE-005 — Multiple Faces
Expected: Quality rejection if exactly-one-face validation is enabled.

### SELFIE-006 — No Face
Expected: Quality rejection

### SELFIE-007 — Selfie Failure After Attendance
Expected: Attendance: `PRESENT`, Selfie: `FAILED`. Attendance remains valid.

---

# 33. Selfie Authorization

Student A attempts to upload a selfie to Student B's `attendance_id`.

Expected: `403`

---

# 34. Selfie Storage Tests

Verify:
- object is private
- object key is server-generated
- no path traversal
- no public URL
- signed URL expires if used

---

# 35. Audit Tests

Every important event should generate the expected audit entry.

Test:
- session creation
- QR validation failure
- QR replay
- device rejection
- GPS rejection
- attendance creation
- duplicate attendance
- fallback
- selfie upload
- device revocation
- admin override

---

# 36. Audit Integrity

Verify that students cannot:
- delete audit logs
- modify audit logs

Faculty should also have restricted audit access.

---

# 37. Audit Completeness

For a successful attendance, it should be possible to reconstruct:
- Who
- Which session
- Which student
- Which device
- Which QR
- Which location evidence
- Distance
- Method
- Server timestamp
- Selfie status

without relying on frontend logs.

---

# 38. Rate-Limit Tests

Test repeated:
- invalid QR requests
- attendance submissions
- device registrations
- selfie uploads
- authentication attempts

Expected: `429 Too Many Requests` after the configured threshold. The system should recover after the appropriate cooldown.

---

# 39. Rate-Limit Bypass Tests

Test variations:
- different request IDs
- different headers
- different payloads
- rapid retries
- parallel requests

Verify that attackers cannot trivially bypass the intended rate limiter.

---

# 40. API Security Tests

Test for:
- SQL injection
- XSS payloads
- path traversal
- command injection
- SSRF where applicable
- oversized payloads
- malformed JSON
- HTTP method abuse

The API should reject malicious input safely.

---

# 41. SQL Injection

Try malicious values in:
- `session_id`
- `student_id`
- `search`
- `filters`
- `pagination`
- `subject`
- `department`

Expected: No SQL execution from user input. No database corruption.

---

# 42. XSS

Use payloads in fields such as:
- student name
- subject name
- session metadata
- audit filters

Expected: Rendered safely. No script execution.

---

# 43. Path Traversal

Attempt: `../../file` through selfie filenames or other file-related fields.

Expected: Server-generated storage key. No arbitrary filesystem access.

---

# 44. Authentication Abuse

Test:
- brute-force login
- token replay
- expired tokens
- tampered JWT
- wrong signature

Expected: Authentication remains secure.

---

# 45. Privacy Tests

Verify that:
- Student A cannot access Student B's selfie
- Student cannot access face embeddings
- Student cannot access audit logs
- Faculty cannot access unauthorized biometric data
- Public user cannot access private images

---

# 46. PWA Tests

Test:
- install
- uninstall
- refresh
- offline
- online
- network transition
- service worker update
- cache invalidation
- camera after PWA launch
- GPS after PWA launch

---

# 47. Offline Attendance Test

Disable network.

Expected:
- UI may remain available
- attendance must not be silently marked as server-valid

When network returns: system follows the explicitly designed synchronization behavior.

---

# 48. Network Failure Tests

Simulate:
- slow network
- network loss during QR scan
- network loss after scan
- API timeout
- server 500
- server 503

The frontend must not display false success.

---

# 49. False Success Test

Critical test: Request submitted, network fails.

Expected: Attendance status remains `UNKNOWN/PENDING` on client until server confirmation is received.

Never show: "Attendance marked successfully" without authoritative server confirmation.

---

# 50. Projector Tests

Test QR displayed on:
- projector
- large screen
- laptop display
- phone display

Test:
- different distances
- different brightness
- different screen sizes

Verify that QR size and contrast remain readable.

---

# 51. Browser Compatibility

At minimum test supported versions of:
- Chrome Android
- Chrome Desktop
- Safari iOS
- Safari macOS
- Edge
- Firefox where supported

Special focus:
- Android camera behavior
- Realme devices
- Samsung devices
- Xiaomi devices
- OnePlus devices
- iPhones

The exact support matrix should be documented after real-device testing.

---

# 52. Realme Camera Test Matrix

Because camera issues have already been observed on Realme devices, explicitly test:

- Realme + Chrome
- Realme + default browser
- Realme + Android version variations
- Camera permission first request
- Camera permission previously denied
- Camera permission permanently blocked
- Front camera
- Rear camera
- Switch camera
- PWA mode
- Normal browser mode

Record:
- device model
- Android version
- browser version
- camera result
- error code

---

# 53. Mobile GPS Tests

Test:
- GPS enabled
- GPS disabled
- Approximate location
- Precise location
- Weak indoor GPS
- Outdoor GPS
- Permission denied
- Permission revoked
- Location timeout

The application should provide clear recovery instructions.

---

# 54. Large Hall Test

Test the actual intended environment:
- Faculty projector
- Large QR
- Students seated at different distances
- Multiple simultaneous scanners
- Mixed Android devices
- iPhones
- Poor Wi-Fi/mobile network

Measure:
- QR detection success
- time to scan
- API latency
- GPS acquisition time
- attendance completion rate
- camera failure rate

---

# 55. Load Testing

Expected initial population: ~252 students.

Test simultaneous scanning:
- 50 concurrent
- 100 concurrent
- 200 concurrent
- 252 concurrent

Measure:
- p50 latency
- p95 latency
- p99 latency
- error rate
- database CPU
- database connections
- Redis load
- API CPU/memory

---

# 56. Burst Test

Simulate 200+ students attempting attendance within 10–30 seconds.

Expected:
- No duplicate attendance
- No database corruption
- No unacceptable timeout rate

---

# 57. Database Connection Test

Under load verify:
- connection pool
- max connections
- query latency
- transaction contention
- deadlocks

Tune based on measurement rather than guesses.

---

# 58. Redis Failure Test

Temporarily make Redis unavailable.

Determine which features should fail closed and which may continue.

For example: Final attendance database transaction must remain authoritative. Redis should not be the only storage location for attendance.

---

# 59. Database Failure Test

If MySQL is unavailable:

Expected: No false attendance success. The API should return an appropriate service error.

---

# 60. Object Storage Failure

If selfie storage fails:

Expected: Attendance remains `PRESENT`, Selfie status = `FAILED` (assuming attendance has already been accepted).

---

# 61. Face Service Failure

Future behavior:

```text
Face service unavailable
        |
        v
QR attendance remains valid
```

during the initial integration phase. The event should be logged.

---

# 62. End-to-End Test

Full flow:

```text
Faculty Login
    |
    v
Select Teaching Assignment
    |
    v
Capture Faculty GPS
    |
    v
Start Session
    |
    v
Display Rotating QR
    |
    v
Student Login
    |
    v
Device Validation
    |
    v
Camera Permission
    |
    v
Scan QR
    |
    v
Student GPS
    |
    v
Backend Validation
    |
    v
Attendance Success
    |
    v
Selfie
    |
    v
Audit
```

Expected:
- One attendance record
- Complete audit trail
- Correct selfie relationship

---

# 63. End-to-End Fallback Test

```text
Student Login
    |
    v
Camera fails
    |
    v
Retry
    |
    v
Camera still unavailable
    |
    v
Controlled fallback
    |
    v
Valid QR
    |
    v
Valid device
    |
    v
Valid GPS
    |
    v
Attendance
    |
    v
Selfie
```

Expected: `PRESENT`, `method = QR_CAMERA_FALLBACK`

---

# 64. Negative End-to-End Test 1

Attempt: Camera failure + invalid QR + inside geofence  
Expected: Attendance rejected.

---

# 65. Negative End-to-End Test 2

Attempt: Valid QR + valid device + outside geofence  
Expected: Attendance rejected.

---

# 66. Negative End-to-End Test 3

Attempt: Valid QR + valid GPS + revoked device  
Expected: Attendance rejected.

---

# 67. Negative End-to-End Test 4

Attempt: Valid QR + valid device + valid GPS + student not eligible  
Expected: Attendance rejected.

---

# 68. Security Regression Suite

Every production release must run:
- QR tests
- Authorization tests
- GPS tests
- Device tests
- Duplicate tests
- Selfie authorization tests
- API input tests
- Rate-limit tests

A release must not proceed if critical security tests fail.

---

# 69. Migration Tests

For every database migration:
- Fresh database
- Existing database
- Existing production-like data
- Rollback where supported
- Application startup
- Existing queries
- New queries

Verify that existing ERP functionality remains intact.

---

# 70. Existing ERP Regression Tests

Attendance changes must not break:
- Login
- Users
- Students
- Faculty
- Subjects
- Sections
- Teaching Assignments
- Timetable
- Help Desk
- Other existing ERP modules

Run existing project tests before merging.

---

# 71. API Contract Tests

Verify that API responses match:
- OpenAPI specification
- Pydantic schemas
- Frontend expectations

Breaking changes must be deliberate and versioned.

---

# 72. Frontend State Tests

Test states:

- `INITIAL`
- `REQUESTING_PERMISSION`
- `CAMERA_INITIALIZING`
- `SCANNING`
- `CAMERA_FAILED`
- `RECOVERING`
- `FALLBACK_AVAILABLE`
- `SUBMITTING`
- `SUCCESS`
- `ERROR`
- `SELFIE`
- `SELFIE_FAILED`

Every state should have a defined UI.

---

# 73. No Infinite Loading

Test:
- camera never initializes
- GPS never resolves
- API never responds
- selfie upload never completes

Expected: Timeout, Recovery UI, Retry, Safe error state.  
Never leave the user indefinitely in `Loading...`.

---

# 74. Security Invariants

The following must always remain true:

- **INVARIANT-01**: Frontend cannot directly create PRESENT attendance.
- **INVARIANT-02**: Student cannot mark attendance for another student.
- **INVARIANT-03**: Faculty cannot create sessions for unauthorized Teaching Assignments.
- **INVARIANT-04**: Expired QR cannot be accepted.
- **INVARIANT-05**: Invalid QR cannot be accepted.
- **INVARIANT-06**: Outside-geofence student cannot be accepted.
- **INVARIANT-07**: Revoked device cannot be accepted.
- **INVARIANT-08**: Duplicate student/session attendance cannot exist.
- **INVARIANT-09**: Selfie failure cannot erase valid attendance.
- **INVARIANT-10**: Private selfie data cannot be publicly accessed.

---

# 75. Face Pipeline Testing

Future face tests:

- `FACE-001`: No face
- `FACE-002`: One face
- `FACE-003`: Multiple faces
- `FACE-004`: Poor quality
- `FACE-005`: Valid embedding
- `FACE-006`: Embedding failure
- `FACE-007`: Correct 1:1 match
- `FACE-008`: Incorrect 1:1 match
- `FACE-009`: Model unavailable
- `FACE-010`: Model version mismatch
- `FACE-011`: Liveness pass
- `FACE-012`: Liveness failure
- `FACE-013`: Photo replay
- `FACE-014`: Video replay

Face tests must remain separate from the MVP attendance test suite until face verification becomes an attendance dependency.

---

# 76. Face Threshold Testing

For a candidate threshold, do not ask: "Does 0.8 look good?"  
Instead measure:
- False Accept Rate
- False Reject Rate
- ROC/DET behavior
- Population variation
- Device variation
- Lighting variation

Then document the chosen operating point.

---

# 77. Test Dataset Security

Face test datasets must be protected:
- Do not commit student selfies to Git
- Do not share datasets publicly
- Do not put real biometric data in screenshots
- Do not use production selfies in developer environments unnecessarily

Use synthetic/de-identified data wherever possible.

---

# 78. Performance Acceptance Criteria

Initial targets:
- **API attendance processing**: ~2–3 seconds target excluding GPS/camera/network acquisition
- **QR generation**: fast enough for smooth rotation
- **Database**: supports expected classroom burst
- **Frontend**: no visible scanner lag under normal supported devices

These are initial engineering targets and must be validated under real conditions.

---

# 79. Bug Severity

### P0 — Critical (Release Blocker)
Examples: Unauthorized attendance creation, Authentication bypass, Database corruption, Mass data exposure, HMAC secret exposure, Public selfie access.

### P1 — High (Normally Release Blocker)
Examples: Duplicate attendance, Geofence bypass, Authorization failure, Major device compatibility failure.

### P2 — Medium
Examples: Recovery UX problem, Some devices require retry, Non-critical analytics issue.

### P3 — Low
Examples: Visual issue, Minor wording, Non-critical UI inconsistency.

---

# 80. Release Gate

Production release requires:

- [ ] All P0 bugs resolved
- [ ] All P1 bugs resolved or explicitly accepted
- [ ] Critical security tests passing
- [ ] Database migration tested
- [ ] Backup verified
- [ ] Rollback plan available
- [ ] Load test completed
- [ ] Real-device camera testing completed
- [ ] GPS testing completed
- [ ] Selfie storage tested
- [ ] Monitoring enabled

---

# 81. Four-Day MVP Test Strategy

### Day 1
Test:
- Session creation
- Faculty GPS
- QR generation
- QR expiration
- QR validation

### Day 2
Test:
- Student eligibility
- Device binding
- GPS
- Geofence
- Duplicate prevention
- Transactions

### Day 3
Test:
- Camera permissions
- Realme devices
- Camera recovery
- Camera switching
- Fallback

### Day 4
Test:
- Selfie
- Object storage
- Audit
- End-to-end flow
- Security regression
- Deployment smoke tests

---

# 82. Real Device Test Matrix

| Device | Android/iOS | Browser | Camera | GPS | QR | Selfie | Result |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Realme | version | Chrome | | | | | |
| Samsung | version | Chrome | | | | | |
| Xiaomi | version | Chrome | | | | | |
| OnePlus | version | Chrome | | | | | |
| iPhone | iOS | Safari | | | | | |

Record actual results instead of assuming compatibility.

---

# 83. Regression Checklist

Before every release:

- [ ] Login
- [ ] Student dashboard
- [ ] Faculty dashboard
- [ ] Teaching Assignment
- [ ] Session creation
- [ ] QR
- [ ] Student scan
- [ ] GPS
- [ ] Device
- [ ] Attendance
- [ ] Duplicate prevention
- [ ] Selfie
- [ ] Audit
- [ ] Existing Help Desk
- [ ] Timetable

---

# 84. Test Evidence

For failed tests, record:
- Test ID
- Date
- Environment
- Device
- Browser
- Request ID
- Expected result
- Actual result
- Screenshot/log
- Severity
- Developer notes

Do not include secrets or unnecessary personal information in evidence.

---

# 85. Automated CI Tests

CI should run at minimum:
- Lint
- Type checking
- Unit tests
- API tests
- Database tests
- Security regression tests
- Build

Future:
- E2E browser tests
- Container security scan
- Dependency scan

---

# 86. CI Failure Policy

If unit tests fail, type checking fails, or security tests fail, the build should fail.  
Do not bypass CI with `--no-verify` or equivalent mechanisms merely to deploy.

---

# 87. Staging Smoke Test

After deployment to staging:
1. Login
2. Create session
3. Display QR
4. Student scan
5. GPS validation
6. Attendance
7. Selfie
8. Audit
9. Close session
10. Verify database

---

# 88. Production Smoke Test

After production deployment, use dedicated test accounts. Verify:
- Health
- Authentication
- Session creation
- QR
- Attendance
- Selfie
- Audit

Do not test against real student attendance records.

---

# 89. Post-Deployment Monitoring

For the first deployment, monitor:
- API latency
- 4xx
- 5xx
- QR failures
- GPS failures
- Device failures
- Camera failures
- Fallback usage
- Selfie failures
- Database connections
- CPU
- RAM
- Redis
- Object storage

---

# 90. Final Test Definition of Done

The MVP is test-complete when:

- [ ] Unit tests passing
- [ ] Integration tests passing
- [ ] API tests passing
- [ ] Database constraints tested
- [ ] Authentication tested
- [ ] Authorization tested
- [ ] QR security tested
- [ ] Replay tested
- [ ] GPS tested
- [ ] Geofence tested
- [ ] Device binding tested
- [ ] Duplicate race tested
- [ ] Camera recovery tested
- [ ] Fallback tested
- [ ] Selfie upload tested
- [ ] Audit tested
- [ ] Privacy tested
- [ ] Real-device testing completed
- [ ] Realme compatibility tested
- [ ] Large-hall projector test completed
- [ ] Concurrent load test completed
- [ ] Existing ERP regression tests passing
- [ ] Staging deployment verified
- [ ] Production smoke-test plan ready

---

# 91. Final Testing Principle

The most important test is not:

```text
"Can a student mark attendance?"
```

It is:

```text
"Can only an authorized student,
using a valid session and valid QR,
from acceptable device and location evidence,
create exactly one attendance record,
while every important decision remains auditable?"
```

That is the standard the attendance system must meet before production rollout.

---

# 92. Cryptographic Device Identity Test Suite (`test_cryptographic_device_identity.py`)

The cryptographic device identity system is verified by 11 rigorous automated test cases:

```text
┌────┬──────────────────────────────────────────┬──────────────────────────────────────────────────────────┐
│ #  │ Test Case                                │ Security Invariant Verified                              │
├────┼──────────────────────────────────────────┼──────────────────────────────────────────────────────────┤
│ 1  │ test_ten_identical_phone_models_...      │ 10 identical Samsung Galaxy A55s on same Wi-Fi IP        │
│    │                                          │ must enroll & mark attendance with ZERO false collisions.│
│ 2  │ test_cross_student_key_reuse_rejection   │ Rejects public key reuse across student accounts (409).  │
│ 3  │ test_cross_student_possession_attempt_...│ Rejects student attempting possession of peer device(401)│
│ 4  │ test_forged_device_id_rejection          │ Rejects unmapped / forged device UUIDs (401).            │
│ 5  │ test_missing_signature_rejection_...     │ Rejects scan missing cryptographic signature (403).      │
│ 6  │ test_invalid_signature_rejection         │ Rejects signature signed with mismatched private key(401)│
│ 7  │ test_challenge_replay_rejection          │ Rejects reused challenge tokens/nonces (401 REPLAYED).   │
│ 8  │ test_expired_challenge_rejection         │ Rejects challenges past 60-second TTL (401 EXPIRED).     │
│ 9  │ test_revoked_device_rejection_and_...    │ Rejects revoked device; preserves historical attendance. │
│ 10 │ test_multi_device_limit_and_replace_...  │ Enforces 1 active device limit; supports replace_active. │
│ 11 │ test_untrusted_client_claims_rejected    │ Ignores client 'device_verified: true' without signature │
└────┴──────────────────────────────────────────┴──────────────────────────────────────────────────────────┘
```

Automated verification command:
```bash
python -m pytest tests/test_cryptographic_device_identity.py -v
```
All 11 tests must pass with 100% clean exit code 0 before any deployment.
