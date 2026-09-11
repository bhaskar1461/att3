#!/usr/bin/env bash
# ==============================================================================
# SNIST Attendance ERP — Start Shareable Dev Tunnel (dev-ather-os.de5.net)
# Points to Local Vite Dev Server (http://localhost:5173)
# ==============================================================================
set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
CF_BIN="cloudflared"

if [ -f "$SCRIPT_DIR/../cloudflared" ]; then
    CF_BIN="$SCRIPT_DIR/../cloudflared"
fi

echo "=============================================================================="
echo " DEV TUNNEL SAFETY NOTICE:"
echo " - Target: dev-ather-os.de5.net -> http://localhost:5173"
echo " - dev-ather-os.de5.net must be PROTECTED via Cloudflare Zero Trust Access"
echo "   or kept down when not in use."
echo " - NEVER point this tunnel at production databases or production servers."
echo "=============================================================================="

if [ -n "$1" ]; then
    echo "[Dev Tunnel] Starting tunnel with provided token..."
    exec $CF_BIN tunnel run --token "$1"
elif [ -n "$CLOUDFLARE_DEV_TUNNEL_TOKEN" ]; then
    echo "[Dev Tunnel] Starting tunnel with CLOUDFLARE_DEV_TUNNEL_TOKEN..."
    exec $CF_BIN tunnel run --token "$CLOUDFLARE_DEV_TUNNEL_TOKEN"
elif [ -f "$SCRIPT_DIR/cloudflared_dev_tunnel.yml" ]; then
    echo "[Dev Tunnel] Starting named tunnel with cloudflared_dev_tunnel.yml..."
    exec $CF_BIN tunnel --config "$SCRIPT_DIR/cloudflared_dev_tunnel.yml" run snist-dev-tunnel
else
    echo "[Dev Tunnel] Running quick tunnel to http://localhost:5173..."
    exec $CF_BIN tunnel --url http://localhost:5173
fi
