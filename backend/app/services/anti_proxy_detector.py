"""
Anti-Proxy Detection Engine: Face-Embedding Multi-Student Clustering
SNIST ERP AI QR-Attendance System — Phase 10 Production Capability
Based on Phase 9 Pen-Test Task 12.4 Specification.

Solves the "Friend Phone" (P1) and "Remote Short Code / Forwarded QR" (P3, P4)
proxy fraud doors post-hoc by clustering facial feature embeddings across
all attendance selfies submitted in a classroom session.
"""

import math
import json
import logging
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime
from sqlalchemy.orm import Session

from app.models.models import AttendanceRecord, SelfieRecord, Student
from app.services.security_alert_service import alert_tracker

logger = logging.getLogger("snist_erp.anti_proxy_detector")

EVENT_PROXY_RING_DETECTED = "PROXY_RING_DETECTED"


def cosine_similarity(v1: List[float], v2: List[float]) -> float:
    """Computes cosine similarity between two float vectors."""
    if not v1 or not v2 or len(v1) != len(v2):
        return 0.0
    dot = sum(a * b for a, b in zip(v1, v2))
    norm1 = math.sqrt(sum(a * a for a in v1))
    norm2 = math.sqrt(sum(b * b for b in v2))
    if norm1 == 0.0 or norm2 == 0.0:
        return 0.0
    return dot / (norm1 * norm2)


def detect_proxy_rings(
    db: Session,
    session_id: int,
    similarity_threshold: float = 0.78,
    simulated_embeddings: Optional[Dict[str, List[float]]] = None
) -> List[Dict[str, Any]]:
    """
    Scans all selfie submissions for a session to detect proxy fraud rings.
    
    Algorithm:
    1. Collects all AttendanceRecords for the session with their associated SelfieRecord.
    2. Retrieves face embeddings (using either stored vector metadata or simulated test vectors).
    3. Computes the pairwise cosine similarity matrix.
    4. Identifies pairs of distinct students whose facial similarity meets or exceeds threshold.
    5. Dispatches high-priority PROXY_RING_DETECTED security alerts.
    
    Returns:
        List of detected fraud rings with evidence chains.
    """
    records = db.query(AttendanceRecord).filter(
        AttendanceRecord.session_id == session_id
    ).all()

    if not records or len(records) < 2:
        return []

    # Map roll number to embedding
    embeddings_by_student: Dict[str, Dict[str, Any]] = {}

    for rec in records:
        clean_roll = (rec.roll_number or "").strip().upper()
        if not clean_roll:
            continue

        vec: Optional[List[float]] = None
        selfie_key = rec.selfie_storage_key or ""

        # 1. Use simulated embeddings if provided (for automated testing / fixtures)
        if simulated_embeddings and clean_roll in simulated_embeddings:
            vec = simulated_embeddings[clean_roll]
        else:
            # 2. Check associated SelfieRecord if available
            selfie = db.query(SelfieRecord).filter(
                SelfieRecord.session_id == session_id,
                SelfieRecord.roll_number == clean_roll
            ).first()
            if selfie and getattr(selfie, "embedding_json", None):
                try:
                    vec = json.loads(selfie.embedding_json)
                except Exception:
                    vec = None

        if vec:
            embeddings_by_student[clean_roll] = {
                "student_id": rec.student_id,
                "roll_number": clean_roll,
                "attendance_id": rec.id,
                "selfie_key": selfie_key,
                "embedding": vec
            }

    detected_rings: List[Dict[str, Any]] = []
    rolls = list(embeddings_by_student.keys())

    for i in range(len(rolls)):
        for j in range(i + 1, len(rolls)):
            roll_a = rolls[i]
            roll_b = rolls[j]
            data_a = embeddings_by_student[roll_a]
            data_b = embeddings_by_student[roll_b]

            sim = cosine_similarity(data_a["embedding"], data_b["embedding"])
            if sim >= similarity_threshold:
                ring_evidence = {
                    "session_id": session_id,
                    "student_a": roll_a,
                    "student_b": roll_b,
                    "student_a_id": data_a["student_id"],
                    "student_b_id": data_b["student_id"],
                    "cosine_similarity": round(sim, 4),
                    "similarity_threshold": similarity_threshold,
                    "selfie_a_key": data_a["selfie_key"],
                    "selfie_b_key": data_b["selfie_key"],
                    "detected_at": datetime.utcnow().isoformat() + "Z"
                }
                detected_rings.append(ring_evidence)

                # Emit high-priority security alert
                try:
                    alert_tracker.record_and_evaluate(
                        EVENT_PROXY_RING_DETECTED,
                        f"{roll_a}<->{roll_b}",
                        f"session_{session_id}"
                    )
                except Exception as alert_err:
                    logger.warning(f"Could not record PROXY_RING_DETECTED alert: {alert_err}")

    if detected_rings:
        logger.warning(
            f"[ANTI-PROXY DETECTOR] Session #{session_id}: Detected {len(detected_rings)} proxy ring(s) "
            f"violating {similarity_threshold} threshold."
        )

    return detected_rings
