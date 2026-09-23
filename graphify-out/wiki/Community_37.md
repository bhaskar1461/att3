# Community 37

> 27 nodes · cohesion 0.13

## Key Concepts

- **.get_student_course_attendance()** (19 connections) — `backend/app/services/attendance_engine.py`
- **.get_student_full_compliance()** (17 connections) — `backend/app/services/attendance_engine.py`
- **.generate_and_send_hod_weekly_digest()** (15 connections) — `backend/app/services/attendance_engine.py`
- **.issue_student_warning()** (14 connections) — `backend/app/services/attendance_engine.py`
- **.get_defaulters_roster()** (13 connections) — `backend/app/services/attendance_engine.py`
- **Any** (12 connections)
- **.get_department_compliance_summary()** (11 connections) — `backend/app/services/attendance_engine.py`
- **.get_faculty_course_compliance()** (8 connections) — `backend/app/services/attendance_engine.py`
- **Session** (7 connections)
- **get_cached()** (6 connections) — `backend/app/services/attendance_engine.py`
- **set_cached()** (6 connections) — `backend/app/services/attendance_engine.py`
- **.generate_defaulters_excel()** (4 connections) — `backend/app/services/attendance_engine.py`
- **.test_hod_digest_pii_sanitization()** (3 connections) — `backend/tests/test_compliance_hardening.py`
- **.test_hod_weekly_digest_idempotency_same_day()** (3 connections) — `backend/tests/test_compliance_hardening.py`
- **.test_hod_weekly_digest_idempotency()** (3 connections) — `backend/tests/test_defaulter_and_warnings.py`
- **.test_absent_never_nan_when_total_enrolled_unset()** (2 connections) — `backend/tests/test_attendance_card_reflection.py`
- **Warning issuance + evidence trail: Records: issuer, date, band at issue time…** (1 connections) — `backend/app/services/attendance_engine.py`
- **One-click Excel export in official SNIST register format.** (1 connections) — `backend/app/services/attendance_engine.py`
- **Weekly digest to HODs (Ops Guardrail): - Department defaulters summary, new…** (1 connections) — `backend/app/services/attendance_engine.py`
- **Calculates JNTUH R25 attendance percentage for one student in one course.…** (1 connections) — `backend/app/services/attendance_engine.py`
- **Returns full compliance profile for a student: Aggregate % + band + per-course…** (1 connections) — `backend/app/services/attendance_engine.py`
- **Generates Department-Level Compliance Analytics: Counts of Eligible,…** (1 connections) — `backend/app/services/attendance_engine.py`
- **Compliance breakdown for faculty course view: Student roster, sessions…** (1 connections) — `backend/app/services/attendance_engine.py`
- **Defaulter list generation (role-gated): - Faculty: own assigned courses only -…** (1 connections) — `backend/app/services/attendance_engine.py`
- **Verify that HOD digest emails contain roll + % only: Student phone numbers,…** (1 connections) — `backend/tests/test_compliance_hardening.py`
- *... and 2 more nodes in this community*

## Relationships

- [Community 6](Community_6.md) (23 shared connections)
- [Community 0](Community_0.md) (10 shared connections)
- [Community 3](Community_3.md) (5 shared connections)
- [Community 1](Community_1.md) (4 shared connections)
- [Community 19](Community_19.md) (4 shared connections)
- [Community 53](Community_53.md) (4 shared connections)
- [Community 24](Community_24.md) (3 shared connections)
- [Community 28](Community_28.md) (2 shared connections)
- [Community 72](Community_72.md) (2 shared connections)
- [Community 10](Community_10.md) (1 shared connections)
- [Community 73](Community_73.md) (1 shared connections)
- [Community 27](Community_27.md) (1 shared connections)

## Source Files

- `backend/app/services/attendance_engine.py`
- `backend/tests/test_attendance_card_reflection.py`
- `backend/tests/test_compliance_hardening.py`
- `backend/tests/test_defaulter_and_warnings.py`

## Audit Trail

- EXTRACTED: 107 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*