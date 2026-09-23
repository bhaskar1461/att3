import os
try:
    from dotenv import load_dotenv
    _backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    _root_dir = os.path.dirname(_backend_dir)
    # Load environment files without overwriting process environment variables passed by Docker/shell
    load_dotenv(os.path.join(_root_dir, ".env"), override=False)
    load_dotenv(os.path.join(_backend_dir, ".env"), override=False)
    load_dotenv(override=False)
except ImportError:
    pass

try:
    from pydantic_settings import BaseSettings
except ImportError:
    try:
        from pydantic import BaseSettings
    except ImportError:
        class BaseSettings:
            pass

class Settings:
    PROJECT_NAME: str = "AI QR Attendance System"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"
    
    # Secret keys
    SECRET_KEY: str = os.getenv("SECRET_KEY", "8f3b2a19e5d4c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2")
    QR_SECRET_KEY: str = os.getenv("QR_SECRET_KEY", "a1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdef") # 32 bytes hex for AES
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days for staff/admin
    STUDENT_TOKEN_EXPIRE_SECONDS: int = 900  # 15 minutes for student session access tokens (survives attendance scan windows)
    REFRESH_TOKEN_EXPIRE_HOURS: int = 12  # 12 hours school-day validity for sliding refresh tokens
    DEVICE_BINDING_MINUTES: int = 30  # 30 minutes server device lock
    MAX_BINDING_AUTH_ATTEMPTS: int = 10  # Max 10 successful re-logins from bound device per 15-min window
    MAX_FAILED_LOGIN_ATTEMPTS: int = 5  # Max 5 failed attempts per 15 min per roll
    LOGIN_RATE_LIMIT_WINDOW_SECONDS: int = 900  # 15 minutes window for login rate limits
    TOKEN_GRACE_SECONDS: float = float(os.getenv("TOKEN_GRACE_SECONDS", "3.0"))  # 3s grace window for rotating QR token boundary
    
    # Database
    # config.py is at backend/app/core/config.py -> 3 dirnames = backend, 4 dirnames = project root
    BACKEND_DIR: str = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    BASE_DIR: str = os.path.dirname(BACKEND_DIR)
    DATABASE_URL: str = os.getenv("DATABASE_URL", "mysql+pymysql://demo:Admin%40321%23@seg-dev.sreenidhi.edu.in:3306/seg_demo")
    
    # Storage Paths
    DATA_DIR: str = os.path.join(BACKEND_DIR, "data")
    MASTER_TEMPLATE_DIR: str = os.path.join(DATA_DIR, "master_templates")
    OUTPUT_EXCEL_DIR: str = os.path.join(DATA_DIR, "outputs")
    QR_OUTPUT_DIR: str = os.path.join(DATA_DIR, "qr_codes")
    SELFIE_STORAGE_DIR: str = os.path.join(DATA_DIR, "selfies")
    
    # Google Sheets Settings (Optional)
    GOOGLE_CREDENTIALS_FILE: str = os.getenv("GOOGLE_CREDENTIALS_FILE", "")
    GOOGLE_SPREADSHEET_ID: str = os.getenv("GOOGLE_SPREADSHEET_ID", "113b1RKUGQGHtoViEFJjgeGxD1VzxaGgSAn0Guxh_ni8")

    # --- Primary SMTP Configuration (helpdesk@sreenidhi.edu.in — Magic Links & Notices) ---
    SMTP_HOST: str = os.getenv("SMTP_HOST", "smtp.gmail.com")
    SMTP_PORT: int = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USER: str = os.getenv("SMTP_USER", "helpdesk@sreenidhi.edu.in")
    SMTP_PASSWORD: str = os.getenv("SMTP_PASSWORD", "")  # App password — set via env var
    SMTP_USE_TLS: bool = os.getenv("SMTP_USE_TLS", "True").lower() == "true"
    SMTP_SENDER: str = os.getenv("SMTP_SENDER", "helpdesk@sreenidhi.edu.in")
    SMTP_SENDER_NAME: str = os.getenv("SMTP_SENDER_NAME", "SNIST ERP System")

    # --- Secondary SMTP Configuration for OTP & Login (Proofsy Zoho Mail) ---
    SMTP_OTP_HOST: str = os.getenv("SMTP_OTP_HOST", os.getenv("SMTP_HOST_OTP", "smtp.zoho.in"))
    SMTP_OTP_PORT: int = int(os.getenv("SMTP_OTP_PORT", "465"))
    SMTP_OTP_USER: str = os.getenv("SMTP_OTP_USER", os.getenv("SMTP_USER", "bhaskar@proofsy.tech"))
    SMTP_OTP_PASSWORD: str = os.getenv("SMTP_OTP_PASSWORD", os.getenv("SMTP_OTP_PASS", os.getenv("SMTP_PASS", "")))
    SMTP_OTP_USE_SSL: bool = os.getenv("SMTP_OTP_USE_SSL", os.getenv("SMTP_SECURE", "true")).lower() == "true"
    SMTP_OTP_SENDER: str = os.getenv("SMTP_OTP_SENDER", os.getenv("EMAIL_FROM", "bhaskar@proofsy.tech"))
    SMTP_OTP_SENDER_NAME: str = os.getenv("SMTP_OTP_SENDER_NAME", os.getenv("EMAIL_FROM_NAME", "SNIST ERP Security Monitor"))
    SMTP_OTP_REPLY_TO: str = os.getenv("SMTP_OTP_REPLY_TO", os.getenv("EMAIL_REPLY_TO", "support@proofsy.tech"))

    # --- Onboarding Configuration ---
    FRONTEND_URL: str = os.getenv("FRONTEND_URL", "")  # Azure/Cloudflare tunnel URL; fallback to request Host

    @property
    def public_frontend_url(self) -> str:
        """
        Sanitized public frontend portal URL.
        Guarantees that local dev/hosts URLs (e.g. whiteleos, localhost, 127.0.0.1)
        or empty configurations never leak into student or faculty emails.
        """
        raw = (self.FRONTEND_URL or "").strip().rstrip("/")
        if not raw or "whiteleos" in raw.lower() or "localhost" in raw.lower() or "127.0.0.1" in raw:
            return "https://ather-os.de5.net"
        return raw
    MAGIC_LINK_EXPIRY_HOURS: int = int(os.getenv("MAGIC_LINK_EXPIRY_HOURS", "48"))
    OTP_EXPIRY_MINUTES: int = int(os.getenv("OTP_EXPIRY_MINUTES", "10"))
    OTP_MAX_ATTEMPTS: int = int(os.getenv("OTP_MAX_ATTEMPTS", "5"))
    OTP_MAX_REQUESTS_PER_HOUR: int = int(os.getenv("OTP_MAX_REQUESTS_PER_HOUR", "5"))
    MAX_DEVICE_REBINDS_PER_SEMESTER: int = int(os.getenv("MAX_DEVICE_REBINDS_PER_SEMESTER", "5"))
    STUDENT_PIN_MIN_LENGTH: int = 4
    STUDENT_PIN_MAX_LENGTH: int = 6

    # --- Credential Dispatch Configuration ---
    MAX_BATCH_SIZE: int = int(os.getenv("MAX_BATCH_SIZE", "500"))
    EMAIL_BATCH_CHUNK_SIZE: int = int(os.getenv("EMAIL_BATCH_CHUNK_SIZE", "25"))  # Emails per chunk
    EMAIL_BATCH_DELAY_SECONDS: float = float(os.getenv("EMAIL_BATCH_DELAY_SECONDS", "2.0"))  # Delay between chunks

    # --- Security Alerting & Detection System Configuration ---
    # HALTED for Testing Phase per user instruction
    SECURITY_ALERT_EMAIL: str = os.getenv("SECURITY_ALERT_EMAIL", "23311a05y6@cse.sreenidhi.edu.in")
    SECURITY_ALERTS_ENABLED: bool = os.getenv("SECURITY_ALERTS_ENABLED", "False").lower() == "true"
    SECURITY_ALERT_COOLDOWN_MIN: int = int(os.getenv("SECURITY_ALERT_COOLDOWN_MIN", "10"))
    SECURITY_DIGEST_ENABLED: bool = os.getenv("SECURITY_DIGEST_ENABLED", "False").lower() == "true"
    SECURITY_DIGEST_START_HOUR: int = int(os.getenv("SECURITY_DIGEST_START_HOUR", "9"))  # 09:00 IST
    SECURITY_DIGEST_END_HOUR: int = int(os.getenv("SECURITY_DIGEST_END_HOUR", "17"))    # 17:00 IST

    # --- Email Template Directory (versioned source, not runtime data) ---
    EMAIL_TEMPLATE_DIR: str = os.path.join(BACKEND_DIR, "app", "templates")

    # --- JNTUH R25 Attendance Compliance Module Configuration ---
    JNTUH_ELIGIBLE_THRESHOLD: float = float(os.getenv("JNTUH_ELIGIBLE_THRESHOLD", "75.0"))
    JNTUH_CONDONABLE_THRESHOLD: float = float(os.getenv("JNTUH_CONDONABLE_THRESHOLD", "65.0"))
    JNTUH_INCLUDE_APPROVED_ABSENCES: bool = os.getenv("JNTUH_INCLUDE_APPROVED_ABSENCES", "True").lower() == "true"
    DEFAULT_SEMESTER_SESSIONS: int = int(os.getenv("DEFAULT_SEMESTER_SESSIONS", "60"))
    MIN_SESSIONS_THRESHOLD: int = int(os.getenv("MIN_SESSIONS_THRESHOLD", "3"))

    # --- Week 4 Production Pilot: Dynamic QR Token Format Configuration ---
    # Allowed values: "legacy" | "short" | "dual" (default "dual" for production rollout)
    QR_TOKEN_FORMAT: str = os.getenv("QR_TOKEN_FORMAT", "dual").lower().strip()
    QR_PILOT_SECTIONS: str = os.getenv("QR_PILOT_SECTIONS", "1,2")
    QR_PILOT_DEPARTMENTS: str = os.getenv("QR_PILOT_DEPARTMENTS", "CSE,ECE")

    # --- Week 5 QR Display Tuning: Rendering Pipeline Configuration ---
    # Allowed values: "v1" (legacy standard) | "v2" (pure high-contrast, edge-to-edge, ECC L, zero-chrome)
    QR_RENDER_VERSION: str = os.getenv("QR_RENDER_VERSION", "v2").lower().strip()
    QR_ECC_LEVEL: str = os.getenv("QR_ECC_LEVEL", "L").upper().strip()  # "L" | "M"
    QR_RENDER_PILOT_SECTIONS: str = os.getenv("QR_RENDER_PILOT_SECTIONS", "1,2")

    # --- Week 8 Scanner Engine Feature Flag Configuration ---
    # Allowed values: "wasm" (default per W7 pre-registered GO verdict) | "jsqr" (instant rollback)
    SCANNER_ENGINE: str = os.getenv("SCANNER_ENGINE", "wasm").lower().strip()

    # --- Week 8 Manual Mark Guardrail & Anomaly Threshold Configurations ---
    MANUAL_MARK_AMBER_THRESHOLD_PCT: float = float(os.getenv("MANUAL_MARK_AMBER_THRESHOLD_PCT", "15.0"))
    MANUAL_MARK_RED_THRESHOLD_PCT: float = float(os.getenv("MANUAL_MARK_RED_THRESHOLD_PCT", "30.0"))
    MANUAL_MARK_MAX_PER_SESSION_CAP: int = int(os.getenv("MANUAL_MARK_MAX_PER_SESSION_CAP", "25"))

    # --- Week 9 Scale & Offline Resilience Configuration ---
    # Bounded window (minutes) post-session-end where queued offline submissions are accepted (anti-proxy boundary)
    SUBMIT_GRACE_MINUTES: int = int(os.getenv("SUBMIT_GRACE_MINUTES", "10"))
    # Cohort rollout active departments (comma-separated, e.g. "CSE,ECE,IT,MECH,CIVIL,EEE,AIML")
    ACTIVE_ROLLOUT_DEPARTMENTS: str = os.getenv("ACTIVE_ROLLOUT_DEPARTMENTS", "CSE,ECE,IT,MECH,CIVIL,EEE,AIML")

    # --- Device Binding V2 Configuration (Phase 5 Cutover: Default ON in Dev) ---
    # When True: Single cryptographic truth active; legacy device ID checks bypassed.
    # When False: Dev-only legacy test mode; scan rejects legacy IDs with legacy_binding_retired error.
    BINDING_V2: bool = os.getenv("BINDING_V2", "true").lower() == "true"
    ENROLL_LIMIT_30_DAYS: int = int(os.getenv("ENROLL_LIMIT_30_DAYS", "2"))
    MAX_ACTIVE_DEVICES_PER_STUDENT: int = int(os.getenv("MAX_ACTIVE_DEVICES_PER_STUDENT", "1"))
    CHALLENGE_TTL_SECONDS: int = int(os.getenv("CHALLENGE_TTL_SECONDS", "60"))
    MAX_VERIFY_FAILURES_BEFORE_LOCKOUT: int = int(os.getenv("MAX_VERIFY_FAILURES_BEFORE_LOCKOUT", "5"))
    BINDING_VERIFY_LOCKOUT_MINUTES: int = int(os.getenv("BINDING_VERIFY_LOCKOUT_MINUTES", "15"))

    # --- Phase 12A: Universal Projector Entry Configuration ---
    # Canonical HTTPS base URL for launch token URLs (empty = auto-detect from request origin)
    ATTENDANCE_BASE_URL: str = os.getenv("ATTENDANCE_BASE_URL", "")
    # Extended grace window (seconds) for URL-based flow (student needs time to tap URL, load page, auth)
    LAUNCH_TOKEN_GRACE_SECONDS: int = int(os.getenv("LAUNCH_TOKEN_GRACE_SECONDS", "30"))

    # --- Geofence Configuration (Disabled for indoor classroom scanning) ---
    GEOFENCE_ENABLED: bool = os.getenv("GEOFENCE_ENABLED", "False").lower() == "true"

class R25Config:
    """
    Canonical Institutional Single Source of Truth for JNTUH R25 Regulations.
    Guarantees no magic numbers remain across the codebase.
    """
    ELIGIBLE_THRESHOLD: float = float(os.getenv("JNTUH_ELIGIBLE_THRESHOLD", "75.0"))
    CONDONABLE_THRESHOLD: float = float(os.getenv("JNTUH_CONDONABLE_THRESHOLD", "65.0"))
    MIN_SESSIONS_THRESHOLD: int = int(os.getenv("MIN_SESSIONS_THRESHOLD", "3"))
    DEFAULT_SEMESTER_SESSIONS: int = int(os.getenv("DEFAULT_SEMESTER_SESSIONS", "60"))
    INCLUDE_APPROVED_ABSENCES: bool = os.getenv("JNTUH_INCLUDE_APPROVED_ABSENCES", "True").lower() == "true"

settings = Settings()

# Ensure directories exist
os.makedirs(settings.MASTER_TEMPLATE_DIR, exist_ok=True)
os.makedirs(settings.OUTPUT_EXCEL_DIR, exist_ok=True)
os.makedirs(settings.QR_OUTPUT_DIR, exist_ok=True)
# Note: EMAIL_TEMPLATE_DIR is now inside app/templates/ (versioned source) — no makedirs needed
