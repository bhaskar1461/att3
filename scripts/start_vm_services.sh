#!/bin/bash
tmux kill-session -t snist_app 2>/dev/null || true
tmux new-session -d -s snist_app -n backend "bash -c 'cd ~/projects/attendance_system-/backend && source venv/bin/activate && while true; do uvicorn app.main:app --host 0.0.0.0 --port 8001; sleep 1; done; exec bash'"
tmux new-window -t snist_app -n devserver "bash -c 'cd ~/projects/attendance_system- && while true; do python3 scripts/dev_server.py; sleep 1; done; exec bash'"
tmux new-window -t snist_app -n tunnel "bash -c 'cd ~/projects/attendance_system- && while true; do cloudflared tunnel --url http://127.0.0.1:8001 > ~/cf_tunnel.log 2>&1; sleep 1; done; exec bash'"
echo "[SUCCESS] Services initialized in auto-respawn loop in tmux session 'snist_app'"
