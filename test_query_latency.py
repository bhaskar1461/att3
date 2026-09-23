import sys, time
sys.path.insert(0, "/home/azureuser/snist_attendance/backend")
from sqlalchemy import text
from app.core.database import engine

with engine.connect() as conn:
    for i in range(3):
        t0 = time.perf_counter()
        conn.execute(text("SELECT 1"))
        print(f"Query {i+1} on pooled connection:", round((time.perf_counter() - t0) * 1000, 2), "ms")
