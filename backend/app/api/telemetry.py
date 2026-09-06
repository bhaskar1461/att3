from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel
from typing import Optional, Dict, Any
from datetime import datetime, timedelta
import json
import logging

from app.core.database import get_db
from app.models.models import AuditLog, User, UserRole
from app.api.auth import get_current_user

logger = logging.getLogger("snist_erp.telemetry")

router = APIRouter(prefix="/telemetry", tags=["PWA & Client Telemetry"])

class PwaInstallTelemetryRequest(BaseModel):
    event_type: str # e.g. PWA_PAGE_LOAD, PWA_PROMPT_SHOWN, PWA_INSTALLED, PWA_STANDALONE_LAUNCH, PWA_INSTALL_GUARD_BLOCKED
    platform: str # ios, android, desktop, unknown
    browser: str # safari, chrome, brave, firefox, edge, other
    is_standalone: bool
    details: Optional[Dict[str, Any]] = None

@router.post("/pwa-install")
def record_pwa_install_telemetry(
    req: PwaInstallTelemetryRequest,
    request: Request,
    db: Session = Depends(get_db)
):
    """
    Fire-and-forget ingestion of PWA client telemetry.
    Reuses qr_audit_logs with zero migration risk.
    """
    try:
        ip_addr = request.client.host if request.client else None
        
        # Extract optional student identity from headers if available
        roll_number = request.headers.get("x-roll-number", "").strip().upper() or None
        device_id_hdr = request.headers.get("x-device-public-id", "").strip() or None

        details_payload = {
            "platform": req.platform,
            "browser": req.browser,
            "is_standalone": req.is_standalone,
            "extra": req.details or {},
            "user_agent": request.headers.get("user-agent", "")[:150]
        }

        log_entry = AuditLog(
            user_id=None,
            roll_number=roll_number,
            device_id=None,
            event_type=req.event_type[:50],
            action="PWA_TELEMETRY",
            details=json.dumps(details_payload),
            ip_address=ip_addr,
            created_at=datetime.utcnow()
        )
        db.add(log_entry)
        db.commit()

        return {"status": "RECORDED"}
    except Exception as e:
        logger.warning(f"Failed to record PWA telemetry: {e}")
        return {"status": "IGNORED"}

@router.get("/summary")
def get_telemetry_summary(
    hours: int = 24,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Admin & Faculty endpoint to inspect real-time rollout telemetry.
    Answers: 'How many installed? How many blocked? Which platform failed?'
    """
    if current_user.role not in (UserRole.SUPER_ADMIN, UserRole.TEACHER):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Faculty or Administrative permissions required."
        )

    since = datetime.utcnow() - timedelta(hours=hours)

    logs = db.query(AuditLog).filter(
        AuditLog.action == "PWA_TELEMETRY",
        AuditLog.created_at >= since
    ).all()

    summary = {
        "timeframe_hours": hours,
        "total_events": len(logs),
        "events_by_type": {},
        "platform_breakdown": {"ios": 0, "android": 0, "desktop": 0, "other": 0},
        "browser_breakdown": {"safari": 0, "chrome": 0, "brave": 0, "firefox": 0, "other": 0},
        "standalone_launches": 0,
        "install_guard_blocks": 0,
        "installs_accepted": 0,
    }

    for log in logs:
        etype = log.event_type or "UNKNOWN"
        summary["events_by_type"][etype] = summary["events_by_type"].get(etype, 0) + 1

        if etype == "PWA_STANDALONE_LAUNCH":
            summary["standalone_launches"] += 1
        elif etype == "PWA_INSTALL_GUARD_BLOCKED":
            summary["install_guard_blocks"] += 1
        elif etype == "PWA_INSTALLED":
            summary["installs_accepted"] += 1

        try:
            if log.details:
                meta = json.loads(log.details)
                plat = (meta.get("platform") or "other").lower()
                browser = (meta.get("browser") or "other").lower()

                if plat in summary["platform_breakdown"]:
                    summary["platform_breakdown"][plat] += 1
                else:
                    summary["platform_breakdown"]["other"] += 1

                if browser in summary["browser_breakdown"]:
                    summary["browser_breakdown"][browser] += 1
                else:
                    summary["browser_breakdown"]["other"] += 1
        except Exception:
            pass

    return summary
