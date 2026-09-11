#!/usr/bin/env bash
# ==============================================================================
# SNIST Attendance ERP — Cloudflare Named Tunnel Setup & Supervisor Installer
# Supervised with systemd (Restart=always, RestartSec=3s) for zero-downtime pilot
# ==============================================================================
set -e

echo "=== [1/4] Checking cloudflared binary installation ==="
if ! command -v cloudflared &> /dev/null; then
    echo "cloudflared not found. Installing official Cloudflare package..."
    sudo mkdir -p --mode=0755 /etc/apt/keyrings
    curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /etc/apt/keyrings/cloudflare-main.gpg >/dev/null
    echo "deb [signed-by=/etc/apt/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared jammy main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
    sudo apt-get update && sudo apt-get install -y cloudflared
fi
CF_BIN=$(which cloudflared)
echo "Verified cloudflared binary at: $CF_BIN"

echo "=== [2/4] Configuring systemd service unit ==="
sudo mkdir -p /etc/cloudflared

# If TUNNEL_TOKEN argument or env var provided
TOKEN="${1:-$CLOUDFLARE_TUNNEL_TOKEN}"
if [ -z "$TOKEN" ]; then
    echo ""
    echo "Usage: sudo bash setup_cloudflare_tunnel.sh <TUNNEL_TOKEN>"
    echo "Or set export CLOUDFLARE_TUNNEL_TOKEN='...'"
    echo "You can obtain this token from Cloudflare Dashboard -> Zero Trust -> Networks -> Tunnels."
    echo ""
    exit 1
fi

cat << EOF | sudo tee /etc/systemd/system/cloudflared.service > /dev/null
[Unit]
Description=Cloudflare Named Tunnel for SNIST Attendance ERP
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=notify
User=root
Group=root
ExecStart=$CF_BIN tunnel run --token $TOKEN
Restart=always
RestartSec=3s
TimeoutStartSec=30s
LimitNOFILE=65536
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

echo "=== [3/4] Reloading systemd and enabling cloudflared.service ==="
sudo systemctl daemon-reload
sudo systemctl enable cloudflared.service
sudo systemctl restart cloudflared.service

echo "=== [4/4] Verifying tunnel status ==="
sleep 2
sudo systemctl status cloudflared.service --no-pager

echo ""
echo "=============================================================================="
echo " [SUCCESS] Cloudflare Named Tunnel is now running under systemd supervision!"
echo " It will auto-restart in 3 seconds upon any failure (Restart=always)."
echo "=============================================================================="
