import sys
sys.path.insert(0, '/home/azureuser/snist_attendance/backend')
from app.core.database import SessionLocal, engine
from sqlalchemy import text

db = SessionLocal()

query = text("""
SELECT 
    TABLE_NAME, COLUMN_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
FROM
    INFORMATION_SCHEMA.KEY_COLUMN_USAGE
WHERE
    REFERENCED_TABLE_NAME IN ('qr_students', 'qr_sections')
    AND TABLE_SCHEMA = 'seg_demo';
""")

rows = db.execute(query).fetchall()
print("References to qr_students and qr_sections:")
for r in rows:
    print(f"Table: {r[0]}, Column: {r[1]} -> Ref: {r[3]}.{r[4]}")
