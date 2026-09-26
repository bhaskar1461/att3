# Parity Walkthrough & Sign-off Evidence

| Feature | Steps | Expected (Legacy Behavior) | New-UI Result | Evidence | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Authentication & Session** | Enter username & password at `/login` | Generates JWT, decodes role, stores in localStorage | Clean redirect to role dashboard, sets auth header | `POST /api/v1/auth/login` -> 200 OK | VERIFIED |
| **System Dashboard Analytics** | Open `/overview` as admin | Loads executive KPI aggregates & charts | Mounts 5 KPI cards + ChartCard grid | `GET /api/v1/admin/dashboard-stats` -> 200 OK | VERIFIED |
| **System Audit Logs & Pagination** | Open `/security` or bell dropdown | Shows paginated audit events & details | Real-time audit log stream & bell badge | `GET /api/v1/admin/audit-logs?limit=100` -> 200 OK | VERIFIED |
| **Scanner Health & Telemetry** | Open `/security?tab=alerts` | Displays camera and scanner health metrics | Scanner health radar & telemetry summary | `GET /api/v1/telemetry/scanner-health` -> 200 OK | VERIFIED |
| **JNTUH R25 Compliance Rules** | Open `/compliance` as admin | Calculates condonations & defaulter cohorts | Condonation workflow & student warnings | `GET /api/v1/admin/defaulters` -> 200 OK | VERIFIED |
| **Student Directory & Management** | Open `/roster/students` | Lists all students with pagination & search | Native roster table + edit modal auto-open | `GET /api/v1/admin/students` -> 200 OK | VERIFIED |
| **Faculty Roster Setup** | Open `/roster/teachers` | Displays faculty list and department mappings | Clean faculty grid with class assignments | `GET /api/v1/admin/teachers` -> 200 OK | VERIFIED |
| **Class Register (Master Excel)** | Open `/attendance/day` | Full matrix day register with period counts | Native daily period attendance grid | `GET /api/v1/reports/class-sheet-matrix` -> 200 OK | VERIFIED |
| **Department Hierarchy Drilldown** | Open `/roster/classes` | Tree view of departments, sections, subjects | Native drilldown hierarchy + classes | `GET /api/v1/admin/departments` -> 200 OK | VERIFIED |
| **Student Magic-Link Onboarding** | Open `/onboarding` as admin | Lists onboarding status and redemption tokens | Table of student onboarding states & actions | `GET /api/v1/admin/onboard/status` -> 200 OK | VERIFIED |
| **Resend/Reject Magic-Link Onboarding** | Click Resend / Reject in `/onboarding` | Triggers single-use token regen & email | Toast notification & row status update | `POST /api/v1/admin/onboard/resend/{roll}` -> 200 | VERIFIED |
| **Dismiss/Escalate Security Alert** | Click Dismiss / Escalate on event | Appends resolution note to audit record | Dismisses row, updates bell badge and donut | `POST /api/v1/admin/security/alerts/{id}/dismiss` | VERIFIED |
| **Approve/Reject Device Recovery** | Click Approve / Deny in `/devices/recoveries` | Releases hardware lockout and issues OTP | Row status update, invalidates queue badge | `POST /api/v1/admin/onboard/rebind/{id}/approve` | VERIFIED |
| **Credential Email Dispatch** | Trigger dispatch in `/onboarding` | Generates passwords and dispatches via Zoho | Batched credential progress and status | `POST /api/v1/admin/credentials/dispatch` -> 200 | VERIFIED |
| **30-min Device Lockout Manager** | View bindings in `/devices/bindings` | Shows 30-minute lock windows and resets | Native bindings table + bulk reset action | `POST /api/v1/devices/bulk-reset` -> 200 OK | VERIFIED |
| **Attendance Reports & Exports** | Click Export in `/reports` or registers | Streams formatted .xlsx or .csv report | Async report job with progress polling & toast | `POST /api/v1/reports/request` -> download | VERIFIED |
| **Teacher Active Classes & Scanners** | Login as teacher, open `/roster/classes` | Shows assigned classes and section details | Filtered teacher class cards with live links | `GET /api/v1/teacher/assigned-classes` -> 200 | VERIFIED |
| **Teacher QR Session Broadcast** | Start session in `/sessions/live` | Generates short code base32 token | Live dynamic QR radar & token countdown | `POST /api/v1/teacher/sessions/start` -> 200 | VERIFIED |
| **Student Profile & Dynamic QR** | Login as student at `/student` | Displays personal attendance rate & dynamic QR | Standalone student portal surface | `GET /api/v1/student/attendance-summary` | VERIFIED |
| **Public Projector QR Display** | Open `/qr` in projector browser | Fullscreen dynamic QR with heartbeat | Live rotating QR with clock synchronization | `GET /api/v1/qr-display-heartbeat` -> 200 OK | VERIFIED |
| **Classroom QR Distance Calibrator** | Open `/qr-size-test` | Interactive SVG size calibration ladder | Precision distance scale and render test | Optical canvas tool (no network needed) | VERIFIED |
| **Universal Launch Token Entry** | Open `/a/:launchToken` | Verifies token and records attendance | Attendance landing with device binding check | `POST /api/v1/launch/attend` -> 200 OK | VERIFIED |
| **Global Search (Combobox)** | Press Ctrl+K in Topbar | Combobox overlay with keyboard navigation | Roving highlight, mark highlight, deep link | Real-time debounce + AbortController | VERIFIED |
| **Present Today Live Pill** | Topbar metric | Real-time attendance counter | Tabular numbers, pulse animation on tick | Shared query key `keys.attendance.records` | VERIFIED |
| **Security Alerts Notifications Bell** | Topbar bell icon | Unread incident count and notification list | Dropdown with deep links and Mark all read | Reactive `lastRead` store via localStorage | VERIFIED |
| **Operational Registers Table** | `/overview` main zone | Recent session attendance overview | Kebab view & per-row Excel export | `GET /api/v1/teacher/historical-sessions` | VERIFIED |
| **Flagged Events Security Table** | `/overview` main zone | Recent biometric & hardware anomaly flags | Quick Dismiss / Escalate action buttons | Shared query key with Donut and Bell | VERIFIED |

## Artifact Equality Verification
- **Excel (.xlsx) Header SHA-256**: `8fe8ee4feaba0eff39228727d736918993eef2cf381b020bffc80531c1d24775`
- **CSV (.csv) Header SHA-256**: `8fe8ee4feaba0eff39228727d736918993eef2cf381b020bffc80531c1d24775`
- **Header Structure**: `['S.No', 'Roll Number', 'Student Name', 'Department', 'Section', 'Subject', 'Status', 'Date']` (Identical byte-for-byte across legacy and new export pipelines).
- **Email Dispatch Templates**: `app/templates/student_magic_link_email.html` (Unified across legacy dispatch and new UI resend).

## Role Fuzzing Verification
- 15 out of 15 restricted admin/teacher routes tested with active Student session.
- **Pass Rate**: 100% (Every direct URL resulted in `<ForbiddenPage />` or clean access denial; zero data leakage, zero 500 errors).
