# SNIST ERP — Device Binding V2 Recovery Runbook

**Document Version:** 1.0.0  
**Date:** September 12, 2026  
**Audience:** Students, Faculty, Support Staff, Department HODs, System Administrators  
**Core Objective:** **NO SILENT STUDENT LOCKOUT.** Legitimate students must always have a secure, understandable recovery path that NEVER compromises possession proof.

---

## 1. Executive Summary

In a university environment, students frequently clear browser cookies, switch phones, install and uninstall PWAs, or share devices with peers. Binding V2 enforces cryptographic ECDSA P-256 possession proof for all classroom attendance scans.

This runbook defines the standard operating procedures (SOP) for all recovery workflows, ensuring that no legitimate student is permanently prevented from marking attendance while completely preventing unauthorized proxy attendance.

---

## 2. Recovery Pathways Architecture

```
                                  STUDENT DEVICE STATE
                                           │
         ┌─────────────────────────────────┴─────────────────────────────────┐
         ▼                                                                   ▼
    NEW STUDENT / UNBOUND                                      STORAGE WIPED / NEW PHONE
         │                                                                   │
   Scan Classroom QR                                                 Scan Classroom QR
         │                                                                   │
  HTTP 403 no_active_binding                                         HTTP 403 no_active_binding
         │                                                                   │
1-Tap Quick Enroll (~3s)                                            1-Tap Quick Enroll (~3s)
         │                                                                   │
  POST /binding/enroll                                              POST /binding/enroll
         │                                                                   │
Status: DEVICE_ENROLLED                                             Status: REBIND_REQUIRED
         │                                                                   │
  Rescan QR -> SUCCESS                                         6-Digit OTP Sent to College Email
                                                                             │
                                                                 Enter Code in Scanner Modal
                                                                             │
                                                                   POST /binding/enroll (with OTP)
                                                                             │
                                                                 Old Key Atomically Revoked
                                                                 New Key Enrolled (DEVICE_REBOUND)
                                                                             │
                                                                    Rescan QR -> SUCCESS
```

---

## 3. Standard Operating Procedures (SOP)

### SOP-1: Unbound Student (First-Time Device Onboarding)
* **Who it affects:** Freshmen, students scanning for the first time on a new personal smartphone.
* **Symptoms:** Scanner displays yellow banner: *"Device Enrollment Required. Your device is not enrolled with a security key yet."*
* **Resolution Steps:**
  1. Student taps the blue **"1-Tap Quick Enroll Device (~3s)"** button directly in the scanner.
  2. Browser generates an ECDSA P-256 key pair silently in WebCrypto (~50ms) and stores the private key handle in IndexedDB (`extractable: false`).
  3. Client registers the public key with `POST /api/v1/binding/enroll`.
  4. Server creates an active `DeviceBinding` row (`revoked_at = NULL`).
  5. Scanner guide text updates: *"Device enrolled securely! Rescan the attendance QR now."*
  6. Student aims camera at classroom projector; attendance is immediately recorded as `PRESENT`.

---

### SOP-2: Storage Wipe / IndexedDB Eviction / PWA Reinstall
* **Who it affects:** Student who cleared browser history/cookies, reset phone, or reinstalled the PWA.
* **Symptoms:** Local private key is missing from IndexedDB, but server still holds active binding from previous installation.
* **Resolution Steps:**
  1. Student opens camera scanner and scans classroom QR.
  2. Server returns HTTP 403 `no_active_binding`.
  3. Student taps **"1-Tap Quick Enroll Device (~3s)"**.
  4. Server detects existing active binding and triggers rebind friction:
     - Automatically dispatches 6-digit OTP to student's registered `@sreenidhi.edu.in` email.
     - Returns `{ status: "REBIND_REQUIRED", otp_required: true, email_masked: "a****e@sreenidhi.edu.in" }`.
  5. Scanner modal automatically opens the **"Device Verification Code"** dialog inline.
  6. Student enters the 6-digit code and taps **"Verify & Link Device"**.
  7. Server atomically marks old key `revoked_reason = 'rebind'` and registers new key.
  8. Dialog closes; student rescans QR and attendance succeeds.
  * **Fallback:** If student has no network access to email, proceed to **SOP-4 (Faculty 1-Tap Reset)** or **SOP-5 (Ladder Rung 4 Manual Mark)**.

---

### SOP-3: Account Switching on Shared Phones
* **Who it affects:** Two students sharing a single phone during a laboratory or lecture session.
* **Invariants:**
  - Student A's private key CANNOT be used to sign for Student B.
  - Student B CANNOT inherit Student A's binding.
* **Resolution Steps:**
  1. Student A logs out of the portal.
  2. Student B logs in with their own credentials.
  3. `getBindingState(roll)` checks whether the stored key's `student_id_hash` matches `sha256(Student_B_Roll)`.
  4. Key ownership mismatch is detected -> Student B is marked as `not_enrolled`.
  5. If Student B scans, they receive `no_active_binding` and can enroll their own key (triggering SOP-2 rebind if switching devices).
  6. Student A's keys are isolated and never cross-signed.

---

### SOP-4: Faculty / Admin Device Reset (Exempt from Churn Limit)
* **Who it affects:** Student with a broken/lost phone who has exceeded the 2-rebind 30-day limit (`CHURN_LIMIT_EXCEEDED`), or student unable to receive email OTP.
* **Resolution Steps for Faculty / Admin:**
  1. Faculty opens **Teacher Dashboard** or Admin opens **Admin Console**.
  2. Navigate to **Student Roster** or **Device Management**.
  3. Locate student by Roll Number (e.g., `21051A0501`).
  4. Click **"Reset Device Binding"** (`POST /api/v1/binding/admin/revoke/{student_id}`).
  5. Server marks active binding `revoked_reason = 'admin_reset'`, which is **strictly exempt** from the student's 30-day churn budget.
  6. Audit log records the faculty user ID and timestamp.
  7. Student can immediately perform a fresh 1-Tap Enroll (SOP-1) without requiring OTP.

---

### SOP-5: Classroom Fallback (Faculty Manual Mark / Rung 4)
* **Who it affects:** Student experiencing a dead battery, camera hardware failure, or temporary network outage during live class.
* **Resolution Steps:**
  1. In the scanner modal, student taps **"Mark Me Manually -> Tell Faculty"** (Degradation Ladder Rung 4).
  2. Screen switches to high-contrast **Roll Card Modal**, displaying student's Roll Number, Name, and Section in large, high-legibility typography.
  3. Student shows phone screen to the teacher.
  4. Teacher taps student's name on their live roster or uses **Manual Search Modal** to record presence.
  5. Record is committed with `scan_mode = 'MANUAL'` and audited with faculty ID.

---

## 4. Operational Limits & Error Taxonomy

| Error Code / Message | Cause | Student Action | Recovery Path |
|---|---|---|---|
| `no_active_binding` | Student has no active cryptographic key registered. | Tap "1-Tap Quick Enroll" in scanner. | SOP-1 (Enroll) |
| `REBIND_REQUIRED` | New key submitted while old key is active in database. | Enter 6-digit OTP sent to college email. | SOP-2 (Email OTP) |
| `INVALID_OTP` | Wrong 6-digit OTP entered or expired (10 min TTL). | Re-enter correct code or tap "Resend Code". | Max 3 attempts |
| `CHURN_LIMIT_EXCEEDED` | Student attempted > 2 device rebinds in 30 rolling days. | Contact class teacher or department HOD. | SOP-4 (Admin Reset) |
| `VERIFY_LOCKOUT` | 5 consecutive invalid signatures submitted. | Wait 15 minutes for temporary lockout to clear. | Auto-clears in 15m |
| `ALREADY_MARKED` | Attendance already recorded for this session. | No action required; attendance confirmed. | Attendance credited |
| `TOKEN_EXPIRED` | QR rotated or session expired before submission. | Aim camera at live projector QR. | Rescan live QR |

---

## 5. Security & Privacy Invariants

1. **Zero Raw Cryptographic Secrets in Logs:**
   Under no circumstances may private keys, raw signatures, or full challenge tokens be written to application logs, audit tables, or telemetry.
2. **Zero Plaintext PII in Local Storage:**
   IndexedDB stores only the non-extractable CryptoKey handle and `student_id_hash` (SHA-256 hex). No student names or roll numbers are saved in key records.
3. **Server Authority:**
   Client local state is an advisory cache. The database `DeviceBinding` table is the sole authoritative source of truth for device possession.
4. **Strict Audit Trail:**
   Every device enrollment, rebind, admin revocation, and signature failure is permanently recorded in `qr_audit_logs` with UTC timestamps.
