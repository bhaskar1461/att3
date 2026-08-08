# Frappe Hybrid Synchronization REST API Endpoint for Attendance Engine
import json
import logging
from datetime import datetime

try:
    import frappe
except ImportError:
    frappe = None

logger = logging.getLogger("snist_erp.sync_api")

@frappe.whitelist(allow_guest=False) if frappe else lambda f: f
def sync_attendance_session(payload=None):
    """
    Whitelisted REST endpoint called by FastAPI Attendance Engine upon locking a session.
    
    Payload Structure:
    {
        "session_date": "2026-08-08",
        "period_number": 1,
        "teaching_assignment": "STA-CSE-3A-CS301-2026",
        "created_by_sap_id": "FAC101",
        "session_type": "SCHEDULED",
        "records": [
            {
                "student_sap_id": "STU21001",
                "roll_number": "21CS001",
                "status": "Present",
                "scan_mode": "STUDENT_QR_SCAN"
            }
        ]
    }
    """
    if frappe is None:
        return {"status": "ERROR", "detail": "Missing Frappe environment runtime."}

    try:
        if isinstance(payload, str):
            payload = json.loads(payload)
            
        if not payload:
            frappe.response["http_status_code"] = 400
            return {"status": "ERROR", "detail": "Missing attendance session sync payload."}

        session_date = payload.get("session_date")
        period_number = payload.get("period_number", 1)
        teaching_assignment = payload.get("teaching_assignment")
        created_by_sap_id = payload.get("created_by_sap_id")
        session_type = payload.get("session_type", "SCHEDULED")
        records = payload.get("records", [])

        if not session_date or not teaching_assignment or not created_by_sap_id:
            frappe.response["http_status_code"] = 400
            return {"status": "ERROR", "detail": "Missing mandatory fields (session_date, teaching_assignment, created_by_sap_id)"}

        # Resolve period link
        period_name = f"PERIOD-{period_number}"
        if not frappe.db.exists("SNIST Period", period_name):
            p_doc = frappe.get_doc({
                "doctype": "SNIST Period",
                "period_number": period_number,
                "period_name": f"Period {period_number}",
                "from_time": "09:30:00",
                "to_time": "10:20:00"
            })
            p_doc.insert(ignore_permissions=True)

        # Create or fetch Attendance Session
        session_name = f"SAS-{session_date}-P{period_number}-{teaching_assignment}"
        if frappe.db.exists("SNIST Attendance Session", session_name):
            session_doc = frappe.get_doc("SNIST Attendance Session", session_name)
        else:
            session_doc = frappe.get_doc({
                "doctype": "SNIST Attendance Session",
                "teaching_assignment": teaching_assignment,
                "session_date": session_date,
                "period": period_name,
                "status": "LOCKED",
                "session_type": session_type,
                "created_by_sap_id": created_by_sap_id,
                "created_at_ist": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "locked_at_ist": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            })
            session_doc.insert(ignore_permissions=True)

        synced_count = 0
        for r in records:
            student_sap_id = r.get("student_sap_id")
            status = r.get("status", "Present")
            scan_mode = r.get("scan_mode", "STUDENT_QR_SCAN")

            # Resolve student record
            student_link = frappe.db.get_value("Student", {"custom_sap_id": student_sap_id}, "name")
            if not student_link:
                logger.warning(f"Student SAP ID {student_sap_id} not found in Frappe database during sync.")
                continue

            # Create or update Student Attendance
            att_doc = frappe.get_doc({
                "doctype": "Student Attendance",
                "student": student_link,
                "custom_student_sap_id": student_sap_id,
                "date": session_date,
                "status": status,
                "custom_scan_mode": scan_mode,
                "custom_attendance_session": session_doc.name
            })
            att_doc.insert(ignore_permissions=True)
            synced_count += 1

        session_doc.status = "LOCKED"
        session_doc.synced_attendance_count = synced_count
        session_doc.save(ignore_permissions=True)

        return {
            "status": "SUCCESS",
            "session_name": session_doc.name,
            "synced_records": synced_count,
            "message": f"Successfully synchronized {synced_count} student attendance records to Frappe ERP."
        }

    except Exception as sync_err:
        logger.error(f"Error in sync_attendance_session REST API: {sync_err}", exc_info=True)
        if frappe:
            frappe.response["http_status_code"] = 500
        return {
            "status": "ERROR",
            "detail": f"Synchronization failure: {str(sync_err)}"
        }
