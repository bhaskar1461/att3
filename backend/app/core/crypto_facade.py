"""
SNIST ERP — Institutional Crypto Facade
Encapsulates institutional cryptography: password hashing, JWT creation & decoding,
magic link verification, QR token encryption, and rotating classroom projector validation.
"""

from typing import Optional, Dict, Any, Tuple
from datetime import timedelta
import logging

from app.core.clock import InstitutionalClock

logger = logging.getLogger("snist_erp.crypto_facade")


class InstitutionalCryptoFacade:
    """
    Unified high-level facade for all institutional cryptographic operations.
    Reduces direct coupling to underlying crypto primitives and libraries.
    """

    def __init__(self):
        # Lazy imports of underlying primitives to prevent circular import loops
        pass

    # --- Password Hashing & Verification ---
    @classmethod
    def hash_password(cls, password: str) -> str:
        """Hashes plain password using bcrypt (or institutional SHA-256 fallback)."""
        from app.core.security import get_password_hash
        return get_password_hash(password)

    @classmethod
    def verify_password(cls, plain_password: str, hashed_password: str) -> bool:
        """Verifies plain password against hashed password."""
        from app.core.security import verify_password
        return verify_password(plain_password, hashed_password)

    # --- JWT Token Lifecycle ---
    @classmethod
    def create_access_token(cls, data: dict, expires_delta: Optional[timedelta] = None) -> str:
        """Creates a signed JWT access token for user sessions."""
        from app.core.security import create_access_token
        return create_access_token(data, expires_delta=expires_delta)

    @classmethod
    def create_refresh_token(cls, data: dict, expires_delta: Optional[timedelta] = None) -> str:
        """Creates a signed JWT refresh token."""
        from app.core.security import create_refresh_token
        return create_refresh_token(data, expires_delta=expires_delta)

    @classmethod
    def decode_access_token(cls, token: str) -> Optional[dict]:
        """Decodes and validates a JWT access token."""
        from app.core.security import decode_access_token
        return decode_access_token(token)

    @classmethod
    def decode_access_token_with_status(cls, token: str) -> Tuple[Optional[dict], Optional[str]]:
        """Decodes access token and returns (payload, status_error_code)."""
        from app.core.security import decode_access_token_with_status
        return decode_access_token_with_status(token)

    @classmethod
    def decode_refresh_token(cls, token: str) -> Optional[dict]:
        """Decodes and validates a JWT refresh token."""
        from app.core.security import decode_refresh_token
        return decode_refresh_token(token)

    # --- Magic Link Tokens ---
    @classmethod
    def create_magic_login_token(cls, username: str, role: str = "TEACHER", expires_days: int = 30) -> str:
        """Generates a secure, time-bound magic link login token."""
        from app.core.security import create_magic_login_token
        return create_magic_login_token(username=username, role=role, expires_days=expires_days)

    @classmethod
    def verify_magic_login_token(cls, token: str) -> Optional[dict]:
        """Validates a magic link login token with cryptographic grace period."""
        from app.core.security import verify_magic_login_token
        return verify_magic_login_token(token)

    # --- Student QR Codes ---
    @classmethod
    def generate_student_qr_payload_v2(
        cls, 
        student_id: int, 
        roll_number: str = "", 
        attendance_date: Optional[str] = None,
        expiry_hours: int = 24 * 365
    ) -> str:
        """Generates date-bound compact V2 payload (~50 chars)."""
        from app.core.security import generate_encrypted_qr_payload_v2
        return generate_encrypted_qr_payload_v2(
            student_id=student_id,
            roll_number=roll_number,
            attendance_date=attendance_date,
            expiry_hours=expiry_hours
        )

    @classmethod
    def generate_student_qr_payload(
        cls,
        student_id: int,
        roll_number: str,
        attendance_date: Optional[str] = None,
        expiry_hours: int = 24 * 365
    ) -> Dict[str, Any]:
        """Generates AES-GCM encrypted JSON payload dict."""
        from app.core.security import generate_encrypted_qr_payload
        return generate_encrypted_qr_payload(
            student_id=student_id,
            roll_number=roll_number,
            attendance_date=attendance_date,
            expiry_hours=expiry_hours
        )

    @classmethod
    def decrypt_and_validate_student_qr(cls, qr_string: str) -> Dict[str, Any]:
        """Validates and decrypts universal student QR code payload (V2, V1, JSON)."""
        from app.core.security import decrypt_and_validate_qr_payload
        return decrypt_and_validate_qr_payload(qr_string)

    # --- Rotating Classroom Projector Tokens ---
    @classmethod
    def generate_projector_session_token(
        cls, 
        session_id: int, 
        period_count: int = 1, 
        step_window: int = 10
    ) -> Dict[str, Any]:
        """Generates 10-second rotating projector token for classroom scanning."""
        from app.core.security import generate_projector_session_token
        return generate_projector_session_token(
            session_id=session_id,
            period_count=period_count,
            step_window=step_window
        )

    @classmethod
    def validate_projector_session_token(
        cls,
        token_str: str,
        step_window: int = 10,
        max_grace_steps: Optional[int] = None,
        grace_seconds: Optional[float] = None,
        now_ts: Optional[float] = None,
        is_offline_submission: bool = False
    ) -> Dict[str, Any]:
        """Validates rotating projector session token with drift-tolerance."""
        from app.core.security import validate_projector_session_token
        return validate_projector_session_token(
            token_str=token_str,
            step_window=step_window,
            max_grace_steps=max_grace_steps,
            grace_seconds=grace_seconds,
            now_ts=now_ts,
            is_offline_submission=is_offline_submission
        )


# Module-level singleton instance
crypto_facade = InstitutionalCryptoFacade()
