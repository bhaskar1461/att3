# DocType class for SNIST Teaching Assignment
import logging

try:
    import frappe
    from frappe.model.document import Document
except ImportError:
    # Graceful fallback when running standalone outside Frappe app context
    class Document:
        pass
    frappe = None

logger = logging.getLogger("snist_erp.doctypes.teaching_assignment")

class SNISTTeachingAssignment(Document):
    def validate(self):
        """Enforces defensive validation rules on Teaching Assignment."""
        if frappe is None:
            return

        try:
            if not self.assignment_name:
                self.assignment_name = f"{self.student_group} - {self.course}"
            
            # Fetch instructor SAP ID if missing
            if self.instructor and not self.instructor_sap_id:
                sap_id = frappe.db.get_value("Instructor", self.instructor, "custom_sap_id")
                if sap_id:
                    self.instructor_sap_id = sap_id
        except Exception as err:
            logger.error(f"Error validating SNISTTeachingAssignment: {err}", exc_info=True)
            # Log diagnostic warning without silently failing or corrupting data
