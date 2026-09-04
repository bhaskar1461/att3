# DocType class for SNIST Period
import logging

try:
    import frappe
    from frappe.model.document import Document
except ImportError:
    class Document:
        pass
    frappe = None

logger = logging.getLogger("snist_erp.doctypes.period")

class SNISTPeriod(Document):
    def validate(self):
        """Enforces defensive validation rules on SNIST Period."""
        if frappe is None:
            return

        try:
            if self.period_number and not self.period_name:
                self.period_name = f"Period {self.period_number}"
            
            # Period number bound check (1-8)
            if self.period_number < 1 or self.period_number > 8:
                frappe.throw("Period number must be between 1 and 8.")
        except Exception as err:
            logger.error(f"Error validating SNISTPeriod: {err}", exc_info=True)
