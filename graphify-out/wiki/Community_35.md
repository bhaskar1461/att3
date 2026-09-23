# Community 35

> 30 nodes · cohesion 0.07

## Key Concepts

- **TestLiveAttendanceWorkflow** (31 connections) — `backend/tests/test_live_attendance_workflow.py`
- **.test_6_current_class_resumes_active_open_session()** (4 connections) — `backend/tests/test_live_attendance_workflow.py`
- **.test_10_session_locking_workflow_and_token_purging()** (3 connections) — `backend/tests/test_live_attendance_workflow.py`
- **.test_11_student_scan_records_attendance_and_increments_live_headcount()** (3 connections) — `backend/tests/test_live_attendance_workflow.py`
- **.test_12_student_scan_rejected_when_session_locked()** (3 connections) — `backend/tests/test_live_attendance_workflow.py`
- **.test_7_projector_broadcast_token_open_session()** (3 connections) — `backend/tests/test_live_attendance_workflow.py`
- **.test_8_projector_broadcast_token_rejected_when_session_locked()** (3 connections) — `backend/tests/test_live_attendance_workflow.py`
- **.test_9_session_lock_authorization_defense()** (3 connections) — `backend/tests/test_live_attendance_workflow.py`
- **.test_13_period_transition_simulation()** (2 connections) — `backend/tests/test_live_attendance_workflow.py`
- **.test_14_concurrent_tab_session_convergence()** (2 connections) — `backend/tests/test_live_attendance_workflow.py`
- **.test_1_current_class_detection_during_period()** (2 connections) — `backend/tests/test_live_attendance_workflow.py`
- **.test_2_current_class_detection_during_morning_break()** (2 connections) — `backend/tests/test_live_attendance_workflow.py`
- **.test_3_current_class_detection_during_lunch_break()** (2 connections) — `backend/tests/test_live_attendance_workflow.py`
- **.test_4_current_class_detection_outside_hours()** (2 connections) — `backend/tests/test_live_attendance_workflow.py`
- **.test_5_session_start_idempotency_and_rapid_double_clicks()** (2 connections) — `backend/tests/test_live_attendance_workflow.py`
- **Test server-authoritative class detection when current IST time is inside…** (1 connections) — `backend/tests/test_live_attendance_workflow.py`
- **Test server-authoritative detection during morning break (11:15), ensuring no…** (1 connections) — `backend/tests/test_live_attendance_workflow.py`
- **Test server-authoritative detection during lunch break (13:20), ensuring no…** (1 connections) — `backend/tests/test_live_attendance_workflow.py`
- **Test server-authoritative detection outside college hours (08:00 and 18:00).** (1 connections) — `backend/tests/test_live_attendance_workflow.py`
- **Section 7: Verify rapid double clicks / parallel starts return the same logical…** (1 connections) — `backend/tests/test_live_attendance_workflow.py`
- **Section 6 & 12: When an OPEN session exists, /teacher/current-class immediately…** (1 connections) — `backend/tests/test_live_attendance_workflow.py`
- **Section 8 & 9: Projector broadcast token generates rotating token and live…** (1 connections) — `backend/tests/test_live_attendance_workflow.py`
- **Section 31 & 45: Live projector broadcast is strictly rejected when session is…** (1 connections) — `backend/tests/test_live_attendance_workflow.py`
- **Section 17 & 46: Teacher B cannot lock Teacher A's session.** (1 connections) — `backend/tests/test_live_attendance_workflow.py`
- **Section 16, 18 & 53: Locking session commits DB status and records audit event.** (1 connections) — `backend/tests/test_live_attendance_workflow.py`
- *... and 5 more nodes in this community*

## Relationships

- [Community 0](Community_0.md) (10 shared connections)
- [Community 3](Community_3.md) (8 shared connections)
- [Community 4](Community_4.md) (3 shared connections)
- [Community 6](Community_6.md) (2 shared connections)
- [Community 10](Community_10.md) (1 shared connections)

## Source Files

- `backend/tests/test_live_attendance_workflow.py`

## Audit Trail

- EXTRACTED: 39 (74%)
- INFERRED: 14 (26%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*