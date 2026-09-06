import logging
import sys
import os

# Ensure backend root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import text
from app.core.database import engine

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("db_migration")

def create_device_reset_otp_table():
    """
    Defensively creates the qr_device_reset_otps table for self-service device resets.
    Idempotent: uses IF NOT EXISTS.
    """
    create_sql = """
    CREATE TABLE IF NOT EXISTS qr_device_reset_otps (
        id INT AUTO_INCREMENT PRIMARY KEY,
        roll_number VARCHAR(50) NOT NULL,
        email VARCHAR(150) NOT NULL,
        otp_hash VARCHAR(128) NOT NULL,
        attempts INT NOT NULL DEFAULT 0,
        is_consumed BOOLEAN NOT NULL DEFAULT FALSE,
        expires_at DATETIME NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_dev_reset_roll (roll_number),
        INDEX idx_dev_reset_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    """
    with engine.connect() as conn:
        logger.info("Executing CREATE TABLE IF NOT EXISTS qr_device_reset_otps...")
        conn.execute(text(create_sql))
        conn.commit()
        logger.info("Table qr_device_reset_otps is ready.")

if __name__ == "__main__":
    create_device_reset_otp_table()
