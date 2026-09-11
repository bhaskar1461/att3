import sqlite3
import os

db_path = '/home/azureuser/snist_attendance/backend/data/attendance_system.db'
conn = sqlite3.connect(db_path)
print("=== SYSTEM SETTINGS ===")
for row in conn.execute("SELECT * FROM system_settings").fetchall():
    print(row)

print("=== TEACHERS ===")
cols = [c[1] for c in conn.execute("PRAGMA table_info(teachers)").fetchall()]
print("Cols:", cols)
for row in conn.execute("SELECT * FROM teachers").fetchall():
    print(row)

print("=== RECENT SESSIONS ===")
for row in conn.execute("SELECT id, teacher_id, subject_id, section_id, session_date, period, status FROM attendance_sessions ORDER BY id DESC LIMIT 5").fetchall():
    print(row)
