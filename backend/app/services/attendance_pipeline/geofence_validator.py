import time
from typing import Dict, Any, Optional
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.models import SecurityEventType
from app.core.device_security import log_security_audit_event
from app.services.geofence_service import validate_student_geofence


def validate_geofence_for_scan(
    db: Session,
    req: Any,
    session_meta: Dict[str, Any],
    clean_roll: str,
    ip_addr: Optional[str]
) -> float:
    """
    Validates student GPS coordinates against faculty / session geofence.
    Raises HTTP 403 on geofence failure with security audit event.
    Returns:
        dist_calc (float): Calculated distance in meters.
    """
    fac_lat = session_meta.get("faculty_latitude")
    fac_lon = session_meta.get("faculty_longitude")
    radius_m = session_meta.get("geofence_radius_m") or 100.0

    is_valid_geo, dist_calc, geo_msg = validate_student_geofence(
        student_lat=req.latitude,
        student_lon=req.longitude,
        student_acc=req.accuracy_m,
        session_lat=fac_lat,
        session_lon=fac_lon,
        session_acc=session_meta.get("faculty_accuracy_m"),
        geofence_radius_m=radius_m
    )
    if not is_valid_geo:
        try:
            log_security_audit_event(
                db=db,
                event_type=SecurityEventType.ATTENDANCE_REJECTED,
                action="GEOFENCE_VALIDATION_FAILED",
                details=f"Student {clean_roll} failed geofence: {geo_msg}",
                roll_number=clean_roll,
                ip_address=ip_addr
            )
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "geofence_failed", "message": f"Geofence validation failed: {geo_msg}", "serverNow": time.time()}
        )

    return dist_calc
