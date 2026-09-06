# 📋 Day-1 PWA Dispatch Runbook — SNIST Attendance

**Target Date**: Monday Morning Rollout (50+ Students)  
**Deployment URL**: `https://ather-os.de5.net`  
**Audience**: System Admin / Class Lead / Faculty In-Charge  

---

## ⏰ 08:00 AM — Pre-Flight Telemetry & System Inspection

Before classroom sessions begin, run the 7-second pre-flight check and inspect install telemetry to verify ingress, database connectivity, and student installation progress.

### 1. Run Automated Pre-Flight Test
Execute the existing automated health script:
```bash
python scripts/monday_preflight_check.py --url https://ather-os.de5.net
```
*Expected: 6/6 Green checks (Remote DB ping <500ms, JWT Auth, Class Resolution, Rotating HMAC-SHA256 QR, Schedule resolution, Nginx SSL).*

### 2. Telemetry Quick Audit (DB & API)
To check how many students installed, how many are blocked by browser tabs, and platform breakdown:

#### Option A: Direct API Endpoint (Admin / Teacher JWT)
```bash
curl -s -H "Authorization: Bearer <TOKEN>" https://ather-os.de5.net/api/v1/telemetry/summary
```
Sample response:
```json
{
  "total_telemetry_events": 48,
  "by_event": {
    "PWA_STANDALONE_LAUNCH": 35,
    "PWA_INSTALL_GUARD_BLOCKED": 8,
    "PWA_INSTALL_PROMPT_SHOWN": 42,
    "PWA_INSTALL_ACCEPTED": 38
  },
  "by_platform": { "Android": 32, "iOS": 14, "Desktop": 2 },
  "by_browser": { "Chrome": 30, "Safari": 12, "Brave": 4, "Firefox": 2 }
}
```

#### Option B: Admin Dashboard UI
Navigate to **Admin Dashboard (`/admin`)** ➔ **"Devices & Telemetry"** tab:
- View live cards for **Active Standalone Launches**, **Install Guard Blocks**, **Prompt Accepted Rate**, and **Platform Distribution**.

#### Option C: Direct MySQL Diagnostic Query
```sql
SELECT 
    JSON_UNQUOTE(JSON_EXTRACT(details, '$.event')) AS pwa_event,
    JSON_UNQUOTE(JSON_EXTRACT(details, '$.platform')) AS os_platform,
    COUNT(*) AS total_count
FROM qr_audit_logs
WHERE action = 'PWA_TELEMETRY'
  AND timestamp >= CURDATE()
GROUP BY pwa_event, os_platform;
```

---

## 🚨 Top 3 Most Likely Student Issues & Exact Instant Answers

### Issue 1: iPhone Student Using Chrome/Brave/Firefox Sees Blocker
- **Symptom**: Student on iPhone opens `ather-os.de5.net` in Chrome or Brave and sees the non-dismissible card: *"iOS Installation Notice — Safari Required"*.
- **Why It Happens**: Apple WebKit does NOT allow Chrome or Brave to install PWAs to the home screen or run in true standalone mode on iOS.
- **Exact Script / Instruction to Student**:
  > *"Apple only allows PWA installation through Safari. Tap the **[Copy Link]** button on your screen, open **Safari**, paste the link, tap the **Share** button (box with up arrow at the bottom), and select **'Add to Home Screen'**."*

---

### Issue 2: "Device Locked / 403 Forbidden" (Account Bound to Another Phone / Browser Switch)
- **Symptom**: Student logs in and sees: *"Security Lockout: Your account is bound to your registered smartphone. If you changed devices, reset your binding."*
- **Why It Happens**: The student previously logged in on another device/browser, or entered their credentials on a friend's phone.
- **Instant Resolution (2 Options)**:
  1. **Self-Service via OTP (Takes 30 seconds, 0 faculty effort)**:
     - Student clicks **"Lost or changed your phone? Reset device"** directly under the error card.
     - Enters their password ➔ system emails a 6-digit OTP to their institutional email (`rollnumber@sreenidhi.edu.in`).
     - Student types the OTP ➔ account is instantly rebound to the new phone. (Capped at 5 resets/semester).
  2. **Faculty 1-Click Override (In-Class)**:
     - Teacher opens **Teacher Dashboard (`/teacher`)** ➔ class roster.
     - Clicks the 📱 **phone reset icon** next to the student's name ➔ confirms reset.
     - Student immediately logs in on their phone.

---

### Issue 3: "Scanner Shows 'PWA Installation Required'"
- **Symptom**: Student logged in, tapped "Scan Attendance", but camera does not start. Instead, a prompt says: *"Please install the app to your home screen to enable attendance scanning."*
- **Why It Happens**: The student is using a regular browser tab (Chrome/Safari) instead of launching from the home screen icon. Regular browser tabs have scanner camera disabled (Layer 1 anti-proxy guard).
- **Exact Script / Instruction to Student**:
  > *"Close your browser. Go to your phone's home screen, look for the **SNIST Attendance** app icon with the college shield, and open it from there. The scanner will activate immediately."*

---

## 🛡️ Zero-Panic In-Class Fallback: Manual Attendance Marking

If a student's phone battery is dead, camera glass is cracked, or they have an unsupported operating system:

**Do NOT hold up class or delay teaching.**

1. Open **Teacher Dashboard (`/teacher`)**.
2. Locate the active session roster.
3. Find the student by roll number or name.
4. Click the attendance status pill next to their name:
   - Click to cycle: **ABSENT** ➔ **PRESENT** ➔ **LATE**.
5. The override is saved immediately to MySQL with audit log `TEACHER_MANUAL_MARK`.

---

## 🔒 Security Summary for the In-Charge

| Defense Layer | Mechanism | Role in Dispatch |
|:---|:---|:---|
| **Layer 1: Standalone Guard** | Client-side `display-mode` check | UX friction preventing casual browser-hopping on same device |
| **Layer 2: Device Binding** | Server-side `registered_device_id` on login & QR endpoints | True security perimeter; prevents proxy attendance from friends' phones |
| **Layer 3: Telemetry** | Concurrent scan detection + audit logs | Flags multi-account scans within 60s window |
| **Self-Service Reset** | 6-digit OTP email (Zoho/Gmail failover) | Eliminates support tickets for legitimate device changes |
