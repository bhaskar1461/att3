import os
import sys
import json
from datetime import datetime

# Setup pathing
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND_DIR = os.path.join(BASE_DIR, "backend")
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app.core.database import SessionLocal
from app.models.models import Student
from app.services.qr_service import QRService
from app.core.security import get_server_ist_date

today_date = get_server_ist_date()

db = SessionLocal()
try:
    # 1. Fetch 10 Civil III-I Students
    civil_students = db.query(Student).filter(Student.section_id == 2).order_by(Student.roll_number).limit(10).all()
    if not civil_students:
        civil_students = db.query(Student).filter(Student.roll_number.like("24311A%")).order_by(Student.roll_number).limit(10).all()

    # 2. Fetch 10 CSE-A Students
    cse_students = db.query(Student).filter(Student.section_id == 1).order_by(Student.roll_number).limit(10).all()
    if not cse_students:
        cse_students = db.query(Student).filter(Student.roll_number.like("21311A%")).order_by(Student.roll_number).limit(10).all()

    civil_cards = []
    for s in civil_students:
        qr_b64 = QRService.generate_pure_qr_code(
            student_id=s.id,
            roll_number=s.roll_number,
            attendance_date=today_date,
            as_base64=True
        )
        civil_cards.append({"roll": s.roll_number, "name": s.name, "qr": qr_b64})

    cse_cards = []
    for s in cse_students:
        qr_b64 = QRService.generate_pure_qr_code(
            student_id=s.id,
            roll_number=s.roll_number,
            attendance_date=today_date,
            as_base64=True
        )
        cse_cards.append({"roll": s.roll_number, "name": s.name, "qr": qr_b64})
finally:
    db.close()

def build_grid_cards(cards):
    html = ""
    for idx, item in enumerate(cards, 1):
        html += f"""
        <div class="card">
            <div class="card-header">
                <span class="badge-num">#{idx}</span>
                <span class="badge-status">VALID TODAY</span>
            </div>
            <img class="qr-img" src="{item['qr']}" alt="{item['roll']}">
            <div class="roll">{item['roll']}</div>
            <div class="name">{item['name']}</div>
            <div class="footer-info">V2 HMAC • {today_date}</div>
        </div>
        """
    return html

html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SNIST Attendance — 10 Multi-QR Scanner Test Grid</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=Space+Grotesk:wght@600;700&display=swap" rel="stylesheet">
    <style>
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}
        body {{
            font-family: 'Outfit', sans-serif;
            background: #F4F6F9;
            color: #111827;
            padding: 24px 16px;
            min-height: 100vh;
        }}
        .header {{
            text-align: center;
            margin-bottom: 24px;
            padding: 24px;
            background: linear-gradient(135deg, #001e40 0%, #15347e 100%);
            color: white;
            border-radius: 20px;
            box-shadow: 0 10px 25px rgba(0, 30, 64, 0.15);
            max-width: 1280px;
            margin-left: auto;
            margin-right: auto;
        }}
        .header h1 {{
            font-size: 26px;
            font-weight: 800;
            margin-bottom: 8px;
            letter-spacing: -0.5px;
        }}
        .header p {{
            font-size: 14px;
            color: #93C5FD;
            font-weight: 600;
        }}
        
        .tab-bar {{
            display: flex;
            justify-content: center;
            gap: 12px;
            margin: 20px 0 28px 0;
        }}
        .tab-btn {{
            padding: 12px 24px;
            border-radius: 9999px;
            font-weight: 700;
            font-size: 14px;
            cursor: pointer;
            border: 2px solid transparent;
            transition: all 0.2s ease;
            box-shadow: 0 2px 6px rgba(0,0,0,0.06);
        }}
        .tab-btn.active {{
            background: #001e40;
            color: white;
            border-color: #001e40;
            box-shadow: 0 4px 12px rgba(0, 30, 64, 0.25);
        }}
        .tab-btn:not(.active) {{
            background: white;
            color: #4B5563;
            border-color: #E5E7EB;
        }}
        .tab-btn:not(.active):hover {{
            background: #F3F4F6;
        }}
        
        .grid {{
            display: grid;
            grid-template-columns: repeat(5, 1fr);
            gap: 16px;
            max-width: 1280px;
            margin: 0 auto;
        }}
        @media (max-width: 1200px) {{
            .grid {{ grid-template-columns: repeat(4, 1fr); }}
        }}
        @media (max-width: 900px) {{
            .grid {{ grid-template-columns: repeat(3, 1fr); }}
        }}
        @media (max-width: 650px) {{
            .grid {{ grid-template-columns: repeat(2, 1fr); gap: 12px; }}
        }}
        
        .card {{
            background: white;
            border: 2px solid #E5E7EB;
            border-radius: 16px;
            padding: 14px;
            text-align: center;
            box-shadow: 0 4px 10px rgba(0,0,0,0.04);
            transition: all 0.2s ease;
            display: flex;
            flex-direction: column;
            align-items: center;
        }}
        .card:hover {{
            transform: translateY(-3px);
            border-color: #001e40;
            box-shadow: 0 8px 20px rgba(0, 30, 64, 0.12);
        }}
        
        .card-header {{
            display: flex;
            justify-content: space-between;
            width: 100%;
            margin-bottom: 8px;
            font-size: 11px;
            font-weight: 700;
        }}
        .badge-num {{
            background: #EFF6FF;
            color: #1D4ED8;
            padding: 2px 8px;
            border-radius: 6px;
        }}
        .badge-status {{
            background: #ECFDF5;
            color: #059669;
            padding: 2px 8px;
            border-radius: 6px;
        }}
        
        .qr-img {{
            width: 100%;
            max-width: 170px;
            aspect-ratio: 1/1;
            object-fit: contain;
            border: 1px solid #E5E7EB;
            border-radius: 12px;
            padding: 6px;
            background: white;
            margin-bottom: 10px;
        }}
        
        .roll {{
            font-family: 'Space Grotesk', monospace;
            font-size: 15px;
            font-weight: 700;
            color: #001e40;
            margin-bottom: 2px;
        }}
        .name {{
            font-size: 12px;
            color: #4B5563;
            font-weight: 600;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 180px;
            margin-bottom: 6px;
        }}
        .footer-info {{
            font-size: 10px;
            color: #9CA3AF;
            font-weight: 600;
        }}
        
        .tab-content {{ display: none; }}
        .tab-content.active {{ display: block; }}
    </style>
</head>
<body>
    <div class="header">
        <h1>📱 SNIST Attendance — Multi-QR Scanner Demo Page</h1>
        <p>⚡ Official V2 Dynamic Encrypted Student QR Codes • Server Date: {today_date}</p>
    </div>
    
    <div class="tab-bar">
        <button class="tab-btn active" onclick="showTab('civil')">🏛️ Civil III-I (Sample Sheet - 10 QRs)</button>
        <button class="tab-btn" onclick="showTab('cse')">💻 CSE-A (10 QRs)</button>
    </div>
    
    <div id="tab-civil" class="tab-content active">
        <div class="grid">
            {build_grid_cards(civil_cards)}
        </div>
    </div>
    
    <div id="tab-cse" class="tab-content">
        <div class="grid">
            {build_grid_cards(cse_cards)}
        </div>
    </div>
    
    <script>
        function showTab(tab) {{
            document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            if (tab === 'civil') {{
                document.querySelectorAll('.tab-btn')[0].classList.add('active');
                document.getElementById('tab-civil').classList.add('active');
            }} else {{
                document.querySelectorAll('.tab-btn')[1].classList.add('active');
                document.getElementById('tab-cse').classList.add('active');
            }}
        }}
    </script>
</body>
</html>
"""

public_dir = os.path.join(BASE_DIR, "frontend", "public")
dist_dir = os.path.join(BASE_DIR, "frontend", "dist")

with open(os.path.join(public_dir, "qr10.html"), "w", encoding="utf-8") as f:
    f.write(html_content)

with open(os.path.join(dist_dir, "qr10.html"), "w", encoding="utf-8") as f:
    f.write(html_content)

print("[SUCCESS] 10 QR code test sheet generated with Civil and CSE tabs at frontend/dist/qr10.html")
