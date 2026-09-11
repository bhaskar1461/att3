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

def update_setting(name, value):
    url = f"{BASE_URL}/settings/{name}"
    payload = {"value": value}
    r = requests.patch(url, json=payload, headers=headers)
    print(f"Setting {name} -> {value}: {r.status_code}")
    res = r.json()
    if res.get("success"):
        print(f"  SUCCESS: {res.get('result')}")
    else:
        print(f"  ERROR: {res.get('errors')}")
    return res

def get_settings():
    url = f"{BASE_URL}/settings"
    r = requests.get(url, headers=headers)
    print(f"Get all settings: {r.status_code}")
    return r.json()

if __name__ == "__main__":
    targets = [
        ("ssl", "strict"),
        ("always_use_https", "on"),
        ("min_tls_version", "1.2"),
        ("tls_1_3", "on"),
        ("opportunistic_encryption", "on"),
        ("websockets", "on"),
        ("http3", "on")
    ]
    for k, v in targets:
        update_setting(k, v)
