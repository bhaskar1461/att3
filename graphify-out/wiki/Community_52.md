# Community 52

> 19 nodes · cohesion 0.17

## Key Concepts

- **generate_projector_session_token()** (28 connections) — `backend/app/core/security.py`
- **validate_projector_session_token()** (20 connections) — `backend/app/core/security.py`
- **get_aes_key()** (16 connections) — `backend/app/core/security.py`
- **_int_to_base36()** (10 connections) — `backend/app/core/security.py`
- **.test_token_grace_window_boundaries()** (6 connections) — `backend/tests/test_scan_telemetry.py`
- **create_mock_projector_token()** (5 connections) — `scripts/run_adversarial_threat_drills.py`
- **.test_08_invalid_and_expired_qr_rejection()** (4 connections) — `backend/tests/test_phase9_security_and_integrity.py`
- **.test_period_count_clamping_and_bounds_validation()** (4 connections) — `backend/tests/test_projector_rotating_qr.py`
- **.test_token_sliding_grace_window()** (4 connections) — `backend/tests/test_projector_rotating_qr.py`
- **.test_strict_current_and_previous_window_verification()** (4 connections) — `backend/tests/test_qr_expiry_and_claim_flow.py`
- **.test_token_generation_and_sliding_window_validation()** (3 connections) — `backend/tests/test_projector_rotating_qr.py`
- **.test_token_tamper_rejection()** (3 connections) — `backend/tests/test_projector_rotating_qr.py`
- **Generates ultra-compact, high-contrast rotating QR token for teacher classroom…** (1 connections) — `backend/app/core/security.py`
- **Validates rotating projector session token. For live online submissions,…** (1 connections) — `backend/app/core/security.py`
- **Tokens with expired steps or malformed prefixes are strictly rejected.** (1 connections) — `backend/tests/test_phase9_security_and_integrity.py`
- **Verify that period_count=144 (or any out-of-bounds count) is strictly clamped…** (1 connections) — `backend/tests/test_projector_rotating_qr.py`
- **2. Server strictly accepts only current window (v) and previous window (v-1).** (1 connections) — `backend/tests/test_qr_expiry_and_claim_flow.py`
- **Validates Token Grace Window (Quick Win C.2): - Valid token scanned at slot_end…** (1 connections) — `backend/tests/test_scan_telemetry.py`
- **Generates an authoritative SNIST-SES token for a specific time step.** (1 connections) — `scripts/run_adversarial_threat_drills.py`

## Relationships

- [Community 1](Community_1.md) (16 shared connections)
- [Community 3](Community_3.md) (13 shared connections)
- [Community 77](Community_77.md) (9 shared connections)
- [Community 78](Community_78.md) (3 shared connections)
- [Community 8](Community_8.md) (3 shared connections)
- [Community 0](Community_0.md) (3 shared connections)
- [Community 4](Community_4.md) (2 shared connections)
- [Community 20](Community_20.md) (2 shared connections)
- [Community 38](Community_38.md) (1 shared connections)
- [Community 64](Community_64.md) (1 shared connections)
- [Community 13](Community_13.md) (1 shared connections)
- [Community 93](Community_93.md) (1 shared connections)

## Source Files

- `backend/app/core/security.py`
- `backend/tests/test_phase9_security_and_integrity.py`
- `backend/tests/test_projector_rotating_qr.py`
- `backend/tests/test_qr_expiry_and_claim_flow.py`
- `backend/tests/test_scan_telemetry.py`
- `scripts/run_adversarial_threat_drills.py`

## Audit Trail

- EXTRACTED: 83 (98%)
- INFERRED: 2 (2%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*