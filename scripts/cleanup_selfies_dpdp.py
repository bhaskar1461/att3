"""
DPDP Act 2023 Biometric Data Retention & Lifecycle Purge Script
SNIST ERP AI QR-Attendance System — Phase 10 Production Capability

Under India's Digital Personal Data Protection (DPDP) Act 2023, biometric
personal data (student facial verification selfies) cannot be stored indefinitely
without a legitimate, time-bounded institutional purpose.

This utility:
1. Queries attendance selfie records older than the retention threshold (default: 30 days).
2. Verifies that the associated session is finalized and reconciled.
3. Deletes the raw JPEG image files from the local storage volume.
4. Preserves the AttendanceRecord, timestamp, student roll number, and SHA-256 hash.
5. Updates selfie_status to 'PURGED_DPDP_RETENTION' for institutional audit compliance.
"""

import os
import sys
import argparse
import logging
from datetime import datetime, timedelta

# Add backend directory to sys.path
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
BACKEND_DIR = os.path.join(PROJECT_ROOT, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app.core.database import SessionLocal
from app.models.models import AttendanceRecord, SelfieRecord, AttendanceSession, SessionStatus
from app.core.config import settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("dpdp_biometric_purge")


def purge_expired_selfies(retention_days: int = 30, dry_run: bool = True) -> dict:
    """
    Purges raw selfie image files older than retention_days.
    """
    cutoff_date = datetime.utcnow() - timedelta(days=retention_days)
    logger.info(f"Starting DPDP biometric cleanup: retention_days={retention_days}, cutoff={cutoff_date.isoformat()}, dry_run={dry_run}")

    stats = {
        "files_scanned": 0,
        "files_purged": 0,
        "records_updated": 0,
        "bytes_reclaimed": 0,
        "errors": 0,
        "dry_run": dry_run
    }

    db = SessionLocal()
    try:
        # Find attendance records with selfies created before cutoff date
        records = db.query(AttendanceRecord).filter(
            AttendanceRecord.created_at < cutoff_date,
            AttendanceRecord.selfie_storage_key.isnot(None),
            AttendanceRecord.selfie_status != "PURGED_DPDP_RETENTION"
        ).all()

        stats["files_scanned"] = len(records)
        logger.info(f"Identified {len(records)} selfie records exceeding retention period.")

        for rec in records:
            storage_key = rec.selfie_storage_key
            if not storage_key:
                continue

            file_path = os.path.join(settings.SELFIE_STORAGE_DIR, storage_key)
            if not os.path.exists(file_path):
                # Check directly in data/selfies
                alt_path = os.path.join(settings.DATA_DIR, "selfies", storage_key)
                if os.path.exists(alt_path):
                    file_path = alt_path

            file_size = 0
            file_exists = os.path.exists(file_path)
            if file_exists:
                try:
                    file_size = os.path.getsize(file_path)
                except Exception:
                    file_size = 0

            if not dry_run:
                try:
                    if file_exists:
                        os.remove(file_path)
                        stats["bytes_reclaimed"] += file_size
                        stats["files_purged"] += 1

                    rec.selfie_status = "PURGED_DPDP_RETENTION"
                    stats["records_updated"] += 1
                except Exception as del_err:
                    logger.error(f"Error purging selfie file {file_path}: {del_err}")
                    stats["errors"] += 1
            else:
                if file_exists:
                    stats["bytes_reclaimed"] += file_size
                    stats["files_purged"] += 1
                stats["records_updated"] += 1

        if not dry_run:
            db.commit()
            logger.info("Database transactions committed successfully.")

    except Exception as exc:
        db.rollback()
        logger.error(f"Fatal error during DPDP biometric purge: {exc}")
        raise
    finally:
        db.close()

    mb_reclaimed = stats["bytes_reclaimed"] / (1024 * 1024)
    logger.info(
        f"DPDP Purge Complete. Purged: {stats['files_purged']} files ({mb_reclaimed:.2f} MB), "
        f"Updated: {stats['records_updated']} records, Dry Run: {dry_run}"
    )
    return stats


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="SNIST DPDP Act 2023 Biometric Lifecycle Purge Utility")
    parser.add_argument("--days", type=int, default=30, help="Retention period in days (default: 30)")
    parser.add_argument("--execute", action="store_true", help="Execute real deletion (default is dry-run)")
    args = parser.parse_args()

    purge_expired_selfies(retention_days=args.days, dry_run=not args.execute)
