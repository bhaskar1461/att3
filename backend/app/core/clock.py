"""
SNIST ERP — Institutional Clock Service
Server-authoritative time provider enforcing Asia/Kolkata (IST) and UTC consistency.
Governance: Rule 5 (Server-Authoritative Time Enforcement - Never trust client device clocks).
"""

from datetime import datetime, timedelta, timezone
from typing import Optional
import time

try:
    import zoneinfo
    IST_TZ = zoneinfo.ZoneInfo("Asia/Kolkata")
except Exception:
    IST_TZ = timezone(timedelta(hours=5, minutes=30), name="Asia/Kolkata")


class InstitutionalClock:
    """
    Central server-authoritative institutional clock.
    Provides deterministic IST and UTC datetimes for attendance records,
    token rotations, and session lifecycle events.
    """

    @classmethod
    def now_ist(cls) -> datetime:
        """Returns the current server-authoritative datetime in IST (Asia/Kolkata)."""
        try:
            return datetime.now(IST_TZ)
        except Exception:
            utc_now = datetime.utcnow()
            return utc_now + timedelta(hours=5, minutes=30)

    @classmethod
    def today_ist_date(cls) -> str:
        """Returns current date string in IST (YYYY-MM-DD)."""
        return cls.now_ist().strftime("%Y-%m-%d")

    @classmethod
    def now_utc(cls) -> datetime:
        """Returns the current UTC datetime."""
        return datetime.utcnow()

    @classmethod
    def timestamp(cls) -> float:
        """Returns current epoch timestamp in seconds."""
        return time.time()

    @classmethod
    def to_ist(cls, dt: datetime) -> datetime:
        """
        Converts any naive or timezone-aware datetime to IST.
        Assumes naive datetimes are UTC.
        """
        if dt is None:
            return cls.now_ist()
        if dt.tzinfo is None:
            # Assume UTC if naive
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(IST_TZ)

    @classmethod
    def format_ist(cls, dt: Optional[datetime] = None, fmt: str = "%Y-%m-%d %H:%M:%S") -> str:
        """Formats datetime in IST according to specified format."""
        target = cls.to_ist(dt) if dt else cls.now_ist()
        return target.strftime(fmt)


# Module-level singleton instance
institutional_clock = InstitutionalClock()

# Legacy functional aliases for 100% backward compatibility
def get_server_ist_datetime() -> datetime:
    """Returns server-authoritative current datetime in IST (Asia/Kolkata)."""
    return InstitutionalClock.now_ist()

def get_server_ist_date() -> str:
    """Returns server-authoritative current date string in IST (YYYY-MM-DD)."""
    return InstitutionalClock.today_ist_date()
