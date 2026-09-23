# Community 33

> 34 nodes · cohesion 0.11

## Key Concepts

- **admin_credentials.py** (52 connections) — `backend/app/api/admin_credentials.py`
- **dispatch_credentials()** (20 connections) — `backend/app/api/admin_credentials.py`
- **quick_reset_student_credentials()** (16 connections) — `backend/app/api/admin_credentials.py`
- **retry_credential()** (15 connections) — `backend/app/api/admin_credentials.py`
- **CredentialItem** (12 connections) — `backend/app/models/models.py`
- **test_credential_email()** (10 connections) — `backend/app/api/admin_credentials.py`
- **CredentialBatch** (10 connections) — `backend/app/models/models.py`
- **get_batch_status()** (8 connections) — `backend/app/api/admin_credentials.py`
- **CredentialEmailStatus** (8 connections) — `backend/app/models/models.py`
- **Session** (7 connections)
- **lookup_student_for_recovery()** (6 connections) — `backend/app/api/admin_credentials.py`
- **preview_credential_template()** (6 connections) — `backend/app/api/admin_credentials.py`
- **_generate_temp_password()** (5 connections) — `backend/app/api/admin_credentials.py`
- **post** (5 connections)
- **_update_batch_item_status()** (5 connections) — `backend/app/services/email_service.py`
- **BaseModel** (4 connections)
- **DispatchCredentialsRequest** (3 connections) — `backend/app/api/admin_credentials.py`
- **QuickResetCredentialsRequest** (3 connections) — `backend/app/api/admin_credentials.py`
- **require_admin()** (3 connections) — `backend/app/api/admin_credentials.py`
- **RetryCredentialRequest** (3 connections) — `backend/app/api/admin_credentials.py`
- **TestSendRequest** (3 connections) — `backend/app/api/admin_credentials.py`
- **get** (2 connections)
- **SNIST ERP — Credential Email Dispatch Router (Module 2) Generate temp…** (1 connections) — `backend/app/api/admin_credentials.py`
- **Polls batch dispatch status — call every 2-3 seconds from frontend.** (1 connections) — `backend/app/api/admin_credentials.py`
- **Regenerates temp password and re-queues email for a single recipient.** (1 connections) — `backend/app/api/admin_credentials.py`
- *... and 9 more nodes in this community*

## Relationships

- [Community 0](Community_0.md) (19 shared connections)
- [Community 27](Community_27.md) (15 shared connections)
- [Community 28](Community_28.md) (10 shared connections)
- [Community 16](Community_16.md) (9 shared connections)
- [Community 10](Community_10.md) (7 shared connections)
- [Community 1](Community_1.md) (5 shared connections)
- [Community 8](Community_8.md) (4 shared connections)
- [Community 6](Community_6.md) (4 shared connections)
- [Community 5](Community_5.md) (4 shared connections)
- [Community 2](Community_2.md) (4 shared connections)
- [Community 17](Community_17.md) (3 shared connections)
- [Community 19](Community_19.md) (2 shared connections)

## Source Files

- `backend/app/api/admin_credentials.py`
- `backend/app/models/models.py`
- `backend/app/services/email_service.py`

## Audit Trail

- EXTRACTED: 120 (78%)
- INFERRED: 34 (22%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*