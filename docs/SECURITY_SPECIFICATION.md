# SNIST ERP Attendance System — Security Specification

## 1. Purpose

This document defines the security model for the SNIST ERP Attendance System.

The goal is to make attendance resistant to:

- QR replay
- QR forgery
- Proxy attendance
- Device sharing
- GPS manipulation
- Request tampering
- Duplicate submissions
- Unauthorized faculty access
- API abuse
- Camera/scanner failures being abused as bypasses
- Selfie/biometric data exposure
- Common client-side attacks

> The system must be treated as **tamper-resistant**, not mathematically "tamper-proof." A compromised device can potentially falsify client-side evidence.

---

# 2. Security Model

The core principle is:

```text
Frontend collects evidence
        |
        v
Backend verifies evidence
        |
        v
Database records authoritative state
        |
        v
Audit system records the decision path
```

The browser is an untrusted environment.

Never assume:

- Frontend code = trusted
- Frontend timestamp = trusted
- Frontend GPS result = trusted
- Frontend distance calculation = trusted
- Frontend attendance status = trusted
- Frontend device identity = impossible to modify

---

# 3. Threat Model

The system should assume an attacker may:

- Modify browser JavaScript
- Use browser developer tools
- Replay requests
- Modify request JSON
- Modify QR contents
- Attempt to reuse expired QR codes
- Share credentials
- Share devices
- Spoof GPS on a compromised/rooted device
- Modify application storage
- Automate API requests
- Attempt concurrent attendance requests
- Abuse fallback workflows
- Attempt to access another student's records
- Attempt to access another faculty member's sessions
- Attempt to access private selfies
- Attempt to enumerate database/API identifiers

---

# 4. Security Goals

The system should provide:

### Authentication
Only authenticated users can access protected attendance operations.

### Authorization
Users can only perform operations they are permitted to perform.

### Integrity
Attendance records cannot be casually modified through client-side manipulation.

### Replay Resistance
A captured QR token should have limited usefulness.

### Proxy Resistance
The system should make simple proxy attendance substantially harder by combining multiple signals.

### Auditability
Security-sensitive events should be reconstructable.

### Privacy
Student location, selfies, and future biometric data must be protected.

---

# 5. Defense-in-Depth Model

No single mechanism should be treated as sufficient.

The attendance decision combines:

```text
Authenticated identity
        +
Valid Teaching Assignment/session
        +
Valid rotating QR
        +
Student eligibility
        +
Valid device
        +
Valid GPS evidence
        +
Geofence validation
        +
Duplicate prevention
```

Conceptually:

```text
                 ┌───────────────┐
                 │ Authenticated │
                 │    Student    │
                 └───────┬───────┘
                         |
              ┌──────────v──────────┐
              │ Valid Session + QR  │
              └──────────┬──────────┘
                         |
              ┌──────────v──────────┐
              │ Valid Device        │
              └──────────┬──────────┘
                         |
              ┌──────────v──────────┐
              │ Valid GPS Evidence   │
              └──────────┬──────────┘
                         |
              ┌──────────v──────────┐
              │ <= Geofence Radius   │
              └──────────┬──────────┘
                         |
              ┌──────────v──────────┐
              │ Not Already Present  │
              └──────────┬──────────┘
                         |
                         v
                    ATTENDANCE
```

---

# 6. QR Security

### 6.1 HMAC

QR authentication should use:

`HMAC-SHA256`

Conceptually:

```text
signature = HMAC-SHA256(server_secret, canonical_payload)
```

The server secret must remain server-side.

---

# 7. QR Payload

A conceptual QR payload:

```json
{
  "session_id": "uuid",
  "timestamp_window": 12345678,
  "nonce": "random-value",
  "signature": "hmac-signature"
}
```

The exact encoding can be compacted for projector scanning.

---

# 8. QR Secret Protection

The HMAC secret must never be placed in:

- React source
- TypeScript source
- PWA bundle
- `.env` files committed to Git
- `localStorage`
- `sessionStorage`
- QR payload
- API response
- browser console
- public configuration

Production secrets should be stored using the deployment environment's secret-management mechanism.

---

# 9. QR Expiration

QR tokens should have a short validity period.

Initial target:

~30 seconds

The backend determines whether the token is valid.

Never trust:

`if (Date.now() < expiresAt)`

as the authoritative validation.

The browser may display a countdown, but the server decides expiration.

---

# 10. QR Replay Protection

An attacker may attempt:

```text
Capture valid QR
        |
        v
Save token
        |
        v
Reuse later
```

Protection:

- Short expiration
- Session binding
- Nonce
- Server validation
- Replay tracking
- Duplicate attendance constraint

Redis may be used for short-lived replay state.

---

# 11. QR Session Binding

A QR token must be bound to:

`attendance_session_id`

A valid token from Session A must not work against Session B.

The backend must verify:

`token.session_id == requested_session.id`

---

# 12. QR Canonicalization

The exact payload used for HMAC signing must have deterministic serialization.

Do not sign:

`random JSON serialization`

where field order or formatting may vary.

Use a canonical representation.

Example conceptual payload:

`session_id|timestamp_window|nonce`

The exact format should be centrally implemented by the QR service.

---

# 13. HMAC Timing Safety

Signature comparisons should use a constant-time comparison function where appropriate.

Do not implement security-sensitive comparison as:

`if received_signature == expected_signature:`

without considering timing-safe comparison requirements.

Use the language/framework's standard secure comparison primitive.

---

# 14. QR Rate Limiting

QR validation should be rate-limited.

Protect against:

- Brute-force token attempts
- Automated requests
- Replay flooding
- API exhaustion

Rate limiting should exist at multiple layers where practical:

```text
Cloudflare / reverse proxy
        +
Application
        +
Redis
```

---

# 15. Authentication Security

Use the existing SNIST ERP authentication mechanism.

Do not create a separate password database for attendance unless absolutely required.

Authentication must support:

- Secure password handling
- Session expiration
- Token expiration
- Logout/revocation where applicable
- Rate limiting

The exact authentication mechanism should follow the existing ERP architecture.

---

# 16. Authorization

Every protected endpoint must perform authorization.

Example:

```text
Faculty A
   |
   X
Session owned by Faculty B
```

must be rejected.

Never rely solely on:

- `session_id`
- `student_id`
- `faculty_id`

supplied by the client.

The backend must derive the authenticated identity from the authentication context.

---

# 17. IDOR Protection

Protect against Insecure Direct Object References.

Example attack:

`GET /attendance/records/123` changed to `GET /attendance/records/124` must not automatically reveal another student's record.

Every object access must verify authorization.

---

# 18. Student Isolation

A student should only access:

- Their own attendance
- Their own devices
- Their own selfie records where permitted

They should not be able to access:

- Other students' attendance
- Other students' selfies
- Other students' devices
- Faculty audit information

---

# 19. Faculty Isolation

Faculty should only access:

- Teaching Assignments they are authorized for
- Attendance Sessions they own/manage
- Student attendance associated with those sessions

A faculty member must not be able to access another faculty member's attendance sessions by changing an ID in the request.

---

# 20. Admin Access

Administrative access should follow least privilege.

Separate:

- `ADMIN`
- `SUPER_ADMIN`

permissions if the existing ERP supports it.

High-risk actions should generate audit events.

Examples:

- Device revocation
- Attendance correction
- Session cancellation
- Historical attendance creation
- Biometric access
- Retention/deletion actions

---

# 21. Server Time

Security-sensitive timestamps must come from the server.

Examples:

- Session creation
- QR issuance
- QR expiration
- Attendance marking
- Selfie capture record
- Audit events
- Device registration

Never allow the browser to decide:

"this attendance happened at 10:03 AM"

for authoritative purposes.

---

# 22. Time Synchronization

Production servers should have reliable time synchronization.

The server environment should use a trusted time synchronization mechanism.

The system should monitor major clock drift.

A large server clock problem can affect:

- QR expiration
- Session validity
- Audit timestamps

---

# 23. GPS Security

GPS is useful evidence but is not cryptographically trustworthy.

A compromised device may potentially:

- Mock GPS
- Modify location APIs
- Use developer-mode spoofing
- Manipulate browser APIs

Therefore GPS should be treated as:

`important evidence`

rather than:

`perfect proof of physical presence`

---

# 24. Geofence Calculation

The authoritative calculation must happen server-side.

Input:

- Faculty session coordinates
- Student coordinates
- Session geofence radius

Output:

- Distance

Use:

`Haversine` or another validated geographic distance algorithm.

---

# 25. Geofence Radius

Default:

`100 meters`

The actual radius used by a session must be stored with that session.

This prevents historical decisions from changing when global configuration changes.

---

# 26. GPS Accuracy

Record:

`accuracy_m`

for both faculty session location and student location where applicable.

The system may reject poor-quality GPS evidence.

The threshold must be:

`configurable + tested on real devices`

Do not invent an arbitrary threshold and assume it works universally.

---

# 27. IP Geolocation

Do not use IP geolocation as the 100-meter geofence mechanism.

IP addresses can be associated with:

- carrier networks
- NAT
- VPNs
- institutional gateways
- cloud infrastructure

IP location can be retained as an additional audit signal where appropriate.

---

# 28. Device Binding

Device binding should use an application-generated random identifier.

Conceptually:

```text
random_device_id
        |
        v
stored securely by client
        |
        v
server associates with student
```

The server should store a protected representation where practical.

---

# 29. Device Fingerprinting

Do not rely on aggressive browser fingerprinting as the main security control.

Avoid unnecessarily collecting:

- Canvas fingerprints
- Font lists
- Hardware identifiers
- Persistent tracking identifiers

Use the minimum information required.

---

# 30. Device Sharing

Device binding reduces casual device sharing but does not make it impossible.

Potential attack:

Student A logs into Student B's account on Student B's registered device.

Therefore device binding must remain one layer of defense.

Authentication and institutional identity remain primary.

---

# 31. Device Revocation

A device should be revocable.

Statuses:

- `ACTIVE`
- `REVOKED`
- `PENDING`

Once revoked:

`attendance request -> rejected`

until the device is legitimately re-registered.

---

# 32. Attendance Transaction Security

Attendance creation must occur inside a transaction.

Conceptually:

```text
BEGIN
    Validate
    Check duplicate
    Insert attendance
    Insert audit
COMMIT
```

If any required step fails:

`ROLLBACK`

---

# 33. Duplicate Prevention

The database must enforce:

`UNIQUE(student_id, session_id)`

This protects against concurrent requests.

Application-level checks alone are insufficient.

---

# 34. Race Condition

Attack:

```text
Request A ---------------->
Request B ---------------->
```

Both attempt attendance simultaneously.

Expected:

- One attendance record
- One successful attendance decision
- Second request -> duplicate

This must be tested explicitly.

---

# 35. Idempotency

Attendance APIs should support an idempotency key.

Example:

`Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000`

Repeated requests with the same key should not cause duplicate processing.

The database uniqueness constraint remains the final protection.

---

# 36. Camera Security

Camera access must remain browser-controlled.

The system should:

- Request camera permission
- Detect initialization failure
- Allow retry
- Allow camera switching
- Detect black/invalid stream where practical
- Provide recovery instructions

The camera failure path must not bypass attendance validation.

---

# 37. Realme / Android Compatibility

The scanner must account for browser-specific camera behavior.

Potential failure states:

- Permission denied
- Permission blocked
- No camera
- Wrong camera
- Camera initialization failure
- Black video stream
- Stream interrupted
- Browser incompatibility

The backend should not assume camera works just because the frontend requested it.

---

# 38. Fallback Security

Fallback must preserve:

- Authentication
- QR validation
- Session validation
- Device validation
- GPS validation
- Geofence validation
- Duplicate prevention
- Audit logging

The fallback should not be a security bypass.

---

# 39. Fallback Transparency

The system should not falsely claim `Camera QR attendance` when fallback was used.

Store:

`QR_CAMERA` or `QR_CAMERA_FALLBACK` accurately.

This is essential for auditability.

---

# 40. Selfie Security

Selfies are sensitive personal data.

The system must:

- Use HTTPS
- Authenticate uploads
- Authorize ownership
- Validate file type
- Limit file size
- Store privately
- Generate server-side object names
- Restrict access
- Audit access where required
- Apply retention policy

---

# 41. Selfie Object Storage

Do not make selfie files publicly accessible.

Avoid:

`https://storage.example.com/student-selfie.jpg` as a permanently public URL.

If access is required, use:

`short-lived signed URL` with appropriate authorization.

---

# 42. Selfie File Validation

Do not trust `Content-Type: image/jpeg` alone.

Validate that the file is actually a valid image.

Reject:

- Executable files
- Unexpected formats
- Oversized uploads
- Malformed images

---

# 43. Selfie Filename Security

Never use the client-provided filename directly as the storage path.

Bad:

`/student_uploads/{filename}`

Use a server-generated identifier:

`<uuid>.jpg`

---

# 44. Selfie Failure Behavior

Selfie failure must not erase valid attendance.

State:

- `Attendance = PRESENT`
- `Selfie = FAILED`

This separation prevents biometric collection from becoming a hidden prerequisite for attendance.

---

# 45. Biometric Data Protection

Future face embeddings are highly sensitive.

They must be:

- Access controlled
- Encrypted where appropriate
- Versioned
- Audited
- Retained according to policy
- Protected from normal student API access

Do not return raw embeddings to the browser.

---

# 46. Face Model Security

Future ONNX models should be treated as trusted server-side assets.

Do not allow the client to specify:

- `model_path`
- `model_file`
- `threshold`
- `embedding_dimension`

The server selects the configured model.

---

# 47. Face Verification Threshold

Do not assume a universal threshold.

The threshold must be established using validation data representing the actual deployment population and conditions.

Evaluation should include:

- False acceptance rate
- False rejection rate
- Different lighting
- Different devices
- Different cameras
- Glasses
- Hair changes
- Aging
- Pose variation

---

# 48. Liveness

Future face verification should not rely solely on static face similarity.

A future system should evaluate liveness/anti-spoofing.

Potential attacks:

- Printed photograph
- Phone displaying photograph
- Recorded video
- Deepfake/replay
- Mask

Liveness should be treated as a separate component from identity matching.

---

# 49. Face Enrollment

Enrollment should require a controlled process.

Do not automatically replace the canonical embedding every time a student submits a selfie.

Recommended:

`Canonical enrollment embedding + up to 5 recent verified embeddings`

Recent embeddings should only be promoted into trusted state through defined verification rules.

---

# 50. Secrets Management

Secrets include:

- HMAC secret
- JWT signing keys
- Database passwords
- Redis credentials
- Object-storage credentials
- Cloudflare/API credentials
- Email credentials

These must never be committed to Git.

Use:

- Environment secrets
- Secret manager
- Deployment platform secrets

depending on infrastructure.

---

# 51. .env Rules

Local development may use `.env`, but:

`.env` and `.env.production` must not be committed when they contain secrets.

Use:

`.env.example` with placeholders.

Example:

```bash
DATABASE_URL=
REDIS_URL=
QR_HMAC_SECRET=
OBJECT_STORAGE_KEY=
OBJECT_STORAGE_SECRET=
```

---

# 52. Git Security

Before every production release:

Search for:
- `password=`
- `secret=`
- `api_key=`
- `token=`
- `private_key=`
- `DATABASE_URL=`
- `QR_HMAC_SECRET=`

Use secret scanning where available.

If a secret is accidentally committed:

1. Revoke it.
2. Rotate it.
3. Remove it from active configuration.
4. Investigate exposure.

Deleting the Git file alone is not sufficient.

---

# 53. HTTPS

Production must use HTTPS.

The intended architecture:

```text
Browser
   |
 HTTPS
   v
Cloudflare / Reverse Proxy
   |
 HTTPS/internal network
   v
FastAPI
```

Never transmit:

- attendance tokens
- credentials
- GPS
- selfies

over unencrypted HTTP in production.

---

# 54. TLS

Use modern TLS configuration.

Avoid obsolete protocols and weak cipher configurations.

Certificate management should be automated where practical.

The exact certificate provider is deployment-specific.

---

# 55. CORS

Production CORS must use an allowlist.

Example conceptual configuration:

```python
allow_origins = [
    "https://attendance.example.com"
]
```

Do not use unrestricted origins for authenticated production APIs unless there is a documented security reason.

---

# 56. CSRF

The appropriate CSRF strategy depends on authentication architecture.

If using cookie-based authentication:

CSRF protection is required.

If using bearer tokens in an architecture that does not expose them to cross-site requests in the same way, evaluate the applicable CSRF threat model.

Do not assume:

`JWT = automatically immune to all browser attacks`

---

# 57. XSS

Frontend must sanitize or safely render:

- Student names
- Faculty names
- Subject names
- Ticket/session metadata
- Audit information

Never inject untrusted HTML directly into the DOM.

Use framework-safe rendering by default.

---

# 58. SQL Injection

Use SQLAlchemy parameterized queries.

Never construct:

`f"SELECT * FROM students WHERE id = {student_id}"`

from untrusted input.

ORM/query parameters must be used.

---

# 59. Command Injection

Never pass user-controlled data into:

- shell commands
- system calls
- subprocesses

without strict validation and a compelling requirement.

---

# 60. SSRF

If the backend fetches remote resources, validate destination URLs.

Do not allow arbitrary user-provided URLs to access:

- localhost
- 127.0.0.1
- private networks
- cloud metadata endpoints
- internal services

The MVP should avoid unnecessary server-side URL fetching.

---

# 61. API Abuse

Rate-limit:

- Login
- QR validation
- Attendance creation
- Device registration
- Device reset
- Selfie uploads

Use Redis or the infrastructure layer where appropriate.

---

# 62. Brute Force

The system should detect repeated failures such as:

- Thousands of invalid QR requests
- Thousands of device IDs
- Repeated attendance attempts

Potential controls:

- Rate limits
- Temporary blocks
- IP/device heuristics
- Audit events
- Cloudflare protections

Do not permanently block legitimate students based solely on one suspicious event.

---

# 63. Request Size Limits

Set request body limits.

Particularly:

- Selfie uploads
- JSON bodies
- Multipart requests

Prevent oversized requests from consuming excessive resources.

---

# 64. Database Security

Production database:

- Not publicly exposed
- Strong credentials
- Least-privilege database user
- Encrypted network connection where appropriate
- Regular backups
- Monitoring

The application database account should not have unnecessary administrative privileges.

---

# 65. Database Backups

Backups must be:

- Automated
- Encrypted
- Access controlled
- Tested
- Monitored

A backup that has never been restored is not a verified disaster-recovery strategy.

Perform periodic restore tests.

---

# 66. Redis Security

Redis should not be publicly exposed.

Protect with:

- Private network
- Authentication where supported
- Firewall rules
- TLS where required

Do not store long-term authoritative attendance data only in Redis.

---

# 67. Audit Integrity

Audit records should be difficult for normal application users to modify.

Students must not be able to:

- `DELETE` audit events
- `EDIT` audit events

Faculty should have similarly restricted access.

---

# 68. Audit Retention

Audit retention should follow institutional policy.

Security-relevant events should normally be retained longer than temporary operational state.

Examples:

- QR replay
- Device revocation
- Attendance creation
- Admin override
- Biometric access

---

# 69. Admin Override

If administrators can manually modify attendance:

`Original state + new state + reason + actor + timestamp` must be preserved.

Never silently overwrite historical attendance.

---

# 70. Previous/Missed Session Security

Previous-session attendance is a legitimate requirement but increases abuse potential.

Therefore:

Historical session creation must require:

`Authorized faculty + Teaching Assignment ownership + Valid date + Reason + Audit event`

---

# 71. Timetable Security

Timetable data should guide attendance but should not become an authorization bypass.

The backend should distinguish:

`Timetable says class is scheduled` from `Faculty is authorized to create attendance`

Authorization should be based on the Teaching Assignment and institutional permissions.

---

# 72. Location Privacy

Avoid continuous tracking.

For student attendance:

```text
Request location
      |
      v
Use for attendance verification
      |
      v
Store only according to policy
```

Do not continuously monitor students through the attendance PWA.

---

# 73. Permission Minimization

Request only permissions required by the current workflow.

For example:

- Camera -> when scanning/capturing selfie
- Location -> when attendance verification requires GPS

Do not request:

- microphone
- contacts
- background location

unless another explicitly approved feature requires them.

---

# 74. Browser Storage

Do not store sensitive secrets in:

- `localStorage`
- `sessionStorage`
- `IndexedDB`

Examples:

- HMAC secret
- database credentials
- private keys
- long-lived authentication secrets

Only store the minimum client-side state required by the application.

---

# 75. Service Worker Security

The PWA service worker must not cache sensitive API responses indiscriminately.

Avoid caching:

- Attendance records
- Selfies
- Private API responses
- Authentication responses

unless the caching strategy has been explicitly designed and reviewed.

---

# 76. Cache Poisoning

Static PWA assets should be versioned.

Deployments should ensure that:

old frontend does not remain indefinitely active against new API.

Use cache/version invalidation strategies.

---

# 77. Content Security Policy

Implement a CSP compatible with:

- React
- camera APIs
- PWA
- required CDN resources

Avoid `unsafe-inline` and `unsafe-eval` unless required and specifically justified.

---

# 78. Security Headers

Recommended:

- `Strict-Transport-Security`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy`
- `Content-Security-Policy`
- `Permissions-Policy`

The Permissions-Policy should restrict unnecessary camera, microphone, and geolocation access to appropriate origins.

---

# 79. Camera Permission Policy

The application should only request camera access when necessary.

Example:

```text
Attendance page
    |
    v
User starts scanning
    |
    v
Request camera
```

Do not immediately request camera permission merely because the user logged in.

---

# 80. Geolocation Permission Policy

Similarly:

```text
User begins attendance
    |
    v
Request location
```

The system should clearly explain why location is required.

---

# 81. Error Message Security

Do not reveal unnecessary internal information.

Bad:

`"Session ID 9384 does not belong to faculty_id 17."`

Better:

`"You are not authorized to access this session."`

Detailed information can remain in secure audit logs.

---

# 82. Enumeration Resistance

Avoid exposing whether another student/session exists when the caller is unauthorized.

For unauthorized access:

`403` or an appropriate generic response should be used according to the endpoint's authorization model.

---

# 83. Logging Privacy

Logs should avoid unnecessary:

- GPS coordinates
- Selfie data
- Authentication tokens
- Passwords
- Personal information

When exact data is required for debugging, define:

- who can access it
- how long it is retained
- why it is collected

---

# 84. Monitoring

Monitor:

- API error rate
- QR validation failures
- QR replay attempts
- GPS rejection rate
- Device violations
- Fallback usage
- Selfie failures
- Authentication failures
- Latency
- Database errors
- Redis errors

Unexpected spikes should generate alerts.

---

# 85. Security Metrics

Useful metrics:

- QR replay attempts / session
- Invalid QR attempts / session
- Outside-geofence attempts
- Duplicate attendance attempts
- Device violations
- Fallback percentage
- Camera failure percentage
- Selfie failure percentage
- API 4xx/5xx rate

These metrics are for system security/operations, not for making assumptions about individual students without investigation.

---

# 86. Alerting

Potential high-value alerts:

- Unusual QR replay volume
- Sudden attendance API abuse
- Large number of GPS failures
- Large number of device resets
- Repeated unauthorized faculty access
- Selfie storage failures
- Database integrity errors
- Authentication attack patterns

Alerts should be reviewed before taking administrative action against users.

---

# 87. Security Testing

Required categories:

- Authentication
- Authorization
- Input validation
- QR security
- Replay
- Device binding
- GPS/geofence
- Concurrency
- Rate limiting
- File upload
- API access control
- Database security
- PWA security
- Privacy

---

# 88. QR Security Test Cases

Test:

- [ ] Valid QR
- [ ] Expired QR
- [ ] Modified session ID
- [ ] Modified timestamp
- [ ] Modified nonce
- [ ] Modified signature
- [ ] Wrong HMAC secret
- [ ] Replayed token
- [ ] Token from another session
- [ ] Malformed token
- [ ] Extremely large token

All invalid cases must fail safely.

---

# 89. Device Security Test Cases

Test:

- [ ] Registered device
- [ ] Unregistered device
- [ ] Revoked device
- [ ] Different student's device
- [ ] Device ID modified
- [ ] Device ID omitted
- [ ] Device reset
- [ ] Concurrent registration

---

# 90. Geofence Security Test Cases

Test:

- [ ] Inside 100m
- [ ] Exactly at boundary
- [ ] Outside boundary
- [ ] Invalid latitude
- [ ] Invalid longitude
- [ ] Missing GPS
- [ ] Poor accuracy
- [ ] Frontend sends fake distance
- [ ] GPS coordinates modified
- [ ] Faculty location modified

The backend must ignore client-calculated distance.

---

# 91. Authorization Test Cases

Test:

- [ ] Student accessing another student's record
- [ ] Student creating session
- [ ] Faculty accessing another faculty's session
- [ ] Faculty using another faculty's Teaching Assignment
- [ ] Admin restricted endpoint
- [ ] Unauthenticated request
- [ ] Expired token
- [ ] Revoked authentication

---

# 92. Concurrency Test

Simulate:

`100+ simultaneous attendance requests` for the same session.

Verify:

- No duplicate attendance
- No inconsistent records
- Acceptable latency
- No transaction deadlocks

Also test many different students scanning simultaneously.

---

# 93. Load Testing

Initial target:

252 students

Test realistic burst behavior:

- 50 requests/sec
- 100 requests/sec
- higher if infrastructure permits

The exact production capacity must be measured rather than assumed.

---

# 94. Penetration Testing

Before production rollout, perform security testing covering:

- OWASP API Security Top 10
- OWASP Web Application risks
- Authentication
- Authorization
- File upload
- API abuse

A qualified security tester should review the deployed system before institutional production use if feasible.

---

# 95. Dependency Security

Regularly scan:

- Python dependencies
- Node dependencies
- Docker images
- OS packages

Keep security-sensitive dependencies updated.

Do not blindly update production dependencies without testing.

---

# 96. Docker Security

Containers should:

- Run as non-root where possible
- Use minimal base images
- Avoid unnecessary packages
- Avoid privileged mode
- Use read-only filesystem where practical
- Limit capabilities
- Keep secrets outside image layers

Never bake production secrets into Docker images.

---

# 97. Production Network

Recommended conceptual architecture:

```text
                    Internet
                       |
                       v
                 Cloudflare/CDN
                       |
                       v
                Reverse Proxy
                       |
                +------+------+
                |             |
                v             v
             Frontend       FastAPI
                              |
                    +---------+---------+
                    |         |         |
                    v         v         v
                  MySQL     Redis    Object Storage
```

Database and Redis should not be directly exposed to the public Internet.

---

# 98. Database Network Rules

Only required application services should reach:

- MySQL
- Redis
- Object Storage

Do not expose database ports publicly unless absolutely necessary.

---

# 99. Disaster Recovery

Maintain:

- Database backups
- Configuration backups where appropriate
- Infrastructure documentation
- Deployment scripts
- Migration history
- Secret rotation procedures
- Recovery runbook

Test restoration periodically.

---

# 100. Incident Response

If suspicious activity is detected:

1. Preserve logs.
2. Identify affected sessions/accounts.
3. Determine scope.
4. Revoke compromised credentials/devices where appropriate.
5. Rotate exposed secrets.
6. Preserve evidence.
7. Correct vulnerability.
8. Verify system integrity.
9. Document incident.

Do not immediately delete evidence.

---

# 101. Compromised QR Secret

If the HMAC secret is suspected to be exposed:

1. Stop relying on the compromised secret.
2. Generate a new secret.
3. Deploy securely.
4. Invalidate active QR sessions if necessary.
5. Audit recent QR activity.
6. Investigate exposure.

Secret rotation strategy should be designed before production.

---

# 102. Secret Rotation

Secrets should support controlled rotation where practical.

Future architecture may support:

`current secret + previous secret`

for a limited transition period.

Do not retain old secrets indefinitely.

---

# 103. Security Boundaries

The most important trust boundaries are:

- Browser -> API
- API -> Database
- API -> Redis
- API -> Object Storage
- API -> Face Service
- Admin -> Administrative APIs

Each boundary must authenticate and authorize appropriately.

---

# 104. What Security Controls Cannot Guarantee

The system cannot guarantee:

- 100% prevention of proxy attendance
- 100% truthful GPS
- 100% trusted device identity
- 100% camera integrity
- 100% biometric accuracy
- 100% tamper resistance

A compromised/rooted device can potentially manipulate client-side evidence.

The objective is layered resistance, detection, and auditability.

---

# 105. Security Priority

Implementation priority:

1. Authentication
2. Authorization
3. Server-side QR verification
4. Server-side GPS verification
5. Database duplicate constraint
6. Device binding
7. Audit logging
8. Rate limiting
9. Secure selfie storage
10. Monitoring
11. Future face verification
12. Future liveness/anti-spoofing

Do not prioritize advanced AI security features before the fundamental backend controls are correct.

---

# 106. Non-Negotiable Rules

1. Never trust the frontend.
2. Never expose HMAC secrets.
3. Never trust client-calculated distance.
4. Never use IP geolocation as the 100m attendance boundary.
5. Never allow a camera failure to bypass security validation.
6. Never rely only on device binding.
7. Never rely only on GPS.
8. Never allow duplicate attendance.
9. Never expose private selfies publicly.
10. Never return raw face embeddings to clients.
11. Never log authentication secrets.
12. Never allow unauthorized access by changing an ID in a request.
13. Never silently overwrite historical attendance.
14. Never delete audit evidence during normal operations.
15. Never claim the system is impossible to bypass.
16. Every security-sensitive decision must be server-authoritative.

---

# 107. Security Definition of Done

The MVP security implementation is complete when:

- [ ] Authentication verified
- [ ] Role authorization verified
- [ ] Teaching Assignment authorization verified
- [ ] HMAC-SHA256 QR signing implemented
- [ ] QR expiration enforced
- [ ] QR replay protection implemented
- [ ] Server-side QR validation implemented
- [ ] Server-side GPS validation implemented
- [ ] Haversine distance implemented
- [ ] 100m default geofence implemented
- [ ] Session-specific geofence stored
- [ ] Device binding implemented
- [ ] Device revocation implemented
- [ ] `UNIQUE(student_id, session_id)` enforced
- [ ] Attendance transaction tested
- [ ] Concurrent requests tested
- [ ] Rate limiting implemented
- [ ] Camera failure path audited
- [ ] Fallback security controls preserved
- [ ] Selfie uploads protected
- [ ] Object storage private
- [ ] Audit logging implemented
- [ ] Secrets removed from source code
- [ ] CORS restricted
- [ ] HTTPS configured
- [ ] Security headers configured
- [ ] Database not publicly exposed
- [ ] Redis not publicly exposed
- [ ] Backups configured
- [ ] Restore procedure tested
- [ ] Security test suite passing

---

# 108. Final Security Principle

The attendance system should be designed around:

```text
                TRUST NOTHING
                     |
                     v
              VERIFY SERVER-SIDE
                     |
                     v
              RECORD EVIDENCE
                     |
                     v
               AUDIT DECISION
```

The strongest practical MVP is not the system with the most security features.

It is the system where the critical security controls are implemented correctly, independently, and verifiably.

---

# 109. Cryptographic Device Identity & Hardware Fingerprinting Elimination

### 109.1 Identity Separation Model
The security architecture enforces a strict conceptual and technical separation:
```text
┌───────────────────────────────────────────────────────────────────────────┐
│                           IDENTITY SEPARATION                             │
├──────────────────────────┬──────────────────────────┬─────────────────────┤
│    Device Identifier     │   Cryptographic Identity │  Physical Hardware  │
├──────────────────────────┼──────────────────────────┼─────────────────────┤
│ • Stable client handle   │ • ECDSA P-256 keypair    │ • IMEI, MAC, Model  │
│ • Random UUIDv4          │ • Non-exportable keys    │ • Canvas, UA, IP    │
│ • Session/routing tag    │ • Hardware/Keystore bound│ • Screen resolution │
│ • Telemetry identifier   │ • Digital signature proof│ • Browser profile   │
├──────────────────────────┼──────────────────────────┼─────────────────────┤
│  Routing/Telemetry ONLY  │  AUTHORIZATION FACTOR    │ STRICTLY PROHIBITED │
└──────────────────────────┴──────────────────────────┴─────────────────────┘
```

### 109.2 Elimination of Hardware/Fingerprint Authorization
Physical hardware attributes (model, manufacturer, IMEI, MAC, canvas fingerprint, screen size, IP address, user-agent) are **strictly prohibited as authorization factors** because:
1. **Identical Hardware Collisions:** In an engineering college with thousands of students, dozens of students in the same class own the exact same phone model (e.g. Samsung Galaxy A55 5G) running identical OS and browser versions over the same classroom Wi-Fi IP. Hardware fingerprinting causes false collisions and blocks legitimate students.
2. **Spoofability:** Headers, User-Agents, screen resolutions, and canvas hashes can be trivial spoofed or cloned by proxy scripts.
3. **Browser Privacy Restrictions:** Modern browsers (Safari, Chrome, Firefox) actively partition or randomize hardware/canvas APIs to prevent cross-site tracking.

### 109.3 Cryptographic Proof of Possession
1. **Client Key Generation:**
   - Web/PWA: WebCrypto `crypto.subtle.generateKey` ECDSA P-256 with `extractable: false`, stored in IndexedDB.
   - Android APK: Android Keystore backed by hardware Keymaster/StrongBox.
   - Private key never leaves the client device.
2. **Canonical Challenge Protocol:**
   ```text
   attendance_device_proof_v1|{challenge_id}|{device_id}|{operation}|{timestamp}|{nonce}
   ```
   - Challenge issued server-authoritatively with 60s TTL.
   - Signature verified using raw IEEE P1363 64-byte format in <0.06ms.
   - Nonce consumed atomically; replay attacks return HTTP 401 `DEVICE_CHALLENGE_REPLAYED`.
   - Expired challenges return HTTP 401 `DEVICE_CHALLENGE_EXPIRED`.
3. **Cross-Student Key Reuse Prevention:**
   - Attempting to register a public key already associated with another student account returns HTTP 409 `DEVICE_KEY_REUSE_REJECTED`.
4. **Single Active Device Policy:**
   - Max 1 active device per student. Replacing an active device requires explicit supersession (`replace_active: true`) or OTP rebind friction.
   - Previous device bindings are marked `REVOKED` without deleting historical attendance records.
