from typing import Optional, Any, Dict, List
from pydantic import BaseModel
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.database import engine, Base
from app.api import auth, admin, teacher, attendance, student, reports, devices, telemetry, compliance_analytics, defaulters, binding, attendance_devices, launch

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
                # Make department_id nullable in MySQL/MariaDB or PostgreSQL if currently not null
                try:
                    if engine.url.drivername.startswith("postgresql") or engine.url.drivername.startswith("postgres"):
                        conn.execute(text("ALTER TABLE qr_students ALTER COLUMN department_id DROP NOT NULL"))
                        conn.execute(text("ALTER TABLE qr_students ALTER COLUMN academic_year_id DROP NOT NULL"))
                        conn.execute(text("ALTER TABLE qr_students ALTER COLUMN section_id DROP NOT NULL"))
                    elif not engine.url.drivername.startswith("sqlite"):
                        conn.execute(text("ALTER TABLE qr_students MODIFY COLUMN department_id INT NULL"))
                        conn.execute(text("ALTER TABLE qr_students MODIFY COLUMN academic_year_id INT NULL"))
                        conn.execute(text("ALTER TABLE qr_students MODIFY COLUMN section_id INT NULL"))
                except Exception as mod_err:
                    pass
                conn.commit()

        # Check qr_attendance_records for is_approved_absence, approved_absence_reason, GPS, and selfie fields
        if "qr_attendance_records" in tables:
            att_cols = [col["name"] for col in inspector.get_columns("qr_attendance_records")]
            with engine.connect() as conn:
                if "is_approved_absence" not in att_cols:
                    logger.info("Migrating schema: adding is_approved_absence column to qr_attendance_records")
                    conn.execute(text("ALTER TABLE qr_attendance_records ADD COLUMN is_approved_absence BOOLEAN DEFAULT 0"))
                if "approved_absence_reason" not in att_cols:
                    logger.info("Migrating schema: adding approved_absence_reason column to qr_attendance_records")
                    conn.execute(text("ALTER TABLE qr_attendance_records ADD COLUMN approved_absence_reason VARCHAR(100) NULL"))
                for col_name, col_type in [
                    ("student_latitude", "FLOAT NULL"),
                    ("student_longitude", "FLOAT NULL"),
                    ("gps_accuracy_m", "FLOAT NULL"),
                    ("distance_m", "FLOAT NULL"),
                    ("device_binding_id", "INT NULL"),
                    ("selfie_status", "VARCHAR(30) NULL"),
                    ("selfie_storage_key", "VARCHAR(255) NULL"),
                    ("entry_method", "VARCHAR(30) NULL"),
                ]:
                    if col_name not in att_cols:
                        logger.info(f"Migrating schema: adding {col_name} to qr_attendance_records")
                        try:
                            conn.execute(text(f"ALTER TABLE qr_attendance_records ADD COLUMN {col_name} {col_type}"))
                        except Exception as col_err:
                            logger.warning(f"Notice: adding {col_name} skipped: {col_err}")
                conn.commit()

        # Check qr_attendance_sessions for GPS and geofence columns
        if "qr_attendance_sessions" in tables:
            sess_cols = [col["name"] for col in inspector.get_columns("qr_attendance_sessions")]
            with engine.connect() as conn:
                for col_name, col_type in [
                    ("faculty_latitude", "FLOAT NULL"),
                    ("faculty_longitude", "FLOAT NULL"),
                    ("faculty_accuracy_m", "FLOAT NULL"),
                    ("geofence_radius_m", "FLOAT DEFAULT 100.0"),
                ]:
                    if col_name not in sess_cols:
                        logger.info(f"Migrating schema: adding {col_name} to qr_attendance_sessions")
                        try:
                            conn.execute(text(f"ALTER TABLE qr_attendance_sessions ADD COLUMN {col_name} {col_type}"))
                        except Exception as col_err:
                            logger.warning(f"Notice: adding {col_name} skipped: {col_err}")
                conn.commit()

        # Ensure selfie_records table exists
        if "selfie_records" not in tables:
            try:
                Base.metadata.create_all(bind=engine, tables=[Base.metadata.tables["selfie_records"]])
                logger.info("Created missing selfie_records table.")
            except Exception as s_tbl_err:
                try:
                    with engine.connect() as conn:
                        conn.execute(text("""
                            CREATE TABLE IF NOT EXISTS selfie_records (
                                id INT AUTO_INCREMENT PRIMARY KEY,
                                attendance_id INT NOT NULL,
                                student_id INT NOT NULL,
                                session_id INT NOT NULL,
                                object_storage_key VARCHAR(255) NOT NULL UNIQUE,
                                mime_type VARCHAR(50) DEFAULT 'image/jpeg' NOT NULL,
                                file_size INT DEFAULT 0 NOT NULL,
                                width INT NULL,
                                height INT NULL,
                                quality_status VARCHAR(30) DEFAULT 'PASSED' NOT NULL,
                                face_count INT DEFAULT 1 NOT NULL,
                                captured_at DATETIME NULL,
                                uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                                status VARCHAR(30) DEFAULT 'UPLOADED' NOT NULL,
                                created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
                                INDEX idx_selfie_att (attendance_id),
                                INDEX idx_selfie_student (student_id),
                                INDEX idx_selfie_session (session_id)
                            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                        """))
                        conn.commit()
                    logger.info("Created missing selfie_records table via fallback DDL.")
                except Exception as fallback_err:
                    logger.warning(f"selfie_records table creation notice: {s_tbl_err} | Fallback: {fallback_err}")

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
                if "ladder_rung" not in tel_cols:
                    logger.info("Migrating schema: adding ladder_rung to qr_scan_telemetry_events")
                    try:
                        conn.execute(text("ALTER TABLE qr_scan_telemetry_events ADD COLUMN ladder_rung INT NULL"))
                        conn.commit()
                    except Exception as err:
                        logger.warning(f"Failed to add ladder_rung: {err}")
                if "from_rung" not in tel_cols:
                    logger.info("Migrating schema: adding from_rung to qr_scan_telemetry_events")
                    try:
                        conn.execute(text("ALTER TABLE qr_scan_telemetry_events ADD COLUMN from_rung INT NULL"))
                        conn.commit()
                    except Exception as err:
                        logger.warning(f"Failed to add from_rung: {err}")

        # Check qr_attendance_records for manual mark guardrail columns (Week 8)
        if "qr_attendance_records" in tables:
            att_cols = [col["name"] for col in inspector.get_columns("qr_attendance_records")]
            with engine.connect() as conn:
                if "manual_reason" not in att_cols:
                    logger.info("Migrating schema: adding manual_reason to qr_attendance_records")
                    try:
                        conn.execute(text("ALTER TABLE qr_attendance_records ADD COLUMN manual_reason VARCHAR(50) NULL"))
                        conn.commit()
                    except Exception as err:
                        logger.warning(f"Failed to add manual_reason: {err}")
                if "manual_reason_detail" not in att_cols:
                    logger.info("Migrating schema: adding manual_reason_detail to qr_attendance_records")
                    try:
                        conn.execute(text("ALTER TABLE qr_attendance_records ADD COLUMN manual_reason_detail VARCHAR(255) NULL"))
                        conn.commit()
                    except Exception as err:
                        logger.warning(f"Failed to add manual_reason_detail: {err}")
                if "manual_marked_by_id" not in att_cols:
                    logger.info("Migrating schema: adding manual_marked_by_id to qr_attendance_records")
                    try:
                        conn.execute(text("ALTER TABLE qr_attendance_records ADD COLUMN manual_marked_by_id INT NULL"))
                        conn.commit()
                    except Exception as err:
                        logger.warning(f"Failed to add manual_marked_by_id: {err}")

        # Defensive indexes for Week 9 scale optimization (telemetry rollups and historical session lists)
        try:
            with engine.connect() as conn:
                try:
                    conn.execute(text("CREATE INDEX IF NOT EXISTS idx_scan_tel_created_at ON qr_scan_telemetry_events (created_at)"))
                    conn.commit()
                except Exception:
                    try:
                        conn.execute(text("CREATE INDEX idx_scan_tel_created_at ON qr_scan_telemetry_events (created_at)"))
                        conn.commit()
                    except Exception:
                        pass
                try:
                    conn.execute(text("CREATE INDEX IF NOT EXISTS idx_scan_tel_session_id ON qr_scan_telemetry_events (session_id)"))
                    conn.commit()
                except Exception:
                    try:
                        conn.execute(text("CREATE INDEX idx_scan_tel_session_id ON qr_scan_telemetry_events (session_id)"))
                        conn.commit()
                    except Exception:
                        pass
                try:
                    conn.execute(text("CREATE INDEX IF NOT EXISTS idx_att_sess_teacher_created ON qr_attendance_sessions (teacher_id, created_at)"))
                    conn.commit()
                except Exception:
                    try:
                        conn.execute(text("CREATE INDEX idx_att_sess_teacher_created ON qr_attendance_sessions (teacher_id, created_at)"))
                        conn.commit()
                    except Exception:
                        pass
        except Exception as idx_err:
            logger.warning(f"Notice: defensive index creation skipped: {idx_err}")

        # Ensure Binding V2 tables and database-enforced single-active invariant exist
        try:
            if "device_bindings" not in tables:
                try:
                    Base.metadata.create_all(bind=engine, tables=[Base.metadata.tables["device_bindings"]])
                    logger.info("Created missing device_bindings table.")
                except Exception as b_tbl_err:
                    logger.warning(f"device_bindings create_all notice: {b_tbl_err}")
            else:
                try:
                    dev_cols = [col["name"] for col in inspector.get_columns("device_bindings")]
                    with engine.connect() as conn:
                        for col_name, col_def in [
                            ("public_key", "TEXT NULL"),
                            ("key_id", "VARCHAR(64) NULL"),
                            ("device_id", "VARCHAR(64) NULL"),
                            ("key_algorithm", "VARCHAR(32) DEFAULT 'ECDSA_P256'"),
                            ("key_version", "INT DEFAULT 1"),
                            ("client_type", "VARCHAR(20) DEFAULT 'WEB'"),
                            ("status", "VARCHAR(20) DEFAULT 'ACTIVE'"),
                            ("enrolled_at", "DATETIME NULL"),
                            ("enrolled_via", "VARCHAR(30) DEFAULT 'self'"),
                            ("storage_persist_granted", "BOOLEAN DEFAULT FALSE"),
                            ("browser_profile_tag", "VARCHAR(64) NULL"),
                            ("last_seen_at", "DATETIME NULL"),
                            ("last_verified_at", "DATETIME NULL"),
                            ("device_label", "VARCHAR(100) NULL"),
                            ("platform", "VARCHAR(50) NULL"),
                            ("browser_family", "VARCHAR(50) NULL"),
                            ("app_version", "VARCHAR(30) NULL"),
                            ("registered_user_agent_metadata", "TEXT NULL"),
                            ("revoked_at", "DATETIME NULL"),
                            ("revoked_reason", "VARCHAR(30) NULL"),
                            ("created_at", "DATETIME NULL"),
                            ("updated_at", "DATETIME NULL")
                        ]:
                            if col_name not in dev_cols:
                                try:
                                    conn.execute(text(f"ALTER TABLE device_bindings ADD COLUMN {col_name} {col_def}"))
                                    conn.commit()
                                except Exception as col_err:
                                    logger.warning(f"Notice: column migration {col_name} skipped: {col_err}")
                        try:
                            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_dev_bind_device_id ON device_bindings (device_id)"))
                            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_dev_bind_status ON device_bindings (status)"))
                            conn.commit()
                        except Exception:
                            pass
                except Exception as dev_col_err:
                    logger.warning(f"Notice: device_bindings column check skipped: {dev_col_err}")

            if "qr_device_rebind_otps" not in tables:
                try:
                    Base.metadata.create_all(bind=engine, tables=[Base.metadata.tables["qr_device_rebind_otps"]])
                    logger.info("Created missing qr_device_rebind_otps table.")
                except Exception as otp_tbl_err:
                    logger.warning(f"qr_device_rebind_otps create_all notice: {otp_tbl_err}")

            # Enforce single active binding database invariant index
            with engine.connect() as conn:
                try:
                    if engine.url.drivername.startswith("sqlite"):
                        conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_student_active_binding ON device_bindings (student_id) WHERE revoked_at IS NULL"))
                    else:
                        conn.execute(text("CREATE UNIQUE INDEX uq_student_active_binding ON device_bindings ((CASE WHEN revoked_at IS NULL THEN student_id ELSE NULL END))"))
                    conn.commit()
                    logger.info("Verified single-active-binding database invariant (uq_student_active_binding).")
                except Exception:
                    # Index already exists or dialect variant active
                    pass
        except Exception as bind_mig_err:
            logger.warning(f"Notice: Binding V2 defensive schema migration skipped: {bind_mig_err}")
    except Exception as m_err:
        logger.warning(f"Defensive schema migration notice (non-fatal): {m_err}")

_run_defensive_schema_migrations()

def _auto_seed_initial_users():
    """
    Defensively ensures standard admin, faculty, and student accounts exist.
    Essential for newly provisioned databases (e.g. Antideploy Postgres, local dev).
    """
    try:
        from app.core.database import SessionLocal
        from app.models.models import User, UserRole, Student, Teacher, Department, AcademicYear, Section
        from app.core.security import get_password_hash

        with SessionLocal() as db:
            # 1. Ensure Super Admin
            admin_user = db.query(User).filter(User.username == "admin").first()
            if not admin_user:
                admin_user = User(
                    username="admin",
                    email="admin@sreenidhi.edu.in",
                    password_hash=get_password_hash("admin123"),
                    role=UserRole.SUPER_ADMIN,
                    is_active=True
                )
                db.add(admin_user)
                logger.info("Auto-seeded Super Admin account: 'admin' / 'admin123'")

            # 2. Ensure base academic structure if missing
            dept = db.query(Department).filter(Department.code == "CSE").first()
            if not dept:
                dept = Department(code="CSE", name="Computer Science & Engineering")
                db.add(dept)
                db.flush()

            ay = db.query(AcademicYear).filter(AcademicYear.name == "3rd Year").first()
            if not ay:
                ay = AcademicYear(name="3rd Year")
                db.add(ay)
                db.flush()

            sec = db.query(Section).filter(Section.name == "CSE-A").first()
            if not sec:
                sec = Section(name="CSE-A", department_id=dept.id, academic_year_id=ay.id)
                db.add(sec)
                db.flush()

            # 3. Ensure Demo Faculty
            teacher_user = db.query(User).filter(User.username == "demoteacher").first()
            if not teacher_user:
                teacher_user = User(
                    username="demoteacher",
                    email="demoteacher@sreenidhi.edu.in",
                    password_hash=get_password_hash("demoteacher@2026"),
                    role=UserRole.TEACHER,
                    is_active=True
                )
                db.add(teacher_user)
                db.flush()
                t_prof = Teacher(user_id=teacher_user.id, name="Mrs. N. Sowjanya", department_id=dept.id, email=teacher_user.email)
                db.add(t_prof)
                logger.info("Auto-seeded Faculty account: 'demoteacher' / 'demoteacher@2026'")

            # 4. Ensure Demo Student 23311A0504 (Vikram)
            v_user = db.query(User).filter(User.username == "23311A0504").first()
            if not v_user:
                v_user = User(
                    username="23311A0504",
                    email="vikram@sreenidhi.edu.in",
                    password_hash=get_password_hash("demostudent@2026"),
                    role=UserRole.STUDENT,
                    is_active=True
                )
                db.add(v_user)
                db.flush()
                s_prof = Student(
                    user_id=v_user.id,
                    roll_number="23311A0504",
                    name="Vikram Reddy",
                    department_id=dept.id,
                    academic_year_id=ay.id,
                    section_id=sec.id,
                    agency="Regular"
                )
                db.add(s_prof)
                logger.info("Auto-seeded Student account: '23311A0504' / 'demostudent@2026'")

            # 5. Ensure Demo Student demostudent
            ds_user = db.query(User).filter(User.username == "demostudent").first()
            if not ds_user:
                ds_user = User(
                    username="demostudent",
                    email="demostudent@sreenidhi.edu.in",
                    password_hash=get_password_hash("demostudent@2026"),
                    role=UserRole.STUDENT,
                    is_active=True
                )
                db.add(ds_user)
                db.flush()
                ds_prof = Student(
                    user_id=ds_user.id,
                    roll_number="DEMOSTUDENT",
                    name="Demo Student",
                    department_id=dept.id,
                    academic_year_id=ay.id,
                    section_id=sec.id,
                    agency="Regular"
                )
                db.add(ds_prof)
                logger.info("Auto-seeded Student account: 'demostudent' / 'demostudent@2026'")

            db.commit()
    except Exception as e:
        logger.warning(f"Initial user provisioning warning (non-fatal): {e}")

_auto_seed_initial_users()


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
        if "detail" not in content or isinstance(content.get("detail"), dict):
            content["detail"] = exc.detail.get("message", str(exc.detail))
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
    "https://whiteleos.cc.cd",
    "http://whiteleos.cc.cd",
]
if getattr(settings, "FRONTEND_URL", None) and settings.FRONTEND_URL not in allowed_origins:
    allowed_origins.append(settings.FRONTEND_URL.rstrip("/"))

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"https?://([a-zA-Z0-9-]+\.)?(de5\.net|cc\.cd|isroot\.in)|https?://localhost(:\d+)?|https?://127\.0\.0\.1(:\d+)?",
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
    (defaulters.router, "Defaulters"),
    (binding.router, "Device Binding V2"),
    (attendance_devices.router, "Cryptographic Device Identity"),
    (launch.router, "Launch")
]:
    try:
        app.include_router(r_module, prefix=settings.API_V1_STR)
        logger.info(f"Successfully registered router module: {name}")
    except Exception as r_err:
        logger.error(f"Failed to register router {name}: {r_err}", exc_info=True)

# Defensive redirect for /a/{token} to frontend universal landing page
import os
from fastapi.responses import RedirectResponse, FileResponse
from fastapi import Request

_spa_candidates = [
    os.path.join(settings.BACKEND_DIR, "frontend_dist"),
    os.path.join(settings.BASE_DIR, "frontend", "dist"),
    "/app/frontend_dist",
    "/app/frontend/dist",
    "/app/static"
]
_spa_dist = next((p for p in _spa_candidates if os.path.exists(p) and os.path.isdir(p)), None)

@app.get("/a/{token}")
def redirect_launch_token_to_frontend(token: str, request: Request):
    """
    Public entry point redirector:
    Serves the SPA index.html so React Router renders <Route path="/a/:launchToken" element={<AttendanceLanding />} />.
    Falls back to safe redirection only if hosted on an external frontend domain (strictly preventing self-redirect loops).
    """
    if _spa_dist:
        index_file = os.path.join(_spa_dist, "index.html")
        if os.path.exists(index_file):
            return FileResponse(index_file)

    base_url = (getattr(settings, "FRONTEND_URL", "") or getattr(settings, "ATTENDANCE_BASE_URL", "") or "").rstrip("/")
    req_host = (request.headers.get("host") or "").lower()
    if base_url:
        try:
            from urllib.parse import urlparse
            parsed_b = urlparse(base_url if "://" in base_url else f"https://{base_url}")
            if parsed_b.netloc and parsed_b.netloc.lower() == req_host:
                # Same host as current request and no local SPA files: return informative JSON rather than 307 loop
                return JSONResponse(
                    status_code=200,
                    content={"detail": "SNIST Attendance Landing Page. Please open inside the student portal.", "token": token}
                )
        except Exception:
            pass
        return RedirectResponse(url=f"{base_url}/a/{token}", status_code=307)

    return JSONResponse(
        status_code=200,
        content={"detail": "SNIST Attendance Landing Page. Please open inside the student portal.", "token": token}
    )

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

# --- Phase 7 Stage 2: Display Heartbeat Beacon & Status ---
class QRDisplayHeartbeatRequest(BaseModel):
    session_id: int
    epoch: int
    ts: Optional[float] = None

@app.post(f"{settings.API_V1_STR}/qr-display-heartbeat")
@app.post("/api/v1/qr-display-heartbeat")
def qr_display_heartbeat_beacon(req: QRDisplayHeartbeatRequest, request: Request):
    """
    Phase 7 Stage 2: Display heartbeat beacon sent every rotation from projector modal.
    Enables real-time detection of frozen or dead classroom displays.
    """
    try:
        from app.services.display_heartbeat import record_display_heartbeat
        ip = request.client.host if request.client else None
        return record_display_heartbeat(
            session_id=req.session_id,
            epoch=req.epoch,
            client_ts=req.ts,
            ip_address=ip
        )
    except Exception as e:
        logger.warning(f"Error recording display heartbeat: {e}")
        return {"status": "ERROR", "message": str(e)}

@app.get(f"{settings.API_V1_STR}/qr-display-heartbeat/status")
@app.get("/api/v1/qr-display-heartbeat/status")
def qr_display_heartbeat_status(session_id: Optional[int] = None):
    """
    Admin & Faculty inspection of display heartbeat status.
    """
    from app.services.display_heartbeat import get_display_heartbeat_status
    return get_display_heartbeat_status(session_id=session_id)

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
import mimetypes
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

# Explicitly register application/wasm MIME type across all platforms (Linux/Docker/Windows)
mimetypes.add_type("application/wasm", ".wasm")

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
            if target_file.endswith(".wasm"):
                return FileResponse(
                    target_file,
                    media_type="application/wasm",
                    headers={"Cache-Control": "public, max-age=31536000, immutable"}
                )
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
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("app.main:app", host=host, port=port, reload=True)


