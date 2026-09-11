# 🛠️ SNIST ERP — Dockerized Dev Environment & Shareable Tunnel Guide

This document explains how to spin up, seed, develop, test, and expose the isolated local development environment for the **SNIST AI Attendance & ERP Platform**.

---

## 1. Quick Reference: Endpoints & URLs

| Service | Target URL | Description | Credentials / Access |
| :--- | :--- | :--- | :--- |
| **Frontend (PWA)** | [http://localhost:5173](http://localhost:5173) | Vite dev server with Hot Module Replacement (HMR) | Admin / Faculty / Student logins |
| **Backend API Docs** | [http://localhost:8001/docs](http://localhost:8001/docs) | FastAPI Swagger UI & Interactive OpenAPI Docs | Role-gated via Bearer JWT |
| **Local MariaDB** | `localhost:3307` | MariaDB 10.6 isolated dev database container | User: `snist_dev`, DB: `snist_attendance_dev` |
| **Shareable Dev Tunnel** | `https://dev-ather-os.de5.net` | Outbound Cloudflare tunnel for mobile phone testing | ⚠️ Protected via Cloudflare Zero Trust |

---

## 2. One-Command Setup with Docker Compose

The dev stack runs in complete isolation from the production deployment.

### Step 2.1: Start the Dev Stack
```bash
# Build and run the MariaDB, FastAPI backend, and Vite frontend in dev mode
docker compose -f docker-compose.dev.yml up -d
```

### Step 2.2: Verify Containers
```bash
docker compose -f docker-compose.dev.yml ps
```
You should see:
- `snist_dev_db` (MariaDB 10.6, port `3307:3306`, healthy)
- `snist_dev_backend` (FastAPI + uvicorn `--reload`, port `8001:8000`)
- `snist_dev_frontend` (Vite dev server with HMR, port `5173:5173`)

### Step 2.3: Seed Realistic Dev Data
Run the dev seeder script inside the backend container (or natively with Python):
```bash
# Via Docker:
docker compose -f docker-compose.dev.yml exec backend python seed_dev.py

# Or natively on host (if virtualenv is active):
python seed_dev.py
```

### Step 2.4: Stop the Stack
```bash
# Stop containers without removing database volume:
docker compose -f docker-compose.dev.yml down

# Stop and wipe dev database volume:
docker compose -f docker-compose.dev.yml down -v
```

---

## 3. Seeded Realistic Test Data & Personas

The seed script (`seed_dev.py`) provisions a complete, realistic mock environment reflecting SNIST's real structure:

- **252 Total Students** distributed across the **7 real SNIST departments**:
  - `CSE`: 48 students
  - `CSM` (AI & Machine Learning): 40 students
  - `ECE`: 44 students
  - `IT`: 36 students
  - `MECH`: 30 students
  - `CIVIL`: 26 students
  - `EEE`: 24 students
  - `Unassigned`: 4 students (reconciliation test cases)
- **62 Courses** (Theory + Labs for each department).
- **14 Faculty Members** (2 per department) with realistic assigned teaching loads.
- **6 Weeks of Daily Attendance Sessions** with realistic persona patterns:
  - *Consistently High (≥85%)*: Model attendees in the JNTUH ELIGIBLE band.
  - *Borderline Condonable (65–74.99%)*: Eligible for condonation with fine status tracking.
  - *Chronic Absentees / Detained (<65%)*: Hard-flagged as DETAINED.
  - *Late-Join Students*: Prorated attendance calculated strictly from their `join_date`.
  - *Approved Absences*: Flagged medical/sports reasons excluded from denominator when policy toggle is ON.
  - *Zero-Session Courses*: Displays as `"—"` instead of `0%`.

### Test Login Credentials
- **Admin**:
  - Username: `admin` | Password: `admin_password_123` (or `9999999999` / `123456`)
- **Faculty**:
  - Username: `FAC_CSE_1` (or `FAC_CSM_1`, etc.) | Password: `password123`
- **Students**:
  - Roll Numbers: `22311A0501` to `22311A0548` (CSE)
  - Roll Numbers: `22311A6601` to `22311A6640` (CSM)
  - Roll Numbers: `22311A0401` to `22311A0444` (ECE)
  - Roll Numbers: `22311A1201` to `22311A1236` (IT)
  - Roll Numbers: `22311A0301` to `22311A0330` (MECH)
  - Roll Numbers: `22311A0101` to `22311A0126` (CIVIL)
  - Roll Numbers: `22311A0201` to `22311A0224` (EEE)
  - Password for all seed students: `password123`

---

## 4. Shareable Dev Tunnel (`dev-ather-os.de5.net`)

For mobile phone testing (PWA installation, camera QR scanning across devices), a Cloudflare Named Tunnel routes `dev-ather-os.de5.net` to the local Vite dev server (`http://localhost:5173`).

### Starting the Dev Tunnel

**On Windows:**
```cmd
# Using scripts/start_dev_tunnel.bat
scripts\start_dev_tunnel.bat

# Or passing a specific Cloudflare tunnel token:
scripts\start_dev_tunnel.bat <YOUR_DEV_TUNNEL_TOKEN>
```

**On Linux / macOS:**
```bash
chmod +x scripts/start_dev_tunnel.sh
./scripts/start_dev_tunnel.sh
```

### ⚠️ Security Safeguards & Zero-Trust Rules
1. **Isolated Backend**: The tunnel points strictly to `http://localhost:5173` (dev frontend), which communicates with `http://localhost:8001` (dev backend). It **NEVER** touches production databases or ports.
2. **Access Protection**: In the Cloudflare Zero Trust dashboard:
   - Navigate to **Zero Trust** -> **Access** -> **Applications**.
   - Create an application for `dev-ather-os.de5.net`.
   - Add an Allow policy requiring email PIN authentication (`@sreenidhi.edu.in` or specific tester emails) or HTTP Basic Auth.
3. **Turn Off When Inactive**: Do not leave the dev tunnel running unattended. Press `Ctrl+C` in the tunnel terminal when testing is finished.

---

## 5. Production Parity Guarantee

- `docker-compose.yml` (production) remains strictly unmodified.
- Production environment variables, Let's Encrypt certificates, and production database (`seg-dev.sreenidhi.edu.in`) are untouched.
- Dev stack uses standard MariaDB 10.6 on port 3307 and FastAPI on port 8001, avoiding port collisions with any local or host services.
