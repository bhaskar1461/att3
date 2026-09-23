# Community 47

> 22 nodes · cohesion 0.11

## Key Concepts

- **._create_session()** (9 connections) — `backend/tests/test_load_concurrency_150.py`
- **._mark_attendance_direct()** (6 connections) — `backend/tests/test_load_concurrency_150.py`
- **percentile()** (5 connections) — `backend/tests/test_load_concurrency_150.py`
- **StudentData** (5 connections) — `backend/tests/test_load_concurrency_150.py`
- **.test_A_150_concurrent_burst()** (4 connections) — `backend/tests/test_load_concurrency_150.py`
- **.test_B_150_staggered_arrival()** (4 connections) — `backend/tests/test_load_concurrency_150.py`
- **.test_C_rescan_idempotency()** (4 connections) — `backend/tests/test_load_concurrency_150.py`
- **.test_D_stats_accuracy_150()** (4 connections) — `backend/tests/test_load_concurrency_150.py`
- **.test_E_300_student_safety_margin()** (4 connections) — `backend/tests/test_load_concurrency_150.py`
- **.test_F_same_student_race_condition()** (4 connections) — `backend/tests/test_load_concurrency_150.py`
- **.test_G_mixed_burst_150_plus_30_rescans()** (4 connections) — `backend/tests/test_load_concurrency_150.py`
- **race()** (2 connections) — `backend/tests/test_load_concurrency_150.py`
- **Simulate the production concurrency path: check existing → insert → commit,…** (1 connections) — `backend/tests/test_load_concurrency_150.py`
- **150 distinct students fire mark-attendance simultaneously.** (1 connections) — `backend/tests/test_load_concurrency_150.py`
- **150 students arrive in 10 batches of 15.** (1 connections) — `backend/tests/test_load_concurrency_150.py`
- **30 students rescan after initial mark — must get ALREADY_MARKED, no duplicates.** (1 connections) — `backend/tests/test_load_concurrency_150.py`
- **Summary and compliance endpoints report exact counts, no NaN.** (1 connections) — `backend/tests/test_load_concurrency_150.py`
- **300-student burst (2x). Report latency percentiles.** (1 connections) — `backend/tests/test_load_concurrency_150.py`
- **Two threads for the SAME student. One SUCCESS, one ALREADY_MARKED. Never…** (1 connections) — `backend/tests/test_load_concurrency_150.py`
- **150 unique + 30 rescans. Exactly 150 DB rows.** (1 connections) — `backend/tests/test_load_concurrency_150.py`
- **Thread-safe plain data — no ORM session binding.** (1 connections) — `backend/tests/test_load_concurrency_150.py`
- **.__init__()** (1 connections) — `backend/tests/test_load_concurrency_150.py`

## Relationships

- [Community 0](Community_0.md) (10 shared connections)
- [Community 15](Community_15.md) (2 shared connections)
- [Community 3](Community_3.md) (1 shared connections)
- [Community 4](Community_4.md) (1 shared connections)
- [Community 73](Community_73.md) (1 shared connections)

## Source Files

- `backend/tests/test_load_concurrency_150.py`

## Audit Trail

- EXTRACTED: 39 (98%)
- INFERRED: 1 (2%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*