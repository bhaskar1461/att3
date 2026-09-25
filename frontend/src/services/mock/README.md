# Mock Adapter Registry & TODO-REAL Ledger

This directory contains temporary mock data generators and route handlers for dashboard aggregate rollups that do not yet exist in the FastAPI backend monolith.

## TODO-REAL Ledger

| Mock Route | Target FastAPI Endpoint | HTTP Method | Proposed FastAPI Handler Location | Status |
| :--- | :--- | :--- | :--- | :--- |
| `GET /api/v1/admin/overview/rollup` | `/api/v1/admin/overview/rollup` | `GET` | `backend/app/api/admin.py` | TODO-REAL |
| `GET /api/v1/admin/overview/heatmap` | `/api/v1/admin/overview/heatmap` | `GET` | `backend/app/api/admin.py` | TODO-REAL |
| `GET /api/v1/admin/overview/sources` | `/api/v1/admin/overview/sources` | `GET` | `backend/app/api/admin.py` | TODO-REAL |
| `GET /api/v1/admin/overview/trends` | `/api/v1/admin/overview/trends` | `GET` | `backend/app/api/admin.py` | TODO-REAL |

## Rules & Constraints
1. **Mock Boundary**: Mocks live ONLY in `src/services/mock/**`. Any mock outside this directory violates architectural rules.
2. **Deterministic PRNG**: All generators use a fixed-seed Mulberry32 PRNG to guarantee reproducible rendering across frames.
3. **Zod Validation Enforcement**: All mock payloads run through `schema.parse()` in `api/client.ts` before reaching any feature or hook, preventing schema drift.
4. **Dev-Only Interceptor**: Interception is active only when `import.meta.env.DEV` is true. In production builds, the interceptor is stripped.
