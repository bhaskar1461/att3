import os
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND_DIR = os.path.join(BASE_DIR, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app.core.database import SessionLocal, engine
from app.models.models import User, Teacher, Student
from app.core.security import verify_password, get_password_hash

def test_db():
    print("=== Testing MySQL seg-dev.sreenidhi.edu.in Database Connection ===")
    print("DATABASE_URL:", os.getenv("DATABASE_URL"))
    db = SessionLocal()
    try:
        users = db.query(User).all()
        print(f"[+] Total Users in DB: {len(users)}")
        for u in users:
            is_teacher123 = verify_password("teacher123", u.password_hash)
            is_admin123 = verify_password("admin123", u.password_hash)
            print(f"  User: {u.username:15s} | Role: {u.role.value:12s} | teacher123: {is_teacher123} | admin123: {is_admin123}")
    except Exception as e:
        print("[!] DB Error:", str(e))
    finally:
        db.close()

if __name__ == "__main__":
    test_db()
