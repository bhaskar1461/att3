# Community 17

> 48 nodes · cohesion 0.08

## Key Concepts

- **auth.py** (68 connections) — `backend/app/api/auth.py`
- **login_for_access_token()** (22 connections) — `backend/app/api/auth.py`
- **get_current_user()** (19 connections) — `backend/app/api/auth.py`
- **login_via_magic_link()** (18 connections) — `backend/app/api/auth.py`
- **decode_access_token()** (15 connections) — `backend/app/core/security.py`
- **refresh_student_token()** (14 connections) — `backend/app/api/auth.py`
- **require_admin()** (12 connections) — `backend/app/api/auth.py`
- **verify_password()** (12 connections) — `backend/app/core/security.py`
- **Session** (10 connections)
- **require_teacher()** (10 connections) — `backend/app/api/auth.py`
- **generate_magic_link_endpoint()** (9 connections) — `backend/app/api/auth.py`
- **create_refresh_token()** (9 connections) — `backend/app/core/security.py`
- **get_magic_token_info()** (8 connections) — `backend/app/api/auth.py`
- **change_password()** (7 connections) — `backend/app/api/auth.py`
- **logout_user()** (7 connections) — `backend/app/api/auth.py`
- **BaseModel** (7 connections)
- **Request** (7 connections)
- **profile_auth_steps()** (7 connections) — `scripts/profile_auth_steps.py`
- **post** (6 connections)
- **decode_refresh_token()** (6 connections) — `backend/app/core/security.py`
- **verify_magic_login_token()** (6 connections) — `backend/app/core/security.py`
- **_async_login_audit_event()** (5 connections) — `backend/app/api/auth.py`
- **read_users_me()** (5 connections) — `backend/app/api/auth.py`
- **decode_access_token_with_status()** (4 connections) — `backend/app/core/security.py`
- **.test_01_login_issues_both_access_and_refresh_tokens()** (4 connections) — `backend/tests/test_session_stability.py`
- *... and 23 more nodes in this community*

## Relationships

- [Community 0](Community_0.md) (29 shared connections)
- [Community 5](Community_5.md) (28 shared connections)
- [Community 1](Community_1.md) (16 shared connections)
- [Community 6](Community_6.md) (12 shared connections)
- [Community 16](Community_16.md) (10 shared connections)
- [Community 19](Community_19.md) (10 shared connections)
- [Community 39](Community_39.md) (6 shared connections)
- [Community 77](Community_77.md) (6 shared connections)
- [Community 28](Community_28.md) (5 shared connections)
- [Community 2](Community_2.md) (5 shared connections)
- [Community 8](Community_8.md) (3 shared connections)
- [Community 33](Community_33.md) (3 shared connections)

## Source Files

- `backend/app/api/auth.py`
- `backend/app/core/security.py`
- `backend/tests/test_session_stability.py`
- `scripts/profile_auth_steps.py`
- `scripts/profile_login_breakdown.py`
- `scripts/test_vm_db.py`

## Audit Trail

- EXTRACTED: 204 (83%)
- INFERRED: 41 (17%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*