# Community 44

> 23 nodes · cohesion 0.09

## Key Concepts

- **security_alert_service.py** (33 connections) — `backend/app/services/security_alert_service.py`
- **SecurityAlertTracker** (7 connections) — `backend/app/services/security_alert_service.py`
- **.get_and_flush_suppressed_counts()** (2 connections) — `backend/app/services/security_alert_service.py`
- **.record_and_evaluate()** (2 connections) — `backend/app/services/security_alert_service.py`
- **.reset_state()** (2 connections) — `backend/app/services/security_alert_service.py`
- **SNIST ERP — Two-Layer Security Alerting & Detection Service Real-time…** (1 connections) — `backend/app/services/security_alert_service.py`
- **# WHY: Eliminates repetitive emails for ongoing attacks while recording volume…** (1 connections) — `backend/app/services/security_alert_service.py`
- **Retrieves suppressed event counts and flushes the tracker for the hourly digest.** (1 connections) — `backend/app/services/security_alert_service.py`
- **Resets all tracking maps (used primarily in automated unit tests).** (1 connections) — `backend/app/services/security_alert_service.py`
- **# WHY: Allows operator to instantly silence alerting via environment variable…** (1 connections) — `backend/app/services/security_alert_service.py`
- **# WHY: Ensures client request processing finishes with zero latency overhead.** (1 connections) — `backend/app/services/security_alert_service.py`
- **# WHY: Provides operator with instant triage clarity during live class…** (1 connections) — `backend/app/services/security_alert_service.py`
- **# WHY: Guarantees email rendering and SMTP network handshakes NEVER block the…** (1 connections) — `backend/app/services/security_alert_service.py`
- **# WHY: Leverages proven SMTP pipeline with zero duplicate network logic.** (1 connections) — `backend/app/services/security_alert_service.py`
- **# WHY: Guarantees alert audit record is committed independently of the…** (1 connections) — `backend/app/services/security_alert_service.py`
- **# WHY: A database query or template rendering exception must NEVER crash the…** (1 connections) — `backend/app/services/security_alert_service.py`
- **# WHY: Fulfills user constraint to restrict safety net emails strictly to…** (1 connections) — `backend/app/services/security_alert_service.py`
- **# WHY: Adheres strictly to the anti-alert-fatigue mandate.** (1 connections) — `backend/app/services/security_alert_service.py`
- **Thread-safe in-memory sliding window threshold tracker with cooldown…** (1 connections) — `backend/app/services/security_alert_service.py`
- **Records an event occurrence and evaluates threshold and cooldown status.…** (1 connections) — `backend/app/services/security_alert_service.py`
- **# WHY: Protects operator inbox from credential spraying brute-force storms.** (1 connections) — `backend/app/services/security_alert_service.py`
- **# WHY: Sliding window guarantees mathematically sound rate tracking without…** (1 connections) — `backend/app/services/security_alert_service.py`
- **.__init__()** (1 connections) — `backend/app/services/security_alert_service.py`

## Relationships

- [Community 1](Community_1.md) (5 shared connections)
- [Community 8](Community_8.md) (2 shared connections)
- [Community 15](Community_15.md) (2 shared connections)
- [Community 27](Community_27.md) (2 shared connections)
- [Community 5](Community_5.md) (2 shared connections)
- [Community 0](Community_0.md) (2 shared connections)
- [Community 2](Community_2.md) (1 shared connections)
- [Community 28](Community_28.md) (1 shared connections)
- [Community 10](Community_10.md) (1 shared connections)
- [Community 4](Community_4.md) (1 shared connections)
- [Community 13](Community_13.md) (1 shared connections)

## Source Files

- `backend/app/services/security_alert_service.py`

## Audit Trail

- EXTRACTED: 42 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*