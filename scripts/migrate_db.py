#!/usr/bin/env python3
"""
Root wrapper for SNIST ERP Database Schema Migration Runner
"""
import os
import sys

root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
backend_dir = os.path.join(root_dir, "backend")
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from scripts.migrate_db import run_migrations

if __name__ == "__main__":
    success = run_migrations()
    sys.exit(0 if success else 1)
