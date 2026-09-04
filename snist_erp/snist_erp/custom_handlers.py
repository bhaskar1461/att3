# Custom validation handlers for Frappe DocEvents
import logging

try:
    import frappe
except ImportError:
    frappe = None

logger = logging.getLogger("snist_erp.custom_handlers")

def validate_student_sap_id(doc, method=None):
    """Enforces SAP ID validation for Student DocType."""
    if frappe is None:
        return

    try:
        if not doc.get("custom_sap_id"):
            frappe.throw("SNIST SAP ID is mandatory for all Student records.")

        sap_id = doc.get("custom_sap_id").strip().upper()
        doc.custom_sap_id = sap_id

        # Check uniqueness defensively
        existing = frappe.db.get_value("Student", {"custom_sap_id": sap_id, "name": ["!=", doc.name]}, "name")
        if existing:
            frappe.throw(f"Student record with SAP ID '{sap_id}' already exists ({existing}).")
    except Exception as err:
        logger.error(f"Error validating Student SAP ID for {doc.name}: {err}", exc_info=True)

def validate_instructor_sap_id(doc, method=None):
    """Enforces SAP ID validation for Instructor DocType."""
    if frappe is None:
        return

    try:
        if not doc.get("custom_sap_id"):
            frappe.throw("SNIST SAP ID is mandatory for all Instructor records.")

        sap_id = doc.get("custom_sap_id").strip().upper()
        doc.custom_sap_id = sap_id

        existing = frappe.db.get_value("Instructor", {"custom_sap_id": sap_id, "name": ["!=", doc.name]}, "name")
        if existing:
            frappe.throw(f"Instructor record with SAP ID '{sap_id}' already exists ({existing}).")
    except Exception as err:
        logger.error(f"Error validating Instructor SAP ID for {doc.name}: {err}", exc_info=True)
