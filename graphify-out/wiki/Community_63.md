# Community 63

> 16 nodes · cohesion 0.12

## Key Concepts

- **TestDeviceBindingSecurity** (25 connections) — `backend/tests/test_device_binding.py`
- **.test_01_normal_login()** (4 connections) — `backend/tests/test_device_binding.py`
- **.test_03_different_account_rejection()** (4 connections) — `backend/tests/test_device_binding.py`
- **.test_05_eleven_attempts_limit()** (4 connections) — `backend/tests/test_device_binding.py`
- **.test_04_logout_bypass_prevention()** (2 connections) — `backend/tests/test_device_binding.py`
- **.test_08_storage_clearing_protection()** (2 connections) — `backend/tests/test_device_binding.py`
- **.test_09_current_device_endpoint()** (2 connections) — `backend/tests/test_device_binding.py`
- **.test_11_silent_token_refresh_does_not_increment_attempt_count()** (2 connections) — `backend/tests/test_device_binding.py`
- **Test 4 — Logout Bypass (Device 04 -> 21CS001, Logout, Device 04 -> 21CS002) ->…** (1 connections) — `backend/tests/test_device_binding.py`
- **Test 5 — Eleven Attempts (Device 05 -> 21CS001 x 10 allowed, Attempt 11…** (1 connections) — `backend/tests/test_device_binding.py`
- **Test 8 — Storage Clearing Protection (New request without tokens from same…** (1 connections) — `backend/tests/test_device_binding.py`
- **Test 9 — Current Device API Endpoint** (1 connections) — `backend/tests/test_device_binding.py`
- **Test 11 — Silent token refresh (/auth/refresh) must not increment attempt_count…** (1 connections) — `backend/tests/test_device_binding.py`
- **Test 1 — Normal Login (Device 01 -> 21CS001) -> SUCCESS** (1 connections) — `backend/tests/test_device_binding.py`
- **Test 3 — Different Account (Device 03 -> 21CS001, then Device 03 -> 21CS002) ->…** (1 connections) — `backend/tests/test_device_binding.py`
- **.tearDown()** (1 connections) — `backend/tests/test_device_binding.py`

## Relationships

- [Community 5](Community_5.md) (11 shared connections)
- [Community 0](Community_0.md) (7 shared connections)
- [Community 3](Community_3.md) (2 shared connections)
- [Community 1](Community_1.md) (1 shared connections)
- [Community 4](Community_4.md) (1 shared connections)
- [Community 6](Community_6.md) (1 shared connections)

## Source Files

- `backend/tests/test_device_binding.py`

## Audit Trail

- EXTRACTED: 27 (71%)
- INFERRED: 11 (29%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*