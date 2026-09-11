"""
SNIST ERP — Scan Telemetry Daily Rollup & Retention Service
Week 1: Measurement & Forensics Layer

Aggregates raw scan funnel events into persistent daily rollup records.
Purges raw events after 30 days to prevent database bloat.
Runs strictly on background worker budget.
"""
from typing import Optional, List, Dict, Any, Union
from datetime import datetime, date, timedelta
import json
import logging
from sqlalchemy.orm import Session
from sqlalchemy import func, and_

from app.models.models import ScanTelemetryEvent, ScanTelemetryDailyRollup

logger = logging.getLogger("snist_erp.telemetry_rollup")

def calculate_percentile(values: List[float], percentile: float) -> float:
    """Calculates percentile from a sorted list of numeric values."""
    if not values:
        return 0.0
    k = (len(values) - 1) * (percentile / 100.0)
    f = int(k)
    c = min(f + 1, len(values) - 1)
    d = k - f
    return round(values[f] + d * (values[c] - values[f]), 2)

def rollup_scan_telemetry(db: Session, target_date: Optional[Union[str, date, datetime]] = None) -> List[ScanTelemetryDailyRollup]:
    """
    Rolls up raw scan telemetry events for target_date (YYYY-MM-DD) into daily rollup records.
    Processes each device bucket ('old', 'mid', 'new') plus an aggregated 'all' bucket.
    Upserts into qr_scan_telemetry_daily_rollup.
    """
    if isinstance(target_date, (date, datetime)):
        target_date_str = target_date.strftime("%Y-%m-%d")
    elif target_date:
        target_date_str = str(target_date).strip()
    else:
        target_date_str = datetime.utcnow().strftime("%Y-%m-%d")

    # Determine date range [start_of_day, end_of_day)
    try:
        dt_start = datetime.strptime(target_date_str, "%Y-%m-%d")
    except ValueError:
        logger.error(f"Invalid target_date format: {target_date_str}. Expected YYYY-MM-DD.")
        return []

    target_date = target_date_str
    dt_end = dt_start + timedelta(days=1)

    # Query all raw events for this date
    events: List[ScanTelemetryEvent] = db.query(ScanTelemetryEvent).filter(
        and_(
            ScanTelemetryEvent.created_at >= dt_start,
            ScanTelemetryEvent.created_at < dt_end
        )
    ).all()

    buckets = ["old", "mid", "new", "all"]
    results: List[ScanTelemetryDailyRollup] = []

    for bucket in buckets:
        if bucket == "all":
            b_events = events
        else:
            b_events = [e for e in events if e.device_bucket == bucket]

        total_started = sum(1 for e in b_events if e.event_type == "scan_page_opened")
        confirmed_events = [e for e in b_events if e.event_type == "attendance_confirmed"]
        total_confirmed = len(confirmed_events)

        # Retries in the same session
        retried_session_ids = {e.session_id for e in b_events if e.event_type == "scan_retried" and e.session_id}
        first_attempt_count = sum(
            1 for e in confirmed_events
            if e.session_id and e.session_id not in retried_session_ids
        )
        # If total_started == 0, check confirmed
        base_started = max(total_started, total_confirmed)
        first_attempt_rate = round((first_attempt_count / base_started * 100.0), 2) if base_started > 0 else 0.0

        # Duration metrics from attendance_confirmed events
        durations = [e.duration_ms for e in confirmed_events if e.duration_ms is not None and e.duration_ms > 0]
        durations.sort()

        avg_time = round(sum(durations) / len(durations), 2) if durations else 0.0
        p50_time = calculate_percentile(durations, 50.0)
        p95_time = calculate_percentile(durations, 95.0)

        # Stage dropoffs
        stages = [
            "scan_page_opened",
            "camera_opened",
            "first_frame_captured",
            "frame_decoded",
            "token_submitted",
            "attendance_confirmed"
        ]
        stage_dropoffs = {
            s: sum(1 for e in b_events if e.event_type == s)
            for s in stages
        }

        # Failure counts by error_type
        failure_events = [e for e in b_events if e.event_type == "scan_failed" and e.error_type]
        failure_counts: Dict[str, int] = {}
        for fe in failure_events:
            err = fe.error_type or "unknown"
            failure_counts[err] = failure_counts.get(err, 0) + 1

        manual_searches = sum(1 for e in b_events if e.event_type == "manual_search_used")
        manual_marks = sum(1 for e in b_events if e.event_type == "manual_mark_created")

        # Decode duration metrics & histogram (from successful decodes / decode_duration_histogram)
        decode_durations = []
        for e in b_events:
            val = e.decode_duration_ms if e.decode_duration_ms is not None else (
                e.duration_ms if e.event_type in ("frame_decoded", "decode_duration_histogram") or e.stage == "frame_decoded" else None
            )
            if val is not None and val > 0:
                decode_durations.append(val)
        decode_durations.sort()

        decode_p50 = calculate_percentile(decode_durations, 50.0) if decode_durations else None
        decode_p95 = calculate_percentile(decode_durations, 95.0) if decode_durations else None

        histogram = {
            "<1s": sum(1 for d in decode_durations if d < 1000),
            "1-3s": sum(1 for d in decode_durations if 1000 <= d < 3000),
            "3-5s": sum(1 for d in decode_durations if 3000 <= d < 5000),
            "5-8s": sum(1 for d in decode_durations if 5000 <= d < 8000),
            "8-15s": sum(1 for d in decode_durations if 8000 <= d <= 15000),
            ">15s": sum(1 for d in decode_durations if d > 15000)
        }

        # Upsert into DB
        rollup = db.query(ScanTelemetryDailyRollup).filter_by(
            date=target_date,
            device_bucket=bucket
        ).first()

        if not rollup:
            rollup = ScanTelemetryDailyRollup(
                date=target_date,
                device_bucket=bucket
            )
            db.add(rollup)

        rollup.total_scans_started = total_started
        rollup.total_scans_confirmed = total_confirmed
        rollup.first_attempt_success_count = first_attempt_count
        rollup.first_attempt_success_rate = first_attempt_rate
        rollup.avg_time_to_mark_ms = avg_time
        rollup.p50_time_to_mark_ms = p50_time
        rollup.p95_time_to_mark_ms = p95_time
        rollup.stage_dropoffs_json = json.dumps(stage_dropoffs)
        rollup.failure_counts_json = json.dumps(failure_counts)
        rollup.decode_p50_ms = decode_p50
        rollup.decode_p95_ms = decode_p95
        rollup.decode_histogram_json = json.dumps(histogram)
        rollup.manual_searches_count = manual_searches
        rollup.manual_marks_count = manual_marks
        rollup.updated_at = datetime.utcnow()

        results.append(rollup)

    db.commit()
    logger.info(f"Scan telemetry rollup complete for {target_date}: {len(results)} bucket summaries generated.")
    return results

def purge_old_scan_telemetry(db: Session, retention_days: int = 30) -> int:
    """
    Deletes raw scan telemetry events older than retention_days.
    Preserves aggregated daily rollups forever.
    """
    cutoff_date = datetime.utcnow() - timedelta(days=retention_days)
    deleted_count = db.query(ScanTelemetryEvent).filter(
        ScanTelemetryEvent.created_at < cutoff_date
    ).delete(synchronize_session=False)

    db.commit()
    logger.info(f"Purged {deleted_count} raw scan telemetry events older than {cutoff_date.strftime('%Y-%m-%d')}.")
    return deleted_count
