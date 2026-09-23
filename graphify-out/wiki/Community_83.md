# Community 83

> 12 nodes · cohesion 0.18

## Key Concepts

- **store_attendance_selfie()** (10 connections) — `backend/app/services/selfie_service.py`
- **upload_attendance_selfie()** (8 connections) — `backend/app/api/attendance.py`
- **skip_attendance_selfie()** (8 connections) — `backend/app/services/selfie_service.py`
- **_get_image_metadata()** (3 connections) — `backend/app/services/selfie_service.py`
- **Request** (2 connections)
- **Any** (2 connections)
- **Session** (2 connections)
- **UploadFile** (1 connections)
- **Post-attendance selfie upload endpoint. Saves image into private object storage…** (1 connections) — `backend/app/api/attendance.py`
- **Records that a selfie was skipped or failed. CRITICAL RULE: Never invalidates…** (1 connections) — `backend/app/services/selfie_service.py`
- **Identifies image format and dimensions (width, height) from raw bytes. Uses PIL…** (1 connections) — `backend/app/services/selfie_service.py`
- **Validates, saves to private storage, and links selfie to attendance record.…** (1 connections) — `backend/app/services/selfie_service.py`

## Relationships

- [Community 32](Community_32.md) (7 shared connections)
- [Community 8](Community_8.md) (3 shared connections)
- [Community 19](Community_19.md) (2 shared connections)
- [Community 4](Community_4.md) (2 shared connections)
- [Community 0](Community_0.md) (1 shared connections)
- [Community 10](Community_10.md) (1 shared connections)

## Source Files

- `backend/app/api/attendance.py`
- `backend/app/services/selfie_service.py`

## Audit Trail

- EXTRACTED: 25 (89%)
- INFERRED: 3 (11%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*