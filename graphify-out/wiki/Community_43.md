# Community 43

> 23 nodes · cohesion 0.11

## Key Concepts

- **TestCryptographicDeviceIdentity** (30 connections) — `backend/tests/test_cryptographic_device_identity.py`
- **TestBindingPhase4ScanPath** (28 connections) — `backend/tests/test_binding_phase4_scan.py`
- **._create_student()** (17 connections) — `backend/tests/test_cryptographic_device_identity.py`
- **setup_suite()** (17 connections) — `scripts/run_binding_phase5_regression_proof.py`
- **clear_binding_verify_lockouts()** (16 connections) — `backend/app/core/binding_crypto.py`
- **run_battery()** (13 connections) — `scripts/run_binding_phase5_regression_proof.py`
- **.test_expired_challenge_rejection()** (6 connections) — `backend/tests/test_cryptographic_device_identity.py`
- **_sign_challenge_p1363()** (5 connections) — `scripts/run_binding_phase5_regression_proof.py`
- **.test_forged_device_id_rejection()** (4 connections) — `backend/tests/test_cryptographic_device_identity.py`
- **bench_cohort()** (3 connections) — `scripts/run_binding_phase5_regression_proof.py`
- **get_live_qr()** (3 connections) — `scripts/run_binding_phase5_regression_proof.py`
- **.tearDown()** (2 connections) — `backend/tests/test_binding_phase4_scan.py`
- **.tearDown()** (2 connections) — `backend/tests/test_binding_phase6_edge_cases.py`
- **.tearDown()** (2 connections) — `backend/tests/test_cryptographic_device_identity.py`
- **submit_signed_scan()** (2 connections) — `scripts/run_binding_phase5_regression_proof.py`
- **Clears all recorded verification failures across all identifiers (testing…** (1 connections) — `backend/app/core/binding_crypto.py`
- **Comprehensive scan-path integration tests for the Binding V2 possession-proof.…** (1 connections) — `backend/tests/test_binding_phase4_scan.py`
- **Helper to create student and auth token.** (1 connections) — `backend/tests/test_cryptographic_device_identity.py`
- **Valid student signs challenge, but specifies a forged / unregistered device_id.…** (1 connections) — `backend/tests/test_cryptographic_device_identity.py`
- **Challenge token created in the past beyond CHALLENGE_TTL_SECONDS must be…** (1 connections) — `backend/tests/test_cryptographic_device_identity.py`
- **EllipticCurvePrivateKey** (1 connections)
- **override_get_db()** (1 connections) — `scripts/run_binding_phase5_regression_proof.py`
- **set_sqlite_pragma()** (1 connections) — `scripts/run_binding_phase5_regression_proof.py`

## Relationships

- [Community 0](Community_0.md) (40 shared connections)
- [Community 21](Community_21.md) (32 shared connections)
- [Community 1](Community_1.md) (11 shared connections)
- [Community 6](Community_6.md) (4 shared connections)
- [Community 4](Community_4.md) (4 shared connections)
- [Community 10](Community_10.md) (4 shared connections)
- [Community 25](Community_25.md) (3 shared connections)
- [Community 3](Community_3.md) (3 shared connections)
- [Community 20](Community_20.md) (1 shared connections)

## Source Files

- `backend/app/core/binding_crypto.py`
- `backend/tests/test_binding_phase4_scan.py`
- `backend/tests/test_binding_phase6_edge_cases.py`
- `backend/tests/test_cryptographic_device_identity.py`
- `scripts/run_binding_phase5_regression_proof.py`

## Audit Trail

- EXTRACTED: 82 (63%)
- INFERRED: 48 (37%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*