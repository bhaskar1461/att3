import re

with open("/home/azureuser/snist_attendance/backend/app/core/database.py", "r") as f:
    content = f.read()

# Replace the double-timing in check_db_health to accurately measure query execution
old_pattern = """    t0 = time.perf_counter()
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        latency_ms = round((time.perf_counter() - t0) * 1000, 2)"""

new_pattern = """    try:
        with engine.connect() as conn:
            t0 = time.perf_counter()
            conn.execute(text("SELECT 1"))
            latency_ms = round((time.perf_counter() - t0) * 1000, 2)"""

if old_pattern in content:
    content = content.replace(old_pattern, new_pattern)
    with open("/home/azureuser/snist_attendance/backend/app/core/database.py", "w") as f:
        f.write(content)
    print("Successfully patched check_db_health on Azure VM")
else:
    print("Pattern not found, checking file...")
