# SNIST ERP Attendance System — Deployment Specification

## 1. Purpose

This document defines the deployment architecture and operational requirements for the SNIST ERP Attendance System.

The deployment must support:

- React/TypeScript PWA
- FastAPI backend
- MySQL
- Redis
- Private selfie/object storage
- HTTPS
- Secure secrets
- QR generation
- GPS validation
- Device binding
- Audit logging
- Monitoring
- Backups
- Future face-processing service

The deployment must be simple enough for a single developer to operate initially while remaining capable of supporting the expected SNIST classroom workload.

---

# 2. Deployment Philosophy

The initial production architecture should prioritize:

```text
Reliability
Security
Simplicity
Observability
Easy rollback
Low operational overhead
```

Do not introduce:

- Kubernetes
- Kafka
- Multiple unnecessary microservices
- Complex service meshes

unless actual scale or requirements justify them.

---

# 3. Recommended Architecture

```text
                         Internet
                            |
                            v
                    Cloudflare / CDN
                            |
                            v
                     HTTPS / TLS
                            |
                +-----------+-----------+
                |                       |
                v                       v
          React PWA                FastAPI API
                                        |
                           +------------+------------+
                           |            |            |
                           v            v            v
                         MySQL        Redis      Object Storage
                           |
                           |
                           v
                      Audit Data

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

# 4. Production Request Flow

```text
Student Phone
     |
     | HTTPS
     v
Cloudflare
     |
     v
Reverse Proxy
     |
     v
FastAPI
     |
     +---- Authentication
     |
     +---- QR validation
     |
     +---- Device validation
     |
     +---- GPS validation
     |
     +---- Attendance transaction
     |
     +---- Audit
     |
     +---- Selfie upload
     |
     +---- Redis
     |
     +---- MySQL
     |
     +---- Object Storage
```

---

# 5. Frontend Deployment

The React/TypeScript PWA should preferably be deployed as static assets.

Possible architecture:

```text
React build
    |
    v
CDN / Static hosting
```

Examples of suitable hosting categories:

- Cloudflare Pages
- Vercel
- Static object storage + CDN
- Nginx

The exact provider should depend on the infrastructure provided by SNIST.

---

# 6. Frontend Requirements

Production frontend must:

- Use HTTPS
- Use production API URL
- Use correct CORS origin
- Use secure CSP
- Use versioned assets
- Use service-worker update strategy
- Avoid caching sensitive responses

---

# 7. Frontend Environment Variables

Only public configuration may be exposed to the browser.

Example:

`VITE_API_BASE_URL=https://attendance.example.com/api/v1`

Never expose:

- `DATABASE_URL`
- `REDIS_URL`
- `QR_HMAC_SECRET`
- `JWT_PRIVATE_KEY`
- `OBJECT_STORAGE_SECRET`

in frontend environment variables.

---

# 8. Backend Deployment

Recommended initial backend:

FastAPI + Uvicorn/Gunicorn-compatible production server setup + Reverse proxy

Example:

```text
Internet
   |
   v
Cloudflare
   |
   v
Nginx / Caddy
   |
   v
FastAPI
```

The exact process manager should follow the chosen deployment environment.

---

# 9. Backend Container

Recommended:

`Docker`

Example conceptual structure:

```text
Dockerfile
requirements.txt / pyproject.toml
app/
migrations/
```

The production container should:

- Run as non-root where possible
- Use a minimal base image
- Contain no production secrets
- Have a health check
- Expose only required ports

---

# 10. Docker Compose

For initial deployment, Docker Compose is sufficient.

Conceptually:

```yaml
services:
  api:
    build: ./backend

  mysql:
    image: mysql:8

  redis:
    image: redis

  reverse-proxy:
    image: nginx
```

Object storage may be external.

Do not blindly copy this configuration into production without adapting it to the actual environment.

---

# 11. Production Services

Minimum:

- frontend
- backend
- mysql
- redis
- reverse-proxy

Optional:

- object-storage
- monitoring
- face-service
- worker

---

# 12. MySQL

Production database requirements:

- MySQL 8+
- Persistent storage
- Automated backups
- Restricted network access
- Strong credentials
- Connection limits
- Monitoring

MySQL must not be publicly exposed.

---

# 13. MySQL Port

Default:

`3306`

The port should only be reachable from authorized application infrastructure.

Do not expose `0.0.0.0:3306` to the public Internet.

---

# 14. Database Credentials

Use a dedicated application database account.

The application should not normally connect as `root`.

Example conceptual:

Database: `snist_erp`  
Application user: `snist_erp_app`

Grant only required privileges.

---

# 15. Database Migrations

Use:

`Alembic`

Deployment sequence:

```text
Build
 |
 v
Run migration
 |
 v
Start application
 |
 v
Health check
```

Before migration, a backup must be verified for production changes.

---

# 16. Migration Safety

Never deploy with `DROP DATABASE` or `DROP TABLE` as part of normal attendance releases.

Migrations must preserve:

- existing students
- existing faculty
- existing subjects
- existing teaching assignments
- existing attendance

where applicable.

---

# 17. Redis

Redis can be used for:

- QR replay state
- Rate limiting
- Short-lived session state
- Temporary locks
- Caching

Redis must not become the only source of truth for attendance.

---

# 18. Redis Persistence

The exact persistence configuration depends on usage.

For temporary security state, loss of Redis should not corrupt authoritative attendance data.

The application must handle Redis failure gracefully.

---

# 19. Object Storage

Selfies should be stored in private object storage.

Possible categories:

- S3-compatible object storage
- Cloud object storage
- Private institutional storage

The exact provider depends on the infrastructure available to SNIST.

---

# 20. Object Storage Rules

Bucket/container must be:

- Private
- Encrypted where supported
- Access controlled
- Audited where supported

Never configure `public-read` for student selfies.

---

# 21. Object Naming

Use server-generated identifiers.

Example:

`attendance-selfies/2026/09/<session-id>/<student-id>/<selfie-id>.jpg`

Do not use `<student-name>.jpg` or raw client filenames.

---

# 22. Selfie Access

If an authorized administrator needs to view a selfie:

```text
Authenticated request
      |
      v
Authorization
      |
      v
Generate short-lived signed URL
      |
      v
Private object
```

Never expose permanent public URLs.

---

# 23. HTTPS

HTTPS is mandatory.

Production:

`https://attendance.example.com`

Never run production attendance over plain `http://`.

---

# 24. TLS Termination

Possible architecture:

```text
Browser
   |
   | HTTPS
   v
Cloudflare
   |
   | HTTPS or secure internal connection
   v
Reverse Proxy
   |
   v
FastAPI
```

If traffic between infrastructure components crosses an untrusted network, use appropriate encryption there as well.

---

# 25. Domain

Production should use an institutional or approved domain.

Example:

`attendance.<approved-domain>`

The actual domain must be selected by SNIST/institutional IT.

Do not hard-code a temporary development domain into application logic.

---

# 26. Cloudflare/CDN

If SNIST provides Cloudflare/CDN infrastructure, use it for:

- DNS
- TLS
- CDN
- DDoS protection
- WAF where appropriate
- Rate limiting
- Caching static frontend assets

Do not cache authenticated API responses as public CDN content.

---

# 27. Cloudflare Caching

Safe candidates:

- Static JS
- Static CSS
- Images that are public
- PWA assets

Avoid caching:

- Attendance API responses
- Student records
- Selfies
- Authentication responses
- Private audit data

---

# 28. WAF

A Web Application Firewall may provide additional protection against:

- Common web attacks
- Automated abuse
- Malicious requests
- Known exploit patterns

WAF rules must be tested against:

- QR endpoints
- Selfie uploads
- PWA functionality

Do not enable aggressive rules blindly.

---

# 29. Rate Limiting Architecture

Recommended:

```text
Cloudflare
    |
    v
Reverse Proxy
    |
    v
FastAPI
    |
    v
Redis
```

Different limits can exist for:

- Authentication
- QR
- Attendance
- Selfie upload
- Device registration
- Admin APIs

---

# 30. Backend Secrets

Production secrets should be injected through:

- Environment secrets
- Secret manager
- Deployment platform secret storage

Never bake them into:

- Docker image
- Git repository
- frontend bundle

---

# 31. Required Secrets

Potential secrets:

```bash
DATABASE_URL=
REDIS_URL=
QR_HMAC_SECRET=
JWT_SECRET=
OBJECT_STORAGE_ACCESS_KEY=
OBJECT_STORAGE_SECRET=
OBJECT_STORAGE_BUCKET=
```

Only include variables actually required by the implementation.

---

# 32. .env.example

Repository should contain:

```bash
DATABASE_URL=
REDIS_URL=
QR_HMAC_SECRET=
OBJECT_STORAGE_ENDPOINT=
OBJECT_STORAGE_BUCKET=
OBJECT_STORAGE_ACCESS_KEY=
OBJECT_STORAGE_SECRET=
```

with no real credentials.

---

# 33. Production .env

Production `.env` must:

- Not be committed
- Not be publicly accessible
- Have restricted filesystem permissions
- Be backed up only through secure secret-management procedures

Prefer a dedicated secret manager when available.

---

# 34. Logging

Backend logs should include:

- `timestamp`
- `request_id`
- `endpoint`
- `status`
- `latency`
- `authenticated user ID` where appropriate
- `error code`

Do not log:

- password
- JWT
- HMAC secret
- private key
- full selfie
- face embedding

---

# 35. Log Rotation

Production logs must have:

- Rotation
- Retention
- Size limits
- Access controls

Otherwise logs can eventually fill the server disk.

---

# 36. Monitoring

At minimum monitor:

- CPU
- RAM
- Disk
- API latency
- API errors
- Database connections
- Database CPU
- Redis health
- Object storage errors
- Authentication failures
- QR failures
- GPS failures
- Selfie failures

---

# 37. Health Check

Backend:

`GET /health` should verify application availability.

Example:

```json
{
  "status": "ok"
}
```

Do not expose infrastructure secrets.

---

# 38. Readiness Check

Backend:

`GET /ready` should verify required dependencies.

Potential checks:

- MySQL
- Redis
- Object storage

If a dependency is required for startup, readiness should fail when that dependency is unavailable.

---

# 39. Liveness vs Readiness

### Liveness
Answers: "Is the application process alive?"

### Readiness
Answers: "Can the application safely receive production traffic?"

Do not make a temporary dependency problem cause an unnecessary process restart through an overly aggressive liveness check.

---

# 40. Database Backups

At minimum:

`Automated daily backup`

Prefer:

`Point-in-time recovery` if supported by the selected database infrastructure.

The exact retention period must follow institutional requirements.

---

# 41. Backup Testing

A backup is not considered reliable until restore is tested.

Test:

```text
Backup
   |
   v
Restore into isolated database
   |
   v
Run integrity checks
   |
   v
Start application
   |
   v
Verify records
```

---

# 42. Disaster Recovery

Document:

- Database recovery
- Application redeployment
- DNS recovery
- Secret restoration
- Object storage recovery
- Redis recovery

Redis temporary state should be rebuildable. Attendance records must come from authoritative persistent storage.

---

# 43. Recovery Priority

Suggested recovery order:

1. Database
2. Backend
3. Object storage access
4. Redis
5. Frontend
6. Monitoring
7. Future face service

The exact sequence may vary based on infrastructure.

---

# 44. Recovery Point Objective (RPO)

Define institutionally: `RPO = acceptable amount of data loss`.

For attendance, the target should be as close to zero as practical. The actual RPO depends on the database backup architecture.

---

# 45. Recovery Time Objective (RTO)

Define: `RTO = acceptable time to restore service`.

The target must be agreed with SNIST IT/institutional stakeholders. Do not claim a specific RTO until infrastructure has been tested.

---

# 46. Deployment Strategy

Recommended initial strategy:

```text
Git -> CI -> Build/Test -> Staging -> Smoke Test -> Production
```

---

# 47. Git Workflow

Recommended:

`main` -> `production` or the existing repository workflow.

Every production release should have:

- Git commit
- Version/tag
- Migration version
- Deployment record

---

# 48. Release Versioning

Use a consistent version (`v1.0.0`, `v1.0.1`, `v1.1.0`) or the project's established versioning convention.

Record the version in:

- API
- frontend
- backend
- deployment logs

where useful.

---

# 49. Deployment Checklist

Before deployment:

- [ ] Tests passing
- [ ] Security tests passing
- [ ] Database backup verified
- [ ] Migration reviewed
- [ ] Environment variables verified
- [ ] Secrets verified
- [ ] Frontend API URL verified
- [ ] CORS verified
- [ ] TLS verified
- [ ] Object storage verified
- [ ] Redis verified
- [ ] Monitoring verified
- [ ] Rollback plan prepared

---

# 50. Deployment Order

Recommended:

1. Backup database
2. Verify infrastructure
3. Deploy backward-compatible database migration
4. Deploy backend
5. Run health/readiness checks
6. Deploy frontend
7. Run smoke tests
8. Monitor

For breaking schema changes, use an expand/migrate/contract strategy.

---

# 51. Expand/Migrate/Contract

For risky database changes:

```text
Version A
   |
   v
Add new structure
   |
   v
Deploy compatible backend
   |
   v
Migrate data
   |
   v
Switch application
   |
   v
Remove old structure later
```

Avoid instant destructive schema changes against older active application versions.

---

# 52. Rollback

Every release must define:

- Application rollback
- Database rollback strategy
- Frontend rollback

Important: A database migration cannot always safely be rolled back. Therefore prefer **backward-compatible migrations** over destructive migrations.

---

# 53. Application Rollback

Example:

`v1.4.0` -> problem discovered -> rollback to `v1.3.2`.

The database must remain compatible with the rollback version.

---

# 54. Frontend Rollback

Because PWA/service-worker caching can preserve old assets, frontend rollback must account for:

- Service worker
- Browser cache
- CDN cache
- API compatibility

Never assume changing the server build instantly changes every installed PWA.

---

# 55. Service Worker Deployment

Use versioned caches (`CACHE-v1`, `CACHE-v2`).

On update:

```text
Install new worker -> Cache new assets -> Activate -> Remove obsolete caches
```

Test carefully so users do not become stuck on an old application version.

---

# 56. PWA Security

The PWA must be served from HTTPS.

Service worker registration must use the correct secure origin.

Do not cache sensitive attendance data unnecessarily.

---

# 57. Environment Separation

Maintain:

- `development`
- `staging`
- `production`

Each environment should have separate:

- Database
- Redis
- Object storage
- Secrets
- API configuration

Never point local development at production by accident.

---

# 58. Production Database Protection

Production database should be protected from:

- developer laptops
- public Internet
- frontend
- student devices

Only backend infrastructure should have normal application access.

---

# 59. SSH / Server Access

If a VM/server is used:

- Disable password SSH where practical
- Use SSH keys
- Restrict users
- Use firewall
- Keep OS updated

Do not share the root password among developers.

---

# 60. Firewall

Only required ports should be exposed.

Typical public ports: `80`, `443`.  
Potential internal ports: `3306 MySQL`, `6379 Redis`.

These internal ports should not be publicly accessible.

---

# 61. Reverse Proxy

The reverse proxy should handle:

- TLS
- HTTP routing
- Request size limits
- Security headers
- Compression
- Static assets where appropriate

FastAPI should not necessarily be directly exposed to the Internet.

---

# 62. Request Size Limits

Configure limits for:

- JSON requests
- multipart uploads
- selfies

Selfie upload size must have an explicit maximum.

---

# 63. Timeout Configuration

Configure sensible:

- Client timeout
- Reverse proxy timeout
- API timeout
- Database timeout
- Redis timeout
- Object storage timeout

Avoid indefinite connections.

---

# 64. Worker Configuration

FastAPI production workers should be sized according to:

- CPU
- RAM
- expected concurrency
- database connection limits
- request type

Do not blindly start dozens of workers. Too many workers can exhaust RAM, database connections, and CPU.

---

# 65. Database Connection Pool

Configure:

- pool size
- max overflow
- connection timeout
- recycle

based on measured workload. The total number of application connections must remain below MySQL capacity.

---

# 66. Redis Connection Pool

Similarly configure:

- maximum connections
- timeouts
- retry policy

Avoid creating a new Redis connection for every request.

---

# 67. Object Storage Connection

Use appropriate connection pooling/reuse where supported.

Selfie uploads should not block unrelated attendance operations unnecessarily.

---

# 68. Asynchronous Work

Future face processing may use: `Queue -> Worker -> Face Service`.

The MVP does not need a queue unless performance testing demonstrates the need.

---

# 69. Face Service Deployment

Future `face-service` should be isolated.

Possible architecture:

```text
FastAPI
   |
private network
   |
Face Service
   |
ONNX Runtime
```

The face service should not be publicly accessible.

---

# 70. Face Model Storage

Models should be stored as deployment artifacts (`models/face/model-v1.onnx`).

Do not download arbitrary models at runtime from untrusted URLs.

---

# 71. Model Integrity

Record:

- model version
- checksum
- source
- license
- deployment date

Verify the expected model artifact before production use.

---

# 72. GPU Deployment

Do not require a GPU for MVP unless testing proves CPU inference is insufficient.

If GPU becomes necessary, the GPU-enabled host must be deployed separately from the core attendance API where practical.

---

# 73. Scaling Strategy

Initial:

- 1 FastAPI instance
- 1 MySQL
- 1 Redis
- 1 frontend/CDN

If required:

```text
          Load Balancer
             /    \
            /      \
       API-1      API-2
          \        /
           \      /
            MySQL
             |
            Redis
```

Attendance transactions must remain safe across multiple API instances.

---

# 74. Stateless API

FastAPI should be as stateless as practical.

Do not store critical attendance state only in process memory.

Persistent state belongs in **MySQL**; temporary state may use **Redis**.

---

# 75. Horizontal Scaling

If multiple API instances are deployed, all must share:

- MySQL
- Redis
- authentication infrastructure
- object storage

No instance should have a unique attendance truth.

---

# 76. Database as Source of Truth

The authoritative attendance state is **MySQL**, not Redis, frontend, QR display, or browser storage.

---

# 77. Monitoring Dashboard

Recommended dashboard:

```text
System Health
------------------------
API uptime
API latency
5xx rate
Database health
Redis health
Storage health

Attendance
------------------------
Sessions
Attendance count
QR failures
GPS failures
Device failures
Fallback usage
Selfie failures

Security
------------------------
Replay attempts
Unauthorized requests
Rate-limit events
Device violations
```

---

# 78. Alert Thresholds

Initial alerts may include:

- API 5xx spike
- Database unavailable
- Redis unavailable
- Disk nearly full
- Backup failure
- Object storage failure
- Certificate expiration
- Unusual QR replay volume

---

# 79. Certificate Monitoring

Monitor TLS certificate expiry.

Never wait until a certificate has expired to discover the problem. Automated renewal should be used where supported.

---

# 80. Domain/DNS Monitoring

Verify DNS, TLS, CDN, and origin after infrastructure changes.

---

# 81. Deployment Security

CI/CD credentials must be:

- Least privilege
- Short-lived where possible
- Stored securely
- Rotated

Never place production secrets directly inside CI source files.

---

# 82. CI/CD Pipeline

Recommended:

```text
Push -> Lint -> Typecheck -> Unit Tests -> Integration Tests -> Security Tests -> Build -> Deploy Staging -> Smoke Test -> Manual Approval -> Production
```

---

# 83. Automated Security Scanning

CI should eventually include:

- Dependency scanning
- Secret scanning
- Container scanning
- SAST

Do not treat automated scanning as a replacement for application security testing.

---

# 84. Production Deployment Approval

Production deployment should require confirmation that:

- Tests passed
- Migration reviewed
- Backup verified
- Rollback available
- Monitoring active

For institutional systems, document who approved the deployment.

---

# 85. Maintenance Window

Major changes should preferably be deployed during an agreed maintenance period. However, emergency security fixes may require expedited deployment.

---

# 86. Database Maintenance

Monitor:

- Table size
- Indexes
- Slow queries
- Connections
- Locks
- Disk usage
- Backup size

Attendance tables will grow continuously.

---

# 87. Data Archiving

If attendance volume becomes large, archival strategy may eventually be required:

```text
Hot data (Current academic years) -> Archive (Older academic years)
```

Do not archive until institutional retention requirements are known.

---

# 88. Log Retention

Define retention for:

- Application logs
- Security logs
- Audit logs
- Access logs

These should not all necessarily have the same retention period.

---

# 89. Privacy in Backups

Backups containing:

- Selfies
- Location data
- Attendance
- Face embeddings

must receive protection equivalent to production data. Do not treat backups as disposable copies.

---

# 90. Backup Encryption

Backups should be encrypted where supported. Access should be limited to authorized administrators.

---

# 91. Production Checklist

Before first production launch:

- [ ] Domain configured
- [ ] DNS configured
- [ ] HTTPS configured
- [ ] Certificate valid
- [ ] Cloudflare/CDN configured
- [ ] Frontend deployed
- [ ] API deployed
- [ ] MySQL configured
- [ ] Redis configured
- [ ] Object storage configured
- [ ] Secrets configured
- [ ] Database migration complete
- [ ] Backup complete
- [ ] Restore test complete
- [ ] CORS configured
- [ ] Rate limits configured
- [ ] Security headers configured
- [ ] Monitoring configured
- [ ] Alerts configured
- [ ] Health endpoint verified
- [ ] Readiness endpoint verified
- [ ] Real-device test complete
- [ ] Large-hall test complete
- [ ] Rollback tested

---

# 92. First Production Session Checklist

Before the first real attendance session:

- [ ] Faculty can log in
- [ ] Correct Teaching Assignment visible
- [ ] Faculty GPS works
- [ ] Session starts successfully
- [ ] QR rotates
- [ ] Student can scan
- [ ] Student GPS works
- [ ] Device validation works
- [ ] Attendance created
- [ ] Selfie prompt appears
- [ ] Selfie uploads
- [ ] Audit event exists
- [ ] Faculty sees attendance

---

# 93. Emergency Rollback Checklist

If a serious production problem occurs:

1. Stop new deployment.
2. Identify affected release.
3. Preserve logs.
4. Determine whether database migration is involved.
5. Roll back application if schema-compatible.
6. If necessary, disable affected feature.
7. Verify attendance integrity.
8. Verify database.
9. Monitor.
10. Document incident.

Do not blindly roll back the database.

---

# 94. Emergency Feature Disablement

The system should ideally support configuration flags for:

- Selfie collection
- Face processing
- Fallback mode
- Advanced verification

This allows a problematic feature to be disabled without taking down core attendance (`FACE_VERIFICATION_ENABLED=false`).

---

# 95. Core Attendance Isolation

Even if future features fail (Face Service, Selfie processing, Analytics, Advanced monitoring), the core QR attendance service should remain independently operable where possible.

---

# 96. Deployment Principle

The production system should be designed so that:

```text
A failure in an optional component
        |
        v
does not automatically
        |
        v
destroy the authoritative attendance system.
```

---

# 97. Definition of Done

Deployment is production-ready when:

- [ ] Frontend deployed over HTTPS
- [ ] FastAPI deployed securely
- [ ] MySQL persistent and protected
- [ ] Redis protected
- [ ] Selfie storage private
- [ ] Secrets securely configured
- [ ] Database migrations tested
- [ ] Backups automated
- [ ] Restore verified
- [ ] Monitoring active
- [ ] Alerts active
- [ ] CI/CD operational
- [ ] Rollback documented
- [ ] PWA caching tested
- [ ] Realme camera compatibility tested
- [ ] Large-hall QR tested
- [ ] Concurrent attendance tested
- [ ] Security tests passed
- [ ] Production smoke test passed

---

# 98. Final Deployment Principle

The initial production architecture should remain simple:

```text
                 Cloudflare
                     |
              Static Frontend
                     |
                 FastAPI
                 /     \
              MySQL   Redis
                 |
          Private Object Storage
```

Then add `Face Service` only when the face pipeline has been validated.

The system should scale because its components are well-designed, not because unnecessary infrastructure was added prematurely.
