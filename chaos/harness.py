"""
SNIST ERP Chaos Observation Harness
Phase 8: Failure-Injection & Chaos Audit Rig

Captures:
- Client outcome (status_code, response, latency_ms, mapped error)
- Server log lines (forensics)
- Database row states (attendance, idempotency, otp_delivery_log)
- Pool and thread metrics
- Recovery timeline (post-restore health verification)
"""

import time
import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Callable, Tuple

Tuple_Recovery = Tuple[bool, float]

@dataclass
class ScenarioResult:
    scenario_name: str
    run_index: int
    injected_fault: str
    client_status_code: int
    client_latency_ms: float
    client_error_mapped: bool
    client_response: Dict[str, Any]
    db_state_intact: bool
    db_details: str
    recovery_time_ms: float
    wedged: bool
    log_snippets: List[str] = field(default_factory=list)
    verdict: str = "PASS"


class LogCaptureHandler(logging.Handler):
    """Thread-safe logging handler to capture application log output during chaos scenarios."""
    def __init__(self):
        super().__init__()
        self.records: List[str] = []

    def emit(self, record):
        try:
            msg = self.format(record)
            self.records.append(msg)
        except Exception:
            pass

    def clear(self):
        self.records.clear()


class ObservationHarness:
    """
    Orchestrates chaos execution, metrics collection, and post-restore verification.
    """
    def __init__(self, golden_flow_fn: Optional[Callable[[], bool]] = None):
        self.golden_flow_fn = golden_flow_fn
        self.log_handler = LogCaptureHandler()
        self.log_handler.setLevel(logging.INFO)
        logging.getLogger("snist_erp").addHandler(self.log_handler)

    def start_recording(self) -> None:
        self.log_handler.clear()

    def get_captured_logs(self) -> List[str]:
        return list(self.log_handler.records)

    def measure_golden_baseline(self) -> float:
        """Runs the golden flow once to measure baseline latency."""
        if not self.golden_flow_fn:
            return 0.0
        t0 = time.perf_counter()
        success = self.golden_flow_fn()
        t1 = time.perf_counter()
        if not success:
            raise RuntimeError("Golden flow baseline execution failed!")
        return (t1 - t0) * 1000.0

    def verify_recovery(self, max_wait_s: float = 5.0) -> Tuple_Recovery:
        """
        Polls the golden flow to verify system recovery after fault restoration.
        Returns (recovered_boolean, recovery_duration_ms).
        """
        if not self.golden_flow_fn:
            return True, 0.0
        t0 = time.perf_counter()
        deadline = t0 + max_wait_s
        while time.perf_counter() < deadline:
            try:
                if self.golden_flow_fn():
                    dur = (time.perf_counter() - t0) * 1000.0
                    return True, dur
            except Exception:
                time.sleep(0.05)
        return False, (time.perf_counter() - t0) * 1000.0


Tuple_Recovery = Any
