import time
import pymysql

t0 = time.perf_counter()
c = pymysql.connect(
    host="snist-attendance-db.cngk2i8i29dn.ap-south-1.rds.amazonaws.com",
    user="snist_admin",
    password="SnistAdmin2026Secure",
    database="seg_demo"
)
print("TCP + SSL Handshake:", round((time.perf_counter() - t0) * 1000, 2), "ms", flush=True)

cur = c.cursor()
for i in range(5):
    t = time.perf_counter()
    cur.execute("SELECT 1")
    cur.fetchone()
    print(f"Query {i+1} on active connection:", round((time.perf_counter() - t) * 1000, 2), "ms", flush=True)
c.close()
