# Community 72

> 14 nodes · cohesion 0.14

## Key Concepts

- **.detect_rapid_decline()** (10 connections) — `backend/app/services/attendance_engine.py`
- **RapidDeclineResult** (9 connections) — `backend/app/services/attendance_engine.py`
- **.test_rapid_decline_triggers_when_dropping_consecutively()** (4 connections) — `backend/tests/test_defaulter_and_warnings.py`
- **.test_rapid_decline_synthetic_collapse_curve_vs_stable()** (3 connections) — `backend/tests/test_compliance_hardening.py`
- **.__bool__()** (1 connections) — `backend/app/services/attendance_engine.py`
- **.drop()** (1 connections) — `backend/app/services/attendance_engine.py`
- **.__eq__()** (1 connections) — `backend/app/services/attendance_engine.py`
- **.is_rapid()** (1 connections) — `backend/app/services/attendance_engine.py`
- **.__new__()** (1 connections) — `backend/app/services/attendance_engine.py`
- **Result of rapid decline analysis. Behaves as a 2-tuple (is_rapid, drop) when…** (1 connections) — `backend/app/services/attendance_engine.py`
- **Trend flag: RAPID_DECLINE if last 2 fortnights each dropped >= 5.0%. Student…** (1 connections) — `backend/app/services/attendance_engine.py`
- **RAPID_DECLINE: >=5% drop in each of last 2 periods: - Stable / perfect…** (1 connections) — `backend/tests/test_compliance_hardening.py`
- **Verify that a student dropping >= 5% in each of the last 2 fortnights triggers…** (1 connections) — `backend/tests/test_defaulter_and_warnings.py`
- **tuple** (1 connections)

## Relationships

- [Community 6](Community_6.md) (7 shared connections)
- [Community 37](Community_37.md) (2 shared connections)
- [Community 1](Community_1.md) (1 shared connections)

## Source Files

- `backend/app/services/attendance_engine.py`
- `backend/tests/test_compliance_hardening.py`
- `backend/tests/test_defaulter_and_warnings.py`

## Audit Trail

- EXTRACTED: 23 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*