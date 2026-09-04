from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.database import engine, Base
from app.api import auth, admin, teacher, attendance, student, reports, devices, prox_presence

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
            "ALTER TABLE qr_attendance_sessions ADD COLUMN classroom_id INT NULL",
            "ALTER TABLE qr_attendance_sessions ADD COLUMN ephemeral_secret VARCHAR(64) NULL",
            "ALTER TABLE qr_attendance_sessions ADD COLUMN current_challenge VARCHAR(64) NULL",
            "ALTER TABLE qr_attendance_sessions ADD COLUMN challenge_generated_at DATETIME NULL",
            "ALTER TABLE qr_attendance_sessions ADD COLUMN manual_fallback_code VARCHAR(8) NULL",
            "ALTER TABLE qr_attendance_sessions ADD COLUMN manual_code_expires_at DATETIME NULL",
            "ALTER TABLE qr_attendance_records ADD COLUMN verified_scan_mode VARCHAR(30) DEFAULT 'QR' NULL",
            "ALTER TABLE qr_attendance_records ADD COLUMN measured_rssi INT NULL",
            "ALTER TABLE qr_attendance_records ADD COLUMN location_accuracy_meters FLOAT NULL",
            "ALTER TABLE qr_attendance_records ADD COLUMN challenge_latency_ms INT NULL",
            "ALTER TABLE qr_students ADD COLUMN device_hash VARCHAR(128) NULL",
            "ALTER TABLE qr_attendance_records ADD COLUMN method VARCHAR(20) DEFAULT 'ble' NULL",
            "ALTER TABLE qr_attendance_records ADD COLUMN rssi INT NULL",
            "ALTER TABLE qr_attendance_records ADD COLUMN geo_accuracy_m FLOAT NULL",
            "ALTER TABLE qr_attendance_records ADD COLUMN marked_at DATETIME NULL",
            "ALTER TABLE qr_attendance_audit_reviews ADD COLUMN record_id INT NULL",
            "ALTER TABLE qr_attendance_audit_reviews ADD COLUMN flag VARCHAR(50) NULL",
            "ALTER TABLE qr_attendance_audit_reviews ADD COLUMN resolved_by VARCHAR(100) NULL",
            "ALTER TABLE qr_attendance_audit_reviews ADD COLUMN resolved_at DATETIME NULL",
            "ALTER TABLE qr_attendance_sessions ADD COLUMN faculty_id INT NULL",
            "ALTER TABLE qr_attendance_sessions ADD COLUMN room_id INT NULL",
            "ALTER TABLE qr_attendance_sessions ADD COLUMN starts_at DATETIME NULL",
            "ALTER TABLE qr_attendance_sessions ADD COLUMN locks_at DATETIME NULL",
            "ALTER TABLE qr_attendance_sessions ADD COLUMN kill_switch_active BOOLEAN DEFAULT 0 NULL"
        ]:
            try:
                conn.execute(text(col_sql))
                conn.commit()
            except Exception:
                pass

        # Seed initial pilot classrooms if table is empty
        try:
            from app.models.models import Classroom
            from app.core.database import SessionLocal
            seed_db = SessionLocal()
            if seed_db.query(Classroom).count() == 0:
                pilot_rooms = [
                    Classroom(
                        room_code="ROOM-304-BLOCK-B",
                        building="Block B",
                        floor=3,
                        center_latitude=17.448291,
                        center_longitude=78.391482,
                        geofence_radius_meters=60,
                        default_rssi_threshold=-75,
                        uwb_supported=False,
                        is_active=True
                    ),
                    Classroom(
                        room_code="LH-101-BLOCK-A",
                        building="Block A",
                        floor=1,
                        center_latitude=17.448650,
                        center_longitude=78.391120,
                        geofence_radius_meters=80,
                        default_rssi_threshold=-80,
                        uwb_supported=True,
                        is_active=True
                    ),
                ]
                seed_db.add_all(pilot_rooms)
                seed_db.commit()
                logger.info("Initialized default pilot classrooms for proximity verification.")
            seed_db.close()
        except Exception as seed_err:
            logger.warning(f"Classroom seed initialization warning (non-fatal): {seed_err}")

    logger.info("Database schemas verified successfully.")
except Exception as err:
    logger.warning(f"Database DDL/Index initialization warning (non-fatal): {err}")

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    openapi_url=f"{settings.API_V1_STR}/openapi.json"
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

# Enable CORS for PWA and web clients
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
    (prox_presence.router, "ProxPresence")
]:
    try:
        app.include_router(r_module, prefix=settings.API_V1_STR)
        logger.info(f"Successfully registered router module: {name}")
    except Exception as r_err:
        logger.error(f"Failed to register router {name}: {r_err}", exc_info=True)

# Also mount ProxPresence routes directly at root for /session/start, /session/lock, /attendance/mark, /code/verify, /admin/kill-switch, /health
try:
    app.include_router(prox_presence.router)
    logger.info("Successfully registered ProxPresence root routes.")
except Exception as root_r_err:
    logger.error(f"Failed to register ProxPresence root router: {root_r_err}", exc_info=True)

@app.api_route("/health", methods=["GET", "HEAD"])
def health_check():
    return {
        "system": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "status": "ONLINE",
        "docs_url": "/docs"
    }

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

