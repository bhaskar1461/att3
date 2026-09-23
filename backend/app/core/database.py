import time
import logging
from sqlalchemy import create_engine, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from app.core.config import settings

logger = logging.getLogger("snist_erp.database")

# Engine configuration — supports PostgreSQL and MySQL
if settings.DATABASE_URL.startswith("sqlite"):
    logger.warning("[DATABASE ENFORCEMENT] SQLite is completely disabled. Defaulting to authoritative MySQL server.")
    db_url = "mysql+pymysql://demo:Admin%40321%23@seg-dev.sreenidhi.edu.in:3306/seg_demo"
else:
    db_url = settings.DATABASE_URL

if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql://", 1)

is_sqlite = False
is_postgres = db_url.startswith("postgresql://") or db_url.startswith("postgres://")

if is_postgres:
    logger.info("[DATABASE INTEGRITY GUARD] Connecting to PostgreSQL server (%s)", db_url.split("@")[-1] if "@" in db_url else "configured")
    connect_args = {
        "connect_timeout": 5
    }
    pool_kwargs = {
        "pool_size": 25,
        "max_overflow": 15,
        "pool_timeout": 5,
        "pool_recycle": 300
    }
else:
    logger.info("[DATABASE INTEGRITY GUARD] Connecting to authoritative MySQL server (%s)", db_url.split("@")[-1] if "@" in db_url else "configured")
    connect_args = {
        "connect_timeout": 5,
        "read_timeout": 8,
        "write_timeout": 8
    }
    # Tuned connection pool for MySQL (seg-dev.sreenidhi.edu.in)
    pool_kwargs = {
        "pool_size": 30,        # Sized for 50-60 concurrent student scans per worker
        "max_overflow": 15,     # Peak burst allowance (max 45 total per worker)
        "pool_timeout": 5,      # Fast-fail timeout to prevent worker starvation and cascade failure
        "pool_recycle": 300     # 5-minute recycle to safely handle remote TCP keepalives
    }

engine = create_engine(
    db_url,
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

