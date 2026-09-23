# Community 78

> 13 nodes · cohesion 0.15

## Key Concepts

- **.validate_attendance_token()** (16 connections) — `backend/app/services/qr_token.py`
- **_url_safe_b64_decode()** (6 connections) — `backend/app/services/launch_token.py`
- **.parse_token_payload()** (6 connections) — `backend/app/services/qr_token.py`
- **.test_scan_path_microbenchmark()** (4 connections) — `backend/tests/test_short_token_security.py`
- **.test_short_token_format_variations()** (4 connections) — `backend/tests/test_short_token_security.py`
- **.test_fuzz_mutated_inputs_no_500s()** (3 connections) — `backend/tests/test_short_token_security.py`
- **Any** (2 connections)
- **Decodes URL-safe base64 with auto-padding restoration.** (1 connections) — `backend/app/services/launch_token.py`
- **Discovers payload format: Returns (code_or_token, v, format_type) format_type…** (1 connections) — `backend/app/services/qr_token.py`
- **Dual-format validation wrapper: Accepts BOTH legacy full-token and new…** (1 connections) — `backend/app/services/qr_token.py`
- **Verifies delimited and separate parameter variations of short token.** (1 connections) — `backend/tests/test_short_token_security.py`
- **Fuzzes token parser with 200 corrupted inputs, verifying zero 500 server…** (1 connections) — `backend/tests/test_short_token_security.py`
- **Measures ShortTokenService lookup overhead on memory cache hits.** (1 connections) — `backend/tests/test_short_token_security.py`

## Relationships

- [Community 20](Community_20.md) (9 shared connections)
- [Community 64](Community_64.md) (3 shared connections)
- [Community 8](Community_8.md) (3 shared connections)
- [Community 52](Community_52.md) (3 shared connections)
- [Community 13](Community_13.md) (2 shared connections)
- [Community 4](Community_4.md) (2 shared connections)
- [Community 99](Community_99.md) (1 shared connections)

## Source Files

- `backend/app/services/launch_token.py`
- `backend/app/services/qr_token.py`
- `backend/tests/test_short_token_security.py`

## Audit Trail

- EXTRACTED: 35 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*