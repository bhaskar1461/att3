import time
import os
import sys

# Insert backend path
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend"))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.core.database import SessionLocal
from app.models.models import User, Student, Teacher
from app.core.security import verify_password, get_password_hash
import socket

def benchmark():
    print("=== PROFILING LATENCY BREAKDOWN ===")
    
    # 1. DNS Resolution
    t0 = time.perf_counter()
    ip = socket.gethostbyname("seg-dev.sreenidhi.edu.in")
    t_dns = (time.perf_counter() - t0) * 1000
    print(f"1. DNS Lookup (seg-dev.sreenidhi.edu.in -> {ip}): {t_dns:.2f} ms")
    
    # 2. TCP Socket Connect to MySQL 3306
    t0 = time.perf_counter()
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(5.0)
    s.connect((ip, 3306))
    t_tcp = (time.perf_counter() - t0) * 1000
    s.close()
    print(f"2. Raw TCP Connect to MySQL 3306: {t_tcp:.2f} ms")
    
    # 3. SQLAlchemy Connection & Handshake
    from sqlalchemy import text
    t0 = time.perf_counter()
    db = SessionLocal()
    db.execute(text("SELECT 1"))
    t_db = (time.perf_counter() - t0) * 1000
    print(f"3. DB Connection Handshake + SELECT 1: {t_db:.2f} ms")
    
    # 4. User Query by username
    t0 = time.perf_counter()
    u = db.query(User).filter(User.username == "DEMO_BURST_001").first()
    t_query = (time.perf_counter() - t0) * 1000
    print(f"4. Query User DEMO_BURST_001: {t_query:.2f} ms (Found: {bool(u)})")
    
    # 5. Bcrypt verification
    if u and u.password_hash:
        t0 = time.perf_counter()
        v = verify_password("BurstStudent@2026", u.password_hash)
        t_bcrypt = (time.perf_counter() - t0) * 1000
        print(f"5. Bcrypt Verify Password: {t_bcrypt:.2f} ms (Match: {v})")
    else:
        # Benchmark dummy bcrypt
        h = get_password_hash("TestPassword123!")
        t0 = time.perf_counter()
        v = verify_password("TestPassword123!", h)
        t_bcrypt = (time.perf_counter() - t0) * 1000
        print(f"5. Bcrypt Verify Benchmark: {t_bcrypt:.2f} ms")
        
    # 6. Full HTTP request to /api/v1/auth/login locally
    import requests
    t0 = time.perf_counter()
    try:
        r = requests.post(
            "http://127.0.0.1:8001/api/v1/auth/login",
            json={"username": "DEMO_BURST_001", "password": "BurstStudent@2026"},
            headers={"x-device-public-id": "DEV-BURST-001", "x-device-secret": "DEV-SECRET-001"},
            timeout=15
        )
        t_login = (time.perf_counter() - t0) * 1000
        print(f"6. Local HTTP Login /api/v1/auth/login: {t_login:.2f} ms (Status: {r.status_code})")
    except Exception as e:
        print(f"6. Local HTTP Login Failed: {e}")

    # 7. Student profile query
    if u:
        t0 = time.perf_counter()
        r2 = requests.get(
            f"http://127.0.0.1:8001/api/v1/student/profile",
            headers={"Authorization": f"Bearer {r.json().get('access_token')}"},
            timeout=15
        )
        t_profile = (time.perf_counter() - t0) * 1000
        print(f"7. Local HTTP Student Profile: {t_profile:.2f} ms (Status: {r2.status_code})")

    db.close()

if __name__ == "__main__":
    benchmark()
