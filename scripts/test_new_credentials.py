import json
import os
import sys

new_creds = {
    "web": {
        "client_id": os.getenv("GOOGLE_CLIENT_ID", "your-client-id.apps.googleusercontent.com"),
        "project_id": "attendance-system-507904",
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
        "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
        "client_secret": os.getenv("GOOGLE_CLIENT_SECRET", "your-client-secret"),
        "redirect_uris": ["http://localhost:8080/", "https://ather-os.de5.net"],
        "javascript_origins": ["https://ather-os.de5.net", "http://localhost"]
    }
}

print("New credentials client_id:", new_creds["web"]["client_id"])
print("Project ID:", new_creds["web"]["project_id"])
print("Redirect URIs:", new_creds["web"]["redirect_uris"])
