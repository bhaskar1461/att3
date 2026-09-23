# Community 65

> 15 nodes · cohesion 0.23

## Key Concepts

- **backend/scripts/generate_ssl_certs.py** (10 connections) — `backend/scripts/generate_ssl_certs.py`
- **scripts/generate_ssl_certs.py** (10 connections) — `scripts/generate_ssl_certs.py`
- **main()** (4 connections) — `backend/scripts/generate_ssl_certs.py`
- **main()** (4 connections) — `scripts/generate_ssl_certs.py`
- **generate_cert_with_cryptography()** (3 connections) — `backend/scripts/generate_ssl_certs.py`
- **generate_cert_with_openssl()** (3 connections) — `backend/scripts/generate_ssl_certs.py`
- **get_local_ip()** (3 connections) — `backend/scripts/generate_ssl_certs.py`
- **generate_cert_with_cryptography()** (3 connections) — `scripts/generate_ssl_certs.py`
- **generate_cert_with_openssl()** (3 connections) — `scripts/generate_ssl_certs.py`
- **get_local_ip()** (3 connections) — `scripts/generate_ssl_certs.py`
- **socket** (3 connections)
- **pathlib** (2 connections)
- **Generate self-signed certificate using OpenSSL CLI fallback.** (2 connections) — `scripts/generate_ssl_certs.py`
- **Generate self-signed certificate using Python's cryptography library.** (2 connections) — `scripts/generate_ssl_certs.py`
- **Detect local LAN/Wi-Fi IP address.** (2 connections) — `scripts/generate_ssl_certs.py`

## Relationships

- [Community 2](Community_2.md) (5 shared connections)
- [Community 1](Community_1.md) (2 shared connections)
- [Community 15](Community_15.md) (2 shared connections)

## Source Files

- `backend/scripts/generate_ssl_certs.py`
- `scripts/generate_ssl_certs.py`

## Audit Trail

- EXTRACTED: 33 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*