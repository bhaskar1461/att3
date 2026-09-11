import os
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND_DIR = os.path.join(BASE_DIR, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app.core.database import SessionLocal
from app.models.models import (
    User, Student, AttendanceRecord, DeviceAccountBinding, QRToken, DeviceResetOTP, Section
)

def inspect_and_clean():
    db = SessionLocal()
    try:
        print("=== IDENTIFYING ALL ARTIFACTS FOR BHASKAR SHARMA (23311A05Y6) ===")
        student = db.query(Student).filter(Student.roll_number == "23311A05Y6").first()
        user = db.query(User).filter(User.username == "23311A05Y6").first()

        student_id = student.id if student else None
        user_id = user.id if user else None

        print(f"Student: {student_id}, User: {user_id}")

        # 1. Attendance Records
        att_query = db.query(AttendanceRecord).filter(
            (AttendanceRecord.roll_number == "23311A05Y6") | 
            (AttendanceRecord.student_id == student_id if student_id else False)
        )
        att_count = att_query.count()
        print(f"Found {att_count} AttendanceRecord entries for 23311A05Y6.")

        # 2. Device Account Bindings
        binding_query = db.query(DeviceAccountBinding).filter(DeviceAccountBinding.roll_number == "23311A05Y6")
        binding_count = binding_query.count()
        print(f"Found {binding_count} DeviceAccountBinding entries for 23311A05Y6.")

        # 3. QR Tokens
        qr_query = db.query(QRToken).filter(QRToken.student_id == student_id) if student_id else None
        qr_count = qr_query.count() if qr_query else 0
        print(f"Found {qr_count} QRToken entries for 23311A05Y6.")

        # 4. Device Reset OTPs
        otp_query = db.query(DeviceResetOTP).filter(DeviceResetOTP.roll_number == "23311A05Y6")
        otp_count = otp_query.count()
        print(f"Found {otp_count} DeviceResetOTP entries for 23311A05Y6.")

        print("\n--- PROCEEDING WITH CLEANUP ---")
        if att_count > 0:
            deleted = att_query.delete(synchronize_session=False)
            print(f"[+] Deleted {deleted} AttendanceRecord rows.")

        if binding_count > 0:
            deleted = binding_query.delete(synchronize_session=False)
            print(f"[+] Deleted {deleted} DeviceAccountBinding rows.")

        if qr_count > 0:
            deleted = qr_query.delete(synchronize_session=False)
            print(f"[+] Deleted {deleted} QRToken rows.")

        if otp_count > 0:
            deleted = otp_query.delete(synchronize_session=False)
            print(f"[+] Deleted {deleted} DeviceResetOTP rows.")

        if student:
            db.delete(student)
            print(f"[+] Deleted Student profile {student_id} ({student.roll_number}).")

        if user:
            db.delete(user)
            print(f"[+] Deleted User account {user_id} ({user.username}).")

        db.commit()
        print("\n[+] Database commit successful. Bhaskar Sharma (23311A05Y6) completely removed.")

        # Verification of section 1
        sec1_students = db.query(Student).filter(Student.section_id == 1).order_by(Student.roll_number).all()
        print(f"\n[+] Verified Section 1 (CSE-CS III-I): {len(sec1_students)} legitimate institutional students.")
        total_students = db.query(Student).count()
        print(f"[+] Total students across all sections in DB: {total_students}")

    except Exception as e:
        db.rollback()
        print(f"❌ Error during cleanup: {e}")
        raise
    finally:
        db.close()

if __name__ == "__main__":
    inspect_and_clean()
