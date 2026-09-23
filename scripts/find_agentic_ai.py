import subprocess

KEY_PATH = r"C:\Users\bhask\.ssh\Ather-os_key.pem"
HOST = "20.6.131.206"
USER = "azureuser"

remote_code = """
import sys
sys.path.insert(0, '/home/azureuser/snist_attendance/backend')
from app.core.database import SessionLocal
from app.models.models import Section, Subject, Student, TeacherAssignment, Department
db = SessionLocal()

print('=== ALL SECTIONS ===')
for s in db.query(Section).all():
    print(f'Section id={s.id}, name="{s.name}", dept_id={s.department_id}, year_id={s.academic_year_id}')

print('\\n=== ALL SUBJECTS ===')
for sub in db.query(Subject).all():
    print(f'Subject id={sub.id}, code="{sub.code}", name="{sub.name}"')

print('\\n=== DEPARTMENTS ===')
for d in db.query(Department).all():
    print(f'Dept id={d.id}, code="{d.code}", name="{d.name}"')
"""

res = subprocess.run([
    "ssh", "-i", KEY_PATH, "-o", "StrictHostKeyChecking=no",
    f"{USER}@{HOST}",
    f"/home/azureuser/snist_attendance/venv/bin/python3 -c '{remote_code}'"
], capture_output=True, text=True)

print(res.stdout)
if res.stderr:
    print("STDERR:", res.stderr)
