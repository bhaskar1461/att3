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
from app.core.security import get_server_ist_datetime, get_password_hash
from app.models.models import (
    User, UserRole, Student,
    StudentOnboarding, OnboardingState,
)
from app.services.email_service import send_single_email, render_email_template
from app.services.onboarding_service import log_onboarding_event


def generate_student_password() -> str:
    """
    Generates a secure yet mobile-friendly temporary password:
    Format: 'Snist#' followed by 4 random digits (e.g., 'Snist#8241')
    Easy for students to read and type on smartphones without confusion.
    """
    digits = "".join(random.choices(string.digits, k=4))
    return f"Snist#{digits}"


def main():
    parser = argparse.ArgumentParser(description="Generate and dispatch student login credentials")
    parser.add_argument("--dry-run", action="store_true", help="Preview credentials without modifying DB or sending emails")
    parser.add_argument("--test", type=str, default=None, help="Test roll number to run for a single student")
    parser.add_argument("--include-bhaskar", action="store_true", help="Include Bhaskar (23311A05Y6)")
    args = parser.parse_args()

    db = SessionLocal()

    query = db.query(StudentOnboarding)
    if args.test:
        query = query.filter(StudentOnboarding.roll_number == args.test.strip().upper())
    elif not args.include_bhaskar:
        query = query.filter(StudentOnboarding.roll_number != "23311A05Y6")

    students = query.order_by(StudentOnboarding.roll_number).all()

    print("=" * 80)
    print(f"SNIST ERP — STUDENT CREDENTIAL GENERATION & DISPATCH")
    print(f"Total target students: {len(students)}")
    print(f"Dry Run Mode: {args.dry_run}")
    print("=" * 80)

    if not students:
        print("No student records found matching criteria.")
        db.close()
        return

    now = get_server_ist_datetime().replace(tzinfo=None)
    success_count = 0
    fail_count = 0
    records_dispatched = []

    for idx, sob in enumerate(students, 1):
        roll = sob.roll_number.strip().upper()
        name = sob.name or roll
        email = (sob.email or "").strip().lower()

        if not email:
            print(f"[{idx:2d}/{len(students)}] {roll} ({name}) -> SKIPPED (No email address)")
            fail_count += 1
            continue

        temp_password = generate_student_password()
        pw_hash = get_password_hash(temp_password)

        if args.dry_run:
            print(f"[{idx:2d}/{len(students)}] [DRY-RUN] {roll} ({name}) -> {email} | Password: {temp_password}")
            success_count += 1
            continue

        try:
            # 1. Ensure User record exists
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

            # 2. Ensure Student record exists
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

            # 3. Activate StudentOnboarding record
            sob.student_id = student.id
            sob.state = OnboardingState.ACTIVATED
            sob.pin_hash = pw_hash
            sob.activated_at = now
            db.commit()

            # 4. Render Email Template
            html_body = render_email_template("student_credentials_email.html", {
                "name": name,
                "sap_id": roll,
                "temp_password": temp_password,
            })

            # 5. Dispatch Email
            subject = f"SNIST ERP — Student Portal Login Credentials ({roll})"
            send_res = send_single_email(
                to_email=email,
                subject=subject,
                html_body=html_body,
                channel="DEFAULT"
            )

            status_str = send_res.get("status", "UNKNOWN")
            channel_used = send_res.get("channel", "DEFAULT")

            if status_str in ("SENT", "DEV_MODE"):
                success_count += 1
                disp_status = f"SENT ({channel_used})"
            else:
                fail_count += 1
                disp_status = f"FAILED ({send_res.get('error')})"

            records_dispatched.append({
                "roll": roll,
                "name": name,
                "email": email,
                "password": temp_password,
                "status": disp_status
            })

            print(f"[{idx:2d}/{len(students)}] {roll} ({name}) -> {email}: {disp_status}")

            # Friendly SMTP throughput throttle
            time.sleep(0.4)

        except Exception as e:
            db.rollback()
            fail_count += 1
            print(f"[{idx:2d}/{len(students)}] {roll} ERROR: {e}")

    db.close()

    print("\n" + "=" * 80)
    print(f"DISPATCH FINISHED: {success_count} SUCCESS, {fail_count} FAILED OUT OF {len(students)}")
    print("=" * 80)


if __name__ == "__main__":
    main()
