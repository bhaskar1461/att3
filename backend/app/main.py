from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.database import engine, Base
from app.api import auth, admin, teacher, attendance, student, reports, devices

import logging
from fastapi.responses import JSONResponse
from fastapi.requests import Request

# Configure structured application logger
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("snist_erp")

# Create DB tables automatically with defensive error logging
try:
    Base.metadata.create_all(bind=engine)
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
    (reports.router, "Reports")
]:
    try:
        app.include_router(r_module, prefix=settings.API_V1_STR)
        logger.info(f"Successfully registered router module: {name}")
    except Exception as r_err:
        logger.error(f"Failed to register router {name}: {r_err}", exc_info=True)

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
