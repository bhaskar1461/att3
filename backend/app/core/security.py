import json
import base64
import hashlib
import hmac
import time
from datetime import datetime, timedelta
from typing import Optional, Dict, Any

from app.core.config import settings

# Password hashing & verification
try:
    import bcrypt
    def get_password_hash(password: str) -> str:
        pwd_bytes = password.encode('utf-8')
        salt = bcrypt.gensalt()
        return bcrypt.hashpw(pwd_bytes, salt).decode('utf-8')

    def verify_password(plain_password: str, hashed_password: str) -> bool:
        if not plain_password or not hashed_password:
            return False
        if hashed_password.startswith("$2b$") or hashed_password.startswith("$2a$"):
            try:
                return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))
            except Exception:
                pass
        salt = "attendance_salt_2026"
        sha_hash = hashlib.sha256(f"{plain_password}{salt}".encode()).hexdigest()
        return sha_hash == hashed_password or plain_password == hashed_password
except ImportError:
    def get_password_hash(password: str) -> str:
        salt = "attendance_salt_2026"
        return hashlib.sha256(f"{password}{salt}".encode()).hexdigest()

    def verify_password(plain_password: str, hashed_password: str) -> bool:
        if not plain_password or not hashed_password:
            return False
        salt = "attendance_salt_2026"
        sha_hash = hashlib.sha256(f"{plain_password}{salt}".encode()).hexdigest()
        return sha_hash == hashed_password or plain_password == hashed_password

# JWT Token implementation
try:
    from jose import jwt, JWTError
    def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
        to_encode = data.copy()
        if expires_delta:
            expire = datetime.utcnow() + expires_delta
        else:
            expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
        to_encode.update({"exp": expire})
        return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)

    def decode_access_token(token: str) -> Optional[dict]:
        try:
            return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        except JWTError:
            return None
except ImportError:
    # Simplified HMAC JWT token fallback
    def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
        header = base64.b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()).decode()
        payload = data.copy()
        payload["exp"] = int(time.time()) + (settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60)
        payload_b64 = base64.b64encode(json.dumps(payload).encode()).decode()
        signature_raw = f"{header}.{payload_b64}"
        signature = hmac.new(settings.SECRET_KEY.encode(), signature_raw.encode(), hashlib.sha256).hexdigest()
        return f"{header}.{payload_b64}.{signature}"

    def decode_access_token(token: str) -> Optional[dict]:
        try:
            parts = token.split(".")
            if len(parts) != 3:
                return None
            header_b64, payload_b64, signature = parts
            signature_raw = f"{header_b64}.{payload_b64}"
            expected_sig = hmac.new(settings.SECRET_KEY.encode(), signature_raw.encode(), hashlib.sha256).hexdigest()
            if not hmac.compare_digest(signature, expected_sig):
                return None
            payload = json.loads(base64.b64decode(payload_b64.encode()).decode())
            if payload.get("exp", 0) < time.time():
                return None
            return payload
        except Exception:
            return None

# --- AES / HMAC Security for Student QR Codes ---

def _int_to_base36(n: int) -> str:
    alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    if n == 0:
        return "0"
    res = []
    while n > 0:
        n, rem = divmod(n, 36)
        res.append(alphabet[rem])
    return "".join(reversed(res))

def _base36_to_int(s: str) -> int:
    return int(s.upper(), 36)

def get_aes_key() -> bytes:
    raw = settings.QR_SECRET_KEY.encode('utf-8')
    return hashlib.sha256(raw).digest()

def generate_encrypted_qr_payload_v2(student_id: int, roll_number: str = "", expiry_hours: int = 24 * 365) -> str:
    """
    Generates ultra-compact, high-speed Payload V2.
    Format: V2|<student_id_base36>|<expires_at_base36>|<nonce_hex>|<mac_hex>
    Length ~45 chars for near-instant camera focus and decoding.
    """
    timestamp = int(time.time())
    expires_at = timestamp + (expiry_hours * 3600)
    
    sid_b36 = _int_to_base36(student_id)
    exp_b36 = _int_to_base36(expires_at)
    
    nonce_raw = hashlib.sha256(f"snist_v2_{student_id}_{timestamp}".encode('utf-8')).hexdigest()[:16]
    base_str = f"V2|{sid_b36}|{exp_b36}|{nonce_raw}"
    key = get_aes_key()
    mac = hmac.new(key, base_str.encode('utf-8'), hashlib.sha256).hexdigest()[:16]
    
    return f"{base_str}|{mac}"

def generate_encrypted_qr_payload(student_id: int, roll_number: str, expiry_hours: int = 24 * 365) -> Dict[str, Any]:
    timestamp = int(time.time())
    expires_at = timestamp + (expiry_hours * 3600)
    
    inner_data = {
        "studentId": student_id,
        "rollNumber": roll_number,
        "timestamp": timestamp,
        "expiresAt": expires_at,
        "salt": hashlib.md5(f"{student_id}-{timestamp}".encode()).hexdigest()
    }
    
    json_bytes = json.dumps(inner_data).encode('utf-8')
    key = get_aes_key()
    
    # Check if cryptography module is available
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        nonce = hashlib.sha256(f"{student_id}-{timestamp}".encode()).digest()[:12]
        aesgcm = AESGCM(key)
        ciphertext = aesgcm.encrypt(nonce, json_bytes, None)
        encrypted_token = base64.b64encode(nonce + ciphertext).decode('utf-8')
    except ImportError:
        # XOR Stream Cipher Fallback for pure python
        keystream = hashlib.sha256(key + str(timestamp).encode()).digest()
        encrypted_bytes = bytes([b ^ keystream[i % len(keystream)] for i, b in enumerate(json_bytes)])
        encrypted_token = base64.b64encode(encrypted_bytes).decode('utf-8')
    
    checksum = hmac.new(key, encrypted_token.encode('utf-8'), hashlib.sha256).hexdigest()
    
    payload = {
        "studentId": student_id,
        "rollNumber": roll_number,
        "encryptedToken": encrypted_token,
        "checksum": checksum,
        "t": timestamp
    }
    return payload

def decrypt_and_validate_qr_payload(qr_string: str) -> Dict[str, Any]:
    """
    Universal QR Payload Validator.
    Supports V2 compact format (V2|...), V1 pipe format (SNIST|...), and legacy JSON payloads.
    """
    try:
        raw = str(qr_string).strip()
        
        # 1. Handle V2 Payload format
        if raw.startswith("V2|"):
            parts = raw.split("|")
            if len(parts) != 5:
                raise ValueError("Invalid V2 payload format")
            
            _, sid_b36, exp_b36, nonce, mac = parts
            base_str = f"V2|{sid_b36}|{exp_b36}|{nonce}"
            key = get_aes_key()
            expected_mac = hmac.new(key, base_str.encode('utf-8'), hashlib.sha256).hexdigest()[:16]
            
            if not hmac.compare_digest(mac, expected_mac):
                raise ValueError("Tampered V2 QR payload (Checksum failure)")
                
            student_id = _base36_to_int(sid_b36)
            expires_at = _base36_to_int(exp_b36)
            
            if expires_at and time.time() > expires_at:
                raise ValueError("Expired QR Code")
                
            return {
                "studentId": student_id,
                "rollNumber": "", # Resolved downstream by DB query
                "expiresAt": expires_at,
                "version": 2
            }
            
        # 2. Handle V1 Pipe Delimited payload format
        if raw.startswith("SNIST|"):
            parts = raw.split("|")
            if len(parts) == 6:
                payload = {
                    "studentId": int(parts[1]),
                    "rollNumber": parts[2],
                    "encryptedToken": parts[3],
                    "checksum": parts[4],
                    "t": int(parts[5])
                }
            else:
                raise ValueError("Invalid SNIST V1 compact payload structure")
        elif raw.startswith("{"):
            payload = json.loads(raw)
        else:
            payload = json.loads(raw)
            
        student_id = payload.get("studentId")
        roll_number = payload.get("rollNumber")
        encrypted_token = payload.get("encryptedToken")
        checksum = payload.get("checksum")
        timestamp = payload.get("t", 0)
        
        if not all([student_id, roll_number, encrypted_token, checksum]):
            raise ValueError("Invalid QR payload structure")
            
        key = get_aes_key()
        
        # Verify HMAC checksum
        expected_checksum = hmac.new(key, encrypted_token.encode('utf-8'), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(checksum, expected_checksum):
            raise ValueError("Tampered QR payload (Checksum failure)")
            
        # Decrypt payload
        raw_bytes = base64.b64decode(encrypted_token)
        try:
            from cryptography.hazmat.primitives.ciphers.aead import AESGCM
            nonce = raw_bytes[:12]
            ciphertext = raw_bytes[12:]
            aesgcm = AESGCM(key)
            decrypted_json = aesgcm.decrypt(nonce, ciphertext, None)
        except Exception:
            keystream = hashlib.sha256(key + str(timestamp).encode()).digest()
            decrypted_json = bytes([b ^ keystream[i % len(keystream)] for i, b in enumerate(raw_bytes)])

        inner_data = json.loads(decrypted_json.decode('utf-8'))
        
        if inner_data.get("rollNumber") != roll_number or inner_data.get("studentId") != student_id:
            raise ValueError("QR Content mismatch")
            
        expires_at = inner_data.get("expiresAt", 0)
        if expires_at and time.time() > expires_at:
            raise ValueError("Expired QR Code")
            
        inner_data["version"] = 1
        return inner_data
    except Exception as e:
        raise ValueError(f"QR Validation Failed: {str(e)}")
