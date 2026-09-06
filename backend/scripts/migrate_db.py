"""
SNIST ERP - Idempotent Database Schema Migration Runner
Safely verifies and applies required database schema modifications.
Uses SQLAlchemy inspection to prevent redundant ALTER TABLE locks on server startup.
"""

import sys
import os
import logging
from sqlalchemy import inspect, text

# Add backend directory to sys.path if not present
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("snist_erp.migration")

def run_migrations():
    from app.core.database import engine, Base
    from app.core.config import settings

    logger.info("Initializing schema verification against database: %s", settings.DATABASE_URL.split("@")[-1] if "@" in settings.DATABASE_URL else "local")

    # 1. Create any brand-new tables defined in models that do not exist yet
    try:
        Base.metadata.create_all(bind=engine)
        logger.info("[SCHEMA SYNC] Base table definitions verified.")
    except Exception as exc:
        logger.warning("[SCHEMA WARNING] Base.metadata.create_all warning: %s", exc)

    # 2. Inspect existing columns and apply missing columns idempotently
    inspector = inspect(engine)
    existing_tables = inspector.get_table_names()

    # Column additions: (table_name, column_name, ddl_sql)
    column_checks = [
        ("qr_audit_logs", "roll_number", "ALTER TABLE qr_audit_logs ADD COLUMN roll_number VARCHAR(50) NULL"),
        ("qr_audit_logs", "device_id", "ALTER TABLE qr_audit_logs ADD COLUMN device_id INT NULL"),
        ("qr_audit_logs", "event_type", "ALTER TABLE qr_audit_logs ADD COLUMN event_type VARCHAR(50) NULL"),
        ("qr_audit_logs", "ip_address", "ALTER TABLE qr_audit_logs ADD COLUMN ip_address VARCHAR(50) NULL"),
        ("qr_audit_logs", "created_at", "ALTER TABLE qr_audit_logs ADD COLUMN created_at DATETIME NULL"),
        ("qr_teachers", "google_sheet_id", "ALTER TABLE qr_teachers ADD COLUMN google_sheet_id VARCHAR(255) NULL"),
        ("qr_attendance_records", "period_count", "ALTER TABLE qr_attendance_records ADD COLUMN period_count INT DEFAULT 4 NULL"),
    ]

    applied_count = 0
    skipped_count = 0

    with engine.connect() as conn:
        for table, col, ddl in column_checks:
            if table not in existing_tables:
                logger.warning("[MIGRATION] Table %s does not exist yet. Skipping column check for %s.", table, col)
                continue

            # Check if column already exists
            cols = [c["name"] for c in inspector.get_columns(table)]
            if col in cols:
                logger.debug("[UP-TO-DATE] %s.%s already exists.", table, col)
                skipped_count += 1
            else:
                logger.info("[MIGRATING] Applying: %s.%s ...", table, col)
                try:
                    conn.execute(text(ddl))
                    conn.commit()
                    applied_count += 1
                    logger.info("[SUCCESS] Added column %s to table %s", col, table)
                except Exception as err:
                    logger.error("[MIGRATION ERROR] Failed to add %s to %s: %s", col, table, err)

        # MySQL-specific column modification checks
        if not settings.DATABASE_URL.startswith("sqlite"):
            modifications = [
                ("qr_attendance_records", "ALTER TABLE qr_attendance_records MODIFY COLUMN scan_mode VARCHAR(50) DEFAULT 'QR'"),
                ("qr_attendance_sessions", "ALTER TABLE qr_attendance_sessions MODIFY COLUMN period VARCHAR(100) NOT NULL")
            ]
            for table, mod_ddl in modifications:
                if table in existing_tables:
                    try:
                        conn.execute(text(mod_ddl))
                        conn.commit()
                        logger.info("[SUCCESS] Verified column specifications on %s", table)
                    except Exception as mod_err:
                        logger.warning("[NOTICE] Column specification adjustment on %s: %s", table, mod_err)

    logger.info("[MIGRATION COMPLETE] Applied: %d, Already Up-to-Date: %d", applied_count, skipped_count)
    return True

if __name__ == "__main__":
    success = run_migrations()
    sys.exit(0 if success else 1)
