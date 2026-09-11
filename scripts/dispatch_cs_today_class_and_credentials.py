import os
import sys
import time
import random
import string
import argparse
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND_DIR = os.path.join(BASE_DIR, "backend")
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app.core.database import SessionLocal
from app.core.security import get_server_ist_datetime, get_password_hash, create_magic_login_token
from app.models.models import (
    User, UserRole, Student,
    StudentOnboarding, OnboardingState,
    AttendanceSession, SessionStatus, Teacher, Subject, Section
)
from app.services.email_service import (
    send_single_email, render_email_template,
    send_teacher_class_allotment_notification,
    global_email_limiter
)


def generate_student_password() -> str:
    """Generates mobile-friendly temporary password (e.g., 'Snist#8241')."""
    digits = "".join(random.choices(string.digits, k=4))
    return f"Snist#{digits}"


def setup_today_attendance_session(db) -> AttendanceSession:
    """Ensures a live open attendance session exists for today 1:10 PM - 4:00 PM."""
    today_str = "2026-09-09"

    # 1. Lock any old dangling open sessions (e.g. from 2026-09-07)
    old_open_sessions = db.query(AttendanceSession).filter(
        AttendanceSession.session_date != today_str,
        AttendanceSession.status == SessionStatus.OPEN
    ).all()
    for old_s in old_open_sessions:
        old_s.status = SessionStatus.LOCKED
        old_s.locked_at = datetime.utcnow()
        print(f" -> Locked past open session ID {old_s.id} from {old_s.session_date}")
    db.commit()

    # 2. Check or create today's session
    today_session = db.query(AttendanceSession).filter(
        AttendanceSession.teacher_id == 4,      # Mrs. N. Sowjanya
        AttendanceSession.subject_id == 5,      # Career Enhancement Training (CET)
        AttendanceSession.section_id == 1,      # CS-A
        AttendanceSession.session_date == today_str
    ).first()

    if today_session:
        today_session.status = SessionStatus.OPEN
        today_session.period = "Period 5-8 (4 Periods)"
        db.commit()
        print(f" -> Using existing session ID {today_session.id} for today ({today_str}) [OPEN, Period 5-8]")
    else:
        today_session = AttendanceSession(
            teacher_id=4,
            subject_id=5,
            section_id=1,
            period="Period 5-8 (4 Periods)",
            session_date=today_str,
            status=SessionStatus.OPEN,
            created_at=datetime.utcnow()
        )
        db.add(today_session)
        db.commit()
        db.refresh(today_session)
        print(f" -> Created fresh attendance session ID {today_session.id} for today ({today_str}) [OPEN, Period 5-8]")

    # 3. Clean up Burri Poojitha email if it was altered by tests
    poojitha = db.query(StudentOnboarding).filter(StudentOnboarding.roll_number == "24311A6201").first()
    if poojitha and poojitha.email != "24311a6201@cs.sreenidhi.edu.in":
        poojitha.email = "24311a6201@cs.sreenidhi.edu.in"
        poo_user = db.query(User).filter(User.username == "24311A6201").first()
        if poo_user:
            poo_user.email = "24311a6201@cs.sreenidhi.edu.in"
        poo_stu = db.query(Student).filter(Student.roll_number == "24311A6201").first()
        if poo_stu:
            poo_stu.email = "24311a6201@cs.sreenidhi.edu.in"
        db.commit()
        print(" -> Restored Burri Poojitha (24311A6201) email to 24311a6201@cs.sreenidhi.edu.in")

    return today_session


def main():
    parser = argparse.ArgumentParser(description="Dispatch CS student credentials & notify Sowjanya ma'am")
    parser.add_argument("--dry-run", action="store_true", help="Preview credentials and emails without modifying DB or sending")
    parser.add_argument("--test-roll", type=str, default=None, help="Test a single roll number")
    parser.add_argument("--skip-teacher", action="store_true", help="Skip sending email to Mrs. N. Sowjanya")
    parser.add_argument("--skip-students", action="store_true", help="Skip sending emails to students")
    args = parser.parse_args()

    db = SessionLocal()

    print("=" * 80)
    print("SNIST ERP — TODAY'S CLASS DISPATCH: CS-A (CET) 1:10 PM – 4:00 PM")
    print(f"Server IST: {get_server_ist_datetime()}")
    print(f"Dry Run Mode: {args.dry_run}")
    print(f"Remaining SMTP Quota: {global_email_limiter.get_remaining_quota()}")
    print("=" * 80)

    # 1. Setup Session
    if not args.dry_run:
        session = setup_today_attendance_session(db)
        print(f"Active Session ID: {session.id} | Period: {session.period} | Status: {session.status.value}\n")

    # 2. Query target CS students
    query = db.query(StudentOnboarding).filter(
        StudentOnboarding.section_id == 1,
        StudentOnboarding.roll_number != "23311A05Y6",     # Exclude Bhaskar
        StudentOnboarding.roll_number != "DEMOSTUDENT"      # Exclude Demo Student
    )

    if args.test_roll:
        query = query.filter(StudentOnboarding.roll_number == args.test_roll.strip().upper())

    students = query.order_by(StudentOnboarding.roll_number).all()
    print(f"Target CS Students Count: {len(students)}")

    frontend_url = "https://ather-os.de5.net"
    student_success = 0
    student_failed = 0
    now = get_server_ist_datetime().replace(tzinfo=None)

    # 3. Dispatch to Students
    if not args.skip_students:
        print("\n--- PHASE 1: DISPATCHING CREDENTIALS TO CS STUDENTS ---")
        for idx, sob in enumerate(students, 1):
            roll = sob.roll_number.strip().upper()
            name = sob.name or roll
            email = (sob.email or "").strip().lower()

            # Fix email override for Burri Poojitha if needed
            if roll == "24311A6201":
                email = "24311a6201@cs.sreenidhi.edu.in"

            if not email or "@" not in email:
                print(f"[{idx:2d}/{len(students)}] {roll} ({name}) -> SKIPPED (No valid email)")
                student_failed += 1
                continue

            temp_password = generate_student_password()
            pw_hash = get_password_hash(temp_password)

            # Generate 7-day magic token for 1-click login
            magic_token = create_magic_login_token(username=roll, role="STUDENT", expires_days=7)
            magic_login_url = f"{frontend_url}/login?magic_token={magic_token}"

            if args.dry_run:
                print(f"[{idx:2d}/{len(students)}] [DRY-RUN] {roll:10} | {name:28} | {email:32} | Pwd: {temp_password} | Magic: Yes")
                student_success += 1
                continue

            try:
                # Update / create User record
                user = db.query(User).filter(User.username == roll).first()
                if not user:
                    user = db.query(User).filter(User.email == email).first()

                if user:
                    user.username = roll
                    user.email = email
                    user.password_hash = pw_hash
                    user.role = UserRole.STUDENT
                    user.is_active = True
                    user.must_change_password = False
                else:
                    user = User(
                        username=roll,
                        email=email,
                        password_hash=pw_hash,
                        role=UserRole.STUDENT,
                        is_active=True,
                        must_change_password=False,
                    )
                    db.add(user)
                db.flush()

                # Update / create Student record
                student = db.query(Student).filter(Student.roll_number == roll).first()
                if student:
                    student.user_id = user.id
                    student.name = name
                    student.email = email
                else:
                    student = Student(
                        user_id=user.id,
                        roll_number=roll,
                        name=name,
                        department_id=sob.department_id or 1,
                        academic_year_id=sob.academic_year_id or 1,
                        section_id=sob.section_id or 1,
                        email=email,
                        mobile=sob.mobile_number,
                    )
                    db.add(student)
                db.flush()

                # Activate StudentOnboarding record
                sob.student_id = student.id
                sob.state = OnboardingState.ACTIVATED
                sob.pin_hash = pw_hash
                sob.activated_at = now
                sob.email = email
                db.commit()

                # Render HTML template with today's class schedule & credentials
                html_body = render_email_template("student_credentials_email.html", {
                    "name": name,
                    "sap_id": roll,
                    "temp_password": temp_password,
                    "class_name": "Career Enhancement Training (CET)",
                    "department": "CSE-CS",
                    "section": "CS-A",
                    "class_timings": "Today, 01:10 PM – 04:00 PM (Periods 5–8)",
                    "teacher_name": "Mrs. N. Sowjanya",
                    "venue": "CSE-CS Projector Lab",
                    "magic_login_url": magic_login_url,
                    "portal_url": frontend_url,
                })

                subject = f"SNIST ERP — Login Credentials & Class Info: CET (Today 1:10 PM - 4:00 PM) - {roll}"
                send_res = send_single_email(
                    to_email=email,
                    subject=subject,
                    html_body=html_body,
                    channel="DEFAULT"
                )

                status_str = send_res.get("status", "UNKNOWN")
                channel_used = send_res.get("channel", "DEFAULT")

                if status_str in ("SENT", "DEV_MODE"):
                    student_success += 1
                    disp_status = f"SENT ({channel_used})"
                else:
                    student_failed += 1
                    disp_status = f"FAILED: {send_res.get('error')}"

                print(f"[{idx:2d}/{len(students)}] {roll:10} | {name:28} -> {email:32}: {disp_status}")

                # Rate limiter throttle
                time.sleep(0.4)

            except Exception as e:
                db.rollback()
                student_failed += 1
                print(f"[{idx:2d}/{len(students)}] {roll} ERROR: {e}")

        print(f"\nPhase 1 Complete: {student_success} Sent, {student_failed} Failed out of {len(students)} Students")

    # 4. Dispatch to Faculty (Mrs. N. Sowjanya)
    if not args.skip_teacher:
        print("\n--- PHASE 2: DISPATCHING CET CLASS INFO TO MRS. N. SOWJANYA ---")
        teacher_email = "sowjanya.n@sreenidhi.edu.in"
        today_date = get_server_ist_datetime().date()

        if args.dry_run:
            print(f"[DRY-RUN] To: {teacher_email}")
            print("  Subject: SNIST ERP — Class Assignment & Timetable: Career Enhancement Training (CET) (CS-A)")
            print(f"  Class: Career Enhancement Training (CET) [CS(CET)]")
            print(f"  Timings: 01:10 PM – 04:00 PM (4-Period Block / Periods 5–8)")
            print(f"  Date: Today, {today_date.strftime('%B %d, %Y')}")
            print(f"  Venue: CSE-CS Projector Lab")
            print(f"  Enrolled Students: {len(students)}")
        else:
            try:
                t_res = send_teacher_class_allotment_notification(
                    db=db,
                    teacher_email=teacher_email,
                    section_id=1,
                    section_name="CS-A",
                    department_code="CSE-CS",
                    student_count=len(students),
                    frontend_url=frontend_url,
                    trigger_context="TODAY_CLASS_DISPATCH",
                    timings="01:10 PM – 04:00 PM (4-Period Block / Periods 5–8)",
                    next_class_date=f"Today, {today_date.strftime('%B %d, %Y')} (01:10 PM – 04:00 PM)",
                    weekly_schedule="Today (Wednesday) from 01:10 PM to 04:00 PM",
                    venue="CSE-CS Projector Lab",
                )
                print(f"Teacher Notification Dispatched to {teacher_email}:")
                print(f"  Status: {t_res.get('status')}")
                print(f"  Teacher: {t_res.get('teacher_name')}")
                print(f"  Class: {t_res.get('class_name')}")
                print(f"  Schedule: {t_res.get('weekly_schedule')}")
                print(f"  Magic Link: {t_res.get('magic_login_url')}")
            except Exception as te:
                print(f"ERROR notifying Mrs. N. Sowjanya: {te}")

    db.close()

    print("\n" + "=" * 80)
    print("DISPATCH COMPLETE!")
    print(f"  Students Dispatched: {student_success} / {len(students)} (Failed: {student_failed})")
    print(f"  Teacher Notified: {'YES' if not args.skip_teacher and not args.dry_run else ('DRY-RUN' if args.dry_run else 'SKIPPED')}")
    print(f"  Remaining SMTP Quota: {global_email_limiter.get_remaining_quota()}")
    print("=" * 80)


if __name__ == "__main__":
    main()
