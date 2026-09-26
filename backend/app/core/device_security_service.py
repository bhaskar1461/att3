"""
SNIST ERP — Device Security Service Facade
Encapsulates hardware registration, device audit logging, 30-minute device-to-student lock,
and account switching prevention.
Governance: Rule 6 (Device Binding & Account Switching Lockout).
"""

from typing import Optional
from sqlalchemy.orm import Session
import logging

from app.models.models import (
    DeviceRegistration,
    DeviceAccountBinding,
    BindingStatus,
    SecurityEventType,
)

logger = logging.getLogger("snist_erp.device_security_service")


class DeviceSecurityService:
    """
    Domain service for device identity verification, binding governance,
    and security audit event tracking.
    """

    @classmethod
    def hash_device_secret(cls, secret: str) -> str:
        """Computes SHA-256 hash of device secret."""
        from app.core.device_security import hash_device_secret
        return hash_device_secret(secret)

    @classmethod
    def is_demo_account(cls, identifier: Optional[str]) -> bool:
        """Checks if identifier corresponds to an unrestricted demo account."""
        from app.core.device_security import is_demo_account
        return is_demo_account(identifier)

    @classmethod
    def register_or_get_device(
        cls,
        db: Session,
        device_public_id: str,
        device_secret: str,
        ip_address: Optional[str] = None
    ) -> DeviceRegistration:
        """Registers a new device or retrieves and verifies existing credentials."""
        from app.core.device_security import register_or_get_device
        return register_or_get_device(
            db=db,
            device_public_id=device_public_id,
            device_secret=device_secret,
            ip_address=ip_address
        )

    @classmethod
    def enforce_device_binding(
        cls,
        db: Session,
        device: DeviceRegistration,
        roll_number: str,
        ip_address: Optional[str] = None,
        is_refresh: bool = False
    ) -> DeviceAccountBinding:
        """
        Enforces server-authoritative 30-minute device-to-Roll-Number binding.
        Rejects account switching with HTTP 403.
        """
        from app.core.device_security import enforce_device_binding
        return enforce_device_binding(
            db=db,
            device=device,
            roll_number=roll_number,
            ip_address=ip_address,
            is_refresh=is_refresh
        )

    @classmethod
    def record_audit_log(
        cls,
        db: Session,
        user_id: Optional[int],
        action: str,
        details: Optional[str] = None,
        roll_number: Optional[str] = None,
        event_type: str = "SECURITY_EVENT",
        device_id: Optional[int] = None,
        ip_address: Optional[str] = None
    ):
        """Records security-sensitive audit entry with defensive rollback safety."""
        from app.core.device_security import record_audit_log
        return record_audit_log(
            db=db,
            user_id=user_id,
            action=action,
            details=details,
            roll_number=roll_number,
            event_type=event_type,
            device_id=device_id,
            ip_address=ip_address
        )

    @classmethod
    def log_security_audit_event(
        cls,
        db: Session,
        event_type: SecurityEventType,
        action: str,
        details: str,
        user_id: Optional[int] = None,
        roll_number: Optional[str] = None,
        device_id: Optional[int] = None,
        ip_address: Optional[str] = None
    ):
        """Helper to log security-sensitive events to audit log."""
        from app.core.device_security import log_security_audit_event
        return log_security_audit_event(
            db=db,
            event_type=event_type,
            action=action,
            details=details,
            user_id=user_id,
            roll_number=roll_number,
            device_id=device_id,
            ip_address=ip_address
        )

    @classmethod
    def get_device_active_binding(
        cls,
        db: Session,
        device_id: int
    ) -> Optional[DeviceAccountBinding]:
        """Fetches active binding for a device if still unexpired."""
        from app.core.clock import InstitutionalClock
        now = InstitutionalClock.now_utc()
        return db.query(DeviceAccountBinding).filter(
            DeviceAccountBinding.device_id == device_id,
            DeviceAccountBinding.status == BindingStatus.ACTIVE,
            DeviceAccountBinding.expires_at > now
        ).first()

    @classmethod
    def get_student_active_binding(
        cls,
        db: Session,
        roll_number: str
    ) -> Optional[DeviceAccountBinding]:
        """Fetches active binding for a student roll number if still unexpired."""
        from app.core.clock import InstitutionalClock
        now = InstitutionalClock.now_utc()
        clean_roll = roll_number.strip().upper()
        return db.query(DeviceAccountBinding).filter(
            DeviceAccountBinding.roll_number == clean_roll,
            DeviceAccountBinding.status == BindingStatus.ACTIVE,
            DeviceAccountBinding.expires_at > now
        ).first()


# Module-level singleton instance
device_security_service = DeviceSecurityService()
