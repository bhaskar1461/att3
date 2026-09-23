# Community 21

> 46 nodes · cohesion 0.06

## Key Concepts

- **_generate_p256_keypair()** (13 connections) — `backend/tests/test_cryptographic_device_identity.py`
- **._get_broadcast_token()** (10 connections) — `backend/tests/test_binding_phase4_scan.py`
- **_generate_p256_keypair()** (8 connections) — `backend/tests/test_binding_phase4_scan.py`
- **_sign_challenge_p1363()** (8 connections) — `backend/tests/test_binding_phase4_scan.py`
- **._enroll_binding()** (8 connections) — `backend/tests/test_binding_phase4_scan.py`
- **._create_session_and_get_token()** (8 connections) — `backend/tests/test_cryptographic_device_identity.py`
- **.test_02_enrolled_valid_signature_succeeds()** (7 connections) — `backend/tests/test_binding_phase4_scan.py`
- **.test_04_wrong_key_signature_rejected()** (7 connections) — `backend/tests/test_binding_phase4_scan.py`
- **.test_05_expired_challenge_rejected()** (7 connections) — `backend/tests/test_binding_phase4_scan.py`
- **.test_06_replayed_challenge_rejected()** (7 connections) — `backend/tests/test_binding_phase4_scan.py`
- **_sign_challenge_p1363()** (7 connections) — `backend/tests/test_cryptographic_device_identity.py`
- **.test_revoked_device_rejection_and_past_attendance_preservation()** (6 connections) — `backend/tests/test_cryptographic_device_identity.py`
- **.test_ten_identical_phone_models_concurrent_enrollment_and_attendance()** (6 connections) — `backend/tests/test_cryptographic_device_identity.py`
- **.test_08_verify_duration_within_budget()** (5 connections) — `backend/tests/test_binding_phase4_scan.py`
- **.test_challenge_replay_rejection()** (5 connections) — `backend/tests/test_cryptographic_device_identity.py`
- **.test_cross_student_possession_attempt_rejection()** (5 connections) — `backend/tests/test_cryptographic_device_identity.py`
- **.test_missing_signature_rejection_binding_required()** (5 connections) — `backend/tests/test_cryptographic_device_identity.py`
- **.test_untrusted_client_claims_rejected()** (5 connections) — `backend/tests/test_cryptographic_device_identity.py`
- **.test_cross_student_key_reuse_rejection()** (4 connections) — `backend/tests/test_cryptographic_device_identity.py`
- **.test_invalid_signature_rejection()** (4 connections) — `backend/tests/test_cryptographic_device_identity.py`
- **.test_multi_device_limit_and_replace_active()** (4 connections) — `backend/tests/test_cryptographic_device_identity.py`
- **.test_01_flag_off_scan_succeeds_without_binding()** (3 connections) — `backend/tests/test_binding_phase4_scan.py`
- **.test_03_unenrolled_student_gets_binding_required()** (3 connections) — `backend/tests/test_binding_phase4_scan.py`
- **.test_07_offline_submission_skips_binding()** (3 connections) — `backend/tests/test_binding_phase4_scan.py`
- **Helper: generates a real P-256 ECDSA keypair; returns (private_key, spki_b64,…** (2 connections) — `backend/tests/test_binding_phase4_scan.py`
- *... and 21 more nodes in this community*

## Relationships

- [Community 43](Community_43.md) (32 shared connections)
- [Community 25](Community_25.md) (9 shared connections)
- [Community 1](Community_1.md) (4 shared connections)
- [Community 3](Community_3.md) (2 shared connections)
- [Community 10](Community_10.md) (1 shared connections)

## Source Files

- `backend/tests/test_binding_phase4_scan.py`
- `backend/tests/test_cryptographic_device_identity.py`

## Audit Trail

- EXTRACTED: 110 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*