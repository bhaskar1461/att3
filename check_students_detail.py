import sys
sys.path.insert(0, "/home/azureuser/snist_attendance/backend")
from app.core.database import SessionLocal
from app.models.models import User, Student, StudentOnboarding, CredentialItem

with SessionLocal() as db:
    students = db.query(User).filter(User.role == "STUDENT").limit(5).all()
    print("=== 5 Sample Students ===")
    for s in students:
        st_profile = db.query(Student).filter(Student.user_id == s.id).first()
        name = st_profile.name if st_profile else "No profile"
        print(f"User: id={s.id}, username={s.username}, email={s.email}, name={name}, is_active={s.is_active}")

    # Check demo student
    demo_s = db.query(User).filter(User.username.ilike("%demo%")).all()
    print("\n=== Demo Users ===")
    for d in demo_s:
        print(f"Demo user: id={d.id}, username={d.username}, role={d.role}, email={d.email}")
