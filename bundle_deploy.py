import os
import tarfile
import tempfile
import subprocess

workspace = r"c:\Users\bhask\Desktop\att2"
KEY_PATH = r"C:\Users\bhask\.ssh\Ather-os_key.pem"
HOST = "20.6.131.206"
USER = "azureuser"

def filter_tar(tarinfo):
    name = tarinfo.name.replace("\\", "/")
    base = os.path.basename(name)
    if base in ["node_modules", ".git", ".venv", "venv", "__pycache__", ".pytest_cache"]:
        return None
    if name.startswith("backend/.env") or name == ".env":
        return None # Do not overwrite server .env
    if name.endswith(".pyc") or name.endswith(".log"):
        return None
    if name.endswith(".db") or name.endswith(".sqlite") or name.endswith(".sqlite3") or name.endswith("-wal") or name.endswith("-shm"):
        return None
    if "backend/data/selfies" in name:
        return None
    return tarinfo

tar_path = os.path.join(tempfile.gettempdir(), "snist_att2_live_deploy.tar.gz")
print("1. Creating production archive from att2...", flush=True)
with tarfile.open(tar_path, "w:gz") as tar:
    tar.add(os.path.join(workspace, "backend"), arcname="backend", filter=filter_tar)
    tar.add(os.path.join(workspace, "frontend", "dist"), arcname="frontend/dist", filter=filter_tar)

size_mb = os.path.getsize(tar_path) / (1024 * 1024)
print(f"Archive created: {tar_path} ({size_mb:.2f} MB)", flush=True)

print("2. Uploading deployment package to Azure VM via SCP...", flush=True)
scp_cmd = [
    "scp",
    "-i", KEY_PATH,
    "-o", "StrictHostKeyChecking=no",
    tar_path,
    f"{USER}@{HOST}:/tmp/snist_att2_live_deploy.tar.gz"
]
subprocess.run(scp_cmd, check=True)
print("Upload completed.", flush=True)
