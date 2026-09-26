"""
SNIST ERP — Phase 5 Core Security Facades Verification Test Battery
Certifies InstitutionalClock, InstitutionalCryptoFacade, and DeviceSecurityService.
"""

import pytest
from datetime import datetime, timedelta, timezone
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from fastapi import HTTPException

from app.core.database import Base
from app.core.clock import InstitutionalClock, institutional_clock, get_server_ist_datetime, get_server_ist_date
from app.core.crypto_facade import InstitutionalCryptoFacade, crypto_facade
from app.core.device_security_service import DeviceSecurityService, device_security_service
from app.models.models import DeviceRegistration, DeviceAccountBinding, BindingStatus, SecurityEventType


@pytest.fixture
def db_session():
    """In-memory SQLite session for isolated facade testing."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)


class TestInstitutionalClock:
    def test_now_ist_timezone(self):
        ist_now = InstitutionalClock.now_ist()
        assert ist_now is not None
        # IST offset should be +05:30
        tz_offset = ist_now.utcoffset()
        assert tz_offset == timedelta(hours=5, minutes=30)

    def test_today_ist_date_format(self):
        date_str = InstitutionalClock.today_ist_date()
        assert len(date_str) == 10
        assert date_str.count("-") == 2
        parts = date_str.split("-")
        assert len(parts[0]) == 4 and parts[0].isdigit()
        assert len(parts[1]) == 2 and parts[1].isdigit()
        assert len(parts[2]) == 2 and parts[2].isdigit()

    def test_legacy_helpers_delegate_to_clock(self):
        assert get_server_ist_date() == InstitutionalClock.today_ist_date()
        assert abs((get_server_ist_datetime() - InstitutionalClock.now_ist()).total_seconds()) < 1.0

    def test_to_ist_conversion(self):
        utc_time = datetime(2026, 9, 26, 12, 0, 0, tzinfo=timezone.utc)
        ist_time = InstitutionalClock.to_ist(utc_time)
        assert ist_time.hour == 17
        assert ist_time.minute == 30

    def test_format_ist(self):
        formatted = InstitutionalClock.format_ist(fmt="%Y/%m/%d")
        today = InstitutionalClock.today_ist_date().replace("-", "/")
        assert formatted == today


class TestInstitutionalCryptoFacade:
    def test_password_hashing_and_verification(self):
        password = "SecureInstitutionalPassword2026!"
        hashed = InstitutionalCryptoFacade.hash_password(password)
        assert hashed != password
        assert InstitutionalCryptoFacade.verify_password(password, hashed) is True
        assert InstitutionalCryptoFacade.verify_password("WrongPassword", hashed) is False

    def test_access_and_refresh_tokens(self):
        data = {"sub": "21121A0501", "role": "STUDENT"}
        token = InstitutionalCryptoFacade.create_access_token(data)
        assert isinstance(token, str)

        payload = InstitutionalCryptoFacade.decode_access_token(token)
        assert payload is not None
        assert payload.get("sub") == "21121A0501"
        assert payload.get("role") == "STUDENT"

        payload_status, err = InstitutionalCryptoFacade.decode_access_token_with_status(token)
        assert err is None
        assert payload_status.get("sub") == "21121A0501"

        ref_token = InstitutionalCryptoFacade.create_refresh_token(data)
        ref_payload = InstitutionalCryptoFacade.decode_refresh_token(ref_token)
        assert ref_payload is not None
        assert ref_payload.get("token_type") == "refresh"

    def test_magic_login_token(self):
        token = InstitutionalCryptoFacade.create_magic_login_token("faculty_hod@snist.edu.in", role="TEACHER")
        payload = InstitutionalCryptoFacade.verify_magic_login_token(token)
        assert payload is not None
        assert payload.get("sub") == "faculty_hod@snist.edu.in"
        assert payload.get("type") == "magic_login"

    def test_student_qr_payload_v2_generation_and_validation(self):
        student_id = 1042
        roll = "21121A0599"
        payload_v2 = InstitutionalCryptoFacade.generate_student_qr_payload_v2(student_id, roll)
        assert payload_v2.startswith("V2|")

        validated = InstitutionalCryptoFacade.decrypt_and_validate_student_qr(payload_v2)
        assert validated["studentId"] == student_id
        assert validated["version"] == 2

    def test_projector_session_token_generation_and_validation(self):
        session_id = 77
        token_info = InstitutionalCryptoFacade.generate_projector_session_token(session_id, period_count=2)
        assert "payload" in token_info
        assert token_info["payload"].startswith("SNIST-SES|")

        val_result = InstitutionalCryptoFacade.validate_projector_session_token(token_info["payload"])
        assert val_result["session_id"] == session_id
        assert val_result["period_count"] == 2


class TestDeviceSecurityService:
    def test_hash_device_secret(self):
        h1 = DeviceSecurityService.hash_device_secret("secret_alpha")
        h2 = DeviceSecurityService.hash_device_secret("secret_alpha")
        h3 = DeviceSecurityService.hash_device_secret("secret_beta")
        assert h1 == h2
        assert h1 != h3

    def test_is_demo_account(self):
        assert DeviceSecurityService.is_demo_account("DEMO_STUDENT") is True
        assert DeviceSecurityService.is_demo_account("student_demo_1") is True
        assert DeviceSecurityService.is_demo_account("21121A0501") is False

    def test_register_and_verify_device(self, db_session):
        dev = DeviceSecurityService.register_or_get_device(
            db=db_session,
            device_public_id="DEV-SNIST-PIXEL8",
            device_secret="secret_hardware_key_123",
            ip_address="192.168.1.50"
        )
        assert dev.id is not None
        assert dev.device_public_id == "DEV-SNIST-PIXEL8"

        # Re-query existing device
        dev2 = DeviceSecurityService.register_or_get_device(
            db=db_session,
            device_public_id="DEV-SNIST-PIXEL8",
            device_secret="secret_hardware_key_123"
        )
        assert dev2.id == dev.id

    def test_enforce_device_binding_lockout(self, db_session):
        dev = DeviceSecurityService.register_or_get_device(
            db=db_session,
            device_public_id="DEV-LOCKOUT-TEST",
            device_secret="secret_hw_key"
        )

        # 1. First binding to ROLL_A succeeds
        binding1 = DeviceSecurityService.enforce_device_binding(
            db=db_session,
            device=dev,
            roll_number="21121A0501"
        )
        assert binding1.roll_number == "21121A0501"

        # 2. Subsequent access by ROLL_A succeeds
        binding2 = DeviceSecurityService.enforce_device_binding(
            db=db_session,
            device=dev,
            roll_number="21121A0501"
        )
        assert binding2.id == binding1.id

        # 3. Account switch to ROLL_B is blocked with 403
        with pytest.raises(HTTPException) as exc_info:
            DeviceSecurityService.enforce_device_binding(
                db=db_session,
                device=dev,
                roll_number="21121A0502"
            )
        assert exc_info.value.status_code == 403
        assert "temporarily associated with another student account" in exc_info.value.detail
