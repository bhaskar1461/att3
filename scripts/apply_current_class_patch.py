import subprocess

KEY_PATH = r"C:\Users\bhask\.ssh\Ather-os_key.pem"
HOST = "20.6.131.206"
USER = "azureuser"

patch_code = '''with open('/home/azureuser/snist_attendance/backend/app/api/teacher.py', 'r') as f:
    content = f.read()

target_str = \'\'\'@router.get("/current-class")
def get_current_class(db: Session = Depends(get_db), current_teacher: Teacher = Depends(require_teacher)):\'\'\'

end_str = \'\'\'@router.get("/sessions/{session_id}/unmarked-students")\'\'\'

replacement = \'\'\'@router.get("/current-class")
def get_current_class(db: Session = Depends(get_db), current_teacher: Teacher = Depends(require_teacher)):
    """
    Detects current period and timetable class according to server IST time.
    Provides 1-tap start/resume attendance for faculty.
    Server-authoritative: returns detected_period=None when outside class hours or during breaks.
    """
    now_ist = get_server_ist_datetime()
    current_time_str = now_ist.strftime("%H:%M")
    current_date_str = get_server_ist_date()

    periods = [
        ("Period 1", "09:30", "10:20"),
        ("Period 2", "10:20", "11:10"),
        ("Period 3", "11:20", "12:10"),
        ("Period 4", "12:10", "13:00"),
        ("Period 5", "13:40", "14:30"),
        ("Period 6", "14:30", "15:20"),
        ("Period 7", "15:20", "16:10"),
        ("Period 8", "16:10", "17:00"),
    ]

    detected_period = None
    is_class_active = False
    is_break = False
    break_label = None

    if "11:10" < current_time_str < "11:20":
        is_break = True
        break_label = "Morning Short Break (11:10 - 11:20)"
    elif "13:00" < current_time_str < "13:40":
        is_break = True
        break_label = "Lunch Break (13:00 - 13:40)"

    for p_name, start_t, end_t in periods:
        if start_t <= current_time_str <= end_t:
            detected_period = p_name
            is_class_active = True
            break

    assignments = db.query(TeacherAssignment).filter(TeacherAssignment.teacher_id == current_teacher.id).all()
    primary_assignment = assignments[0] if assignments else None

    # 1. Check if current teacher created an active session today
    existing_session = db.query(AttendanceSession).filter(
        AttendanceSession.teacher_id == current_teacher.id,
        AttendanceSession.session_date == current_date_str,
        AttendanceSession.status == SessionStatus.OPEN
    ).order_by(AttendanceSession.id.desc()).first()

    # 2. Check if current teacher is co-teacher in an active session today via SessionTeacher
    if not existing_session:
        st_match = db.query(SessionTeacher).join(
            AttendanceSession, SessionTeacher.session_id == AttendanceSession.id
        ).filter(
            SessionTeacher.teacher_id == current_teacher.user_id,
            AttendanceSession.session_date == current_date_str,
            AttendanceSession.status == SessionStatus.OPEN
        ).order_by(AttendanceSession.id.desc()).first()
        if st_match:
            existing_session = st_match.session

    # 3. Check if any active session matches teacher's assigned subjects and sections
    if not existing_session and assignments:
        assigned_subject_ids = {a.subject_id for a in assignments}
        assigned_section_ids = {a.section_id for a in assignments}
        open_sessions = db.query(AttendanceSession).filter(
            AttendanceSession.session_date == current_date_str,
            AttendanceSession.status == SessionStatus.OPEN,
            AttendanceSession.subject_id.in_(assigned_subject_ids)
        ).order_by(AttendanceSession.id.desc()).all()
        for cand in open_sessions:
            cand_sec_ids = {cand.section_id} | {ss.section_id for ss in cand.session_sections}
            if cand_sec_ids & assigned_section_ids:
                existing_session = cand
                break

    if not existing_session and primary_assignment:
        if detected_period:
            existing_session = db.query(AttendanceSession).filter(
                AttendanceSession.teacher_id == current_teacher.id,
                AttendanceSession.subject_id == primary_assignment.subject_id,
                AttendanceSession.section_id == primary_assignment.section_id,
                AttendanceSession.session_date == current_date_str,
                AttendanceSession.period.like(f"%{detected_period}%")
            ).order_by(AttendanceSession.id.desc()).first()

        if not existing_session:
            existing_session = db.query(AttendanceSession).filter(
                AttendanceSession.teacher_id == current_teacher.id,
                AttendanceSession.subject_id == primary_assignment.subject_id,
                AttendanceSession.section_id == primary_assignment.section_id,
                AttendanceSession.session_date == current_date_str
            ).order_by(AttendanceSession.id.desc()).first()

    if existing_session and existing_session.status == SessionStatus.OPEN:
        is_class_active = True

    active_assignment = None
    if existing_session and existing_session.subject and existing_session.section:
        active_assignment = {
            "assignment_id": primary_assignment.id if primary_assignment else None,
            "subject_id": existing_session.subject_id,
            "subject_name": existing_session.subject.name,
            "subject_code": existing_session.subject.code,
            "section_id": existing_session.section_id,
            "section_name": existing_session.section.name,
        }
    elif primary_assignment:
        active_assignment = {
            "assignment_id": primary_assignment.id,
            "subject_id": primary_assignment.subject_id,
            "subject_name": primary_assignment.subject.name if primary_assignment.subject else "",
            "subject_code": primary_assignment.subject.code if primary_assignment and primary_assignment.subject else "",
            "section_id": primary_assignment.section_id,
            "section_name": primary_assignment.section.name if primary_assignment and primary_assignment.section else "",
        }

    total_enrolled = 0
    present_count = 0
    if existing_session:
        total_enrolled = db.query(Student).filter(Student.section_id == existing_session.section_id).count()
        records = db.query(AttendanceRecord).filter(AttendanceRecord.session_id == existing_session.id).all()
        present_count = sum(1 for r in records if r.status.value in ["PRESENT", "4"])

    return {
        "current_time": current_time_str,
        "current_date": current_date_str,
        "detected_period": detected_period,
        "is_class_active": is_class_active,
        "is_break": is_break,
        "break_label": break_label,
        "has_assignment": active_assignment is not None,
        "assignment": active_assignment,
        "existing_session_id": existing_session.id if existing_session else None,
        "session_status": existing_session.status.value if existing_session else None,
        "total_enrolled": total_enrolled,
        "present_count": present_count,
        "pending_review_count": db.query(AttendanceRecord).filter(
            AttendanceRecord.session_id == existing_session.id,
            AttendanceRecord.status == AttendanceStatus.REVIEW_PENDING
        ).count() if existing_session else 0
    }

\'\'\'

idx_start = content.find(target_str)
idx_end = content.find(end_str)

if idx_start != -1 and idx_end != -1:
    new_content = content[:idx_start] + replacement + content[idx_end:]
    with open('/home/azureuser/snist_attendance/backend/app/api/teacher.py', 'w') as f:
        f.write(new_content)
    print("PATCH SUCCESSFUL")
else:
    print(f"FAILED TO FIND TARGETS: start={idx_start}, end={idx_end}")
'''

# Upload patch script to Azure VM
import tempfile
import os

with tempfile.NamedTemporaryFile("w", delete=False, suffix=".py") as tmp:
    tmp.write(patch_code)
    tmp_path = tmp.name

scp_cmd = ["scp", "-i", KEY_PATH, "-o", "StrictHostKeyChecking=no", tmp_path, f"{USER}@{HOST}:/tmp/patch_teacher.py"]
subprocess.run(scp_cmd, check=True)
os.remove(tmp_path)

ssh_cmd = ["ssh", "-i", KEY_PATH, "-o", "StrictHostKeyChecking=no", f"{USER}@{HOST}", "/home/azureuser/snist_attendance/venv/bin/python3 /tmp/patch_teacher.py && sudo systemctl restart snist-attendance.service"]
subprocess.run(ssh_cmd, check=True)
print("Patch executed and service restarted.")
