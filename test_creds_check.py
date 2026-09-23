import requests

def test_login(username, password, label):
    url = "https://ather-os.de5.net/api/v1/auth/login"
    payload = {
        "username": username,
        "password": password,
        "device_public_id": "WEB_BROWSER_TEST",
        "device_secret": "test_secret_123"
    }
    try:
        r = requests.post(url, json=payload, timeout=10)
        print(f"[{label}] User: {username} | Status: {r.status_code}")
        if r.status_code == 200:
            data = r.json()
            print(f"   Success! Role: {data.get('role')}, Name: {data.get('user', {}).get('name')}")
            return True
        else:
            print(f"   Response: {r.text}")
            return False
    except Exception as e:
        print(f"   Exception: {e}")
        return False

# Test Teacher
test_login("demoteacher", "demoteacher@2026", "TEACHER")

# Test Demo Student
test_login("demostudent", "demostudent@2026", "DEMO STUDENT")

# Test Real Student
test_login("23311A6636", "Snist#2612", "REAL STUDENT")

