# SNIST ERP — Compliance Operations Runbook
## Week 3: Defaulter Lists, Trajectory Projections & Early-Warning Interventions

**Audience**: Deans, Heads of Department (HODs), Faculty In-Charges, Examination Cell, Compliance Officers  
**Regulatory Standard**: JNTUH R25 Attendance Regulations  
**Version**: 3.0.0 (Compliance Module Feature 2)

---

## 1. Executive Overview: The Three Beats of Compliance

The compliance module operationalizes institutional regulatory governance across three distinct stages:

```
  ┌─────────────────┐       ┌─────────────────┐       ┌──────────────────┐
  │   1. DETECT     │  ───> │   2. PROJECT    │  ───> │   3. INTERVENE   │
  │ Current Band    │       │ Honest Trajectory│       │ Immutable Warning│
  │ Eligible >= 75% │       │ Sessions Needed │       │ Evidence Pack    │
  │ Condonable 65-74│       │ Rapid Decline   │       │ Recovery framed  │
  │ Detained < 65%  │       │ NOT RECOVERABLE │       │ Condonation Track│
  └─────────────────┘       └─────────────────┘       └──────────────────┘
```

1. **DETECT**: Real-time server-authoritative classification of current percentage into JNTUH R25 bands.
2. **PROJECT**: Honest mathematical calculation of where the student will land by semester end.
3. **INTERVENE**: Formal, immutable warning issuance logged for JNTUH and NBA accreditation evidence, paired with empathetic recovery paths visible to the student.

---

---

## 2. JNTUH R25 Regulatory Standards & Rounding Protocol

### 2.1 Boundary Definitions
The percentage engine strictly enforces JNTUH R25 band boundaries:

| Band Code | Classification | Boundary Threshold | Displayed Boundary Example | Institutional Regulatory Implication |
| :--- | :--- | :--- | :--- | :--- |
| **ELIGIBLE** | Compliant | $\ge 75.00\%$ | `75.00%` &rarr; `ELIGIBLE` | Permitted for End-Semester Examinations (ESE). |
| **CONDONABLE** | Shortage with Fine | $65.00\% - 74.99\%$ | `74.99%` &rarr; `CONDONABLE`<br>`65.00%` &rarr; `CONDONABLE` | Requires approved medical/duty certificate + condonation fine. |
| **DETAINED** | Severe Deficit | $< 65.00\%$ | `64.99%` &rarr; `DETAINED` | Strictly detained from ESE; repeat semester required. |
| **INSUFFICIENT_DATA** | Orientation Phase | $< 3\text{ sessions held}$ | `0.00%` &rarr; `INSUFFICIENT_DATA` | Graceful empty-state; suppresses false detention alarms. |
| **NO_DATA** | Uncommenced | $0\text{ sessions held}$ | `—` (em-dash, never `0.00%`) | Course has not held any recorded classes yet. |

### 2.2 Canonical Rounding Rule (Pre-Banding Rounding)
> [!IMPORTANT]
> **Display-vs-Band Consistency Guarantee**:
> Percentages are mathematically rounded to two decimal places **BEFORE** band assignment:
> $$p = \text{round}(\text{raw\_percentage}, 2)$$
> A displayed `75.00%` will **NEVER** band as `CONDONABLE`.
> For example: an attendance of $\frac{7499}{10000} = 74.9900\%$ bands as `CONDONABLE`, while an attendance of $\frac{74996}{100000} = 74.996\% \approx 75.00\%$ bands as `ELIGIBLE` and displays as `75.00%`.

### 2.3 First-Week Empty State (<3 Sessions Held)
To prevent destroying student and parent trust in week 1 of a semester, courses with fewer than 3 sessions held:
- Do **NOT** assign `DETAINED` or `CONDONABLE`.
- Classify as `INSUFFICIENT_DATA` with a neutral informational badge.
- Suppress `classes_needed` to 0 and hide alarming warning alerts.
- Are excluded from defaulter rosters until meaningful classroom data exists ($\ge 3$ sessions).

### 2.4 Unassigned-Department Reconciliation
Students enrolled without an assigned department code are never dropped from institutional calculations:
$$\sum (\text{Department Counts}) + \text{Unassigned Count} = \text{Total Enrolled (252 Students)}$$

---

## 3. Chapter: Defaulters & Early-Warning Trajectory

### 3.1 Honest Trajectory Projection Formula
To prevent false hope or optimistic rounding, the system computes the projected end percentage assuming **only current attendance is guaranteed**:

$$\text{Projected End \%} = \frac{\text{Current Sessions Present}}{\text{Sessions Held} + \text{Sessions Remaining}} \times 100$$

The maximum possible attendance ceiling (if the student attends 100% of remaining classes) is separately calculated as:

$$\text{Max Possible \%} = \frac{\text{Current Sessions Present} + \text{Sessions Remaining}}{\text{Sessions Held} + \text{Sessions Remaining}} \times 100$$

### 3.2 Classes Needed Calculation
To determine the minimum consecutive classes a student must attend to cross the $75.00\%$ threshold:

$$\text{Classes Needed} = \left\lceil \frac{0.75 \times (\text{Sessions Held} + \text{Sessions Remaining}) - \text{Sessions Present}}{0.25} \right\rceil$$

- **Recoverable Case**: If $\text{Classes Needed} \le \text{Sessions Remaining}$, the student is flagged as `RECOVERABLE`.
- **Not Recoverable Case (`NOT_RECOVERABLE`)**: If $\text{Classes Needed} > \text{Sessions Remaining}$, reaching $75.00\%$ is mathematically impossible. The system flags this as `NOT_RECOVERABLE` and caps $\text{Classes Needed}$ to remaining sessions. This signals an inevitable detention trajectory requiring immediate condonation filing or remedial counseling.

### 3.3 Rapid Decline Trend Signal (`RAPID_DECLINE`)
A student may have an aggregate of $78\%$ but be rapidly collapsing. The system evaluates the student's certified fortnightly snapshots:
- If $\Delta \% \le -5.0\%$ in period $N-1$ **AND** $\Delta \% \le -5.0\%$ in period $N$, the student is flagged as **`RAPID_DECLINE`**.
- This surfaces early warning alerts in Week 6–8 rather than discovering detention at Week 16.
- Certified snapshots prevent false positives on stable/perfect attendance.

### 3.4 One-Click Excel Register Export
Faculty and HODs can export official registers conforming to the SNIST format via:
- Endpoint: `GET /api/v1/defaulters/export?course_id={course_id}&band_filter={filter}`
- Output: `.xlsx` file formatted with department, semester, student roll numbers, names, present/held sessions, percentages, JNTUH bands, and trajectory flags.

---

## 4. Chapter: Warning Issuance & Immutable Evidence Trail

### 4.1 Faculty Warning Issuance Workflow
1. Navigate to **Teacher Dashboard &rarr; Defaulter Lists & Alerts**.
2. Select assigned course and view the filterable roster (`ALL`, `BELOW_75`, `CONDONABLE`, `DETAINED`, `RAPID_DECLINE`, `NOT_RECOVERABLE`).
3. Click **Issue Warning** on any defaulter student.
4. A confirmation modal displays the **exact snapshot numbers** that will be frozen:
   - Current percentage (e.g. $60.00\%$)
   - Current band (e.g. `DETAINED`)
   - Classes needed (e.g. 6 consecutive classes)
   - Sessions held and present
5. Select severity:
   - `FIRST_WARNING` (Advisory & Guidance)
   - `FORMAL_WARNING` (Condonable Shortage)
   - `FINAL_DETENTION_NOTICE` (Critical Detention Notice)
6. Enter guidance message and optionally toggle parent notification.
7. Click **Sign & Issue Warning Snapshot**.

### 4.2 Immutability Principle
Once issued, the `StudentWarning` record in `qr_student_warnings` is permanently frozen. Even if the student subsequently attends 20 classes and reaches $85\%$, the warning record retains its historical snapshot numbers ($60.00\%$, 6 classes needed). This serves as tamper-evident proof for JNTUH inspection committees and NBA criterion 2 audits.

### 4.3 Student PWA Recovery Experience
In adherence to the **Empathy Rule for Copy**, the student portal frames attendance shortages around action, not condemnation:
- **Recovery Banner**: *"Attend 4 more consecutive classes in Operating Systems to reach 75% compliance."*
- **Orientation Banner**: *"Semester Underway: Classes in Progress (Orientation Phase) — Formal band compliance begins after initial 3 sessions."*
- **Detention Advisory**: *"With remaining sessions, attendance cannot reach 75%. Please meet your Academic Counselor immediately to discuss condonation eligibility."*

---

## 5. Chapter: Condonation Tracking & Governance (65.00%–74.99% Band)

### 5.1 Condonation State Machine & HTTP 422 Rejection
Students falling between $65.00\%$ and $74.99\%$ are eligible for condonation on genuine medical or institutional duty grounds. Status changes follow a strictly validated state machine:

```
  [ pending ]  ───>  [ applied ]  ───>  [ approved ]  ───>  [ fine_paid ]
       │                  │                  │
       v                  v                  v
  [ waived / rej ]   [ waived / rej ]   [ waived / rej ]
```

- `pending` &rarr; Student enters condonable band; awaiting documentation.
- `applied` &rarr; Medical certificate or duty letter submitted.
- `approved` &rarr; Principal / HOD committee approves condonation request.
- `fine_paid` &rarr; Prescribed condonation fine receipt verified in accounts (Terminal).
- `waived` &rarr; Institutional duty waiver (NSS/NCC/Sports) approved by Dean (Terminal).
- `rejected` &rarr; Documentation found invalid (Terminal).

> [!WARNING]
> Any invalid transition (such as attempting `rejected` &rarr; `applied` or `fine_paid` &rarr; `pending`) is strictly rejected by the server with **HTTP 422 (Unprocessable Entity)**. All transitions are logged with `old_status -> new_status` and `old_fine -> new_fine` in `qr_audit_logs`.

---

## 6. Chapter: Weekly HOD Digest & Ops Guardrails

### 6.1 Automated Digest Summary & PII Protection
- Dispatches a weekly compliance digest to department HODs containing:
  - Department eligible / condonable / detained counts
  - `RAPID_DECLINE` watchlist students
  - `NOT_RECOVERABLE` detention trajectory students
- **Zero Student PII Leakage**: Emails contain student Roll Number and percentage only (`22071A0501 (62.50%)`). Phone numbers, home addresses, and personal emails are never transmitted.
- Global email rate limit: Capped at **150 emails/hour** on the background worker budget.

### 6.2 Idempotency Guarantee
The digest generation records a date-scoped audit log: `HOD_WEEKLY_DIGEST_DISPATCH` for `date:{YYYY-MM-DD}`. Re-running the digest on the same day returns `SKIPPED_ALREADY_SENT` with 0 duplicate emails.

---

## 7. Post-Deploy Verification Checklist (Production Gate)

After deploying to production (`ather-os.de5.net`):
1. **Reconciliation Audit**:
   - Query `GET /api/v1/admin/analytics/attendance-summary`.
   - Verify: $\sum (\text{eligible} + \text{condonable} + \text{detained}) + \text{no\_data} = 252$ enrolled students.
2. **5-Student Spot Check**:
   - Cross-verify 5 randomly chosen students against their raw sessions:
     $$\text{Calculated \%} = \frac{\sum \text{Present Periods}}{\sum \text{Effective Conducted Periods}} \times 100$$
   - Confirm that the displayed percentage matches the calculated percentage to 2 decimal places.
3. **Scan-Path Concurrency Verification**:
   - Run burst smoke test: 200 scans over 10 seconds.
   - Confirm average scan latency remains under 35ms with zero impact from background compliance queries.

---

## 8. Rollback & Downgrade Procedure

If unexpected issues occur during deployment:
```bash
# 1. SSH into the server / open terminal
cd /path/to/att2

# 2. Roll back Alembic migration to previous stable revision
python -m alembic downgrade -1

# 3. Restart the FastAPI service
docker compose restart backend
# or systemctl restart snist-backend

# 4. Verify system health
curl -f https://ather-os.de5.net/health
```

---

## 9. QR Scan Funnel Telemetry & Scanner Health Forensics

### 9.1 Overview & Access
- The **Scanner Health** tab is located in the Super Admin Dashboard (`/admin`).
- Accessible exclusively by users with `SUPER_ADMIN` or `TEACHER` roles.
- Displays headline conversion rates, latency percentiles ($p_{50}$ and $p_{95}$), drop-off waterfall funnels, failure matrix across device tiers (`old`, `mid`, `new`), and high-manual classroom sessions.

### 9.2 Daily Rollup & Retention Maintenance
Raw telemetry events (`qr_scan_telemetry_events`) have a 30-day retention policy. Daily summaries are permanently stored in `qr_scan_telemetry_daily_rollup`.

To trigger rollup and purge on demand:
```bash
# Via cURL (Super Admin token required)
curl -X POST https://ather-os.de5.net/api/v1/telemetry/trigger-rollup \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"days_back": 3}'

# Or run the offline simulation/rollup script
python scripts/simulate_baseline_telemetry.py
```

### 9.3 Diagnosing High-Manual Sessions
If the **Manual Override Rate** exceeds the 15% threshold:
1. Inspect the **Manual Fallback Forensics** panel in the Scanner Health tab.
2. Locate the flagged session ID(s) and check the **Failure Matrix by Device Tier**.
3. If `decode_timeout` or `camera_open_timeout` dominates, inspect the student device distribution (high concentration of budget phones with $\le 2$GB RAM).
4. Direct affected students to clear browser cache and ensure ambient lighting in classroom before next session.

### 9.4 Faculty Operations: Display Medium Selection (`display_type`)
When starting an attendance session in the **Teacher Dashboard** (`/teacher`), faculty members are presented with a **Display Medium** selector next to the class parameters:
- **Projector (Default & Recommended)**: Select when projecting the rotating QR onto a classroom projection screen or large smart board. Optimized for high-contrast viewing at 2.5m–5.0m. All lectures with more than 15 students MUST use this mode to prevent hallway or podium congestion.
- **Phone Screen**: Intended exclusively for small lab batches or remedial sessions (≤15 students) where faculty show the QR on their personal mobile screen at close range (15cm–30cm). Faculty must ensure screen brightness is set to maximum.
- **Laptop**: Select when displaying the QR on a faculty laptop screen on the front podium.

*Telemetry Attribution*: The selected medium is transmitted in the session metadata and tagged on every student scan attempt, enabling administrators to isolate optical display issues from device hardware bottlenecks in the Scanner Health dashboard.

### 9.5 Week 2 Bounded Quick-Win Operations & Rollback Runbook
All Week 2 quick wins operate under defensive isolation behind feature toggles or non-breaking fallbacks:

1. **Quick Win C.1 — Camera Permission Explainer & Recovery**:
   - *Why*: Reduces cold-start permission denials by educating students on the institutional purpose before triggering the OS prompt, and provides step-by-step browser setting recovery links upon denial.
   - *Rollback*: Handled client-side; clearing the state in `StudentClassScannerModal.tsx` reverts directly to native browser prompt without restarting servers.
2. **Quick Win C.2 — Server Token Grace Window (3.0s)**:
   - *Why*: Eliminates false-positive `token_expired` rejections for budget phones whose 5s–7s camera/decode latency lands across the 10-second TOTP rotation boundary.
   - *Config Flag*: `TOKEN_GRACE_SECONDS` in `backend/app/core/config.py` (default `3.0`).
   - *Rollback*: Set `TOKEN_GRACE_SECONDS=0.0` in the environment (`.env`) or systemd environment file and restart backend (`sudo systemctl restart snist-attendance`). Takes effect instantaneously without DB changes.
3. **Quick Win C.3 — Camera Constraint Fallback Ladder**:
   - *Why*: Prevents `OverconstrainedError` and HAL initialization crashes on low-end cameras by attempting Rung 1 (`ideal: 1280`), then gracefully degrading to Rung 2 (`640×480` VGA), and finally Rung 3 (`video: true`).
   - *Rollback*: In `StudentClassScannerModal.tsx`, revert the `getMediaStreamWithFallback` array to a single static constraints object.
4. **Quick Win C.4 — Decode Loop Soft Restart (5.0s)**:
   - *Why*: Automatically steadies and restarts the image capture loop when a scan stalls for 5 seconds, salvaging focus hunting on old devices without requiring the user to dismiss and re-open the modal.
   - *Rollback*: In `StudentClassScannerModal.tsx`, remove the timer callback triggering `restartScanLoop()`.

### 9.6 Week 3 Short-Token Operations & Faculty/Admin Guide
**Faculty & Administrator Briefing**: Starting Week 3, the attendance system generates an ultra-compact "slim" QR payload (`?s=...&v=...`) rendered at Error Correction Level M. **Zero user-facing workflows change**: faculty start sessions and project the rotating QR from the Teacher Dashboard (`/teacher`) exactly as before, and students scan using their existing camera scanner modal (`/student`). The sole physical difference is that the on-screen QR code has 69% fewer modules (25×25 vs 45×45 grid), appearing visibly cleaner and allowing students seated in the middle and back rows (3.0m–4.5m) or using budget smartphones (≤2GB RAM, low-aperture cameras) to scan instantly without walking up to the projector screen. The backend operates in a 100% backward-compatible dual-format mode, concurrently accepting legacy 96-character tokens and new short codes without requiring immediate app updates.

---
*Generated for SNIST ERP Academic Compliance & Telemetry Operations.*
