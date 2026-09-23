# Community 27

> 40 nodes · cohesion 0.06

## Key Concepts

- **send_single_email()** (35 connections) — `backend/app/services/email_service.py`
- **render_email_template()** (33 connections) — `backend/app/services/email_service.py`
- **email_service.py** (30 connections) — `backend/app/services/email_service.py`
- **main()** (11 connections) — `scripts/dispatch_student_credentials.py`
- **.generate_and_send_hourly_digest()** (10 connections) — `backend/app/services/security_alert_service.py`
- **._dispatch_alert_email()** (7 connections) — `backend/app/services/security_alert_service.py`
- **.generate_and_send_hod_daily_digest()** (7 connections) — `backend/app/services/security_alert_service.py`
- **dispatch_email_batch_background()** (6 connections) — `backend/app/services/email_service.py`
- **_hourly_security_digest_scheduler()** (5 connections) — `backend/app/main.py`
- **_verify_email_templates_on_startup()** (5 connections) — `backend/app/main.py`
- **_worker()** (5 connections) — `backend/app/services/email_service.py`
- **lifespan()** (4 connections) — `backend/app/main.py`
- **_mark_batch_completed()** (4 connections) — `backend/app/services/email_service.py`
- **Any** (4 connections)
- **.test_dual_channel_smtp_routing_and_failover()** (4 connections) — `backend/tests/test_onboarding_and_credentials.py`
- **_get_jinja_env()** (3 connections) — `backend/app/services/email_service.py`
- **Any** (3 connections)
- **._process_event_async()** (3 connections) — `backend/app/services/security_alert_service.py`
- **main()** (3 connections) — `backend/scripts/send_varshith_magic_link.py`
- **.test_email_template_rendering()** (3 connections) — `backend/tests/test_onboarding_and_credentials.py`
- **generate_student_password()** (3 connections) — `scripts/dispatch_student_credentials.py`
- **Background safety-net loop for Layer 2 security digest. Evaluates every 60…** (1 connections) — `backend/app/main.py`
- **Startup guard: asserts all referenced email templates exist and dry-render with…** (1 connections) — `backend/app/main.py`
- **SNIST ERP — Email Service with Async Batch Dispatch Defensive SMTP with per-…** (1 connections) — `backend/app/services/email_service.py`
- **Spawns a background thread to dispatch a batch of emails with throttling. Each…** (1 connections) — `backend/app/services/email_service.py`
- *... and 15 more nodes in this community*

## Relationships

- [Community 16](Community_16.md) (19 shared connections)
- [Community 33](Community_33.md) (15 shared connections)
- [Community 28](Community_28.md) (13 shared connections)
- [Community 5](Community_5.md) (10 shared connections)
- [Community 1](Community_1.md) (9 shared connections)
- [Community 0](Community_0.md) (9 shared connections)
- [Community 10](Community_10.md) (7 shared connections)
- [Community 2](Community_2.md) (6 shared connections)
- [Community 24](Community_24.md) (4 shared connections)
- [Community 8](Community_8.md) (2 shared connections)
- [Community 25](Community_25.md) (2 shared connections)
- [Community 44](Community_44.md) (2 shared connections)

## Source Files

- `backend/app/main.py`
- `backend/app/services/email_service.py`
- `backend/app/services/security_alert_service.py`
- `backend/scripts/send_varshith_magic_link.py`
- `backend/tests/test_onboarding_and_credentials.py`
- `scripts/dispatch_student_credentials.py`

## Audit Trail

- EXTRACTED: 143 (91%)
- INFERRED: 14 (9%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*