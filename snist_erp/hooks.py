# Frappe Custom App Hooks for SNIST Student ERP
app_name = "snist_erp"
app_title = "SNIST Student ERP"
app_publisher = "SNIST Core Team"
app_description = "Frappe Education Extension and Custom DocTypes for SNIST Student ERP"
app_email = "admin@sreenidhi.edu.in"
app_license = "mit"

# Includes in header
# app_include_css = "/assets/snist_erp/css/snist_erp.css"
# app_include_js = "/assets/snist_erp/js/snist_erp.js"

# DocType Events / Overrides
doc_events = {
    "Student": {
        "validate": "snist_erp.snist_erp.custom_handlers.validate_student_sap_id"
    },
    "Instructor": {
        "validate": "snist_erp.snist_erp.custom_handlers.validate_instructor_sap_id"
    }
}

# Fixtures / Custom Fields installation
fixtures = [
    {
        "dt": "Custom Field",
        "filters": [["name", "in", [
            "Student-custom_sap_id",
            "Student-custom_roll_number",
            "Student-custom_section",
            "Instructor-custom_sap_id",
            "Instructor-custom_department",
            "Student Attendance-custom_student_sap_id",
            "Student Attendance-custom_scan_mode",
            "Student Attendance-custom_attendance_session"
        ]]]
    }
]
