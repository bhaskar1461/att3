# FastAPI Background Sync Client for Frappe ERP Bridge
import requests
import logging
from typing import Dict, Any, Optional
from sqlalchemy.orm import Session
from app.core.config import settings
from app.models.models import AttendanceSession, AttendanceRecord, Student

logger = logging.getLogger("snist_erp.frappe_sync_client")

def sync_session_to_frappe(
    db: Session,
    session_id: int,
    frappe_url: Optional[str] = None,
    api_key: Optional[str] = None,
    api_secret: Optional[str] = None
) -> Dict[str, Any]:
    """
    Defensively syncs a locked attendance session from FastAPI DB to Frappe ERP.
    """
    try:
        session = db.query(AttendanceSession).filter(AttendanceSession.id == session_id).first()
        if not session:
            return {"status": "ERROR", "detail": f"Session ID {session_id} not found."}

        records = db.query(AttendanceRecord, Student).join(
            Student, AttendanceRecord.student_id == Student.id
        ).filter(AttendanceRecord.session_id == session_id).all()

        sync_records = []
        for att, student in records:
            sync_records.append({
                "student_sap_id": student.roll_number,  # Roll number / SAP ID mapping
                "roll_number": student.roll_number,
                "status": "Present" if att.status.value == "PRESENT" else "Absent",
                "scan_mode": "STUDENT_QR_SCAN"
            })

        payload = {
            "session_date": str(session.session_date),
            "period_number": 1,
            "teaching_assignment": f"STA-SEC{session.section_id}-SUBJ{session.subject_id}-2026",
            "created_by_sap_id": f"FAC{session.teacher_id}",
            "session_type": str(getattr(session, 'session_type', 'SCHEDULED')),
            "records": sync_records
        }

        target_url = frappe_url or getattr(settings, "FRAPPE_URL", "http://localhost:8000") + "/api/method/snist_erp.snist_erp.api.sync_attendance_session"
        headers = {
            "Content-Type": "application/json"
        }
        if api_key and api_secret:
            headers["Authorization"] = f"token {api_key}:{api_secret}"

        # Send request with 5s timeout to prevent thread blocking
        response = requests.post(target_url, json={"payload": payload}, headers=headers, timeout=5)
        
        if response.status_code == 200:
            res_data = response.json().get("message", {})
            logger.info(f"Successfully synced Session {session_id} to Frappe ERP: {res_data}")
            return {"status": "SUCCESS", "response": res_data}
        else:
            logger.warning(f"Frappe sync returned non-200 status {response.status_code}: {response.text}")
            return {"status": "SYNC_FAILED", "status_code": response.status_code, "detail": response.text}

    except Exception as err:
        logger.error(f"Defensive error during Frappe ERP attendance sync for session {session_id}: {err}", exc_info=True)
        return {
            "status": "ERROR",
            "detail": f"Frappe ERP network sync failed gracefully: {str(err)}"
        }
