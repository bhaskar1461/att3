import os

try:
    from pydantic_settings import BaseSettings
except ImportError:
    try:
        from pydantic import BaseSettings
    except ImportError:
        class BaseSettings:
            pass

class Settings:
    PROJECT_NAME: str = "AI QR Attendance System"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"
    
    # Secret keys
    SECRET_KEY: str = os.getenv("SECRET_KEY", "8f3b2a19e5d4c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2")
    QR_SECRET_KEY: str = os.getenv("QR_SECRET_KEY", "a1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdef") # 32 bytes hex for AES
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days for staff/admin
    STUDENT_TOKEN_EXPIRE_SECONDS: int = 30  # 30 seconds for student session tokens
    DEVICE_BINDING_MINUTES: int = 30  # 30 minutes server device lock
    MAX_BINDING_AUTH_ATTEMPTS: int = 5  # Max 5 attempts per binding window
    
    # Database
    # config.py is at backend/app/core/config.py -> 3 dirnames = backend, 4 dirnames = project root
    BACKEND_DIR: str = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    BASE_DIR: str = os.path.dirname(BACKEND_DIR)
    DATABASE_URL: str = os.getenv("DATABASE_URL", "mysql+pymysql://demo:Admin%40321%23@seg-dev.sreenidhi.edu.in:3306/seg_demo")
    
    # Storage Paths
    DATA_DIR: str = os.path.join(BACKEND_DIR, "data")
    MASTER_TEMPLATE_DIR: str = os.path.join(DATA_DIR, "master_templates")
    OUTPUT_EXCEL_DIR: str = os.path.join(DATA_DIR, "outputs")
    QR_OUTPUT_DIR: str = os.path.join(DATA_DIR, "qr_codes")
    
    # Google Sheets Settings (Optional)
    GOOGLE_CREDENTIALS_FILE: str = os.getenv("GOOGLE_CREDENTIALS_FILE", "")
    GOOGLE_SPREADSHEET_ID: str = os.getenv("GOOGLE_SPREADSHEET_ID", "113b1RKUGQGHtoViEFJjgeGxD1VzxaGgSAn0Guxh_ni8")

settings = Settings()

# Ensure directories exist
os.makedirs(settings.MASTER_TEMPLATE_DIR, exist_ok=True)
os.makedirs(settings.OUTPUT_EXCEL_DIR, exist_ok=True)
os.makedirs(settings.QR_OUTPUT_DIR, exist_ok=True)
