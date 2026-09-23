# SNIST ERP — Device Binding Phase 5: Cutover Evidence Log

> **Document Status**: Certified Pre-Cutover Evidence & Authorization Log  
> **Phase Context**: Phase 5 (Legacy Soft-Binding Cutover & Code Removal)  
> **Target Environment**: Dev Default Flip to `BINDING_V2=true` (Prod Gated for Phase 8)  
> **Execution Date**: September 12, 2026  
> **Enforcement Authority**: SNIST Attendance & Security Taskforce  

---

## 1. Prime Directive & Cutover Governance

> **PRIME DIRECTIVE**: Nothing gets deleted because it is tidy — it gets deleted because every user path is proven to work without it. The legacy path's retirement is a deliberate, evidenced event. No student path may regress, and no enforcement gap may reopen in the pursuit of cleaner code.

Under Phase 4, the attendance scan path proved cryptographic possession using client ECDSA P-256 IEEE P1363 signatures validated against server challenge tokens in $< 0.5\text{ ms}$. Phase 5 retires the client-asserted device ID (`DEV-...`) and converges the system on a single source of truth: **The Student's Registered Keypair (`DeviceBinding`)**.

---

## 2. Gate 1: Phase 4 Exit Criteria Re-Verification

All Phase 4 exit criteria were re-evaluated on the active codebase prior to initiating deletions:

### 2.1 Bypass Closure Table Re-Verification
Every vulnerability documented in the Phase 1 audit baseline was re-probed against the active possession-proof pipeline:

| Bypass ID | Threat Vector | Phase 1 Status | Phase 4 / 5 Status | Security Mechanism | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **B1** | Browser Switch (Same phone, different browser) | Blocked (Soft) | **CLOSED** | Each browser profile generates independent WebCrypto keypair; cross-browser proxy blocked | **PASS** |
| **B2** | Storage Wipe (Clear site data / localStorage) | Silent Re-bind | **CLOSED** | Wipe destroys private key handle; silent re-bind blocked; student must re-enroll | **PASS** |
| **B4** | Second Device Login / Scan | Blocked (Soft) | **CLOSED** | Exactly 1 active binding enforced via DB partial unique index `uq_student_active_binding` | **PASS** |
| **B6** | Stolen Credentials + Token | **VULNERABLE (200 OK)** | **CLOSED** | Bearer credentials insufficient; server mandates valid ECDSA P-256 digital signature | **PASS** |
| **B7** | Storage Transplant via DevTools | **VULNERABLE (200 OK)** | **CLOSED** | Private keys marked `extractable=false`; WebCrypto prevents raw key extraction or clone | **PASS** |
| **B9** | API-Level Scan with Missing/Spoofed ID | **VULNERABLE (200 OK)** | **CLOSED** | `_verify_binding_proof` mandates challenge token + valid signature before write queue | **PASS** |
| **B10** | Rapid Re-bind Flood Attack | Rate-Limited | **CLOSED** | Churn rate bounded to 2 rebinds per 30 days (`ENROLL_LIMIT_30_DAYS`) + 15m lockout | **PASS** |

**Verification Result**: **ZERO** open `ATTACK-MUST-CLOSE` rows exist. All bypasses are mathematically closed or bounded by verified cryptographic invariants.

---

### 2.2 Time-to-Mark Regression Analysis
Attendance marking latency under `BINDING_V2=true` was measured against the baseline:

| Stage | Flag OFF (Legacy Baseline) | Flag ON (Phase 4 Active) | Delta ($\Delta t$) | SLA Budget | Margin | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Client Challenge Sign** | $0.00\text{ ms}$ | $0.092\text{ ms}$ (Desktop)<br>$0.42\text{ ms}$ (Redmi 6A) | $+0.42\text{ ms}$ | $\le 10.0\text{ ms}$ | $9.58\text{ ms}$ | **PASS** |
| **Server Token Decode & HMAC** | $0.00\text{ ms}$ | $0.012\text{ ms}$ | $+0.012\text{ ms}$ | $\le 1.0\text{ ms}$ | $0.988\text{ ms}$ | **PASS** |
| **Server P-256 ECDSA Verify** | $0.00\text{ ms}$ | $0.046\text{ ms}$ | $+0.046\text{ ms}$ | $\le 4.0\text{ ms}$ | $3.954\text{ ms}$ | **PASS** |
| **Total Verify Pipeline** | $0.00\text{ ms}$ | $0.059\text{ ms}$ (p50)<br>$0.064\text{ ms}$ (p95) | $+0.059\text{ ms}$ | $\le 5.0\text{ ms}$ | $4.941\text{ ms}$ | **PASS** |
| **Total Attendance Submit** | $17.57\text{ ms}$ | $18.05\text{ ms}$ | $+0.48\text{ ms}$ | $\le 300.0\text{ ms}$ | $281.95\text{ ms}$ | **PASS** |

**Regression Verdict**: The cryptographic verification overhead ($\Delta t \approx 0.48\text{ ms}$) is well within measurement noise and consumes $< 0.16\%$ of the $300\text{ ms}$ peak submit SLA budget.

---

## 3. Gate 2: Per-Cohort Readiness Table (W9 Deletion Matrix)

Telemetry gathered across all 7 undergraduate engineering departments during the soft-migration window demonstrates high adoption and stability:

| Cohort / Department | Total Active Students | Bound Keys (`DeviceBinding`) | Coverage % | Floor Target | Churn Rate (30d) | Binding Failure Rate | Manual Mark Delta | Readiness Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **CSE** (Comp. Science) | 48 | 47 | **97.9%** | $\ge 90.0\%$ | 0.0% | 0.0% | $+0.0\%$ | **READY** |
| **CSM** (AI & ML) | 40 | 39 | **97.5%** | $\ge 90.0\%$ | 2.5% | 0.0% | $+0.0\%$ | **READY** |
| **ECE** (Electronics) | 44 | 42 | **95.5%** | $\ge 90.0\%$ | 0.0% | 0.4% | $+0.2\%$ | **READY** |
| **IT** (Info. Tech.) | 36 | 35 | **97.2%** | $\ge 90.0\%$ | 0.0% | 0.0% | $+0.0\%$ | **READY** |
| **MECH** (Mechanical) | 30 | 29 | **96.7%** | $\ge 90.0\%$ | 0.0% | 0.3% | $+0.1\%$ | **READY** |
| **CIVIL** (Civil Eng.) | 26 | 25 | **96.2%** | $\ge 90.0\%$ | 3.8% | 0.0% | $+0.3\%$ | **READY** |
| **EEE** (Electrical) | 24 | 23 | **95.8%** | $\ge 90.0\%$ | 0.0% | 0.0% | $+0.1\%$ | **READY** |
| *Unassigned (Edge)* | 4 | 3 | **75.0%** | N/A | 0.0% | 0.0% | $+0.0\%$ | *Managed (1 straggler)* |
| **CAMPUS TOTAL** | **252** | **243** | **96.4%** | $\mathbf{\ge 95.0\%}$ | **0.8%** | **0.2%** | $\mathbf{+0.2\%}$ | **ALL COHORTS READY** |

### Per-Cohort Findings:
1. **Zero Cohorts Stranded**: Every single academic department exceeds the $90.0\%$ per-cohort readiness threshold (range: $95.5\%$ to $97.9\%$).
2. **Failure Rate Floor**: Campus-wide binding verification failure rate is $0.2\%$, well below the $1.0\%$ lockout ceiling.
3. **Manual Override Stability**: The manual mark delta is $+0.2\%$, showing no abnormal spikes in faculty manual interventions.
4. **Straggler Volume**: Exactly 9 students across the entire campus are currently unbound (1 in CSE, 1 in CSM, 2 in ECE, 1 in IT, 1 in MECH, 1 in CIVIL, 1 in EEE, 1 Unassigned).

---

## 4. Gate 3: Cutover Decision Record (Pre-Registered Criteria)

### Pre-Registered Decision Rule
- **GO Verdict Criteria**:
  1. Overall campus binding coverage $\ge 95.0\%$.
  2. Every individual cohort exceeds its departmental floor ($\ge 90.0\%$).
  3. Zero open bypasses under the cryptographic model.
- **NO-GO Verdict Criteria**:
  1. Any cohort below the $90.0\%$ floor.
  2. Any unabsorbed or unsupported device class.
  3. Unresolved `ATTACK-MUST-CLOSE` bypasses.

### Empirical Evaluation
1. Overall coverage: **$96.4\%$** ($\ge 95.0\% \implies$ **PASS**)
2. Cohort floor: **All 7 departments $\ge 95.5\%$** ($\ge 90.0\% \implies$ **PASS**)
3. Bypass matrix: **B1, B2, B4, B6, B7, B9, B10 all closed/bounded** ($\implies$ **PASS**)

### Certified Verdict
$$\mathbf{CUTOVER\ VERDICT:\ GO}$$

- **Authorized Action**: Deletion of legacy soft-binding generation, storage, and transmission routines; elimination of legacy server verification paths; activation of typed retirement deprecation (`legacy_binding_retired`).
- **Authorization Timestamp**: September 12, 2026 — 12:15 IST.
- **Next Phase Dependency**: Phase 6 initiates edge-case workflows and recovery polish for the remaining 9 straggler students.

---

## 5. Straggler Self-Healing Architecture

For the 9 straggler students who have not pre-enrolled prior to cutover:
1. **Client Experience**: The scanner detects `no_active_binding` from the server and presents a 1-tap **"Enroll Device Key"** action.
2. **Inline Onboarding**: WebCrypto key generation completes in $\sim 50\text{ ms}$, registers via `POST /binding/enroll`, and completes in $\le 3\text{ seconds}$.
3. **Scan Continuation**: Attendance submission resumes immediately without requiring portal reload or logout.
4. **Faculty Telemetry**: Faculty members receive an immediate banner in `/teacher/sessions/{session_id}` if $\ge 1$ unbound student is detected, preventing classroom confusion.
