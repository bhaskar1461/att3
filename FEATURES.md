# Feature Parity & Migration Ledger (FEATURES.md)

| Feature | Old Location | Endpoint | Role | New Location | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **System Dashboard Analytics** | `/admin` (`AdminDashboard.tsx`) | `/admin/dashboard-stats` | `admin` | `/admin` (Phase 3 KPI/Charts) | PENDING |
| **System Audit Logs & Pagination** | `/admin` (`AdminDashboard.tsx`) | `/admin/audit-logs` | `admin` | `/admin/audit` (Audit Feature) | PENDING |
| **Scanner Health & Telemetry** | `/admin?tab=scanner_health` | `/admin/scanner-health` | `admin` | `/features/telemetry` | PENDING |
| **JNTUH R25 Compliance Rules** | `/admin?tab=compliance` | `/admin/compliance/stats` | `admin` | `/features/compliance` | PENDING |
| **Student Directory & Management** | `/admin/management` | `/admin/students` | `admin` | `/features/roster` | PENDING |
| **Faculty Roster Setup** | `/admin/management` | `/admin/teachers` | `admin` | `/features/faculty` | PENDING |
| **Class Register (Master Excel)** | `/admin` (`ClassExcelRegisterModal.tsx`) | `/admin/class-registers` | `admin` | `/features/excel-grid` | PENDING |
| **Department Hierarchy Drilldown** | `/admin` (`DepartmentEnrollmentModal.tsx`) | `/admin/departments` | `admin` | `/features/departments` | PENDING |
| **Student Magic-Link Onboarding** | `/admin?tab=onboarding` | `/admin/onboarding/dispatch` | `admin` | `/features/onboarding` | PENDING |
| **Credential Email Dispatch** | `/admin?tab=credentials` | `/admin/credentials/dispatch` | `admin` | `/features/credentials` | PENDING |
| **30-min Device Lockout Manager** | `/admin?tab=devices` | `/admin/devices` | `admin` | `/features/devices` | PENDING |
| **Attendance Reports & Exports** | `/reports` (`Reports.tsx`) | `/admin/reports/export` | `admin`, `teacher` | `/features/reports` | PENDING |
| **Teacher Active Classes & Scanners** | `/teacher` (`TeacherDashboard.tsx`) | `/teacher/classes` | `teacher` | `/features/classes` | PENDING |
| **Teacher QR Session Broadcast** | `/teacher` (`TeacherDashboard.tsx`) | `/teacher/sessions/broadcast` | `teacher` | `/features/sessions` | PENDING |
| **Student Profile & Dynamic QR** | `/student` (`StudentPortal.tsx`) | `/student/profile` | `student` | `/features/student-qr` | PENDING |
| **Public Projector QR Display** | `/qr` (`PublicQrDisplay.tsx`) | `/qr/display` | `public` | `/qr` | VERIFIED |
| **Classroom QR Distance Calibrator** | `/qr-size-test` (`QrSizeTest.tsx`) | None (Local optical tool) | `public` | `/qr-size-test` | VERIFIED |
| **Universal Launch Token Entry** | `/a/:launchToken` (`AttendanceLanding.tsx`) | `/attendance/launch` | `student` | `/a/:launchToken` | VERIFIED |

> **Parity Rule Enforcement**:
> 1. No legacy route is deleted until its corresponding ledger row is marked `VERIFIED`.
> 2. The legacy UI remains fully reachable behind `/admin/legacy` (or `LEGACY_UI=1`) through Phase 10 final sign-off.
