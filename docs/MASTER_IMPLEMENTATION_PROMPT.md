# SNIST ERP Attendance — Master Implementation Prompt

You are the primary engineering agent responsible for implementing the SNIST ERP Attendance System.

This is an existing ERP/application.

You are NOT building a completely new application from scratch.

Your first responsibility is to understand the existing repository, database, authentication, attendance implementation, and deployment architecture before changing anything.

---

# 1. READ THESE DOCUMENTS FIRST

Before modifying code, read:

1. `MVP.md`
2. `PRD.md`
3. `ARCHITECTURE.md`
4. `AGENT_INSTRUCTIONS.md`
5. `IMPLEMENTATION_PLAN.md`
6. `DATABASE_SCHEMA.md`
7. `API_SPEC.md`
8. `SECURITY.md`
9. `FACE_PIPELINE.md`
10. `TEST_PLAN.md`
11. `DEPLOYMENT.md`
12. `PROJECT_CHECKLIST.md`

These documents describe the intended system.

However:

> Existing production code and database behavior must be inspected before implementation.

Do not blindly overwrite existing functionality simply because the documentation describes a cleaner architecture.

---

# 2. PRIMARY OBJECTIVE

Implement a secure, production-ready attendance system based on:

```text
Authenticated Student
        +
Valid Teaching Session
        +
Valid Rotating QR
        +
Valid Device
        +
Valid Student GPS
        +
Inside Session Geofence
        +
No Duplicate Attendance
        =
Attendance Accepted
```

After successful attendance:

```text
Attendance Accepted
        |
        v
Selfie Collection
        |
        v
Private Storage
```

Selfie collection is initially for future face-verification preparation.

It must NOT determine attendance during the initial MVP.

---

# 3. ABSOLUTE RULES

Never violate these rules:

1. Never destroy existing production data.
2. Never expose QR/HMAC secrets to the frontend.
3. Never trust browser time for security decisions.
4. Never allow the frontend to decide attendance validity.
5. Never use IP geolocation as the authoritative 100m geofence.
6. Never allow camera fallback to bypass GPS validation.
7. Never allow camera fallback to bypass device validation.
8. Never allow camera fallback to bypass QR/session validation.
9. Never create duplicate attendance records for the same student and session.
10. Never expose selfies publicly.
11. Never silently collect biometric information.
12. Never falsely record a fallback attendance as camera-based.
13. Never automatically replace the canonical face embedding with every new selfie.
14. Never invent face-matching thresholds.
15. Never claim the system is 100% tamper-proof.
16. Never rewrite working functionality without first understanding why it exists.

---

# 4. FIRST TASK — REPOSITORY AUDIT

Do NOT immediately start coding.

First inspect:

- Frontend
- Backend
- Database
- Authentication
- Authorization
- Attendance
- QR scanner
- PWA
- Camera handling
- Geolocation
- Device handling
- Migrations
- Deployment
- Environment variables

Determine:

- What already exists?
- What partially exists?
- What is broken?
- What needs modification?
- What needs to be created?

Produce an internal implementation plan before modifying files.

---

# 5. EXISTING IDENTITY MODEL

Use the existing ERP identity system.

Faculty:
`SNIST SAP ID` is the canonical institutional identity. Institutional email is mapped to the SAP ID.

Do NOT create a second faculty identity system.

Students must similarly reuse existing ERP identities wherever possible.

---

# 6. TEACHING ASSIGNMENT

Attendance sessions must be associated with:

- Faculty
- Subject
- Section
- Academic Year
- Semester

through the existing Teaching Assignment model where available.

Do not create duplicate relationships if they already exist.

---

# 7. FACULTY SESSION CREATION

When faculty starts attendance:

1. Authenticate faculty.
2. Verify faculty authorization.
3. Select Teaching Assignment.
4. Request browser geolocation.
5. Capture: `latitude`, `longitude`, `accuracy`.
6. Send location to backend.
7. Backend records authoritative server timestamp.
8. Create attendance session.
9. Store default geofence radius = 100 meters.
10. Start rotating QR generation.

The browser timestamp must never be authoritative.

---

# 8. SERVER TIME

Security-sensitive timestamps must come from the server.

Do NOT trust `new Date()` from the client for security validation.

The backend must determine:

- Session time
- QR validity
- Token expiry
- Attendance time
- Replay window

Use the project's existing timezone convention consistently.

For SNIST business display/logic, Indian Standard Time is expected.

---

# 9. QR SECURITY

QR tokens must be generated server-side.

Use:
`HMAC-SHA256`

QR payload should contain enough information to bind the token to:

- Session
- Timestamp/window
- Nonce/token identifier

Conceptually:

```text
payload
   |
   v
HMAC-SHA256(secret, payload)
   |
   v
signature
```

The secret must NEVER be sent to:

- Browser
- PWA
- QR
- localStorage
- sessionStorage

---

# 10. QR EXPIRATION

Use approximately:
`30 seconds` for QR token validity unless the existing system or configuration defines another approved value.

Backend must verify:

- Signature
- Session binding
- Expiry
- Replay
- Canonical payload

---

# 11. QR REPLAY PROTECTION

A valid QR captured by an attacker must not simply be reusable indefinitely.

Implement appropriate replay protection using:

- Redis
- Database
- or a combination

depending on the existing architecture.

Redis should not become the authoritative attendance database.

---

# 12. STUDENT ATTENDANCE FLOW

Student:

```text
Login
  |
  v
Attendance
  |
  v
Camera
  |
  v
Scan QR
  |
  v
GPS
  |
  v
Backend validation
  |
  v
Attendance result
  |
  v
Selfie
```

Backend validation:

1. Authentication
2. Authorization
3. Request validation
4. Session validation
5. QR validation
6. QR expiry
7. QR replay
8. Student eligibility
9. Device validation
10. GPS validation
11. Geofence calculation
12. Duplicate check
13. Transaction
14. Audit
15. Success

---

# 13. GPS GEOFENCE

Faculty location establishes the session location.

Student location establishes the student's current location.

Backend calculates:

`distance(student, faculty)` using a server-side geospatial calculation such as Haversine.

Default:
`100 meters`

The radius should be stored with the session so future configuration changes do not alter historical session behavior.

---

# 14. GPS ACCURACY

Capture:

- `latitude`
- `longitude`
- `accuracy`

Poor GPS accuracy must be handled explicitly.

Do not blindly accept every coordinate.

Define behavior based on the existing requirements and implementation.

---

# 15. IP GEOLOCATION

Do NOT use IP geolocation as the authoritative 100m attendance check.

IP geolocation can be used only as an additional:

- audit signal
- security signal

because IP-based geographic accuracy is insufficient for a 100-meter institutional boundary.

---

# 16. CRYPTOGRAPHIC DEVICE IDENTITY

Replace legacy device binding and hardware fingerprinting with a server-authoritative Cryptographic Device Identity system across Web/PWA, mobile browsers, and dedicated Android APK clients.

### 1. Security Requirements & Prohibitions
DO NOT implement device binding using:
- Device model or phone manufacturer
- IMEI, MAC address, or IP address
- Browser fingerprint, canvas fingerprint, or screen resolution
- User-Agent strings
- Plain device UUID alone as an authorization authority
- Any other client-spoofable hardware fingerprint

### 2. Conceptual Triad
Enforce clean architectural separation between:
1. **Device Identifier**: Random application-level UUID generated per installation/profile. Informational handle only.
2. **Cryptographic Device Identity**: Non-exportable asymmetric keypair (ECDSA P-256 / secp256r1) generated client-side via WebCrypto API (IndexedDB storage) or Android Keystore. Private key NEVER leaves the client.
3. **Physical Hardware Identity**: Silicon/model traits. Explicitly untrusted for security decisions.

### 3. Multi-Student Concurrent Device Handling
The system must guarantee that 10+ students using identical phone models (e.g., Samsung Galaxy A55 5G) on the same Wi-Fi access point concurrently register and submit attendance without false collisions, lockouts, or interference.

### 4. Server-Authoritative Challenge Protocol
Proof of possession requires signing a server-issued single-use challenge token:
- Canonical challenge format:
  `attendance_device_proof_v1|{challenge_id}|{device_id}|{operation}|{timestamp}|{nonce}`
- Verification rules:
  - Signature verified using the registered public key for `device_id` linked to the authenticated student's SAP ID.
  - Nonce consumed immediately upon verification; replay attempts return `401 Unauthorized` (`DEVICE_CHALLENGE_REPLAYED`).
  - Challenge expiration strictly enforced based on server UTC time (`DEVICE_CHALLENGE_EXPIRED`).
  - Cross-student public key reuse is blocked (`409 Conflict` - `DEVICE_KEY_REUSE_REJECTED`).
  - Missing signature on attendance scans rejected (`403 Forbidden` - `BINDING_REQUIRED`).
  - Revoked devices rejected (`401 Unauthorized` - `DEVICE_REVOKED`); historical attendance preserved.
  - Multi-device limit (max 2 active devices) enforced with controlled replacement (`replace_active: true`).

---

# 17. DUPLICATE PREVENTION

The database must enforce:

`UNIQUE(student_id, session_id)`

Do not rely only on frontend logic.

Concurrent requests must be tested.

Example:

```text
Request A ----\
               > Database transaction -> exactly one record
Request B ----/
```

---

# 18. CAMERA IMPLEMENTATION

The camera scanner must be implemented as a state machine.

Required states include:

- `REQUESTING_PERMISSION`
- `CAMERA_READY`
- `SCANNING`
- `PERMISSION_DENIED`
- `PERMISSION_BLOCKED`
- `INITIALIZATION_FAILED`
- `BLACK_SCREEN`
- `WRONG_CAMERA`
- `RECOVERY`
- `FALLBACK`
- `SUCCESS`
- `ERROR`

Do not simply display a generic "Camera failed" message.

---

# 19. CAMERA RECOVERY

When camera fails:

1. Explain the problem.
2. Provide Retry.
3. Provide Switch Camera.
4. Attempt recovery.
5. Allow approximately 30 seconds for recovery.
6. If still unavailable, enter controlled fallback.

Test:

- Permission denied
- Permission blocked
- Black screen
- Camera initialization failure
- Wrong camera
- Camera already in use
- Browser restart
- Network change

---

# 20. REALME COMPATIBILITY

Explicitly test Realme Android devices.

Do not assume "Chrome on Pixel" behavior represents Realme, Samsung, OnePlus, Xiaomi, etc.

Test:

- Permission handling
- Camera initialization
- Back camera
- Front camera
- Camera switching
- QR detection
- Black screen
- Browser lifecycle

---

# 21. FALLBACK

Fallback exists only to handle camera failure.

Fallback must NOT remove security controls.

Fallback must still perform:

- Authentication
- Session validation
- QR/session validation
- Device validation
- GPS validation
- Geofence validation
- Duplicate prevention

Attendance method must be stored accurately (`QR_CAMERA` vs `QR_CAMERA_FALLBACK`).

Do not record `QR_CAMERA` when the camera was not actually used.

---

# 22. ATTENDANCE TRANSACTION

Attendance creation must be transactional.

The backend should atomically:

`Validate + Check duplicate + Create attendance + Write audit event`

Handle race conditions.

Do not allow two simultaneous requests to create two records.

---

# 23. SELFIE COLLECTION

After successful attendance:

```text
Attendance SUCCESS
        |
        v
Selfie prompt
        |
        v
Front camera
        |
        v
3–5 second countdown
        |
        v
Capture
        |
        v
Quality validation
        |
        v
Private storage
```

The user must be clearly informed that a selfie is being collected.

Do not silently capture biometric data.

---

# 24. SELFIE QUALITY

Basic validation:

- Valid image
- Supported format
- Reasonable file size
- Minimum resolution
- Exactly one face
- Face visible
- Basic blur check
- Basic brightness check

Do not build the future face-verification system into MVP just because face detection is being used for image-quality validation.

---

# 25. SELFIE FAILURE

If selfie capture fails:

Attendance remains valid.

Do not delete or reverse a successfully accepted attendance record merely because selfie upload failed.

Record `selfie_status` appropriately.

---

# 26. SELFIE STORAGE

Raw selfies must be stored in private object storage.

Database should contain metadata/reference rather than unnecessarily storing large image binaries.

Never:

- public bucket
- public URL
- student-name filename

Use server-generated identifiers.

---

# 27. AUDIT LOGGING

Every security-sensitive decision should be auditable.

Log events such as:

- Session created
- Session closed
- QR generated
- QR rejected
- QR replay
- Attendance accepted
- Attendance rejected
- GPS rejected
- Device rejected
- Duplicate attempt
- Camera failure
- Fallback used
- Selfie submitted
- Selfie failed
- Device registered
- Device revoked
- Administrative action

Never log:

- Passwords
- HMAC secrets
- JWT secrets
- Private keys
- Raw sensitive biometric content

---

# 28. PREVIOUS / MISSED SESSIONS

Timetable must guide attendance but must NOT prevent legitimate attendance for:

- Previous session
- Missed session

Faculty must have an explicit workflow for recording previous/missed sessions.

Any such action must:

- Be authorized
- Be auditable
- Have correct session metadata
- Avoid silent manipulation

---

# 29. PWA

The attendance application must work as a web PWA.

Do not require a native Android/iOS application for MVP.

Offline support may cache static assets and UI shell, but offline mode must NOT falsely create authoritative attendance.

Attendance requires backend validation.

---

# 30. API DESIGN

Use `/api/v1/` or the existing API versioning convention.

Important endpoints include:

- `POST /attendance/sessions`
- `GET /attendance/sessions/{session_id}`
- `POST /attendance/sessions/{session_id}/close`
- `GET /attendance/sessions/{session_id}/qr`
- `POST /attendance/devices/register`
- `POST /attendance/devices/challenge`
- `POST /attendance/devices/verify`
- `POST /attendance/devices/{device_id}/revoke`
- `POST /attendance/records`
- `POST /attendance/records/fallback`
- `GET /attendance/me`
- `POST /attendance/camera-events`
- `POST /attendance/records/{attendance_id}/selfie`

Use existing API conventions if already established.

---

# 31. ERROR HANDLING

Never report success before backend confirmation.

Bad:
"QR scanned successfully!" when attendance has not been created.

Good:
"QR accepted. Verifying attendance..." then "Attendance marked successfully." only after backend confirmation.

---

# 32. DATABASE MIGRATIONS

Use the existing migration system.

If Alembic is used:

```text
Create migration -> Review migration -> Test migration -> Apply migration
```

Never manually modify production tables without a controlled migration.

---

# 33. EXISTING DATABASE

Before creating tables:
Inspect existing schema.

Reuse existing:

- `users`
- `students`
- `faculty`
- `subjects`
- `sections`
- `academic years`
- `semesters`
- `teaching assignments`

where appropriate.

Do not create `new_student`, `new_faculty`, `new_user` tables merely because the new module needs those relationships.

---

# 34. TESTING REQUIREMENTS

Every major implementation must include tests.

Minimum:

- Unit
- Integration
- API
- Database
- Security
- Browser
- E2E
- Concurrency

Test both expected success and expected rejection.

---

# 35. SECURITY TESTS

Test:

- Modified QR
- Expired QR
- Replayed QR
- QR from another session
- Invalid signature
- Wrong student
- Wrong device
- Revoked device
- Outside geofence
- Poor GPS
- Missing GPS
- Duplicate request
- Concurrent duplicate request
- Unauthorized endpoint
- IDOR
- Rate-limit abuse

---

# 36. CAMERA TESTS

Test:

- Chrome Android
- Realme Android
- Permission denied
- Permission blocked
- Black screen
- Wrong camera
- Camera switching
- Camera recovery
- Fallback

---

# 37. LOAD TESTS

Test at least:

- 50 students
- 100 students
- 200 students
- 252 students
- and burst traffic

Verify:

- No duplicate attendance
- No lost attendance
- No database corruption
- Acceptable latency

---

# 38. DEPLOYMENT

Production architecture should remain simple.

Preferred initial architecture:

```text
Cloudflare/CDN
       |
       v
Frontend
       |
       v
Reverse Proxy
       |
       v
FastAPI
   /        \
MySQL     Redis
   |
   v
Private Object Storage
```

Do not introduce Kubernetes or unnecessary infrastructure without a demonstrated requirement.

---

# 39. PRODUCTION SECURITY

Verify:

- HTTPS
- Firewall
- Private database
- Private Redis
- Secure secrets
- Restricted CORS
- Rate limits
- Security headers
- Backups
- Monitoring

---

# 40. ENVIRONMENT VARIABLES

Frontend may contain only public configuration.

Never expose:

- `DATABASE_URL`
- `REDIS_URL`
- `QR_HMAC_SECRET`
- `JWT_SECRET`
- `PRIVATE_KEYS`
- `OBJECT_STORAGE_SECRET`

to the browser.

---

# 41. PRODUCTION RELEASE

Before release:

- Tests passing
- Migration reviewed
- Backup verified
- Secrets verified
- TLS verified
- Monitoring verified
- Rollback plan verified

Then:

```text
Deploy staging -> Run smoke tests -> Approve -> Deploy production -> Run production smoke tests -> Monitor
```

---

# 42. ROLLBACK

Every release must have a rollback strategy.

Prefer backward-compatible migrations.

Do NOT assume every database migration can safely be reversed.

---

# 43. FUTURE FACE SYSTEM

Do NOT implement face attendance as part of MVP unless explicitly instructed.

Future architecture:

```text
QR Attendance -> Selfie -> Face Service -> ONNX Runtime -> Embedding
```

Initial face pipeline:

```text
Selfie -> Detection -> Alignment -> Quality -> Embedding -> Secure Storage
```

This is inference, not training, when using a pretrained ONNX model.

---

# 44. FACE ENROLLMENT

Target collection period: 15–16 days.

Store:
`Canonical embedding + Up to 5 recent verified embeddings`

The canonical embedding must not automatically be replaced after every successful verification.

---

# 45. FACE VERIFICATION

Before face verification affects attendance:

- Evaluate model
- Evaluate thresholds
- Measure false accepts
- Measure false rejects
- Test lighting
- Test pose
- Test glasses
- Test camera differences
- Test real classroom conditions

Use empirically validated thresholds. Do not invent one.

---

# 46. SHADOW MODE

Initially: QR attendance remains authoritative.

Face verification may run in **shadow mode** to measure performance without changing attendance outcomes.

---

# 47. LIVENESS

Future liveness must be treated separately from identity verification.

Do not assume face match = live person.

Evaluate:

- Printed photo
- Screen replay
- Video replay
- Other spoofing attempts

---

# 48. IMPLEMENTATION WORKFLOW

For every task:

1. **STEP 1**: Inspect.
2. **STEP 2**: Explain what exists.
3. **STEP 3**: Identify exact files.
4. **STEP 4**: Plan minimal changes.
5. **STEP 5**: Implement.
6. **STEP 6**: Run tests.
7. **STEP 7**: Run security checks.
8. **STEP 8**: Review diff.
9. **STEP 9**: Report changes.
10. **STEP 10**: Commit a checkpoint.

---

# 49. DO NOT DO THIS

Do not:

- Rewrite the entire frontend
- Rewrite the entire backend
- Replace the database
- Replace authentication
- Replace working scanner code
- Introduce Kubernetes
- Introduce unnecessary microservices
- Add random dependencies
- Expose secrets
- Disable security checks to make tests pass
- Hard-code production credentials
- Hard-code a face threshold
- Use browser time for authorization

---

# 50. WHEN SOMETHING IS UNCLEAR

Do not guess.

First inspect:

- Repository
- Database
- Existing API
- Existing configuration
- Existing documentation

If ambiguity remains and the decision could affect:

- Security
- Data integrity
- Production behavior
- Identity
- Attendance correctness

stop before implementing that part and clearly state the ambiguity.

For low-risk implementation details, choose the smallest solution consistent with the documented architecture.

---

# 51. FINAL VALIDATION

Before declaring the MVP complete, verify:

- [ ] Faculty session creation
- [ ] Faculty GPS
- [ ] 100m geofence
- [ ] Rotating QR
- [ ] HMAC-SHA256
- [ ] QR expiry
- [ ] Replay protection
- [ ] Student authentication
- [x] Cryptographic device identity (WebCrypto / Android Keystore ECDSA P-256 challenge-response)
- [ ] Student GPS
- [ ] Duplicate prevention
- [ ] Transaction safety
- [ ] Camera recovery
- [ ] Realme compatibility
- [ ] Controlled fallback
- [ ] Selfie collection
- [ ] Private selfie storage
- [ ] Audit logs
- [ ] API security
- [ ] PWA
- [ ] Projector scanning
- [ ] 252-user testing
- [ ] Production deployment
- [ ] Backup
- [ ] Monitoring
- [ ] Rollback

---

# 52. FINAL ENGINEERING PRINCIPLE

The system follows:

```text
Frontend
    |
    | Collect evidence
    v
Backend
    |
    | Verify evidence
    v
Database
    |
    | Store authoritative state
    v
Audit
    |
    | Explain how the decision occurred
    v
Administrators
```

The frontend is untrusted.  
The backend is authoritative.  
The database is the source of truth.  
The audit system explains the decision.  

Security comes from multiple independent controls rather than one mechanism.

Build incrementally.  
Test aggressively.  
Preserve existing ERP functionality.  
Never sacrifice attendance integrity simply to make the UI appear successful.
