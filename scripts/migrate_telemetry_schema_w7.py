"""
SNIST ERP — Defensive Schema Migration for Week 6 & 7 Telemetry Columns
Rule 9: Defensive Error Handling & Server Crash Prevention.
"""
import sys
import os
backend_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend")
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.core.database import engine
from sqlalchemy import text

def run_migration():
    statements = [
        "ALTER TABLE qr_scan_telemetry_events ADD COLUMN render_version VARCHAR(20) DEFAULT 'v1'",
        "ALTER TABLE qr_scan_telemetry_events ADD COLUMN engine VARCHAR(20) DEFAULT 'jsqr'",
        "ALTER TABLE qr_scan_telemetry_events ADD COLUMN distance_bucket VARCHAR(20) NULL",
        "ALTER TABLE qr_scan_telemetry_events ADD COLUMN decode_scale INT NULL"
    ]
    with engine.connect() as conn:
        for stmt in statements:
            try:
                conn.execute(text(stmt))
                conn.commit()
                print(f"[OK] Executed: {stmt}")
            except Exception as e:
                print(f"[Notice / Skipped] {stmt} -> {e}")

if __name__ == "__main__":
    run_migration()
