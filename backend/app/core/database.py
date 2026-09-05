import time
import logging
from sqlalchemy import create_engine, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from app.core.config import settings

logger = logging.getLogger("snist_erp.database")

# Engine configuration (supporting both MySQL and SQLite)
is_sqlite = settings.DATABASE_URL.startswith("sqlite")
if is_sqlite:
    # Diagnostic alert: Ensure SQLite is only used during explicit local test runs
    logger.warning("[DATABASE INTEGRITY GUARD] Running with SQLite database engine (%s). Verify this is a test environment.", settings.DATABASE_URL)
    connect_args = {"check_same_thread": False}
    pool_kwargs = {}
else:
    logger.info("[DATABASE INTEGRITY GUARD] Connecting to authoritative remote MySQL server (%s)", settings.DATABASE_URL.split("@")[-1] if "@" in settings.DATABASE_URL else "configured")
    connect_args = {
        "connect_timeout": 10,
        "read_timeout": 30,
        "write_timeout": 30
    }
    # Tuned connection pool for remote MySQL (seg-dev.sreenidhi.edu.in)
    # Server max_connections is 151; setting max 45 connections per worker prevents exhaustion across multiple uvicorn workers
    pool_kwargs = {
        "pool_size": 30,        # Sized for 50-60 concurrent student scans per worker
        "max_overflow": 15,     # Peak burst allowance (max 45 total per worker)
        "pool_timeout": 20,     # Fast-fail timeout to prevent prolonged HTTP request hangs
        "pool_recycle": 300     # 5-minute recycle to safely handle remote TCP keepalives
    }

engine = create_engine(
    settings.DATABASE_URL,
    connect_args=connect_args,
    pool_pre_ping=True,
    **pool_kwargs
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def check_db_health() -> dict:
    """
    Executes a fast active probe against the database (SELECT 1) and returns latency telemetry.
    Safe to call from pre-flight checks and monitoring endpoints.
    """
    t0 = time.perf_counter()
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        latency_ms = round((time.perf_counter() - t0) * 1000, 2)
        driver = engine.url.drivername
        host = engine.url.host or "local"
        database = engine.url.database or "memory"
        return {
            "status": "HEALTHY",
            "driver": driver,
            "host": host,
            "database": database,
            "latency_ms": latency_ms
        }
    except Exception as exc:
        latency_ms = round((time.perf_counter() - t0) * 1000, 2)
        logger.error(f"[DATABASE HEALTH PROBE FAILED] {exc}", exc_info=True)
        return {
            "status": "UNHEALTHY",
            "error": str(exc),
            "latency_ms": latency_ms
        }

