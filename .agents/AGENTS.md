# AGENTS.md — Workspace Project Rules

## SNIST ERP AI Behavioral Rules

1. **Zero Hallucination & Evidence-First Verification**: Inspect actual files before writing code. Base diagnoses on empirical log evidence.
2. **Leisurely-Spaced, Phase-by-Phase Execution**: Execute one stage at a time. Run automated verification tests before completing any stage.
3. **Strict Preservation of Existing Working Code**: Maintain existing working code, utility modules, and comments.
4. **Canonical Identity Governance**: Enforce `SAP ID` as the unique, immutable institutional identifier for Students and Faculty.
5. **Server-Authoritative Time Enforcement**: All attendance timestamps and security expirations must use server-authoritative IST (`Asia/Kolkata`) / UTC time. Never trust client device clocks.
6. **Device Binding & Account Switching Lockout**: Enforce 30-minute device-to-student lock (`Device -> Roll Number / SAP ID`). Reject account switching with HTTP 403 generic message.
7. **No Silent Exception Swallowing**: Fix root causes instead of masking errors.
8. **Mandatory Automated Test Verification**: Always run automated tests and verify 100% clean pass before declaring success.
9. **Defensive Error Handling & Server Crash Prevention**: Wrap new feature initializations, DB DDL/migrations, external APIs, and startup routes with descriptive error handling and try-except blocks so that deployment or initialization failures degrade gracefully with diagnostic logs WITHOUT blowing up or crashing the application server process.

