"""
SNIST ERP AI QR-Attendance System
Module: gsheet_reconciliation_service.py
Phase 10 Production Capability

Autonomous Bi-Directional Attendance & Roster Reconciliation Engine:
1. Auto-provisions students present in Google Sheet but missing in App DB,
   enrolling them in the class section and dispatching onboarding credentials + magic login link.
2. Reconciles past attendance marked Present in Google Sheet but missing/absent in App DB (Sheet -> App).
3. Repairs attendance marked Present in App DB but missing/absent in Google Sheet (App -> Sheet),
   recalculating =SUM() cumulative total formulas.
4. Returns structured audit telemetry for faculty/admin review.
"""

import os
import re
import logging
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime
from collections import defaultdict
from sqlalchemy.orm import Session, joinedload

from app.models.models import (
    TeacherAssignment, Section, Subject, Teacher, Student, User, UserRole,
    AttendanceSession, AttendanceRecord, AttendanceStatus, SessionStatus, AuditLog
)
from app.core.config import settings
from app.core.security import get_password_hash, create_magic_login_token, get_server_ist_datetime
from app.services.gsheets_service import GoogleSheetsService
from app.services.email_service import send_single_email, render_email_template

logger = logging.getLogger("snist_erp.gsheet_reconciliation")


class GSheetReconciliationService:

    @staticmethod
    def _normalize_header_date(date_str: Any) -> Optional[Tuple[str, str]]:
        """
        Normalizes a sheet header date cell into (iso_date_YYYY_MM_DD, display_date_D_M_YY).
        Returns None if not a valid calendar date header.
        """
        s = str(date_str).strip()
        if not s or any(kw in s.upper() for kw in ["TOTAL", "CUMULATIVE", "ROLL", "NAME", "SECTION", "GENDER", "SNO", "S.NO"]):
            return None

        # Clean any trailing periods or whitespace
        s = re.sub(r'[\r\n\t]+', ' ', s).strip()

        # Try parsing standard formats
        for fmt in ["%d/%m/%Y", "%d/%m/%y", "%d-%m-%Y", "%d-%m-%y", "%Y-%m-%d", "%m/%d/%Y"]:
            try:
                dt = datetime.strptime(s, fmt)
                iso = dt.strftime("%Y-%m-%d")
                disp = f"{dt.day}/{dt.month}/{str(dt.year)[-2:]}"
                return (iso, disp)
            except ValueError:
                continue

        # Manual split fallback e.g. "16/9" or "16/9/26"
        parts = s.replace("-", "/").split("/")
        if len(parts) >= 2:
            try:
                day = int(parts[0])
                month = int(parts[1])
                year = int(parts[2]) if len(parts) > 2 else 2026
                if year < 100:
                    year += 2000
                dt = datetime(year, month, day)
                iso = dt.strftime("%Y-%m-%d")
                disp = f"{day}/{month}/{str(year)[-2:]}"
                return (iso, disp)
            except Exception:
                pass

        return None

    @classmethod
    def reconcile_class_assignment(
        cls,
        db: Session,
        assignment_id: int,
        target_sheet_id: Optional[str] = None,
        notify_students: bool = True
    ) -> Dict[str, Any]:
        """
        Executes complete bi-directional reconciliation for a TeacherAssignment.
        """
        assignment = db.query(TeacherAssignment).options(
            joinedload(TeacherAssignment.section),
            joinedload(TeacherAssignment.subject),
            joinedload(TeacherAssignment.teacher)
        ).filter(TeacherAssignment.id == assignment_id).first()

        if not assignment:
            raise ValueError(f"TeacherAssignment with id {assignment_id} not found.")

        section = assignment.section
        subject = assignment.subject
        teacher = assignment.teacher

        if not section:
            raise ValueError(f"No Section mapped to assignment id {assignment_id}.")

        # 1. Resolve spreadsheet ID
        sp_id = (target_sheet_id or "").strip()
        if not sp_id:
            sp_id = assignment.google_sheet_id or (teacher.google_sheet_id if teacher else None) or ""

        # Extract ID from full URL if pasted
        if "spreadsheets/d/" in sp_id:
            m = re.search(r'/spreadsheets/d/([a-zA-Z0-9-_]+)', sp_id)
            if m:
                sp_id = m.group(1)

        if not sp_id:
            raise ValueError("No Google Sheet ID configured for this class or faculty member.")

        # Persist sheet ID to assignment if updated
        if assignment.google_sheet_id != sp_id:
            assignment.google_sheet_id = sp_id
            db.commit()

        # 2. Authorize and load sheet
        creds_file = settings.GOOGLE_CREDENTIALS_FILE or os.path.join(settings.BACKEND_DIR, "credentials.json")
        client = GoogleSheetsService._get_client(creds_file)
        spreadsheet = GoogleSheetsService._open_spreadsheet(client, sp_id)
        worksheet = GoogleSheetsService._get_worksheet(spreadsheet, section_name=section.name)

        vals = GoogleSheetsService._read_worksheet_values(worksheet)
        if len(vals) < 6:
            raise ValueError("Google Sheet has insufficient rows (expected SNIST layout headers).")

        # 3. Dynamically discover Header Row & Columns
        header_r_0idx = -1
        roll_c_0idx = 1
        name_c_0idx = 2
        agency_c_0idx = 3

        for r_i, r_data in enumerate(vals[:10]):
            for c_i, cell in enumerate(r_data):
                if "ROLL" in str(cell).upper():
                    header_r_0idx = r_i
                    roll_c_0idx = c_i
                    break
            if header_r_0idx != -1:
                break

        if header_r_0idx == -1:
            header_r_0idx = 5  # Standard SNIST row 6 (0-indexed 5)

        headers = vals[header_r_0idx]
        student_start_r_0idx = header_r_0idx + 1

        # Check Col C/D for Name and Agency
        if len(headers) > roll_c_0idx + 1 and "NAME" in str(headers[roll_c_0idx + 1]).upper():
            name_c_0idx = roll_c_0idx + 1
        if len(headers) > roll_c_0idx + 2 and any(k in str(headers[roll_c_0idx + 2]).upper() for k in ["GEN", "CAT", "AGENCY"]):
            agency_c_0idx = roll_c_0idx + 2

        # 4. Locate Total / Cumulative Column
        total_c_0idx = -1
        for c_idx in range(roll_c_0idx + 1, len(headers)):
            for r_check in range(header_r_0idx + 1):
                if c_idx < len(vals[r_check]):
                    val_str = str(vals[r_check][c_idx]).strip().lower()
                    if "total" in val_str or "cumulative" in val_str:
                        total_c_0idx = c_idx
                        break
            if total_c_0idx != -1:
                break

        if total_c_0idx == -1:
            total_c_0idx = len(headers)

        # 5. Map Date Columns (Between metadata cols and Total col)
        date_columns: Dict[int, Dict[str, str]] = {}
        for c_idx in range(agency_c_0idx + 1, total_c_0idx):
            # Check current header row, and previous row if merged
            header_val = headers[c_idx] if c_idx < len(headers) else ""
            parsed = cls._normalize_header_date(header_val)
            if not parsed and header_r_0idx > 0 and c_idx < len(vals[header_r_0idx - 1]):
                parsed = cls._normalize_header_date(vals[header_r_0idx - 1][c_idx])

            if parsed:
                date_columns[c_idx] = {
                    "iso_date": parsed[0],
                    "display_date": parsed[1]
                }

        # 6. Parse Roster & Auto-Provision Missing Students
        students_in_sheet: Dict[str, Dict[str, Any]] = {}
        provisioned_students: List[Dict[str, Any]] = []
        credentials_dispatched: List[str] = []

        # Determine department email domain
        dept_code = "snist"
        if section.department:
            dept_code = section.department.code.lower()
        elif section.name and "IT" in section.name.upper():
            dept_code = "it"
        elif section.name and "CSE" in section.name.upper():
            dept_code = "cse"

        app_url = getattr(settings, "APP_URL", "https://ather-os.de5.net")

        for r_idx in range(student_start_r_0idx, len(vals)):
            row = vals[r_idx]
            if len(row) <= roll_c_0idx:
                continue

            roll = str(row[roll_c_0idx]).strip().upper()
            if not roll or any(kw in roll for kw in ["ROLL", "TOTAL", "SNO", "S.NO", "NAME", "REGULAR"]):
                continue

            st_name = str(row[name_c_0idx]).strip() if len(row) > name_c_0idx and row[name_c_0idx] else f"Student {roll}"
            st_agency = str(row[agency_c_0idx]).strip() if len(row) > agency_c_0idx and row[agency_c_0idx] else "Regular"

            students_in_sheet[roll] = {
                "row_0idx": r_idx,
                "name": st_name,
                "agency": st_agency,
                "row_values": row
            }

            # Check if student exists in App DB
            student = db.query(Student).filter(Student.roll_number == roll).first()
            if not student:
                # A. Provision User account
                user = db.query(User).filter(User.username == roll).first()
                target_email = f"{roll.lower()}@{dept_code}.sreenidhi.edu.in"
                if not user:
                    user = User(
                        username=roll,
                        email=target_email,
                        password_hash=get_password_hash("123456"),
                        role=UserRole.STUDENT,
                        is_active=True,
                        must_change_password=False
                    )
                    db.add(user)
                    db.flush()

                # B. Provision Student profile
                student = Student(
                    user_id=user.id,
                    roll_number=roll,
                    name=st_name,
                    department_id=section.department_id,
                    academic_year_id=section.academic_year_id,
                    section_id=section.id,
                    email=user.email,
                    agency=st_agency,
                    registered_device_id=None
                )
                db.add(student)
                db.flush()

                provisioned_students.append({
                    "roll_number": roll,
                    "name": st_name,
                    "email": user.email,
                    "section": section.name
                })

                # C. Generate Magic Token & Dispatch Credentials Email
                if notify_students:
                    try:
                        magic_token = create_magic_login_token(username=roll, role="STUDENT", expires_days=30)
                        magic_link = f"{app_url}/login?magic_token={magic_token}"

                        template_ctx = {
                            "name": st_name,
                            "sap_id": roll,
                            "temp_password": "PIN: 123456",
                            "magic_link": magic_link,
                            "portal_url": f"{app_url}/login",
                            "class_name": subject.name if subject else "Assigned Course",
                            "department": section.department.name if section.department else dept_code.upper(),
                            "section": section.name,
                            "class_timings": "Next Scheduled Class Session"
                        }
                        html_body = render_email_template("student_credentials_email.html", template_ctx)
                        send_res = send_single_email(
                            to_email=user.email,
                            subject=f"SNIST Attendance — Your Account Credentials ({roll})",
                            html_body=html_body,
                            channel="LOGIN"
                        )
                        if send_res.get("status") in ("SENT", "FALLBACK_SENT"):
                            credentials_dispatched.append(roll)
                    except Exception as email_err:
                        logger.warning(f"Credentials dispatch error for {roll} ({user.email}): {email_err}")
            else:
                # Ensure section assignment is aligned with class
                if student.section_id != section.id:
                    student.section_id = section.id
                if student.name != st_name and not student.name.startswith("Student "):
                    pass
                else:
                    student.name = st_name

        db.flush()

        # 7. Bi-Directional Attendance Reconciliation
        # Fetch all sessions for this section (and subject)
        sessions = db.query(AttendanceSession).filter(
            AttendanceSession.section_id == section.id,
            AttendanceSession.subject_id == subject.id
        ).all()
        sessions_by_date: Dict[str, List[AttendanceSession]] = defaultdict(list)
        for s in sessions:
            sessions_by_date[s.session_date].append(s)

        sheet_to_app_reconciled: List[Dict[str, Any]] = []
        app_to_sheet_reconciled: List[Dict[str, Any]] = []
        sheet_cell_updates: List[Dict[str, Any]] = []

        # Cache students map
        student_records_map = {
            s.roll_number: s
            for s in db.query(Student).filter(Student.section_id == section.id).all()
        }

        # --- DIRECTION 1: Sheet -> App Backfill ---
        for c_idx, date_meta in date_columns.items():
            iso_date = date_meta["iso_date"]
            disp_date = date_meta["display_date"]
            matching_sessions = sessions_by_date.get(iso_date, [])

            # Check if any student in sheet has attendance recorded on this date
            has_present_in_sheet = any(
                str(students_in_sheet[r]["row_values"][c_idx]).strip().upper() in ["1", "2", "3", "4", "5", "6", "7", "8"]
                for r in students_in_sheet
                if c_idx < len(students_in_sheet[r]["row_values"])
            )

            # If no session exists in DB for this date but sheet has marks, create a completed historical session
            if not matching_sessions and has_present_in_sheet:
                hist_session = AttendanceSession(
                    teacher_id=assignment.teacher_id,
                    subject_id=assignment.subject_id,
                    section_id=section.id,
                    period="Period 1-4 (4 Periods)",
                    session_date=iso_date,
                    status=SessionStatus.LOCKED
                )
                db.add(hist_session)
                db.flush()
                matching_sessions = [hist_session]
                sessions_by_date[iso_date] = [hist_session]

            for session in matching_sessions:
                existing_records = {
                    (r.roll_number or "").strip().upper(): r
                    for r in session.records
                }

                for roll, st_info in students_in_sheet.items():
                    row = st_info["row_values"]
                    cell_val = str(row[c_idx]).strip().upper() if c_idx < len(row) else ""

                    if cell_val in ["1", "2", "3", "4", "5", "6", "7", "8"]:
                        p_count = int(cell_val)
                        st_obj = student_records_map.get(roll) or db.query(Student).filter(Student.roll_number == roll).first()
                        if not st_obj:
                            continue

                        if roll not in existing_records:
                            # Missing in App! Backfill
                            new_rec = AttendanceRecord(
                                session_id=session.id,
                                student_id=st_obj.id,
                                roll_number=roll,
                                session_date=session.session_date,
                                period_count=p_count,
                                status=AttendanceStatus.PRESENT,
                                scan_mode="GSHEET_RECONCILIATION",
                                manual_reason="gsheet_sync_reconciled",
                                manual_reason_detail=f"Reconciled from Google Sheet {disp_date} (mark: {cell_val})"
                            )
                            db.add(new_rec)
                            sheet_to_app_reconciled.append({
                                "roll_number": roll,
                                "date": iso_date,
                                "session_id": session.id,
                                "mark": cell_val,
                                "action": "RECORD_CREATED"
                            })
                        elif existing_records[roll].status == AttendanceStatus.ABSENT:
                            # Marked Absent in App, but Present in Sheet! Reconcile
                            rec = existing_records[roll]
                            rec.status = AttendanceStatus.PRESENT
                            rec.period_count = p_count
                            rec.manual_reason = "gsheet_sync_reconciled"
                            rec.manual_reason_detail = f"Reconciled from Google Sheet {disp_date} (mark: {cell_val})"
                            sheet_to_app_reconciled.append({
                                "roll_number": roll,
                                "date": iso_date,
                                "session_id": session.id,
                                "mark": cell_val,
                                "action": "STATUS_UPDATED"
                            })

        # --- DIRECTION 2: App -> Sheet Repair ---
        for c_idx, date_meta in date_columns.items():
            iso_date = date_meta["iso_date"]
            disp_date = date_meta["display_date"]
            matching_sessions = sessions_by_date.get(iso_date, [])

            for session in matching_sessions:
                for rec in session.records:
                    if rec.status == AttendanceStatus.PRESENT:
                        roll = (rec.roll_number or "").strip().upper()
                        if roll in students_in_sheet:
                            st_info = students_in_sheet[roll]
                            row = st_info["row_values"]
                            cell_val = str(row[c_idx]).strip().upper() if c_idx < len(row) else ""

                            if cell_val in ["A", "ABSENT", "", "0"]:
                                p_mark = str(rec.period_count or 4)
                                row_num = st_info["row_0idx"] + 1  # 1-indexed for gspread
                                col_letter = GoogleSheetsService._col_to_letter(c_idx + 1)
                                cell_a1 = f"{col_letter}{row_num}"

                                sheet_cell_updates.append({
                                    "range": cell_a1,
                                    "val": p_mark,
                                    "row_0idx": st_info["row_0idx"],
                                    "col_0idx": c_idx
                                })
                                app_to_sheet_reconciled.append({
                                    "roll_number": roll,
                                    "date": disp_date,
                                    "cell": cell_a1,
                                    "repaired_value": p_mark
                                })

        # 8. Apply App -> Sheet Cell Updates and Recalculate Formulas (Single Atomic Write)
        if sheet_cell_updates:
            try:
                # Update cells in memory grid
                for u in sheet_cell_updates:
                    r_idx = u["row_0idx"]
                    c_idx = u["col_0idx"]
                    while len(vals[r_idx]) <= c_idx:
                        vals[r_idx].append("")
                    vals[r_idx][c_idx] = u["val"]

                # Recalculate Total column =SUM() formulas in memory grid
                if total_c_0idx != -1 and date_columns:
                    first_date_letter = GoogleSheetsService._col_to_letter(min(date_columns.keys()) + 1)
                    last_date_letter = GoogleSheetsService._col_to_letter(max(date_columns.keys()) + 1)
                    for r_idx in range(student_start_r_0idx, len(vals)):
                        row_num = r_idx + 1
                        while len(vals[r_idx]) <= total_c_0idx:
                            vals[r_idx].append("")
                        roll = str(vals[r_idx][roll_c_0idx]).strip() if len(vals[r_idx]) > roll_c_0idx else ""
                        if roll and not roll.startswith("*"):
                            vals[r_idx][total_c_0idx] = f"=SUM({first_date_letter}{row_num}:{last_date_letter}{row_num})"

                # Single atomic update across the worksheet
                GoogleSheetsService._update_worksheet_values(
                    worksheet=worksheet,
                    values=vals,
                    range_name="A1",
                    value_input_option="USER_ENTERED"
                )
            except Exception as sheet_upd_err:
                logger.error(f"Error applying App->Sheet updates to Google Sheet: {sheet_upd_err}", exc_info=True)

        # 9. Audit Logging
        ist_now = get_server_ist_datetime()
        total_divergences = len(provisioned_students) + len(sheet_to_app_reconciled) + len(app_to_sheet_reconciled)

        audit_entry = AuditLog(
            user_id=teacher.user_id if teacher else None,
            action="GSHEET_BI_DIRECTIONAL_RECONCILIATION",
            details=(
                f"Reconciled class '{subject.name}' [{section.name}] (Sheet: {sp_id}): "
                f"+{len(provisioned_students)} students provisioned ({len(credentials_dispatched)} notified), "
                f"+{len(sheet_to_app_reconciled)} Sheet->App marks, "
                f"+{len(app_to_sheet_reconciled)} App->Sheet repairs. "
                f"Total students: {len(students_in_sheet)}"
            ),
            created_at=datetime.utcnow()
        )
        db.add(audit_entry)
        db.commit()

        return {
            "status": "SUCCESS",
            "message": (
                f"Reconciliation Complete: {len(provisioned_students)} new students provisioned, "
                f"{len(sheet_to_app_reconciled)} sheet attendance marks recovered, "
                f"{len(app_to_sheet_reconciled)} sheet attendance marks repaired."
            ),
            "summary": {
                "total_students_in_sheet": len(students_in_sheet),
                "new_students_provisioned": len(provisioned_students),
                "credentials_dispatched": len(credentials_dispatched),
                "sheet_to_app_reconciled": len(sheet_to_app_reconciled),
                "app_to_sheet_reconciled": len(app_to_sheet_reconciled),
                "total_discrepancies_resolved": total_divergences,
                "section_name": section.name,
                "subject_name": subject.name if subject else "",
                "google_sheet_id": sp_id
            },
            "details": {
                "provisioned_students": provisioned_students,
                "sheet_to_app_records": sheet_to_app_reconciled,
                "app_to_sheet_records": app_to_sheet_reconciled
            }
        }
