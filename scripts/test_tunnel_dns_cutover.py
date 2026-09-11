import os
import requests
import time

TOKEN = os.getenv("CLOUDFLARE_API_TOKEN", "")
ZONE_ID = "98dbf34ef89c3f91aa6a32ab4c5ba836"
RECORD_ID = "d04d5d6fc9d7b79617d9c83a6aeafb5e"
TUNNEL_CNAME = "cccf79db-e874-445f-ba7d-90a953018414.cfargotunnel.com"
ORIGIN_IP = "20.6.131.206"

headers = {
    "Authorization": f"Bearer {TOKEN}",
    "Content-Type": "application/json"
}

def set_dns(record_type, content):
    url = f"https://api.cloudflare.com/client/v4/zones/{ZONE_ID}/dns_records/{RECORD_ID}"
    payload = {
        "type": record_type,
        "name": "ather-os.de5.net",
        "content": content,
        "proxied": True,
        "ttl": 1
    }
    r = requests.put(url, json=payload, headers=headers)
    print(f"Set DNS to {record_type} {content} -> status {r.status_code}")
    print(f"Response: {r.text}")
    return r.json()

def test_connectivity():
    try:
        r = requests.get("https://ather-os.de5.net/", timeout=10)
        print(f"GET https://ather-os.de5.net/ -> Status: {r.status_code}")
        print(f"Headers: cf-ray={r.headers.get('cf-ray')}, server={r.headers.get('server')}")
        return r.status_code == 200
    except Exception as e:
        print(f"GET failed: {e}")
        return False

if __name__ == "__main__":
    print("Testing cutover to Cloudflare Tunnel CNAME...")
    res = set_dns("CNAME", TUNNEL_CNAME)
    if not res.get("success"):
        print("Failed to set CNAME. Aborting.")
        exit(1)
    
    print("Waiting 5 seconds for edge propagation...")
    time.sleep(5)
    
    ok = False
    for attempt in range(5):
        print(f"Attempt {attempt+1}:")
        if test_connectivity():
            ok = True
            break
        time.sleep(3)
        
    if ok:
        print("SUCCESS! Traffic is flowing through Cloudflare Tunnel!")
    else:
        print("WARNING: Traffic test failed! Reverting back to direct-origin A record...")
        revert = set_dns("A", ORIGIN_IP)
        print("Reverted to A record.")
