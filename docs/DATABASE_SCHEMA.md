# SNIST ERP Attendance System — Database Schema

## 1. Purpose

This document defines the database architecture for the SNIST ERP Attendance System.

The database must support:

- Existing SNIST ERP users
- Students
- Faculty
- Subjects
- Sections
- Academic Years
- Semesters
- Teaching Assignments
- Attendance Sessions
- Rotating QR tokens
- Student device binding
- Attendance records
- GPS evidence
- Selfie collection
- Audit logging
- Future face embeddings
- Future face verification

The database must integrate with the existing ERP schema.

---

## 2. Critical Rule

Before creating any table:

1. Inspect the existing database.
2. Inspect existing SQLAlchemy models.
3. Inspect existing migrations.
4. Identify existing identity tables.
5. Reuse existing tables wherever possible.

Do NOT create duplicate tables for existing:

- `users` (`qr_users`)
- `students` (`qr_students`)
- `faculty` (`qr_teachers`)
- `subjects` (`qr_subjects`)
- `sections` (`qr_sections`)
- `academic years` (`qr_academic_years`)
- `semesters` (`qr_semesters`)

unless the existing architecture genuinely requires a separate entity.

---

## 3. Database Architecture

```text
                    Existing ERP
                         |
          +--------------+--------------+
          |              |              |
        Users         Students       Faculty
          |              |              |
          +--------------+--------------+
                         |
                         v
                Teaching Assignment
                         |
                         v
                 Attendance Session
                         |
              +----------+----------+
              |          |          |
              v          v          v
          QR Tokens   Devices    Attendance
                                    |
                              +-----+-----+
                              |           |
                              v           v
                           Selfie       Audit
                              |
                              v
                       Future Face
                       Embeddings
```

---

## 4. Existing ERP Tables

The following entities already exist in the SNIST ERP database and must be mapped to their existing production equivalents.

### 4.1 Users (`qr_users`)

Represents authenticated ERP users.

Concrete table: `qr_users`

Fields:
- `id`: `Integer` (PK, autoincrement)
- `username`: `String(50)` (Unique, indexed — Roll Number or Teacher SAP ID)
- `email`: `String(100)` (Unique, nullable)
- `password_hash`: `String(255)` (Bcrypt / Argon2)
- `role`: `Enum('SUPER_ADMIN', 'TEACHER', 'STUDENT')`
- `is_active`: `Boolean` (Default True)
- `must_change_password`: `Boolean` (Default False)
- `created_at`: `DateTime` (Default UTC)
- `updated_at`: `DateTime` (Default UTC)

Do not duplicate the authentication system.

---

## 5. Students (`qr_students`)

Represents institutional students.

Concrete table: `qr_students`

Fields:
- `id`: `Integer` (PK, autoincrement)
- `user_id`: `Integer` (Unique, FK to `qr_users.id`, nullable)
- `roll_number`: `String(50)` (Unique, canonical institutional Roll Number / SAP ID)
- `name`: `String(100)`
- `department_id`: `Integer` (FK to `qr_departments.id`, nullable)
- `academic_year_id`: `Integer` (FK to `qr_academic_years.id`, nullable)
- `section_id`: `Integer` (FK to `qr_sections.id`, nullable)
- `email`: `String(100)` (Nullable)
- `mobile`: `String(20)` (Nullable)
- `agency`: `String(100)` (Default "Regular")
- `registered_device_id`: `Integer` (Nullable)
- `join_date`: `String(20)` (YYYY-MM-DD)
- `created_at`: `DateTime` (Default UTC)
- `updated_at`: `DateTime` (Default UTC)

Use the existing student table.

---

## 6. Faculty (`qr_teachers`)

Represents institutional faculty.

Concrete table: `qr_teachers`

Critical identity: **SAP ID**

Fields:
- `id`: `Integer` (PK, autoincrement)
- `user_id`: `Integer` (Unique, FK to `qr_users.id`)
- `teacher_code`: `String(50)` (Unique, SAP ID)
- `name`: `String(100)`
- `department_id`: `Integer` (FK to `qr_departments.id`)
- `institutional_email`: `String(150)` (Mapped to `qr_users.email` / teacher profile)
- `mobile`: `String(20)` (Nullable)
- `google_sheet_id`: `String(255)` (Nullable)
- `created_at`: `DateTime` (Default UTC)
- `updated_at`: `DateTime` (Default UTC)

### Identity Rule
The faculty `SAP ID` is the canonical institutional faculty identifier. The institutional email is mapped to the SAP ID. Do NOT create a second faculty identity system.

---

## 7. Subjects (`qr_subjects`)

Represents academic subjects and courses.

Concrete table: `qr_subjects`

Fields:
- `id`: `Integer` (PK, autoincrement)
- `code`: `String(30)` (Unique, e.g. "CS501PC")
- `name`: `String(150)`
- `department_id`: `Integer` (FK to `qr_departments.id`)
- `academic_year_id`: `Integer` (FK to `qr_academic_years.id`)
- `credits`: `Integer` (Default 3)
- `status`: `String(20)` (Default 'ACTIVE')

Reuse the existing subject table.

---

## 8. Sections (`qr_sections`)

Represents class sections.

Concrete table: `qr_sections`

Fields:
- `id`: `Integer` (PK, autoincrement)
- `name`: `String(50)` (e.g. "CSE-A", "CSE-B")
- `department_id`: `Integer` (FK to `qr_departments.id`)
- `academic_year_id`: `Integer` (FK to `qr_academic_years.id`)
- `semester_id`: `Integer` (FK to `qr_semesters.id`, nullable)
- `status`: `String(20)` (Default 'ACTIVE')

Reuse existing tables.

---

## 9. Academic Years (`qr_academic_years`)

Example: `2025-26`, `2026-27`

Concrete table: `qr_academic_years`

Fields:
- `id`: `Integer` (PK, autoincrement)
- `name`: `String(50)` (e.g. "1st Year", "2nd Year", "2026-27")
- `start_date`: `String(20)` (Nullable)
- `end_date`: `String(20)` (Nullable)
- `status`: `String(20)` (Default 'ACTIVE')

---

## 10. Semesters (`qr_semesters`)

Concrete table: `qr_semesters`

Fields:
- `id`: `Integer` (PK, autoincrement)
- `name`: `String(100)` (e.g. "Odd Semester 2026-27")
- `academic_year_id`: `Integer` (FK to `qr_academic_years.id`, nullable)
- `start_date`: `String(20)` (ISO YYYY-MM-DD)
- `end_date`: `String(20)` (ISO YYYY-MM-DD)
- `total_planned_sessions`: `Integer` (Default 60)
- `is_active`: `Boolean` (Default True)
- `created_at`: `DateTime` (Default UTC)

Use the existing ERP representation.

---

## 11. Teaching Assignments (`qr_teacher_assignments`)

This is the central academic relationship.

A Teaching Assignment represents:
```text
Faculty + Subject + Section + Academic Year + Semester
```

Concrete table: `qr_teacher_assignments`

Fields:
- `id`: `Integer` (PK, autoincrement)
- `teacher_id`: `Integer` (FK to `qr_teachers.id`, nullable=False)
- `subject_id`: `Integer` (FK to `qr_subjects.id`, nullable=False)
- `section_id`: `Integer` (FK to `qr_sections.id`, nullable=False)
- `academic_year_id`: `Integer` (FK to `qr_academic_years.id`, nullable=True)
- `semester_id`: `Integer` (FK to `qr_semesters.id`, nullable=True)
- `created_at`: `DateTime` (Default UTC)
- `updated_at`: `DateTime` (Default UTC)

Relationships:
- `teacher_id -> qr_teachers.id`
- `subject_id -> qr_subjects.id`
- `section_id -> qr_sections.id`
- `academic_year_id -> qr_academic_years.id`
- `semester_id -> qr_semesters.id`

---

## 12. Teaching Assignment Constraints

A Teaching Assignment should not accidentally create duplicate academic relationships.

Existing ERP allows a teacher to have assignments across multiple sections or multiple subjects, but duplicates of identical `(teacher_id, subject_id, section_id)` within the same active academic period should be guarded.

Do not add a uniqueness constraint blindly if the existing ERP allows legitimate co-teaching duplicates. Inspect existing business rules first.

---

## 13. Attendance Sessions (`qr_attendance_sessions`)

Table: `qr_attendance_sessions`

Represents one attendance session started by faculty.

Fields:
- `id`: `Integer` (PK, autoincrement)
- `teacher_id`: `Integer` (FK to `qr_teachers.id`, nullable=False)
- `subject_id`: `Integer` (FK to `qr_subjects.id`, nullable=False)
- `section_id`: `Integer` (FK to `qr_sections.id`, nullable=False)
- `period`: `String(100)` (e.g. "Period 1", "Period 1-4 (4 Periods)")
- `session_date`: `String(20)` (YYYY-MM-DD)
- `status`: `SQLEnum(SessionStatus)` (`OPEN`, `LOCKED`, `CANCELLED`)
- `display_type`: `String(30)` (Default 'projector'; 'phone_screen', 'laptop')
- `faculty_latitude`: `Float` (Nullable, Faculty GPS latitude at session start)
- `faculty_longitude`: `Float` (Nullable, Faculty GPS longitude at session start)
- `faculty_accuracy_m`: `Float` (Nullable, Faculty GPS accuracy radius in meters)
- `geofence_radius_m`: `Float` (Default 100.0, institutional geofence boundary)
- `created_at`: `DateTime` (Server UTC / IST authoritative timestamp)
- `locked_at`: `DateTime` (Nullable)

---

## 14. Attendance Session Relationships

```text
qr_attendance_sessions
        |
        +---- teacher (qr_teachers)
        |
        +---- subject (qr_subjects)
        |
        +---- section (qr_sections)
        |
        +---- qr_tokens (qr_short_tokens / attendance_qr_tokens)
        |
        +---- attendance_records (qr_attendance_records)
        |
        +---- audit_logs (qr_audit_logs)
```

---

## 15. Session Location

When a faculty member starts a session:
- `latitude`
- `longitude`
- `accuracy`

must be recorded from the faculty device.

The backend records the authoritative timestamp. The frontend timestamp must not determine security validity.

---

## 16. Geofence Radius

Default: **100 meters**

The radius is stored on the attendance session record:
`geofence_radius_m = 100.0`

This ensures historical sessions remain consistent even if the default configuration changes later.

---

## 17. Session Status

Possible values:
- `OPEN`: Actively accepting student attendance scans.
- `LOCKED`: Session closed; normal scans rejected; only authorized edits or grace period allowed.
- `CANCELLED`: Session invalidated; no attendance credited.

Follows `SessionStatus` enum in codebase.

---

## 18. QR Tokens (`qr_short_tokens` / `attendance_qr_tokens`)

Table: `qr_short_tokens` / `attendance_qr_tokens`

Represents rotating QR credentials associated with an attendance session.

Fields:
- `id`: `Integer` (PK, autoincrement)
- `session_id`: `Integer` (FK to `qr_attendance_sessions.id`, indexed)
- `short_code`: `String(16)` (Unique, Crockford Base32 8-16 char code)
- `issued_slot`: `Integer` (Epoch window index)
- `expires_slot`: `Integer` (Expiry window index)
- `is_active`: `Boolean` (Default True)
- `consumed_at`: `DateTime` (Nullable)
- `created_at`: `DateTime` (Default UTC)

---

## 19. QR Security

QR authentication uses: **HMAC-SHA256**

```text
canonical_payload
        |
        v
HMAC-SHA256(secret, payload)
        |
        v
signature
```

The secret must never be stored in:
- QR codes
- Frontend bundle
- `localStorage`
- `sessionStorage`
- Database plaintext

The actual secret lives in secure server-side configuration (`QR_HMAC_SECRET` / `PROJECTOR_SECRET_SALT`).

---

## 20. QR Token Validity

Target: **approximately 10–30 seconds** (10s rotation with grace steps).

Each token must be bound to:
- `session_id`
- `timestamp/window` (`step`)
- `nonce/token ID`

Backend validates:
1. HMAC Signature
2. Expiry window
3. Session binding
4. Replay state
5. Canonical payload structure

---

## 21. QR Replay Protection

A QR captured by another person must not be reusable indefinitely.

Implementation:
- Redis cache or in-memory LRU tracking of consumed nonces/tokens.
- Database recording of attendance transaction.
- Redis tracks token ID, session ID, expiry, and consumed state.
- Database remains the **authoritative attendance store**.

---

## 22. Student Devices (`device_bindings` / `student_devices`)

Table: `device_bindings` (Binding V2) and `qr_device_account_bindings` (Layer 2)

Represents an application-level hardware-backed device binding.

Fields (`device_bindings`):
- `id`: `Integer` (PK, autoincrement)
- `student_id`: `Integer` (FK to `qr_students.id`, indexed)
- `public_key`: `Text` (SPKI DER Base64 — 91 bytes raw / 124 chars Base64)
- `key_id`: `String(64)` (SHA-256 hex digest of SPKI public key)
- `enrolled_at`: `DateTime` (Default UTC, server authoritative)
- `enrolled_via`: `String(30)` (`self`, `faculty_reset`, `recovery`)
- `storage_persist_granted`: `Boolean` (Default False)
- `browser_profile_tag`: `String(64)` (Nullable telemetry tag)
- `revoked_at`: `DateTime` (Nullable — NULL indicates active binding)
- `revoked_reason`: `String(30)` (Nullable: `rebind`, `admin_reset`, `churn_limit`, `student_request`)
- `created_at`: `DateTime` (Default UTC)
- `updated_at`: `DateTime` (Default UTC)

Constraint:
- Unique partial index: `UNIQUE(student_id)` where `revoked_at IS NULL`. Exactly one active device per student.

---

## 23. Device Identity

Prefer: **random application-generated identifier & Web Crypto non-extractable asymmetric keypair**.

Do not depend on invasive browser fingerprinting.

```text
Student Device (PWA)
   |
   v
Generates non-extractable ECDSA P-256 Keypair in IndexedDB
   |
   v
Backend enrolls Public Key (SPKI)
   |
   v
Device bound to Student SAP ID / Roll Number
```

---

## 24. Device Status

Possible values:
- `PENDING`: Enrolled but awaiting email OTP verification.
- `ACTIVE`: Fully verified and authorized to sign scan challenges (`revoked_at IS NULL`).
- `REVOKED`: Deactivated via rebind, admin reset, or account churn (`revoked_at IS NOT NULL`).

A revoked device must not be allowed to create attendance.

---

## 25. Device Security

The backend must verify:
```text
Authenticated Student == Student Owning Registered Device
```

A device belonging to Student A must never authorize Student B.
Layer 2 additionally enforces a 30-minute lock on hardware switching.

---

## 26. Attendance Records (`qr_attendance_records`)

Table: `qr_attendance_records`

This is the **authoritative attendance state**.

Fields:
- `id`: `Integer` (PK, autoincrement)
- `session_id`: `Integer` (FK to `qr_attendance_sessions.id`, nullable=False)
- `student_id`: `Integer` (FK to `qr_students.id`, nullable=False)
- `roll_number`: `String(50)` (Immutable institutional identity)
- `session_date`: `String(20)` (YYYY-MM-DD)
- `period_count`: `Integer` (Default 4, 1-8 periods)
- `status`: `SQLEnum(AttendanceStatus)` (`PRESENT`, `ABSENT`, `LATE`)
- `is_approved_absence`: `Boolean` (Default False, indexed)
- `approved_absence_reason`: `String(100)` (Nullable: `MEDICAL`, `SPORTS`, `DUTY`)
- `scan_mode`: `String(50)` (`QR_CAMERA`, `QR_CAMERA_FALLBACK`, `MANUAL`, `PROJECTOR_SCAN`)
- `manual_reason`: `String(50)` (Nullable: `scanner_failed`, `device_lost`, `late_join`, `other`)
- `manual_reason_detail`: `String(255)` (Nullable)
- `manual_marked_by_id`: `Integer` (Nullable faculty user_id)
- `student_latitude`: `Float` (Nullable, GPS coordinate captured at scan)
- `student_longitude`: `Float` (Nullable, GPS coordinate captured at scan)
- `gps_accuracy_m`: `Float` (Nullable, client GPS accuracy radius)
- `distance_m`: `Float` (Nullable, server-computed Haversine distance to faculty)
- `device_binding_id`: `Integer` (Nullable FK to `device_bindings.id`)
- `selfie_status`: `String(30)` (Nullable: `PENDING`, `ACCEPTED`, `FAILED`, `SKIPPED`)
- `selfie_storage_key`: `String(255)` (Nullable, private object storage reference)
- `scanned_at`: `DateTime` (Server-authoritative UTC timestamp)

---

## 27. Attendance Method

Possible values:
- `QR_CAMERA`: Standard student camera scan of rotating QR.
- `QR_CAMERA_FALLBACK`: Controlled fallback scan path after camera failure.
- `PROJECTOR_SCAN`: Classroom projector display scan.
- `MANUAL`: Faculty manual override mark.

The stored method must accurately represent how attendance was created. Never record `QR_CAMERA` when the camera was not actually used.

---

## 28. Attendance Status

Possible values:
- `PRESENT`: Marked present for class credit.
- `ABSENT`: Absent from session.
- `LATE`: Marked late with partial or flagged credit.

Do not create unnecessary statuses.

---

## 29. Critical Unique Constraint

The database must enforce:
```sql
UNIQUE(session_id, student_id)
```

Constraint Name: `uq_session_student_attendance`

This guarantees that one student cannot create multiple attendance records for the same session. Frontend duplicate checks are not sufficient.

---

## 30. Attendance Transaction

Attendance creation must occur inside an atomic database transaction:

```text
BEGIN TRANSACTION
  │
  ├── Validate request & auth
  ├── Validate session (status == OPEN)
  ├── Validate QR HMAC signature & freshness
  ├── Validate device binding & account lock
  ├── Validate GPS coordinates & compute Haversine distance (<= geofence_radius_m)
  ├── Check duplicate (SELECT ... FOR UPDATE or UNIQUE constraint)
  ├── Insert / update AttendanceRecord (status = PRESENT)
  └── Insert AuditLog record
COMMIT
```

If any critical operation fails: **ROLLBACK**.

---

## 31. Concurrent Requests

The system must handle:
```text
Request A ----\
               > Database Transaction -> Exactly One Record Accepted
Request B ----/
```
The database constraint guarantees maximum one successful record. Concurrent duplicates gracefully return `ALREADY_MARKED`.

---

## 32. GPS Evidence

Student GPS is recorded on the attendance record:
- `student_latitude`
- `student_longitude`
- `gps_accuracy_m`
- `distance_m`

This provides an auditable record of the physical evidence used for the attendance decision.

---

## 33. GPS Authority

The backend calculates:
```python
distance = haversine_distance(student_lat, student_lon, faculty_lat, faculty_lon)
```
The browser must never send a pre-calculated distance. The backend is the sole authority for distance calculation.

---

## 34. IP Location

IP geolocation must **NOT** be the primary 100m geofence mechanism.
It is recorded only as an audit signal (`ip_address`) in `qr_audit_logs`. IP location lacks the precision required for a 100-meter institutional boundary.

---

## 35. Selfie Records (`selfie_records`)

Table: `selfie_records`

Represents post-attendance selfie collection for future face-verification dataset building.

Fields:
- `id`: `Integer` (PK, autoincrement)
- `attendance_id`: `Integer` (FK to `qr_attendance_records.id`, nullable=False)
- `student_id`: `Integer` (FK to `qr_students.id`, nullable=False)
- `session_id`: `Integer` (FK to `qr_attendance_sessions.id`, nullable=False)
- `object_storage_key`: `String(255)` (Unique, private storage path)
- `mime_type`: `String(50)` (e.g. `image/jpeg`, `image/webp`)
- `file_size`: `Integer` (Bytes)
- `width`: `Integer` (Pixels)
- `height`: `Integer` (Pixels)
- `quality_status`: `String(30)` (`PASSED`, `BLURRY`, `LOW_LIGHT`, `NO_FACE`, `MULTIPLE_FACES`)
- `face_count`: `Integer` (Default 1)
- `captured_at`: `DateTime` (Client capture timestamp)
- `uploaded_at`: `DateTime` (Server upload timestamp)
- `status`: `String(30)` (`PENDING`, `UPLOADED`, `FAILED`, `REJECTED`)
- `created_at`: `DateTime` (Default UTC)
- `updated_at`: `DateTime` (Default UTC)

---

## 36. Selfie Storage

- **Raw image**: Private Object Storage (MinIO / S3 / secure local volume).
- **Database**: Metadata + Storage Object Key.
- **Public access**: Forbidden. Never expose public URLs or public S3 buckets.

---

## 37. Object Storage Key

Use server-generated identifiers. Never use student names or roll numbers in filenames:
```text
attendance-selfies/2026/09/<session_id>/<student_id>/<uuid4>.jpg
```

---

## 38. Selfie Status

Possible values:
- `PENDING`: Awaiting capture/upload.
- `UPLOADED`: Successfully stored in private storage.
- `FAILED`: Camera/network error during selfie collection.
- `REJECTED`: Image failed quality checks (e.g. no face detected).

---

## 39. Attendance vs Selfie Independence

Attendance and selfie collection are separate states:
```text
Attendance: PRESENT
Selfie:     FAILED
```
This is completely valid. If selfie collection fails, the attendance record remains **PRESENT**. Selfie failure must never invalidate or reverse accepted attendance.

---

## 40. Audit Logs (`qr_audit_logs`)

Table: `qr_audit_logs`

Purpose: Record how attendance and security decisions occurred.

Fields:
- `id`: `Integer` (PK, autoincrement)
- `session_id`: `Integer` (Nullable)
- `attendance_id`: `Integer` (Nullable)
- `student_id`: `Integer` (Nullable)
- `roll_number`: `String(50)` (Nullable, indexed)
- `user_id`: `Integer` (Nullable, FK to `qr_users.id`)
- `device_id`: `Integer` (Nullable)
- `event_type`: `String(50)` (Indexed)
- `action`: `String(100)` (Indexed)
- `details`: `Text` (Structured JSON string)
- `ip_address`: `String(50)` (Nullable)
- `created_at`: `DateTime` (Default UTC, server authoritative)

---

## 41. Audit Event Types

Standard audit events:
- `SESSION_CREATED`, `SESSION_LOCKED`, `SESSION_CLOSED`
- `QR_GENERATED`, `QR_VALIDATION_FAILED`, `QR_REPLAY_DETECTED`
- `ATTENDANCE_ACCEPTED`, `ATTENDANCE_REJECTED`
- `GPS_VALIDATION_FAILED`, `GEOFENCE_FAILED`
- `DEVICE_VALIDATION_FAILED`, `DUPLICATE_ATTEMPT`
- `CAMERA_FAILURE`, `CAMERA_RECOVERY`, `FALLBACK_USED`
- `SELFIE_SUBMITTED`, `SELFIE_FAILED`
- `DEVICE_REGISTERED`, `DEVICE_REVOKED`, `DEVICE_REBOUND`

---

## 42. Audit Metadata

Stored in `details` column as JSON.
```json
{
  "reason": "OUTSIDE_GEOFENCE",
  "distance_meters": 147.2,
  "allowed_radius_meters": 100.0,
  "gps_accuracy_meters": 12.5
}
```
Secrets (passwords, HMAC keys, private keys) must **never** be logged.

---

## 43. Audit Integrity

- Append-only schema; no UPDATE or DELETE grants to regular application roles.
- Server-generated UTC timestamps.
- Indexed by `created_at`, `roll_number`, and `event_type`.

---

## 44. Future Face Embeddings (`face_embeddings`) — FUTURE EXTENSION

> [!NOTE]
> This table is for FUTURE functionality. It must NOT determine attendance during MVP.

Table: `face_embeddings`

Fields:
- `id`: `Integer` (PK, autoincrement)
- `student_id`: `Integer` (FK to `qr_students.id`, indexed)
- `embedding_type`: `String(30)` (`CANONICAL`, `RECENT`)
- `model_version`: `String(50)` (e.g. "insightface-mobilefacenet-v1")
- `embedding_data`: `LargeBinary` / `BLOB` (Encrypted 512-d float array)
- `quality_score`: `Float`
- `is_canonical`: `Boolean` (Default False)
- `source_selfie_id`: `Integer` (FK to `selfie_records.id`)
- `created_at`: `DateTime` (Default UTC)
- `updated_at`: `DateTime` (Default UTC)

---

## 45. Face Embedding Strategy

Each student will eventually have:
- `1 canonical embedding` (Primary reference)
- `Up to 5 recent verified embeddings` (Captures natural variation)

---

## 46. Canonical Embedding Protection

Never automatically overwrite the canonical embedding with every new selfie. Replacement requires administrative approval, quality score verification, and full audit trail.

---

## 47. Embedding Security

Embeddings are sensitive biometric identifiers:
- Encrypted at rest.
- Restricted DB access.
- Strictly isolated from public endpoints.
- Retention policies enforced.

---

## 48. Future Face Verification Events (`face_verification_events`) — FUTURE EXTENSION

Table: `face_verification_events`

Fields:
- `id`: `Integer` (PK, autoincrement)
- `student_id`: `Integer` (FK to `qr_students.id`)
- `attendance_id`: `Integer` (FK to `qr_attendance_records.id`)
- `model_version`: `String(50)`
- `similarity_score`: `Float`
- `threshold_version`: `String(30)`
- `result`: `String(20)` (`MATCH`, `NO_MATCH`, `INDETERMINATE`)
- `liveness_result`: `String(20)` (`PASS`, `FAIL`, `SKIPPED`)
- `processing_time_ms`: `Float`
- `created_at`: `DateTime` (Default UTC)

Do not create this table until face verification is actively implemented.

---

## 49. Face Verification Principle

Prefer **1:1 verification** (Student claims identity via login, system verifies claimed student's embeddings) rather than **1:N identification** (searching entire student database).

---

## 50. Timetable Relationship

Timetable links to `qr_teacher_assignments`:
```text
Teaching Assignment ──> Timetable Entry (Day, Period, Room, Start Time, End Time)
```
Reuse existing assignment relations rather than duplicating faculty/subject/section.

---

## 51. Timetable and Attendance

Timetable guides scheduling but does **not** lock out legitimate historical attendance. Faculty must be able to conduct previous or missed sessions with explicit audit trails.

---

## 52. Indexes

Key production indexes:
- `qr_attendance_sessions`: `(teacher_id, session_date)`, `(subject_id, session_date)`, `(section_id, session_date)`, `(teacher_id, created_at)`
- `qr_attendance_records`: `(session_id, student_id)` [UNIQUE], `student_id`, `session_date`
- `device_bindings`: `key_id`, `student_id`, `revoked_at`, `uq_student_active_binding`
- `qr_audit_logs`: `created_at`, `user_id`, `roll_number`, `event_type`
- `selfie_records`: `attendance_id`, `student_id`

---

## 53. Foreign Keys

Foreign key constraints safeguard referential integrity:
- `qr_attendance_sessions.teacher_id -> qr_teachers.id`
- `qr_attendance_sessions.subject_id -> qr_subjects.id`
- `qr_attendance_sessions.section_id -> qr_sections.id`
- `qr_attendance_records.session_id -> qr_attendance_sessions.id`
- `qr_attendance_records.student_id -> qr_students.id`
- `selfie_records.attendance_id -> qr_attendance_records.id`

---

## 54. Delete Rules

Preserve historical records. Never use unrestricted cascades that wipe institutional history:
- Restrict or soft-delete on teachers, students, subjects, sections.
- `ON DELETE RESTRICT` for academic references.

---

## 55. Soft Deletion

Where entities support deactivation:
- Use `is_active = False` or `revoked_at = NOW()` rather than physical row deletion.
- Never delete historical attendance sessions or records.

---

## 56. Time Handling

- **Database Storage**: UTC (`DateTime`, `datetime.utcnow`).
- **Application Logic**: Server-authoritative IST (`Asia/Kolkata`) / UTC.
- **Client Display**: Formatted IST for students and faculty.
- **Security Decisions**: Client device clocks are untrusted.

---

## 57. Database Time

All security timestamps originate from the server:
- Session start / lock time.
- QR slot and expiry time.
- Attendance scan timestamp (`scanned_at`).
- Audit log timestamps (`created_at`).

---

## 58. Data Integrity

The database guarantees:
- No attendance record without valid student.
- No attendance record without active session.
- No attendance record for revoked device.
- No duplicate attendance for same student and session.

---

## 59. Idempotency

Retried requests for the same student and session gracefully return `ALREADY_MARKED` with status HTTP 200, preventing duplicate records or false error states.

---

## 60. Database Transactions

Atomic scan commits:
```text
BEGIN
  ├── Validate all constraints
  ├── Write qr_attendance_records
  ├── Write qr_audit_logs
COMMIT
```

---

## 61. Migration Rules

Every schema modification must follow defensive migration patterns:
- SQLite and MySQL compatible DDL.
- Non-destructive column additions.
- Try-except error boundaries so startup never crashes.

---

## 62. Production Data Protection

- No public database ports.
- Encrypted connections (SSL/TLS).
- Regular automated backups.
- Least-privilege DB credentials.

---

## 63. Database Environment Separation

Separate database instances for:
1. `Development`: Local / In-memory SQLite.
2. `Staging`: Staging MySQL.
3. `Production`: Production MySQL / MariaDB cluster.

Local environments must never connect to production databases.

---

## 64. Conceptual Entity Relationship

```text
USER
 |
 +--------------------+
 |                    |
 v                    v
STUDENT             FACULTY
 |                    |
 |                    |
 |              TEACHING_ASSIGNMENT
 |                    |
 |                    v
 |             ATTENDANCE_SESSION
 |                    |
 |             +------+------+
 |             |             |
 |             v             v
 |        QR_TOKEN       AUDIT_LOG
 |
 +---- STUDENT_DEVICE
 |
 v
ATTENDANCE_RECORD
 |
 +----------------+
 |                |
 v                v
SELFIE_RECORD   AUDIT_LOG
 |
 v
FUTURE FACE EMBEDDING
```

---

## 65. Minimum MVP Tables

The MVP requires:
1. Existing ERP identity tables (`qr_users`, `qr_students`, `qr_teachers`, `qr_departments`, `qr_academic_years`, `qr_sections`, `qr_subjects`)
2. `qr_teacher_assignments`
3. `qr_attendance_sessions` (with GPS coordinates and geofence radius)
4. `qr_short_tokens` (ephemeral rotating QR registry)
5. `device_bindings` (Binding V2 keypair binding) & `qr_device_account_bindings`
6. `qr_attendance_records` (with GPS evidence and selfie references)
7. `selfie_records` (private selfie metadata)
8. `qr_audit_logs` (tamper-evident decision audit log)

Future tables (`face_embeddings`, `face_verification_events`) remain deferred.

---

## 66. Do Not Over-Engineer

Do not create tables for features that are not yet implemented. Keep the database clean, focused on the MVP, and easily evolvable.

---

## 67. Golden Database Rule

> **The database is the authoritative source of attendance state.**
> 
> The frontend can request: *"Mark me present."*  
> The backend decides: *"Is this attendance valid?"*  
> The database records: *"Yes/No — and exactly one authoritative attendance state."*  
> The audit system records: *"How did the system reach that decision?"*

---

## 68. Final Database Integrity Model

```text
Authenticated Student
        |
        v
Valid Session
        |
        v
Valid QR
        |
        v
Valid Device
        |
        v
Valid GPS
        |
        v
Inside Geofence
        |
        v
No Existing Attendance
        |
        v
DATABASE TRANSACTION
        |
        +---- Attendance Record
        |
        +---- Audit Record
        |
        v
Authoritative Attendance
```

The attendance database must always remain the final source of truth.

---

## 69. Cryptographic Device Identity Schema (`device_bindings`)

To support non-exportable asymmetric keypair authorization and eliminate false device collisions among identical phone models, `device_bindings` is defined as follows:

```sql
CREATE TABLE device_bindings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT NOT NULL,
    device_id VARCHAR(64) NOT NULL,            -- Client-generated UUID handle for routing/telemetry
    public_key TEXT NOT NULL,                   -- SubjectPublicKeyInfo (SPKI) DER in Base64
    key_id VARCHAR(64) NOT NULL,                -- SHA-256 hex digest of SPKI DER
    key_algorithm VARCHAR(32) DEFAULT 'ECDSA_P256' NOT NULL,
    client_type VARCHAR(16) DEFAULT 'WEB' NOT NULL,  -- 'WEB', 'PWA', 'ANDROID_APP'
    key_version INT DEFAULT 1 NOT NULL,
    status VARCHAR(16) DEFAULT 'ACTIVE' NOT NULL,    -- 'ACTIVE', 'REVOKED'
    
    -- Informational Telemetry ONLY (Strictly prohibited from attendance authorization)
    device_label VARCHAR(128) NULL,             -- e.g. "Samsung Galaxy A55 5G"
    platform VARCHAR(64) NULL,                 -- e.g. "Android 14"
    browser_family VARCHAR(64) NULL,           -- e.g. "Chrome Mobile"
    app_version VARCHAR(32) NULL,              -- e.g. "2.4.0"
    
    -- Audit & Lifecycle Timestamps
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_verified_at DATETIME NULL,
    revoked_at DATETIME NULL,
    revoked_reason VARCHAR(64) NULL,
    
    CONSTRAINT fk_device_binding_student FOREIGN KEY (student_id) REFERENCES qr_students(id) ON DELETE CASCADE,
    INDEX idx_dev_bind_student_active (student_id, status),
    INDEX idx_dev_bind_device_id (device_id),
    INDEX idx_dev_bind_key_id (key_id)
);
```

### Critical Rules for `device_bindings`:
1. **Device Identifier ≠ Cryptographic Identity ≠ Physical Hardware Identity**:
   - `device_id` is merely a stable handle.
   - Cryptographic Identity is the ECDSA P-256 keypair.
   - Physical hardware identity (IMEI, MAC, IP, UA, canvas) is **NEVER** stored or used as an authorization factor.
2. **Key Reuse Lockout**: The backend enforces that no two students may register the same `key_id` / `public_key` (`DEVICE_KEY_REUSE_REJECTED` / HTTP 409).
3. **Single Active Device**: A student may have at most 1 active binding. Registering a replacement device requires explicit supersession (`replace_active: true`) or OTP friction, marking previous bindings as `REVOKED` without purging past attendance history.
