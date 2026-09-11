# Daily Interim Pilot Log — Week 4 Production Pilot

**System**: SNIST ERP Attendance Engine (FastAPI + React 18 PWA)
**Generated**: 2026-09-11 10:01:40 UTC
**Scope**: Interleaved Pilot Sessions (`short`, {short_code, v}) vs Matched Control Sessions (`legacy`, SNIST-SES|...)

---

## 1. Daily Session Audit Log Table

| Date | Session ID | Cohort / Section | Display Type | Format Tag | Total $N$ | Old $n$ | Old Success % | Overall p50 TTM | Overall p95 TTM | Top Error Mode |
|:---:|:---|:---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---|
| 2026-09-08 | `SESS-W4-P01` | CSE-CSE-A | `projector` | **`short`** | 62 | 22 | **95.5%** | 1.20s | 3.66s | `camera_initialization_failed` |
| 2026-09-09 | `SESS-W4-P02` | CSE-CSE-B | `phone_screen` | **`short`** | 54 | 18 | **94.4%** | 1.18s | 3.22s | `camera_initialization_failed` |
| 2026-09-10 | `SESS-W4-P03` | ECE-ECE-A | `projector` | **`short`** | 58 | 19 | **100.0%** | 1.13s | 3.60s | `None (0 errors)` |
| 2026-09-11 | `SESS-W4-P04` | CSE-CSE-A | `projector` | **`short`** | 56 | 19 | **89.5%** | 1.21s | 3.87s | `camera_initialization_failed` |
| 2026-09-08 | `SESS-W4-C01` | CE-CE-A | `projector` | **`legacy`** | 60 | 21 | **90.5%** | 1.98s | 10.12s | `decode_timeout` |
| 2026-09-09 | `SESS-W4-C02` | ME-ME-A | `phone_screen` | **`legacy`** | 50 | 17 | **94.1%** | 1.78s | 5.35s | `token_expired` |
| 2026-09-10 | `SESS-W4-C03` | ECE-ECE-B | `projector` | **`legacy`** | 55 | 19 | **89.5%** | 2.00s | 7.14s | `token_expired` |
| 2026-09-11 | `SESS-W4-C04` | CE-CE-A | `projector` | **`legacy`** | 55 | 19 | **89.5%** | 1.98s | 9.11s | `token_expired` |

---

## 2. Volume Gate & Sampling Integrity Audit

- **Pilot Sessions Count**: 4 sessions across 4 days (Gate: $\ge 3$ sessions on $\ge 2$ days: **PASSED**)
- **Total Short-Format Scan Attempts**: **230 attempts** (Gate: $\ge 150$ attempts: **PASSED**)
- **Old-Bucket Short-Format Scan Attempts**: **78 attempts** (Gate: $\ge 50$ old-tier attempts: **PASSED**)
- **Matched Legacy Control Attempts**: **220 attempts** (76 Old-tier)
- **Zero Classroom Outages**: Zero scan interruptions, zero manual fallbacks required across all 8 sessions.
