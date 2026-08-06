import os
import sys
import socket
import datetime
import subprocess
from pathlib import Path

def get_local_ip():
    """Detect local LAN/Wi-Fi IP address."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.255.255.255', 1))
        local_ip = s.getsockname()[0]
    except Exception:
        local_ip = '127.0.0.1'
    finally:
        s.close()
    return local_ip

def generate_cert_with_cryptography(certs_dir, local_ip):
    """Generate self-signed certificate using Python's cryptography library."""
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.hazmat.primitives import serialization
    import ipaddress

    key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
    )

    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "SNIST QR Attendance System"),
        x509.NameAttribute(NameOID.COMMON_NAME, local_ip),
    ])

    alt_names = [
        x509.DNSName("localhost"),
        x509.DNSName("snist-attendance.isroot.in"),
        x509.DNSName("*.isroot.in"),
        x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
    ]

    if local_ip != "127.0.0.1":
        try:
            alt_names.append(x509.IPAddress(ipaddress.ip_address(local_ip)))
        except ValueError:
            alt_names.append(x509.DNSName(local_ip))

    cert = x509.CertificateBuilder().subject_name(
        subject
    ).issuer_name(
        issuer
    ).public_key(
        key.public_key()
    ).serial_number(
        x509.random_serial_number()
    ).not_valid_before(
        datetime.datetime.now(datetime.timezone.utc)
    ).not_valid_after(
        datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=365)
    ).add_extension(
        x509.SubjectAlternativeName(alt_names),
        critical=False,
    ).sign(key, hashes.SHA256())

    key_path = certs_dir / "key.pem"
    cert_path = certs_dir / "cert.pem"

    with open(key_path, "wb") as f:
        f.write(key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption()
        ))

    with open(cert_path, "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))

    print(f"[SUCCESS] Generated SSL certificates in: {certs_dir}")
    print(f" - Key:  {key_path}")
    print(f" - Cert: {cert_path}")

def generate_cert_with_openssl(certs_dir, local_ip):
    """Generate self-signed certificate using OpenSSL CLI fallback."""
    key_path = certs_dir / "key.pem"
    cert_path = certs_dir / "cert.pem"
    config_path = certs_dir / "openssl.cnf"

    cnf_content = f"""[req]
distinguished_name = req_distinguished_name
x509_extensions = v3_req
prompt = no

[req_distinguished_name]
C = IN
ST = TS
L = Hyderabad
O = SNIST
CN = {local_ip}

[v3_req]
keyUsage = keyEncipherment, dataEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
DNS.2 = snist-attendance.isroot.in
IP.1 = 127.0.0.1
IP.2 = {local_ip}
"""
    with open(config_path, "w") as f:
        f.write(cnf_content)

    cmd = [
        "openssl", "req", "-x509", "-nodes", "-days", "365",
        "-newkey", "rsa:2048",
        "-keyout", str(key_path),
        "-out", str(cert_path),
        "-config", str(config_path)
    ]

    subprocess.run(cmd, check=True)
    if config_path.exists():
        config_path.unlink()

    print(f"[SUCCESS] Generated SSL certificates with OpenSSL in: {certs_dir}")

def main():
    script_dir = Path(__file__).parent.resolve()
    certs_dir = (script_dir.parent / "certs").resolve()
    certs_dir.mkdir(exist_ok=True)

    local_ip = get_local_ip()
    print("==================================================================")
    print("      SNIST QR Attendance System - SSL Certificate Generator      ")
    print("==================================================================")
    print(f"[*] Detected Local PC Network IP: {local_ip}")

    try:
        generate_cert_with_cryptography(certs_dir, local_ip)
    except ImportError:
        try:
            generate_cert_with_openssl(certs_dir, local_ip)
        except Exception as e:
            print(f"[ERROR] Could not generate cert with OpenSSL: {e}")
            sys.exit(1)

    print("\n------------------------------------------------------------------")
    print("                 MOBILE TESTING INSTRUCTIONS                      ")
    print("------------------------------------------------------------------")
    print(f"1. Make sure your phone is connected to the SAME WI-FI network.")
    print(f"2. Run Docker container:")
    print(f"     docker-compose up --build")
    print(f"3. Open Browser on your Phone and navigate to:")
    print(f"     https://{local_ip}:3000   OR   https://{local_ip}")
    print(f"4. Security Notice on Phone Browser:")
    print(f"     - Android Chrome: Tap 'Advanced' -> 'Proceed to {local_ip} (unsafe)'")
    print(f"     - iOS Safari:     Tap 'Show Details' -> 'visit this website' -> 'Visit Website'")
    print(f"5. Camera access prompt will appear and work seamlessly for QR/Face scan!")
    print("==================================================================")

if __name__ == "__main__":
    main()
