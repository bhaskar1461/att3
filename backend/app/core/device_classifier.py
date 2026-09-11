"""
SNIST ERP — Device Tier Classifier (Server-Side)
Week 1 Telemetry Module

Classifies incoming User-Agents into device tiers: 'old', 'mid', 'new'.
Mirrors frontend/src/utils/deviceClassifier.ts for consistency.
"""
import re
from typing import Optional

def classify_device(
    user_agent: Optional[str],
    hardware_concurrency: Optional[int] = None,
    device_memory_gb: Optional[float] = None
) -> str:
    """
    Pure function classifier for client device capability tier.
    
    Tiers:
    - 'old': Android <= 9, CPU cores <= 4, RAM <= 2GB, or iOS <= 14.
    - 'new': Android >= 13 with CPU cores >= 8 and RAM >= 6GB, or iOS >= 17 with CPU cores >= 6.
    - 'mid': Everything in-between (safe default).
    
    Never raises an exception; returns 'mid' on unknown/empty inputs.
    """
    if not user_agent or not isinstance(user_agent, str):
        return "mid"
        
    lower = user_agent.lower()
    
    # 1. Android Detection
    android_match = re.search(r"android\s+([0-9]+(?:\.[0-9]+)*)", lower)
    if android_match:
        try:
            major_version = int(android_match.group(1).split(".")[0])
        except (ValueError, IndexError):
            major_version = 10
            
        cores = hardware_concurrency if hardware_concurrency is not None else 4
        ram = device_memory_gb if device_memory_gb is not None else 4.0
        
        if major_version <= 9 or cores <= 4 or ram <= 2.0:
            return "old"
            
        if major_version >= 13 and cores >= 8 and ram >= 6.0:
            return "new"
            
        return "mid"
        
    # 2. iOS Detection
    is_ios = (
        "iphone" in lower or
        "ipad" in lower or
        "ipod" in lower or
        ("macintosh" in lower and "safari" in lower and "mobile" in lower)
    )
    if is_ios:
        ios_match = re.search(r"os\s+([0-9]+)_", lower)
        major_version = int(ios_match.group(1)) if ios_match else 16
        cores = hardware_concurrency if hardware_concurrency is not None else 6
        
        if major_version <= 14:
            return "old"
        if major_version >= 17 and cores >= 6:
            return "new"
        return "mid"
        
    # 3. Desktop / General Fallback
    if hardware_concurrency is not None:
        if hardware_concurrency <= 4 and (device_memory_gb is not None and device_memory_gb <= 2.0):
            return "old"
        if hardware_concurrency >= 8 and (device_memory_gb is None or device_memory_gb >= 8.0):
            return "new"
            
    return "mid"
