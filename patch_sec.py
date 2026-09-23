with open("/home/azureuser/snist_attendance/backend/app/core/database.py", "r") as f:
    content = f.read()

old_sec = """    if secondary_engine:
        t1 = time.perf_counter()
        try:
            with secondary_engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            latency_ms = round((time.perf_counter() - t1) * 1000, 2)"""

new_sec = """    if secondary_engine:
        try:
            with secondary_engine.connect() as conn:
                t1 = time.perf_counter()
                conn.execute(text("SELECT 1"))
                latency_ms = round((time.perf_counter() - t1) * 1000, 2)"""

if old_sec in content:
    content = content.replace(old_sec, new_sec)
    with open("/home/azureuser/snist_attendance/backend/app/core/database.py", "w") as f:
        f.write(content)
    print("Patched secondary timing successfully!")
else:
    print("Pattern not found.")
