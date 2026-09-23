# SNIST ERP Attendance System — API Specification

## 1. Purpose

This document defines the API contract for the SNIST ERP Attendance System.

The API is responsible for:

- Authentication and authorization
- Faculty attendance-session creation
- Faculty geolocation capture
- Rotating QR generation
- QR validation
- Student attendance verification
- Device binding
- Student GPS validation
- Duplicate prevention
- Camera-failure fallback
- Selfie collection
- Audit logging
- Future face-verification integration

The backend is the **final authority** for attendance decisions.

---

# 2. API Architecture

Base URL:

```text
/api/v1
```

Conceptual architecture:

```text
React / TypeScript PWA
        |
        v
FastAPI
        |
        +---- Authentication
        +---- Session Service
        +---- QR Service
        +---- Device Service
        +---- Geolocation Service
        +---- Attendance Service
        +---- Selfie Service
        +---- Audit Service
        |
        v
MySQL
        |
        +---- Redis
        +---- Private Object Storage

Future:

FastAPI
   |
   v
Face Service
   |
   v
ONNX Runtime
```

---

# 3. API Principles

The API must follow these rules:

- HTTPS only in production.
- Authentication required for attendance operations.
- Authorization must be performed server-side.
- Frontend input is untrusted.
- Server time is authoritative.
- QR signatures are verified server-side.
- GPS distance is calculated server-side.
- Device binding is verified server-side.
- Duplicate attendance is prevented at the database level.
- Sensitive operations are rate-limited.
- Security events are audited.
- API responses must not expose secrets.
- Internal exceptions must not be returned directly to users.
- Attendance creation must be transactional.
- APIs must be idempotent where practical.

---

# 4. Authentication

The exact authentication mechanism must reuse the existing SNIST ERP authentication system.

Possible architecture:

```text
Student/Faculty
      |
      v
ERP Authentication
      |
      v
Authenticated Session / JWT
      |
      v
Attendance API
```

The attendance service must not create a second independent identity system if the ERP already provides one.

---

# 5. Authorization Roles

Initial roles:

- `STUDENT`
- `FACULTY`
- `ADMIN`
- `SUPER_ADMIN`

Possible permissions:

| Operation | Student | Faculty | Admin | Super Admin |
| :--- | :--- | :--- | :--- | :--- |
| View own attendance | Yes | No | Yes | Yes |
| Start attendance session | No | Yes | Yes | Yes |
| Close own session | No | Yes | Yes | Yes |
| Mark own attendance | Yes | No | Controlled | Controlled |
| View session records | No | Own | Yes | Yes |
| Manage devices | Own | No | Yes | Yes |
| View audit logs | No | Limited | Yes | Yes |
| Revoke device | Own request | No | Yes | Yes |
| Manage configuration | No | No | Limited | Yes |

Exact permissions must follow the existing ERP authorization model.

---

# 6. Standard Request Headers

Recommended:

```http
Authorization: Bearer <token>
Content-Type: application/json
X-Request-ID: <uuid>
```

For attendance requests, optionally:

```http
Idempotency-Key: <uuid>
```

`X-Request-ID` is useful for tracing.

Never place secrets such as:

- `HMAC_SECRET`
- `DATABASE_PASSWORD`
- `JWT_SIGNING_KEY`

in request headers from the frontend.

---

# 7. Standard Response Format

Success:

```json
{
  "success": true,
  "data": {}
}
```

Error:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "request_id": "uuid"
  }
}
```

Do not return stack traces.

---

# 8. HTTP Status Codes

Use standard HTTP status codes:

- `200 OK`
- `201 Created`
- `204 No Content`
- `400 Bad Request`
- `401 Unauthorized`
- `403 Forbidden`
- `404 Not Found`
- `409 Conflict`
- `422 Validation Error`
- `429 Too Many Requests`
- `500 Internal Server Error`
- `503 Service Unavailable`

---

# 9. Error Code Convention

Use stable machine-readable error codes.

Examples:

- `AUTH_REQUIRED`
- `FORBIDDEN`
- `INVALID_REQUEST`
- `SESSION_NOT_FOUND`
- `SESSION_CLOSED`
- `SESSION_EXPIRED`
- `QR_INVALID`
- `QR_EXPIRED`
- `QR_REPLAYED`
- `STUDENT_NOT_ELIGIBLE`
- `DEVICE_NOT_REGISTERED`
- `DEVICE_REVOKED`
- `GPS_REQUIRED`
- `GPS_INACCURATE`
- `OUTSIDE_GEOFENCE`
- `DUPLICATE_ATTENDANCE`
- `CAMERA_FAILURE`
- `SELFIE_UPLOAD_FAILED`
- `RATE_LIMITED`
- `INTERNAL_ERROR`

The frontend should branch on the error code rather than matching human-readable strings.

---

# 10. Faculty Session APIs

## 10.1 Create Attendance Session

`POST /attendance/sessions`

Authorization:

- `FACULTY`
- `ADMIN`
- `SUPER_ADMIN`

Request:

```json
{
  "teaching_assignment_id": "uuid",
  "latitude": 17.0000000,
  "longitude": 78.0000000,
  "accuracy_m": 12.5,
  "geofence_radius_m": 100
}
```

Important:

The frontend supplies location evidence, but the backend determines whether it is acceptable.

The backend assigns:

- `started_at`
- `session_id`
- `effective_geofence_radius`

using server time.

Response:

```json
{
  "success": true,
  "data": {
    "session_id": "uuid",
    "status": "ACTIVE",
    "started_at": "server-time",
    "geofence_radius_m": 100
  }
}
```

---

# 11. Faculty Authorization

When creating a session, the backend must verify:

```text
authenticated faculty
        |
        v
owns / teaches teaching_assignment_id
        |
        v
allowed to start session
```

A faculty member must not be able to create a session for an unrelated Teaching Assignment simply by modifying the request body.

---

# 12. Faculty Location Validation

The backend should validate:

- `latitude`
- `longitude`
- `accuracy`

Basic constraints:

- `latitude`: -90 to +90
- `longitude`: -180 to +180
- `accuracy_m` > 0

The backend should also apply the project's configured location-quality policy.

Do not trust:

`frontend_is_within_geofence = true`

as evidence.

---

# 13. Get Session

`GET /attendance/sessions/{session_id}`

Authorization:

- `FACULTY` / `ADMIN` / `SUPER_ADMIN`

Response:

```json
{
  "success": true,
  "data": {
    "session_id": "uuid",
    "status": "ACTIVE",
    "teaching_assignment_id": "uuid",
    "started_at": "server-time",
    "geofence_radius_m": 100
  }
}
```

Do not expose private information about students unnecessarily.

---

# 14. Close Attendance Session

`POST /attendance/sessions/{session_id}/close`

Authorization:

- `FACULTY` / `ADMIN` / `SUPER_ADMIN`

Backend verifies that the faculty is authorized to close the session.

Response:

```json
{
  "success": true,
  "data": {
    "session_id": "uuid",
    "status": "CLOSED",
    "ended_at": "server-time"
  }
}
```

---

# 15. QR Token Generation

`GET /attendance/sessions/{session_id}/qr`

Authorization:

- `FACULTY` / `ADMIN` / `SUPER_ADMIN`

The endpoint returns the currently valid QR payload.

Example:

```json
{
  "success": true,
  "data": {
    "session_id": "uuid",
    "token": "signed-token",
    "issued_at": "server-time",
    "expires_at": "server-time"
  }
}
```

The QR token should be short-lived.

Recommended initial lifetime:

~30 seconds

---

# 16. QR Rotation

The frontend may request refreshed QR data.

However:

Frontend QR timer must never be the source of truth.

The backend determines:

- `issued_at`
- `expires_at`
- `validity window`

The QR should rotate frequently enough to limit replay.

---

# 17. QR Token Construction

Conceptually:

```text
payload =
    session_id
    +
    timestamp_window
    +
    nonce
```

Signature:

```text
HMAC-SHA256(server_secret, canonical_payload)
```

The QR payload contains the signed information, not the secret.

---

# 18. QR Validation

QR validation is performed internally during attendance submission.

The server must verify:

1. Token format
2. Signature
3. Session ID
4. Timestamp/window
5. Expiration
6. Session status
7. Replay status

The client must never receive the HMAC secret.

---

# 19. Student Attendance Endpoint

Primary endpoint:

`POST /attendance/records`

Authorization:

- `STUDENT`

Request:

```json
{
  "session_id": "uuid",
  "qr_token": "signed-token",
  "device_id": "uuid",
  "latitude": 17.0000000,
  "longitude": 78.0000000,
  "accuracy_m": 10.5
}
```

Optional:

```json
{
  "idempotency_key": "uuid"
}
```

---

# 20. Attendance Validation Pipeline

The backend must validate in this general order:

```text
Authenticate
    |
    v
Authorize student
    |
    v
Validate request
    |
    v
Validate session
    |
    v
Validate QR
    |
    v
Validate student eligibility
    |
    v
Validate device
    |
    v
Validate GPS
    |
    v
Calculate distance
    |
    v
Check duplicate
    |
    v
Create attendance transaction
    |
    v
Create audit event
    |
    v
Return success
```

The exact ordering may be optimized, but no security validation may be skipped.

---

# 21. Student Eligibility

The backend must verify that the student belongs to the appropriate academic context.

Conceptually:

```text
student
    |
    v
section
    |
    v
teaching assignment
```

The student must not be able to mark attendance merely because they possess a valid QR.

---

# 22. Device Validation

The backend checks:

```text
authenticated student
        |
        v
submitted device identifier
        |
        v
registered active device
```

Possible responses:

- `DEVICE_NOT_REGISTERED`
- `DEVICE_REVOKED`

Device identifiers should be application-generated and securely represented.

---

# 23. Device Registration

Endpoint:

`POST /attendance/devices/register`

Authorization:

- `STUDENT`

Request:

```json
{
  "device_identifier": "client-generated-random-id",
  "platform": "Android",
  "browser": "Chrome"
}
```

The backend should normalize/hash the identifier before persistent storage where appropriate.

Response:

```json
{
  "success": true,
  "data": {
    "device_id": "uuid",
    "status": "ACTIVE"
  }
}
```

---

# 24. Device Reset

Endpoint:

`POST /attendance/devices/{device_id}/revoke`

Authorization:

- `STUDENT` / `ADMIN` / `SUPER_ADMIN`

Student self-service device resets may require additional verification depending on institutional policy.

Every reset must generate an audit event.

---

# 25. GPS Validation

The backend receives:

- `latitude`
- `longitude`
- `accuracy_m`

The backend then calculates:

```text
distance = Haversine(faculty_session_location, student_location)
```

Attendance is allowed only when:

```text
distance <= session.geofence_radius_m
```

---

# 26. Geofence Response

If outside the permitted area:

`403 Forbidden`

Response:

```json
{
  "success": false,
  "error": {
    "code": "OUTSIDE_GEOFENCE",
    "message": "You are outside the attendance area.",
    "request_id": "uuid"
  }
}
```

Do not reveal unnecessary precise coordinates or internal security information.

---

# 27. GPS Accuracy Failure

If location evidence does not meet the configured quality requirements:

```json
{
  "success": false,
  "error": {
    "code": "GPS_INACCURATE",
    "message": "Your location could not be verified accurately. Please try again.",
    "request_id": "uuid"
  }
}
```

The exact accuracy policy must be configurable and validated against real devices.

---

# 28. Duplicate Attendance

If the student is already marked:

`409 Conflict`

Response:

```json
{
  "success": false,
  "error": {
    "code": "DUPLICATE_ATTENDANCE",
    "message": "Attendance has already been recorded.",
    "request_id": "uuid"
  }
}
```

The backend should not create another record.

---

# 29. Successful Attendance

Response:

`201 Created`

Example:

```json
{
  "success": true,
  "data": {
    "attendance_id": "uuid",
    "status": "PRESENT",
    "method": "QR_CAMERA",
    "marked_at": "server-time",
    "selfie_required": true
  }
}
```

The response indicates that attendance has already been accepted.

---

# 30. Attendance Method

The backend must determine the method from the request/workflow.

Initial values:

- `QR_CAMERA`
- `QR_CAMERA_FALLBACK`

The client must not be able to arbitrarily submit:

```json
{
  "attendance_method": "QR_CAMERA"
}
```

and have the backend trust it.

The method must correspond to the actual server-recognized workflow.

---

# 31. Camera Failure Reporting

Endpoint:

`POST /attendance/camera-events`

Authorization:

- `STUDENT`

Request:

```json
{
  "session_id": "uuid",
  "event_type": "CAMERA_INITIALIZATION_FAILED",
  "details": {
    "browser": "Chrome",
    "platform": "Android"
  }
}
```

Allowed event types should be whitelisted.

Do not accept arbitrary executable or unbounded metadata.

---

# 32. Camera Recovery State

The frontend should maintain a state machine.

Example:

```text
CAMERA_INITIALIZING
        |
        +---- SUCCESS ----> SCANNING
        |
        +---- FAILURE ----> RECOVERY
                              |
                              +---- RETRY
                              |
                              +---- SWITCH_CAMERA
                              |
                              +---- SUCCESS
                              |
                              +---- TIMEOUT
                                      |
                                      v
                                   FALLBACK
```

The server should record relevant events but should not depend on frontend state alone for security.

---

# 33. Fallback Attendance

The fallback path must still require:

- Authentication
- Session validity
- QR validation
- Student eligibility
- Device validation
- GPS validation
- Geofence validation
- Duplicate prevention

The fallback is not:

"No camera = automatically present"

---

# 34. Fallback Endpoint

If a separate endpoint is required:

`POST /attendance/records/fallback`

Authorization:

- `STUDENT`

Request:

```json
{
  "session_id": "uuid",
  "qr_token": "signed-token",
  "device_id": "uuid",
  "latitude": 17.0000000,
  "longitude": 78.0000000,
  "accuracy_m": 12.0
}
```

The server performs the same core validation pipeline.

The final record is:

`attendance_method = QR_CAMERA_FALLBACK`

---

# 35. Do Not Create a Security-Loophole Fallback

Never implement:

```text
camera failed
    |
    v
skip QR
    |
    v
skip GPS
    |
    v
mark present
```

This would bypass the main attendance security controls.

---

# 36. Selfie Upload

After successful attendance:

`POST /attendance/records/{attendance_id}/selfie`

Authorization:

- `STUDENT`

Recommended:

`multipart/form-data`

Example fields:

`file=<image>`

The backend verifies:

```text
authenticated student
        |
        v
attendance exists
        |
        v
attendance belongs to student
        |
        v
selfie not already finalized
```

---

# 37. Selfie Upload Response

Success:

```json
{
  "success": true,
  "data": {
    "selfie_id": "uuid",
    "status": "RECEIVED"
  }
}
```

The backend should not expose the private storage URL directly unless a controlled signed URL is generated.

---

# 38. Selfie Validation

Minimum validation:

- Valid MIME type
- Valid image structure
- Maximum file size
- Minimum resolution
- Exactly one face where detection is available
- Basic quality checks

Example accepted MIME types:

- `image/jpeg`
- `image/webp`

Do not accept arbitrary files merely because the frontend labels them as images.

---

# 39. Selfie Failure

If selfie upload fails:

Attendance remains `PRESENT`

The API should return a specific error:

```json
{
  "success": false,
  "error": {
    "code": "SELFIE_UPLOAD_FAILED",
    "message": "The selfie could not be uploaded. Please try again.",
    "request_id": "uuid"
  }
}
```

The attendance record remains valid.

---

# 40. Selfie Retry

Endpoint:

`POST /attendance/records/{attendance_id}/selfie`

The same endpoint can support controlled retries.

The backend should enforce a reasonable retry/rate limit.

---

# 41. Attendance Status

Endpoint:

`GET /attendance/records/{attendance_id}`

Authorization:

- `STUDENT`
- `FACULTY`
- `ADMIN`
- `SUPER_ADMIN`

Access must be filtered according to role.

- Student: Own attendance only
- Faculty: Authorized sessions only

---

# 42. Student Attendance History

`GET /attendance/me`

Optional query parameters:

- `from`
- `to`
- `subject`
- `semester`
- `academic_year`

Example:

`GET /attendance/me?from=2026-09-01&to=2026-09-19`

The backend should enforce a reasonable maximum date range.

---

# 43. Faculty Session Attendance

`GET /attendance/sessions/{session_id}/records`

Authorization:

- `FACULTY` / `ADMIN` / `SUPER_ADMIN`

Faculty must only access sessions they are authorized to view.

Response should support pagination.

Example:

```json
{
  "success": true,
  "data": {
    "items": [],
    "page": 1,
    "page_size": 50,
    "total": 252
  }
}
```

---

# 44. Pagination

Do not return hundreds or thousands of records in one unrestricted response.

Recommended parameters:

- `page`
- `page_size`

Maximum:

`page_size <= configured maximum`

Cursor pagination can be introduced later if necessary.

---

# 45. Attendance Statistics

Endpoint:

`GET /attendance/sessions/{session_id}/summary`

Example response:

```json
{
  "success": true,
  "data": {
    "eligible_students": 252,
    "present": 220,
    "absent": 32
  }
}
```

These values must be calculated from authoritative database records.

---

# 46. Audit API

Endpoint:

`GET /attendance/audit`

Authorization:

- `ADMIN` / `SUPER_ADMIN`

Possible filters:

- `session_id`
- `student_id`
- `event_type`
- `from`
- `to`

Audit access itself should be audited.

---

# 47. Health Endpoint

Public or internal depending on deployment:

`GET /health`

Response:

```json
{
  "status": "ok"
}
```

Do not expose:

- database password
- Redis credentials
- environment variables
- internal secrets

---

# 48. Readiness Endpoint

Recommended:

`GET /ready`

Checks required dependencies such as:

- Database
- Redis
- Object storage

Example:

```json
{
  "status": "ready"
}
```

Do not expose sensitive connection details.

---

# 49. Rate Limiting

Rate-limit at minimum:

- Authentication endpoints
- QR validation
- Attendance creation
- Device registration
- Device reset
- Selfie upload
- Audit endpoints

Possible architecture:

```text
Cloudflare / Reverse Proxy
        |
        v
FastAPI
        |
        v
Redis rate limiter
```

Exact limits must be determined through load testing and normal usage patterns.

---

# 50. QR Replay Protection

A QR token must not become a reusable attendance credential.

The backend may maintain short-lived replay state using Redis.

Conceptually:

```text
token_id
    |
    v
Redis
    |
    +---- valid
    +---- expired
    +---- consumed/replayed
```

The database remains the source of truth for final attendance.

---

# 51. Idempotency

Attendance creation should support:

```http
Idempotency-Key: <uuid>
```

The server can use the key to prevent repeated processing.

However:

`UNIQUE(student_id, session_id)` remains mandatory.

Idempotency is an additional protection, not a replacement for the database constraint.

---

# 52. Request Validation

Use Pydantic models.

Example conceptual request:

```python
class AttendanceCreateRequest(BaseModel):
    session_id: UUID
    qr_token: str
    device_id: UUID
    latitude: float
    longitude: float
    accuracy_m: float
```

Validation must include:

- latitude range
- longitude range
- accuracy > 0
- token length
- UUID validity

Avoid accepting arbitrary JSON fields.

---

# 53. API Layer Separation

Recommended backend structure:

```text
app/
├── api/
│   └── v1/
│       ├── attendance.py
│       ├── sessions.py
│       ├── devices.py
│       ├── selfies.py
│       └── audit.py
│
├── services/
│   ├── attendance_service.py
│   ├── qr_service.py
│   ├── geofence_service.py
│   ├── device_service.py
│   ├── selfie_service.py
│   └── audit_service.py
│
├── models/
├── schemas/
├── repositories/
└── core/
```

Follow the existing repository structure if it already has an established architecture.

---

# 54. Service Responsibility

### Attendance Service
Responsible for:
- Attendance transaction
- Validation orchestration
- Duplicate prevention
- Attendance creation

### QR Service
Responsible for:
- QR generation
- HMAC signing
- QR verification
- Expiration
- Replay protection

### Geofence Service
Responsible for:
- Coordinate validation
- Distance calculation
- Geofence decision

### Device Service
Responsible for:
- Registration
- Validation
- Revocation
- Device status

### Selfie Service
Responsible for:
- Upload validation
- Object storage
- Image metadata
- Quality processing

### Audit Service
Responsible for:
- Security events
- Structured audit records

---

# 55. Error Handling

Internal errors should be mapped to safe API errors.

Bad:

```json
{
  "error": "sqlalchemy.exc.IntegrityError: ..."
}
```

Good:

```json
{
  "success": false,
  "error": {
    "code": "DUPLICATE_ATTENDANCE",
    "message": "Attendance has already been recorded.",
    "request_id": "uuid"
  }
}
```

---

# 56. Logging

Every request should have a trace/request ID.

Example:

`X-Request-ID`

Logs should contain:

- `request_id`
- `endpoint`
- `method`
- `status_code`
- `duration_ms`
- `authenticated_user_id`

Do not log:

- passwords
- JWTs
- HMAC secrets
- private keys
- full selfie contents

Avoid unnecessarily logging precise location unless required for debugging/audit.

---

# 57. Security Logging

Security-sensitive failures should generate audit events.

Examples:

- Invalid QR
- Expired QR
- Repeated QR replay
- Invalid device
- Revoked device
- Outside geofence
- Duplicate attempt
- Suspicious request frequency
- Camera failure
- Fallback usage

---

# 58. API Security Headers

Production should use appropriate security headers through the reverse proxy/application.

Examples:

- `Strict-Transport-Security`
- `X-Content-Type-Options`
- `Content-Security-Policy`
- `Referrer-Policy`

Exact CSP must be tested against the PWA and camera functionality.

---

# 59. CORS

CORS must allow only known application origins.

Do not deploy:

`allow_origins=["*"]`

for authenticated production APIs unless there is a documented reason and compensating controls.

---

# 60. File Upload Security

Selfie uploads must have:

- Maximum file size
- Allowed MIME types
- Image decoding validation
- Filename sanitization
- Object-key generation by server
- Authentication
- Authorization
- Rate limiting

Never trust a user-provided filename as an object-storage path.

---

# 61. QR Scanner Compatibility

The API must not depend on a particular camera implementation.

The browser scanner is responsible for obtaining:

`QR token`

The API only validates the submitted token.

This allows:

- Chrome Android
- Safari iOS
- Edge
- other supported browsers

without coupling the backend to camera APIs.

---

# 62. Projector Use Case

The faculty display should request QR data from:

`GET /attendance/sessions/{session_id}/qr`

The frontend can render the QR at a large size.

The backend does not need to know the physical projector size.

The QR payload should remain small enough for reliable scanning.

---

# 63. Previous/Missed Session

The timetable must not block legitimate previous-session attendance.

A faculty workflow may create:

`Attendance Session`

for a previous/missed class where the faculty is authorized.

The API should distinguish:

`scheduled session` from `attendance session`

rather than assuming they are always the same event.

All previous/missed session creation should be auditable.

---

# 64. Previous Session API

Possible endpoint:

`POST /attendance/sessions/previous`

Request:

```json
{
  "teaching_assignment_id": "uuid",
  "session_date": "2026-09-18",
  "reason": "Missed attendance recording"
}
```

The backend should require appropriate faculty authorization and record:

- `reason`
- `created_by`
- `created_at`

in the audit trail.

Do not automatically allow arbitrary historical dates.

The permitted historical range should be configurable.

---

# 65. API Versioning

Initial:

`/api/v1`

Future breaking changes:

`/api/v2`

Do not silently change the meaning of an existing API contract.

---

# 66. OpenAPI

FastAPI should generate OpenAPI documentation.

Development:

- `/docs`
- `/redoc`

Production exposure should follow institutional security requirements.

Sensitive/internal endpoints should not automatically be exposed publicly.

---

# 67. API Testing Requirements

Every endpoint must have tests for:

- Happy path
- Authentication failure
- Authorization failure
- Malformed request
- Invalid QR
- Expired QR
- Replay
- Invalid device
- Revoked device
- GPS failure
- Outside geofence
- Duplicate attendance
- Concurrent requests
- Session closed
- Unauthorized teaching assignment
- Selfie upload failure
- Rate limiting

---

# 68. Critical Integration Test

The following must succeed:

```text
Faculty login
    |
    v
Create Teaching Assignment session
    |
    v
Capture faculty GPS
    |
    v
Generate rotating QR
    |
    v
Student login
    |
    v
Register/validate device
    |
    v
Scan QR
    |
    v
Capture student GPS
    |
    v
Backend validates everything
    |
    v
Attendance created
    |
    v
Selfie requested
    |
    v
Selfie uploaded
    |
    v
Audit trail created
```

---

# 69. Security Integration Test

Attempt:

- Expired QR
- Modified QR
- Wrong session QR
- Replayed QR
- Wrong student
- Wrong device
- Revoked device
- Outside geofence
- Fake frontend distance
- Duplicate request
- Concurrent duplicate request
- Unauthorized faculty session

Every attack must fail at the appropriate backend validation layer.

---

# 70. Future Face API

Face functionality should be introduced separately.

Possible internal endpoint:

`POST /internal/face/verify`

The public student client should not directly control model parameters.

Request conceptually:

```json
{
  "attendance_id": "uuid",
  "student_id": "uuid",
  "selfie_id": "uuid"
}
```

The face service determines:

- face detected
- embedding generated
- similarity score
- verification result
- liveness result
- model version

---

# 71. Face API Isolation

The attendance API should not directly expose:

- ONNX Runtime
- model filesystem
- embedding vectors
- model configuration
- threshold configuration

to the browser.

Architecture:

```text
Browser
   |
   v
FastAPI
   |
   v
Face Service
   |
   v
ONNX Runtime
```

---

# 72. Future Face Verification Response

Conceptually:

```json
{
  "result": "VERIFIED",
  "model_version": "version",
  "threshold_version": "version",
  "similarity_score": 0.0,
  "liveness": "PASS"
}
```

The actual threshold and score ranges must be determined experimentally.

Do not hard-code arbitrary values in the API specification.

---

# 73. API Performance Targets

Initial target:

QR submission -> API response: approximately 2–3 seconds.

This excludes delays caused by:

- GPS acquisition
- camera permission
- poor network
- device hardware

The API should remain responsive under the expected classroom load.

Initial expected scale:

- ~252 students
- ~7 departments

The system should be load-tested before assuming larger scale.

---

# 74. Concurrency

The system must support many students scanning the same QR at approximately the same time.

The architecture should avoid:

- global locks
- single-threaded attendance bottlenecks
- unnecessary synchronous external calls

Redis may be used for:

- rate limits
- short-lived QR state
- replay protection
- temporary session state

MySQL remains the source of truth for final attendance.

---

# 75. Offline Behavior

The PWA may function offline for:

- static assets
- UI shell
- cached non-sensitive resources

Attendance creation requires server verification.

Do not allow offline attendance to be silently considered officially valid unless a separately designed offline-attendance protocol exists.

---

# 76. API Privacy Rules

Do not return unnecessary:

- student GPS
- device identifiers
- selfie object keys
- face embeddings
- audit details
- IP addresses

to normal student clients.

Use least-privilege responses.

---

# 77. API Contract Golden Rule

```text
The frontend sends:
    Evidence

The backend decides:
    Validity

The database records:
    State

The audit system records:
    How the decision was reached
```

---

# 78. Final Endpoint Summary

Core MVP endpoints:

```http
POST   /api/v1/attendance/sessions
GET    /api/v1/attendance/sessions/{session_id}
POST   /api/v1/attendance/sessions/{session_id}/close
GET    /api/v1/attendance/sessions/{session_id}/qr

POST   /api/v1/attendance/devices/register
POST   /api/v1/attendance/devices/{device_id}/revoke

POST   /api/v1/attendance/records
POST   /api/v1/attendance/records/fallback
GET    /api/v1/attendance/records/{attendance_id}
GET    /api/v1/attendance/me

POST   /api/v1/attendance/camera-events

POST   /api/v1/attendance/records/{attendance_id}/selfie

GET    /api/v1/attendance/sessions/{session_id}/records
GET    /api/v1/attendance/sessions/{session_id}/summary

GET    /api/v1/attendance/audit

GET    /api/v1/health
GET    /api/v1/ready
```

Not every endpoint must be implemented immediately.

---

# 79. MVP Endpoint Priority

### Phase 1 — Required
- `POST /attendance/sessions`
- `GET  /attendance/sessions/{id}/qr`
- `POST /attendance/records`
- `POST /attendance/devices/register`
- `GET  /attendance/me`

### Phase 2 — Required
- `POST /attendance/records/fallback`
- `POST /attendance/camera-events`
- `POST /attendance/records/{id}/selfie`
- `GET  /attendance/sessions/{id}/records`
- `GET  /attendance/sessions/{id}/summary`

### Phase 3 — Administration
- `GET /attendance/audit`
- `POST /attendance/devices/{id}/revoke`
- Previous/missed session APIs

### Future
- Face enrollment
- Face verification
- Liveness
- Embedding management
- Advanced anti-spoofing

---

# 80. Definition of Done

The API implementation is complete when:

- [ ] Existing authentication integrated
- [ ] Role authorization implemented
- [ ] Faculty can create authorized sessions
- [ ] Faculty GPS stored and validated
- [ ] QR tokens are server-generated
- [ ] HMAC-SHA256 validation implemented
- [ ] QR expiration enforced
- [ ] QR replay protection implemented
- [ ] Student eligibility validated
- [ ] Device binding implemented
- [ ] Student GPS validated server-side
- [ ] Haversine distance calculated server-side
- [ ] Geofence enforced
- [ ] Duplicate attendance prevented
- [ ] Concurrent duplicate requests tested
- [ ] Camera failures audited
- [ ] Fallback uses full validation pipeline
- [ ] Attendance method recorded correctly
- [ ] Selfie upload secured
- [ ] Selfie failure does not invalidate attendance
- [ ] Audit events generated
- [ ] Rate limiting implemented
- [ ] CORS restricted
- [ ] HTTPS enforced in production
- [ ] API errors standardized
- [ ] OpenAPI documented
- [ ] Integration tests passing
- [ ] Security tests passing
- [ ] No secrets exposed

---

# 81. Non-Negotiable API Rules

1. The frontend never decides whether attendance is valid.
2. The frontend never calculates the authoritative geofence decision.
3. The frontend never holds the HMAC secret.
4. A valid QR alone is not sufficient for attendance.
5. GPS alone is not sufficient for attendance.
6. A camera failure must never automatically create attendance.
7. Fallback must use the same security controls as the primary flow.
8. Duplicate attendance must be prevented by the database.
9. Server time is authoritative.
10. Unauthorized Teaching Assignments must be rejected.
11. Private selfie storage must never be publicly accessible.
12. Biometric APIs must remain isolated from the initial MVP attendance decision.
13. All security-sensitive actions must be auditable.
14. No endpoint may trust a client-supplied authorization decision.
15. Never claim the API makes attendance completely tamper-proof.

---

# 82. Cryptographic Device Identity API Specification

All cryptographic device endpoints are mounted under `/api/v1/attendance/devices`.

### 82.1 Register Device Identity
`POST /api/v1/attendance/devices/register`

- **Authorization:** `STUDENT` Bearer token
- **Request Body:**
```json
{
  "device_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "public_key_spki_b64": "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...",
  "key_algorithm": "ECDSA_P256",
  "client_type": "WEB",
  "device_label": "Samsung Galaxy A55 5G",
  "platform": "Android 14",
  "browser_family": "Chrome Mobile",
  "app_version": "2.4.0",
  "replace_active": false,
  "rebind_otp": null
}
```
- **Responses:**
  - `200 OK`: `{"success": true, "status": "ACTIVE", "device_id": "...", "key_id": "..."}`
  - `409 Conflict`: `{"detail": "DEVICE_KEY_REUSE_REJECTED: Public key is already bound to another student."}`
  - `409 Conflict`: `{"detail": "DEVICE_LIMIT_REACHED: Maximum active devices reached. Provide replace_active=true or rebind_otp."}`
  - `400 Bad Request`: `{"detail": "INVALID_KEY: Public key must be valid SubjectPublicKeyInfo DER Base64."}`

### 82.2 Request Single-Use Challenge
`POST /api/v1/attendance/devices/challenge`

- **Authorization:** `STUDENT` Bearer token
- **Request Body:**
```json
{
  "device_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "operation": "ATTENDANCE_SCAN"
}
```
- **Responses:**
  - `200 OK`:
```json
{
  "challenge_token": "eyJhbGciOi...hmac_sig",
  "challenge_id": "3f4a2110-3882-4f8e-990c-03d1521782bb",
  "device_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "operation": "ATTENDANCE_SCAN",
  "canonical_message": "attendance_device_proof_v1|3f4a2110-3882-4f8e-990c-03d1521782bb|9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d|ATTENDANCE_SCAN|1774001234|3a7f...nonce",
  "nonce": "3a7f...64hex",
  "expires_at": 1774001294,
  "ttl_seconds": 60
}
```

### 82.3 Verify Proof of Possession
`POST /api/v1/attendance/devices/verify`

- **Authorization:** `STUDENT` Bearer token
- **Request Body:**
```json
{
  "device_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "challenge_id": "3f4a2110-3882-4f8e-990c-03d1521782bb",
  "signature": "MEQCIG4L...64byte_base64",
  "operation": "ATTENDANCE_VERIFICATION"
}
```
- **Responses:**
  - `200 OK`: `{"valid": true, "device_id": "...", "verified_at": "..."}`
  - `401 Unauthorized`: `{"detail": "DEVICE_CHALLENGE_EXPIRED: Challenge has expired."}`
  - `401 Unauthorized`: `{"detail": "DEVICE_CHALLENGE_REPLAYED: Challenge has already been used."}`
  - `401 Unauthorized`: `{"detail": "DEVICE_VERIFICATION_FAILED: Signature verification failed."}`
  - `429 Too Many Requests`: `{"detail": "VERIFY_LOCKOUT: Too many failed possession proofs."}`

### 82.4 Revoke Device Identity
`POST /api/v1/attendance/devices/{device_id}/revoke`

- **Authorization:** `STUDENT` (own device) or `SUPERADMIN`
- **Request Body:** `{"reason": "DEVICE_LOST"}`
- **Responses:**
  - `200 OK`: `{"success": true, "device_id": "...", "status": "REVOKED"}`

### 82.5 Scan-Path Integration
`POST /api/v1/student/scan-session`
- Extends the attendance submission payload with:
  - `device_id`: Client UUID handle.
  - `device_signature`: Base64 IEEE P1363 ECDSA P-256 signature over the canonical challenge message.
  - `challenge_token`: Server-issued HMAC challenge token.
- Server validates cryptographic proof before admitting attendance into the database.
