import os
import sys
import time
from datetime import datetime

sys.path.insert(0, '/home/azureuser/snist_attendance/backend')
from app.core.database import SessionLocal
from app.core.config import settings
from app.models.models import StudentOnboarding, OnboardingState
from app.services.onboarding_service import generate_magic_token
from app.services.email_service import send_single_email, render_email_template

db = SessionLocal()

# Target all 50 CS students, explicitly excluding Bhaskar
targets = db.query(StudentOnboarding).filter(
    StudentOnboarding.roll_number != "23311A05Y6"
).order_by(StudentOnboarding.roll_number).all()

print("=" * 70)
print(f"DISPATCHING NEW MAGIC ONBOARDING LINKS TO {len(targets)} CS STUDENTS")
print("=" * 70)

frontend_url = "https://ather-os.de5.net"
success_count = 0
fail_count = 0
results = []

for idx, student in enumerate(targets, 1):
    try:
        # 1. Reset state to LINK_SENT so verify_magic_token permits account creation
        student.state = OnboardingState.LINK_SENT
        student.mobile_verified = False
        student.link_sent_at = datetime.utcnow()
        db.commit()

        # 2. Generate brand new 48-hour magic token
        raw_token = generate_magic_token(
            db=db,
            onboarding_id=student.id,
            roll_number=student.roll_number,
            performed_by=1  # System Admin
        )

        magic_link = f"{frontend_url}/onboard?token={raw_token}"

        # 3. Render official email template
        html_body = render_email_template("magic_link_email.html", {
            "student_name": student.name,
            "roll_number": student.roll_number,
            "department": student.department or "Department of CSE-CS",
            "section": student.section or "A",
            "magic_link": magic_link,
            "expiry_hours": settings.MAGIC_LINK_EXPIRY_HOURS,
        })

        # 4. Dispatch email
        subject = f"[SNIST Attendance] Student Portal Account Onboarding — {student.name} ({student.roll_number})"
        send_res = send_single_email(
            to_email=student.email,
            subject=subject,
            html_body=html_body,
            channel="DEFAULT"
        )

        if send_res.get("status") == "SENT":
            success_count += 1
            status_str = f"SENT ({send_res.get('channel')})"
        else:
            fail_count += 1
            status_str = f"FAILED ({send_res.get('error')})"

        results.append({
            "roll_number": student.roll_number,
            "name": student.name,
            "email": student.email,
            "status": status_str,
            "magic_link": magic_link
        })

        print(f"[{idx:2d}/{len(targets)}] {student.roll_number} ({student.name}) -> {student.email}: {status_str}")

        # Slight pause to adhere to SMTP throughput guidelines
        time.sleep(0.4)

    except Exception as e:
        fail_count += 1
        print(f"[{idx:2d}/{len(targets)}] {student.roll_number} ERROR: {e}")
        results.append({
            "roll_number": student.roll_number,
            "name": student.name,
            "email": student.email,
            "status": f"ERROR: {e}",
            "magic_link": ""
        })

db.close()

print("\n" + "=" * 70)
print(f"DISPATCH COMPLETED: {success_count} SUCCESS, {fail_count} FAILED OUT OF {len(targets)} STUDENTS")
print("=" * 70)
