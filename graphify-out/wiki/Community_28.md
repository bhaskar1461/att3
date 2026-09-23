# Community 28

> 39 nodes · cohesion 0.10

## Key Concepts

- **test_onboarding_and_credentials.py** (52 connections) — `backend/tests/test_onboarding_and_credentials.py`
- **get_server_ist_datetime()** (46 connections) — `backend/app/core/security.py`
- **onboarding_service.py** (36 connections) — `backend/app/services/onboarding_service.py`
- **log_onboarding_event()** (21 connections) — `backend/app/services/onboarding_service.py`
- **activate_student()** (16 connections) — `backend/app/services/onboarding_service.py`
- **generate_otp()** (14 connections) — `backend/app/services/onboarding_service.py`
- **verify_magic_token()** (13 connections) — `backend/app/services/onboarding_service.py`
- **generate_magic_token()** (11 connections) — `backend/app/services/onboarding_service.py`
- **set_student_pin()** (11 connections) — `backend/app/services/onboarding_service.py`
- **verify_otp()** (11 connections) — `backend/app/services/onboarding_service.py`
- **OnboardingOTP** (8 connections) — `backend/app/models/models.py`
- **OnboardingToken** (8 connections) — `backend/app/models/models.py`
- **OnboardingAuditLog** (7 connections) — `backend/app/models/models.py`
- **Session** (7 connections)
- **_hash_token()** (4 connections) — `backend/app/services/onboarding_service.py`
- **.test_complete_onboarding_activation()** (4 connections) — `backend/tests/test_onboarding_and_credentials.py`
- **.test_magic_link_token_lifecycle()** (4 connections) — `backend/tests/test_onboarding_and_credentials.py`
- **.test_otp_verification_flow()** (4 connections) — `backend/tests/test_onboarding_and_credentials.py`
- **.test_invalid_pin_rejection()** (3 connections) — `backend/tests/test_onboarding_and_credentials.py`
- **.test_public_onboarding_endpoints()** (3 connections) — `backend/tests/test_onboarding_and_credentials.py`
- **Returns server-authoritative current datetime in IST (Asia/Kolkata).** (1 connections) — `backend/app/core/security.py`
- **Magic link tokens — raw token NEVER stored, only SHA-256 hash.** (1 connections) — `backend/app/models/models.py`
- **Email OTP records for verification during onboarding wizard.** (1 connections) — `backend/app/models/models.py`
- **Dedicated onboarding audit trail — follows qr_audit_logs pattern.** (1 connections) — `backend/app/models/models.py`
- **SNIST ERP — Onboarding Service Token generation/verification, OTP, state…** (1 connections) — `backend/app/services/onboarding_service.py`
- *... and 14 more nodes in this community*

## Relationships

- [Community 16](Community_16.md) (32 shared connections)
- [Community 0](Community_0.md) (25 shared connections)
- [Community 26](Community_26.md) (18 shared connections)
- [Community 1](Community_1.md) (17 shared connections)
- [Community 27](Community_27.md) (13 shared connections)
- [Community 33](Community_33.md) (10 shared connections)
- [Community 2](Community_2.md) (8 shared connections)
- [Community 10](Community_10.md) (7 shared connections)
- [Community 17](Community_17.md) (5 shared connections)
- [Community 6](Community_6.md) (5 shared connections)
- [Community 8](Community_8.md) (3 shared connections)
- [Community 24](Community_24.md) (2 shared connections)

## Source Files

- `backend/app/core/security.py`
- `backend/app/models/models.py`
- `backend/app/services/onboarding_service.py`
- `backend/tests/test_onboarding_and_credentials.py`

## Audit Trail

- EXTRACTED: 213 (93%)
- INFERRED: 15 (7%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*