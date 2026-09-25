# Feature Parity & Migration Ledger (FEATURES.md)

| Feature | Old Location | Endpoint (Annotated with live OpenAPI path) | Role | New Location | Status | Data Layer |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Authentication & Session** | `/login` (`Login.tsx`) | `/api/v1/auth/login`, `/api/v1/auth/me` | `student`, `teacher`, `admin` | `/features/auth` | VERIFIED | READY |
| **System Dashboard Analytics** | `/admin` (`AdminDashboard.tsx`) | `/api/v1/admin/dashboard-stats` *(OpenAPI prefix `/api/v1`)* | `admin` | `/admin` (Phase 3 KPI/Charts) | PENDING | READY |
| **System Audit Logs & Pagination** | `/admin` (`AdminDashboard.tsx`) | `/api/v1/admin/audit-logs` *(OpenAPI prefix `/api/v1`)* | `admin` | `/admin/audit` (Audit Feature) | PENDING | READY |
| **Scanner Health & Telemetry** | `/admin?tab=scanner_health` | `/api/v1/telemetry/scanner-health` *(OpenAPI router moved from admin to telemetry)* | `admin` | `/features/telemetry` | PENDING | READY |
| **JNTUH R25 Compliance Rules** | `/admin?tab=compliance` | `/api/v1/admin/defaulters`, `/api/v1/compliance/condonations` | `admin` | `/features/compliance` | PENDING | READY |
| **Student Directory & Management** | `/admin/management` | `/api/v1/admin/students` *(OpenAPI prefix `/api/v1`)* | `admin` | `/features/roster` | PENDING | READY |
| **Faculty Roster Setup** | `/admin/management` | `/api/v1/admin/teachers` *(OpenAPI prefix `/api/v1`)* | `admin` | `/features/faculty` | PENDING | READY |
| **Class Register (Master Excel)** | `/admin` (`ClassExcelRegisterModal.tsx`) | `/api/v1/admin/assignments` *(OpenAPI prefix `/api/v1`)* | `admin` | `/features/excel-grid` | PENDING | READY |
| **Department Hierarchy Drilldown** | `/admin` (`DepartmentEnrollmentModal.tsx`) | `/api/v1/admin/departments`, `/api/v1/admin/sections`, `/api/v1/admin/subjects` | `admin` | `/features/departments` | PENDING | READY |
| **Student Magic-Link Onboarding** | `/admin?tab=onboarding` | `/api/v1/admin/onboard/dispatch-links`, `/api/v1/admin/onboard/status` | `admin` | `/features/onboarding` | PENDING | READY |
| **Credential Email Dispatch** | `/admin?tab=credentials` | `/api/v1/admin/credentials/dispatch` *(OpenAPI prefix `/api/v1`)* | `admin` | `/features/credentials` | PENDING | READY |
| **30-min Device Lockout Manager** | `/admin?tab=devices` | `/api/v1/devices/student-device-info`, `/api/v1/devices/bulk-reset`, `/api/v1/binding/status` | `admin`, `student` | `/features/devices` | PENDING | READY |
| **Attendance Reports & Exports** | `/reports` (`Reports.tsx`) | `/api/v1/reports/low-attendance`, `/api/v1/reports/class-sheet-matrix`, `/api/v1/reports/export/{fmt}` | `admin`, `teacher` | `/features/reports` | PENDING | READY |
| **Teacher Active Classes & Scanners** | `/teacher` (`TeacherDashboard.tsx`) | `/api/v1/teacher/assigned-classes` *(OpenAPI path)* | `teacher` | `/features/classes` | PENDING | READY |
| **Teacher QR Session Broadcast** | `/teacher` (`TeacherDashboard.tsx`) | `/api/v1/teacher/sessions/start`, `/api/v1/teacher/sessions/{id}/broadcast-token` | `teacher` | `/features/sessions` | PENDING | READY |
| **Student Profile & Dynamic QR** | `/student` (`StudentPortal.tsx`) | `/api/v1/student/profile`, `/api/v1/student/attendance-summary`, `/api/v1/student/qr-code` | `student` | `/features/student-qr` | PENDING | READY |
| **Public Projector QR Display** | `/qr` (`PublicQrDisplay.tsx`) | `/api/v1/qr-display-heartbeat` | `public` | `/qr` | VERIFIED | READY |
| **Classroom QR Distance Calibrator** | `/qr-size-test` (`QrSizeTest.tsx`) | None (Local optical tool) | `public` | `/qr-size-test` | VERIFIED | READY |
| **Universal Launch Token Entry** | `/a/:launchToken` (`AttendanceLanding.tsx`) | `/api/v1/launch/validate`, `/api/v1/launch/attend` | `student` | `/a/:launchToken` | VERIFIED | READY |

> **Parity Rule Enforcement**:
> 1. No legacy route is deleted until its corresponding ledger row is marked `VERIFIED`.
> 2. The legacy UI remains fully reachable behind `/admin/legacy` (or `LEGACY_UI=1`) through Phase 10 final sign-off.
> 3. Data Layer parity: All ledger endpoints have typed Zod schemas (`src/core/api/schemas/`), typed wrappers (`src/core/api/endpoints/`), and query/mutation hooks (`src/features/*/hooks.ts`).
