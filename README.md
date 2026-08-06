# 📱 SNIST AI QR Attendance System (PWA & Real-Time Sync)

An AI-Powered, High-Speed QR Code Attendance System built for **Sreenidhi Institute of Science and Technology (SNIST)**. Designed as a Progressive Web Application (PWA), it enables faculty to instantly capture student attendance via camera scanners, auto-sync data to **MySQL Database** and **Google Sheets**, and manage classes seamlessly with full offline support.

---

## 🌟 Key Features

* **⚡ Ultra-Fast 60FPS Multi-QR Camera Scanner**: Built with native browser `BarcodeDetector` and `Html5Qrcode` fallback for instant batch QR decoding under low light and high density.
* **🎓 Flexible Period Selection (1-8 Periods)**: Teachers can select attendance for 1 to 8 periods dynamically per class session.
* **📊 Real-Time Google Sheets & Master Excel Auto-Sync**: Attendance records automatically stream to live Google Sheets (`Student Roster - AI QR Attendance System`) and official Excel registers.
* **🗄️ MySQL Database Backend**: Integrated with remote MySQL database server (`seg-dev.sreenidhi.edu.in`) with automated fallback for SQLite.
* **📲 Progressive Web App (PWA)**: Installable on iOS & Android devices with full offline queueing and service worker caching.
* **🔍 Manual Search & Verification**: Search by roll number or student name for fast manual marking whenever required.
* **🔐 Secure Encrypted QR Engine**: Dynamic QR tokens generated with time-window validation to prevent attendance fraud/tampering.

---

## 🏗️ Tech Stack

### **Frontend**
* **Framework**: React 18 + TypeScript + Vite
* **Styling**: Tailwind CSS (Custom Dark/Glassmorphic Palette)
* **PWA & Offline**: `vite-plugin-pwa`, Service Workers, Workbox
* **Icons & UI**: Lucide React, HTML5-QRCode

### **Backend**
* **Framework**: FastAPI (Python 3.11+)
* **ORM & Database**: SQLAlchemy, PyMySQL, MySQL / SQLite
* **Authentication**: OAuth2 JWT Bearer Tokens, Passlib (Bcrypt)
* **Integrations**: `gspread` (Google Sheets API v4), `openpyxl` (Excel Register)

---

## 📁 Repository Structure

```
attendance_system/
├── backend/
│   ├── app/
│   │   ├── api/             # FastAPI Endpoint Routers (auth, attendance, teacher, student)
│   │   ├── core/            # Database Engine, Config & Security Settings
│   │   ├── models/          # SQLAlchemy Database Models (qr_users, qr_students, etc.)
│   │   └── services/        # Google Sheets, Excel & QR Decoder Services
│   ├── data/                # Master Excel templates & local DB storage
│   └── credentials.json     # Google Sheets API Service Account Key
├── frontend/
│   ├── src/
│   │   ├── components/      # QRScannerModal, ManualSearchModal, Navbar, etc.
│   │   ├── pages/           # TeacherDashboard, StudentDashboard, AdminDashboard
│   │   ├── services/        # API Client, Offline Sync Queue & QR Decoders
│   │   └── index.css        # Tailwind CSS Design Tokens
│   ├── public/              # Icons, manifest & static PWA assets
│   └── vite.config.ts       # Vite PWA Config & Dev Proxy
└── scripts/
    ├── dev_server.py        # Dev server (serves PWA dist + proxies /api to FastAPI)
    ├── seed_data.py         # MySQL database table creator & data seeder
    └── set_gsheet_id.py     # Google Sheet ID sync configuration tool
```

---

## 🚀 Quick Start Guide

### 1. Backend Setup
```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Database & Data Seeding
```bash
# Seed tables and demo users into MySQL
$env:PYTHONPATH="backend"
python scripts/seed_data.py
```

### 3. Frontend Build & Dev Server
```bash
cd frontend
npm install
npm run build

# Start Dev Server (Serves PWA dist on port 8088 & proxies /api to FastAPI backend port 8000)
cd ..
python scripts/dev_server.py
```

---

## 🔐 Credentials & Roles

| Role | Username | Password | Access Level |
|---|---|---|---|
| **Super Admin** | `admin` | `admin123` | Full System Management & Settings |
| **Teacher** | `teacher1` | `teacher123` | Class Session Start, QR Scanner & Manual Search |
| **Student** | `21311A0501` to `21311A0510` | *(Roll Number)* | View QR Code & Attendance Summary |

---

## 🌐 Cloudflare Public Tunnel

To run the application publicly through Cloudflare Tunnel:
```bash
.\cloudflared.exe tunnel --url http://127.0.0.1:8088
```

---

## 📄 License

Developed for **Sreenidhi Institute of Science and Technology (SNIST)**. All rights reserved.
