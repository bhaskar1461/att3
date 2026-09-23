# Community 79

> 13 nodes · cohesion 0.15

## Key Concepts

- **TestBindingSchemaRace** (11 connections) — `backend/tests/test_binding_schema_race.py`
- **.test_multiple_revoked_rows_retention()** (3 connections) — `backend/tests/test_binding_schema_race.py`
- **.test_parallel_concurrent_enrollment_race()** (3 connections) — `backend/tests/test_binding_schema_race.py`
- **.test_revocation_allows_new_active_binding()** (3 connections) — `backend/tests/test_binding_schema_race.py`
- **.test_shared_phone_multi_student_coexistence()** (3 connections) — `backend/tests/test_binding_schema_race.py`
- **.test_single_active_binding_enforced_by_database()** (3 connections) — `backend/tests/test_binding_schema_race.py`
- **attempt_enrollment()** (2 connections) — `backend/tests/test_binding_schema_race.py`
- **Verify that once an active binding is revoked (revoked_at IS NOT NULL), a new…** (1 connections) — `backend/tests/test_binding_schema_race.py`
- **Verify audit retention: a student can accumulate multiple revoked rows over…** (1 connections) — `backend/tests/test_binding_schema_race.py`
- **PRIME DIRECTIVE TEST: Spawn 10 concurrent threads attempting to enroll active…** (1 connections) — `backend/tests/test_binding_schema_race.py`
- **EDGE CASE: Shared phone (User Case B5). Two different students enroll on the…** (1 connections) — `backend/tests/test_binding_schema_race.py`
- **Verify that attempting to insert two active (revoked_at IS NULL) bindings for…** (1 connections) — `backend/tests/test_binding_schema_race.py`
- **.tearDown()** (1 connections) — `backend/tests/test_binding_schema_race.py`

## Relationships

- [Community 10](Community_10.md) (6 shared connections)
- [Community 0](Community_0.md) (3 shared connections)
- [Community 15](Community_15.md) (1 shared connections)

## Source Files

- `backend/tests/test_binding_schema_race.py`

## Audit Trail

- EXTRACTED: 18 (82%)
- INFERRED: 4 (18%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*