# Community 25

> 43 nodes · cohesion 0.07

## Key Concepts

- **binding.py** (55 connections) — `backend/app/api/binding.py`
- **binding_crypto.py** (33 connections) — `backend/app/core/binding_crypto.py`
- **create_challenge_token()** (24 connections) — `backend/app/core/binding_crypto.py`
- **verify_binding_signature()** (14 connections) — `backend/app/api/binding.py`
- **check_verify_lockout()** (10 connections) — `backend/app/core/binding_crypto.py`
- **decode_and_validate_challenge_token()** (10 connections) — `backend/app/core/binding_crypto.py`
- **record_verify_failure()** (10 connections) — `backend/app/core/binding_crypto.py`
- **verify_ecdsa_p1363_signature()** (10 connections) — `backend/app/core/binding_crypto.py`
- **.test_09_lockout_after_repeated_failures()** (9 connections) — `backend/tests/test_binding_phase4_scan.py`
- **request_binding_challenge()** (8 connections) — `backend/app/api/binding.py`
- **BaseModel** (5 connections)
- **post** (5 connections)
- **build_canonical_challenge_message()** (5 connections) — `backend/app/core/binding_crypto.py`
- **EnrolledVia** (5 connections) — `backend/app/models/models.py`
- **create_test_canonical_device_proof()** (4 connections) — `backend/app/core/binding_crypto.py`
- **sign_canonical_challenge()** (4 connections) — `backend/app/core/binding_crypto.py`
- **BindingVerifyRequest** (3 connections) — `backend/app/api/binding.py`
- **ChallengeResponse** (3 connections) — `backend/app/api/binding.py`
- **DeviceEnrollmentRequest** (3 connections) — `backend/app/api/binding.py`
- **sign_challenge_token()** (3 connections) — `backend/app/core/binding_crypto.py`
- **ChallengeRequest** (2 connections) — `backend/app/api/binding.py`
- **check_binding_v2_enabled()** (2 connections) — `backend/app/api/binding.py`
- **RebindOtpRequest** (2 connections) — `backend/app/api/binding.py`
- **Any** (2 connections)
- **_urlsafe_b64decode()** (2 connections) — `backend/app/core/binding_crypto.py`
- *... and 18 more nodes in this community*

## Relationships

- [Community 1](Community_1.md) (38 shared connections)
- [Community 10](Community_10.md) (20 shared connections)
- [Community 13](Community_13.md) (14 shared connections)
- [Community 21](Community_21.md) (9 shared connections)
- [Community 2](Community_2.md) (7 shared connections)
- [Community 8](Community_8.md) (6 shared connections)
- [Community 0](Community_0.md) (5 shared connections)
- [Community 19](Community_19.md) (5 shared connections)
- [Community 43](Community_43.md) (3 shared connections)
- [Community 27](Community_27.md) (2 shared connections)
- [Community 15](Community_15.md) (2 shared connections)
- [Community 17](Community_17.md) (1 shared connections)

## Source Files

- `backend/app/api/binding.py`
- `backend/app/core/binding_crypto.py`
- `backend/app/models/models.py`
- `backend/tests/test_binding_phase4_scan.py`

## Audit Trail

- EXTRACTED: 181 (97%)
- INFERRED: 5 (3%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*