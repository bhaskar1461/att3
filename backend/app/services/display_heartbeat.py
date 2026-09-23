"""
SNIST ERP — Faculty Display Heartbeat Service (Phase 7: Display Reliability)

Tracks real-time projector display heartbeats sent by active classroom displays.
Allows administrators and instructors to immediately detect dead or frozen displays.
"""

import time
import threading
import logging
from typing import Dict, Any, Optional, List

logger = logging.getLogger("snist_erp.display_heartbeat")

_HEARTBEATS: Dict[int, Dict[str, Any]] = {}
_HEARTBEAT_LOCK = threading.Lock()

# In-memory tracking of QR-OLD events: session_id -> list of float timestamps
_QR_OLD_EVENTS: Dict[int, List[float]] = {}
_STALE_DISPLAYS: Dict[int, Dict[str, Any]] = {}

# A display is considered ALIVE if a beacon was received within 30 seconds
HEARTBEAT_ALIVE_THRESHOLD_SECONDS = 30.0

# Alert threshold: >= 3 QR-OLD events in 60s flags DISPLAY STALE
QR_OLD_ALERT_THRESHOLD_COUNT = 3
QR_OLD_ALERT_WINDOW_SECONDS = 60.0


def record_qr_old_event(session_id: int) -> Dict[str, Any]:
    """
    Stage 5: Alert rule — >= 3 QR-OLD events in 60s for one session flags session DISPLAY STALE.
    """
    now = time.time()
    with _HEARTBEAT_LOCK:
        events = _QR_OLD_EVENTS.setdefault(session_id, [])
        events.append(now)
        # Prune events older than 60s
        cutoff = now - QR_OLD_ALERT_WINDOW_SECONDS
        events = [t for t in events if t >= cutoff]
        _QR_OLD_EVENTS[session_id] = events

        is_stale = len(events) >= QR_OLD_ALERT_THRESHOLD_COUNT
        if is_stale:
            _STALE_DISPLAYS[session_id] = {
                "flagged_at": now,
                "event_count": len(events),
                "notice": "Your QR screen is outdated — click to re-sync"
            }
            logger.warning(
                f"[Alert] Session {session_id} flagged DISPLAY STALE: "
                f"{len(events)} QR-OLD events in last {QR_OLD_ALERT_WINDOW_SECONDS}s"
            )
        return {
            "session_id": session_id,
            "qr_old_count_60s": len(events),
            "is_stale": is_stale,
            "status": "DISPLAY STALE" if is_stale else "OK"
        }


def is_display_stale(session_id: int) -> bool:
    """Checks if a session has an active DISPLAY STALE flag."""
    now = time.time()
    with _HEARTBEAT_LOCK:
        info = _STALE_DISPLAYS.get(session_id)
        if not info:
            return False
        if now - info["flagged_at"] > QR_OLD_ALERT_WINDOW_SECONDS:
            _STALE_DISPLAYS.pop(session_id, None)
            return False
        return True


def clear_qr_old_events(session_id: int) -> None:
    """Self-healing: Clears stale display alerts once faculty re-syncs or refreshes."""
    with _HEARTBEAT_LOCK:
        _QR_OLD_EVENTS.pop(session_id, None)
        _STALE_DISPLAYS.pop(session_id, None)


def get_qr_old_events_count(session_id: int) -> int:
    """Returns number of QR-OLD events in the sliding 60s window for a session."""
    now = time.time()
    with _HEARTBEAT_LOCK:
        events = _QR_OLD_EVENTS.get(session_id, [])
        cutoff = now - QR_OLD_ALERT_WINDOW_SECONDS
        return len([t for t in events if t >= cutoff])



def record_display_heartbeat(
    session_id: int,
    epoch: int,
    client_ts: Optional[float] = None,
    ip_address: Optional[str] = None
) -> Dict[str, Any]:
    """
    Records a heartbeat beacon from a projector or faculty display.
    Called every rotation cycle (~10-45s) from ProjectorBroadcastModal.
    """
    now = time.time()
    with _HEARTBEAT_LOCK:
        _HEARTBEATS[session_id] = {
            "session_id": session_id,
            "epoch": epoch,
            "last_heartbeat_at": now,
            "client_ts": client_ts or now,
            "ip_address": ip_address,
            "received_count": _HEARTBEATS.get(session_id, {}).get("received_count", 0) + 1
        }

    logger.debug(f"[Heartbeat] Session {session_id} epoch={epoch} recorded from {ip_address}")
    return {
        "status": "RECORDED",
        "session_id": session_id,
        "epoch": epoch,
        "server_time": now
    }


def get_display_heartbeat_status(session_id: Optional[int] = None) -> Any:
    """
    Queries heartbeat status for a specific session or all active sessions.
    Returns ALIVE if last beacon <= 30s, DEAD otherwise.
    Flags DISPLAY STALE if >= 3 QR-OLD events in 60s.
    """
    now = time.time()
    with _HEARTBEAT_LOCK:
        if session_id is not None:
            hb = _HEARTBEATS.get(session_id)
            stale_info = _STALE_DISPLAYS.get(session_id)
            is_stale = bool(stale_info and (now - stale_info["flagged_at"] <= QR_OLD_ALERT_WINDOW_SECONDS))

            if not hb:
                return {
                    "session_id": session_id,
                    "status": "DISPLAY STALE" if is_stale else "UNKNOWN",
                    "display_status": "DISPLAY STALE" if is_stale else "UNKNOWN",
                    "is_display_stale": is_stale,
                    "stale_notice": stale_info.get("notice") if is_stale else None,
                    "message": "No display heartbeats received for this session."
                }
            seconds_ago = round(now - hb["last_heartbeat_at"], 1)
            is_alive = seconds_ago <= HEARTBEAT_ALIVE_THRESHOLD_SECONDS
            status_label = "DISPLAY STALE" if is_stale else ("ALIVE" if is_alive else "DEAD")
            return {
                "session_id": session_id,
                "epoch": hb["epoch"],
                "status": status_label,
                "display_status": status_label,
                "is_alive": is_alive,
                "is_display_stale": is_stale,
                "stale_notice": stale_info.get("notice") if is_stale else None,
                "seconds_ago": seconds_ago,
                "last_heartbeat_at": hb["last_heartbeat_at"],
                "ip_address": hb.get("ip_address"),
                "total_beacons": hb.get("received_count", 1)
            }

        # Return all tracked sessions
        result = []
        for s_id, hb in _HEARTBEATS.items():
            stale_info = _STALE_DISPLAYS.get(s_id)
            is_stale = bool(stale_info and (now - stale_info["flagged_at"] <= QR_OLD_ALERT_WINDOW_SECONDS))
            seconds_ago = round(now - hb["last_heartbeat_at"], 1)
            is_alive = seconds_ago <= HEARTBEAT_ALIVE_THRESHOLD_SECONDS
            status_label = "DISPLAY STALE" if is_stale else ("ALIVE" if is_alive else "DEAD")
            result.append({
                "session_id": s_id,
                "epoch": hb["epoch"],
                "status": status_label,
                "display_status": status_label,
                "is_alive": is_alive,
                "is_display_stale": is_stale,
                "stale_notice": stale_info.get("notice") if is_stale else None,
                "seconds_ago": seconds_ago,
                "last_heartbeat_at": hb["last_heartbeat_at"],
                "ip_address": hb.get("ip_address"),
                "total_beacons": hb.get("received_count", 1)
            })
        return result


def clear_display_heartbeat(session_id: int) -> None:
    """Cleans up display heartbeat and stale alert entry when a session is closed/locked."""
    with _HEARTBEAT_LOCK:
        _HEARTBEATS.pop(session_id, None)
        _QR_OLD_EVENTS.pop(session_id, None)
        _STALE_DISPLAYS.pop(session_id, None)

