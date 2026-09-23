# Community 64

> 15 nodes · cohesion 0.16

## Key Concepts

- **TokenValidationError** (18 connections) — `backend/app/core/security.py`
- **validate_launch_token()** (15 connections) — `backend/app/services/launch_token.py`
- **claim_launch_token()** (9 connections) — `backend/app/api/launch.py`
- **validate_launch()** (7 connections) — `backend/app/api/launch.py`
- **.test_launch_token_generation_and_validation()** (5 connections) — `backend/tests/test_universal_launch_entry.py`
- **Session** (3 connections)
- **post** (2 connections)
- **get** (1 connections)
- **Public endpoint: validates a launch token and returns session metadata. This…** (1 connections) — `backend/app/api/launch.py`
- **Public endpoint: Immediately validates a fresh launch token upon scan/landing…** (1 connections) — `backend/app/api/launch.py`
- **Exception raised when QR / launch token validation fails.** (1 connections) — `backend/app/core/security.py`
- **.__init__()** (1 connections) — `backend/app/core/security.py`
- **Validates a launch token's signature and expiry. Accepts ONLY the current…** (1 connections) — `backend/app/services/launch_token.py`
- **Test 1: Launch token generation, signature validation, and URL extraction.** (1 connections) — `backend/tests/test_universal_launch_entry.py`
- **ValueError** (1 connections)

## Relationships

- [Community 8](Community_8.md) (9 shared connections)
- [Community 13](Community_13.md) (5 shared connections)
- [Community 99](Community_99.md) (3 shared connections)
- [Community 78](Community_78.md) (3 shared connections)
- [Community 3](Community_3.md) (2 shared connections)
- [Community 1](Community_1.md) (2 shared connections)
- [Community 38](Community_38.md) (2 shared connections)
- [Community 10](Community_10.md) (2 shared connections)
- [Community 106](Community_106.md) (1 shared connections)
- [Community 52](Community_52.md) (1 shared connections)
- [Community 77](Community_77.md) (1 shared connections)
- [Community 20](Community_20.md) (1 shared connections)

## Source Files

- `backend/app/api/launch.py`
- `backend/app/core/security.py`
- `backend/app/services/launch_token.py`
- `backend/tests/test_universal_launch_entry.py`

## Audit Trail

- EXTRACTED: 43 (86%)
- INFERRED: 7 (14%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*