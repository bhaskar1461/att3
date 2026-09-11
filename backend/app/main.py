from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.database import engine, Base
from app.api import auth, admin, teacher, attendance, student, reports, devices, telemetry, compliance_analytics, defaulters

# Onboarding & Credential Dispatch routers (defensive import — never crash if module has issues)
try:
    from app.api import onboarding as onboarding_router
    from app.api import admin_onboarding as admin_onboarding_router
    from app.api import admin_credentials as admin_credentials_router
    _onboarding_modules_loaded = True
except Exception as _import_err:
    import logging as _logging
    _logging.getLogger("snist_erp").error(f"Failed to import onboarding modules: {_import_err}", exc_info=True)
    _onboarding_modules_loaded = False

import logging
from fastapi.responses import JSONResponse
from fastapi.requests import Request

# Configure structured application logger
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("snist_erp")

# Create DB tables automatically with defensive error logging
try:
    Base.metadata.create_all(bind=engine)
    logger.info("Database base tables verified successfully.")
except Exception as err:
    logger.warning(f"Database table verification warning (non-fatal): {err}")

def _run_defensive_schema_migrations():
    """
    Defensively adds new schema columns to existing tables if missing (SQLite and MariaDB/MySQL).
    Wrapped in try-except so deployment never crashes on migration errors (Rule 9).
    """
    try:
        from sqlalchemy import inspect, text
        inspector = inspect(engine)
        tables = inspector.get_table_names()
        
        # Check qr_students for join_date and nullable department_id
        if "qr_students" in tables:
            student_cols = [col["name"] for col in inspector.get_columns("qr_students")]
            with engine.connect() as conn:
                if "join_date" not in student_cols:
                    logger.info("Migrating schema: adding join_date column to qr_students")
                    conn.execute(text("ALTER TABLE qr_students ADD COLUMN join_date VARCHAR(20) NULL"))
                # Make department_id nullable in MySQL/MariaDB if currently not null
                try:
                    if not engine.url.drivername.startswith("sqlite"):
                        conn.execute(text("ALTER TABLE qr_students MODIFY COLUMN department_id INT NULL"))
                        conn.execute(text("ALTER TABLE qr_students MODIFY COLUMN academic_year_id INT NULL"))
                        conn.execute(text("ALTER TABLE qr_students MODIFY COLUMN section_id INT NULL"))
                except Exception as mod_err:
                    pass
                conn.commit()

        # Check qr_attendance_records for is_approved_absence and approved_absence_reason
        if "qr_attendance_records" in tables:
            att_cols = [col["name"] for col in inspector.get_columns("qr_attendance_records")]
            with engine.connect() as conn:
                if "is_approved_absence" not in att_cols:
                    logger.info("Migrating schema: adding is_approved_absence column to qr_attendance_records")
                    conn.execute(text("ALTER TABLE qr_attendance_records ADD COLUMN is_approved_absence BOOLEAN DEFAULT 0"))
                if "approved_absence_reason" not in att_cols:
                    logger.info("Migrating schema: adding approved_absence_reason column to qr_attendance_records")
                    conn.execute(text("ALTER TABLE qr_attendance_records ADD COLUMN approved_absence_reason VARCHAR(100) NULL"))
                conn.commit()

        # Ensure performant composite indexes exist
        if "qr_attendance_sessions" in tables:
            sess_indexes = [idx["name"] for idx in inspector.get_indexes("qr_attendance_sessions")]
            with engine.connect() as conn:
                if "idx_att_sess_subject_date" not in sess_indexes:
                    try:
                        conn.execute(text("CREATE INDEX idx_att_sess_subject_date ON qr_attendance_sessions (subject_id, session_date)"))
                        conn.commit()
                    except Exception:
                        pass
                if "idx_att_sess_section_date" not in sess_indexes:
                    try:
                        conn.execute(text("CREATE INDEX idx_att_sess_section_date ON qr_attendance_sessions (section_id, session_date)"))
                        conn.commit()
                    except Exception:
                        pass

        if "qr_student_warnings" in tables:
            warn_indexes = [idx["name"] for idx in inspector.get_indexes("qr_student_warnings")]
            with engine.connect() as conn:
                if "idx_warning_student_course" not in warn_indexes:
                    try:
                        conn.execute(text("CREATE INDEX idx_warning_student_course ON qr_student_warnings (student_id, course_id)"))
                        conn.commit()
                    except Exception:
                        pass

        # Check qr_semesters and backfill default active semester if empty
        if "qr_semesters" in tables:
            with engine.connect() as conn:
                res = conn.execute(text("SELECT COUNT(*) FROM qr_semesters")).scalar()
                if res == 0:
                    logger.info("Backfilling default active semester in qr_semesters")
                    conn.execute(text(
                        "INSERT INTO qr_semesters (name, start_date, end_date, total_planned_sessions, is_active, created_at) "
                        "VALUES ('Odd Semester 2026-27', '2026-07-01', '2026-11-30', 60, 1, CURRENT_TIMESTAMP)"
                    ))
                    conn.commit()

        # Ensure telemetry tables exist if create_all skipped
        if "qr_scan_telemetry_events" not in tables or "qr_scan_telemetry_daily_rollup" not in tables:
            try:
                Base.metadata.create_all(bind=engine, tables=[
                    Base.metadata.tables["qr_scan_telemetry_events"],
                    Base.metadata.tables["qr_scan_telemetry_daily_rollup"]
                ])
                logger.info("Created missing scan telemetry tables.")
            except Exception as tel_err:
                logger.warning(f"Telemetry table creation notice (non-fatal): {tel_err}")

        # Check qr_attendance_sessions for display_type
        if "qr_attendance_sessions" in tables:
            sess_cols = [col["name"] for col in inspector.get_columns("qr_attendance_sessions")]
            with engine.connect() as conn:
                if "display_type" not in sess_cols:
                    logger.info("Migrating schema: adding display_type column to qr_attendance_sessions")
                    try:
                        conn.execute(text("ALTER TABLE qr_attendance_sessions ADD COLUMN display_type VARCHAR(30) DEFAULT 'projector' NULL"))
                        conn.commit()
                    except Exception as err:
                        logger.warning(f"Failed to add display_type to qr_attendance_sessions: {err}")

        # Check qr_scan_telemetry_events for decode_duration_ms and display_type
        if "qr_scan_telemetry_events" in tables:
            tel_cols = [col["name"] for col in inspector.get_columns("qr_scan_telemetry_events")]
            with engine.connect() as conn:
                if "decode_duration_ms" not in tel_cols:
                    logger.info("Migrating schema: adding decode_duration_ms to qr_scan_telemetry_events")
                    try:
                        conn.execute(text("ALTER TABLE qr_scan_telemetry_events ADD COLUMN decode_duration_ms FLOAT NULL"))
                        conn.commit()
                    except Exception as err:
                        logger.warning(f"Failed to add decode_duration_ms: {err}")
                if "display_type" not in tel_cols:
                    logger.info("Migrating schema: adding display_type to qr_scan_telemetry_events")
                    try:
                        conn.execute(text("ALTER TABLE qr_scan_telemetry_events ADD COLUMN display_type VARCHAR(30) DEFAULT 'projector' NULL"))
                        conn.commit()
                    except Exception as err:
                        logger.warning(f"Failed to add display_type: {err}")

        # Check qr_scan_telemetry_daily_rollup for decode histogram fields
        if "qr_scan_telemetry_daily_rollup" in tables:
            rollup_cols = [col["name"] for col in inspector.get_columns("qr_scan_telemetry_daily_rollup")]
            with engine.connect() as conn:
                if "decode_p50_ms" not in rollup_cols:
                    logger.info("Migrating schema: adding decode_p50_ms to qr_scan_telemetry_daily_rollup")
                    try:
                        conn.execute(text("ALTER TABLE qr_scan_telemetry_daily_rollup ADD COLUMN decode_p50_ms FLOAT NULL"))
                        conn.commit()
                    except Exception as err:
                        logger.warning(f"Failed to add decode_p50_ms: {err}")
                if "decode_p95_ms" not in rollup_cols:
                    logger.info("Migrating schema: adding decode_p95_ms to qr_scan_telemetry_daily_rollup")
                    try:
                        conn.execute(text("ALTER TABLE qr_scan_telemetry_daily_rollup ADD COLUMN decode_p95_ms FLOAT NULL"))
                        conn.commit()
                    except Exception as err:
                        logger.warning(f"Failed to add decode_p95_ms: {err}")
                if "decode_histogram_json" not in rollup_cols:
                    logger.info("Migrating schema: adding decode_histogram_json to qr_scan_telemetry_daily_rollup")
                    try:
                        conn.execute(text("ALTER TABLE qr_scan_telemetry_daily_rollup ADD COLUMN decode_histogram_json TEXT NULL"))
                        conn.commit()
                    except Exception as err:
                        logger.warning(f"Failed to add decode_histogram_json: {err}")
                if "legacy_format_count" not in rollup_cols:
                    logger.info("Migrating schema: adding legacy_format_count to qr_scan_telemetry_daily_rollup")
                    try:
                        conn.execute(text("ALTER TABLE qr_scan_telemetry_daily_rollup ADD COLUMN legacy_format_count INT DEFAULT 0 NOT NULL"))
                        conn.commit()
                    except Exception as err:
                        logger.warning(f"Failed to add legacy_format_count: {err}")
                if "short_format_count" not in rollup_cols:
                    logger.info("Migrating schema: adding short_format_count to qr_scan_telemetry_daily_rollup")
                    try:
                        conn.execute(text("ALTER TABLE qr_scan_telemetry_daily_rollup ADD COLUMN short_format_count INT DEFAULT 0 NOT NULL"))
                        conn.commit()
                    except Exception as err:
                        logger.warning(f"Failed to add short_format_count: {err}")

        # Ensure qr_short_tokens table exists
        if "qr_short_tokens" not in tables:
            try:
                Base.metadata.create_all(bind=engine, tables=[Base.metadata.tables["qr_short_tokens"]])
                logger.info("Created missing qr_short_tokens table.")
            except Exception as st_err:
                try:
                    with engine.connect() as conn:
                        conn.execute(text("""
                            CREATE TABLE IF NOT EXISTS qr_short_tokens (
                                id INT AUTO_INCREMENT PRIMARY KEY,
                                short_code VARCHAR(16) NOT NULL UNIQUE,
                                session_id INT NOT NULL,
                                issued_slot INT NOT NULL,
                                expires_slot INT NOT NULL,
                                is_active TINYINT(1) DEFAULT 1 NOT NULL,
                                created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                                INDEX idx_short_token_code (short_code),
                                INDEX idx_short_token_session (session_id)
                            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                        """))
                        conn.commit()
                    logger.info("Created missing qr_short_tokens table via fallback DDL.")
                except Exception as fallback_err:
                    logger.warning(f"qr_short_tokens table creation notice: {st_err} | Fallback: {fallback_err}")

        # Check qr_scan_telemetry_events for token_format
        if "qr_scan_telemetry_events" in tables:
            tel_cols = [col["name"] for col in inspector.get_columns("qr_scan_telemetry_events")]
            with engine.connect() as conn:
                if "token_format" not in tel_cols:
                    logger.info("Migrating schema: adding token_format to qr_scan_telemetry_events")
                    try:
                        conn.execute(text("ALTER TABLE qr_scan_telemetry_events ADD COLUMN token_format VARCHAR(20) NULL"))
                        conn.commit()
                    except Exception as err:
                        logger.warning(f"Failed to add token_format: {err}")
    except Exception as m_err:
        logger.warning(f"Defensive schema migration notice (non-fatal): {m_err}")

_run_defensive_schema_migrations()

import os
import asyncio
from contextlib import asynccontextmanager

is_prod = os.getenv("ENVIRONMENT", "").lower() == "production"

async def _hourly_security_digest_scheduler():
    """
    Background safety-net loop for Layer 2 security digest.
    Evaluates every 60 seconds. Triggers digest dispatch at the top of the hour (minute 0).
    Runs strictly inside FastAPI lifespan — NO external containers, celery, or cron required.
    """
    from app.core.config import settings
    if not getattr(settings, "SECURITY_DIGEST_ENABLED", False):
        logger.info("Hourly Security Digest scheduler is DISABLED via configuration.")
        return

    logger.info("Started Hourly Security Digest background scheduler.")
    while True:
        try:
            await asyncio.sleep(60)
            if not getattr(settings, "SECURITY_DIGEST_ENABLED", False):
                continue
            from app.core.security import get_server_ist_datetime
            now_ist = get_server_ist_datetime()
            # Trigger when minute is 0 (at the top of the hour)
            if now_ist.minute == 0:
                from app.services.security_alert_service import SecurityAlertService
                loop = asyncio.get_event_loop()
                # Run synchronous DB query and email dispatch in worker thread to prevent blocking event loop
                await loop.run_in_executor(None, SecurityAlertService.generate_and_send_hourly_digest)
        except asyncio.CancelledError:
            logger.info("Hourly Security Digest scheduler cancelled on shutdown.")
            break
        except Exception as sched_err:
            # Defensive error boundary: loop error must NEVER kill the scheduler
            logger.error(f"Error in hourly security digest scheduler loop: {sched_err}", exc_info=True)

def _verify_email_templates_on_startup() -> None:
    """
    Startup guard: asserts all referenced email templates exist and dry-render with sample data.
    WHY: The #1 failure mode a monitoring system must never have is silently delivering an error
    message instead of its content. This guard catches missing/broken templates at startup —
    loudly — before any real alert/digest fires.
    """
    from app.services.email_service import render_email_template
    from app.core.config import settings as cfg

    # Every template name referenced anywhere in the codebase, with sample context for dry-render
    REQUIRED_TEMPLATES = {
        "security_alert_email.html": {
            "event_title": "TEST", "event_type": "TEST", "severity": "LOW",
            "subject_id": "TEST", "source_id": "TEST", "trigger_reason": "Startup guard dry-render",
            "client_ip": "127.0.0.1", "audit_id": 0, "details": "Dry render",
            "recommended_action": "None", "timestamp_ist": "01-Jan-2026 00:00:00",
            "admin_url": "https://ather-os.de5.net/admin",
        },
        "security_digest_email.html": {
            "window_start_ist": "09:00", "window_end_ist": "10:00",
            "total_events": 0, "alerts_dispatched": 0, "suppressed_count": 0,
            "events": [], "suppressed_items": {},
            "admin_url": "https://ather-os.de5.net/admin",
        },
        "disciplinary_security_warning_email.html": {
            "student_name": "TEST", "roll_number": "TEST", "event_type": "TEST",
            "details": "Dry render", "timestamp_ist": "01-Jan-2026 00:00:00",
            "admin_url": "https://ather-os.de5.net/admin",
        },
        "magic_link_email.html": {
            "student_name": "TEST", "magic_link": "https://example.com",
            "expiry_hours": 48, "otp": "000000", "roll_number": "TEST",
        },
        "otp_email.html": {
            "student_name": "TEST", "otp": "000000", "expiry_minutes": 10,
        },
        "student_credentials_email.html": {
            "name": "TEST", "sap_id": "TEST", "username": "TEST",
            "password": "TEST", "portal_url": "https://example.com",
        },
        "teacher_credentials_email.html": {
            "name": "TEST", "sap_id": "TEST", "username": "TEST",
            "password": "TEST", "portal_url": "https://example.com",
        },
        "teacher_class_allotment_email.html": {
            "teacher_name": "TEST", "teacher_username": "TEST", "default_password": "TEST",
            "magic_login_url": "https://example.com", "class_name": "TEST",
            "class_code": "TEST", "department": "TEST", "section": "TEST",
            "student_count": 0, "next_class_date": "TEST", "weekly_schedule": "TEST",
            "timings": "TEST", "venue": "TEST", "portal_url": "https://example.com",
            "trigger_type": "STARTUP_CHECK", "support_email": "test@test.com",
        },
    }

    template_dir = cfg.EMAIL_TEMPLATE_DIR
    missing = []
    render_failures = []

    for tmpl_name, sample_ctx in REQUIRED_TEMPLATES.items():
        tmpl_path = os.path.join(template_dir, tmpl_name)
        if not os.path.isfile(tmpl_path):
            missing.append(tmpl_name)
            logger.critical(f"EMAIL TEMPLATE MISSING: '{tmpl_name}' not found at {tmpl_path}")
            continue

        # Dry-render to catch Jinja2 syntax errors or missing variables
        try:
            rendered = render_email_template(tmpl_name, sample_ctx)
            if "Template rendering error" in rendered:
                render_failures.append(tmpl_name)
                logger.critical(f"EMAIL TEMPLATE RENDER FAILURE: '{tmpl_name}' dry-render produced error output")
        except Exception as render_err:
            render_failures.append(tmpl_name)
            logger.critical(f"EMAIL TEMPLATE RENDER EXCEPTION: '{tmpl_name}': {render_err}")

    if missing or render_failures:
        # Attempt to send a plain-SMTP admin alert (simplest path, no template dependency)
        problem_list = ", ".join(missing + render_failures)
        try:
            from app.services.email_service import send_single_email
            alert_body = (
                f"<html><body>"
                f"<h2>⚠️ SNIST ERP — Email Template Startup Check FAILED</h2>"
                f"<p><strong>Missing templates:</strong> {', '.join(missing) if missing else 'None'}</p>"
                f"<p><strong>Render failures:</strong> {', '.join(render_failures) if render_failures else 'None'}</p>"
                f"<p><strong>Template directory:</strong> {template_dir}</p>"
                f"<p>Fix immediately — security alerts and digests will deliver error messages instead of content.</p>"
                f"</body></html>"
            )
            send_single_email(
                to_email=getattr(cfg, "SECURITY_ALERT_EMAIL", "23311a05y6@cse.sreenidhi.edu.in"),
                subject=f"[SNIST CRITICAL] Email Templates Missing/Broken: {problem_list}",
                html_body=alert_body,
                channel="PROOFSY",
            )
        except Exception as alert_err:
            logger.error(f"Failed to send template-missing admin alert: {alert_err}")
    else:
        logger.info(f"✅ Email template startup check PASSED — all {len(REQUIRED_TEMPLATES)} templates exist and dry-render OK (dir: {template_dir})")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Verify email templates exist and render (fail loud, not silent)
    try:
        _verify_email_templates_on_startup()
    except Exception as guard_err:
        # Defensive: startup guard itself must never crash the server
        logger.error(f"Email template startup guard encountered an unexpected error: {guard_err}", exc_info=True)

    # Startup: Expand AnyIO worker threadpool for I/O-blocked remote DB queries (AM2)
    try:
        import anyio.to_thread
        limiter = anyio.to_thread.current_default_thread_limiter()
        limiter.total_tokens = 25
        logger.info("Configured AnyIO default threadpool limiter to 25 worker tokens (I/O-blocked DB concurrency).")
    except Exception as pool_err:
        logger.warning(f"Could not configure AnyIO threadpool limiter: {pool_err}")

    # Startup: Launch background safety-net scheduler
    digest_task = None
    if getattr(settings, "SECURITY_DIGEST_ENABLED", False):
        digest_task = asyncio.create_task(_hourly_security_digest_scheduler())
    yield
    # Shutdown: Cleanly cancel background task
    if digest_task:
        digest_task.cancel()
        try:
            await digest_task
        except asyncio.CancelledError:
            pass

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    openapi_url=None if is_prod else f"{settings.API_V1_STR}/openapi.json",
    docs_url=None if is_prod else "/docs",
    redoc_url=None if is_prod else "/redoc",
    lifespan=lifespan,
)

# Additive error contract handler for HTTPException (preserves string detail while adding top-level structured fields)
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    headers = dict(exc.headers or {})
    if isinstance(exc.detail, dict):
        content = dict(exc.detail)
    else:
        content = {"detail": exc.detail}

    if "X-Attempts-Remaining" in headers:
        try:
            content["attempts_remaining"] = int(headers["X-Attempts-Remaining"])
        except (ValueError, TypeError):
            pass
    if "X-Lockout-Minutes" in headers:
        try:
            content["lockout_minutes"] = int(headers["X-Lockout-Minutes"])
        except (ValueError, TypeError):
            pass
    if "X-Retry-After-Seconds" in headers or "Retry-After" in headers:
        try:
            raw_sec = headers.get("X-Retry-After-Seconds") or headers.get("Retry-After")
            content["retry_after_seconds"] = int(raw_sec)
        except (ValueError, TypeError):
            pass

    return JSONResponse(status_code=exc.status_code, content=content, headers=headers)

# Global defensive exception handler to prevent unhandled process crashes
@app.exception_handler(Exception)
async def global_defensive_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled Exception on {request.method} {request.url.path}: {str(exc)}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "status": "ERROR",
            "detail": "An unexpected server error occurred. The system diagnostic logger has recorded the incident.",
            "path": request.url.path
        }
    )

from app.core.database import engine, Base, SessionLocal, check_db_health
from app.core.security import get_server_ist_datetime
from app.models.models import AttendanceSession, SessionStatus

# Enable hardened CORS configuration for PWA, domain, and local testing
allowed_origins = [
    "https://ather-os.de5.net",
    "http://ather-os.de5.net",
    "http://localhost:8088",
    "http://localhost:8000",
    "http://localhost:8001",
    "http://localhost:5173",
    "http://127.0.0.1:8088",
    "http://127.0.0.1:8000",
    "http://127.0.0.1:8001",
    "http://127.0.0.1:5173",
]
if getattr(settings, "FRONTEND_URL", None) and settings.FRONTEND_URL not in allowed_origins:
    allowed_origins.append(settings.FRONTEND_URL.rstrip("/"))

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"https?://([a-zA-Z0-9-]+\.)?de5\.net|https?://localhost(:\d+)?|https?://127\.0\.0\.1(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Routers with defensive safeguards
for r_module, name in [
    (auth.router, "Auth"),
    (devices.router, "Devices"),
    (admin.router, "Admin"),
    (teacher.router, "Teacher"),
    (attendance.router, "Attendance"),
    (student.router, "Student"),
    (reports.router, "Reports"),
    (telemetry.router, "Telemetry"),
    (compliance_analytics.router, "Compliance Analytics"),
    (defaulters.router, "Defaulters")
]:
    try:
        app.include_router(r_module, prefix=settings.API_V1_STR)
        logger.info(f"Successfully registered router module: {name}")
    except Exception as r_err:
        logger.error(f"Failed to register router {name}: {r_err}", exc_info=True)

# Register Onboarding & Credential Dispatch routers (defensive — never crash server)
if _onboarding_modules_loaded:
    for r_module, name in [
        (onboarding_router.router, "Onboarding (Public)"),
        (admin_onboarding_router.router, "Admin Onboarding"),
        (admin_credentials_router.router, "Admin Credentials"),
    ]:
        try:
            app.include_router(r_module, prefix=settings.API_V1_STR)
            logger.info(f"Successfully registered router module: {name}")
        except Exception as r_err:
            logger.error(f"Failed to register onboarding router {name}: {r_err}", exc_info=True)
else:
    logger.warning("Onboarding modules not loaded — onboarding/credential endpoints disabled")

@app.api_route("/health/liveness", methods=["GET", "HEAD"])
@app.api_route(f"{settings.API_V1_STR}/health/liveness", methods=["GET", "HEAD"])
def liveness_probe():
    """
    Fast liveness probe: verifies the FastAPI application process is up and responding.
    Executes ZERO database queries — safe against database hangs and connection pool exhaustion.
    """
    return JSONResponse(
        status_code=200,
        content={
            "status": "ALIVE",
            "system": settings.PROJECT_NAME,
            "version": settings.VERSION
        }
    )

@app.api_route("/health/readiness", methods=["GET", "HEAD"])
@app.api_route(f"{settings.API_V1_STR}/health/readiness", methods=["GET", "HEAD"])
def readiness_probe():
    """
    Readiness probe: verifies remote database connectivity and response latency.
    Returns HTTP 200 when database probe succeeds, or HTTP 503 if database is unreachable/degraded.
    """
    db_telemetry = check_db_health()
    is_ready = (db_telemetry.get("status") == "HEALTHY")
    status_code = 200 if is_ready else 503
    return JSONResponse(
        status_code=status_code,
        content={
            "status": "READY" if is_ready else "NOT_READY",
            "system": settings.PROJECT_NAME,
            "database": db_telemetry
        }
    )

@app.api_route("/health", methods=["GET", "HEAD"])
@app.api_route(f"{settings.API_V1_STR}/health", methods=["GET", "HEAD"])
def comprehensive_health_check():
    """
    Live Production Health Check Probe (backward-compatible).
    Checks remote MySQL connectivity, roundtrip latency, server IST time, and active sessions.
    Returns HTTP 200 when healthy, or HTTP 503 if database probe fails.
    """
    db_telemetry = check_db_health()
    server_time_ist = get_server_ist_datetime().strftime("%Y-%m-%d %H:%M:%S IST")
    
    open_sessions_count = 0
    if db_telemetry.get("status") == "HEALTHY":
        try:
            with SessionLocal() as db_session:
                open_sessions_count = db_session.query(AttendanceSession).filter(
                    AttendanceSession.status == SessionStatus.OPEN
                ).count()
        except Exception:
            pass

    is_healthy = (db_telemetry.get("status") == "HEALTHY")
    status_code = 200 if is_healthy else 503

    payload = {
        "system": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "status": "ONLINE" if is_healthy else "DEGRADED",
        "server_time": server_time_ist,
        "database": db_telemetry,
        "active_open_sessions": open_sessions_count,
        "docs_url": "/docs"
    }
    return JSONResponse(status_code=status_code, content=payload)

# SPA Frontend Static Files Mounting with graceful fallback
import os
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

frontend_candidates = [
    os.path.join(settings.BACKEND_DIR, "frontend_dist"),
    os.path.join(settings.BASE_DIR, "frontend", "dist"),
    "/app/frontend_dist",
    "/app/frontend/dist",
    "/app/static"
]
frontend_dist = next((p for p in frontend_candidates if os.path.exists(p) and os.path.isdir(p)), None)

if frontend_dist:
    logger.info(f"Mounted SPA frontend static directory from: {frontend_dist}")
    assets_path = os.path.join(frontend_dist, "assets")
    if os.path.exists(assets_path) and os.path.isdir(assets_path):
        app.mount("/assets", StaticFiles(directory=assets_path), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        if full_path.startswith("api/") or full_path.startswith("docs") or full_path.startswith("openapi.json") or full_path.startswith("redoc"):
            return JSONResponse(status_code=404, content={"detail": "Not Found"})
        target_file = os.path.join(frontend_dist, full_path)
        if full_path and os.path.exists(target_file) and os.path.isfile(target_file):
            return FileResponse(target_file)
        index_file = os.path.join(frontend_dist, "index.html")
        if os.path.exists(index_file):
            return FileResponse(index_file)
        return {"system": settings.PROJECT_NAME, "status": "ONLINE"}
else:
    @app.get("/")
    def root_status():
        return {
            "system": settings.PROJECT_NAME,
            "version": settings.VERSION,
            "status": "ONLINE",
            "docs_url": "/docs"
        }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)

