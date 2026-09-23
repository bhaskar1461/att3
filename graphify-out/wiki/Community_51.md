# Community 51

> 20 nodes · cohesion 0.10

## Key Concepts

- **TestPreviousClassAttendanceSecurity** (24 connections) — `backend/tests/test_previous_class_attendance_security.py`
- **.test_4_cross_teacher_session_access_rejected()** (3 connections) — `backend/tests/test_previous_class_attendance_security.py`
- **.test_5_cross_section_student_marking_rejected()** (3 connections) — `backend/tests/test_previous_class_attendance_security.py`
- **.test_7_locked_historical_session_cannot_be_edited()** (3 connections) — `backend/tests/test_previous_class_attendance_security.py`
- **.test_8_unlock_allows_editing_and_logs_audit()** (3 connections) — `backend/tests/test_previous_class_attendance_security.py`
- **.test_9_lock_session_commits_and_logs()** (3 connections) — `backend/tests/test_previous_class_attendance_security.py`
- **.test_1_start_historical_session_success()** (2 connections) — `backend/tests/test_previous_class_attendance_security.py`
- **.test_2_duplicate_start_returns_existing_session()** (2 connections) — `backend/tests/test_previous_class_attendance_security.py`
- **.test_3_future_date_session_creation_rejected()** (2 connections) — `backend/tests/test_previous_class_attendance_security.py`
- **.test_6_unassigned_subject_start_rejected()** (2 connections) — `backend/tests/test_previous_class_attendance_security.py`
- **1. Teacher can start an authorized historical session for yesterday and it logs…** (1 connections) — `backend/tests/test_previous_class_attendance_security.py`
- **2. Calling start session twice for same class returns the existing session…** (1 connections) — `backend/tests/test_previous_class_attendance_security.py`
- **3. Attempting to create a session for tomorrow is strictly rejected (Rule 24)** (1 connections) — `backend/tests/test_previous_class_attendance_security.py`
- **4. Teacher 2 cannot view or mark attendance for Teacher 1's historical session…** (1 connections) — `backend/tests/test_previous_class_attendance_security.py`
- **5. Teacher cannot mark attendance for a student from Section B in a Section A…** (1 connections) — `backend/tests/test_previous_class_attendance_security.py`
- **6. Teacher cannot start attendance for unassigned subject (Rule 27)** (1 connections) — `backend/tests/test_previous_class_attendance_security.py`
- **7. Locked historical session rejects manual attendance marking (Rule 28)** (1 connections) — `backend/tests/test_previous_class_attendance_security.py`
- **8. Unlocking locked historical session permits editing and records audit log** (1 connections) — `backend/tests/test_previous_class_attendance_security.py`
- **9. Locking session transitions status to LOCKED and creates audit log** (1 connections) — `backend/tests/test_previous_class_attendance_security.py`
- **.tearDown()** (1 connections) — `backend/tests/test_previous_class_attendance_security.py`

## Relationships

- [Community 0](Community_0.md) (10 shared connections)
- [Community 3](Community_3.md) (6 shared connections)
- [Community 10](Community_10.md) (1 shared connections)
- [Community 4](Community_4.md) (1 shared connections)
- [Community 6](Community_6.md) (1 shared connections)

## Source Files

- `backend/tests/test_previous_class_attendance_security.py`

## Audit Trail

- EXTRACTED: 26 (68%)
- INFERRED: 12 (32%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*