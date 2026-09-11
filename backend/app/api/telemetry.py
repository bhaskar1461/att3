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


# ==============================================================================
# WEEK 1: SCAN FUNNEL TELEMETRY & FAILURE FORENSICS
# ==============================================================================

import re
import csv
import io
from fastapi.responses import JSONResponse, Response

VALID_EVENT_TYPES = {
    "scan_page_opened",
    "camera_permission_requested",
    "camera_permission_result",
    "camera_opened",
    "first_frame_captured",
    "frame_decoded",
    "token_submitted",
    "server_response",
    "attendance_confirmed",
    "scan_failed",
    "scan_retried",
    "manual_search_used",
    "manual_mark_created",
    "decode_duration_histogram"
}

VALID_STAGES = {
    "scan_page_opened",
    "camera_permission_requested",
    "camera_permission_result",
    "camera_opened",
    "first_frame_captured",
    "frame_decoded",
    "token_submitted",
    "server_response",
    "attendance_confirmed"
}

VALID_ERROR_TYPES = {
    "permission_denied",
    "camera_unavailable",
    "camera_open_timeout",
    "decode_timeout",
    "token_expired",
    "device_binding_403",
    "rate_limited",
    "server_5xx",
    "network_error",
    "wasm_or_jsqr_crash"
}

VALID_DEVICE_BUCKETS = {"old", "mid", "new"}
VALID_DISPLAY_TYPES = {"projector", "phone_screen", "laptop"}
VALID_TOKEN_FORMATS = {"legacy", "short"}

ROLL_REGEX = re.compile(r"^[0-9]{2}[A-Za-z0-9]{8,10}$")
FORBIDDEN_KEY_PATTERN = re.compile(r"(?i)(roll|name|student|email|phone|mobile|gps|lat|lng|coord|fingerprint|uuid)")

def assert_no_pii(obj: Any, path: str = "") -> None:
    """
    Defensive schema guard: rejects any event payload containing roll patterns,
    names, or student personal identifiers. Telemetry measures pipeline, not people.
    """
    if isinstance(obj, dict):
        for k, v in obj.items():
            if FORBIDDEN_KEY_PATTERN.search(str(k)):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Telemetry rejected: PII detected in key '{k}' at '{path}'. Telemetry must not contain student identity or location metrics."
                )
            assert_no_pii(v, f"{path}.{k}" if path else str(k))
    elif isinstance(obj, list):
        for idx, item in enumerate(obj):
            assert_no_pii(item, f"{path}[{idx}]")
    elif isinstance(obj, str):
        if ROLL_REGEX.match(obj.strip()):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Telemetry rejected: PII pattern detected in value at '{path}'. Telemetry must not contain student roll numbers."
            )

class ScanTelemetryEventIn(BaseModel):
    event_type: str
    stage: Optional[str] = None
    error_type: Optional[str] = None
    device_bucket: str
    duration_ms: Optional[float] = None
    decode_duration_ms: Optional[float] = None
    display_type: Optional[str] = "projector"
    token_format: Optional[str] = None  # 'legacy' | 'short'
    session_id: Optional[str] = None
    app_version: Optional[str] = None
    ts: Optional[int] = None
    details: Optional[Dict[str, Any]] = None

class ScanTelemetryBatchIn(BaseModel):
    events: list[ScanTelemetryEventIn]
    sent_at: Optional[int] = None

# In-memory user rate limiter (60 batches/min per user)
_TELEMETRY_RATE_LIMITS: Dict[int, list[float]] = {}

def _check_telemetry_rate_limit(user_id: int) -> None:
    now = datetime.utcnow().timestamp()
    timestamps = _TELEMETRY_RATE_LIMITS.get(user_id, [])
    # Keep only last 60 seconds
    valid = [ts for ts in timestamps if now - ts < 60.0]
    if len(valid) >= 60:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Telemetry rate limit exceeded: Maximum 60 batches per minute."
        )
    valid.append(now)
    _TELEMETRY_RATE_LIMITS[user_id] = valid

@router.post("/scan-events", status_code=status.HTTP_202_ACCEPTED)
def ingest_scan_telemetry_batch(
    payload: ScanTelemetryBatchIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Ingests batched QR scan funnel events on the background budget.
    Strictly validates enums, enforces No-PII guard, and returns HTTP 202 Accepted.
    """
    _check_telemetry_rate_limit(current_user.id)

    if not payload.events:
        return JSONResponse(status_code=status.HTTP_202_ACCEPTED, content={"status": "ACCEPTED", "ingested": 0})

    if len(payload.events) > 50:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Batch exceeds maximum limit of 50 events per request."
        )

    from app.models.models import ScanTelemetryEvent

    records_to_insert = []

    for idx, ev in enumerate(payload.events):
        # 1. Event type validation
        if ev.event_type not in VALID_EVENT_TYPES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Invalid event_type '{ev.event_type}' at index {idx}."
            )

        # 2. Stage validation if provided
        if ev.stage and ev.stage not in VALID_STAGES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Invalid stage '{ev.stage}' at index {idx}."
            )

        # 3. Error type validation if provided
        if ev.error_type and ev.error_type not in VALID_ERROR_TYPES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Invalid error_type '{ev.error_type}' at index {idx}."
            )

        # 4. Device bucket validation
        if ev.device_bucket not in VALID_DEVICE_BUCKETS:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Invalid device_bucket '{ev.device_bucket}' at index {idx}. Must be 'old', 'mid', or 'new'."
            )

        # 5. Token format validation if provided
        if ev.token_format and ev.token_format not in VALID_TOKEN_FORMATS:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Invalid token_format '{ev.token_format}' at index {idx}. Must be 'legacy' or 'short'."
            )

        # 6. Strict No-PII Guard
        if ev.details:
            assert_no_pii(ev.details, path=f"events[{idx}].details")

        records_to_insert.append(
            ScanTelemetryEvent(
                session_id=ev.session_id[:100] if ev.session_id else None,
                event_type=ev.event_type,
                stage=ev.stage,
                error_type=ev.error_type,
                device_bucket=ev.device_bucket,
                duration_ms=ev.duration_ms,
                decode_duration_ms=ev.decode_duration_ms,
                display_type=ev.display_type if ev.display_type in VALID_DISPLAY_TYPES else "projector",
                token_format=ev.token_format if ev.token_format in VALID_TOKEN_FORMATS else None,
                app_version=ev.app_version[:30] if ev.app_version else None,
                payload_json=json.dumps(ev.details) if ev.details else None,
                client_timestamp=ev.ts,
                created_at=datetime.utcnow()
            )
        )

    db.bulk_save_objects(records_to_insert)
    db.commit()

    return JSONResponse(
        status_code=status.HTTP_202_ACCEPTED,
        content={"status": "ACCEPTED", "ingested": len(records_to_insert)}
    )

@router.get("/scanner-health")
def get_scanner_health_metrics(
    days: int = 7,
    device_bucket: Optional[str] = None,
    display_type: Optional[str] = None,
    token_format: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Failure Forensics Dashboard Endpoint for Super Admin & HOD.
    Returns headline tiles, stage-by-stage funnel progression, failure matrix, decode duration histogram, and manual-path reliance.
    Supports filtering by device_bucket, display_type, and token_format (short|legacy).
    """
    if current_user.role not in (UserRole.SUPER_ADMIN, UserRole.TEACHER):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrative or Faculty permissions required."
        )

    from app.models.models import ScanTelemetryEvent
    from app.services.telemetry_rollup import calculate_percentile

    since = datetime.utcnow() - timedelta(days=days)

    query = db.query(ScanTelemetryEvent).filter(ScanTelemetryEvent.created_at >= since)
    if device_bucket and device_bucket in VALID_DEVICE_BUCKETS:
        query = query.filter(ScanTelemetryEvent.device_bucket == device_bucket)
    if display_type and display_type in VALID_DISPLAY_TYPES:
        query = query.filter(ScanTelemetryEvent.display_type == display_type)
    if token_format and token_format in VALID_TOKEN_FORMATS:
        query = query.filter(ScanTelemetryEvent.token_format == token_format)

    events: list[ScanTelemetryEvent] = query.all()

    # 1. Headline Statistics
    started_events = [e for e in events if e.event_type == "scan_page_opened"]
    confirmed_events = [e for e in events if e.event_type == "attendance_confirmed"]
    retried_sessions = {e.session_id for e in events if e.event_type == "scan_retried" and e.session_id}

    total_started = len(started_events)
    total_confirmed = len(confirmed_events)

    first_attempt_count = sum(
        1 for e in confirmed_events
        if e.session_id and e.session_id not in retried_sessions
    )
    first_attempt_rate = round((first_attempt_count / max(1, total_started or total_confirmed) * 100.0), 1) if (total_started or total_confirmed) else 100.0

    durations = [e.duration_ms for e in confirmed_events if e.duration_ms is not None and e.duration_ms > 0]
    durations.sort()
    p50_time = calculate_percentile(durations, 50.0)
    p95_time = calculate_percentile(durations, 95.0)

    # Failure rate per device bucket
    failed_events = [e for e in events if e.event_type == "scan_failed"]
    total_failures = len(failed_events)

    bucket_stats: Dict[str, Dict[str, Any]] = {"old": {"started": 0, "failed": 0, "rate": 0.0}, "mid": {"started": 0, "failed": 0, "rate": 0.0}, "new": {"started": 0, "failed": 0, "rate": 0.0}}
    for e in started_events:
        b = e.device_bucket if e.device_bucket in bucket_stats else "mid"
        bucket_stats[b]["started"] += 1
    for e in failed_events:
        b = e.device_bucket if e.device_bucket in bucket_stats else "mid"
        bucket_stats[b]["failed"] += 1

    for b in bucket_stats:
        st = bucket_stats[b]["started"]
        fl = bucket_stats[b]["failed"]
        bucket_stats[b]["rate"] = round((fl / max(1, st + fl) * 100.0), 1) if (st + fl) > 0 else 0.0

    # 2. Funnel view (Drop-off progression)
    stages = [
        ("scan_page_opened", "Scan Page Opened"),
        ("camera_opened", "Camera Opened"),
        ("first_frame_captured", "First Frame"),
        ("frame_decoded", "QR Decoded"),
        ("token_submitted", "Token Submitted"),
        ("attendance_confirmed", "Marked Confirmed")
    ]
    funnel_stages = []
    base_count = max(1, total_started)
    for code, label in stages:
        cnt = sum(1 for e in events if e.event_type == code)
        conv = round((cnt / base_count) * 100.0, 1)
        funnel_stages.append({
            "stage": code,
            "label": label,
            "count": cnt,
            "conversion_pct": min(100.0, conv)
        })

    # 3. Failure Matrix (error_type x device_bucket)
    failure_matrix: Dict[str, Dict[str, int]] = {}
    for fe in failed_events:
        err = fe.error_type or "unknown"
        if err not in failure_matrix:
            failure_matrix[err] = {"old": 0, "mid": 0, "new": 0, "total": 0}
        b = fe.device_bucket if fe.device_bucket in VALID_DEVICE_BUCKETS else "mid"
        failure_matrix[err][b] += 1
        failure_matrix[err]["total"] += 1

    # Identify top error
    sorted_errors = sorted(failure_matrix.items(), key=lambda x: x[1]["total"], reverse=True)
    top_error = None
    if sorted_errors:
        top_err_name, top_err_counts = sorted_errors[0]
        top_error = {
            "error_type": top_err_name,
            "total_count": top_err_counts["total"],
            "primary_bucket": max(["old", "mid", "new"], key=lambda b: top_err_counts[b])
        }

    # 4. Manual-path reliance
    manual_searches = sum(1 for e in events if e.event_type == "manual_search_used")
    manual_marks = sum(1 for e in events if e.event_type == "manual_mark_created")
    total_marks = total_confirmed + manual_marks
    manual_rate = round((manual_marks / max(1, total_marks) * 100.0), 1) if total_marks > 0 else 0.0

    # Group manual marks by session to detect high-manual sessions (>15%)
    session_qr: Dict[str, int] = {}
    session_manual: Dict[str, int] = {}
    for e in confirmed_events:
        if e.session_id:
            session_qr[e.session_id] = session_qr.get(e.session_id, 0) + 1
    for e in events:
        if e.event_type == "manual_mark_created" and e.session_id:
            session_manual[e.session_id] = session_manual.get(e.session_id, 0) + 1

    flagged_sessions = []
    all_session_ids = set(session_qr.keys()) | set(session_manual.keys())
    for sid in all_session_ids:
        q = session_qr.get(sid, 0)
        m = session_manual.get(sid, 0)
        tot = q + m
        if tot >= 5: # minimum sample size to avoid false alarms
            s_rate = (m / tot) * 100.0
            if s_rate > 15.0:
                flagged_sessions.append({
                    "session_id": sid,
                    "manual_marks": m,
                    "qr_marks": q,
                    "manual_rate_pct": round(s_rate, 1)
                })

    # 5. Decode duration histogram and percentiles
    decode_events = [e for e in events if (e.event_type in ("frame_decoded", "decode_duration_histogram") or e.stage == "frame_decoded")]
    all_decodes = []
    bucket_decodes: Dict[str, list] = {"old": [], "mid": [], "new": []}
    for e in decode_events:
        d = e.decode_duration_ms if e.decode_duration_ms is not None else e.duration_ms
        if d is not None and d > 0:
            all_decodes.append(d)
            b = e.device_bucket if e.device_bucket in bucket_decodes else "mid"
            bucket_decodes[b].append(d)
    all_decodes.sort()
    for b in bucket_decodes:
        bucket_decodes[b].sort()

    def build_histogram(vals: list) -> dict:
        return {
            "<1s": sum(1 for v in vals if v < 1000),
            "1-3s": sum(1 for v in vals if 1000 <= v < 3000),
            "3-5s": sum(1 for v in vals if 3000 <= v < 5000),
            "5-8s": sum(1 for v in vals if 5000 <= v < 8000),
            "8-15s": sum(1 for v in vals if 8000 <= v <= 15000),
            ">15s": sum(1 for v in vals if v > 15000),
        }

    decode_histogram_data = {
        "p50_decode_ms": calculate_percentile(all_decodes, 50.0) if all_decodes else None,
        "p95_decode_ms": calculate_percentile(all_decodes, 95.0) if all_decodes else None,
        "total_decodes": len(all_decodes),
        "brackets": build_histogram(all_decodes),
        "by_bucket": {
            b: {
                "p50_ms": calculate_percentile(bucket_decodes[b], 50.0) if bucket_decodes[b] else None,
                "p95_ms": calculate_percentile(bucket_decodes[b], 95.0) if bucket_decodes[b] else None,
                "total": len(bucket_decodes[b]),
                "brackets": build_histogram(bucket_decodes[b])
            }
            for b in ("old", "mid", "new")
        }
    }

    return {
        "timeframe_days": days,
        "device_filter": device_bucket or "all",
        "display_filter": display_type or "all",
        "headline": {
            "total_scans_started": total_started,
            "total_scans_confirmed": total_confirmed,
            "first_attempt_success_rate": first_attempt_rate,
            "p50_time_to_mark_ms": p50_time,
            "p95_time_to_mark_ms": p95_time,
            "total_failures": total_failures,
            "bucket_breakdown": bucket_stats,
            "format_split": {
                "legacy": sum(1 for e in events if getattr(e, "token_format", None) == "legacy"),
                "short": sum(1 for e in events if getattr(e, "token_format", None) == "short")
            }
        },
        "funnel": funnel_stages,
        "decode_histogram": decode_histogram_data,
        "failure_matrix": failure_matrix,
        "top_error": top_error,
        "manual_path": {
            "manual_searches_count": manual_searches,
            "manual_marks_count": manual_marks,
            "manual_rate_pct": manual_rate,
            "flagged_sessions_high_manual": flagged_sessions
        }
    }

@router.get("/export-funnel-csv")
def export_funnel_csv(
    days: int = 30,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Exports CSV formatted scan funnel and failure forensics dataset.
    """
    if current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin permissions required.")

    from app.models.models import ScanTelemetryEvent

    since = datetime.utcnow() - timedelta(days=days)
    events = db.query(ScanTelemetryEvent).filter(ScanTelemetryEvent.created_at >= since).order_by(ScanTelemetryEvent.created_at.desc()).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "id", "session_id", "event_type", "stage", "error_type",
        "device_bucket", "display_type", "token_format", "duration_ms", "decode_duration_ms", "app_version", "created_at"
    ])

    for e in events:
        writer.writerow([
            e.id,
            e.session_id or "",
            e.event_type,
            e.stage or "",
            e.error_type or "",
            e.device_bucket,
            getattr(e, "display_type", "projector") or "projector",
            getattr(e, "token_format", "") or "",
            e.duration_ms or "",
            getattr(e, "decode_duration_ms", "") or "",
            e.app_version or "",
            e.created_at.strftime("%Y-%m-%d %H:%M:%S") if e.created_at else ""
        ])

    csv_data = output.getvalue()
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=snist_scanner_telemetry_{datetime.utcnow().strftime('%Y%m%d')}.csv"}
    )

@router.post("/trigger-rollup")
def trigger_telemetry_rollup(
    target_date: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Admin maintenance endpoint to trigger the daily rollup and 30-day purge.
    """
    if current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Super Admin required.")

    from app.services.telemetry_rollup import rollup_scan_telemetry, purge_old_scan_telemetry

    rollups = rollup_scan_telemetry(db, target_date=target_date)
    purged = purge_old_scan_telemetry(db, retention_days=30)

    return {
        "status": "SUCCESS",
        "rollups_generated": len(rollups),
        "target_date": target_date or datetime.utcnow().strftime("%Y-%m-%d"),
        "raw_events_purged": purged
    }

