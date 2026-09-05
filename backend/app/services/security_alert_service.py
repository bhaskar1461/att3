"""
SNIST ERP — Two-Layer Security Alerting & Detection Service
Real-time operational alerts for active security incidents and hourly safety-net digests.

Design Principles:
- Zero Latency on Request Path: Fire-and-forget background worker thread (execution time < 0.5ms).
- Zero Alert Fatigue: Strict sliding window thresholds + 10-minute cooldown suppression.
- Defensive Boundary: Never crashes request pipeline even under database or SMTP connection failure.
- Canonical Identity & Server Time: Adheres to ADR-002 (SAP ID) and ADR-003 (Server-Authoritative IST).
"""

import os
import time
import logging
import threading
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List, Tuple
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

from app.core.config import settings
from app.core.security import get_server_ist_datetime

logger = logging.getLogger("snist_erp.security_alerts")

# Dedicated daemon thread pool for fire-and-forget email dispatch
# WHY: Guarantees email rendering and SMTP network handshakes NEVER block the caller's request thread.
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="SecurityAlertWorker")

# Security Event Type Constants
EVENT_ACCOUNT_SWITCH = "ACCOUNT_SWITCH_ATTEMPT"
EVENT_DEVICE_REVOKED = "DEVICE_REVOKED"
EVENT_FAILED_HMAC = "FAILED_HMAC"
EVENT_PRIVESC_ATTEMPT = "PRIVESC_ATTEMPT"
EVENT_SCAN_FLOOD_429 = "SCAN_FLOOD_429"
EVENT_LOGIN_RATE_LIMIT = "RATE_LIMIT_TRIGGERED"
EVENT_ALERT_SENT = "SECURITY_ALERT_SENT"

# Configured Threshold Definitions: (count_threshold, window_seconds, is_digest_only)
THRESHOLDS: Dict[str, Tuple[int, int, bool]] = {
    EVENT_ACCOUNT_SWITCH: (3, 600, False),     # 3rd attempt from same device within 10 minutes
    EVENT_DEVICE_REVOKED: (1, 60, False),      # Immediate alert on student-caused revocation
    EVENT_FAILED_HMAC: (10, 300, False),       # >10 failures per source in 5 minutes
    EVENT_PRIVESC_ATTEMPT: (1, 60, False),     # Immediate alert on unauthorized privilege escalation
    EVENT_SCAN_FLOOD_429: (30, 300, False),    # >30 per source in 5 minutes
    EVENT_LOGIN_RATE_LIMIT: (20, 900, True),   # >20 per IP in 15 minutes (hourly digest only)
}


class SecurityAlertTracker:
    """
    Thread-safe in-memory sliding window threshold tracker with cooldown suppression.
    Stores timestamps per (event_type:source) and cooldown expirations per (event_type:subject).
    """

    def __init__(self, cooldown_minutes: int = 10):
        self.cooldown_seconds = cooldown_minutes * 60
        self._window_history: Dict[str, List[float]] = defaultdict(list)
        self._cooldown_map: Dict[str, float] = {}
        self._suppressed_counts: Dict[str, int] = defaultdict(int)
        self._lock = threading.Lock()

    def record_and_evaluate(
        self,
        event_type: str,
        subject_id: str,
        source_id: str
    ) -> Tuple[bool, bool, int, str]:
        """
        Records an event occurrence and evaluates threshold and cooldown status.
        Returns: (should_alert, is_cooldown_suppressed, current_window_count, trigger_reason)
        """
        now = time.time()
        rule = THRESHOLDS.get(event_type, (1, 300, False))
        threshold_count, window_sec, digest_only = rule

        # If designated as digest only, record for hourly rollup without firing real-time alert
        # WHY: Protects operator inbox from credential spraying brute-force storms.
        if digest_only:
            with self._lock:
                key = f"{event_type}:{source_id}"
                self._suppressed_counts[key] += 1
            return False, False, 1, "Recorded for hourly digest"

        source_key = f"{event_type}:{source_id}"
        cooldown_key = f"{event_type}:{subject_id or source_id}"

        with self._lock:
            # 1. Slide window: prune timestamps older than window_sec
            # WHY: Sliding window guarantees mathematically sound rate tracking without memory bloat.
            valid_times = [t for t in self._window_history[source_key] if now - t < window_sec]
            valid_times.append(now)
            self._window_history[source_key] = valid_times
            count = len(valid_times)

            # 2. Threshold evaluation
            if count < threshold_count:
                return False, False, count, f"Count {count}/{threshold_count} below threshold"

            # 3. Cooldown check
            last_alert_time = self._cooldown_map.get(cooldown_key, 0)
            if now - last_alert_time < self.cooldown_seconds:
                # Event exceeded threshold, but cooldown is active -> suppress and increment counter
                # WHY: Eliminates repetitive emails for ongoing attacks while recording volume for digest.
                self._suppressed_counts[cooldown_key] += 1
                return False, True, count, f"Threshold exceeded ({count}) but cooldown active"

            # 4. Fire alert & reset cooldown
            self._cooldown_map[cooldown_key] = now
            return True, False, count, f"Reached {count} attempts within {int(window_sec/60)}m (Threshold: {threshold_count})"

    def get_and_flush_suppressed_counts(self) -> Dict[str, int]:
        """Retrieves suppressed event counts and flushes the tracker for the hourly digest."""
        with self._lock:
            snapshot = dict(self._suppressed_counts)
            self._suppressed_counts.clear()
            return snapshot

    def reset_state(self):
        """Resets all tracking maps (used primarily in automated unit tests)."""
        with self._lock:
            self._window_history.clear()
            self._cooldown_map.clear()
            self._suppressed_counts.clear()


# Global in-memory tracker instance
alert_tracker = SecurityAlertTracker(cooldown_minutes=getattr(settings, "SECURITY_ALERT_COOLDOWN_MIN", 10))


class SecurityAlertService:
    """Core security alerting engine managing real-time dispatches and hourly digests."""

    @staticmethod
    def hook_audit_event(
        event_type: str,
        roll_number: Optional[str] = None,
        device_id: Optional[Any] = None,
        ip_address: Optional[str] = None,
        details: Optional[str] = None,
        audit_id: Optional[int] = None
    ) -> None:
        """
        Synchronous non-blocking hook called by record_audit_log.
        Returns immediately after enqueuing background evaluation (<0.5ms latency).
        """
        # Master kill-switch check
        # WHY: Allows operator to instantly silence alerting via environment variable without restarting.
        if not getattr(settings, "SECURITY_ALERTS_ENABLED", True):
            return

        clean_type = event_type.value if hasattr(event_type, "value") else str(event_type)

        # Only evaluate events registered in our alerting threshold matrix
        if clean_type not in THRESHOLDS:
            return

        subject_id = (roll_number or "UNKNOWN").strip().upper()
        source_id = str(device_id or ip_address or "UNKNOWN_SOURCE").strip()

        # Enqueue background evaluation outside the request path
        # WHY: Ensures client request processing finishes with zero latency overhead.
        try:
            _executor.submit(
                SecurityAlertService._process_event_async,
                clean_type,
                subject_id,
                source_id,
                details or "",
                ip_address,
                audit_id
            )
        except Exception as queue_err:
            # Defensive error boundary: thread pool exhaustion must never impact web request
            logger.warning(f"Could not enqueue security alert: {queue_err}")

    @staticmethod
    def _process_event_async(
        event_type: str,
        subject_id: str,
        source_id: str,
        details: str,
        ip_address: Optional[str],
        audit_id: Optional[int]
    ) -> None:
        """Internal background worker function that checks threshold and sends email."""
        try:
            should_alert, is_suppressed, count, reason = alert_tracker.record_and_evaluate(
                event_type=event_type,
                subject_id=subject_id,
                source_id=source_id
            )

            if not should_alert:
                if is_suppressed:
                    logger.info(f"[ALERT-COOLDOWN] Suppressed {event_type} for {subject_id} (count={count})")
                return

            # Threshold met and cooldown expired: dispatch alert
            SecurityAlertService._dispatch_alert_email(
                event_type=event_type,
                subject_id=subject_id,
                source_id=source_id,
                count=count,
                trigger_reason=reason,
                details=details,
                ip_address=ip_address,
                audit_id=audit_id
            )
        except Exception as proc_err:
            # Defensive error boundary: worker failure must be logged without crashing the process
            logger.error(f"Error in _process_event_async: {proc_err}", exc_info=True)

    @staticmethod
    def _dispatch_alert_email(
        event_type: str,
        subject_id: str,
        source_id: str,
        count: int,
        trigger_reason: str,
        details: str,
        ip_address: Optional[str],
        audit_id: Optional[int]
    ) -> None:
        """Renders and sends real-time security alert email."""
        from app.services.email_service import render_email_template, send_single_email

        target_email = getattr(settings, "SECURITY_ALERT_EMAIL", "23311a05y6@cse.sreenidhi.edu.in")
        timestamp_ist = get_server_ist_datetime().strftime("%d-%b-%Y %H:%M:%S")

        # Map event types to human-readable titles, severities, and recommendations
        # WHY: Provides operator with instant triage clarity during live class incidents.
        title_map = {
            EVENT_ACCOUNT_SWITCH: ("Multi-Account Device Switching Detected", "CRITICAL", "Inspect device history; verify student ownership; consider account lockout if persistent."),
            EVENT_DEVICE_REVOKED: ("Device Revoked / Disciplinary Action Triggered", "HIGH", "Review revoked device binding and confirm student re-authentication status."),
            EVENT_FAILED_HMAC: ("Cryptographic QR Token Tampering Detected", "HIGH", "Investigate client device and network logs for unauthorized QR manipulation."),
            EVENT_PRIVESC_ATTEMPT: ("Unauthorized Privilege Escalation Attempt", "CRITICAL", "Student account attempted to access faculty/admin API. Verify student identity immediately."),
            EVENT_SCAN_FLOOD_429: ("Attendance Scan Rate-Limit Exhaustion", "HIGH", "Possible automated scan script or denial-of-service attack on attendance engine."),
        }

        title, severity, recommendation = title_map.get(
            event_type,
            ("Security Incident Alert", "MEDIUM", "Review audit logs and investigate source IP/device.")
        )

        context = {
            "event_title": title,
            "event_type": event_type,
            "severity": severity,
            "subject_id": subject_id,
            "source_id": source_id,
            "trigger_reason": trigger_reason,
            "client_ip": ip_address,
            "audit_id": audit_id,
            "details": details,
            "recommended_action": recommendation,
            "timestamp_ist": timestamp_ist,
            "admin_url": f"{getattr(settings, 'FRONTEND_URL', 'https://ather-os.de5.net').rstrip('/')}/admin"
        }

        html_content = render_email_template("security_alert_email.html", context)
        subject = f"[SNIST SECURITY ALERT] [{severity}] {title} ({subject_id})"

        # Reuse existing dual SMTP transport with automatic failover
        # WHY: Leverages proven SMTP pipeline with zero duplicate network logic.
        res = send_single_email(
            to_email=target_email,
            subject=subject,
            html_body=html_content,
            channel="DEFAULT"
        )
        logger.info(f"Dispatched security alert for {event_type} to {target_email}: status={res.get('status')}")

        # Log alert dispatch into qr_audit_logs using a fresh DB session
        # WHY: Guarantees alert audit record is committed independently of the triggering transaction.
        try:
            from app.core.database import SessionLocal
            from app.models.models import AuditLog
            with SessionLocal() as db:
                alert_audit = AuditLog(
                    user_id=None,
                    roll_number=subject_id,
                    event_type=EVENT_ALERT_SENT,
                    action="REALTIME_ALERT_DISPATCHED",
                    details=f"Alert sent to {target_email} for {event_type}. Trigger: {trigger_reason}. Result: {res.get('status')}",
                    ip_address=ip_address,
                    created_at=datetime.utcnow()
                )
                db.add(alert_audit)
                db.commit()
        except Exception as audit_err:
            logger.warning(f"Failed to record SECURITY_ALERT_SENT audit entry: {audit_err}")

    @staticmethod
    def generate_and_send_hourly_digest(force_window: bool = False) -> Dict[str, Any]:
        """
        Executes Layer 2 hourly security digest rollup.
        Queries qr_audit_logs for events in the past 60 minutes.
        If zero events: sends nothing.
        If events exist: sends formatted rollup email.
        """
        # Defensive error boundary around entire digest loop
        # WHY: A database query or template rendering exception must NEVER crash the scheduler loop.
        try:
            now_ist = get_server_ist_datetime()

            # Schedule check: 09:00 - 17:00 IST on weekdays (Mon=0 .. Fri=4)
            # WHY: Fulfills user constraint to restrict safety net emails strictly to active class hours.
            weekday = now_ist.weekday()
            current_hour = now_ist.hour
            start_hour = getattr(settings, "SECURITY_DIGEST_START_HOUR", 9)
            end_hour = getattr(settings, "SECURITY_DIGEST_END_HOUR", 17)

            if not force_window and (weekday > 4 or current_hour < start_hour or current_hour > end_hour):
                logger.info(f"[DIGEST-SKIPPED] Outside configured operating window (Hour: {current_hour}, Weekday: {weekday})")
                return {"status": "SKIPPED", "reason": "OUTSIDE_SCHEDULE"}

            from app.core.database import SessionLocal
            from app.models.models import AuditLog, DeviceRegistration
            from app.services.email_service import render_email_template, send_single_email

            cutoff_utc = datetime.utcnow() - timedelta(hours=1)
            target_types = list(THRESHOLDS.keys()) + [EVENT_ALERT_SENT]

            with SessionLocal() as db:
                records = db.query(AuditLog).filter(
                    AuditLog.event_type.in_(target_types),
                    AuditLog.created_at >= cutoff_utc
                ).order_by(AuditLog.id.desc()).all()

                # If zero security events, send nothing (no all-clear noise)
                # WHY: Adheres strictly to the anti-alert-fatigue mandate.
                if not records:
                    logger.info("[DIGEST-SKIPPED] Zero security events in the past hour. No email sent.")
                    return {"status": "SKIPPED", "reason": "ZERO_EVENTS"}

                # Gather device signatures for readable display
                device_ids = {r.device_id for r in records if r.device_id}
                dev_map = {}
                if device_ids:
                    dev_rows = db.query(DeviceRegistration).filter(DeviceRegistration.id.in_(list(device_ids))).all()
                    dev_map = {d.id: d.device_public_id for d in dev_rows}

                formatted_events = []
                alerts_dispatched = 0
                for r in records:
                    if r.event_type == EVENT_ALERT_SENT:
                        alerts_dispatched += 1

                    r_ist = (r.created_at + timedelta(hours=5, minutes=30)).strftime("%H:%M:%S")
                    formatted_events.append({
                        "time_ist": r_ist,
                        "event_type": r.event_type,
                        "roll_number": r.roll_number,
                        "device_sig": dev_map.get(r.device_id, f"Dev#{r.device_id}" if r.device_id else None),
                        "ip_address": r.ip_address,
                        "details_short": (r.details[:85] + "...") if r.details and len(r.details) > 85 else (r.details or "")
                    })

                suppressed_snapshot = alert_tracker.get_and_flush_suppressed_counts()
                total_suppressed = sum(suppressed_snapshot.values())

                window_start = (now_ist - timedelta(hours=1)).strftime("%H:00")
                window_end = now_ist.strftime("%H:00")

                context = {
                    "window_start_ist": window_start,
                    "window_end_ist": window_end,
                    "total_events": len(records),
                    "alerts_dispatched": alerts_dispatched,
                    "suppressed_count": total_suppressed,
                    "events": formatted_events[:50],  # Bounded table size
                    "suppressed_items": suppressed_snapshot,
                    "admin_url": f"{getattr(settings, 'FRONTEND_URL', 'https://ather-os.de5.net').rstrip('/')}/admin"
                }

                html_content = render_email_template("security_digest_email.html", context)
                target_email = getattr(settings, "SECURITY_ALERT_EMAIL", "23311a05y6@cse.sreenidhi.edu.in")
                subject = f"[SNIST SECURITY DIGEST] Hourly Activity Rollup ({window_start} - {window_end} IST)"

                res = send_single_email(
                    to_email=target_email,
                    subject=subject,
                    html_body=html_content,
                    channel="DEFAULT"
                )

                # Record digest audit log
                digest_audit = AuditLog(
                    user_id=None,
                    roll_number="HOURLY_DIGEST",
                    event_type=EVENT_ALERT_SENT,
                    action="HOURLY_DIGEST_SENT",
                    details=f"Hourly digest dispatched to {target_email}. Total events: {len(records)}, Suppressed: {total_suppressed}. Result: {res.get('status')}",
                    ip_address="127.0.0.1",
                    created_at=datetime.utcnow()
                )
                db.add(digest_audit)
                db.commit()

                logger.info(f"[DIGEST-SENT] Successfully delivered hourly security digest to {target_email}")
                return {"status": "SENT", "events_count": len(records), "suppressed_count": total_suppressed}

        except Exception as digest_err:
            logger.error(f"Error executing generate_and_send_hourly_digest: {digest_err}", exc_info=True)
            return {"status": "ERROR", "error": str(digest_err)}
