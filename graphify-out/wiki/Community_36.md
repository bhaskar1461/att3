# Community 36

> 29 nodes · cohesion 0.08

## Key Concepts

- **TestSecurityAlertSystem** (19 connections) — `backend/tests/test_security_alerts.py`
- **patch** (5 connections)
- **.test_hourly_digest_with_events_sends_one_digest()** (5 connections) — `backend/tests/test_security_alerts.py`
- **.test_admin_test_send_endpoint()** (4 connections) — `backend/tests/test_security_alerts.py`
- **.test_hourly_digest_empty_hour_sends_no_email()** (4 connections) — `backend/tests/test_security_alerts.py`
- **.test_non_blocking_hook_audit_event()** (4 connections) — `backend/tests/test_security_alerts.py`
- **.test_simulation_5_consecutive_account_switch_attempts()** (4 connections) — `backend/tests/test_security_alerts.py`
- **.test_admin_test_send_endpoint_forbidden_for_student()** (3 connections) — `backend/tests/test_security_alerts.py`
- **.test_account_switch_threshold_trigger()** (2 connections) — `backend/tests/test_security_alerts.py`
- **.test_digest_only_event()** (2 connections) — `backend/tests/test_security_alerts.py`
- **.test_failed_hmac_threshold()** (2 connections) — `backend/tests/test_security_alerts.py`
- **.test_immediate_alert_events()** (2 connections) — `backend/tests/test_security_alerts.py`
- **.test_premature_login_returns_403()** (2 connections) — `backend/tests/test_security_alerts.py`
- **.test_unactivated_login_threshold()** (2 connections) — `backend/tests/test_security_alerts.py`
- **Verify critical events like PRIVESC_ATTEMPT trigger immediate alert on 1st…** (1 connections) — `backend/tests/test_security_alerts.py`
- **Verify FAILED_HMAC requires >10 attempts before alerting.** (1 connections) — `backend/tests/test_security_alerts.py`
- **Verify RATE_LIMIT_TRIGGERED is recorded for hourly digest without sending real-…** (1 connections) — `backend/tests/test_security_alerts.py`
- **Verify hook_audit_event executes safely and dispatches in worker pool without…** (1 connections) — `backend/tests/test_security_alerts.py`
- **End-to-End Simulation: 5 consecutive account switch attempts from same device:…** (1 connections) — `backend/tests/test_security_alerts.py`
- **Hourly Digest Safety Net: When zero security events occurred in the past hour:…** (1 connections) — `backend/tests/test_security_alerts.py`
- **Hourly Digest Safety Net: When events exist in the past hour: - Assert function…** (1 connections) — `backend/tests/test_security_alerts.py`
- **Operator Verification Endpoint: POST /api/v1/admin/security-alerts/test-send -…** (1 connections) — `backend/tests/test_security_alerts.py`
- **Operator Verification Endpoint: Student user attempting to call…** (1 connections) — `backend/tests/test_security_alerts.py`
- **Verify EVENT_UNACTIVATED_LOGIN triggers alert immediately on 1st attempt, then…** (1 connections) — `backend/tests/test_security_alerts.py`
- **Verify /api/v1/auth/login returns HTTP 403 with specific onboarding guidance…** (1 connections) — `backend/tests/test_security_alerts.py`
- *... and 4 more nodes in this community*

## Relationships

- [Community 5](Community_5.md) (3 shared connections)
- [Community 10](Community_10.md) (2 shared connections)
- [Community 0](Community_0.md) (2 shared connections)
- [Community 27](Community_27.md) (2 shared connections)
- [Community 1](Community_1.md) (1 shared connections)
- [Community 6](Community_6.md) (1 shared connections)

## Source Files

- `backend/tests/test_security_alerts.py`

## Audit Trail

- EXTRACTED: 38 (88%)
- INFERRED: 5 (12%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*