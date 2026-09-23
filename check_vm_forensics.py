import subprocess

remote_code = """
import sys
sys.path.insert(0, '/home/azureuser/snist_attendance/backend')
from app.core.database import SessionLocal
from app.models.models import AttendanceSession, AttendanceRecord, Student, Subject, Section
db = SessionLocal()
st = db.query(Student).filter(Student.roll_number == '23311A0501').first()
print('Student on Azure VM:', st.id if st else 'None', st.name if st else '')
if st:
    recs = db.query(AttendanceRecord).filter(AttendanceRecord.student_id == st.id).all()
    print('Total records for 23311A0501:', len(recs))
    for r in recs[-10:]:
        print(f'Rec {r.id}: sess={r.session_id} date={r.session_date} status={r.status} mode={r.scan_mode} time={r.created_at}')

sessions = db.query(AttendanceSession).filter(AttendanceSession.session_date == '2026-09-23').all()
print('Sessions today on VM:', len(sessions))
for s in sessions:
    sub = db.query(Subject).filter(Subject.id == s.subject_id).first()
    sec = db.query(Section).filter(Section.id == s.section_id).first()
    print(f'Sess {s.id}: status={s.status} sec={sec.name if sec else s.section_id} sub={sub.name if sub else s.subject_id} teacher={s.teacher_id}')

all_sessions = db.query(AttendanceSession).order_by(AttendanceSession.id.desc()).limit(10).all()
print('Latest 10 sessions on VM:')
for s in all_sessions:
    sub = db.query(Subject).filter(Subject.id == s.subject_id).first()
    sec = db.query(Section).filter(Section.id == s.section_id).first()
    print(f'Sess {s.id}: date={s.session_date} status={s.status} sec={sec.name if sec else s.section_id} sub={sub.name if sub else s.subject_id}')

db.close()
"""

cmd = [
    'ssh',
    '-i', r'C:\Users\bhask\.ssh\Ather-os_key.pem',
    '-o', 'StrictHostKeyChecking=no',
    'azureuser@20.6.131.206',
    '/home/azureuser/snist_attendance/venv/bin/python3',
    '-'
]

res = subprocess.run(cmd, input=remote_code, capture_output=True, text=True)
print("STDOUT:\n", res.stdout)
if res.stderr:
    print("STDERR:\n", res.stderr)
