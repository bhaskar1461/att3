# Community 80

> 13 nodes · cohesion 0.15

## Key Concepts

- **TestSessionStabilityAndAuthHardening** (16 connections) — `backend/tests/test_session_stability.py`
- **.test_02_refresh_with_expired_access_token_succeeds()** (4 connections) — `backend/tests/test_session_stability.py`
- **.test_06_account_switching_on_same_device_blocks_403()** (4 connections) — `backend/tests/test_session_stability.py`
- **.test_03_refresh_with_expired_refresh_token_fails_with_401()** (3 connections) — `backend/tests/test_session_stability.py`
- **.test_04_relogin_from_bound_device_10_times_succeeds_11th_429()** (2 connections) — `backend/tests/test_session_stability.py`
- **.test_05_failed_login_budget_isolated_from_successful_logins()** (2 connections) — `backend/tests/test_session_stability.py`
- **Verify that when the access token has expired, /auth/refresh with refresh token…** (1 connections) — `backend/tests/test_session_stability.py`
- **Verify that when refresh token itself has expired (> 12h), /auth/refresh…** (1 connections) — `backend/tests/test_session_stability.py`
- **Requirement R2: Re-login from same bound device is allowed up to 10x per…** (1 connections) — `backend/tests/test_session_stability.py`
- **Requirement R3: Failed attempts (wrong password) do NOT penalize successful…** (1 connections) — `backend/tests/test_session_stability.py`
- **Rule 6: Device bound to Student A cannot switch to Student B within 30 min ->…** (1 connections) — `backend/tests/test_session_stability.py`
- **.setUpClass()** (1 connections) — `backend/tests/test_session_stability.py`
- **.tearDown()** (1 connections) — `backend/tests/test_session_stability.py`

## Relationships

- [Community 0](Community_0.md) (9 shared connections)
- [Community 17](Community_17.md) (3 shared connections)
- [Community 1](Community_1.md) (1 shared connections)
- [Community 6](Community_6.md) (1 shared connections)

## Source Files

- `backend/tests/test_session_stability.py`

## Audit Trail

- EXTRACTED: 20 (77%)
- INFERRED: 6 (23%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*