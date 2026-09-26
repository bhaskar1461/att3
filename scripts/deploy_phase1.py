import os
import tarfile
import tempfile
import subprocess
import time

PROJECT_ROOT = r"c:\Users\bhask\Desktop\att2"
KEY_PATH = r"C:\Users\bhask\.ssh\Ather-os_key.pem"
HOST = "20.6.131.206"
USER = "azureuser"

def filter_tar(tarinfo):
    name = tarinfo.name.replace("\\", "/")
    base = os.path.basename(name)
    if base in ["node_modules", ".git", ".venv", "venv", "__pycache__", ".pytest_cache"]:
        return None
    if name.startswith("backend/.env") or name == ".env":
        return None
    if name.endswith(".pyc") or name.endswith(".log"):
        return None
    if name.endswith(".db") or name.endswith(".sqlite") or name.endswith(".sqlite3") or name.endswith("-wal") or name.endswith("-shm"):
        return None
    if "backend/data/selfies" in name or "backend/data/attendance_system.db" in name:
        return None
    return tarinfo

def run_ssh(cmd: str):
    print(f"[SSH] {cmd}", flush=True)
    res = subprocess.run([
        "ssh", "-i", KEY_PATH, "-o", "StrictHostKeyChecking=no",
        f"{USER}@{HOST}", cmd
    ], capture_output=True, text=True)
    if res.stdout:
        print(res.stdout.strip())
    if res.stderr:
        print("[STDERR]", res.stderr.strip())
    return res.returncode

def deploy():
    tar_path = os.path.join(tempfile.gettempdir(), "snist_phase1_deploy.tar.gz")
    print("1. Creating Phase 1 production archive (frontend/dist + backend/app)...", flush=True)
    with tarfile.open(tar_path, "w:gz") as tar:
        tar.add(os.path.join(PROJECT_ROOT, "frontend", "dist"), arcname="frontend/dist", filter=filter_tar)
        tar.add(os.path.join(PROJECT_ROOT, "backend", "app"), arcname="backend/app", filter=filter_tar)

    size_mb = os.path.getsize(tar_path) / (1024 * 1024)
    print(f"Archive created: {tar_path} ({size_mb:.2f} MB)", flush=True)

    print("2. Uploading Phase 1 package to Azure VM via SCP...", flush=True)
    scp_cmd = [
        "scp",
        "-i", KEY_PATH,
        "-o", "StrictHostKeyChecking=no",
        tar_path,
        f"{USER}@{HOST}:/tmp/snist_phase1_deploy.tar.gz"
    ]
    subprocess.run(scp_cmd, check=True)
    print("Upload completed.", flush=True)

    print("3. Extracting update into /home/azureuser/snist_attendance/...", flush=True)
    run_ssh("tar -xzf /tmp/snist_phase1_deploy.tar.gz -C /home/azureuser/snist_attendance/")

    print("4. Restarting snist-attendance service...", flush=True)
    run_ssh("sudo systemctl restart snist-attendance.service")

    print("5. Verifying backend health...", flush=True)
    time.sleep(3)
    run_ssh("curl -s http://127.0.0.1:8001/api/v1/health")

    print("6. Verifying Phase 1 live overview endpoints on Azure VM...", flush=True)
    run_ssh("curl -s https://ather-os.de5.net/api/v1/health")
    print("Phase 1 deployment completed successfully!", flush=True)

if __name__ == "__main__":
    deploy()
