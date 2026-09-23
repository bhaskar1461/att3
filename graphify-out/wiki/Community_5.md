# Community 5

> 66 nodes · cohesion 0.07

## Key Concepts

- **devices.py** (56 connections) — `backend/app/api/devices.py`
- **DeviceAccountBinding** (37 connections) — `backend/app/models/models.py`
- **register_or_get_device()** (35 connections) — `backend/app/core/device_security.py`
- **DeviceRegistration** (32 connections) — `backend/app/models/models.py`
- **enforce_device_binding()** (29 connections) — `backend/app/core/device_security.py`
- **BindingStatus** (29 connections) — `backend/app/models/models.py`
- **device_security.py** (27 connections) — `backend/app/core/device_security.py`
- **SecurityAlertService** (22 connections) — `backend/app/services/security_alert_service.py`
- **test_demo_account_device_bypass.py** (21 connections) — `backend/tests/test_demo_account_device_bypass.py`
- **verify_device_reset()** (19 connections) — `backend/app/api/devices.py`
- **record_audit_log()** (19 connections) — `backend/app/core/device_security.py`
- **request_device_reset()** (18 connections) — `backend/app/api/devices.py`
- **is_demo_account()** (12 connections) — `backend/app/core/device_security.py`
- **revoke_device_by_admin()** (12 connections) — `backend/app/core/device_security.py`
- **DeviceResetOTP** (12 connections) — `backend/app/models/models.py`
- **reset_student_device_enrollment()** (11 connections) — `backend/app/core/device_security.py`
- **bulk_reset_devices()** (10 connections) — `backend/app/api/devices.py`
- **get_student_device_info()** (10 connections) — `backend/app/api/devices.py`
- **run_bypass_suite()** (10 connections) — `scripts/probe_device_binding_bypasses.py`
- **reset_student_enrollment_endpoint()** (9 connections) — `backend/app/api/devices.py`
- **get_current_device_binding()** (8 connections) — `backend/app/api/devices.py`
- **Session** (8 connections)
- **revoke_device_endpoint()** (8 connections) — `backend/app/api/devices.py`
- **Session** (8 connections)
- **validate_active_binding_for_student()** (8 connections) — `backend/app/core/device_security.py`
- *... and 41 more nodes in this community*

## Relationships

- [Community 1](Community_1.md) (47 shared connections)
- [Community 0](Community_0.md) (39 shared connections)
- [Community 17](Community_17.md) (28 shared connections)
- [Community 10](Community_10.md) (19 shared connections)
- [Community 19](Community_19.md) (18 shared connections)
- [Community 16](Community_16.md) (12 shared connections)
- [Community 13](Community_13.md) (11 shared connections)
- [Community 63](Community_63.md) (11 shared connections)
- [Community 27](Community_27.md) (10 shared connections)
- [Community 2](Community_2.md) (10 shared connections)
- [Community 4](Community_4.md) (10 shared connections)
- [Community 6](Community_6.md) (8 shared connections)

## Source Files

- `backend/app/api/devices.py`
- `backend/app/api/student.py`
- `backend/app/core/device_security.py`
- `backend/app/models/models.py`
- `backend/app/services/security_alert_service.py`
- `backend/tests/test_demo_account_device_bypass.py`
- `backend/tests/test_device_binding.py`
- `backend/tests/test_phase9_security_and_integrity.py`
- `scripts/probe_device_binding_bypasses.py`

## Audit Trail

- EXTRACTED: 319 (76%)
- INFERRED: 101 (24%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*