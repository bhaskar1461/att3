# 5-Rung Degradation Ladder Architecture & Operational Specification

**System**: SNIST ERP Attendance Engine  
**Component**: Graceful Degradation Framework (Student Scanner $\to$ Faculty Verification)  
**Specification Version**: 8.0 (Week 8 Release)  
**Maximum Fallback Budget**: $\le 45\text{ seconds}$ from initial scan attempt to manual mark completion  

---

## 1. Executive Summary & Philosophy

In high-density engineering college classrooms (60–120 students entering in a 5-minute window), an all-or-nothing QR scanner creates single-point-of-failure bottlenecks. Lighting variances, projector keystoning, low-end device cameras, browser permission nuances, and optical glare can impede automated decodes.

The **SNIST 5-Rung Degradation Ladder** establishes an immutable operational guarantee:  
> **"Every failure state has exactly one actionable next step (no dead ends); maximum time-to-fallback $\le 45$ seconds."**

Students and faculty seamlessly transition through progressively resilient rungs, preserving institutional security, device binding, and server-authoritative time integrity at every stage.

```mermaid
flowchart TD
    Start([Student Opens Scanner]) --> R1[Rung 1: WASM Engine<br/>zxing-cpp WebAssembly]
    R1 -- Decode Success --> Verified([Attendance Verified 200 OK])
    R1 -- WASM Load Crash / 3 consecutive decode errors --> R2[Rung 2: jsQR Engine<br/>Pure JS Auto-Fallback]
    R2 -- Decode Success --> Verified
    R1 & R2 -- 20s Active Scanning without Decode --> R3[Rung 3: Soft Restart & Guidance<br/>Steady Phone Overlay + Reset]
    R3 -- Decode Success --> Verified
    R1 & R2 & R3 -- Student Taps 'Can't Scan QR?' / 35s Elapsed --> R4[Rung 4: Help Sheet & Roll Card<br/>Torch / 2x Zoom / Large Roll Card]
    R4 -- Optical Recovery Decodes --> Verified
    R4 -- Visual Inspection / Tap 'Mark Me Manually' --> R5[Rung 5: Faculty Manual Search & Mark<br/>Mandatory Reason + 25-Cap + Audit Log]
    R5 -- Faculty Submits --> ManualVerified([Marked with (M) Flag])

    classDef r1 fill:#1e293b,stroke:#3b82f6,stroke-width:2px,color:#fff;
    classDef r2 fill:#1e293b,stroke:#06b6d4,stroke-width:2px,color:#fff;
    classDef r3 fill:#1e293b,stroke:#f59e0b,stroke-width:2px,color:#fff;
    classDef r4 fill:#1e293b,stroke:#ec4899,stroke-width:2px,color:#fff;
    classDef r5 fill:#1e293b,stroke:#ef4444,stroke-width:2px,color:#fff;
    classDef ok fill:#064e3b,stroke:#10b981,stroke-width:2px,color:#fff;

    class R1 r1;
    class R2 r2;
    class R3 r3;
    class R4 r4;
    class R5 r5;
    class Verified,ManualVerified ok;
```

---

## 2. Detailed Rung Specifications

### Rung 1: WASM Engine (Default Production Decoder)
- **Technology**: `zxing-cpp` compiled to WebAssembly with SIMD and dynamic scale ladder.
- **Latency**: $\approx 2.3\text{ ms}$ decode execution time; up to 60 FPS scan pipeline.
- **Trigger**: Default initialization on modal open (`SCANNER_ENGINE = "wasm"`).
- **Capabilities**:
  - Long-range recognition up to 15 meters in tiered lecture halls.
  - Multi-QR candidate rejection (`multi_code_detected`).
  - Dynamic resolution probe (640px base $\to$ 960px high-resolution step every 3rd frame after 6 misses).
- **Failure Conditions**: WASM binary fetch failure, WebAssembly instantiation failure, memory allocation error, or uncaught exception during decode.
- **Next Step**: Transparent fallback to Rung 2.

### Rung 2: jsQR Engine (Automated In-Memory Fallback)
- **Technology**: Pure JavaScript QR decoder (`jsQR`).
- **Latency**: $\approx 10.9\text{ ms}$ decode execution time; lightweight CPU execution.
- **Trigger**: Automatic fallback if Rung 1 emits an unrecoverable exception or fails 3 consecutive frame evaluations.
- **User Impact**: Zero. Fallback occurs dynamically in memory without restarting the camera stream or displaying an error dialog.
- **Telemetry Emitted**: `TelemetryEventType.ENGINE_FALLBACK` (`from_engine: "wasm"`, `to_engine: "jsqr"`), `ladder_rung: 2`.
- **Next Step**: Seamless scan continuation or escalation to Rung 3.

### Rung 3: Soft Restart & Guidance Overlay
- **Trigger**: Active camera stream scanning continuously for $\ge 20\text{ seconds}$ without a valid decode, or camera stream stalling.
- **Behavior**:
  - Displays non-blocking, high-visibility guidance banner:  
    `"Hold phone steady — Ensure QR fills frame — Adjust distance"`.
  - Resets the dynamic resolution probe back to 640px base.
  - Recalibrates sensor frame sampler without dropping the active `MediaStream` tracks (soft reset).
- **User Impact**: Immediate physical feedback for students standing at acute angles or holding the phone too close to the screen.
- **Telemetry Emitted**: `TelemetryEventType.LADDER_RUNG_TRANSITION` (`ladder_rung: 3`, `from_rung: 1|2`).
- **Next Step**: Normal decode, or escalation to Rung 4 via persistent action button.

### Rung 4: Help Sheet & High-Contrast Roll Number Card
- **Trigger**:
  - Student taps persistent pill button: `[ ❓ Can't scan QR? ]` (available from second 0).
  - Automatically suggested if scan duration exceeds 35 seconds.
- **Component 1: In-App Help Sheet**:
  - Hardware Torch toggle (instant illumination for dim auditoriums).
  - 2x Zoom Preset (digital/optical zoom for distant rear-row projection).
  - Actionable tips (Hold steady, clean lens, move closer).
  - Primary Action: `[ 🪪 Show Roll Card to Faculty ]`.
- **Component 2: Fullscreen Roll Number Card**:
  - High-contrast typography (black on white/amber card) designed for 2–3 meter glance verification.
  - Displays:
    * Official Roll Number (e.g., `21891A0501`).
    * Canonical SAP ID (e.g., `SAP-50123`).
    * Full Registered Student Name.
    * Current Department & Section.
    * Server-authoritative live rotating timestamp (`IST Asia/Kolkata`) proving the student is physically present.
  - Action Button: `[ Request Manual Mark ]` alerting the faculty.
- **Telemetry Emitted**: `TelemetryEventType.LADDER_RUNG_TRANSITION` (`ladder_rung: 4`, `from_rung: 1|2|3`).
- **Next Step**: Visual presentation to faculty $\to$ Rung 5.

### Rung 5: Faculty Manual Search & Mark
- **Trigger**: Student presents Roll Number Card to faculty, or student has no working phone (dead battery, broken camera).
- **Execution**:
  - Faculty opens `ManualSearchModal` from the active session card in `TeacherDashboard`.
  - Faculty searches by roll number or student name.
  - Faculty selects a mandatory Reason Enum pill:
    * `[ Scanner Failed ]`
    * `[ Device Lost ]`
    * `[ Late Join ]`
    * `[ Other Reason ]` (with optional detail note).
- **Security & Guardrails**:
  - Enforced 25-mark session rate limit cap. If mark count $\ge 25$, backend returns `HTTP 428 Precondition Required`, prompting faculty confirmation.
  - Strict role scoping (only assigned teacher can mark; cross-teacher returns `HTTP 403`).
  - Immutable Institutional Audit Log record created (`action="attendance_manual_marked"`).
  - Roster record and exports explicitly tagged with `(M)` badge.
  - Anomaly status calculated (Amber $\ge 15\%$, Red $\ge 30\%$).
- **Telemetry Emitted**: Backend security audit log + telemetry count.

---

## 3. Time-to-Fallback Budget Breakdown

The table below illustrates the strictly enforced $\le 45\text{s}$ time budget:

| Elapsed Time | Active Rung | Action / System State | User Action |
|:---|:---|:---|:---|
| **0.0s – 0.5s** | **Rung 1** (WASM) | Camera opens with constraint ladder; WASM loads. | Student aims camera at classroom screen. |
| **0.5s – 1.0s** | **Rung 2** (jsQR) | *If WASM fails to initialize*, auto-swaps to jsQR in $<50\text{ ms}$. | No action needed (transparent). |
| **1.0s – 20.0s** | **Rung 1 / 2** | Continuous scan loop at 30–60 FPS with dynamic scaling. | Student frames QR code. |
| **20.0s – 35.0s** | **Rung 3** (Soft Restart) | Guidance banner appears; decode ladder recalibrates. | Student holds phone steady or moves closer. |
| **35.0s – 40.0s** | **Rung 4** (Help / Roll Card) | Student taps `Can't scan QR?`; Roll Card displays with live timestamp. | Student walks to faculty or shows screen. |
| **40.0s – 45.0s** | **Rung 5** (Manual Mark) | Faculty searches roll, taps reason, submits attendance. | **Marked present with `(M)` tag.** |

> **Fast-Track Guarantee**: If a student's camera cannot open (denied permission or hardware lock), the interface bypasses Rungs 1–3 immediately and presents Rung 4 in $< 1\text{ second}$. Total time-to-manual mark is $< 15\text{ seconds}$.

---

## 4. Telemetry Schema & Event Correlation

Every transition across the degradation ladder emits non-PII structured telemetry to `POST /api/v1/telemetry/scan`:

```json
{
  "session_id": 1042,
  "events": [
    {
      "event_type": "ladder_rung_transition",
      "stage": "frame_decoded",
      "timestamp_ms": 1726056120000,
      "ladder_rung": 3,
      "from_rung": 1,
      "details": {
        "reason": "scan_duration_20s_timeout",
        "consecutive_misses": 48
      }
    },
    {
      "event_type": "ladder_rung_transition",
      "stage": "camera_opened",
      "timestamp_ms": 1726056135000,
      "ladder_rung": 4,
      "from_rung": 3,
      "details": {
        "trigger": "user_tap_cant_scan"
      }
    }
  ]
}
```

### Ladder Health Aggregation
The admin telemetry endpoint `/api/v1/telemetry/scanner-health` aggregates ladder usage per rung:
- `ladder_usage.rung_1_wasm`: Total attempts resolved on Rung 1.
- `ladder_usage.rung_2_jsqr`: Fallbacks handled by pure JS decoder.
- `ladder_usage.rung_3_guidance`: Sessions where 20s steady-guidance was displayed.
- `ladder_usage.rung_4_help_sheet`: Students viewing the Roll Number Card.
- `ladder_usage.rung_5_manual`: Total manual marks executed by faculty.

---

## 5. Instant Rollback Mechanism

If unexpected device matrix anomalies occur in production, operators have three instantaneous rollback paths to bypass WASM:

1. **Query Parameter**: Append `?engine=jsqr` to any student URL (useful for targeted testing).
2. **Client Storage**: Set `localStorage.setItem('scanner_engine_override', 'jsqr')` to force fallback on a specific handset.
3. **Database Hot-Flip**: Update `SystemSettings` key `SCANNER_ENGINE` to `"jsqr"` via Admin Console or SQL:
   ```sql
   INSERT INTO system_settings (key, value) VALUES ('SCANNER_ENGINE', 'jsqr')
   ON CONFLICT (key) DO UPDATE SET value = 'jsqr';
   ```
   *Execution time: $< 2.4\text{ ms}$; zero server restarts required.*
