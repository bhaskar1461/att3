import os
import requests
import json

TOKEN = os.getenv("CLOUDFLARE_API_TOKEN", "")
ZONE_ID = "98dbf34ef89c3f91aa6a32ab4c5ba836"
BASE_URL = f"https://api.cloudflare.com/client/v4/zones/{ZONE_ID}"
headers = {
    "Authorization": f"Bearer {TOKEN}",
    "Content-Type": "application/json"
}

def check_bot_settings():
    endpoints = [
        f"{BASE_URL}/bot_management",
        f"{BASE_URL}/settings/bot_fight_mode",
        f"{BASE_URL}/settings/security_level",
    ]
    for url in endpoints:
        r = requests.get(url, headers=headers)
        print(f"GET {url}: {r.status_code}")
        print(f"  Response: {r.text[:300]}")

def check_rulesets():
    url = f"{BASE_URL}/rulesets"
    r = requests.get(url, headers=headers)
    print(f"GET {url}: {r.status_code}")
    print(f"  Response: {r.text[:500]}")

def check_rate_limits():
    url = f"{BASE_URL}/rate_limits"
    r = requests.get(url, headers=headers)
    print(f"GET {url}: {r.status_code}")
    print(f"  Response: {r.text[:500]}")

if __name__ == "__main__":
    print("--- BOTS & SECURITY ---")
    check_bot_settings()
    print("\n--- RULESETS ---")
    check_rulesets()
    print("\n--- RATE LIMITS ---")
    check_rate_limits()
