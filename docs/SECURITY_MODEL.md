# 🛡️ Security, Cryptography & Threat Model

This document outlines the security architecture, cryptographic token mechanics, threat modeling, and regulatory compliance standards implemented in the **SNIST AI QR Attendance & ERP System**.

---

## 1. Threat Model & Attack Scenarios

### Threat 1: Remote Proxy Attendance (WhatsApp Photo Sharing)
- **Attack Vector**: A student physically present in the classroom photographs the projector screen or teacher's QR code and transmits the image to absent friends over messaging apps.
- **Defense-in-Depth**:
  1. **10-Second Ephemeral Rotating Tokens**: QR payloads regenerate every 10 seconds. Network transmission, receipt, and display latency across WhatsApp typically exceeds 15–30 seconds, resulting in immediate server rejection (`HTTP 400 Expired QR Token`).
  2. **Hardware Device Binding**: Even if a remote student receives the token within 10 seconds, their device is locked to their personal account and cannot mark attendance for any other account.

### Threat 2: Account Switching on a Single Phone
- **Attack Vector**: A present student takes attendance for their friend by logging out of their account, logging into their friend's account on the same phone, and scanning the QR code.
- **Defense-in-Depth**:
  1. **30-Minute Hardware Lockout**: The system captures `x-device-public-id` during every login and scan. When an active binding exists for Roll Number A on Device D, any login attempt for Roll Number B on Device D is rejected with `HTTP 403 Forbidden`.
  2. **Audit Logging & Real-Time Alerting**: The 3rd account switch attempt from the same device within 10 minutes automatically triggers a `CRITICAL` email alert to the security administrator (`23311a05y6@cse.sreenidhi.edu.in`).

### Threat 3: Token Signature Tampering & Replay Attacks
- **Attack Vector**: A technically skilled student intercepts HTTP requests, attempts to forge timestamps or session IDs, or replays an earlier valid scan payload.
- **Defense-in-Depth**:
  1. **HMAC-SHA256 Cryptographic Signing**: Payloads are signed with `QR_SECRET_KEY`. Any alteration to `session_id`, `timestamp`, or `window_index` invalidates the signature.
  2. **Duplicate Attendance Check**: Database constraints and composite indexes reject duplicate attendance submissions for the same student in the same session (`idx_att_rec_session_student`).
  3. **Brute-Force Detection**: Source IPs generating >10 invalid HMAC tokens in 5 minutes trigger an automated `HIGH` severity alert (`FAILED_HMAC`).

### Threat 4: Unauthorized Privilege Escalation
- **Attack Vector**: A student discovers faculty or administrator API endpoints (`/api/v1/teacher/*`, `/api/v1/admin/*`) and attempts to issue unauthorized requests using their student Bearer JWT.
- **Defense-in-Depth**:
  1. **Role-Based Access Control (RBAC)**: All sensitive routes enforce strict dependency guards (`require_teacher`, `require_admin`).
  2. **Immediate Alert Hook**: When a user with role `STUDENT` attempts to hit teacher or admin endpoints, the system immediately writes `PRIVESC_ATTEMPT` to `qr_audit_logs` and sends an instant `CRITICAL` alert to the operator.

---

## 2. Cryptographic Specifications

### Projector Rotating QR Code Token
- **Algorithm**: HMAC-SHA256
- **Window Size**: 10 seconds ($W = 10$)
- **Timestamp**: Server-authoritative UTC / IST timestamp
- **Payload Structure**:
  ```json
  {
    "session_id": 29,
    "window_index": 178859918,
    "salt": "a8f9c2d1",
    "signature": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  }
  ```
- **Verification Formula**:
  $$\text{valid} = \text{verify}(W_{\text{current}}) \lor \text{verify}(W_{\text{current} - 1})$$

### Student Authentication JWT
- **Algorithm**: HMAC-SHA256 (`HS256`)
- **Key**: `SECRET_KEY` (256-bit cryptographically secure pseudorandom number)
- **Token Expiry**:
  - Staff / Admin: 7 Days (`10080` minutes)
  - Student Session Token: 30 Seconds for high-security dynamic scan QR

---

## 3. Audit Trail Schema (`qr_audit_logs`)

All security events are written to an append-only, tamper-proof audit table:

```sql
CREATE TABLE qr_audit_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NULL,
    roll_number VARCHAR(50) NULL,
    device_id INT NULL,
    event_type VARCHAR(50) NOT NULL,
    action VARCHAR(100) NOT NULL,
    details TEXT NULL,
    ip_address VARCHAR(50) NULL,
    created_at DATETIME NOT NULL,
    INDEX idx_audit_created_at (created_at),
    INDEX idx_audit_roll (roll_number),
    INDEX idx_audit_event_type (event_type)
);
```

### Standard Event Types
- `ACCOUNT_SWITCH_ATTEMPT`: Multi-account hardware binding violation.
- `DEVICE_REVOKED`: Manual or automatic revocation of a device lock.
- `FAILED_HMAC`: Malformed or tampered QR signature.
- `PRIVESC_ATTEMPT`: Student JWT attempting administrative or teacher actions.
- `SCAN_FLOOD_429`: Scan endpoint rate-limit saturation.
- `RATE_LIMIT_TRIGGERED`: Login brute-force threshold breach.
- `SECURITY_ALERT_SENT`: Record of outbound email alert dispatched to operator.
