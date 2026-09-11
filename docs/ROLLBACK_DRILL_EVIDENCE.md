# Production Rollback Drill Evidence — Week 4 Pilot

```text
================================================================================
SNIST ERP ATTENDANCE SYSTEM — PRODUCTION ROLLBACK DRILL REPORT
Execution Timestamp: 2026-09-11 09:57:26 UTC (Server-Authoritative IST: 2026-09-11)
Drill Objective: Verify <60s zero-downtime rollback with in-flight session survival
================================================================================

[PHASE 1: BASELINE PILOT STATE]
- Active Session ID: 1 | Subject: CS401 (Distributed Cloud Systems)
- Section: CSE-A (Pilot Cohort) | Instructor: Prof. Donald Knuth
- Initial System Setting: QR_TOKEN_FORMAT = 'short'
- Broadcast Polling Response: HTTP 200 in 158.07ms
  * Format Emitted: short (Reason: GLOBAL_FLAG_SHORT)
  * Payload String: '?s=81NAKRC8&v=178912064' (Length: 23 chars)
  * Short Code: 81NAKRC8 | Step: 178912064
- Student A (Anita Reddy / 23311A0511): Attendance Confirmed in 2273.57ms (HTTP 200)
- Student B captures in-flight short QR token from projector screen...

[PHASE 2: INSTANT OPERATOR ROLLBACK TRIGGER]
- Operator executes rollback command: SystemSettings[QR_TOKEN_FORMAT] -> 'legacy'
- DB Flag Update Latency: 1.681 ms
- Rollback SLA Limit: 60,000 ms (60 seconds)
- Rollback Margin: 59998.3 ms headroom (0.0028% of SLA)

[PHASE 3: IN-FLIGHT SESSION & TOKEN SURVIVAL VERIFICATION]
- Student B submits in-flight short token AFTER operator flipped system to 'legacy'...
- Student B (Bhanu Prakash / 23311A0512): Attendance Confirmed in 1976.42ms (HTTP 200)
  * IN-FLIGHT TOKEN SURVIVAL VERDICT: PASSED (Zero classroom lockouts or errors)

[PHASE 4: POST-ROLLBACK BROADCAST & LEGACY SCAN VERIFICATION]
- Teacher terminal polls next 10s rotating broadcast token without restart...
- Broadcast Polling Response: HTTP 200 in 22.66ms
  * Format Emitted: legacy (Reason: GLOBAL_FLAG_LEGACY)
  * Byte-Identical Legacy Payload: True
  * Payload String Length: 33 chars (legacy JWT/HMAC format)
- Student C (Chaitanya Rao / 23311A0513): Attendance Confirmed in 1576.45ms (HTTP 200)

[PHASE 5: DATABASE AUDIT INTEGRITY CHECK]
- Total Verified Present Records in Session: 3/3
  * Roll: 23311A0511 | Name: Anita Reddy | Status: PRESENT | Scanned At: 2026-09-11 09:57:27.796804
  * Roll: 23311A0512 | Name: Bhanu Prakash | Status: PRESENT | Scanned At: 2026-09-11 09:57:30.056310
  * Roll: 23311A0513 | Name: Chaitanya Rao | Status: PRESENT | Scanned At: 2026-09-11 09:57:32.054907

================================================================================
DRILL VERDICT: PASSED (100% OPERATIONAL INTEGRITY)
- Total Flag Flip Time: 1.681ms (Threshold: <60,000ms)
- Zero student scans dropped or rejected across the transition
- In-flight short tokens accepted unconditionally post-flip
- Immediate runtime switch with zero application restart required
================================================================================
```
