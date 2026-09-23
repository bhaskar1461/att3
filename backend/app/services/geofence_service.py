"""
SNIST ERP Attendance System — Server-Authoritative Geofence Service
Calculates Haversine distance and enforces the 100-meter institutional classroom boundary.
Client device coordinates are verified server-side; client distances are never trusted.
"""

import math
import logging
from typing import Tuple, Optional

logger = logging.getLogger("snist_erp.geofence")

# Mean radius of the Earth in meters (IUGG recommended value)
EARTH_RADIUS_METERS = 6371000.0

# Maximum permitted GPS accuracy radius before rejecting as unreliably imprecise
# Set to 120.0m to accommodate indoor classroom multi-story attenuation and cellular tri-angulation
DEFAULT_MAX_ACCURACY_METERS = 120.0

# Default institutional geofence boundary radius
DEFAULT_GEOFENCE_RADIUS_METERS = 100.0


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculates the great-circle distance between two geographic coordinates on Earth
    using the Haversine formula.

    Returns:
        Distance in meters as a float.

    Raises:
        ValueError: If any coordinate is non-finite or outside valid terrestrial ranges
                   (-90 <= lat <= 90, -180 <= lon <= 180).
    """
    for name, val, min_v, max_v in [
        ("lat1", lat1, -90.0, 90.0),
        ("lon1", lon1, -180.0, 180.0),
        ("lat2", lat2, -90.0, 90.0),
        ("lon2", lon2, -180.0, 180.0),
    ]:
        if not isinstance(val, (int, float)) or math.isnan(val) or math.isinf(val):
            raise ValueError(f"Invalid coordinate {name}: must be a finite number.")
        if not (min_v <= val <= max_v):
            raise ValueError(f"Coordinate {name}={val} out of valid bounds [{min_v}, {max_v}].")

    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(delta_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    )
    # Numerical safeguard against precision clipping above 1.0
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))

    return round(EARTH_RADIUS_METERS * c, 2)


def validate_student_geofence(
    student_lat: Optional[float],
    student_lon: Optional[float],
    student_acc: Optional[float],
    session_lat: Optional[float],
    session_lon: Optional[float],
    session_acc: Optional[float] = None,
    geofence_radius_m: float = DEFAULT_GEOFENCE_RADIUS_METERS,
    max_acceptable_accuracy_m: float = DEFAULT_MAX_ACCURACY_METERS
) -> Tuple[bool, Optional[float], Optional[str]]:
    """
    Evaluates whether a student is physically inside the authorized teaching session geofence.

    Returns:
        (is_valid: bool, calculated_distance_m: Optional[float], rejection_reason: Optional[str])
    """
    # 0. Check master geofence kill-switch / feature flag
    from app.core.config import settings
    if not getattr(settings, "GEOFENCE_ENABLED", False):
        logger.info("[GEOFENCE] Geofence validation is disabled via configuration. Bypassed.")
        dist_calc = None
        if student_lat is not None and student_lon is not None and session_lat is not None and session_lon is not None:
            try:
                dist_calc = haversine_distance(student_lat, student_lon, session_lat, session_lon)
            except Exception:
                pass
        return True, dist_calc, None

    # 1. Check if the session itself has registered faculty coordinates
    if session_lat is None or session_lon is None:
        logger.info("Session has no faculty GPS coordinates (e.g. desktop launch). Geofence bypassed.")
        return True, None, None

    # 2. Check student coordinates presence
    if student_lat is None or student_lon is None:
        return False, None, "GPS location is required to verify classroom attendance."

    # 3. Check student GPS accuracy
    if student_acc is not None:
        try:
            acc_val = float(student_acc)
            if acc_val > max_acceptable_accuracy_m:
                return (
                    False,
                    None,
                    f"GPS accuracy is too low ({acc_val:.1f}m > {max_acceptable_accuracy_m:.0f}m limit). "
                    "Please wait a few seconds or step closer to a window to improve signal."
                )
        except (ValueError, TypeError):
            pass

    # 4. Calculate server-authoritative Haversine distance
    try:
        dist_m = haversine_distance(student_lat, student_lon, session_lat, session_lon)
    except ValueError as ve:
        return False, None, f"Invalid GPS coordinates received: {ve}"

    # 5. Evaluate against session geofence radius
    effective_radius = geofence_radius_m if geofence_radius_m and geofence_radius_m > 0 else DEFAULT_GEOFENCE_RADIUS_METERS
    if dist_m > effective_radius:
        logger.warning(
            f"[GEOFENCE REJECT] Student is {dist_m:.1f}m away from session (Limit: {effective_radius:.0f}m)"
        )
        return (
            False,
            dist_m,
            f"Outside classroom geofence: You are {dist_m:.1f}m away (Maximum allowed: {effective_radius:.0f}m)."
        )

    return True, dist_m, None
