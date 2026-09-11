#!/usr/bin/env bash
# ==============================================================================
# SNIST Attendance ERP — Certbot DNS-01 Migration Script
# Migrates certificate renewal from standalone (port 80) to DNS-01 via Cloudflare
# Required AFTER Azure NSG locks inbound port 80/443
# ==============================================================================
set -euo pipefail

DOMAIN="ather-os.de5.net"
CF_CREDS="/etc/letsencrypt/cloudflare.ini"
RENEWAL_CONF="/etc/letsencrypt/renewal/${DOMAIN}.conf"

echo "=== [1/5] Verifying certbot-dns-cloudflare plugin installation ==="
if ! dpkg -l python3-certbot-dns-cloudflare &>/dev/null; then
    echo "ERROR: python3-certbot-dns-cloudflare not installed!"
    echo "Run: sudo apt-get install -y python3-certbot-dns-cloudflare"
    exit 1
fi
echo "  [OK] Plugin installed."

echo ""
echo "=== [2/5] Cloudflare API Token Setup ==="
if [ ! -f "$CF_CREDS" ]; then
    echo ""
    echo "  You need to create a Cloudflare API token with Zone:DNS:Edit permissions."
    echo "  Steps:"
    echo "    1. Go to https://dash.cloudflare.com/profile/api-tokens"
    echo "    2. Click 'Create Token'"
    echo "    3. Use 'Edit zone DNS' template"
    echo "    4. Scope to zone: de5.net"
    echo "    5. Copy the token"
    echo ""
    read -p "  Paste your Cloudflare API token: " CF_TOKEN

    if [ -z "$CF_TOKEN" ]; then
        echo "ERROR: No token provided. Aborting."
        exit 1
    fi

    cat <<EOF | sudo tee "$CF_CREDS" > /dev/null
# Cloudflare API token for certbot DNS-01 challenge
# Token scope: Zone:DNS:Edit for de5.net
dns_cloudflare_api_token = ${CF_TOKEN}
EOF
    sudo chmod 600 "$CF_CREDS"
    sudo chown root:root "$CF_CREDS"
    echo "  [OK] Credentials saved to $CF_CREDS (mode 600, root-only)."
else
    echo "  [OK] Credentials file already exists at $CF_CREDS"
fi

echo ""
echo "=== [3/5] Updating certbot renewal configuration ==="
if [ ! -f "$RENEWAL_CONF" ]; then
    echo "ERROR: Renewal config not found at $RENEWAL_CONF"
    exit 1
fi

# Backup original
sudo cp "$RENEWAL_CONF" "${RENEWAL_CONF}.bak.$(date +%Y%m%d_%H%M%S)"
echo "  [OK] Backed up original renewal config."

# Update authenticator from standalone to dns-cloudflare
if grep -q "authenticator = standalone" "$RENEWAL_CONF"; then
    sudo sed -i "s/authenticator = standalone/authenticator = dns-cloudflare/" "$RENEWAL_CONF"
    echo "  [OK] Changed authenticator: standalone → dns-cloudflare"
else
    echo "  [SKIP] Authenticator already not 'standalone' (current: $(grep authenticator "$RENEWAL_CONF"))"
fi

# Add dns-cloudflare credentials if not present
if ! grep -q "dns_cloudflare_credentials" "$RENEWAL_CONF"; then
    sudo sed -i "/\[renewalparams\]/a dns_cloudflare_credentials = ${CF_CREDS}" "$RENEWAL_CONF"
    echo "  [OK] Added dns_cloudflare_credentials to renewal config."
else
    echo "  [SKIP] dns_cloudflare_credentials already present."
fi

echo ""
echo "=== [4/5] Testing renewal with dry-run ==="
echo "  Running: certbot renew --cert-name $DOMAIN --dry-run"
if sudo certbot renew --cert-name "$DOMAIN" --dry-run 2>&1; then
    echo ""
    echo "  [PASS] Dry-run succeeded! DNS-01 renewal is working."
else
    echo ""
    echo "  [FAIL] Dry-run failed. Check credentials and DNS propagation."
    echo "  The cert expires on $(sudo certbot certificates 2>/dev/null | grep 'Expiry' | awk '{print $3, $4}')"
    exit 1
fi

echo ""
echo "=== [5/5] Verifying auto-renewal timer ==="
sudo systemctl list-timers certbot.timer --no-pager 2>/dev/null || \
sudo systemctl list-timers snap.certbot.renew.timer --no-pager 2>/dev/null || \
echo "  [WARN] No certbot timer found. Set up a cron: 0 3 * * * certbot renew --quiet"

echo ""
echo "=============================================================================="
echo " [SUCCESS] Certificate renewal migrated to DNS-01 via Cloudflare API."
echo " The cert for $DOMAIN will auto-renew without needing port 80."
echo "=============================================================================="
