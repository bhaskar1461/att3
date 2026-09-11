#!/bin/bash
tmux kill-session -t snist_app 2>/dev/null || true
tmux new-session -d -s snist_app -n backend "bash -c 'cd /home/azureuser/snist_attendance/backend && source /home/azureuser/snist_attendance/venv/bin/activate && export PYTHONPATH=/home/azureuser/snist_attendance/backend: && while true; do uvicorn app.main:app --host 0.0.0.0 --port 8001; sleep 1; done; exec bash'"
echo "Backend started in tmux session 'snist_app'"
