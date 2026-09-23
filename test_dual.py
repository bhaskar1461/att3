import sys, ssl, time
sys.path.insert(0, "/home/azureuser/snist_attendance/backend")
from sqlalchemy import create_engine, text

sec_ctx = ssl.create_default_context()
sec_ctx.check_hostname = False
sec_ctx.verify_mode = ssl.CERT_NONE

url = "mysql+pymysql://snist_admin:SnistAdmin2026Secure@snist-attendance-db.cngk2i8i29dn.ap-south-1.rds.amazonaws.com:3306/seg_demo"
engine = create_engine(
    url,
    connect_args={"connect_timeout": 5, "read_timeout": 8, "write_timeout": 8, "ssl": sec_ctx},
    pool_pre_ping=True
)
with engine.connect() as conn:
    res = conn.execute(text("SELECT 1")).scalar()
    print("Secondary AWS RDS connection verified! Result:", res)
