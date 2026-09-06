#!/usr/bin/env bash
set -e

APP_DIR="/home/azureuser/snist_attendance"
cd "$APP_DIR"

echo "=== Stopping any existing SNIST services ==="
tmux kill-session -t snist_app 2>/dev/null || true
pkill -f "uvicorn app.main:app.*8001" 2>/dev/null || true
pkill -f "dev_server.py" 2>/dev/null || true
pkill -f "cloudflared tunnel.*8088" 2>/dev/null || true
sleep 1

echo "=== Running Idempotent Database Migrations ==="
source "$APP_DIR/venv/bin/activate" 2>/dev/null || source "$APP_DIR/backend/venv/bin/activate" 2>/dev/null || true
export PYTHONPATH="$APP_DIR/backend:$PYTHONPATH"
python3 "$APP_DIR/scripts/migrate_db.py" || echo "[WARNING] Schema migration returned non-zero exit code (continuing gracefully)"

echo "=== Starting SNIST Backend on port 8001 ==="
tmux new-session -d -s snist_app -n backend "bash -c 'cd $APP_DIR/backend && source $APP_DIR/venv/bin/activate && export PYTHONPATH=$APP_DIR/backend:$PYTHONPATH && while true; do uvicorn app.main:app --host 0.0.0.0 --port 8001; sleep 1; done; exec bash'"

echo "=== Starting Frontend Static & API Proxy on port 8088 ==="
tmux new-window -t snist_app -n frontend "bash -c 'cd $APP_DIR && export BACKEND_URL=http://127.0.0.1:8001 && while true; do python3 scripts/dev_server.py; sleep 1; done; exec bash'"

echo "=== Starting Cloudflare HTTPS Public Tunnel ==="
rm -f "$APP_DIR/tunnel.log"
tmux new-window -t snist_app -n tunnel "bash -c 'cloudflared tunnel --url http://127.0.0.1:8088 > $APP_DIR/tunnel.log 2>&1; exec bash'"

echo "=== Waiting for Cloudflare Public HTTPS Tunnel URL ==="
TUNNEL_URL=""
for i in $(seq 1 45); do
    sleep 1
    if [ -f "$APP_DIR/tunnel.log" ]; then
        TUNNEL_URL=$(grep -o 'https://[-a-zA-Z0-9.]*\.trycloudflare\.com' "$APP_DIR/tunnel.log" | head -n 1)
        if [ -n "$TUNNEL_URL" ]; then
            break
        fi
    fi
done

echo ""
echo "========================================================="
echo " [SUCCESS] SNIST ERP ATTENDANCE SYSTEM DEPLOYED!"
echo " Public HTTPS URL: $TUNNEL_URL"
echo " Direct VM Port:   http://20.6.131.206:8088"
echo " Backend Docs:     $TUNNEL_URL/docs"
echo "========================================================="
