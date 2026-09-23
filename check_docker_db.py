from sqlalchemy import create_engine, text

eng = create_engine('mysql+pymysql://snist_user:snist_fast_pass@localhost:3307/snist_fast_db')
with eng.connect() as conn:
    res = conn.execute(text("SELECT id, roll_number, name FROM students WHERE roll_number='23311A0501'")).fetchall()
    print('Student on Local Docker DB:', res)
    sessions = conn.execute(text("SELECT id, session_date, status, subject_id, section_id FROM attendance_sessions WHERE session_date='2026-09-23'")).fetchall()
    print('Sessions today on Local Docker DB:', sessions)
    all_sess = conn.execute(text("SELECT id, session_date, status, subject_id, section_id FROM attendance_sessions ORDER BY id DESC LIMIT 10")).fetchall()
    print('Latest sessions on Local Docker DB:', all_sess)
    records = conn.execute(text("SELECT id, session_id, student_id, roll_number, status, scan_mode, created_at FROM attendance_records WHERE roll_number='23311A0501' ORDER BY id DESC LIMIT 5")).fetchall()
    print('Records for 23311A0501 on Local Docker DB:', records)
