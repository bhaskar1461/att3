# Community 30

> 37 nodes · cohesion 0.06

## Key Concepts

- **test_devops_hardening.py** (15 connections) — `backend/tests/test_devops_hardening.py`
- **app_api_auth** (14 connections)
- **FailedLoginRateLimiter** (9 connections) — `backend/app/api/auth.py`
- **FailedTokenTracker** (9 connections) — `backend/app/api/student.py`
- **StudentScanRateLimiter** (7 connections) — `backend/app/api/student.py`
- **GlobalEmailQuotaLimiter** (7 connections) — `backend/app/services/email_service.py`
- **test_am1_failed_login_per_roll_isolation()** (3 connections) — `backend/tests/test_devops_hardening.py`
- **test_am200_student_scan_rate_limiter_per_roll()** (3 connections) — `backend/tests/test_devops_hardening.py`
- **test_am3_failed_token_tracker_valid_exemption()** (3 connections) — `backend/tests/test_devops_hardening.py`
- **test_failed_token_tracker_brute_force_lockout()** (3 connections) — `backend/tests/test_devops_hardening.py`
- **test_global_email_quota_limiter()** (3 connections) — `backend/tests/test_devops_hardening.py`
- **.record_success()** (2 connections) — `backend/app/api/student.py`
- **.reset_limit()** (2 connections) — `backend/app/api/student.py`
- **.check_rate_limit()** (1 connections) — `backend/app/api/auth.py`
- **.get_remaining_attempts()** (1 connections) — `backend/app/api/auth.py`
- **.__init__()** (1 connections) — `backend/app/api/auth.py`
- **.record_failure()** (1 connections) — `backend/app/api/auth.py`
- **.record_success()** (1 connections) — `backend/app/api/auth.py`
- **In-memory thread-safe rate limiter tracking failed login attempts strictly per…** (1 connections) — `backend/app/api/auth.py`
- **.check_rate_limit()** (1 connections) — `backend/app/api/student.py`
- **.__init__()** (1 connections) — `backend/app/api/student.py`
- **.record_failure()** (1 connections) — `backend/app/api/student.py`
- **In-memory thread-safe rate limiter for failed rotating QR token validations (A3…** (1 connections) — `backend/app/api/student.py`
- **AM3: Exempt legitimate scans by resetting any failure history immediately.** (1 connections) — `backend/app/api/student.py`
- **In-memory rate limiter enforcing max 15 scan attempts per minute per ROLL…** (1 connections) — `backend/app/api/student.py`
- *... and 12 more nodes in this community*

## Relationships

- [Community 1](Community_1.md) (3 shared connections)
- [Community 13](Community_13.md) (3 shared connections)
- [Community 39](Community_39.md) (2 shared connections)
- [Community 4](Community_4.md) (2 shared connections)
- [Community 24](Community_24.md) (1 shared connections)
- [Community 33](Community_33.md) (1 shared connections)
- [Community 16](Community_16.md) (1 shared connections)
- [Community 32](Community_32.md) (1 shared connections)
- [Community 25](Community_25.md) (1 shared connections)
- [Community 19](Community_19.md) (1 shared connections)
- [Community 6](Community_6.md) (1 shared connections)
- [Community 5](Community_5.md) (1 shared connections)

## Source Files

- `backend/app/api/auth.py`
- `backend/app/api/student.py`
- `backend/app/services/email_service.py`
- `backend/tests/test_devops_hardening.py`

## Audit Trail

- EXTRACTED: 63 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*