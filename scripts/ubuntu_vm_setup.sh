#!/usr/bin/env bash
set -e

echo "=== SNIST ERP Ubuntu Native Setup & Verification ==="

# 1. Start Database & Redis Services
echo ">>> Starting MariaDB and Redis..."
echo ubuntu | sudo -S systemctl enable --now mariadb redis-server

# 2. Configure Database & Users
echo ">>> Configuring MariaDB Database snist_erp_dev..."
echo ubuntu | sudo -S mariadb -e "CREATE DATABASE IF NOT EXISTS snist_erp_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
echo ubuntu | sudo -S mariadb -e "GRANT ALL PRIVILEGES ON snist_erp_dev.* TO 'snist_user'@'localhost' IDENTIFIED BY 'snist_pass123';"
echo ubuntu | sudo -S mariadb -e "GRANT ALL PRIVILEGES ON snist_erp_dev.* TO 'snist_user'@'127.0.0.1' IDENTIFIED BY 'snist_pass123';"
echo ubuntu | sudo -S mariadb -e "FLUSH PRIVILEGES;"

# 3. Create Backend .env
echo ">>> Creating Backend .env..."
mkdir -p ~/projects/attendance_system-/backend
cat << 'EOF' > ~/projects/attendance_system-/backend/.env
DATABASE_URL=mysql+pymysql://snist_user:snist_pass123@localhost:3306/snist_erp_dev
SECRET_KEY=dev_secret_key_snist_erp_ubuntu_native
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=480
EOF

# 4. Create & Activate Python Virtual Environment
echo ">>> Setting up Python Virtual Environment..."
cd ~/projects/attendance_system-/backend
if [ ! -d "venv" ]; then
    python3 -m venv venv
fi
source venv/bin/activate
pip install --upgrade pip setuptools wheel
pip install -r requirements.txt

# 5. Initialize MariaDB Schema & Seed Data
echo ">>> Initializing MariaDB Schema..."
PYTHONPATH=/home/ubuntu/projects/attendance_system-:/home/ubuntu/projects/attendance_system-/backend:$PYTHONPATH python3 -c "from app.core.database import Base, engine; Base.metadata.create_all(bind=engine)"

echo ">>> Seeding Master Data..."
if [ -f "scripts/seed_data.py" ]; then
    PYTHONPATH=/home/ubuntu/projects/attendance_system-:/home/ubuntu/projects/attendance_system-/backend:$PYTHONPATH python3 scripts/seed_data.py
fi

# 6. Run Backend Pytest Automated Verification Suite
echo ">>> Running Backend Automated Tests (pytest)..."
PYTHONPATH=/home/ubuntu/projects/attendance_system-:/home/ubuntu/projects/attendance_system-/backend:$PYTHONPATH pytest -v

# 7. Install Frontend Dependencies & Run Build
echo ">>> Building Frontend..."
cd ~/projects/attendance_system-/frontend
if [ ! -d "node_modules" ] || [ ! -f "node_modules/.bin/vite" ]; then
    echo ">>> Installing frontend dependencies cleanly..."
    npm install --no-audit --no-fund --legacy-peer-deps
fi
npm run build

echo "=== ALL NATIVE UBUNTU VM VERIFICATIONS PASSED CLEANLY ==="
