# Community 55

> 19 nodes · cohesion 0.11

## Key Concepts

- **._create_session_t1()** (11 connections) — `backend/tests/test_phase9_security_and_integrity.py`
- **.test_10_cross_session_qr()** (4 connections) — `backend/tests/test_phase9_security_and_integrity.py`
- **.test_01_unauthorized_teacher_session_access()** (3 connections) — `backend/tests/test_phase9_security_and_integrity.py`
- **.test_02_unauthorized_teacher_attendance_submission()** (3 connections) — `backend/tests/test_phase9_security_and_integrity.py`
- **.test_03_cross_section_student_submission()** (3 connections) — `backend/tests/test_phase9_security_and_integrity.py`
- **.test_04_locked_session_modification_blocked()** (3 connections) — `backend/tests/test_phase9_security_and_integrity.py`
- **.test_06_duplicate_attendance_submission_integrity()** (3 connections) — `backend/tests/test_phase9_security_and_integrity.py`
- **.test_07_invalid_attendance_status_rejection()** (3 connections) — `backend/tests/test_phase9_security_and_integrity.py`
- **.test_09_tampered_qr_rejection()** (3 connections) — `backend/tests/test_phase9_security_and_integrity.py`
- **.test_15_session_id_manipulation_idor()** (3 connections) — `backend/tests/test_phase9_security_and_integrity.py`
- **Teacher B cannot access Teacher A's session details or reports.** (1 connections) — `backend/tests/test_phase9_security_and_integrity.py`
- **Teacher B cannot submit manual attendance or batch-mark Teacher A's session.** (1 connections) — `backend/tests/test_phase9_security_and_integrity.py`
- **Student from Section B cannot be marked in Section A session (manual or student…** (1 connections) — `backend/tests/test_phase9_security_and_integrity.py`
- **Locked sessions reject manual marks, batch marks, token broadcasts, and student…** (1 connections) — `backend/tests/test_phase9_security_and_integrity.py`
- **Scanning twice returns ALREADY_MARKED and maintains exactly 1 database record.** (1 connections) — `backend/tests/test_phase9_security_and_integrity.py`
- **Manual mark endpoint strictly validates reason enum.** (1 connections) — `backend/tests/test_phase9_security_and_integrity.py`
- **Tampering with token payload HMAC signature or short code is detected and…** (1 connections) — `backend/tests/test_phase9_security_and_integrity.py`
- **Token generated for Session A does not mark attendance for Session B.** (1 connections) — `backend/tests/test_phase9_security_and_integrity.py`
- **Tampering with numeric session_id to access another teacher's session is…** (1 connections) — `backend/tests/test_phase9_security_and_integrity.py`

## Relationships

- [Community 93](Community_93.md) (10 shared connections)
- [Community 3](Community_3.md) (2 shared connections)

## Source Files

- `backend/tests/test_phase9_security_and_integrity.py`

## Audit Trail

- EXTRACTED: 30 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*