"""
Performance Index Migration Script for SNIST AI QR Attendance System.
Applies composite and foreign key indexes to remote MySQL (seg_demo)
with fallback compatibility for local/test SQLite databases.
Idempotent and safe to run multiple times.
"""

import sys
import os
import logging
from sqlalchemy import text, inspect

# Add backend directory to module search path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))
from app.core.database import engine

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("perf_index_migration")

INDEX_DEFINITIONS = [
    # Table, Index Name, Columns
    # 1. Device Account Bindings (runs on EVERY scan in enforce_device_binding)
    ("qr_device_account_bindings", "idx_dev_bind_lookup", ["device_id", "status", "expires_at"]),
    ("qr_device_account_bindings", "idx_dev_bind_roll", ["roll_number"]),
    
    # 2. Attendance Records (runs on EVERY scan duplicate check and teacher roster)
    ("qr_attendance_records", "idx_att_rec_session_student", ["session_id", "student_id"]),
    ("qr_attendance_records", "idx_att_rec_scanned_at", ["scanned_at"]),
    ("qr_attendance_records", "idx_att_rec_student_id", ["student_id"]),
    ("qr_attendance_records", "idx_att_rec_date", ["session_date"]),
    
    # 3. Audit Logs (prevents filesort on append-only table growing unboundedly)
    ("qr_audit_logs", "idx_audit_created_user", ["created_at", "user_id"]),
    ("qr_audit_logs", "idx_audit_roll", ["roll_number"]),
    ("qr_audit_logs", "idx_audit_event_type", ["event_type"]),
    
    # 4. Students (filtered on every teacher session and admin dashboard view)
    ("qr_students", "idx_student_section", ["section_id"]),
    ("qr_students", "idx_student_dept_year_sec", ["department_id", "academic_year_id", "section_id"]),
    
    # 5. Student Onboarding & Magic Links (device lock checks & link token resolution)
    ("qr_student_onboarding", "idx_onboard_device_uuid", ["device_uuid"]),
    ("qr_student_onboarding", "idx_onboard_section", ["section_id"]),
    ("qr_onboarding_tokens", "idx_token_onboard_active", ["onboarding_id", "is_active"]),
    
    # 6. Attendance Sessions (filters teacher sessions by date)
    ("qr_attendance_sessions", "idx_att_sess_teacher_date", ["teacher_id", "session_date"])
]

def apply_indexes():
    is_sqlite = engine.url.drivername.startswith("sqlite")
    logger.info(f"Connected to database: {engine.url.drivername} (is_sqlite={is_sqlite})")
    
    applied_count = 0
    skipped_count = 0
    
    with engine.begin() as conn:
        inspector = inspect(conn)
        existing_tables = inspector.get_table_names()
        
        for table, index_name, columns in INDEX_DEFINITIONS:
            if table not in existing_tables:
                logger.warning(f"Table '{table}' does not exist in database, skipping index '{index_name}'")
                continue
            
            # Fetch existing indexes for this table
            existing_indexes = [idx["name"] for idx in inspector.get_indexes(table) if idx.get("name")]
            
            if index_name in existing_indexes:
                logger.info(f"[EXISTS] Index '{index_name}' on table '{table}' already exists. Skipping.")
                skipped_count += 1
                continue
            
            cols_joined = ", ".join(f"`{col}`" if not is_sqlite else f'"{col}"' for col in columns)
            
            try:
                if is_sqlite:
                    sql = f'CREATE INDEX IF NOT EXISTS "{index_name}" ON "{table}" ({cols_joined})'
                else:
                    sql = f"ALTER TABLE `{table}` ADD INDEX `{index_name}` ({cols_joined})"
                
                logger.info(f"[APPLYING] {sql}")
                conn.execute(text(sql))
                applied_count += 1
                logger.info(f"[SUCCESS] Applied index '{index_name}' on table '{table}'")
            except Exception as e:
                # Handle possible duplicate key name if reflection missed it
                if "Duplicate key name" in str(e) or "already exists" in str(e):
                    logger.info(f"[EXISTS] Index '{index_name}' already present (DB message).")
                    skipped_count += 1
                else:
                    logger.error(f"[ERROR] Failed to create index '{index_name}' on '{table}': {e}")
                    raise
    
    logger.info(f"=== Index Migration Summary: {applied_count} applied, {skipped_count} skipped ===")

if __name__ == "__main__":
    apply_indexes()
