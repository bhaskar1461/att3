# 🚀 Operations, Deployment & Runbook Manual

This guide documents the procedures for operating, deploying, backing up, and monitoring the **SNIST AI QR Attendance System** in production.

---

## 1. Production Architecture Overview

- **Host**: Microsoft Azure Virtual Machine (`Standard_B2s`, 2 vCPU, 4GB RAM)
- **OS**: Ubuntu 22.04 LTS
- **Ingress**: Let's Encrypt SSL via Nginx reverse-proxy on port 443
- **Public Domain**: `https://ather-os.de5.net`
- **Internal Services**:
  - `backend`: Uvicorn ASGI on `0.0.0.0:8001` (2 workers)
  - `frontend`: Nginx serving optimized static SPA files on port `80`
  - `remote_db`: External SEG MySQL on `seg-dev.sreenidhi.edu.in:3306`

---

## 2. Standard Deployment Procedures

### Updating Deployed Instance
When rolling out new updates to the Azure production VM:

```bash
# 1. SSH into the Azure Virtual Machine
ssh azureuser@20.6.131.206 -i ~/.ssh/snist_azure_key.pem

# 2. Navigate to project root
cd /home/azureuser/attendnce_system

# 3. Pull latest changes from private GitHub repository
git pull origin main

# 4. Install backend dependencies (if requirements.txt changed)
source backend/.venv/bin/activate
pip install -r backend/requirements.txt

# 5. Build optimized frontend bundle
cd frontend
npm install
npm run build
cd ..

# 6. Restart production services cleanly
bash scripts/start_production.sh
```

---

## 3. Monday Morning Pre-Flight Smoke Test Checklist

Execute this automated 7-second pre-flight verification script every morning at **08:00 AM IST** before classroom sessions begin:

```bash
python scripts/monday_preflight_check.py
```

### Pre-Flight Verification Criteria
1. **Database Health**: Remote MySQL ping latency `<500ms`.
2. **Faculty Authentication**: Valid JWT token issued for teacher accounts.
3. **Assigned Class Resolution**: 51 CS Security students enrolled in Section `CS-A`.
4. **Rotating Projector QR**: 10-second sliding window active and generating HMAC-SHA256 signatures.
5. **Student Schedule**: CET 4-period block displayed on student dashboard.
6. **Edge Ingress**: Nginx SSL active with strict cache-busting headers on `index.html`.

---

## 4. Disaster Recovery & Troubleshooting

### Problem: 502 Bad Gateway on Browser
- **Cause**: Uvicorn is stopped or restarting during deployment.
- **Fix**: Check status via `ps aux | grep uvicorn` or `bash scripts/start_production.sh`.

### Problem: Student Cannot Login (Too Many Attempts / 429)
- **Cause**: Student exceeded the 5-attempt rate limit or is trying to login from another student's phone.
- **Fix**: Check `qr_audit_logs` for `ACCOUNT_SWITCH_ATTEMPT`. If legitimate device replacement, approve rebind in Admin Dashboard (`/admin`).

### Problem: Google Sheets Sync Rate Limits
- **Cause**: Google Sheets API quota exceeded.
- **Mitigation**: The system safely commits attendance to MySQL first and logs a warning without locking the teacher. The teacher or admin can re-trigger sync later via `POST /api/v1/teacher/sessions/{id}/sync-sheet`.

---

## 5. Security Alerting Kill-Switch

If email alerting needs to be temporarily paused for maintenance:
```bash
# In backend/.env or Azure environment:
SECURITY_ALERTS_ENABLED=false
```
Restart backend or reload process. Real-time alerts will immediately pause while internal database audit logging continues uninterrupted.
