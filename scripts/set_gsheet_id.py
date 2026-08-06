import pymysql

SHEET_ID = "113b1RKUGQGHtoViEFJjgeGxD1VzxaGgSAn0Guxh_ni8"

conn = pymysql.connect(host='seg-dev.sreenidhi.edu.in', user='demo', password='Admin@321#', database='seg_demo', port=3306)
cursor = conn.cursor()

cursor.execute("UPDATE qr_system_settings SET value = %s WHERE `key` = 'GOOGLE_SPREADSHEET_ID'", (SHEET_ID,))
conn.commit()

cursor.execute("SELECT * FROM qr_system_settings WHERE `key` = 'GOOGLE_SPREADSHEET_ID'")
print("[SUCCESS] Active Google Spreadsheet ID set to:", cursor.fetchone())
conn.close()
