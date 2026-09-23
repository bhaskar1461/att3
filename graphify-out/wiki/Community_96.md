# Community 96

> 9 nodes · cohesion 0.25

## Key Concepts

- **comprehensive_health_check()** (7 connections) — `backend/app/main.py`
- **check_db_health()** (5 connections) — `backend/app/core/database.py`
- **readiness_probe()** (4 connections) — `backend/app/main.py`
- **api_route** (3 connections)
- **liveness_probe()** (3 connections) — `backend/app/main.py`
- **Executes a fast active probe against the database (SELECT 1) and returns…** (1 connections) — `backend/app/core/database.py`
- **Fast liveness probe: verifies the FastAPI application process is up and…** (1 connections) — `backend/app/main.py`
- **Readiness probe: verifies remote database connectivity and response latency.…** (1 connections) — `backend/app/main.py`
- **Live Production Health Check Probe (backward-compatible). Checks remote MySQL…** (1 connections) — `backend/app/main.py`

## Relationships

- [Community 1](Community_1.md) (5 shared connections)
- [Community 28](Community_28.md) (1 shared connections)
- [Community 3](Community_3.md) (1 shared connections)
- [Community 4](Community_4.md) (1 shared connections)

## Source Files

- `backend/app/core/database.py`
- `backend/app/main.py`

## Audit Trail

- EXTRACTED: 15 (88%)
- INFERRED: 2 (12%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*