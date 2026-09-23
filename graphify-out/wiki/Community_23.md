# Community 23

> 45 nodes · cohesion 0.06

## Key Concepts

- **_generate_p256_keypair()** (18 connections) — `backend/tests/test_binding_phase6_edge_cases.py`
- **_sign_challenge_p1363()** (10 connections) — `backend/tests/test_binding_phase6_edge_cases.py`
- **._get_active_qr_token()** (10 connections) — `backend/tests/test_binding_phase6_edge_cases.py`
- **.test_07_expired_challenge_token_rejected()** (6 connections) — `backend/tests/test_binding_phase6_edge_cases.py`
- **.test_09_concurrent_enrollment_race_safety()** (6 connections) — `backend/tests/test_binding_phase6_edge_cases.py`
- **.test_01_unbound_student_enroll_and_immediate_scan()** (5 connections) — `backend/tests/test_binding_phase6_edge_cases.py`
- **.test_02_storage_loss_recovery_with_rebind_otp()** (5 connections) — `backend/tests/test_binding_phase6_edge_cases.py`
- **.test_04_account_switching_cross_student_challenge_rejected()** (5 connections) — `backend/tests/test_binding_phase6_edge_cases.py`
- **.test_05_wrong_key_signature_rejected()** (5 connections) — `backend/tests/test_binding_phase6_edge_cases.py`
- **.test_06_challenge_replay_attack_rejected()** (5 connections) — `backend/tests/test_binding_phase6_edge_cases.py`
- **.test_08_duplicate_attendance_scan_prevention()** (5 connections) — `backend/tests/test_binding_phase6_edge_cases.py`
- **.test_14_brute_force_signature_failure_lockout()** (5 connections) — `backend/tests/test_binding_phase6_edge_cases.py`
- **_generate_p256_keypair()** (4 connections) — `backend/tests/test_binding_phase5_cutover.py`
- **_sign_challenge_p1363()** (4 connections) — `backend/tests/test_binding_phase5_cutover.py`
- **.test_08_inline_self_healing_enrollment_flow()** (4 connections) — `backend/tests/test_binding_phase5_cutover.py`
- **.test_15_self_service_device_reset_revokes_v2_binding()** (4 connections) — `backend/tests/test_binding_phase6_edge_cases.py`
- **.test_03_enrolled_student_v2_scan_success()** (3 connections) — `backend/tests/test_binding_phase5_cutover.py`
- **.test_03_invalid_rebind_otp_rejected()** (3 connections) — `backend/tests/test_binding_phase6_edge_cases.py`
- **.test_10_idempotent_re_enrollment_same_key()** (3 connections) — `backend/tests/test_binding_phase6_edge_cases.py`
- **.test_11_admin_revocation_allows_immediate_reenrollment()** (3 connections) — `backend/tests/test_binding_phase6_edge_cases.py`
- **.test_16_zero_raw_key_material_in_audit_logs()** (3 connections) — `backend/tests/test_binding_phase6_edge_cases.py`
- **Produces IEEE P1363 raw 64-byte signature Base64 (matching WebCrypto API…** (2 connections) — `backend/tests/test_binding_phase5_cutover.py`
- **override_get_db()** (2 connections) — `backend/tests/test_binding_phase6_edge_cases.py`
- **enroll_attempt()** (2 connections) — `backend/tests/test_binding_phase6_edge_cases.py`
- **Enrolled student with valid challenge token and ECDSA signature marks…** (1 connections) — `backend/tests/test_binding_phase5_cutover.py`
- *... and 20 more nodes in this community*

## Relationships

- [Community 0](Community_0.md) (17 shared connections)
- [Community 1](Community_1.md) (4 shared connections)
- [Community 66](Community_66.md) (2 shared connections)
- [Community 10](Community_10.md) (2 shared connections)
- [Community 25](Community_25.md) (1 shared connections)
- [Community 5](Community_5.md) (1 shared connections)

## Source Files

- `backend/tests/test_binding_phase5_cutover.py`
- `backend/tests/test_binding_phase6_edge_cases.py`

## Audit Trail

- EXTRACTED: 81 (95%)
- INFERRED: 4 (5%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*