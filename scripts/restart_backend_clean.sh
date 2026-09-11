#!/usr/bin/env bash
set -e

pkill -f "uvicorn app.main:app.*8001" 2>/dev/null || true
tmux kill-session -t snist_app 2>/dev/null || true
sleep 1

tmux new-session -d -s snist_app -n backend "bash -c 'cd /home/azureuser/snist_attendance/backend && source /home/azureuser/snist_attendance/venv/bin/activate && export PYTHONPATH=/home/azureuser/snist_attendance/backend && while true; do uvicorn app.main:app --host 0.0.0.0 --port 8001; sleep 1; done; exec bash'"

sleep 2
echo "=== Uvicorn Process Status ==="
ps aux | grep "uvicorn.*8001" | grep -v grep || echo "Uvicorn not found in ps"

echo "=== Health Probe ==="
curl -s -o /dev/null -w "HTTP Status: %{http_code}\n" http://127.0.0.1:8001/api/v1/auth/me || echo "Probe failed"
