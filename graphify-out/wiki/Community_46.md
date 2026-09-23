# Community 46

> 22 nodes · cohesion 0.10

## Key Concepts

- **_generate_p256_keypair()** (13 connections) — `backend/tests/test_binding_phase3_api.py`
- **_sign_challenge_p1363()** (5 connections) — `backend/tests/test_binding_phase3_api.py`
- **.test_08_expired_challenge_rejected()** (5 connections) — `backend/tests/test_binding_phase3_api.py`
- **.test_06_challenge_and_verify_happy_path()** (4 connections) — `backend/tests/test_binding_phase3_api.py`
- **.test_07_replay_attack_rejected()** (4 connections) — `backend/tests/test_binding_phase3_api.py`
- **.test_02_happy_path_enrollment()** (3 connections) — `backend/tests/test_binding_phase3_api.py`
- **.test_03_idempotent_re_enrollment()** (3 connections) — `backend/tests/test_binding_phase3_api.py`
- **.test_04_rebind_requires_otp_friction()** (3 connections) — `backend/tests/test_binding_phase3_api.py`
- **.test_09_invalid_signature_and_brute_force_lockout()** (3 connections) — `backend/tests/test_binding_phase3_api.py`
- **.test_11_admin_revocation_workflow_and_churn_exemption()** (3 connections) — `backend/tests/test_binding_phase3_api.py`
- **.test_13_audit_trail_contains_no_raw_keys()** (3 connections) — `backend/tests/test_binding_phase3_api.py`
- **New student enrolls public key -> DEVICE_ENROLLED and single active row created.** (1 connections) — `backend/tests/test_binding_phase3_api.py`
- **Submitting the same public key again -> BINDING_REFRESH without OTP friction.** (1 connections) — `backend/tests/test_binding_phase3_api.py`
- **Enrolling a NEW key when active binding exists -> REBIND_REQUIRED and OTP…** (1 connections) — `backend/tests/test_binding_phase3_api.py`
- **Complete challenge generation, signing, and sub-ms verification.** (1 connections) — `backend/tests/test_binding_phase3_api.py`
- **Submitting the same challenge token twice must be rejected with…** (1 connections) — `backend/tests/test_binding_phase3_api.py`
- **A challenge older than 60 seconds is rejected as challenge_expired.** (1 connections) — `backend/tests/test_binding_phase3_api.py`
- **5 signature verification failures trigger 15-minute brute-force lockout.** (1 connections) — `backend/tests/test_binding_phase3_api.py`
- **Helper to generate a real P-256 ECDSA keypair and return (private_key,…** (1 connections) — `backend/tests/test_binding_phase3_api.py`
- **Admin revokes binding: reason=admin_reset and exempt from student churn budget.** (1 connections) — `backend/tests/test_binding_phase3_api.py`
- **Audit log verification: ensure zero private keys, SPKI keys, or signatures in…** (1 connections) — `backend/tests/test_binding_phase3_api.py`
- **Helper to produce IEEE P1363 raw 64-byte signature Base64 (matching WebCrypto…** (1 connections) — `backend/tests/test_binding_phase3_api.py`

## Relationships

- [Community 10](Community_10.md) (11 shared connections)
- [Community 1](Community_1.md) (2 shared connections)
- [Community 25](Community_25.md) (1 shared connections)

## Source Files

- `backend/tests/test_binding_phase3_api.py`

## Audit Trail

- EXTRACTED: 37 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*