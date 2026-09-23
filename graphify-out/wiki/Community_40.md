# Community 40

> 25 nodes · cohesion 0.10

## Key Concepts

- **TestDeviceSelfServiceReset** (23 connections) — `backend/tests/test_device_self_service_reset.py`
- **patch** (8 connections)
- **.test_request_reset_semester_cap()** (4 connections) — `backend/tests/test_device_self_service_reset.py`
- **.test_verify_reset_with_placeholder_clears_enrollment_for_auto_enroll()** (4 connections) — `backend/tests/test_device_self_service_reset.py`
- **.test_request_reset_happy_path()** (3 connections) — `backend/tests/test_device_self_service_reset.py`
- **.test_request_reset_rate_limit()** (3 connections) — `backend/tests/test_device_self_service_reset.py`
- **.test_student_qr_code_unapproved_device_guard()** (3 connections) — `backend/tests/test_device_self_service_reset.py`
- **.test_verify_reset_expired_otp()** (3 connections) — `backend/tests/test_device_self_service_reset.py`
- **.test_verify_reset_happy_path_and_atomic_consumption()** (3 connections) — `backend/tests/test_device_self_service_reset.py`
- **.test_verify_reset_invalid_otp_increments_attempts()** (3 connections) — `backend/tests/test_device_self_service_reset.py`
- **.test_verify_reset_multi_otp_tolerance()** (3 connections) — `backend/tests/test_device_self_service_reset.py`
- **.test_admin_reset_role_guards()** (2 connections) — `backend/tests/test_device_self_service_reset.py`
- **.test_request_reset_wrong_password()** (2 connections) — `backend/tests/test_device_self_service_reset.py`
- **Wrong password fails with HTTP 401.** (1 connections) — `backend/tests/test_device_self_service_reset.py`
- **Max 3 requests per hour; 4th request returns HTTP 429.** (1 connections) — `backend/tests/test_device_self_service_reset.py`
- **Semester cap of 5 resets: attempt #6 triggers HTTP 403 and records…** (1 connections) — `backend/tests/test_device_self_service_reset.py`
- **Verifying correct OTP rebinds device; OTP cannot be reused a second time…** (1 connections) — `backend/tests/test_device_self_service_reset.py`
- **Invalid OTP code increments attempt count and rejects with 400.** (1 connections) — `backend/tests/test_device_self_service_reset.py`
- **Expired OTP is rejected.** (1 connections) — `backend/tests/test_device_self_service_reset.py`
- **Non-teacher/admin role calling reset-student-enrollment receives HTTP 403.** (1 connections) — `backend/tests/test_device_self_service_reset.py`
- **Calling /student/qr-code with unapproved device header triggers HTTP 403.** (1 connections) — `backend/tests/test_device_self_service_reset.py`
- **Self-service reset with placeholder DEV-RESET-V2 sets registered_device_id=None…** (1 connections) — `backend/tests/test_device_self_service_reset.py`
- **Requesting a second OTP doesn't immediately invalidate the first; first OTP…** (1 connections) — `backend/tests/test_device_self_service_reset.py`
- **Happy path: student requests OTP, email sent, DB OTP row created with 10-min…** (1 connections) — `backend/tests/test_device_self_service_reset.py`
- **.tearDown()** (1 connections) — `backend/tests/test_device_self_service_reset.py`

## Relationships

- [Community 0](Community_0.md) (6 shared connections)
- [Community 5](Community_5.md) (4 shared connections)
- [Community 10](Community_10.md) (2 shared connections)
- [Community 1](Community_1.md) (1 shared connections)
- [Community 6](Community_6.md) (1 shared connections)

## Source Files

- `backend/tests/test_device_self_service_reset.py`

## Audit Trail

- EXTRACTED: 36 (80%)
- INFERRED: 9 (20%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*