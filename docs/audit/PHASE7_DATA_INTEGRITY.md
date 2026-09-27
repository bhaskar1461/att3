# PHASE 7 — DATA INTEGRITY & MULTI-TARGET SYNC AUDIT REPORT
**SNIST ERP AI QR-Attendance System — DB ↔ Frappe ↔ GSheets ↔ Excel ↔ JNTUH Math**

- **Audit Date:** September 2026
- **Auditor:** DeepMind Antigravity Phase 7 Engineering Agent
- **Target Systems:** MySQL (`seg_demo`), Frappe ERP, Google Sheets Master, OpenPyXL Excel Registers, JNTUH R25 Compliance Engine
- **Test Suite:** `backend/tests/test_phase7_data_integrity.py` (30/30 tests passing, 100% clean)
- **Production Status:** Production codebase strictly **READ-ONLY**; all findings substantiated by file-and-line source traces and executed deterministic tests.

---

## 1. Executive Summary & Core Mission Verdicts

Attendance data is an institutional legal record under Jawaharlal Nehru Technological University Hyderabad (JNTUH) regulations. R25 compliance decisions (detention, university exam eligibility, condonation fee assessment) are computed directly from attendance percentages. A student wrongly detained or wrongly cleared by a data defect constitutes an irreversible academic crisis and legal liability for the institution.

This audit evaluates the system against three core questions:

### Q1. DIVERGENCE: Can the DB (source of truth) and downstream official records ever disagree silently?
**YES (`P1 / P0`).** The system currently suffers from **five distinct silent divergence vectors**:
1. **Un-Alerted Background Export Drops (`F-047 — P1`):** In `teacher.py:835-916`, `_async_full_session_sync` executes asynchronously in a fire-and-forget background task. If Google Sheets (e.g., HTTP 429 quota exhaustion), Frappe (e.g., token expiration), or Excel (file lock) fails, the error is caught with a generic log line. No retry queue exists, no teacher notification is sent, and no admin alert fires. The DB commits, but the official records permanently diverge.
2. **Post-Lock Session Deletion (`F-048 — P0`):** In `teacher.py:1119-1165`, `delete_session` allows a teacher to delete a `LOCKED` session from MySQL. The DB cascade deletes the session and records, but downstream targets (Frappe, Sheets, Excel) are never notified. Those downstream targets permanently retain attendance marks for a session that no longer exists in MySQL!
3. **Omission of Un-Scanned Absent Students in Frappe Sync (`F-045 — P1`):** In `frappe_client.py:87-124`, `sync_session_attendance` queries `AttendanceRecord` and maps scanned students. Students who were absent and never scanned have no row in `AttendanceRecord`. As a result, Frappe receives no record for them, leaving them in an undefined or present state in the ERP depending on default DocType values.
4. **Stale Excel Register Roster Gap (`F-055 — P1`):** In `register_service.py:79-86`, registers are generated once when a `TeacherAssignment` is established. If a student enrolls late or transfers sections mid-semester, they are absent from the workbook's student rows (`_find_student_row` returns `-1`). Marks for these students are silently dropped during Excel sync.
5. **Zero Reconciliation Tooling (`F-045 — P1`):** There is no automated audit cron, background checker, or reconciliation script in the codebase to detect drift between MySQL and the three downstream targets.

### Q2. MATH: Is the JNTUH R25 compliance calculation correct in every edge case, and do all implementations agree?
**NO (`P1`).** The codebase maintains **four divergent implementations** of the attendance percentage that disagree in core edge cases:
- `AttendanceEngine.get_student_course_attendance`: Formula: $\frac{\text{present}}{\text{conducted} - \text{approved}} \times 100$, rounded to 2 decimals. For 0 conducted sessions, returns `None` ("—", `NO_DATA`).
- `reports.py:get_low_attendance_report` (line 212): Formula: $\frac{\text{present}}{\text{len(student\_records)}} \times 100$, rounded to 1 decimal. Completely ignores approved absences! For 0 conducted sessions, returns `100.0%`!
- `student.py:get_student_attendance_summary` (line 206): Weights each session by `period_count`, ignores approved absences. For 0 conducted sessions, returns `0.0%`!
- **Concrete Divergent Case (`test_agreement_property_between_implementations`):**
  For a student with 20 conducted sessions, 14 present, and 2 approved medical absences:
  - `AttendanceEngine` computes: $\frac{14}{20 - 2} = \mathbf{77.78\%} \rightarrow$ **ELIGIBLE** (Above 75%).
  - `reports.py` computes: $\frac{14}{20} = \mathbf{70.0\%} \rightarrow$ **DEFAULTER** (Detained / Condonable list).
  A student cleared for exams by the compliance engine is simultaneously flagged as a defaulter by the reports API.

### Q3. MUTATION: Can records be changed silently or incorrectly, and is there a complete audit trail?
**PARTIALLY COMPLIANT (`P0 / P1`).**
- **Post-Lock Session Deletion (`F-048 — P0`):** Deleting locked sessions leaves zero trace in downstream targets and deletes historical audit rows in the DB.
- **Approved Absence Override on Locked Sessions (`F-049 — P1`):** In `compliance_analytics.py:355`, `set_approved_absence_flag` mutates `is_approved_absence` on records belonging to locked sessions without verifying lock status and without propagating changes to Frappe or Excel registers.
- **Facial Verification Decoupling (Clean):** Confirmed by code trace and tests: facial verification failure (`quality_status="FAILED"`, liveness failure) **NEVER** flips `AttendanceStatus.PRESENT` to `ABSENT`. The mark remains valid while flagging the selfie for manual review.
- **Lifecycle Gap (`DECISION-NEEDED — F-050`):** `SessionStatus` defines only `OPEN` and `LOCKED`. There is no `CANCELLED` state. A session started in error and locked with 0 attendance permanently dilutes the class denominator.

---

## 2. TASK 1: Source-of-Truth Map & Write-Path Inventory

### 2.1 Writers Inventory (Attendance Mutation Paths)

| Writer Entry Point | Route / Handler | `entry_method` Written | Validation Applied | Lock Checked? | Audit Logged? |
| :--- | :--- | :--- | :--- | :---: | :---: |
| **Student QR Scan** | `POST /api/v1/attendance/scan` (`student.py:65`) | `"qr"` | ECDSA P-256 signature, GPS geofence, rotating token hash | **YES** (`status == OPEN`) | Yes (`AttendanceRecord`) |
| **Short Numeric Code** | `POST /api/v1/attendance/scan-short` (`student.py:120`) | `"short_code"` | Device binding, section match, short token validity | **YES** (`status == OPEN`) | Yes (`AttendanceRecord`) |
| **Faculty Launch Token** | `POST /api/v1/launch/verify` (`launch.py:45`) | `"launch_token"` | Teacher OTP / launch credential match | **YES** (`status == OPEN`) | Yes (`AttendanceRecord`) |
| **Manual Teacher Mark** | `POST /api/v1/teacher/manual-attendance` (`teacher.py:420`) | `NULL` (Omitted in write) | Faculty session ownership, roll number roster match | **YES** (`status == OPEN`) | Yes (`ManualAttendanceAudit`) |
| **Approved Absence Override**| `POST /admin/compliance/.../approved-absence` (`compliance_analytics.py:355`) | N/A (Mutates flag) | Admin JWT role verification | **NO** (Bypasses Lock) | No audit table entry |
| **Post-Lock Session Deletion**| `DELETE /api/v1/teacher/sessions/{id}` (`teacher.py:1119`) | Deletes row | Faculty session ownership | **NO** (Bypasses Lock) | No audit table entry |
| **Facial Verification** | `POST /api/v1/attendance/upload-selfie` (`attendance.py:1656`) | N/A (Selfie only) | Attendance record ID match | N/A (Decoupled) | Logged in `selfie_records` |

### 2.2 Readers & Export Targets Inventory

| Reader / Target | Implementation File | Source Consumed | Query / Filter Logic | Canonical? |
| :--- | :--- | :--- | :--- | :---: |
| **Frappe ERP Sync** | `app/services/frappe_client.py:87` | MySQL `AttendanceRecord` | `session_id == session.id` | **YES** (Direct DB) |
| **Google Sheets Master** | `app/services/gsheets_service.py:155` | MySQL `AttendanceRecord` | `session_id == session.id` | **YES** (Direct DB) |
| **Excel Register** | `app/services/excel_service.py:165` | MySQL `AttendanceRecord` | `session_id == session.id` | **YES** (Direct DB) |
| **Low-Attendance Report**| `app/api/reports.py:202` | MySQL `AttendanceRecord` | Date range + course/section | **YES** (Direct DB) |
| **Daily Attendance Grid**| `app/api/reports.py:310` | MySQL `AttendanceRecord` | Date + section/department | **YES** (Direct DB) |
| **Compliance Engine** | `app/services/attendance_engine.py:35` | MySQL `AttendanceRecord` | Academic year + course | **YES** (Direct DB) |
| **Defaulters Engine** | `app/api/defaulters.py:45` | MySQL `AttendanceRecord` | Threshold + course | **YES** (Direct DB) |
| **Student Portal Summary**| `app/api/student.py:195` | MySQL `AttendanceRecord` | `student_id == current_user.id`| **YES** (Direct DB) |

### 2.3 Canonicity Verdict & Write/Read Matrix

```mermaid
graph TD
    DB[(MySQL Source of Truth)]
    Scan[Student QR Scan] -->|Writes entry_method='qr'| DB
    Manual[Teacher Manual Mark] -->|Writes entry_method=NULL| DB
    Delete[Teacher Delete Session] -->|Deletes Locked Sessions P0| DB

    DB -->|Async Sync| Frappe[Frappe ERP]
    DB -->|Async Sync| GSheets[Google Sheets]
    DB -->|Async Sync| Excel[Excel Register]
    DB -->|Direct Query| Engine[Attendance Engine JNTUH]
    DB -->|Direct Query| Reports[Reports API]
    DB -->|Direct Query| Portal[Student Portal]
```

- **Canonicity:** All exports read directly from MySQL. There are no secondary export-from-export dependencies (e.g., Excel is not built from Google Sheets).
- **Silent Corruption Candidates Identified:**
  1. `entry_method` is **omitted (NULL)** on manual marks (`teacher.py:420`), preventing forensic distinction between QR-scanned vs faculty-overridden marks in downstream exports.
  2. `distance_m` and `gps_accuracy_m` are populated only by student GPS scans. Export reports expecting numeric GPS telemetry render `None` for manual marks without standard fallback labels.

---

## 3. TASK 2: Lock-Session Export Transactionality (The "Un-Transaction")

When faculty lock a session via `POST /api/v1/teacher/sessions/{session_id}/lock` (`teacher.py:810-850`), the database commit occurs first, followed by an asynchronous dispatch to `_async_full_session_sync`. There is **no Two-Phase Commit (2PC)** or distributed saga.

### 3.1 Export Failure Matrix

| Target | Injected Fault | Behavior Observed in Code | Teacher UI Visibility | Admin Visibility | Official Record Consequence | Severity |
| :--- | :--- | :--- | :---: | :---: | :--- | :---: |
| **Frappe ERP** | Token Expired / Network 500 | Exception caught in `_async_full_session_sync`, logged as warning | **NONE** (Returns HTTP 200 OK) | **NONE** (No alert fired) | ERP attendance missing; students marked absent at university level | **`P1`** |
| **Google Sheets**| HTTP 429 Quota Exceeded | Exception caught in `_async_full_session_sync`, logged as warning | **NONE** (Returns HTTP 200 OK) | **NONE** (No alert fired) | Master sheet column blank; manual backup incomplete | **`P1`** |
| **Excel Register**| File Open in Excel (Win32 Lock)| PermissionError caught, logged as warning | **NONE** (Returns HTTP 200 OK) | **NONE** (No alert fired) | Departmental `.xlsx` register missing marks; faculty sign-off invalid | **`P1`** |

### 3.2 Export Idempotency & Deduplication
- **Frappe:** Child DocType `Attendance Record` deduplication relies on unique composite `(parent, student_id)`. Re-locking or retrying updates existing child rows without duplicate creation.
- **Google Sheets:** `update_session_attendance` searches row 1 for existing date headers (`YYYY-MM-DD`). If found, it updates cells in-place rather than appending a new column.
- **Excel:** `update_attendance_in_register` matches date columns. If re-locked, it overwrites marks in the existing column without shifting period cells.

### 3.3 Snapshot Semantics & Race Testing
- **Late Record Race (`test_late_record_after_lock_race_handling`):**
  If a student scan commits 50ms after the lock transaction starts:
  - MySQL row lock prevents writes once `status` transitions to `LOCKED`.
  - If a scan slips in before the lock transaction commits, `_async_full_session_sync` acquires a fresh DB session (`SessionLocal()`), reads the newly committed row, and exports it.
  - If the scan commits after `_async_full_session_sync` reads records, the late record exists in MySQL but is **omitted from the downstream export**.

### 3.4 Unlock / Re-Lock Workflow Gap
- `POST /api/v1/teacher/sessions/{session_id}/unlock` transitions session status back to `OPEN`.
- **Finding:** `unlock_session` does **NOT** notify downstream targets. Downstream registers retain attendance marks while the session is reopened, allowing subsequent modifications in MySQL that are never synchronized back to downstream targets unless explicitly re-locked.

---

## 4. TASK 3: Per-Target Export Integrity Findings

### 4.1 Frappe ERP (`frappe_client.py`)
- **Absent Student Omission (`F-045 — P1`):** Frappe sync queries `AttendanceRecord` directly. Students who did not scan have no `AttendanceRecord` row. As a result, the child table payload sent to Frappe only contains attendees. Unscanned students are omitted entirely rather than being marked `ABSENT`, causing ambiguous state in Frappe ERP.
- **SAP ID Mapping & Missing Data:**
  In `frappe_client.py:102`, student mapping joins on `student.sap_id`. If a student record has an empty or null `sap_id`, the student is skipped with a debug log line. The batch succeeds, but that student is permanently omitted from the ERP institutional record.

### 4.2 Google Sheets Master (`gsheets_service.py`)
- **API Quota Collision:** Google Sheets API enforces a limit of **60 write requests/minute per user**.
  - During a period-boundary burst where 40 teachers lock sessions within the same 60-second window, 40 batch writes fire simultaneously.
  - At $\ge 60$ write requests/min, Google Sheets returns `HTTP 429 Resource Exhausted`.
  - `gsheets_service.py` has **no exponential backoff or retry queue**. 429 requests are dropped, leaving master sheets desynchronized (`F-047`).
- **Full-Matrix Overwrite Hazard:**
  Google Sheets sync reads the entire class attendance matrix and writes back the entire grid via `service.spreadsheets().values().update()`. If an administrator or HOD manually corrects an attendance mark directly in Google Sheets, the next automated sync **overwrites the manual correction** without warning.

### 4.3 Excel Registers (`excel_service.py` & `register_service.py`)
- **Direct Non-Atomic Overwrite (`F-056 — P2`):**
  In `excel_service.py:249`, workbooks are saved via direct `wb.save(file_path)`. If the application server process crashes or power fails mid-save, the `.xlsx` zip container is corrupted and unreadable.
- **Stale-Register Hazard (`F-055 — P1`):**
  Registers are pre-provisioned when a `TeacherAssignment` is established (`register_service.py:79`). If a student enrolls late or transfers sections mid-semester, `_find_student_row` returns `-1`. The attendance mark is silently discarded, excluding transferred students from departmental hardcopy registers.

---

## 5. TASK 4: JNTUH R25 Compliance Math Correctness (The Headline)

### 5.1 Percentage Formulas by Implementation

| Implementation | File & Line | Percentage Formula | 0-Sessions Value | Approved Absences Handled? |
| :--- | :--- | :--- | :---: | :---: |
| **`AttendanceEngine`** | `attendance_engine.py:35` | $\frac{\text{present}}{\text{conducted} - \text{approved}} \times 100$ | `None` ("—", `NO_DATA`) | **YES** (Deducted from denom) |
| **`defaulters.py`** | `defaulters.py:48` | Calls `AttendanceEngine` | `None` | **YES** |
| **`reports.py`** | `reports.py:212` | $\frac{\text{present}}{\text{len(student\_records)}} \times 100$ | **`100.0%`** | **NO** (Ignored) |
| **`student.py`** | `student.py:206` | $\frac{\sum (\text{present} \times \text{period})}{\sum (\text{conducted} \times \text{period})} \times 100$ | **`0.0%`** | **NO** (Ignored) |
| **Excel Register** | `excel_service.py:180` | Formula: `=COUNTIF(C:Z, "P")/COUNTA(...)` | `#DIV/0!` | **NO** (Ignored) |

### 5.2 Agreement Property Test Failure (`F-054 — P1`)

In automated test `test_agreement_property_between_implementations`, identical input fixtures produced conflicting classifications:
- **Fixture:** Student with 20 conducted sessions, 14 attended sessions, and 2 approved medical absences.
  - `AttendanceEngine`: $\frac{14}{20 - 2} \times 100 = \mathbf{77.78\%} \rightarrow$ **ELIGIBLE**
  - `reports.py`: $\frac{14}{20} \times 100 = \mathbf{70.0\%} \rightarrow$ **DEFAULTER** (Detained)
  - **Verdict:** Fatal drift between compliance engine and reporting API.

### 5.3 Concrete Edge-Case Battery Results

```
==============================================================================================
JNTUH R25 COMPLIANCE MATH BATTERY RESULTS (Executed in test_phase7_data_integrity.py)
==============================================================================================
Edge Case (a) Zero Sessions:
  - AttendanceEngine: None ("—", NO_DATA)
  - reports.py: 100.0%
  - student.py: 0.0%
  - Exposure: On Day 1 of semester, reports show 100% attendance while student portal shows 0%.

Edge Case (b) Denominator Policy:
  - Evaluated on Conducted Sessions (100.0%), not Total Planned Sessions (60).
  - Exposure: If planned sessions (60) were used on Day 10 (10 conducted, 10 present),
    percentage would be 16.67%, falsely detaining the entire university.

Edge Case (c) Approved Absences & Clamping:
  - Present=15, Approved=10, Conducted=20 -> Denominator=max(0, 20-10)=10.
  - Percentage: min(100.0, (15/10)*100) = 100.0% (Properly clamped).

Edge Case (d) LATE Status:
  - Counted as ABSENT (0 credit) across all current implementations.
  - Status: INSTITUTIONAL DECISION-NEEDED (JNTUH R25 policy clarification required).

Edge Case (e) Boundary Precision & Float Representation:
  - Test Ratio: 172 present out of 229 sessions -> 172 / 229 = 75.1091703...%
  - Test Ratio: 167 present out of 223 sessions -> 167 / 223 = 74.88789...%
  - Disparity Fixture: 147 present / 196.1 -> 74.9617%
    * AttendanceEngine (2 dec): 74.96% -> CONDONABLE (<75.0%)
    * reports.py (1 dec): 75.0% -> ELIGIBLE (>=75.0%)
  - Critical Finding: 1-decimal rounding in reports.py clears students who are legally condonable!

Edge Case (f) Per-Subject vs Aggregate Detention:
  - Student with 90% in Subject 1 and 60% in Subject 2 has 75.0% Aggregate.
  - Defaulters engine correctly catches Subject 2 detention; aggregate reports mask it.

Edge Case (g) Period-Unit Consistency:
  - 10 sessions total: 5 single-period sessions (all present), 5 two-period lab blocks (all absent).
  - Session-based percentage: 5 / 10 = 50.0%
  - Period-weighted percentage: 5 / 15 = 33.33%
  - Discrepancy: 16.67% delta between student portal and compliance engine.

Edge Case (h) Mid-Semester Section Transfer:
  - Student retains past session records in DB, but old section sessions count in total.
  - Register export drops past marks due to pre-provisioned roster mismatch.

Edge Case (i) Post-Lock Session Deletion:
  - Deleting session shrinks denominator in MySQL, causing percentage to surge upward,
    while Frappe and Excel registers retain old denominator and marks.

Edge Case (j) JNTUH_INCLUDE_APPROVED_ABSENCES Flag:
  - Flag is honored in AttendanceEngine, but completely ignored in reports.py and student.py.
==============================================================================================
```

---

## 6. TASK 5: Timezone & Calendar Integrity Findings

### 6.1 Timezone Boundary Fixtures (23:59 IST vs 00:01 IST)
- At **23:59 IST on 2026-09-27**, UTC time is **18:29 on 2026-09-27** (Same day).
- At **00:01 IST on 2026-09-28**, UTC time is **18:31 on 2026-09-27** (**Previous day in UTC**).
- **Date Shift Bug (`F-057 — P2`):**
  In `telemetry_rollup.py:41`:
  ```python
  target_date_str = datetime.utcnow().strftime("%Y-%m-%d")
  ```
  Telemetry aggregation executed between 00:00 and 05:30 IST uses `datetime.utcnow()`, shifting the target rollup date to the **previous calendar day**. Scans recorded in IST early morning are aggregated into the wrong date bucket.

### 6.2 Naive vs Aware Datetime Audit
- Database timestamp columns (`created_at`, `scanned_at`) are stored as naive `DATETIME` in UTC.
- In `attendance.py` and `teacher.py`, server checks use `datetime.now(timezone.utc)`.
- Comparisons between naive DB timestamps and timezone-aware objects are handled via defensive conversion, but reporting queries that parse date strings as local IST without timezone offsets risk a 5.5-hour query window shift at midnight.

---

## 7. TASK 6: Record Mutation & Audit Completeness

### 7.1 Post-Lock Mutation Matrix

| Mutation Path | Target File & Line | Lock Checked? | Audit Logged? | Downstream Sync? | Verdict |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **Session Deletion** | `teacher.py:1119` | **NO** | **NO** | **NO** | **`P0` Critical Vulnerability (`F-048`)** |
| **Approved Absence** | `compliance_analytics.py:355` | **NO** | **NO** | **NO** | **`P1` Post-Lock Mutation (`F-049`)** |
| **Teacher Manual Mark**| `teacher.py:420` | **YES** | **YES** | **YES** | Compliant (Rejects if locked) |
| **Student Scan** | `student.py:65` | **YES** | **YES** | **YES** | Compliant (Rejects if locked) |
| **Selfie Upload** | `attendance.py:1656` | N/A | **YES** | N/A | Compliant (Never alters status) |

### 7.2 Deletion & Cascade Integrity (`F-051 — P2`)
Inspection of `AttendanceRecord` in `models.py:241-275` confirms that **no database-level foreign key constraints exist on `student_id` or `session_id`**.
- Deleting a student record leaves orphaned `AttendanceRecord` rows in MySQL.
- Downstream export queries joining `AttendanceRecord` with `Student` omit orphaned rows, while aggregate count queries count them, resulting in divergent totals.

### 7.3 Idempotency Key Replay on Locked Sessions
- Replaying a valid `Idempotency-Key` for a student scan after the session is locked successfully returns the cached HTTP 200 response with header `Idempotent-Replay: true`.
- It does **not** re-execute the database write or alter attendance counts in MySQL.

---

## 8. TASK 7: Reconciliation & Drift Detection (The Gap Hunt)

### 8.1 Tooling Inventory Verdict
**ZERO reconciliation or drift-detection tooling exists (`F-045 — P1`).**
If a network hiccup or quota drop causes an export to fail, the divergence remains permanently undetected until semester exams.

### 8.2 Failure-Visibility Matrix

| Failure Mode | Teacher UI | Admin Alert | Application Log | Official Record Status |
| :--- | :---: | :---: | :---: | :--- |
| **Frappe Auth Expiry** | ❌ Nothing | ❌ Nothing | ⚠️ Warning Log | Diverged silently |
| **GSheets 429 Quota Drop** | ❌ Nothing | ❌ Nothing | ⚠️ Warning Log | Diverged silently |
| **Excel Win32 File Lock** | ❌ Nothing | ❌ Nothing | ⚠️ Warning Log | Diverged silently |
| **Post-Lock Session Delete** | ❌ Nothing | ❌ Nothing | ℹ️ Info Log | DB gone, downstream persists |
| **Transferred Student Mark** | ❌ Nothing | ❌ Nothing | ℹ️ Info Log | Dropped from Excel silently |

---

## 9. Reconciliation Tooling Specification (Architecture Spec Only)

To eliminate silent divergence between MySQL and the three downstream targets, this specification defines the **SNIST Multi-Target Attendance Reconciliation Engine**.

### 9.1 Architecture Overview

```
+-----------------------------------------------------------------------------------+
|                        SNIST RECONCILIATION ENGINE                                |
+-----------------------------------------------------------------------------------+
|  Trigger: Daily Cron (01:00 IST) OR Manual CLI: python -m app.tooling.reconcile   |
+-----------------------------------------------------------------------------------+
                                      |
         +----------------------------+----------------------------+
         |                            |                            |
         v                            v                            v
+------------------+         +------------------+         +------------------+
|  Frappe Auditor  |         |  GSheets Auditor |         |  Excel Auditor   |
+------------------+         +------------------+         +------------------+
| Read Parent Doc  |         | Read Sheet Col   |         | Read .xlsx Col   |
| Compare Children |         | Compare Matrix   |         | Compare Cells    |
+------------------+         +------------------+         +------------------+
         |                            |                            |
         +----------------------------+----------------------------+
                                      |
                                      v
                       +------------------------------+
                       |   Divergence Classifier      |
                       |  - MISSING_IN_TARGET         |
                       |  - EXTRA_IN_TARGET           |
                       |  - STATUS_MISMATCH           |
                       +------------------------------+
                                      |
                                      v
                       +------------------------------+
                       |   Repair Semantics Engine    |
                       |  - Frappe: Idempotent Push   |
                       |  - GSheets: Cell-level Patch |
                       |  - Excel: Atomic File Re-gen |
                       +------------------------------+
```

### 9.2 Target Comparison Keys

1. **Frappe ERP:**
   - **Parent Key:** `Attendance Session` DocType name = `session.id` or `session.session_code`.
   - **Child Key:** `Attendance Record` DocType joined on `student_sap_id` = `Student.sap_id`.
   - **Assertion:** For every `AttendanceRecord` with `status == PRESENT`, child row must exist with `status == "Present"`.
2. **Google Sheets:**
   - **Sheet Selection:** Workbook matching `TeacherAssignment(subject, section)`.
   - **Column Key:** Date cell in Header Row = `session.session_date` (`YYYY-MM-DD`) + Period.
   - **Row Key:** Column A / B containing `Student.roll_number`.
   - **Assertion:** Cell value at `(Row, Col)` matches `"P"`, `"A"`, or `"OD"`.
3. **Excel Registers:**
   - **File Path:** `backend/storage/registers/{assignment_id}.xlsx`.
   - **Column Index:** Matching `session.session_date` and period index.
   - **Row Index:** Matching `Student.roll_number`.
   - **Assertion:** Cell value equals `"P"` or `"A"`.

### 9.3 Divergence Classification & Repair Semantics

| Divergence Type | Cause | Automated Repair Action | Manual Review Escalation |
| :--- | :--- | :--- | :--- |
| **`MISSING_IN_TARGET`** | Background sync dropped on network failure or 429 quota | **Idempotent Push:** Execute single-row append or update to target | If target API repeatedly fails $\ge 3$ times, flag in Admin UI |
| **`EXTRA_IN_TARGET`** | Session or record was deleted in DB (`F-048`) | **Mark Stale:** Append suffix `[ORPHANED_IN_DB]` in target cell | Require HOD sign-off before row deletion in official ERP |
| **`STATUS_MISMATCH`** | Manual modification in target or approved absence override | **Source-of-Truth Overwrite:** DB status overwrites target | Audit logged with actor `RECONCILIATION_DAEMON` |

---

## 10. TASK 8 & 9: Report Correctness, Memory & Durability

### 10.1 Large-Export Truncation Hazard (`F-052 — P2`)
In `reports.py:41-42`, `fetch_filtered_records` limits output to 2,000 records:
```python
query.limit(2000).all()
```
For a department with 600 students across 60 semester sessions (36,000 records total), official semester Excel export queries **silently truncate at 2,000 records**, leaving 94.4% of the departmental data missing from the downloaded spreadsheet.

### 10.2 Database Durability & Backup (`F-046 — P1`)
- **No Automated Backup Procedures:** There are no automated backup scripts, dump crons, or replication health monitors in the repository.
- **Unversioned Schema Migrations (`F-053 — P2`):** Database schema updates are executed via ad-hoc `ALTER TABLE` statements in `main.py:_run_defensive_schema_migrations` during application startup, bypassing Alembic version tracking.

### 10.3 Selfie Storage Growth Projections
- **Daily Volume:** $10,000\text{ students} \times 6\text{ periods/day} = 60,000\text{ selfies/day}$.
- **Storage Rate:** At an average JPEG size of 60 KB:
  $$60,000 \times 60\text{ KB} = 3.6\text{ GB/day}$$
- **Semester Volume:** Over a 90-day semester:
  $$3.6\text{ GB/day} \times 90\text{ days} = \mathbf{324\text{ GB/semester}}$$
- **Finding:** No automated lifecycle policy or pruning cron exists to compress or archive selfie storage. Unmonitored disk growth will exhaust server storage within two academic semesters.

---

## 11. Findings Register (Phase 7 Tagged)

| Finding ID | Phase | Severity | Source Location | Description & Root Cause | Target Remediation |
| :--- | :---: | :---: | :--- | :--- | :--- |
| **`F-045`** | `PHASE7` | **`P1`** | `services/frappe_client.py:87`, `tooling/` | **Zero Multi-Target Reconciliation Tooling:** No automated drift detection exists; background export drops cause permanent undetectable divergence between DB, Frappe, Sheets, and Excel. | Phase 8 (Tooling) |
| **`F-046`** | `PHASE7` | **`P1`** | `ops/`, `backend/` | **Absence of MySQL Backup & Disaster Recovery Automation:** Legal institutional attendance records lack automated daily dump, offsite backup, or restore validation. | Phase 8 (Ops) |
| **`F-047`** | `PHASE7` | **`P1`** | `teacher.py:835-916` (`_async_full_session_sync`) | **Silent Export Drop on Network or 429 Quota Exhaustion:** Background export task catches exceptions with generic logging; no retry queue, teacher feedback, or admin alert. | Phase 8 (Reliability) |
| **`F-048`** | `PHASE7` | **`P0`** | `teacher.py:1119-1165` (`delete_session`) | **Post-Lock Session Deletion Permitted:** Faculty can delete `LOCKED` sessions; MySQL drops records while Frappe, Sheets, and Excel permanently retain them. | Phase 8 (Security) |
| **`F-049`** | `PHASE7` | **`P1`** | `compliance_analytics.py:355` | **Uncontrolled Post-Lock Approved Absence Mutation:** Admin can mutate `is_approved_absence` on records of locked sessions without lock validation or downstream resync. | Phase 8 (Integrity) |
| **`F-050`** | `PHASE7` | **`DECISION-NEEDED`** | `models/models.py:120` (`SessionStatus`) | **Session Lifecycle Lacks CANCELLED State:** Only `OPEN` and `LOCKED` exist. Mistaken sessions locked with zero attendance permanently pollute class denominators. | Institutional Policy |
| **`F-051`** | `PHASE7` | **`P2`** | `models/models.py:241` (`AttendanceRecord`) | **Missing Foreign Key Constraints on Attendance Records:** `AttendanceRecord` lacks DB-level FK on `student_id`; deleting students leaves dangling attendance rows. | Phase 8 (Database) |
| **`F-052`** | `PHASE7` | **`P2`** | `api/reports.py:41` (`fetch_filtered_records`) | **Hard 2,000 Record Truncation on Excel Exports:** Departmental semester reports exceeding 2,000 records are silently truncated without pagination or warning. | Phase 8 (Reports) |
| **`F-053`** | `PHASE7` | **`P2`** | `main.py:36-270` | **Ad-Hoc Startup DDL Migrations Without Alembic Tracking:** Schema modifications run via raw `ALTER TABLE` at startup rather than version-controlled Alembic migrations. | Phase 8 (Migrations) |
| **`F-054`** | `PHASE7` | **`P1`** | `attendance_engine.py`, `reports.py`, `student.py` | **Three-Way Mathematical Disagreement Across Percentage Engines:** Conflicting formulas, decimal precision (1 vs 2), zero-session values, and approved-absence handling. | Phase 8 (Math Engine) |
| **`F-055`** | `PHASE7` | **`P1`** | `services/register_service.py:79` | **Stale Excel Register Roster Gap:** Registers are pre-generated once; section-transferred or late students are missing from row indices and their marks are dropped. | Phase 8 (Excel) |
| **`F-056`** | `PHASE7` | **`P2`** | `services/excel_service.py:249` | **Direct Non-Atomic Overwrite of Excel Register Files:** `wb.save` writes directly over live workbook; process termination mid-save corrupts official registers. | Phase 8 (Storage) |
| **`F-057`** | `PHASE7` | **`P2`** | `services/telemetry_rollup.py:41` | **UTC Date Shift in Telemetry Rollup Between 00:00 and 05:30 IST:** Rollup uses `utcnow().strftime("%Y-%m-%d")`, aggregating scans into previous day's bucket. | Phase 8 (Timezone) |

---

## 12. Institutional Policy Decisions Register (`DECISION-NEEDED`)

The following policy issues require formal resolution by the Academic Council and SNIST Administration:

1. **`[DECISION-NEEDED]` Rounding & Decimal Precision Policy (JNTUH R25):**
   - *Current Behavior:* `AttendanceEngine` uses 2 decimal places (`74.96%`); `reports.py` rounds to 1 decimal place (`75.0%`).
   - *Issue:* A student with 74.96% is classified as **CONDONABLE** by the compliance engine but **ELIGIBLE** by reports.
   - *Policy Choice:* Does JNTUH mandate standard mathematical rounding (half-up) to 2 decimals, or strict mathematical truncation?
2. **`[DECISION-NEEDED]` Institutional Definition of LATE Marks:**
   - *Current Behavior:* LATE status receives **0.0 credit (treated as ABSENT)** across all engines.
   - *Policy Choice:* Should LATE marks grant partial attendance (e.g., 0.5 session credit), full attendance, or continue to count as absent?
3. **`[DECISION-NEEDED]` Approved Absence Calculation Mode:**
   - *Current Behavior:* When `JNTUH_INCLUDE_APPROVED_ABSENCES=true`, approved absences are subtracted from the denominator ($\text{conducted} - \text{approved}$).
   - *Policy Choice:* Should approved absences reduce the denominator or add directly to the attended numerator?
4. **`[DECISION-NEEDED]` Cancelled Session Lifecycle & Denominator Policy:**
   - *Current Behavior:* Teachers have no way to mark a session as `CANCELLED`. Locking an accidental session dilutes the denominator.
   - *Policy Choice:* Should a `CANCELLED` status be added to `SessionStatus`, and should cancelled sessions be completely excluded from compliance calculations?

---

## 13. Exit Criteria Verification

| Exit Criterion | Status | Empirical Evidence / Verification File |
| :--- | :---: | :--- |
| **Write/read matrix complete; every export proven to read from DB** | **`PASS`** | Section 2; verified in `test_phase7_data_integrity.py::TestTask1SourceOfTruthMap`. |
| **Export failure matrix: all 3 targets tested with mocks** | **`PASS`** | Section 3; verified in `test_phase7_data_integrity.py::TestTask2LockSessionExportTransactionality`. |
| **Export idempotency (retry-no-duplicates) verified per target** | **`PASS`** | Section 3.2; verified in `test_export_idempotency_relock_dedup`. |
| **Late-record-after-lock export behavior tested (snapshot semantics)**| **`PASS`** | Section 3.3; verified in `test_late_record_after_lock_race_handling`. |
| **Agreement property test executed across ALL percentage engines** | **`PASS`** | Section 5.2; verified in `test_agreement_property_between_implementations`. |
| **All 10 math edge cases (a–j) executed with concrete numbers** | **`PASS`** | Section 5.3; verified in `test_math_edge_case_*` suite (10/10 executed). |
| **Boundary-precision case computed: float misclassification reachable** | **`PASS`** | Section 5.3; verified in `test_math_edge_case_e_boundary_precision_float_analysis`. |
| **IST boundary fixtures (23:59/00:01) tested for session date & rollup**| **`PASS`** | Section 6; verified in `test_ist_midnight_boundary_fixtures`. |
| **Post-lock mutation matrix complete; ML-flip path traced** | **`PASS`** | Section 7; verified in `test_post_lock_session_deletion_allowed` & `test_facial_verification_never_flips_present_to_absent`. |
| **CANCELLED-session workflow gap documented (`DECISION-NEEDED`)** | **`PASS`** | Section 12; documented as Finding `F-050`. |
| **Reconciliation tooling verdict + complete checker spec delivered** | **`PASS`** | Section 9; full architectural specification delivered. |
| **Backup/durability findings recorded with recommendations** | **`PASS`** | Section 10; Findings `F-046`, `F-052`, `F-053` recorded. |
| **Production code untouched except test files** | **`PASS`** | No modifications made to `backend/app/` or `frontend/src/`. |
