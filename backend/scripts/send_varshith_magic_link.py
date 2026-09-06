import sys
import os

# Set up python path to backend root
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.database import SessionLocal
from app.models.models import User, Student, StudentOnboarding
from app.core.security import create_magic_login_token
from app.services.email_service import send_single_email

def main():
    recipient = "bhaskar2004sharma@gmail.com"
    roll_number = "24311A6204"
    name = "Jangapally Varshith"
    password = "Varshith@123"

    # Generate 7-day magic login token
    token = create_magic_login_token(username=roll_number, role="STUDENT", expires_days=7)
    magic_link = f"https://ather-os.de5.net/login?magic_token={token}"

    html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>SNIST Attendance — Magic Login Link</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; padding: 24px; margin: 0;">
    <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
        <div style="background: linear-gradient(135deg, #15347e 0%, #001e40 100%); padding: 24px; text-align: center; color: white;">
            <h1 style="margin: 0; font-size: 18px; font-weight: 700; letter-spacing: 0.5px;">SREENIDHI INSTITUTE OF SCIENCE &amp; TECHNOLOGY</h1>
            <p style="margin: 6px 0 0; font-size: 12px; opacity: 0.8; letter-spacing: 1px;">AI QR ATTENDANCE SYSTEM — DEMO CREDENTIALS</p>
        </div>
        <div style="padding: 24px;">
            <p style="font-size: 15px; color: #1e293b; margin: 0 0 12px;">Hello Bhaskar,</p>
            <p style="font-size: 14px; color: #475569; line-height: 1.5; margin: 0 0 20px;">
                Here is the 1-click <strong>Magic Login Link</strong> for demo student <strong>{name} ({roll_number})</strong> to test on your Android device:
            </p>
            
            <div style="background: #f1f5f9; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
                <p style="margin: 0 0 8px; font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px;">Student Demo Credentials</p>
                <p style="margin: 0 0 6px; font-size: 14px; color: #0f172a;"><strong>Roll Number:</strong> <code style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px; font-weight: 600;">{roll_number}</code></p>
                <p style="margin: 0 0 6px; font-size: 14px; color: #0f172a;"><strong>Password:</strong> <code style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px; font-weight: 600;">{password}</code></p>
                <p style="margin: 0; font-size: 14px; color: #0f172a;"><strong>Class / Section:</strong> CS-A (Mrs. N. Sowjanya)</p>
            </div>

            <div style="text-align: center; margin: 28px 0;">
                <a href="{magic_link}" style="display: inline-block; background: #0284c7; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 700; font-size: 15px; letter-spacing: 0.5px; box-shadow: 0 2px 4px rgba(2,132,199,0.3);">
                    Sign In as Varshith (1-Click) &rarr;
                </a>
            </div>

            <p style="font-size: 12px; color: #64748b; line-height: 1.5; margin-bottom: 8px;">
                If tapping the button does not open the link directly on your Android phone, copy and paste this URL into <strong>Google Chrome</strong>:
            </p>
            <p style="font-size: 11px; color: #0284c7; word-break: break-all; background: #f8fafc; padding: 10px; border-radius: 6px; border: 1px solid #e2e8f0; margin: 0 0 20px;">
                <a href="{magic_link}" style="color: #0284c7; text-decoration: none;">{magic_link}</a>
            </p>

            <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 12px 14px; margin-bottom: 20px;">
                <p style="margin: 0 0 4px; font-size: 12px; font-weight: 700; color: #166534;">📱 Android Testing Instructions:</p>
                <ol style="margin: 0; padding-left: 18px; font-size: 12px; color: #15803d; line-height: 1.6;">
                    <li>Open Chrome on Android and tap the magic link above.</li>
                    <li>Tap the Chrome menu (⋮) &rarr; <strong>"Install App"</strong> (or "Add to Home Screen").</li>
                    <li>Launch from the new home screen icon &rarr; scanner camera activates seamlessly in standalone mode!</li>
                </ol>
            </div>

            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
            
            <p style="font-size: 11px; color: #94a3b8; margin: 0; text-align: center;">
                SNIST Attendance System &bull; Automated Security &amp; Credential Dispatch
            </p>
        </div>
    </div>
</body>
</html>
"""

    print(f"Dispatching magic link email to {recipient}...")
    result = send_single_email(
        to_email=recipient,
        subject=f"[SNIST Attendance] Demo Login Magic Link — {name} ({roll_number})",
        html_body=html_content,
        channel="DEFAULT"
    )
    print("Dispatch result:", result)
    print("\nMagic Link URL:")
    print(magic_link)

if __name__ == "__main__":
    main()
