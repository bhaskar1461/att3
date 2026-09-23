import sys
sys.path.insert(0, "/home/azureuser/snist_attendance/backend")
from app.core.database import SessionLocal
from app.models.models import Teacher, User

with SessionLocal() as db:
    for tid in [5, 22, 23, 24, 25]:
        t = db.query(Teacher).filter(Teacher.id == tid).first()
        if t:
            u = db.query(User).filter(User.id == t.user_id).first()
            print(f"Teacher {t.name} (id={t.id}): user_id={t.user_id}, username={u.username if u else 'N/A'}, email={u.email if u else 'N/A'}")
