import os
import sys

sys.path.insert(0, '/home/azureuser/snist_attendance/backend')
from app.core.database import SessionLocal
from app.models.models import StudentOnboarding

db = SessionLocal()
records = db.query(StudentOnboarding).all()
print(f"Total StudentOnboarding records: {len(records)}")
states = {}
for r in records:
    st = str(r.state)
    states[st] = states.get(st, 0) + 1

print("State breakdown:", states)
print("\nSample records:")
for r in records[:10]:
    print(f"ID={r.id}, Roll={r.roll_number}, Name={r.name}, Email={r.email}, State={r.state}, Sec={r.section}")

# Check for Bhaskar
bhaskar = [r for r in records if "bhaskar" in (r.name or "").lower() or "23311a05y6" in (r.roll_number or "").lower()]
print(f"\nBhaskar in StudentOnboarding: {len(bhaskar)}")
for b in bhaskar:
    print(f"  Bhaskar: ID={b.id}, Roll={b.roll_number}, Name={b.name}")

db.close()
