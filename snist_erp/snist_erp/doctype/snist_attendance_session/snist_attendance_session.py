# DocType class for SNIST Attendance Session
import logging
from datetime import datetime

try:
    import frappe
    from frappe.model.document import Document
except ImportError:
    class Document:
        pass
    frappe = None

logger = logging.getLogger("snist_erp.doctypes.attendance_session")

class SNISTAttendanceSession(Document):
    def validate(self):
        """Enforces defensive validation rules on SNIST Attendance Session."""
        if frappe is None:
            return

        try:
            # Stamp server IST time if missing
            now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            if not self.created_at_ist:
                self.created_at_ist = now_str
                
            if self.status == "LOCKED" and not self.locked_at_ist:
                self.locked_at_ist = now_str
        except Exception as err:
            logger.error(f"Error validating SNISTAttendanceSession: {err}", exc_info=True)
