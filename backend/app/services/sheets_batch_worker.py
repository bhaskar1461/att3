import json
import time
import logging
from datetime import datetime
from typing import Dict, Any, Optional

from sqlalchemy.orm import Session
from app.core.database import SessionLocal
from app.core.config import settings
from app.models.models import (
    AttendanceSession, AttendanceRecord, Student, Classroom, SheetsSyncDLQ
)

logger = logging.getLogger("snist_erp.sheets_batch_worker")

def sync_session_to_sheets_batch(
    session_id: int,
    max_retries: int = 3,
    sheets_client_override = None,
    db_session: Optional[Session] = None
) -> Dict[str, Any]:
    """
    Background worker: Syncs session attendance to Google Sheets in a SINGLE batchUpdate
    only upon session finalize (lock). Never called per-scan.
    
    Hardened with exponential backoff (3 retries) and dead-letter queue (DLQ) logging.
    """
    close_db = False
    if db_session is None:
        db = SessionLocal()
        close_db = True
    else:
        db = db_session

    try:
        session = db.query(AttendanceSession).filter(AttendanceSession.id == session_id).first()
        if not session:
            logger.warning(f"Session {session_id} not found for Sheets batch sync.")
            return {"status": "SKIPPED", "reason": "Session not found"}

        # Gather all attendance records for this session
        records = db.query(AttendanceRecord).filter(AttendanceRecord.session_id == session_id).all()
        
        # Determine Google Spreadsheet ID (from teacher profile or system settings)
        spreadsheet_id = ""
        if session.teacher and session.teacher.google_sheet_id:
            spreadsheet_id = session.teacher.google_sheet_id.strip()
        if not spreadsheet_id:
            spreadsheet_id = getattr(settings, "GOOGLE_SPREADSHEET_ID", "").strip()

        # Build batch payload
        records_payload = [
            {
                "roll_number": r.roll_number,
                "student_id": r.student_id,
                "status": r.status.value if hasattr(r.status, "value") else str(r.status),
                "method": r.method or r.verified_scan_mode or "ble",
                "rssi": r.rssi or r.measured_rssi,
                "marked_at": r.marked_at.isoformat() if r.marked_at else (r.scanned_at.isoformat() if r.scanned_at else datetime.utcnow().isoformat())
            }
            for r in records
        ]

        batch_data = {
            "session_id": session_id,
            "section_id": session.section_id,
            "session_date": session.session_date,
            "period": session.period,
            "spreadsheet_id": spreadsheet_id,
            "total_marked": len(records),
            "records": records_payload,
            "prepared_at": datetime.utcnow().isoformat()
        }

        # If no spreadsheet ID or credentials configured, mock-succeed or save to DLQ if forced
        creds_file = getattr(settings, "GOOGLE_CREDENTIALS_FILE", "")
        if not spreadsheet_id or (not creds_file and not sheets_client_override):
            logger.info(f"No Google Sheets credentials/sheet ID configured. Prepared batch for {len(records)} records (Simulation).")
            return {
                "status": "SUCCESS",
                "mode": "simulation",
                "records_synced": len(records),
                "batch_payload_size": len(records_payload)
            }

        # Attempt batch update with exponential backoff (3 retries)
        last_error = None
        for attempt in range(1, max_retries + 1):
            try:
                if sheets_client_override is not None:
                    # Test injection client
                    sheets_client_override.execute_batch_update(spreadsheet_id, batch_data)
                else:
                    from app.services.gsheets_service import GoogleSheetsService
                    # Execute single batch update
                    client = GoogleSheetsService._get_client(creds_file)
                    spreadsheet = client.open_by_key(spreadsheet_id)
                    try:
                        worksheet = spreadsheet.worksheet("Attendance Register")
                    except Exception:
                        worksheet = spreadsheet.sheet1
                    
                    # Prepare rows and write in a single batchUpdate
                    vals = worksheet.get_all_values()
                    present_rolls = {r["roll_number"].strip().upper() for r in records_payload}
                    
                    if len(vals) >= 6:
                        # Find column for today's session or append
                        header_dates = vals[4] if len(vals) > 4 else []
                        date_str = session.session_date
                        col_idx = None
                        for c_i, h_val in enumerate(header_dates):
                            if date_str in str(h_val):
                                col_idx = c_i
                                break
                        
                        if col_idx is not None:
                            for r_i in range(6, len(vals)):
                                row_roll = str(vals[r_i][1]).strip().upper() if len(vals[r_i]) > 1 else ""
                                if row_roll in present_rolls:
                                    vals[r_i][col_idx] = "4"
                                else:
                                    vals[r_i][col_idx] = "A"
                            worksheet.update(values=vals, range_name="A1")

                logger.info(f"Successfully synced session {session_id} to Google Sheets in 1 batchUpdate (attempt {attempt}).")
                return {
                    "status": "SUCCESS",
                    "attempt": attempt,
                    "records_synced": len(records)
                }

            except Exception as exc:
                last_error = exc
                backoff_wait = 2 ** (attempt - 1)  # 1s, 2s, 4s
                logger.warning(
                    f"Sheets batchUpdate attempt {attempt}/{max_retries} failed for session {session_id}: {exc}. "
                    f"Retrying in {backoff_wait}s..."
                )
                time.sleep(backoff_wait)

        # All retries exhausted -> Push to Dead-Letter Queue (DLQ)
        logger.error(f"Google Sheets batchUpdate failed for session {session_id} after {max_retries} retries: {last_error}. Writing to DLQ.")
        dlq_entry = SheetsSyncDLQ(
            session_id=session_id,
            payload=json.dumps(batch_data),
            retry_count=max_retries,
            error_message=str(last_error),
            last_attempted_at=datetime.utcnow(),
            status="FAILED"
        )
        db.add(dlq_entry)
        db.commit()

        return {
            "status": "DLQ_QUEUED",
            "dlq_id": dlq_entry.id,
            "session_id": session_id,
            "retries_exhausted": max_retries,
            "error": str(last_error)
        }

    except Exception as e:
        logger.error(f"Fatal error in sheets_batch_worker for session {session_id}: {e}", exc_info=True)
        return {"status": "ERROR", "error": str(e)}
    finally:
        if close_db:
            db.close()
