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
                if bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8')):
                    return True
            except Exception:
                pass
        salt = "attendance_salt_2026"
        sha_hash = hashlib.sha256(f"{plain_password}{salt}".encode()).hexdigest()
        if sha_hash == hashed_password:
            return True
        return False
except ImportError:
    def get_password_hash(password: str) -> str:
        salt = "attendance_salt_2026"
        return hashlib.sha256(f"{password}{salt}".encode()).hexdigest()

    def verify_password(plain_password: str, hashed_password: str) -> bool:
        if not plain_password or not hashed_password:
            return False
        salt = "attendance_salt_2026"
        sha_hash = hashlib.sha256(f"{plain_password}{salt}".encode()).hexdigest()
        if sha_hash == hashed_password:
            return True
        return False

# JWT Token implementation
try:
    from jose import jwt, JWTError
    def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
        to_encode = data.copy()
        if expires_delta:
            expire = datetime.utcnow() + expires_delta
        elif data.get("role") == "STUDENT":
            if "DEMO" in str(data.get("sub", "")).upper():
                expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
            else:
                expire = datetime.utcnow() + timedelta(seconds=getattr(settings, "STUDENT_TOKEN_EXPIRE_SECONDS", 900))
        else:
            expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
        to_encode.update({"exp": expire, "token_type": to_encode.get("token_type", "access")})
        return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)

    def create_refresh_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
        to_encode = data.copy()
        if expires_delta:
            expire = datetime.utcnow() + expires_delta
        else:
            expire = datetime.utcnow() + timedelta(hours=getattr(settings, "REFRESH_TOKEN_EXPIRE_HOURS", 12))
        to_encode.update({"exp": expire, "token_type": "refresh"})
        return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)

    def decode_access_token_with_status(token: str) -> tuple[Optional[dict], Optional[str]]:
        if not token:
            return None, "invalid_token"
        try:
            payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
            return payload, None
        except Exception as e:
            err_str = str(e).lower()
            if "expired" in err_str or type(e).__name__ in ["ExpiredSignatureError", "ExpiredSignature"]:
                return None, "token_expired"
            # Defensive fallback: support HMAC signature if token was generated in fallback environment
            try:
                parts = token.split(".")
                if len(parts) != 3:
                    return None, "invalid_token"
                header_b64, payload_b64, signature = parts
                signature_raw = f"{header_b64}.{payload_b64}"
                expected_sig = hmac.new(settings.SECRET_KEY.encode(), signature_raw.encode(), hashlib.sha256).hexdigest()
                if not hmac.compare_digest(signature, expected_sig):
                    return None, "invalid_token"
                padded_payload = payload_b64 + "=" * ((4 - len(payload_b64) % 4) % 4)
                payload = json.loads(base64.b64decode(padded_payload.encode()).decode())
                if payload.get("exp", 0) < time.time():
                    return None, "token_expired"
                return payload, None
            except Exception:
                return None, "invalid_token"

    def decode_access_token(token: str) -> Optional[dict]:
        payload, _ = decode_access_token_with_status(token)
        return payload

    def decode_refresh_token(token: str) -> Optional[dict]:
        try:
            payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
            if payload.get("token_type") != "refresh":
                return None
            return payload
        except Exception:
            try:
                parts = token.split(".")
                if len(parts) != 3:
                    return None
                header_b64, payload_b64, signature = parts
                signature_raw = f"{header_b64}.{payload_b64}"
                expected_sig = hmac.new(settings.SECRET_KEY.encode(), signature_raw.encode(), hashlib.sha256).hexdigest()
                if not hmac.compare_digest(signature, expected_sig):
                    return None
                padded_payload = payload_b64 + "=" * ((4 - len(payload_b64) % 4) % 4)
                payload = json.loads(base64.b64decode(padded_payload.encode()).decode())
                if payload.get("exp", 0) < time.time():
                    return None
                if payload.get("token_type") != "refresh":
                    return None
                return payload
            except Exception:
                return None
except ImportError:
    # Simplified HMAC JWT token fallback
    def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
        header = base64.b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()).decode()
        payload = data.copy()
        if expires_delta:
            payload["exp"] = int(time.time()) + int(expires_delta.total_seconds())
        elif data.get("role") == "STUDENT":
            payload["exp"] = int(time.time()) + getattr(settings, "STUDENT_TOKEN_EXPIRE_SECONDS", 900)
        else:
            payload["exp"] = int(time.time()) + (settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60)
        payload["token_type"] = payload.get("token_type", "access")
        payload_b64 = base64.b64encode(json.dumps(payload).encode()).decode()
        signature_raw = f"{header}.{payload_b64}"
        signature = hmac.new(settings.SECRET_KEY.encode(), signature_raw.encode(), hashlib.sha256).hexdigest()
        return f"{header}.{payload_b64}.{signature}"

    def create_refresh_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
        header = base64.b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()).decode()
        payload = data.copy()
        if expires_delta:
            payload["exp"] = int(time.time()) + int(expires_delta.total_seconds())
        else:
            payload["exp"] = int(time.time()) + (getattr(settings, "REFRESH_TOKEN_EXPIRE_HOURS", 12) * 3600)
        payload["token_type"] = "refresh"
        payload_b64 = base64.b64encode(json.dumps(payload).encode()).decode()
        signature_raw = f"{header}.{payload_b64}"
        signature = hmac.new(settings.SECRET_KEY.encode(), signature_raw.encode(), hashlib.sha256).hexdigest()
        return f"{header}.{payload_b64}.{signature}"

    def decode_access_token_with_status(token: str) -> tuple[Optional[dict], Optional[str]]:
        if not token:
            return None, "invalid_token"
        try:
            parts = token.split(".")
            if len(parts) != 3:
                return None, "invalid_token"
            header_b64, payload_b64, signature = parts
            signature_raw = f"{header_b64}.{payload_b64}"
            expected_sig = hmac.new(settings.SECRET_KEY.encode(), signature_raw.encode(), hashlib.sha256).hexdigest()
            if not hmac.compare_digest(signature, expected_sig):
                return None, "invalid_token"
            padded_payload = payload_b64 + "=" * ((4 - len(payload_b64) % 4) % 4)
            payload = json.loads(base64.b64decode(padded_payload.encode()).decode())
            if payload.get("exp", 0) < time.time():
                return None, "token_expired"
            return payload, None
        except Exception:
            return None, "invalid_token"

    def decode_access_token(token: str) -> Optional[dict]:
        payload, _ = decode_access_token_with_status(token)
        return payload

    def decode_refresh_token(token: str) -> Optional[dict]:
        try:
            parts = token.split(".")
            if len(parts) != 3:
                return None
            header_b64, payload_b64, signature = parts
            signature_raw = f"{header_b64}.{payload_b64}"
            expected_sig = hmac.new(settings.SECRET_KEY.encode(), signature_raw.encode(), hashlib.sha256).hexdigest()
            if not hmac.compare_digest(signature, expected_sig):
                return None
            padded_payload = payload_b64 + "=" * ((4 - len(payload_b64) % 4) % 4)
            payload = json.loads(base64.b64decode(padded_payload.encode()).decode())
            if payload.get("exp", 0) < time.time():
                return None
            if payload.get("token_type") != "refresh":
                return None
            return payload
        except Exception:
            return None


def create_magic_login_token(username: str, role: str = "TEACHER", expires_days: int = 30) -> str:
    """Creates a secure time-bound magic link login token for faculty/students."""
    data = {
        "sub": username,
        "role": role,
        "type": "magic_login",
        "iat": datetime.utcnow().timestamp(),
    }
    return create_access_token(data, expires_delta=timedelta(days=expires_days))


def verify_magic_login_token(token: str) -> Optional[dict]:
    """Decodes and validates a magic link login token with a signature-verified grace period."""
    if not token or not isinstance(token, str):
        return None

    # 1. Standard decode (active unexpired token)
    payload = decode_access_token(token)
    if payload and payload.get("type") == "magic_login":
        return payload

    # 2. Cryptographic grace period: If token was genuinely signed by our SECRET_KEY
    # but has expired within the last 30 days, allow it so students are not locked out.
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM],
            options={"verify_exp": False}
        )
        if payload.get("type") == "magic_login":
            exp = payload.get("exp", 0)
            now = datetime.utcnow().timestamp()
            # Allow up to 30 days grace period past expiration timestamp
            if (now - exp) < (30 * 86400):
                return payload
    except Exception:
        pass

    return None


# --- AES / HMAC Security for Student QR Codes ---

# --- Server-Authoritative IST Time Enforcement ---

def get_server_ist_datetime() -> datetime:
    """Returns server-authoritative current datetime in IST (Asia/Kolkata)."""
    try:
        import zoneinfo
        tz = zoneinfo.ZoneInfo("Asia/Kolkata")
        return datetime.now(tz)
    except Exception:
        utc_now = datetime.utcnow()
        return utc_now + timedelta(hours=5, minutes=30)

def get_server_ist_date() -> str:
    """Returns server-authoritative current date string in IST (YYYY-MM-DD)."""
    return get_server_ist_datetime().strftime("%Y-%m-%d")

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

def generate_encrypted_qr_payload_v2(
    student_id: int, 
    roll_number: str = "", 
    attendance_date: Optional[str] = None,
    expiry_hours: int = 24 * 365
) -> str:
    """
    Generates ultra-compact, high-speed Payload V2 with date-binding.
    Format: V2|<student_id_base36>|<date_yyyymmdd_base36>|<expires_at_base36>|<nonce_hex>|<mac_hex>
    Length ~50 chars for near-instant camera focus and decoding.
    """
    if not attendance_date:
        attendance_date = get_server_ist_date()

    timestamp = int(time.time())
    expires_at = timestamp + (expiry_hours * 3600)
    
    sid_b36 = _int_to_base36(student_id)
    exp_b36 = _int_to_base36(expires_at)
    
    clean_date_str = str(attendance_date).replace("-", "")
    date_int = int(clean_date_str) if clean_date_str.isdigit() else 20260810
    date_b36 = _int_to_base36(date_int)

    nonce_raw = hashlib.sha256(f"snist_v2_{student_id}_{attendance_date}_{timestamp}".encode('utf-8')).hexdigest()[:16]
    base_str = f"V2|{sid_b36}|{date_b36}|{exp_b36}|{nonce_raw}"
    key = get_aes_key()
    mac = hmac.new(key, base_str.encode('utf-8'), hashlib.sha256).hexdigest()[:16]
    
    return f"{base_str}|{mac}"

def generate_encrypted_qr_payload(
    student_id: int, 
    roll_number: str, 
    attendance_date: Optional[str] = None,
    expiry_hours: int = 24 * 365
) -> Dict[str, Any]:
    if not attendance_date:
        attendance_date = get_server_ist_date()

    timestamp = int(time.time())
    expires_at = timestamp + (expiry_hours * 3600)
    
    inner_data = {
        "studentId": student_id,
        "rollNumber": roll_number,
        "date": attendance_date,
        "timestamp": timestamp,
        "expiresAt": expires_at,
        "salt": hashlib.md5(f"{student_id}-{timestamp}".encode(), usedforsecurity=False).hexdigest()
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
        "date": attendance_date,
        "encryptedToken": encrypted_token,
        "checksum": checksum,
        "t": timestamp
    }
    return payload

def decrypt_and_validate_qr_payload(qr_string: str) -> Dict[str, Any]:
    """
    Universal QR Payload Validator.
    Supports V2 date-bound format, legacy V2, V1 pipe format (SNIST|...), and JSON payloads.
    """
    try:
        if isinstance(qr_string, dict):
            payload = qr_string
        else:
            raw = str(qr_string).strip()
            
            # 1. Handle V2 Payload format
            if raw.startswith("V2|"):
                parts = raw.split("|")
                key = get_aes_key()

                if len(parts) == 6:
                    # New Date-bound V2 format: V2|sid_b36|date_b36|exp_b36|nonce|mac
                    _, sid_b36, date_b36, exp_b36, nonce, mac = parts
                    base_str = f"V2|{sid_b36}|{date_b36}|{exp_b36}|{nonce}"
                    expected_mac = hmac.new(key, base_str.encode('utf-8'), hashlib.sha256).hexdigest()[:16]
                    
                    if not hmac.compare_digest(mac, expected_mac):
                        raise ValueError("Tampered V2 QR payload (Checksum failure)")
                        
                    student_id = _base36_to_int(sid_b36)
                    expires_at = _base36_to_int(exp_b36)
                    date_int = _base36_to_int(date_b36)
                    date_str_raw = str(date_int)
                    if len(date_str_raw) == 8:
                        qr_date = f"{date_str_raw[:4]}-{date_str_raw[4:6]}-{date_str_raw[6:8]}"
                    else:
                        qr_date = get_server_ist_date()

                    if expires_at and time.time() > expires_at:
                        raise ValueError("Expired QR Code")

                    return {
                        "studentId": student_id,
                        "rollNumber": "",
                        "qr_date": qr_date,
                        "date": qr_date,
                        "expiresAt": expires_at,
                        "version": 2
                    }

                elif len(parts) == 5:
                    # Legacy 5-part V2 format
                    _, sid_b36, exp_b36, nonce, mac = parts
                    base_str = f"V2|{sid_b36}|{exp_b36}|{nonce}"
                    expected_mac = hmac.new(key, base_str.encode('utf-8'), hashlib.sha256).hexdigest()[:16]
                    
                    if not hmac.compare_digest(mac, expected_mac):
                        raise ValueError("Tampered V2 QR payload (Checksum failure)")
                        
                    student_id = _base36_to_int(sid_b36)
                    expires_at = _base36_to_int(exp_b36)
                    
                    if expires_at and time.time() > expires_at:
                        raise ValueError("Expired QR Code")
                        
                    return {
                        "studentId": student_id,
                        "rollNumber": "",
                        "qr_date": get_server_ist_date(),
                        "date": get_server_ist_date(),
                        "expiresAt": expires_at,
                        "version": 2
                    }
                else:
                    raise ValueError("Invalid V2 payload format")
                
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
            
        qr_date = inner_data.get("date") or payload.get("date") or get_server_ist_date()
        inner_data["qr_date"] = qr_date
        inner_data["date"] = qr_date
        inner_data["version"] = 1
        return inner_data
    except Exception as e:
        raise ValueError(f"QR Validation Failed: {str(e)}")


# --- Projector / Classroom Broadcast Rotating QR Functions ---

def generate_projector_session_token(
    session_id: int, 
    period_count: int = 1, 
    step_window: int = 10
) -> Dict[str, Any]:
    """
    Generates ultra-compact, high-contrast rotating QR token for teacher classroom projection.
    Format: SNIST-SES|<session_id_b36>|<period_count>|<step_b36>|<mac_hex>
    Refreshes every step_window seconds (default 10s).
    """
    period_count = max(1, min(8, int(period_count)))
    now_ts = time.time()
    step = int(now_ts // step_window)
    seconds_remaining = int(step_window - (now_ts % step_window))
    
    sid_b36 = _int_to_base36(session_id)
    step_b36 = _int_to_base36(step)
    
    base_str = f"SES|{sid_b36}|{period_count}|{step_b36}"
    key = get_aes_key()
    mac = hmac.new(key, base_str.encode('utf-8'), hashlib.sha256).hexdigest()[:12]
    
    payload_str = f"SNIST-SES|{sid_b36}|{period_count}|{step_b36}|{mac}"
    
    return {
        "payload": payload_str,
        "session_id": session_id,
        "period_count": period_count,
        "step": step,
        "seconds_remaining": max(1, seconds_remaining),
        "step_window": step_window
    }

class TokenValidationError(ValueError):
    """Exception raised when QR / launch token validation fails."""
    def __init__(self, code: str, message: str, server_now: Optional[float] = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.server_now = server_now if server_now is not None else time.time()


def validate_projector_session_token(
    token_str: str, 
    step_window: int = 10, 
    max_grace_steps: Optional[int] = None,
    grace_seconds: Optional[float] = None,
    now_ts: Optional[float] = None,
    is_offline_submission: bool = False
) -> Dict[str, Any]:
    """
    Validates rotating projector session token.
    For live online submissions, accepts ONLY the current window (v) and previous window (v - 1).
    Supports bounded SUBMIT_GRACE_MINUTES window for queued offline submissions.
    Preserves cryptographic HMAC signature verification and device-binding/single-use invariants.
    """
    if now_ts is None:
        now_ts = time.time()

    raw = str(token_str).strip()
    if not raw.startswith("SNIST-SES|"):
        raise TokenValidationError(code="invalid", message="Invalid projector token prefix: Expected SNIST-SES", server_now=now_ts)
        
    parts = raw.split("|")
    if len(parts) != 5:
        raise TokenValidationError(code="invalid", message="Invalid projector token format: Expected 5 pipe-delimited fields", server_now=now_ts)
        
    _, sid_b36, period_count_str, step_b36, mac = parts
    
    try:
        session_id = _base36_to_int(sid_b36)
        period_count = int(period_count_str)
        token_step = _base36_to_int(step_b36)
    except Exception as parse_err:
        raise TokenValidationError(code="invalid", message=f"Malformed fields in projector token: {parse_err}", server_now=now_ts)

    if period_count < 1 or period_count > 8:
        raise TokenValidationError(code="invalid", message="Invalid period count in projector token (must be between 1 and 8)", server_now=now_ts)

    # Window check:
    if is_offline_submission:
        grace_mins = getattr(settings, "SUBMIT_GRACE_MINUTES", 10)
        effective_grace = float(grace_mins * 60)
        slot_start_ts = token_step * step_window
        slot_end_ts = (token_step + 1) * step_window
        max_valid_ts = slot_end_ts + effective_grace
        min_valid_ts = slot_start_ts - 2.0
        if now_ts > max_valid_ts:
            raise TokenValidationError(
                code="expired",
                message=f"Projector QR token expired beyond offline submit grace window ({getattr(settings, 'SUBMIT_GRACE_MINUTES', 10)}m).",
                server_now=now_ts
            )
        if now_ts < min_valid_ts:
            raise TokenValidationError(
                code="invalid",
                message="Projector QR token timestamp is in the future. Check clock synchronization.",
                server_now=now_ts
            )
    else:
        slot_end_ts = (token_step + 1) * step_window
        slot_start_ts = token_step * step_window
        if grace_seconds is not None:
            if now_ts > slot_end_ts + grace_seconds:
                raise TokenValidationError(
                    code="expired",
                    message="Projector QR token has expired beyond grace period. Please scan the newly refreshed QR on screen.",
                    server_now=now_ts
                )
            if now_ts < slot_start_ts - 2.0:
                raise TokenValidationError(
                    code="invalid",
                    message="Projector QR token timestamp is in the future. Check clock synchronization.",
                    server_now=now_ts
                )
        else:
            allowed_grace_steps = max_grace_steps if max_grace_steps is not None else 1
            current_step = int(now_ts // step_window)
            if token_step < current_step - allowed_grace_steps:
                raise TokenValidationError(
                    code="expired",
                    message="Projector QR token has expired. Please scan the newly refreshed QR on screen.",
                    server_now=now_ts
                )
            if token_step > current_step:
                raise TokenValidationError(
                    code="invalid",
                    message="Projector QR token timestamp is in the future. Check clock synchronization.",
                    server_now=now_ts
                )
        
    # Verify HMAC for token_step
    base_str = f"SES|{sid_b36}|{period_count}|{step_b36}"
    key = get_aes_key()
    expected_mac = hmac.new(key, base_str.encode('utf-8'), hashlib.sha256).hexdigest()[:12]
    
    if not hmac.compare_digest(mac, expected_mac):
        raise TokenValidationError(code="invalid", message="Invalid projector QR signature (Tampered token)", server_now=now_ts)
        
    return {
        "session_id": session_id,
        "period_count": period_count,
        "step": token_step,
        "is_grace_window": (now_ts >= slot_end_ts)
    }


