#!/usr/bin/env bash
echo "==================================================="
echo "Starting Cloudflare Quick Tunnel for SNIST Attendance PWA"
echo "==================================================="
if ! command -v cloudflared &> /dev/null; then
    echo "Installing cloudflared on Ubuntu..."
    sudo mkdir -p --mode=0755 /etc/apt/keyrings
    curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /etc/apt/keyrings/cloudflare-main.gpg >/dev/null
    echo "deb [signed-by=/etc/apt/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared jammy main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
    sudo apt-get update && sudo apt-get install -y cloudflared
fi
PORT="${1:-8088}"
if [ -n "$TUNNEL_TOKEN" ]; then
    echo "Starting Named Cloudflare Tunnel using TUNNEL_TOKEN..."
    cloudflared tunnel run --token "$TUNNEL_TOKEN"
else
    echo "Starting Normal Quick Cloudflare Tunnel on http://localhost:${PORT}..."
    cloudflared tunnel --url "http://localhost:${PORT}"
fi
