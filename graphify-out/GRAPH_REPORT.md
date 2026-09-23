# Graph Report - att2  (2026-09-23)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 3165 nodes · 10220 edges · 146 communities (107 shown, 39 thin omitted)
- Extraction: 85% EXTRACTED · 15% INFERRED · 0% AMBIGUOUS · INFERRED: 1485 edges (avg confidence: 0.94)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `60e4205c`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 19
- Community 20
- Community 21
- Community 22
- Community 23
- Community 24
- Community 25
- Community 26
- Community 27
- Community 28
- Community 29
- Community 30
- Community 31
- Community 32
- Community 33
- Community 34
- Community 35
- Community 36
- Community 37
- Community 38
- Community 39
- Community 40
- Community 41
- Community 42
- Community 43
- Community 44
- Community 45
- Community 46
- Community 47
- Community 48
- Community 49
- Community 50
- Community 51
- Community 52
- Community 53
- Community 54
- Community 55
- Community 56
- Community 57
- Community 58
- Community 59
- Community 60
- Community 61
- Community 62
- Community 63
- Community 64
- Community 65
- Community 66
- Community 67
- Community 68
- Community 69
- Community 70
- Community 71
- Community 72
- Community 73
- Community 74
- Community 75
- Community 76
- Community 77
- Community 78
- Community 79
- Community 80
- Community 81
- Community 82
- Community 83
- Community 84
- Community 85
- Community 86
- Community 87
- Community 88
- Community 89
- Community 90
- Community 91
- Community 92
- Community 93
- Community 94
- Community 95
- Community 96
- Community 97
- Community 98
- Community 99
- Community 100
- Community 101
- Community 102
- Community 103
- Community 104
- Community 105
- Community 106
- Community 107
- Community 108
- Community 109
- Community 110
- Community 111
- Community 112
- Community 113
- Community 114
- Community 115
- Community 116
- Community 117
- Community 118
- Community 119
- Community 120
- Community 121
- Community 122
- Community 123
- Community 124
- Community 125
- Community 126
- Community 127
- Community 128
- Community 130
- Community 131
- Community 132
- Community 133
- Community 134
- Community 135
- Community 136
- Community 137

## God Nodes (most connected - your core abstractions)
1. `User` - 293 edges
2. `Student` - 246 edges
3. `AttendanceSession` - 194 edges
4. `UserRole` - 181 edges
5. `Department` - 155 edges
6. `Section` - 148 edges
7. `Teacher` - 146 edges
8. `AcademicYear` - 135 edges
9. `AttendanceRecord` - 133 edges
10. `Subject` - 129 edges

## Surprising Connections (you probably didn't know these)
- `generate_official_master_attendance_template()` --uses--> `Student`  [INFERRED]
  scripts/create_master_template.py → backend/app/models/models.py
- `setup_suite()` --uses--> `AcademicYear`  [INFERRED]
  scripts/run_binding_phase5_regression_proof.py → backend/app/models/models.py
- `run_v2_rollback_drill()` --uses--> `AcademicYear`  [INFERRED]
  scripts/run_render_v2_rollback_drill.py → backend/app/models/models.py
- `build_test_environment()` --uses--> `AcademicYear`  [INFERRED]
  scripts/run_week9_load_certification.py → backend/app/models/models.py
- `setup_suite()` --uses--> `Department`  [INFERRED]
  scripts/run_binding_phase5_regression_proof.py → backend/app/models/models.py

## Import Cycles
- None detected.

## Communities (146 total, 39 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (68): _get_or_create_admin_session(), Finds or auto-provisions an AttendanceSession for (section_id, session_date)., _require_student(), require_student(), create_access_token(), get_password_hash(), AcademicYear, Department (+60 more)

### Community 1 - "Community 1"
Cohesion: 0.09
Nodes (63): app_api, app_api_student, app_core_binding_crypto, app_core_config, app_core_device_security, app_core_security, app_services_qr_token, app_services_security_alert_service (+55 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (29): app_api_reports, app_core_database, app_models_models, app_services_email_service, app_services_telemetry_rollup, create_device_reset_otp_table(), Defensively creates the qr_device_reset_otps table for self-service device…, Migration: Add registered_device_id column to qr_students table. Implements bi-… (+21 more)

### Community 3 - "Community 3"
Cohesion: 0.03
Nodes (52): app_services_geofence_service, get_dashboard_stats(), get_admin_daily_sheet(), get, Fetches the full student attendance sheet for a given section on a specific…, get_class_sheet_matrix(), get_session_attendance_report(), Returns an Excel-style attendance register matrix for specific… (+44 more)

### Community 4 - "Community 4"
Cohesion: 0.05
Nodes (80): app_api_attendance, app_api_teacher, invalidate_session_cache(), get_student_attendance_summary(), get_student_today_schedule(), Returns today's active schedule and personal attendance confirmation status for…, _async_full_session_sync(), delete_session() (+72 more)

### Community 5 - "Community 5"
Cohesion: 0.07
Nodes (56): bulk_reset_devices(), DeviceBulkResetRequest, DeviceRegisterRequest, DeviceResetEnrollmentRequest, DeviceResetRequest, DeviceRevokeRequest, DeviceVerifyResetRequest, get_current_device_binding() (+48 more)

### Community 6 - "Community 6"
Cohesion: 0.06
Nodes (47): DigestTriggerRequest, export_defaulters_register(), get_admin_defaulters(), get_faculty_defaulters(), get_hod_defaulters(), get_student_warnings(), issue_warning_to_student(), BaseModel (+39 more)

### Community 7 - "Community 7"
Cohesion: 0.07
Nodes (47): App(), AttendanceLanding, AuthNavigationSync(), PublicQrDisplay, QrSizeTest, RoleBasedRedirect(), TeacherDashboard, ProtectedRoute() (+39 more)

### Community 8 - "Community 8"
Cohesion: 0.04
Nodes (39): app_services_launch_token, SNIST ERP — Launch Token API (Phase 12A: Universal Projector Entry) Provides…, SNIST ERP — Device Tier Classifier (Server-Side) Week 1 Telemetry Module…, SNIST ERP Attendance System — Server-Authoritative Geofence Service Calculates…, create_claim_ticket(), SNIST ERP — Launch Token Service (Phase 12A: Universal Projector Entry)…, Exchanges a validated launch token for a 3-minute single-use claim ticket. The…, Encodes bytes to URL-safe base64 without padding. (+31 more)

### Community 9 - "Community 9"
Cohesion: 0.06
Nodes (24): app_services_gsheets_service, generate_official_master_attendance_template(), copy, csv, google_auth_oauthlib_flow, google_auth_transport_requests, google_oauth2_credentials, googleapiclient_discovery (+16 more)

### Community 10 - "Community 10"
Cohesion: 0.06
Nodes (40): admin_revoke_student_binding(), dispatch_rebind_otp_internal(), enroll_device_key(), get_churn_anomalies(), mask_email(), get, Session, Generates, hashes, stores, and dispatches a 6-digit OTP to student's email. (+32 more)

### Community 11 - "Community 11"
Cohesion: 0.07
Nodes (45): Management, DefaulterStudent, FacultyDefaultersTab(), FacultyDefaultersTabProps, ManualSearchModal(), ManualSearchModalProps, PostAttendanceSelfieModal(), PostAttendanceSelfieModalProps (+37 more)

### Community 12 - "Community 12"
Cohesion: 0.10
Nodes (41): CalendarLegend(), CalendarLegendProps, ClassEventPill(), ClassEventPillProps, CurrentClassHeroCard(), CurrentClassHeroCardProps, CurrentClassInfo, SelectedClassPanel() (+33 more)

### Community 13 - "Community 13"
Cohesion: 0.06
Nodes (46): app_core_device_classifier, _async_update_entry_method(), launch_attend(), BackgroundTasks, Request, Authenticated endpoint: submits attendance via a validated claim ticket or…, Background task to update entry_method on the attendance record., _async_scan_telemetry() (+38 more)

### Community 14 - "Community 14"
Cohesion: 0.06
Nodes (38): AdminDashboard, ComplianceSummaryResponse, ComplianceTab(), ComplianceTabProps, DefaulterRow, DepartmentComplianceItem, BatchStatus, CredentialDispatcher() (+30 more)

### Community 15 - "Community 15"
Cohesion: 0.05
Nodes (25): app_services_attendance_engine, Test Suite: Binding Phase 3 — Database-Level Invariant & Concurrency Race…, Concurrency Load Test Suite — 150/300 Simulated Students Tests the critical…, concurrent_futures, print_header(), Live Burst Smoke Test for SNIST ERP Attendance System Validates: 1. Health…, test_am1_per_roll_isolation(), test_am3_fast_fail_scan() (+17 more)

### Community 16 - "Community 16"
Cohesion: 0.09
Nodes (47): approve_rebind_request(), deny_rebind_request(), dispatch_magic_links(), DispatchLinksRequest, get_individual_onboarding_status(), get_onboarding_status_table(), get_student_login_link(), import_onboarding_excel() (+39 more)

### Community 17 - "Community 17"
Cohesion: 0.08
Nodes (46): _async_login_audit_event(), change_password(), generate_magic_link_endpoint(), GenerateMagicLinkRequest, get_current_user(), get_magic_token_info(), login_for_access_token(), login_via_magic_link() (+38 more)

### Community 18 - "Community 18"
Cohesion: 0.09
Nodes (32): GoogleSheetsService, Any, Authorizes and returns a gspread client instance (supports Service Account &…, Alias method for syncing all student records and formatting sheet., Formats and populates the Google Sheet to match the exact SNIST Attendance…, Converts 1-based column index to letter (1 -> A, 27 -> AA, 28 -> AB, etc.), Retrieves active worksheet, prioritizing 'CSE-CS', 'Attendance Register', then…, Applies exact college template colors, column widths, text alignments, and… (+24 more)

### Community 19 - "Community 19"
Cohesion: 0.08
Nodes (44): DeviceChallengeRequest, DeviceRegistrationRequest, DeviceVerifyRequest, _dispatch_rebind_otp(), BaseModel, post, Request, Session (+36 more)

### Community 20 - "Community 20"
Cohesion: 0.05
Nodes (26): Week 3 Short-Token Registry: Maps compact 8-character Crockford Base32 short…, ShortTokenRegistry, Purges old short code registrations on the background maintenance budget., Authoritative Short-Token lifecycle and dual-format validation engine. Wraps…, Retrieves or generates an opaque short code for an active session. The short…, ShortTokenService, override_get_db(), SNIST ERP — Week 5 Test Suite: QR Display, ECC L Tuning, and Rotation… (+18 more)

### Community 21 - "Community 21"
Cohesion: 0.06
Nodes (26): _generate_p256_keypair(), Helper: fetches a valid QR broadcast token (short format) from the teacher…, Helper: directly creates a DeviceBinding row in DB (bypasses /binding/enroll…, Phase 5 Cutover: When BINDING_V2 is disabled, client sending legacy device_uuid…, Full happy path: enrolled student submits valid possession proof → attendance…, Unenrolled student (no DeviceBinding row) gets 403 when BINDING_V2 is on., Signature from a different key pair is rejected with 401., Challenge token with expired TTL is rejected. (+18 more)

### Community 22 - "Community 22"
Cohesion: 0.06
Nodes (37): adaptAssignmentToScheduledEvent(), adaptSessionsToCalendarEvents(), mergeCalendarEvents(), displayStr, endOfFeb, endOfYear, events, gridSept2025 (+29 more)

### Community 23 - "Community 23"
Cohesion: 0.06
Nodes (26): _generate_p256_keypair(), Enrolled student with valid challenge token and ECDSA signature marks…, Unbound student encounters 403, enrolls inline, then marks attendance cleanly., Generates real P-256 ECDSA keypair; returns (private_key, spki_b64, key_id)., Produces IEEE P1363 raw 64-byte signature Base64 (matching WebCrypto API…, _sign_challenge_p1363(), _generate_p256_keypair(), Helper to get fresh broadcast token from session. (+18 more)

### Community 24 - "Community 24"
Cohesion: 0.11
Nodes (43): assign_teacher(), AssignmentCreate, create_department(), create_section(), create_student(), create_subject(), create_teacher(), DepartmentCreate (+35 more)

### Community 25 - "Community 25"
Cohesion: 0.07
Nodes (40): BindingVerifyRequest, ChallengeRequest, ChallengeResponse, check_binding_v2_enabled(), DeviceEnrollmentRequest, BaseModel, post, Request (+32 more)

### Community 26 - "Community 26"
Cohesion: 0.10
Nodes (38): app_services_onboarding_service, activate_student_endpoint(), ActivateRequest, _get_client_ip(), get_onboarding_status(), _mask_email(), BaseModel, get (+30 more)

### Community 27 - "Community 27"
Cohesion: 0.06
Nodes (32): _hourly_security_digest_scheduler(), lifespan(), Background safety-net loop for Layer 2 security digest. Evaluates every 60…, Startup guard: asserts all referenced email templates exist and dry-render with…, _verify_email_templates_on_startup(), dispatch_email_batch_background(), _worker(), _get_jinja_env() (+24 more)

### Community 28 - "Community 28"
Cohesion: 0.10
Nodes (32): get_server_ist_datetime(), Returns server-authoritative current datetime in IST (Asia/Kolkata)., OnboardingAuditLog, OnboardingOTP, OnboardingToken, Magic link tokens — raw token NEVER stored, only SHA-256 hash., Email OTP records for verification during onboarding wizard., Dedicated onboarding audit trail — follows qr_audit_logs pattern. (+24 more)

### Community 29 - "Community 29"
Cohesion: 0.08
Nodes (24): OnboardingWizard, Reports, StudentPortal, IosInstallGuideModal(), IosInstallGuideModalProps, IosSafariInterstitial(), PwaInstallGuard(), PwaInstallGuardProps (+16 more)

### Community 30 - "Community 30"
Cohesion: 0.06
Nodes (21): app_api_auth, FailedLoginRateLimiter, In-memory thread-safe rate limiter tracking failed login attempts strictly per…, FailedTokenTracker, In-memory thread-safe rate limiter for failed rotating QR token validations (A3…, AM3: Exempt legitimate scans by resetting any failure history immediately., In-memory rate limiter enforcing max 15 scan attempts per minute per ROLL…, Resets attempt history immediately for legitimate/successful scans. (+13 more)

### Community 31 - "Community 31"
Cohesion: 0.11
Nodes (26): DeviceEnrollmentModalProps, bufferToBase64(), ECDSA_ALGORITHM, generateKeyPair(), generateSecureNonce(), getSubtle(), isSubtleCryptoSupported(), sha256Hex() (+18 more)

### Community 32 - "Community 32"
Cohesion: 0.14
Nodes (33): app_services_excel_service, app_services_qr_service, AdminBatchDailyMarkRequest, AdminDailyMarkRequest, batch_mark_admin_daily_attendance(), batch_mark_session_attendance(), _bg_sync(), BatchScanRequest (+25 more)

### Community 33 - "Community 33"
Cohesion: 0.11
Nodes (33): dispatch_credentials(), DispatchCredentialsRequest, _generate_temp_password(), get_batch_status(), lookup_student_for_recovery(), preview_credential_template(), BaseModel, get (+25 more)

### Community 34 - "Community 34"
Cohesion: 0.09
Nodes (9): http_server, ProxyAndStaticHTTPRequestHandler, ThreadingServer, HttpsProxyHandler, ThreadingHttpsServer, socketserver, ssl, urllib_error (+1 more)

### Community 35 - "Community 35"
Cohesion: 0.07
Nodes (15): Test server-authoritative class detection when current IST time is inside…, Test server-authoritative detection during morning break (11:15), ensuring no…, Test server-authoritative detection during lunch break (13:20), ensuring no…, Test server-authoritative detection outside college hours (08:00 and 18:00)., Section 7: Verify rapid double clicks / parallel starts return the same logical…, Section 6 & 12: When an OPEN session exists, /teacher/current-class immediately…, Section 8 & 9: Projector broadcast token generates rotating token and live…, Section 31 & 45: Live projector broadcast is strictly rejected when session is… (+7 more)

### Community 36 - "Community 36"
Cohesion: 0.08
Nodes (14): patch, Verify critical events like PRIVESC_ATTEMPT trigger immediate alert on 1st…, Verify FAILED_HMAC requires >10 attempts before alerting., Verify RATE_LIMIT_TRIGGERED is recorded for hourly digest without sending real-…, Verify hook_audit_event executes safely and dispatches in worker pool without…, End-to-End Simulation: 5 consecutive account switch attempts from same device:…, Hourly Digest Safety Net: When zero security events occurred in the past hour:…, Hourly Digest Safety Net: When events exist in the past hour: - Assert function… (+6 more)

### Community 37 - "Community 37"
Cohesion: 0.13
Nodes (15): get_cached(), Any, Session, Warning issuance + evidence trail: Records: issuer, date, band at issue time…, One-click Excel export in official SNIST register format., Weekly digest to HODs (Ops Guardrail): - Department defaulters summary, new…, Calculates JNTUH R25 attendance percentage for one student in one course.…, Returns full compliance profile for a student: Aggregate % + band + per-course… (+7 more)

### Community 38 - "Community 38"
Cohesion: 0.09
Nodes (13): generate_launch_token(), Generates a short-lived, signed launch token for URL embedding. Args:…, 3. Launch link exchanges token for a single-use claim that survives a 20s login…, 4. Attempting to exchange an expired launch token for a claim is rejected with…, 5. Verify distinct error codes: expired, invalid, no_active_binding,…, 6. Verify scanner recovery: after receiving 'expired' error on old QR, fresh QR…, 7. Claim ticket is NOT consumed when attendance fails due to missing device…, Test 3: Normal Phone Camera opens landing page which calls GET /launch/validate. (+5 more)

### Community 39 - "Community 39"
Cohesion: 0.15
Nodes (19): app_services_report_service, export_csv_report(), export_excel_report(), export_pdf_report(), fetch_filtered_records(), get_low_attendance_report(), get_report_user(), get (+11 more)

### Community 40 - "Community 40"
Cohesion: 0.10
Nodes (13): patch, Wrong password fails with HTTP 401., Max 3 requests per hour; 4th request returns HTTP 429., Semester cap of 5 resets: attempt #6 triggers HTTP 403 and records…, Verifying correct OTP rebinds device; OTP cannot be reused a second time…, Invalid OTP code increments attempt count and rejects with 400., Expired OTP is rejected., Non-teacher/admin role calling reset-student-enrollment receives HTTP 403. (+5 more)

### Community 41 - "Community 41"
Cohesion: 0.08
Nodes (12): Table-driven testing for device tier classification rules., Valid batch of telemetry events returns HTTP 202 Accepted., Unrecognized event_type is rejected with HTTP 422., Unrecognized device_bucket is rejected with HTTP 422., Batches exceeding 50 events are rejected with HTTP 422., Rejects any payload containing forbidden PII keys (roll, name, student, etc.)., Rejects payload if any string value matches the institutional roll regex., Students are rejected with 403; Faculty and Admin get 200 OK. (+4 more)

### Community 42 - "Community 42"
Cohesion: 0.15
Nodes (17): Navbar(), QRScannerModal(), QRScannerModalProps, QRScannerModal, addScanToBatchQueue(), batchBuffer, clearOfflineQueue(), flushBatchQueue() (+9 more)

### Community 43 - "Community 43"
Cohesion: 0.11
Nodes (15): clear_binding_verify_lockouts(), Clears all recorded verification failures across all identifiers (testing…, Comprehensive scan-path integration tests for the Binding V2 possession-proof.…, TestBindingPhase4ScanPath, Helper to create student and auth token., Valid student signs challenge, but specifies a forged / unregistered device_id.…, Challenge token created in the past beyond CHALLENGE_TTL_SECONDS must be…, TestCryptographicDeviceIdentity (+7 more)

### Community 44 - "Community 44"
Cohesion: 0.09
Nodes (18): SNIST ERP — Two-Layer Security Alerting & Detection Service Real-time…, # WHY: Eliminates repetitive emails for ongoing attacks while recording volume…, Retrieves suppressed event counts and flushes the tracker for the hourly digest., Resets all tracking maps (used primarily in automated unit tests)., # WHY: Allows operator to instantly silence alerting via environment variable…, # WHY: Ensures client request processing finishes with zero latency overhead., # WHY: Provides operator with instant triage clarity during live class…, # WHY: Guarantees email rendering and SMTP network handshakes NEVER block the… (+10 more)

### Community 45 - "Community 45"
Cohesion: 0.16
Nodes (19): DeviceEnrollmentModal(), CorroborationDetails, getCorroborationDetails(), getCorroborationTag(), BINDING_V2_ENABLED, frontend_src_services_binding_index_bindingmetadata, frontend_src_services_binding_index_bindingstate, frontend_src_services_binding_index_deviceenrollmentrequestpayload (+11 more)

### Community 46 - "Community 46"
Cohesion: 0.10
Nodes (13): _generate_p256_keypair(), New student enrolls public key -> DEVICE_ENROLLED and single active row created., Submitting the same public key again -> BINDING_REFRESH without OTP friction., Enrolling a NEW key when active binding exists -> REBIND_REQUIRED and OTP…, Complete challenge generation, signing, and sub-ms verification., Submitting the same challenge token twice must be rejected with…, A challenge older than 60 seconds is rejected as challenge_expired., 5 signature verification failures trigger 15-minute brute-force lockout. (+5 more)

### Community 47 - "Community 47"
Cohesion: 0.11
Nodes (12): percentile(), Simulate the production concurrency path: check existing → insert → commit,…, 150 distinct students fire mark-attendance simultaneously., 150 students arrive in 10 batches of 15., 30 students rescan after initial mark — must get ALREADY_MARKED, no duplicates., Summary and compliance endpoints report exact counts, no NaN., 300-student burst (2x). Report latency percentiles., Two threads for the SAME student. One SUCCESS, one ALREADY_MARKED. Never… (+4 more)

### Community 48 - "Community 48"
Cohesion: 0.11
Nodes (15): frappe, frappe_model_document, Enforces SAP ID validation for Student DocType., Enforces SAP ID validation for Instructor DocType., validate_instructor_sap_id(), validate_student_sap_id(), Document, Enforces defensive validation rules on SNIST Attendance Session. (+7 more)

### Community 50 - "Community 50"
Cohesion: 0.10
Nodes (18): name, private, type, version, certPath, keyPath, autoprefixer, canvas-confetti (+10 more)

### Community 51 - "Community 51"
Cohesion: 0.10
Nodes (10): 1. Teacher can start an authorized historical session for yesterday and it logs…, 2. Calling start session twice for same class returns the existing session…, 3. Attempting to create a session for tomorrow is strictly rejected (Rule 24), 4. Teacher 2 cannot view or mark attendance for Teacher 1's historical session…, 5. Teacher cannot mark attendance for a student from Section B in a Section A…, 6. Teacher cannot start attendance for unassigned subject (Rule 27), 7. Locked historical session rejects manual attendance marking (Rule 28), 8. Unlocking locked historical session permits editing and records audit log (+2 more)

### Community 52 - "Community 52"
Cohesion: 0.17
Nodes (12): generate_projector_session_token(), get_aes_key(), _int_to_base36(), Generates ultra-compact, high-contrast rotating QR token for teacher classroom…, Validates rotating projector session token. For live online submissions,…, validate_projector_session_token(), Tokens with expired steps or malformed prefixes are strictly rejected., Verify that period_count=144 (or any out-of-bounds count) is strictly clamped… (+4 more)

### Community 53 - "Community 53"
Cohesion: 0.11
Nodes (13): calculate_projected_classes_needed(), calculate_trajectory_projection(), determine_jntuh_band(), Evaluates JNTUH R25 compliance band: >= 75.0 -> ELIGIBLE 65.0 - 74.99 ->…, Trajectory projection service (Week 3 Compliance Engine): - sessions_held =…, Calculates classes needed to reach 75% threshold: Formula specified in task:…, Verify exact JNTUH R25 band boundaries: - 64.99% -> DETAINED - 65.00% ->…, Verify exact band boundary thresholds: - 64.99% -> DETAINED - 65.00% ->… (+5 more)

### Community 54 - "Community 54"
Cohesion: 0.16
Nodes (11): ExcelAttendanceService, Any, Locates student row by Roll Number. Returns row index or -1., Locates today's date column in the date row. If not found, appends a new column…, Service for reading/writing attendance to the official SNIST Excel register.…, Updates attendance in the official SNIST Excel workbook. Preserves all…, Returns all roll numbers from the Excel sheet., Normalize a date cell value into d/m/yy format for comparison. (+3 more)

### Community 55 - "Community 55"
Cohesion: 0.11
Nodes (9): Teacher B cannot access Teacher A's session details or reports., Teacher B cannot submit manual attendance or batch-mark Teacher A's session., Student from Section B cannot be marked in Section A session (manual or student…, Locked sessions reject manual marks, batch marks, token broadcasts, and student…, Scanning twice returns ALREADY_MARKED and maintains exactly 1 database record., Manual mark endpoint strictly validates reason enum., Tampering with token payload HMAC signature or short code is detected and…, Token generated for Session A does not mark attendance for Session B. (+1 more)

### Community 56 - "Community 56"
Cohesion: 0.11
Nodes (9): Verify SystemSettings DB table dynamically overrides scanner engine without…, Verify validation of engine field on telemetry ingestion: jsqr, wasm, and…, Verify /scanner-health reports engine_split and supports ?engine filtering., Verify Week 7 error types: multi_code_detected, multi_qr_rejected,…, Verify Week 7 distance_bucket and decode_scale ingestion and /scanner-health…, Verify invalid distance_bucket is rejected with HTTP 422., Verify the global configuration defaults to a valid scanner engine., Verify GET /api/v1/telemetry/scanner-config returns expected defaults and… (+1 more)

### Community 57 - "Community 57"
Cohesion: 0.22
Nodes (3): containsPii(), ScannerTelemetryManager, ScanTelemetryEvent

### Community 58 - "Community 58"
Cohesion: 0.17
Nodes (17): assert_no_pii(), _check_telemetry_rate_limit(), ingest_scan_telemetry_batch(), PwaInstallTelemetryRequest, Any, BaseModel, post, Request (+9 more)

### Community 59 - "Community 59"
Cohesion: 0.16
Nodes (9): Any, Image, QRService, Generates official SNIST QR poster card with ultra-compact date-bound V2…, Creates a compact QR string from V1 encrypted payload. Format:…, Validates QR payload across V2, V1 compact, and JSON formats., Generates a zip file containing QR pass cards for multiple students., Embeds an official SNIST center badge overlay into the high-error-correction QR… (+1 more)

### Community 60 - "Community 60"
Cohesion: 0.24
Nodes (14): StudentClassScannerModal(), StudentClassScannerModalProps, getBindingState(), frontend_src_services_binding_index_signchallenge, decodeFrame(), decodeWithJsQr(), QrEngineConfig, ScannerEngine (+6 more)

### Community 61 - "Community 61"
Cohesion: 0.11
Nodes (17): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleResolution, noEmit (+9 more)

### Community 62 - "Community 62"
Cohesion: 0.26
Nodes (12): getActiveScannerEngine(), DeviceBucket, DisplayType, DistanceBucket, FailureErrorType, FunnelStage, ScannerEngine, TelemetryBatchPayload (+4 more)

### Community 63 - "Community 63"
Cohesion: 0.12
Nodes (8): Test 4 — Logout Bypass (Device 04 -> 21CS001, Logout, Device 04 -> 21CS002) ->…, Test 5 — Eleven Attempts (Device 05 -> 21CS001 x 10 allowed, Attempt 11…, Test 8 — Storage Clearing Protection (New request without tokens from same…, Test 9 — Current Device API Endpoint, Test 11 — Silent token refresh (/auth/refresh) must not increment attempt_count…, Test 1 — Normal Login (Device 01 -> 21CS001) -> SUCCESS, Test 3 — Different Account (Device 03 -> 21CS001, then Device 03 -> 21CS002) ->…, TestDeviceBindingSecurity

### Community 64 - "Community 64"
Cohesion: 0.16
Nodes (13): claim_launch_token(), get, post, Session, Public endpoint: validates a launch token and returns session metadata. This…, Public endpoint: Immediately validates a fresh launch token upon scan/landing…, validate_launch(), Exception raised when QR / launch token validation fails. (+5 more)

### Community 65 - "Community 65"
Cohesion: 0.23
Nodes (13): generate_cert_with_cryptography(), generate_cert_with_openssl(), get_local_ip(), main(), pathlib, generate_cert_with_cryptography(), generate_cert_with_openssl(), get_local_ip() (+5 more)

### Community 66 - "Community 66"
Cohesion: 0.13
Nodes (8): Under flag-off, a client sending legacy device_uuid receives 410…, Unenrolled student receives 403 no_active_binding with inline CTA when…, Admin enrollment analytics returns enforcement_summary strictly from…, Admin department students list reports device_bound and binding_status from…, Teacher session details reports unbound_students_count and…, Teacher broadcast token reports unbound_students_count and…, Comprehensive cutover test suite verifying that legacy soft-binding is retired,…, TestBindingPhase5Cutover

### Community 68 - "Community 68"
Cohesion: 0.15
Nodes (9): app_core_frappe_sync, Any, Session, Defensively syncs a locked attendance session from FastAPI DB to Frappe ERP., sync_session_to_frappe(), Test 4 — FastAPI Sync Client Gracefully Handles Offline ERP Endpoint, Test 1 — DocType JSON Blueprint validation, Test 2 — Custom Fields Blueprint validation (+1 more)

### Community 69 - "Community 69"
Cohesion: 0.19
Nodes (12): export_funnel_csv(), get_contract_comparison(), get_scanner_engine_config(), get_scanner_health_metrics(), get_telemetry_summary(), get, Session, Client feature flag endpoint for active QR scanner engine. Supports dynamic… (+4 more)

### Community 70 - "Community 70"
Cohesion: 0.14
Nodes (9): Raw QR scan funnel events (retention: 30 days). Strictly NO PII: stores…, ScanTelemetryEvent, Verifies /scanner-health filters by token_format ('short' vs 'legacy')., Verifies accurate aggregation of first-attempt rate and latency percentiles., Verifies that CSV export streams valid CSV headers and data., Validates decode_duration_ms ingestion, schema validation, and rollup…, compute_metrics(), simulate_pilot() (+1 more)

### Community 71 - "Community 71"
Cohesion: 0.21
Nodes (12): Aggregated historical daily scan metrics per device bucket (kept indefinitely).…, ScanTelemetryDailyRollup, calculate_percentile(), datetime, SNIST ERP — Scan Telemetry Daily Rollup & Retention Service Week 1: Measurement…, Calculates percentile from a sorted list of numeric values., Rolls up raw scan telemetry events for target_date (YYYY-MM-DD) into daily…, rollup_scan_telemetry() (+4 more)

### Community 72 - "Community 72"
Cohesion: 0.14
Nodes (6): RapidDeclineResult, Result of rapid decline analysis. Behaves as a 2-tuple (is_rapid, drop) when…, Trend flag: RAPID_DECLINE if last 2 fortnights each dropped >= 5.0%. Student…, RAPID_DECLINE: >=5% drop in each of last 2 periods: - Stable / perfect…, Verify that a student dropping >= 5% in each of the last 2 fortnights triggers…, tuple

### Community 73 - "Community 73"
Cohesion: 0.14
Nodes (4): invalidate_attendance_cache(), Fast cache invalidation on attendance writes (<1 microsecond). Ensures scan…, Verify that approved absences: - When ATTENDANCE_EXCLUDE_APPROVED_ABSENCE is…, Immutability test: 1. Issue a warning when student is at 60.0% (needs 6…

### Community 74 - "Community 74"
Cohesion: 0.14
Nodes (6): Student logging in via 1-click magic link token succeeds and binds device., Student typing lowercase roll number e.g. 23311a05y6 must authenticate…, Student typing uppercase roll number 23311A05Y6 must authenticate successfully., If User.password_hash is out of sync with StudentOnboarding.pin_hash, login…, If User row does not exist yet, login auto-provisions User row and logs student…, TestCaseInsensitiveAndLinkCreds

### Community 75 - "Community 75"
Cohesion: 0.19
Nodes (7): assert(), fetchCalls, getSafeNextDestination(), mockLocalStorage, mockSessionStorage, MockStorage, runTests()

### Community 76 - "Community 76"
Cohesion: 0.23
Nodes (11): argparse, log_fail(), log_pass(), log_warn(), SNIST AI QR Attendance & ERP — Monday 8:00 AM Pre-Flight Check Script…, run_preflight_checks(), log_fail(), log_ok() (+3 more)

### Community 77 - "Community 77"
Cohesion: 0.24
Nodes (9): _base36_to_int(), decrypt_and_validate_qr_payload(), generate_encrypted_qr_payload(), Any, datetime, Universal QR Payload Validator. Supports V2 date-bound format, legacy V2, V1…, TestQRSecurity, bcrypt (+1 more)

### Community 78 - "Community 78"
Cohesion: 0.15
Nodes (8): Decodes URL-safe base64 with auto-padding restoration., _url_safe_b64_decode(), Any, Discovers payload format: Returns (code_or_token, v, format_type) format_type…, Dual-format validation wrapper: Accepts BOTH legacy full-token and new…, Verifies delimited and separate parameter variations of short token., Fuzzes token parser with 200 corrupted inputs, verifying zero 500 server…, Measures ShortTokenService lookup overhead on memory cache hits.

### Community 79 - "Community 79"
Cohesion: 0.15
Nodes (7): Verify that once an active binding is revoked (revoked_at IS NOT NULL), a new…, Verify audit retention: a student can accumulate multiple revoked rows over…, PRIME DIRECTIVE TEST: Spawn 10 concurrent threads attempting to enroll active…, EDGE CASE: Shared phone (User Case B5). Two different students enroll on the…, Verify that attempting to insert two active (revoked_at IS NULL) bindings for…, TestBindingSchemaRace, attempt_enrollment()

### Community 80 - "Community 80"
Cohesion: 0.15
Nodes (6): Verify that when the access token has expired, /auth/refresh with refresh token…, Verify that when refresh token itself has expired (> 12h), /auth/refresh…, Requirement R2: Re-login from same bound device is allowed up to 10x per…, Requirement R3: Failed attempts (wrong password) do NOT penalize successful…, Rule 6: Device bound to Student A cannot switch to Student B within 30 min ->…, TestSessionStabilityAndAuthHardening

### Community 81 - "Community 81"
Cohesion: 0.31
Nodes (12): qrcode, qrcode_constants, apply_blur(), apply_glare(), apply_low_light_noise(), apply_occlusion(), apply_small_frame(), generate_benchmark_corpus() (+4 more)

### Community 82 - "Community 82"
Cohesion: 0.18
Nodes (12): ref_url, FIXTURES_DIR, frontendModules, fs, main(), jsQR, MANIFEST_PATH, OUTPUT_JSON_PATH (+4 more)

### Community 83 - "Community 83"
Cohesion: 0.18
Nodes (12): Request, UploadFile, Post-attendance selfie upload endpoint. Saves image into private object storage…, upload_attendance_selfie(), _get_image_metadata(), Any, Session, Records that a selfie was skipped or failed. CRITICAL RULE: Never invalidates… (+4 more)

### Community 84 - "Community 84"
Cohesion: 0.17
Nodes (7): EMAIL_TEMPLATE_DIR must not contain host-absolute production paths., Verifies all email templates exist and render without errors., EMAIL_TEMPLATE_DIR must point to an existing directory., Templates must live inside the versioned app/ tree, not in data/., Every referenced template file must exist on disk., Every template must render with sample context without producing error output., TestEmailTemplates

### Community 85 - "Community 85"
Cohesion: 0.17
Nodes (12): dependencies, canvas-confetti, html5-qrcode, jsqr, lucide-react, mermaid, qrcode, react (+4 more)

### Community 86 - "Community 86"
Cohesion: 0.18
Nodes (8): ref_perf_hooks, bufferToBase64(), ECDSA_ALGO, fs, path, { performance }, runTestSuite(), SIGN_ALGO

### Community 87 - "Community 87"
Cohesion: 0.18
Nodes (11): FIXTURES_DIR, frontendModules, fs, jsQR, main(), MANIFEST_PATH, path, { pathToFileURL } (+3 more)

### Community 88 - "Community 88"
Cohesion: 0.20
Nodes (11): global_defensive_exception_handler(), http_exception_handler(), get, Request, Public entry point redirector: Serves the SPA index.html so React Router…, redirect_launch_token_to_frontend(), root_status(), serve_spa() (+3 more)

### Community 89 - "Community 89"
Cohesion: 0.20
Nodes (10): admin_token(), clean_dependency_overrides(), fixture, Automated tests for Auth Error Contracts and Admin Quick-Reset Fallback: - 401…, Verify admin quick-reset endpoint generates 6-digit PIN and resets locks., Verify admin can look up student details and edit student email via quick-reset., Verify that wrong password returns 401 with attempts_remaining in body and…, test_admin_lookup_and_edit_email() (+2 more)

### Community 90 - "Community 90"
Cohesion: 0.18
Nodes (11): devDependencies, autoprefixer, postcss, tailwindcss, @types/canvas-confetti, @types/react, @types/react-dom, typescript (+3 more)

### Community 91 - "Community 91"
Cohesion: 0.22
Nodes (8): data, jsqrRes, raw, t0, t1, ref_fs, jsqr, zxing-wasm

### Community 92 - "Community 92"
Cohesion: 0.20
Nodes (10): ref_path, FIXTURES_DIR, frontendModules, fs, main(), jsQR, processVideoFrame(), path (+2 more)

### Community 93 - "Community 93"
Cohesion: 0.20
Nodes (5): Concurrent or repeated session start requests converge onto the identical…, Attempting to create a session or retrieve QR for a future date is rejected., Unauthenticated requests to protected endpoints return 401 Unauthorized., Students cannot hit teacher/admin endpoints; Teachers cannot hit admin…, TestPhase9SecurityAndIntegrity

### Community 94 - "Community 94"
Cohesion: 0.20
Nodes (7): ref_k6, CompletedScans, options, SubmitFailureRate, SubmitLatency, TelemetryFailureRate, TelemetryLatency

### Community 95 - "Community 95"
Cohesion: 0.20
Nodes (9): app_color, app_description, app_email, app_icon, app_license, app_name, app_publisher, app_title (+1 more)

### Community 96 - "Community 96"
Cohesion: 0.25
Nodes (9): api_route, check_db_health(), Executes a fast active probe against the database (SELECT 1) and returns…, comprehensive_health_check(), liveness_probe(), Fast liveness probe: verifies the FastAPI application process is up and…, Readiness probe: verifies remote database connectivity and response latency.…, Live Production Health Check Probe (backward-compatible). Checks remote MySQL… (+1 more)

### Community 97 - "Community 97"
Cohesion: 0.25
Nodes (4): _async_post_scan_tasks(), BoundedLRUSessionCache, Any, Thread-safe bounded LRU session cache with TTL eviction to prevent memory…

### Community 98 - "Community 98"
Cohesion: 0.22
Nodes (7): BaseSettings, R25Config, Canonical Institutional Single Source of Truth for JNTUH R25 Regulations.…, Sanitized public frontend portal URL. Guarantees that local dev/hosts URLs…, Settings, dotenv, pydantic_settings

### Community 99 - "Community 99"
Cohesion: 0.25
Nodes (9): consume_claim(), _get_launch_signing_key(), Any, Validates a claim ticket signature, freshness, and single-use status WITHOUT…, Atomically marks a claim ticket as consumed upon successful attendance., Returns the HMAC signing key for launch tokens. Reuses the existing…, Validates and atomically consumes a claim ticket (single-use)., validate_and_consume_claim() (+1 more)

### Community 101 - "Community 101"
Cohesion: 0.29
Nodes (7): main(), Executes 100-student burst submission test., Simulates background telemetry flood concurrent with operations., run_burst_test(), get_thread_client(), submit_scan(), run_telemetry_flood_test()

### Community 102 - "Community 102"
Cohesion: 0.29
Nodes (6): purge_old_scan_telemetry(), Session, Deletes raw scan telemetry events older than retention_days. Preserves…, Verifies that purge deletes events > 30 days old and retains recent ones., Verifies sustained rollup/purge coexistence and runs EXPLAIN query plan checks., run_coexistence_and_explain_test()

### Community 103 - "Community 103"
Cohesion: 0.47
Nodes (5): asyncio, main(), run_login_tier(), send_login_request(), httpx

### Community 104 - "Community 104"
Cohesion: 0.33
Nodes (3): Generates an extra-large, ultra-high-contrast QR matrix specifically designed…, Verify that short-token payload with ECC Level L renders with significantly…, Verify that dark_mode=True renders pure white modules on solid black background…

### Community 105 - "Community 105"
Cohesion: 0.33
Nodes (5): ClassDetailRoster(), ClassDetailRosterProps, RosterFilter, SessionDetailResponse, StudentRow

### Community 106 - "Community 106"
Cohesion: 0.40
Nodes (5): LaunchAttendRequest, LaunchClaimRequest, BaseModel, Request body for immediately claiming a launch token upon landing., Request body for submitting attendance via a launch token or claim ticket.

### Community 108 - "Community 108"
Cohesion: 0.50
Nodes (4): scripts, build, dev, preview

### Community 109 - "Community 109"
Cohesion: 0.50
Nodes (4): derive_client_secret(), fnv1a_hash(), Python replica of frontend fnv1aHash in deviceCredential.ts, Replicates client-side canonicalHwSecret calculation from deviceCredential.ts

### Community 110 - "Community 110"
Cohesion: 0.67
Nodes (3): calculate_sensor_pixels_per_module(), run_device_matrix_lab(), simulate_scan_attempt()

## Knowledge Gaps
- **216 isolated node(s):** `ClassDetailRosterProps`, `RosterFilter`, `SessionDetailResponse`, `StudentRow`, `DefaulterStudent` (+211 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 1272 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **39 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `User` connect `Community 0` to `Community 1`, `Community 2`, `Community 3`, `Community 4`, `Community 5`, `Community 6`, `Community 8`, `Community 10`, `Community 13`, `Community 15`, `Community 16`, `Community 17`, `Community 18`, `Community 19`, `Community 20`, `Community 24`, `Community 25`, `Community 27`, `Community 28`, `Community 32`, `Community 33`, `Community 35`, `Community 36`, `Community 37`, `Community 39`, `Community 40`, `Community 41`, `Community 43`, `Community 51`, `Community 56`, `Community 58`, `Community 63`, `Community 66`, `Community 67`, `Community 68`, `Community 69`, `Community 74`, `Community 80`, `Community 89`, `Community 93`, `Community 110`?**
  _High betweenness centrality (0.097) - this node is a cross-community bridge._
- **Why does `Student` connect `Community 0` to `Community 1`, `Community 2`, `Community 3`, `Community 4`, `Community 5`, `Community 6`, `Community 8`, `Community 9`, `Community 10`, `Community 13`, `Community 15`, `Community 16`, `Community 17`, `Community 18`, `Community 19`, `Community 20`, `Community 24`, `Community 25`, `Community 27`, `Community 28`, `Community 32`, `Community 33`, `Community 35`, `Community 37`, `Community 39`, `Community 40`, `Community 43`, `Community 44`, `Community 51`, `Community 63`, `Community 66`, `Community 67`, `Community 68`, `Community 79`, `Community 80`, `Community 83`, `Community 89`, `Community 93`?**
  _High betweenness centrality (0.072) - this node is a cross-community bridge._
- **Why does `AttendanceSession` connect `Community 3` to `Community 0`, `Community 1`, `Community 4`, `Community 6`, `Community 8`, `Community 10`, `Community 13`, `Community 15`, `Community 20`, `Community 21`, `Community 24`, `Community 32`, `Community 35`, `Community 39`, `Community 43`, `Community 47`, `Community 51`, `Community 55`, `Community 63`, `Community 64`, `Community 66`, `Community 67`, `Community 68`, `Community 73`, `Community 93`, `Community 96`?**
  _High betweenness centrality (0.060) - this node is a cross-community bridge._
- **Are the 175 inferred relationships involving `User` (e.g. with `assign_teacher()` and `create_department()`) actually correct?**
  _`User` has 175 INFERRED edges - model-reasoned connections that need verification._
- **Are the 133 inferred relationships involving `Student` (e.g. with `create_student()` and `dispatch_credentials()`) actually correct?**
  _`Student` has 133 INFERRED edges - model-reasoned connections that need verification._
- **Are the 73 inferred relationships involving `AttendanceSession` (e.g. with `get_dashboard_stats()` and `batch_mark_session_attendance()`) actually correct?**
  _`AttendanceSession` has 73 INFERRED edges - model-reasoned connections that need verification._
- **Are the 120 inferred relationships involving `UserRole` (e.g. with `create_student()` and `create_teacher()`) actually correct?**
  _`UserRole` has 120 INFERRED edges - model-reasoned connections that need verification._