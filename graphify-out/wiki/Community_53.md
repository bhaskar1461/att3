# Community 53

> 19 nodes · cohesion 0.11

## Key Concepts

- **calculate_trajectory_projection()** (15 connections) — `backend/app/services/attendance_engine.py`
- **determine_jntuh_band()** (12 connections) — `backend/app/services/attendance_engine.py`
- **calculate_projected_classes_needed()** (5 connections) — `backend/app/services/attendance_engine.py`
- **.test_band_boundaries()** (3 connections) — `backend/tests/test_attendance_engine.py`
- **.test_band_boundary_definitions_and_rounding_consistency()** (3 connections) — `backend/tests/test_compliance_hardening.py`
- **.test_trajectory_projection_hand_computed_cases()** (3 connections) — `backend/tests/test_compliance_hardening.py`
- **.test_projection_math_not_recoverable()** (3 connections) — `backend/tests/test_defaulter_and_warnings.py`
- **.test_projection_math_recoverable()** (3 connections) — `backend/tests/test_defaulter_and_warnings.py`
- **.test_projection_math_zero_remaining_sessions()** (3 connections) — `backend/tests/test_defaulter_and_warnings.py`
- **run_manual_reconciliation()** (3 connections) — `scripts/reconcile_hand_computed_register.py`
- **Evaluates JNTUH R25 compliance band: >= 75.0 -> ELIGIBLE 65.0 - 74.99 ->…** (1 connections) — `backend/app/services/attendance_engine.py`
- **Trajectory projection service (Week 3 Compliance Engine): - sessions_held =…** (1 connections) — `backend/app/services/attendance_engine.py`
- **Calculates classes needed to reach 75% threshold: Formula specified in task:…** (1 connections) — `backend/app/services/attendance_engine.py`
- **Verify exact JNTUH R25 band boundaries: - 64.99% -> DETAINED - 65.00% ->…** (1 connections) — `backend/tests/test_attendance_engine.py`
- **Verify exact band boundary thresholds: - 64.99% -> DETAINED - 65.00% ->…** (1 connections) — `backend/tests/test_compliance_hardening.py`
- **Verify classes_needed = ceil((0.75 * projected_total - present) / 0.25) against…** (1 connections) — `backend/tests/test_compliance_hardening.py`
- **Recoverable scenario: held = 12, present = 8, remaining = 20 Current % = 8/12 =…** (1 connections) — `backend/tests/test_defaulter_and_warnings.py`
- **Impossible / Not Recoverable scenario: held = 20, present = 5, remaining = 10…** (1 connections) — `backend/tests/test_defaulter_and_warnings.py`
- **Zero remaining sessions edge case: Case A: held = 30, present = 20, remaining =…** (1 connections) — `backend/tests/test_defaulter_and_warnings.py`

## Relationships

- [Community 6](Community_6.md) (11 shared connections)
- [Community 37](Community_37.md) (4 shared connections)
- [Community 1](Community_1.md) (2 shared connections)
- [Community 98](Community_98.md) (2 shared connections)
- [Community 24](Community_24.md) (2 shared connections)
- [Community 3](Community_3.md) (1 shared connections)
- [Community 0](Community_0.md) (1 shared connections)
- [Community 15](Community_15.md) (1 shared connections)

## Source Files

- `backend/app/services/attendance_engine.py`
- `backend/tests/test_attendance_engine.py`
- `backend/tests/test_compliance_hardening.py`
- `backend/tests/test_defaulter_and_warnings.py`
- `scripts/reconcile_hand_computed_register.py`

## Audit Trail

- EXTRACTED: 39 (91%)
- INFERRED: 4 (9%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*