import subprocess
import time

KEY_PATH = r"C:\Users\bhask\.ssh\Ather-os_key.pem"
HOST = "20.6.131.206"
USER = "azureuser"

def run_ssh(cmd: str):
    print(f"Running: {cmd}")
    res = subprocess.run([
        "ssh", "-i", KEY_PATH, "-o", "StrictHostKeyChecking=no",
        f"{USER}@{HOST}", cmd
    ], capture_output=True, text=True)
    print(res.stdout)
    if res.stderr:
        print("STDERR:", res.stderr)
    return res.returncode

print("--- Step 1: Extracting archive ---")
run_ssh("tar -xzf /tmp/snist_att2_live_deploy.tar.gz -C /home/azureuser/snist_attendance/")

print("--- Step 2: Restarting snist-attendance service ---")
run_ssh("sudo systemctl restart snist-attendance.service")

print("--- Step 3: Verifying backend health ---")
time.sleep(3)
for _ in range(15):
    code = run_ssh("curl -s http://127.0.0.1:8001/api/v1/health")
    if code == 0:
        break
    time.sleep(1)

print("--- Step 4: Checking public HTTPS endpoint ---")
run_ssh("curl -s https://ather-os.de5.net/api/v1/health")
