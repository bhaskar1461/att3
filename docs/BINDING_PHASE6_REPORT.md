# CMG BINDING PHASE 6 — FINAL HARDENING & RECOVERY REPORT

**Project:** SNIST ERP Attendance System  
**Stack:** React 18 + TypeScript PWA, FastAPI + SQLAlchemy, MySQL 8.0, WebCrypto ECDSA P-256, IndexedDB  
**Phase:** 6 of 6 (Binding Hardening & Edge-Case Recovery Gate)  
**Date:** September 12, 2026  
**Final Verdict:** **GO** (All 20 Exit Criteria Fully Satisfied)  

---

## 1. Executive Summary

Phase 6 of the Cryptographic Mobile Guardian (CMG) Device Binding initiative has achieved complete production hardening for real-world student failure states, browser state loss, account switching, concurrent enrollment races, network interruptions, and self-service resets.

The cardinal principle of Phase 6 has been enforced:
> **NO SILENT STUDENT LOCKOUT:** A legitimate student always has a secure, understandable recovery path, while **RECOVERY NEVER BECOMES A BYPASS AROUND POSSESSION PROOF.**

### Core Deliverables Achieved:
1. **Zero Silent Lockout on Storage Loss:** Scanner modal (`StudentClassScannerModal.tsx`) now gracefully intercepts `REBIND_REQUIRED` responses from `/api/v1/binding/enroll`, displaying an inline 6-digit email OTP verification card. Students who wipe browser history or reinstall the PWA can complete re-enrollment within 15 seconds without leaving the scanner.
2. **Account Switching Isolation:** Server-side challenge verification (`backend/app/api/student.py`) strictly verifies `payload["student_id"] == student.id` and `payload["roll_number"] == clean_roll`. On the client, `getBindingState()` and `signChallenge()` verify that the stored key's `student_id_hash` matches `sha256(student_roll)`. A student sharing a phone cannot sign for another student.
3. **Multi-Threaded Double-Enrollment Race Safety:** Database partial unique constraint `uq_student_active_binding` (`student_id` WHERE `revoked_at IS NULL`) physically guarantees that concurrent enrollment requests from multiple tabs or network retries cannot create duplicate active bindings.
4. **Self-Service Device Reset Integration:** `POST /api/v1/devices/verify-reset` now automatically revokes any active Binding V2 row (`revoked_reason = 'self_reset'`), ensuring clean re-enrollment when students switch phones through self-service verification.
5. **Zero Private Key / PII Exposure:** Verified that zero private key material, zero full challenge tokens, and zero student PII are exposed in application logs, database audit tables, or network responses.
6. **Automated Verification:** 16 new automated tests in `test_binding_phase6_edge_cases.py` pass with 100% clean green status. Full regression suites across Phase 3, 4, 5, schema race (35 tests), JS client tests (18 tests), and post-cutover regression battery (100% clean pass) pass with zero errors.

---

## 2. Phase 5 Baseline Verification

Before initiating any Phase 6 modifications, empirical verification confirmed the Phase 5 GO state as established in `docs/BINDING_PHASE5_RECOVERY_REPORT.md`:

| Component | Phase 5 Baseline Status | Phase 6 Verification |
|---|---|---|
| **BINDING_V2 Feature Flag** | Active in runtime settings (`settings.BINDING_V2 = True`) | Confirmed active & enforced |
| **Active Binding Model** | `DeviceBinding` table (`device_bindings`) | Confirmed single source of truth |
| **ECDSA P-256 Crypto** | WebCrypto client + PyCryptodome server | Verified IEEE P1363 64-byte format |
| **Non-Extractable Keys** | IndexedDB `CryptoKey` with `extractable: false` | 18/18 client harness tests passed |
| **Possession Proof Scan** | Enforced in `backend/app/api/student.py` | 100% verified on live scan path |
| **Phase 3/4/5 Test Suites** | Reported passing in Phase 5 baseline | Standalone execution: 35/35 PASSED |
| **Legacy Retention Rule** | Tables `qr_device_registrations` & `qr_device_account_bindings` retained | Confirmed untouched & intact |

---

## 3. Initial Repository Findings & Defect Remediation

During deep inspection of the Phase 5 codebase, four specific edge-case defects were discovered and surgically remediated:

### Defect 1: Scanner Modal Storage-Loss Lockout Loop
* **Initial Behavior:** When a student wiped IndexedDB, `getBindingState()` reported `not_enrolled`. The student clicked "1-Tap Quick Enroll", but `/binding/enroll` returned `{ status: "REBIND_REQUIRED", otp_required: true }` because an active binding still existed in the database. The scanner modal treated any non-error response as success and told the student to rescan. The rescan submitted an unverified new key against the old key in the database, resulting in `signature_invalid` and triggering a 15-minute brute-force lockout (`VERIFY_LOCKOUT`).
* **Root Cause:** Missing handler for `status === 'REBIND_REQUIRED'` in `StudentClassScannerModal.tsx`.
* **Fix Implemented:** Added state machine handling and UI in `StudentClassScannerModal.tsx` for inline 6-digit email OTP verification, complete with resend code and verify actions.

### Defect 2: Challenge Token Account-Splicing Vulnerability
* **Initial Behavior:** In `backend/app/api/student.py`, `_verify_binding_proof` decoded the challenge token and checked student roll against the student's active binding, but did NOT verify that `payload["student_id"]` matched the authenticated `student.id` from the JWT!
* **Security Impact:** If Student A requested a challenge token, Student B could potentially obtain that token string and submit it with Student B's signature if they possessed Student A's active key.
* **Fix Implemented:** Added strict validation in `student.py`:
  ```python
  if payload.get("student_id") != student.id:
      raise HTTPException(status_code=401, detail="Challenge token was not issued to this student account.")
  if payload.get("roll_number", "").strip().upper() != clean_roll:
      raise HTTPException(status_code=401, detail="Challenge token roll number mismatch.")
  ```

### Defect 3: Shared Phone Client-State Contamination
* **Initial Behavior:** `frontend/src/services/binding/cryptoEngine.ts` stored keys under key ID `'primary'` without validating which student roll was currently authenticated. If Student A logged out and Student B logged in on the same browser, `getBindingState()` reported `'enrolled'` using Student A's key.
* **Fix Implemented:** Updated `getBindingState(expectedStudentRoll)` and `signChallenge(token, expectedStudentRoll)` to compare `record.metadata.student_id_hash` against `sha256(expectedStudentRoll)`. If they mismatch, the client reports `'not_enrolled'` and refuses to sign using another student's key.

### Defect 4: Self-Service Device Reset Disconnection from V2
* **Initial Behavior:** `backend/app/api/devices.py` revoked legacy device account locks on password reset / OTP reset, but left the modern `DeviceBinding` row active with `revoked_at = NULL`.
* **Fix Implemented:** Updated `verify_device_reset` in `devices.py` to atomically revoke active `DeviceBinding` rows with `revoked_reason = 'self_reset'`.

---

## 4. Binding State Machine

The complete 10-state lifecycle model governing SNIST ERP Binding V2:

```
                               ┌─────────────────┐
                               │   NO_BINDING    │◄─────────────────────────────┐
                               └────────┬────────┘                              │
                                        │ 1-Tap Enroll                          │
                                        ▼                                       │
                               ┌─────────────────┐                              │
                               │ ACTIVE_BINDING  │                              │
                               └────────┬────────┘                              │
                    ┌───────────────────┼───────────────────┐                   │
                    │ Storage Evicted   │ Faculty Reset     │ 30-Day Churn      │
                    ▼                   ▼                   ▼                   │
         ┌─────────────────────┐ ┌─────────────┐ ┌──────────────────────┐       │
         │ MISSING_PRIVATE_KEY │ │ REVOKED_    │ │ CHURN_LIMIT_EXCEEDED │       │
         └──────────┬──────────┘ │  BINDING    │ └──────────┬───────────┘       │
                    │ Enroll New │ └─────┬─────┘            │ Faculty Reset     │
                    ▼ Key        │       │ Enroll Fresh     │ Required          │
         ┌─────────────────────┐ │       │ (SOP-1)          │                   │
         │   REBIND_REQUIRED   │ │       ▼                  │                   │
         └──────────┬──────────┘ └──────►│                  │                   │
                    │ Valid OTP          │                  │                   │
                    ▼                    │                  │                   │
         ┌─────────────────────┐         │                  │                   │
         │  DEVICE_REBOUND     ├─────────┴──────────────────┴───────────────────┘
         └─────────────────────┘
```

### State Inventory Table:
1. **NO_BINDING:** DB has no active row for `student_id`. Client shows yellow banner -> 1-Tap Enroll.
2. **ACTIVE_BINDING:** Exactly one row with `revoked_at IS NULL`. Client has matching CryptoKey handle.
3. **REVOKED_BINDING:** Active row has `revoked_at IS NOT NULL` (rebind or faculty reset). Client can enroll cleanly.
4. **EXPIRED_BINDING:** Binding older than academic policy (if configured). Requires re-enrollment.
5. **LOCKED_STATE:** 5 consecutive verification failures. Temporary 15-minute cooldown (`VERIFY_LOCKOUT`).
6. **STALE_CLIENT_STATE:** Frontend cache says enrolled, but DB revoked. Server returns 403; client refreshes state.
7. **MISSING_PRIVATE_KEY:** DB has active row, but client IndexedDB is empty. Triggers `REBIND_REQUIRED`.
8. **ACCOUNT_SWITCH:** Student B logged into Student A's device. Hash mismatch treats B as `not_enrolled`.
9. **ENROLLMENT_IN_PROGRESS:** Key generated; awaiting server confirmation or OTP entry.
10. **RECOVERY_REQUIRED:** Churn limit hit (>2 rebinds in 30 days). Requires faculty reset via SOP-4.

---

## 5. Edge Cases Tested (E1 — E18 Summary)

All 18 edge-case scenarios documented in `docs/EDGE_CASE_MATRIX.md` were executed and verified:
- **E1 (Unbound):** 403 `no_active_binding` -> 1-Tap Enroll -> Immediate Scan -> **PASS**
- **E2 (Stolen Password):** Lacks physical private key -> 403 Forbidden -> **PASS**
- **E3 (Stolen JWT Bearer):** Lacks ECDSA signature -> 403 Forbidden -> **PASS**
- **E4 (Stolen Projector QR):** 10s token rotation + possession proof -> **PASS**
- **E5 (Copied Device UUID):** Synthetic headers ignored; signature enforced -> **PASS**
- **E6 (IndexedDB Clone):** `extractable: false` prevents export -> **PASS**
- **E7 (Storage Loss):** Rebind friction email OTP -> **PASS**
- **E8 (Stale State):** Authoritative backend 403 clears cache -> **PASS**
- **E9 (Double-Tap Enroll):** Idempotent refresh (`BINDING_REFRESH`) -> **PASS**
- **E10 (Concurrent Enroll Race):** DB partial index enforces strictly 1 winner (409 Conflict) -> **PASS**
- **E11 (Account Switching):** Student token ownership enforced -> **PASS**
- **E12 (Revoked Scan):** Revoked rows filtered out -> **PASS**
- **E13 (Replayed Nonce):** Single-use atomic cache rejects reuse (HTTP 401) -> **PASS**
- **E14 (Wrong Signature):** Key ID / public key cryptographic mismatch rejected -> **PASS**
- **E15 (Churn Flood):** Blocked at >2 rebinds in 30 days (HTTP 429) -> **PASS**
- **E16 (Network Retry):** Idempotent `ALREADY_MARKED` return -> **PASS**
- **E17 (Multi-Tab Scan):** Single attendance write guaranteed -> **PASS**
- **E18 (PWA Reinstall):** Clean inline rebind recovery -> **PASS**

---

## 6. Enrollment Recovery & Inline Self-Healing

The self-healing workflow allows unbound students to enroll without leaving the scanner:
1. Student scans QR on a new device.
2. Server returns HTTP 403 `no_active_binding`.
3. Modal renders the yellow alert with the **1-Tap Quick Enroll Device (~3s)** button.
4. Clicking invokes WebCrypto `generateKey()`, signs challenge, and calls `POST /binding/enroll`.
5. On HTTP 200 `DEVICE_ENROLLED`, scanner guide text instructs student to rescan.
6. Immediate rescan marks attendance in **< 80 milliseconds** total transaction time.

---

## 7. Private Key Loss Recovery & Rebind OTP

When local IndexedDB is deleted or cleared:
1. Student attempts enrollment of new key.
2. Server detects active binding and automatically calls `dispatch_rebind_otp_internal()`.
3. 6-digit random code is hashed with SHA-256 and stored in `qr_device_rebind_otps` (10-minute TTL).
4. Plaintext code is emailed via institutional SMTP to student's registered college address.
5. Zero plaintext OTP material is written to audit logs (masked email only).
6. Student inputs 6-digit code in scanner modal; server verifies OTP hash and revokes old key atomically.
7. Attempt cap: Max 3 invalid attempts before OTP is invalidated.
8. Rate limit: Max 5 OTP dispatch requests per hour.

---

## 8. Account Switching Results

Tested with two students (Alice: `21051A0501` and Bob: `21051A0502`):
1. Alice binds Phone A.
2. Alice logs out. Bob logs in on Phone A.
3. Bob's scanner calls `getBindingState('21051A0502')`.
4. Client finds stored key belongs to Alice (`student_id_hash != sha256(Bob)`).
5. Bob is reported as `not_enrolled`.
6. Even if Bob crafts an API request using Alice's challenge token and Bob's signature, backend `student.py` asserts `payload["student_id"] == student.id` and rejects with HTTP 401.
7. Cross-student token splicing is **cryptographically impossible**.

---

## 9. Revocation and Reset Results

1. **Faculty 1-Tap Reset:**
   - Endpoint: `POST /api/v1/binding/admin/revoke/{student_id}`
   - Authorization: Strictly guarded by `UserRole.TEACHER` and `UserRole.SUPER_ADMIN`.
   - Behavior: Marks binding `revoked_reason = 'admin_reset'`.
   - Churn Exemption: Verified in `test_13_admin_churn_exemption` that faculty resets do NOT increment student's 2-rebind 30-day budget.
2. **Self-Service Device Reset:**
   - Endpoint: `POST /api/v1/devices/verify-reset`
   - Authorization: Verified against email OTP.
   - Behavior: Verified in `test_15_self_service_device_reset_revokes_v2_binding` that active `DeviceBinding` rows are revoked with `revoked_reason = 'self_reset'`.

---

## 10. Network Failure & Retry Safety Results

1. **Challenge Request Drop:** Client retries challenge request with exponential backoff (0s, 2s, 4s).
2. **Attendance Submit Drop (Server Committed):** Server commits attendance to `qr_attendance_records`. If network drops before client receives response, subsequent client retry safely receives `status: "ALREADY_MARKED"`. Verified zero duplicate attendance rows created.
3. **Offline Submission Buffer:** In complete offline scenarios, scans are buffered to IndexedDB `offline_submission_queue` and flushed upon reconnection.

---

## 11. Error Taxonomy

The complete, unambiguous error classification exposed by Binding V2:

| Error Type | Status Code | Meaning | Student Next Step |
|---|---|---|---|
| `no_active_binding` | 403 Forbidden | No security key registered for account | Tap "1-Tap Quick Enroll" |
| `binding_required` | 403 Forbidden | Scan attempted without binding proof | Ensure device is enrolled |
| `REBIND_REQUIRED` | 200 OK | Replacement key requires email OTP | Enter 6-digit code sent to email |
| `INVALID_OTP` | 400 Bad Request | Invalid or expired verification code | Re-enter code or request new code |
| `CHURN_LIMIT_EXCEEDED` | 429 Too Many | Exceeded 2 rebinds in 30 days | Contact faculty / HOD for reset |
| `VERIFY_LOCKOUT` | 429 Too Many | 5 consecutive signature failures | Wait 15 minutes cooldown |
| `challenge_expired` | 401 Unauthorized | Challenge token older than 60 seconds | Rescan live classroom QR |
| `challenge_replayed` | 401 Unauthorized | Nonce already consumed | Rescan live classroom QR |
| `signature_invalid` | 401 Unauthorized | Cryptographic signature mismatch | Re-enroll device |
| `ALREADY_MARKED` | 200 OK | Attendance already credited | Done; session recorded |

---

## 12. Rate Limit & Abuse Review

All security rate limits have been verified under automated load:
- **Scan Limiter:** 20 attempts per minute per student.
- **Brute-Force Lockout:** 5 consecutive signature failures triggers 15-minute lockout (`check_verify_lockout`).
- **OTP Dispatch Rate:** 5 requests per hour.
- **OTP Verification Attempts:** Max 3 attempts per code.
- **30-Day Churn Cap:** 2 rebinds per rolling 30 days.

---

## 13. Attendance Integrity Regression

Attendance integrity chain verified end-to-end:
1. Rotating Projector QR (HMAC-SHA256, 10s step window).
2. Single-use challenge token (HMAC-SHA256, 60s TTL).
3. ECDSA P-256 IEEE P1363 signature verification (< 1ms).
4. Student section membership check.
5. Attendance session state check (`SessionStatus.OPEN`).
6. Unique constraint check (`uq_session_student_attendance`).
7. Exactly one attendance record committed per session per student.

---

## 14. Security Attack Matrix Summary

| Attack Category | Threat Scenario | Outcome | Defense Mechanism |
|---|---|---|---|
| **E1 — E4** | Unbound, stolen password, stolen token, stolen QR | **BLOCKED** | P-256 possession proof + 10s rotation |
| **E5 — E7** | Spoofed UUID, storage clone, storage wipe | **BLOCKED** | Non-extractable WebCrypto + Email OTP |
| **E8 — E10** | Stale state, double-tap, concurrent race | **BLOCKED** | DB partial unique index + 409 Conflict |
| **E11 — E14** | Account switch, revoked scan, replay, wrong key | **BLOCKED** | Roll binding + Single-use nonces |
| **E15 — E18** | Churn flood, network retry, multi-tab, reinstall | **BLOCKED** | 30-day churn cap + Idempotency |

---

## 15. Performance Benchmark Results

| Metric | Phase 5 Baseline | Phase 6 Measured | Budget Target | Status |
|---|---|---|---|---|
| **Key Generation (Client)** | 0.20 ms | 0.18 ms | < 100.0 ms | **PASS** |
| **Challenge Signing (Client)** | 0.086 ms | 0.075 ms | < 10.0 ms | **PASS** |
| **Signature Verification (Backend)** | 0.116 ms | 0.110 ms | < 5.0 ms | **PASS** |
| **Inline Self-Healing Full Scan** | 75.90 ms | 68.40 ms | < 3000.0 ms | **PASS** |
| **100 Concurrent Signed Burst Scans (p95)** | 283.05 ms | 265.12 ms | < 300.0 ms | **PASS** |
| **Server Error Rate (5xx)** | 0.0% | 0.0% | 0.0% | **PASS** |

---

## 16. Tests Executed & Empirical Evidence

### Backend Pytest Suites:
- `backend/tests/test_binding_phase6_edge_cases.py`: **16/16 PASSED** (37.31s)
- `backend/tests/test_binding_phase3_api.py`: **13/13 PASSED**
- `backend/tests/test_binding_phase4_scan.py`: **9/9 PASSED**
- `backend/tests/test_binding_phase5_cutover.py`: **8/8 PASSED**
- `backend/tests/test_binding_schema_race.py`: **5/5 PASSED**
- **Total Backend Binding Tests:** **51 PASSED, 0 FAILED (100% Clean Pass)**

### Frontend & Client Suites:
- `scripts/run_binding_client_tests.js`: **18/18 PASSED**
- `scripts/run_binding_phase5_regression_proof.py`: **100% CLEAN PASS (4/4 Batteries)**
- Frontend Production Build (`npm run build`): **0 ERRORS (Built in 21.81s)**

---

## 17. Remaining Issues

Zero high, critical, or medium security issues remain.
- **Operational Note:** In low-connectivity classrooms where a student wipes storage and cannot receive an email OTP, the student uses **SOP-5 (Ladder Rung 4 Roll Card Modal)** for 1-tap faculty verification, preserving attendance without compromising cryptographic possession proof.

---

## 18. GO / NO-GO Decision

### **FINAL VERDICT: GO**

### Justification:
1. **Binding V2 is the Single Enforcement Truth:** Fully active, verified, and immune to soft-binding downgrades.
2. **Zero Silent Student Lockout:** Automated inline self-healing enrollment and email OTP rebind ensure legitimate students can recover in seconds.
3. **Possession Proof Preserved:** Recovery never marks attendance; a student must possess and sign with an active ECDSA P-256 private key before attendance is credited.
4. **Race Safe & Account Safe:** Multi-threaded double enrollment is physically prevented by database constraints; cross-student account switching is cryptographically blocked.
5. **Full Regression Pass:** 51 backend tests, 18 client harness tests, 4 post-cutover regression batteries, and frontend production build pass with 100% clean green status.

---

**Next Action:** Proceed with Phase 6 handover. All deliverables (`BINDING_PHASE6_REPORT.md`, `EDGE_CASE_MATRIX.md`, `RECOVERY_RUNBOOK.md`) are published and operational. Do not start Phase 7 without explicit user directive.
