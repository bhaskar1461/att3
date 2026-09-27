"""
SNIST ERP Chaos Rig Safety Guard
Phase 8: Failure-Injection & Chaos Audit

SAFETY MANDATE:
All chaos runs against the test rig ONLY.
Verify no test can reach or execute destructive actions on prod hosts:
- whiteleos.cc.cd
- seg-dev.sreenidhi.edu.in
- snist-attendance-db.*.rds.amazonaws.com

A harness that can kill prod is itself a P0 finding.
"""

import os
from typing import Optional
from urllib.parse import urlparse

class ProductionSafetyViolationError(RuntimeError):
    """Raised whenever a destructive chaos action targets a production host."""
    pass

PROD_HOST_PATTERNS = [
    "seg-dev.sreenidhi.edu.in",
    "whiteleos.cc.cd",
    "rds.amazonaws.com",
    "proofsy.tech",
    "ather-os.de5.net",
]

def is_prod_host(host_or_url: str) -> bool:
    """Checks whether the given host string or URL contains any production target."""
    if not host_or_url:
        return False
    clean = str(host_or_url).strip().lower()
    for pattern in PROD_HOST_PATTERNS:
        if pattern in clean:
            return True
    return False

def verify_rig_safety(target_url_or_host: Optional[str] = None, action_name: str = "destructive_chaos") -> None:
    """
    Asserts that the action is NOT targeting a production host.
    Raises ProductionSafetyViolationError if unsafe.
    """
    # 1. Check explicit argument
    if target_url_or_host and is_prod_host(target_url_or_host):
        raise ProductionSafetyViolationError(
            f"[FATAL SAFETY VIOLATION] Action '{action_name}' attempted to target production host: {target_url_or_host}. "
            "Destructive chaos operations are strictly prohibited on production infrastructure!"
        )

    # 2. Check process environment database URL for safety on write commands
    env_db = os.getenv("DATABASE_URL", "")
    if is_prod_host(env_db) and "destructive" in action_name.lower():
        raise ProductionSafetyViolationError(
            f"[FATAL SAFETY VIOLATION] Action '{action_name}' blocked because DATABASE_URL points to: {env_db}. "
            "Must use local test rig for destructive DB actions!"
        )
