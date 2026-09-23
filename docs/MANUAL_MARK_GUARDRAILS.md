# Manual-Mark Guardrails & Anti-Proxy Security Specification

**System**: SNIST ERP Attendance Engine  
**Component**: Faculty Manual Override & Institutional Audit Framework  
**Specification Version**: 8.0 (Week 8 Release)  
**Security Classification**: Tier-1 Institutional Compliance  

---

## 1. Threat Model & Design Objectives

Manual attendance marking is the necessary 5th rung of the degradation ladder when optical, hardware, or student-device failures occur. However, unconstrained manual marking introduces severe institutional vulnerabilities:
1. **Proxy Attendance via Social Engineering**: Students asking faculty to mark absent peers.
2. **Bulk Faculty Overrides**: A teacher bypassing the dynamic QR projector entirely by marking an entire class manually.
3. **Audit Trail Blindspots**: Unaudited attendance modifications that cannot be defended during university or regulatory reviews.
4. **Unauthorized Cross-Class Marking**: A faculty member accidentally or maliciously marking students in another teacher's active session.

The **Manual-Mark Guardrails System** enforces mandatory reason classification, per-session rate limiting, automated anomaly scoring, role isolation, and pervasive `(M)` audit tagging across all registers and reports.

---

## 2. Guardrail Architecture Overview

```mermaid
flowchart TD
    Req([Faculty Initiates Manual Mark]) --> AuthCheck{Assigned Teacher or Admin?}
    AuthCheck -- No --> Reject403[HTTP 403 Forbidden<br/>Cross-Teacher Mark Disallowed]
    AuthCheck -- Yes --> ReasonCheck{Valid Reason Enum Supplied?<br/>scanner_failed | device_lost | late_join | other}
    ReasonCheck -- No / Missing --> Reject422[HTTP 422 Unprocessable Content<br/>Mandatory Reason Required]
    ReasonCheck -- Yes --> VolCheck{Session Manual Count >= 25?}
    VolCheck -- Yes and No Confirm --> Reject428[HTTP 428 Precondition Required<br/>High-Volume Confirmation Modal]
    VolCheck -- Confirmed or < 25 --> RecordDB[(Write AttendanceRecord with<br/>manual_reason, manual_marked_by_id)]
    RecordDB --> WriteAudit[(Write Institutional AuditLog<br/>attendance_manual_marked)]
    WriteAudit --> CalcAnomaly[Calculate Anomaly Status<br/>Green < 15% | Amber >= 15% | Red >= 30%]
    CalcAnomaly --> TagRegister[Emit (M) Badge on UI & Reports]
```

---

## 3. Mandatory Reason Enumeration Specification

Manual marks require an explicit, audited operational justification. Free-text reason fields are prone to empty entries or non-standard entries (`"as requested"`, `"ok"`).

### 3.1 Supported Enums
| Enum Value | UI Label | Operational Scenario | Required Details |
|:---|:---|:---|:---|
| `scanner_failed` | `[ Scanner Failed ]` | Student device had camera driver crash, lens damage, or persistent decode failure on Rung 1–4. | None (standard optical fallback). |
| `device_lost` | `[ Device Lost ]` | Student has no smartphone in class (dead battery, forgotten device, broken screen). | None. |
| `late_join` | `[ Late Join ]` | Student entered after QR rotation window expired with verified faculty approval. | Optional notes. |
| `other` | `[ Other Reason ]` | Exceptional administrative circumstance (e.g., student transfer, special accommodation). | Recommended note in `manual_reason_detail`. |

### 3.2 Backend Validation Rule
The endpoint `POST /api/v1/attendance/manual-mark` validates the payload:
```python
VALID_MANUAL_REASONS = {"scanner_failed", "device_lost", "late_join", "other"}

if not payload.reason or payload.reason not in VALID_MANUAL_REASONS:
    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail=f"Valid reason is required for manual attendance. Must be one of: {sorted(VALID_MANUAL_REASONS)}",
    )
```
Omitting the `reason` attribute or supplying an unrecognized string triggers an immediate `HTTP 422` rejection.

---

## 4. Rate-Limit Cap (25 Marks per Session)

To prevent teachers from circumventing the QR projection system and marking an entire lecture room manually, the engine enforces a default hard cap:
- **Default Threshold**: `MANUAL_MARK_MAX_PER_SESSION_CAP = 25` (configurable via `core/config.py`).

### Enforcement Flow:
1. When a faculty member attempts to manually mark a student, the server counts existing manual marks in the target session:
   ```sql
   SELECT COUNT(*) FROM attendance_records
   WHERE session_id = :session_id AND is_manual = 1;
   ```
2. If `existing_manual_count >= 25` and the payload does not contain `confirm_high_volume: true`:
   - The server rejects the request with **`HTTP 428 Precondition Required`**:
     ```json
     {
       "detail": "High-volume manual mark limit (25) reached for this session. Please verify projector/lighting conditions or provide explicit high-volume confirmation.",
       "current_manual_count": 25,
       "cap": 25,
       "requires_confirmation": true
     }
     ```
3. The frontend intercepts `HTTP 428` and presents a high-visibility **Confirmation Modal**:
   > ⚠️ **High-Volume Manual Mark Warning**  
   > You have already manually marked **25 students** in this session.  
   > *Is your classroom projector working properly? Have you checked room lighting?*  
   > [ Cancel ]  [ I Confirm High-Volume Override ]
4. Submitting the confirmation passes `confirm_high_volume: true`, which logs an explicit security alert and executes the mark.

---

## 5. Automated Anomaly Thresholds & Notifications

The attendance engine evaluates the proportion of manual marks in each session in real-time:
$$\text{Manual Percentage} = \left( \frac{\text{Manual Marks}}{\text{Total Marked Attendance}} \right) \times 100\%$$

| Severity | Threshold | System Action | Dashboard Indicator |
|:---|:---|:---|:---|
| **Normal (Green)** | $< 15.0\%$ | Standard processing. | Clean stats badge. |
| **Warning (Amber)** | $\ge 15.0\%$ | Session flagged as potential optical or classroom issue. | Amber warning banner on Teacher Session Card:  
`⚠️ High Manual Attendance Alert: 18.5% manually marked.` |
| **Critical (Red)** | $\ge 30.0\%$ | Critical anomaly flagged. Automated notification queued for Head of Department (HOD) and Admin audit. | Red alert banner on Teacher & Admin Dashboards:  
`🚨 Severe Anomaly: 34.0% manually marked. Session flagged for HOD audit.` |

---

## 6. Visual Register & Report Tagging (`(M)`)

Every manual attendance entry is immutably tagged to ensure complete transparency across all downstream consumers.

### 6.1 Teacher Dashboard Roster
In the live student roster view, students marked manually display a high-contrast pill:
```text
[ 21891A0501 ]  Rahul Varma      Present (M) [Scanner Failed]
[ 21891A0502 ]  Priya Sharma     Present
```

### 6.2 Attendance Export & Institutional Reports
The reporting endpoints (`GET /api/v1/reports/session/{session_id}`) emit the `(M)` marker:
- **JSON Payload**:
  ```json
  {
    "roll_number": "21891A0501",
    "sap_id": "SAP-50123",
    "student_name": "Rahul Varma",
    "status": "Present",
    "is_manual": true,
    "manual_display": "Present (M)",
    "manual_reason": "scanner_failed"
  }
  ```
- **Official CSV Registers**:
  ```csv
  Roll Number,SAP ID,Name,Status,Verification Method,Manual Reason
  21891A0501,SAP-50123,Rahul Varma,Present (M),Manual Faculty Mark,scanner_failed
  21891A0502,SAP-50124,Priya Sharma,Present,Dynamic QR Token,N/A
  ```

---

## 7. Role Scoping & Permission Isolation

Manual marking permissions strictly adhere to institutional role boundaries:
1. **Teacher Role Scoping**: A teacher can only manually mark students in sessions **explicitly assigned to them** (`session.teacher_id == current_user.id`).
   - Attempting to mark a student in another teacher's active session immediately aborts with **`HTTP 403 Forbidden`**.
2. **Administrative Override**: Users with role `admin` or `superadmin` may override and manually mark across any session (e.g., during campus network outages). All admin overrides log the admin's SAP ID.

---

## 8. Institutional Security Audit Log

Every manual mark generates an immutable entry in the `AuditLog` table:

```json
{
  "timestamp": "2026-09-11T15:30:00Z",
  "action": "attendance_manual_marked",
  "actor_sap_id": "FAC-10042",
  "actor_role": "teacher",
  "target_roll_number": "21891A0501",
  "session_id": 1042,
  "details": {
    "reason": "scanner_failed",
    "detail": "Camera lens cracked on Redmi 9A",
    "session_manual_count_after": 3,
    "client_ip": "10.10.4.15"
  }
}
```
Audit logs are read-only and preserved for 7 academic years per university regulatory compliance guidelines.
