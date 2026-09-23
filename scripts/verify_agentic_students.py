import sys
sys.path.insert(0, '/home/azureuser/snist_attendance/backend')
from app.core.database import SessionLocal
from app.models.models import Student, Section

db = SessionLocal()

requested_rolls = [
    "23311A6636", "24311A6616", "24311A6681", "24311A66M2", "24311A66P5",
    "24311A66Q2", "24311A66R4", "24311A66AL", "24311A66W2", "24311A66W9",
    "24311A66X1", "24311A6215", "24311A6216", "24311A6230", "24311A6236",
    "24311A6260", "24311A6263", "24311A05E1", "24311A05BP", "24311A05FD",
    "24311A6723", "24311A6736", "22311A6754", "24311A6796", "24311A67H3",
    "24311A04B3", "24311A04E4", "23311A04N0", "24311A04CX", "24311A04EA",
    "24311A0203", "24311A0219", "24311A0228", "24311A1207", "24311A1228",
    "24311A1281", "24311A1293", "24311A12D9", "24311A12F0", "24311A12G0",
    "24311A0312", "24311A0314", "24311A0317", "24311A0318", "24311A0321",
    "24311A0327", "24311A0339"
]

print(f"Total requested rolls: {len(requested_rolls)}")

found = 0
not_found = []
in_agentic_ai = []
in_other_section = []

for idx, roll in enumerate(requested_rolls, 1):
    s = db.query(Student).filter(Student.roll_number == roll).first()
    if not s:
        not_found.append((idx, roll))
    else:
        found += 1
        sec_name = s.section.name if s.section else f"NULL (sec_id={s.section_id})"
        if s.section_id == 36:
            in_agentic_ai.append((idx, roll, s.name, sec_name))
        else:
            in_other_section.append((idx, roll, s.name, sec_name))

print(f"Found in DB: {found}/{len(requested_rolls)}")
print(f"Currently in Agentic AI (Section 36): {len(in_agentic_ai)}")
print(f"In other sections: {len(in_other_section)}")
print(f"Not found in DB: {len(not_found)}")

if not_found:
    print("\nNOT FOUND ROLLS:")
    for idx, r in not_found:
        print(f" #{idx}: {r}")

if in_other_section:
    print("\nIN OTHER SECTION:")
    for idx, r, name, sec in in_other_section:
        print(f" #{idx}: {r} ({name}) -> {sec}")

print("\nSAMPLE MATCHES IN AGENTIC AI (first 10):")
for idx, r, name, sec in in_agentic_ai[:10]:
    print(f" #{idx}: {r} | {name} | {sec}")
