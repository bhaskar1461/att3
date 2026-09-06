"""
Migration: Add registered_device_id column to qr_students table.
Implements bi-directional student-to-device binding (Layer 2 of anti-proxy defense).

Safe to run multiple times — checks if column already exists before altering.
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from app.core.database import engine
from sqlalchemy import text, inspect

def run_migration():
    inspector = inspect(engine)
    columns = [col['name'] for col in inspector.get_columns('qr_students')]

    with engine.begin() as conn:
        if 'registered_device_id' not in columns:
            conn.execute(text(
                "ALTER TABLE qr_students ADD COLUMN registered_device_id INT NULL"
            ))
            print("[OK] Added 'registered_device_id' column to qr_students")
        else:
            print("[SKIP] Column 'registered_device_id' already exists in qr_students")

    print("[DONE] Migration complete.")

if __name__ == '__main__':
    run_migration()
