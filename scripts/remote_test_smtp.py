import os
import sys

sys.path.insert(0, '/home/azureuser/snist_attendance/backend')
from app.services.email_service import send_single_email

res = send_single_email(
    to_email="23311a05y6@cse.sreenidhi.edu.in",
    subject="[SNIST ERP] SMTP Verification Test",
    html_body="<p>This is a verification test of SMTP on Azure.</p>",
    channel="DEFAULT"
)
print("SMTP Send Result:", res)
