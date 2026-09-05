from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.database import engine, Base
from app.api import auth, admin, teacher, attendance, student, reports, devices

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
    from sqlalchemy import text
    with engine.connect() as conn:
        for col_sql in [
            "ALTER TABLE qr_audit_logs ADD COLUMN roll_number VARCHAR(50) NULL",
            "ALTER TABLE qr_audit_logs ADD COLUMN device_id INT NULL",
            "ALTER TABLE qr_audit_logs ADD COLUMN event_type VARCHAR(50) NULL",
            "ALTER TABLE qr_audit_logs ADD COLUMN ip_address VARCHAR(50) NULL",
            "ALTER TABLE qr_audit_logs ADD COLUMN created_at DATETIME NULL",
            "ALTER TABLE qr_teachers ADD COLUMN google_sheet_id VARCHAR(255) NULL",
            "ALTER TABLE qr_attendance_records ADD COLUMN period_count INT DEFAULT 4 NULL",
            "ALTER TABLE qr_attendance_records MODIFY COLUMN scan_mode VARCHAR(50) DEFAULT 'QR'",
            "ALTER TABLE qr_attendance_sessions MODIFY COLUMN period VARCHAR(100) NOT NULL"
        ]:
            try:
                conn.execute(text(col_sql))
                conn.commit()
            except Exception:
                pass
    logger.info("Database schemas verified successfully.")
except Exception as err:
    logger.warning(f"Database DDL/Index initialization warning (non-fatal): {err}")

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
    logger.info("Started Hourly Security Digest background scheduler.")
    while True:
        try:
            await asyncio.sleep(60)
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

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Launch background safety-net scheduler
    digest_task = None
    if getattr(settings, "SECURITY_DIGEST_ENABLED", True):
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
    (reports.router, "Reports")
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

@app.api_route("/health", methods=["GET", "HEAD"])
@app.api_route(f"{settings.API_V1_STR}/health", methods=["GET", "HEAD"])
def comprehensive_health_check():
    """
    Live Production Health Check Probe.
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

