# Feature Parity & Migration Ledger (FEATURES.md)

| Feature | Old Location | Endpoint (Annotated with live OpenAPI path) | Role | New Location | Status | Data Layer |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Authentication & Session** | `/login` (`Login.tsx`) | `/api/v1/auth/login`, `/api/v1/auth/me` | `student`, `teacher`, `admin` | `/features/auth` (`/login`) | VERIFIED | READY |
| **System Dashboard Analytics** | `/admin` (`AdminDashboard.tsx`) | `/api/v1/admin/dashboard-stats` *(OpenAPI prefix `/api/v1`)* | `admin` | `/overview` (Registry Dashboard Shell) | MIGRATED | READY |
| **System Audit Logs & Pagination** | `/admin` (`AdminDashboard.tsx`) | `/api/v1/admin/audit-logs` *(OpenAPI prefix `/api/v1`)* | `admin` | `/security` & Bell Dropdown | VERIFIED | READY |
| **Scanner Health & Telemetry** | `/admin?tab=scanner_health` | `/api/v1/telemetry/scanner-health` *(OpenAPI router moved from admin to telemetry)* | `admin` | `/security` (`?tab=alerts`) | VERIFIED | READY |
| **JNTUH R25 Compliance Rules** | `/admin?tab=compliance` | `/api/v1/admin/defaulters`, `/api/v1/compliance/condonations` | `admin` | `/features/compliance` (`/compliance`) | MIGRATED | READY |
| **Student Directory & Management** | `/admin/management` | `/api/v1/admin/students` *(OpenAPI prefix `/api/v1`)* | `admin` | `/features/roster` (`/roster/students`) | MIGRATED | READY |
| **Faculty Roster Setup** | `/admin/management` | `/api/v1/admin/teachers` *(OpenAPI prefix `/api/v1`)* | `admin` | `/features/roster` (`/roster/teachers`) | MIGRATED | READY |
| **Class Register (Master Excel)** | `/admin` (`ClassExcelRegisterModal.tsx`) | `/api/v1/admin/assignments` *(OpenAPI prefix `/api/v1`)* | `admin` | `/attendance/day` (`LegacyClassExcelAdapter.tsx`) | MIGRATED-LEGACY | READY |
| **Department Hierarchy Drilldown** | `/admin` (`DepartmentEnrollmentModal.tsx`) | `/api/v1/admin/departments`, `/api/v1/admin/sections`, `/api/v1/admin/subjects` | `admin` | `/roster/classes` (`LegacyDepartmentAdapter.tsx`) | MIGRATED-LEGACY | READY |
| **Student Magic-Link Onboarding** | `/admin?tab=onboarding` | `/api/v1/admin/onboard/dispatch-links`, `/api/v1/admin/onboard/status` | `admin` | `/features/onboarding` (`/onboarding`) | MIGRATED | READY |
| **Resend/Reject Magic-Link Onboarding** | `/admin?tab=onboarding` | `/api/v1/admin/onboard/resend/{roll}`, `/api/v1/admin/onboard/reject/{roll}` | `admin` | `/onboarding` & security queue table | VERIFIED | READY |
| **Dismiss/Escalate Security Alert** | `/admin` (`AdminDashboard.tsx`) | `/api/v1/admin/security/alerts/{id}/dismiss`, `/api/v1/admin/security/alerts/{id}/escalate` | `admin` | `/security` & flagged events table | VERIFIED | READY |
| **Approve/Reject Device Recovery** | `/admin?tab=devices` | `/api/v1/admin/onboard/rebind/{id}/approve`, `/api/v1/admin/onboard/rebind/{id}/deny` | `admin` | `/devices/recoveries` & security queue table | VERIFIED | READY |
| **Credential Email Dispatch** | `/admin?tab=credentials` | `/api/v1/admin/credentials/dispatch` *(OpenAPI prefix `/api/v1`)* | `admin` | `/onboarding` (`/admin/settings`) | MIGRATED | READY |
| **30-min Device Lockout Manager** | `/admin?tab=devices` | `/api/v1/devices/student-device-info`, `/api/v1/devices/bulk-reset`, `/api/v1/binding/status` | `admin`, `student` | `/devices/bindings` (`/devices/recoveries`) | MIGRATED | READY |
| **Attendance Reports & Exports** | `/reports` (`Reports.tsx`) | `/api/v1/reports/low-attendance`, `/api/v1/reports/class-sheet-matrix`, `/api/v1/reports/export/{fmt}` | `admin`, `teacher` | `/features/reports` (`/reports`) | MIGRATED | READY |
| **Teacher Active Classes & Scanners** | `/teacher` (`TeacherDashboard.tsx`) | `/api/v1/teacher/assigned-classes` *(OpenAPI path)* | `teacher` | `/roster/classes` & `/sessions/live` | MIGRATED | READY |
| **Teacher QR Session Broadcast** | `/teacher` (`TeacherDashboard.tsx`) | `/api/v1/teacher/sessions/start`, `/api/v1/teacher/sessions/{id}/broadcast-token` | `teacher` | `/features/sessions` (`/sessions/live`) | MIGRATED | READY |
| **Student Profile & Dynamic QR** | `/student` (`StudentPortal.tsx`) | `/api/v1/student/profile`, `/api/v1/student/attendance-summary`, `/api/v1/student/qr-code` | `student` | `/student` (Student Portal Surface) | VERIFIED | READY |
| **Public Projector QR Display** | `/qr` (`PublicQrDisplay.tsx`) | `/api/v1/qr-display-heartbeat` | `public` | `/qr` | VERIFIED | READY |
| **Classroom QR Distance Calibrator** | `/qr-size-test` (`QrSizeTest.tsx`) | None (Local optical tool) | `public` | `/qr-size-test` | VERIFIED | READY |
| **Universal Launch Token Entry** | `/a/:launchToken` (`AttendanceLanding.tsx`) | `/api/v1/launch/validate`, `/api/v1/launch/attend` | `student` | `/a/:launchToken` | VERIFIED | READY |
| **Global Search (Combobox)** | Topbar placeholder | Client nav + `/api/v1/admin/students`, `/api/v1/admin/assignments` | `admin`, `teacher` | Topbar (`GlobalSearch.tsx`) | VERIFIED | READY |
| **Present Today Live Pill** | Topbar placeholder | `/api/v1/attendance/records?range=today` | `admin`, `teacher` | Topbar (`PresentTodayPill.tsx`) | VERIFIED | READY |
| **Security Alerts Notifications Bell** | Topbar placeholder | `/api/v1/admin/audit-logs` | `admin`, `teacher` | Topbar (`NotificationsBell.tsx`) | VERIFIED | READY |
| **Operational Registers Table** | None (Phase 9 addition) | `/api/v1/teacher/historical-sessions`, `/api/v1/reports/export/{fmt}` | `admin`, `teacher` | `/overview` (`RecentRegistersCard.tsx`) | VERIFIED | READY |
| **Flagged Events Security Table** | None (Phase 9 addition) | `/api/v1/admin/audit-logs`, `/api/v1/admin/security/alerts/{id}/*` | `admin`, `teacher` | `/overview` (`FlaggedEventsCard.tsx`) | VERIFIED | READY |

> **Parity Rule Enforcement**:
> 1. No legacy route is deleted until its corresponding ledger row is marked `VERIFIED`.
> 2. The legacy UI remains fully reachable behind `/admin/legacy` (or `LEGACY_UI=1`) through Phase 10 final sign-off.
> 3. Data Layer parity: All ledger endpoints have typed Zod schemas (`src/core/api/schemas/`), typed wrappers (`src/core/api/endpoints/`), and query/mutation hooks (`src/features/*/hooks.ts`).
