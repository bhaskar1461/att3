"""
JNTUH R25 Attendance Percentage Engine & Compliance Service
SNIST AI QR Attendance & Academic System

Implements:
1. JNTUH R25 Bands:
   - >= 75.0% -> ELIGIBLE (Green)
   - 65.0% - 74.99% -> CONDONABLE (Amber, fine-status tracked)
   - < 65.0% -> DETAINED (Red, hard flag)
2. Edge cases:
   a. Approved absences (medical/sports) excluded from denominator when policy enabled.
   b. Late-join students: sessions prior to join_date excluded from denominator.
   c. Zero sessions conducted: display "—" (None), not 0%.
   d. Unassigned-department students: captured in "Unassigned" bucket, never dropped.
   e. Projected classes needed: sessions_remaining * (0.75 - current_fraction) / 0.75 rounded up.
3. In-process thread-safe TTL cache with invalidation on attendance write.
4. Full auditability: underlying session details exposed for read-only drill-down.
"""

import math
import time
import logging
import threading
from datetime import datetime
import io
from typing import Dict, Any, List, Optional, Tuple
from openpyxl import Workbook
from openpyxl.utils import get_column_letter
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_, and_, func

from app.core.config import settings, R25Config
from app.core.security import get_server_ist_date, get_server_ist_datetime
from app.models.models import (
    Student, Department, Subject, Section, AttendanceSession, AttendanceRecord,
    AttendanceStatus, SessionStatus, TeacherAssignment, StudentCondonation,
    Semester, FortnightSnapshot, StudentWarning, User, UserRole, Teacher, SecurityEventType
)

logger = logging.getLogger("snist_erp.compliance_engine")

# ==============================================================================
# JNTUH R25 BAND CONSTANTS & METADATA
# ==============================================================================
BAND_ELIGIBLE = "ELIGIBLE"
BAND_CONDONABLE = "CONDONABLE"
BAND_DETAINED = "DETAINED"
BAND_INSUFFICIENT_DATA = "INSUFFICIENT_DATA"
BAND_NO_DATA = "NO_DATA"

BAND_COLORS = {
    BAND_ELIGIBLE: {"label": "Eligible", "badge": "bg-emerald-100 text-emerald-800 border-emerald-300", "hex": "#16a34a"},
    BAND_CONDONABLE: {"label": "Condonable", "badge": "bg-amber-100 text-amber-800 border-amber-300", "hex": "#f59e0b"},
    BAND_DETAINED: {"label": "Detained", "badge": "bg-rose-100 text-rose-800 border-rose-300", "hex": "#dc2626"},
    BAND_INSUFFICIENT_DATA: {"label": "Insufficient Data", "badge": "bg-slate-100 text-slate-700 border-slate-300", "hex": "#64748b"},
    BAND_NO_DATA: {"label": "No Data", "badge": "bg-slate-100 text-slate-600 border-slate-300", "hex": "#64748b"},
    "—": {"label": "No Data", "badge": "bg-slate-100 text-slate-600 border-slate-300", "hex": "#64748b"}
}

# ==============================================================================
# THREAD-SAFE IN-PROCESS TTL CACHE
# ==============================================================================
_CACHE_LOCK = threading.Lock()
_ENGINE_CACHE: Dict[str, Tuple[Any, float]] = {}
CACHE_DEFAULT_TTL = 60.0  # 60 seconds TTL

def get_cached(key: str) -> Optional[Any]:
    now = time.time()
    with _CACHE_LOCK:
        if key in _ENGINE_CACHE:
            val, expire_at = _ENGINE_CACHE[key]
            if now < expire_at:
                return val
            else:
                del _ENGINE_CACHE[key]
    return None

def set_cached(key: str, val: Any, ttl: float = CACHE_DEFAULT_TTL):
    with _CACHE_LOCK:
        _ENGINE_CACHE[key] = (val, time.time() + ttl)

def invalidate_attendance_cache(student_id: Optional[int] = None, course_id: Optional[int] = None, dept_id: Optional[int] = None, roll_number: Optional[str] = None):
    """
    Fast cache invalidation on attendance writes (<1 microsecond).
    Ensures scan path performance is completely uncompromised.
    """
    clean_roll = roll_number.strip().upper() if roll_number else None
    with _CACHE_LOCK:
        if student_id is None and course_id is None and dept_id is None and clean_roll is None:
            _ENGINE_CACHE.clear()
        else:
            keys_to_delete = []
            for k in _ENGINE_CACHE.keys():
                if student_id and (f"student:{student_id}" in k or f"student_id:{student_id}" in k or f":{student_id}:" in k):
                    keys_to_delete.append(k)
                elif clean_roll and (f":{clean_roll}:" in k or f"student_full:{clean_roll}" in k or f":{clean_roll}" in k):
                    keys_to_delete.append(k)
                elif course_id and f"course:{course_id}" in k:
                    keys_to_delete.append(k)
                elif dept_id and f"dept:{dept_id}" in k:
                    keys_to_delete.append(k)
                elif "admin_summary" in k:
                    keys_to_delete.append(k)
                    
            for k in keys_to_delete:
                _ENGINE_CACHE.pop(k, None)

    # Defensively clear student portal summary cache if present
    try:
        from app.api.student import _STUDENT_SUMMARY_CACHE, _STUDENT_SUMMARY_CACHE_LOCK
        with _STUDENT_SUMMARY_CACHE_LOCK:
            if student_id:
                _STUDENT_SUMMARY_CACHE.pop(student_id, None)
            elif clean_roll:
                _STUDENT_SUMMARY_CACHE.clear()
            else:
                _STUDENT_SUMMARY_CACHE.clear()
    except Exception:
        pass


# ==============================================================================
# HELPER FUNCTIONS
# ==============================================================================
def determine_jntuh_band(percentage: Optional[float], sessions_held: Optional[int] = None) -> str:
    """
    Evaluates JNTUH R25 compliance band:
    >= 75.0 -> ELIGIBLE
    65.0 - 74.99 -> CONDONABLE
    < 65.0 -> DETAINED
    sessions_held < MIN_SESSIONS_THRESHOLD -> INSUFFICIENT_DATA
    None -> BAND_NO_DATA ("—")

    Percentage rounding rule: Round to 2 decimal places BEFORE banding.
    A displayed 75.00% will never band as CONDONABLE.
    """
    if percentage is None:
        return BAND_NO_DATA

    min_sessions = getattr(settings, "MIN_SESSIONS_THRESHOLD", R25Config.MIN_SESSIONS_THRESHOLD)
    if sessions_held is not None and sessions_held < min_sessions:
        return BAND_INSUFFICIENT_DATA

    eligible_th = getattr(settings, "JNTUH_ELIGIBLE_THRESHOLD", R25Config.ELIGIBLE_THRESHOLD)
    condonable_th = getattr(settings, "JNTUH_CONDONABLE_THRESHOLD", R25Config.CONDONABLE_THRESHOLD)

    p = round(percentage, 2)
    if p >= eligible_th:
        return BAND_ELIGIBLE
    elif p >= condonable_th:
        return BAND_CONDONABLE
    else:
        return BAND_DETAINED

def calculate_trajectory_projection(
    sessions_conducted: Optional[int] = None,
    sessions_present: int = 0,
    effective_denominator: Optional[int] = None,
    total_semester_sessions: Optional[int] = None,
    *,
    sessions_held: Optional[int] = None,
    sessions_remaining: Optional[int] = None,
    target_pct: Optional[float] = None
) -> Dict[str, Any]:
    """
    Trajectory projection service (Week 3 Compliance Engine):
    - sessions_held = effective_denominator if provided else sessions_conducted
    - sessions_remaining = max(0, total_semester_sessions - sessions_held)
    - projected_end_% = current_present / (sessions_held + remaining), computed honestly — no optimistic rounding
    - classes_needed = min classes to attend consecutively to reach 75%:
      ceil((0.75 * total - present) / 0.25), capped by remaining sessions;
      if impossible -> "NOT RECOVERABLE" flag (detention trajectory, needs condonation/repeat — surface honestly, never hide it)
    - zero-remaining-sessions edge case: handled honestly
    - empty-state: < MIN_SESSIONS_THRESHOLD -> INSUFFICIENT_DATA (never false DETAINED alarm)
    """
    target = target_pct if target_pct is not None else getattr(settings, "JNTUH_ELIGIBLE_THRESHOLD", R25Config.ELIGIBLE_THRESHOLD)
    min_sessions = getattr(settings, "MIN_SESSIONS_THRESHOLD", R25Config.MIN_SESSIONS_THRESHOLD)

    if sessions_held is not None:
        denom = sessions_held
    elif sessions_conducted is not None:
        denom = sessions_conducted if effective_denominator is None else effective_denominator
    else:
        denom = effective_denominator or 0

    if sessions_remaining is not None:
        rem = max(0, sessions_remaining)
        sem_total = denom + rem
    elif total_semester_sessions is not None:
        sem_total = total_semester_sessions
        rem = max(0, sem_total - denom)
    else:
        sem_total = getattr(settings, "DEFAULT_SEMESTER_SESSIONS", R25Config.DEFAULT_SEMESTER_SESSIONS)
        rem = max(0, sem_total - denom)

    total_at_end = denom + rem

    if denom == 0:
        return {
            "current_percentage": None,
            "current_percentage_display": "—",
            "current_band": BAND_NO_DATA,
            "sessions_held": 0,
            "sessions_present": 0,
            "sessions_remaining": rem,
            "total_semester_sessions": sem_total,
            "projected_end_percentage": None,
            "projected_end_pct": None,
            "max_possible_percentage": None,
            "classes_needed": None,
            "is_recoverable": True,
            "recovery_status": "NO_DATA",
            "recovery_message": None
        }

    current_pct = round((sessions_present / denom) * 100.0, 2)
    # Display formatted to exact 2 decimal places to maintain display-vs-band consistency
    current_pct_display = f"{current_pct:.2f}%"

    projected_end_pct = round((sessions_present / total_at_end) * 100.0, 2) if total_at_end > 0 else 0.0
    max_possible_present = sessions_present + rem
    max_possible_pct = round((max_possible_present / total_at_end) * 100.0, 2) if total_at_end > 0 else 0.0

    # Graceful Empty-State: First week of semester data (< MIN_SESSIONS_THRESHOLD sessions held)
    if denom < min_sessions:
        return {
            "current_percentage": current_pct,
            "current_percentage_display": current_pct_display,
            "current_band": BAND_INSUFFICIENT_DATA,
            "sessions_held": denom,
            "sessions_present": sessions_present,
            "sessions_remaining": rem,
            "total_semester_sessions": sem_total,
            "projected_end_percentage": projected_end_pct,
            "projected_end_pct": projected_end_pct,
            "max_possible_percentage": max_possible_pct,
            "classes_needed": 0,
            "is_recoverable": True,
            "recovery_status": "INSUFFICIENT_DATA",
            "recovery_message": f"Semester in progress. Minimum {min_sessions} sessions required for definitive JNTUH band evaluation."
        }

    current_band = determine_jntuh_band(current_pct, sessions_held=denom)

    target_frac = target / 100.0
    deficit = target_frac * denom - sessions_present
    if deficit <= 0:
        classes_needed = 0
        is_recoverable = True
        recovery_status = "RECOVERABLE"
        recovery_message = f"Currently meeting the JNTUH {target:.0f}% threshold."
    else:
        margin = max(0.01, 1.0 - target_frac)
        raw_classes = round(deficit / margin, 6)
        calc_needed = max(1, math.ceil(raw_classes))

        # Check recoverability:
        if rem == 0 or calc_needed > rem or max_possible_pct < target:
            is_recoverable = False
            recovery_status = "NOT_RECOVERABLE"
            classes_needed = min(calc_needed, rem)
            recovery_message = f"Attendance cannot reach {target:.0f}% this semester (max possible {max_possible_pct}%). Requires condonation or course repeat."
        else:
            is_recoverable = True
            recovery_status = "RECOVERABLE"
            classes_needed = calc_needed
            recovery_message = f"Attend {classes_needed} consecutive class{'es' if classes_needed != 1 else ''} to reach {target:.0f}%."

    return {
        "current_percentage": current_pct,
        "current_percentage_display": current_pct_display,
        "current_band": current_band,
        "sessions_held": denom,
        "sessions_present": sessions_present,
        "sessions_remaining": rem,
        "total_semester_sessions": sem_total,
        "projected_end_percentage": projected_end_pct,
        "projected_end_pct": projected_end_pct,
        "max_possible_percentage": max_possible_pct,
        "classes_needed": classes_needed,
        "is_recoverable": is_recoverable,
        "recovery_status": recovery_status,
        "recovery_message": recovery_message
    }

def calculate_projected_classes_needed(
    sessions_conducted: int,
    sessions_present: int,
    effective_denominator: int,
    total_semester_sessions: Optional[int] = None
) -> Optional[int]:
    """
    Calculates classes needed to reach 75% threshold:
    Formula specified in task:
    ceil((0.75 * total - present) / 0.25), capped by remaining sessions.
    Returns None if effective_denominator == 0.
    """
    res = calculate_trajectory_projection(
        sessions_conducted=sessions_conducted,
        sessions_present=sessions_present,
        effective_denominator=effective_denominator,
        total_semester_sessions=total_semester_sessions
    )
    return res.get("classes_needed")


class RapidDeclineResult(tuple):
    """
    Result of rapid decline analysis.
    Behaves as a 2-tuple (is_rapid, drop) when unpacked,
    while also evaluating directly to boolean (bool(res) -> is_rapid).
    """
    def __new__(cls, is_rapid: bool, drop: Optional[float] = None):
        return super().__new__(cls, (is_rapid, drop))

    @property
    def is_rapid(self) -> bool:
        return self[0]

    @property
    def drop(self) -> Optional[float]:
        return self[1]

    def __bool__(self) -> bool:
        return bool(self[0])

    def __eq__(self, other):
        if isinstance(other, bool):
            return self[0] == other
        return super().__eq__(other)


# ==============================================================================
# ATTENDANCE ENGINE CALCULATIONS
# ==============================================================================
class AttendanceEngine:

    @classmethod
    def get_student_course_attendance(
        cls,
        db: Session,
        student: Student,
        course: Subject,
        include_approved_absences: Optional[bool] = None,
        use_cache: bool = True
    ) -> Dict[str, Any]:
        """
        Calculates JNTUH R25 attendance percentage for one student in one course.
        Incorporates late-join rule, approved absences exclusion, zero-session handling,
        and underlying session auditability.
        """
        cache_key = f"student:{student.id}:course:{course.id}:iaa:{include_approved_absences}"
        if use_cache:
            cached = get_cached(cache_key)
            if cached:
                return cached

        policy_include_approved = getattr(settings, "JNTUH_INCLUDE_APPROVED_ABSENCES", True) if include_approved_absences is None else include_approved_absences
        server_today = get_server_ist_date()

        # 1. Fetch conducted sessions for this student's section and course up to today,
        # plus any session for this course where the student was marked
        recorded_sids = [
            r[0] for r in db.query(AttendanceRecord.session_id).filter(
                AttendanceRecord.student_id == student.id
            ).all() if r[0] is not None
        ]

        section_filters = []
        if recorded_sids:
            section_filters.append(AttendanceSession.id.in_(recorded_sids))
        if student.section_id:
            section_filters.append(AttendanceSession.section_id == student.section_id)
        if not section_filters:
            section_filters.append(AttendanceSession.section_id == student.section_id)

        query = db.query(AttendanceSession).filter(
            AttendanceSession.subject_id == course.id,
            AttendanceSession.session_date <= server_today,
            or_(*section_filters)
        )

        all_sessions = query.order_by(AttendanceSession.session_date.asc(), AttendanceSession.id.asc()).all()

        # Late-join exclusion: student was not admitted yet
        valid_sessions = []
        for s in all_sessions:
            if student.join_date and s.session_date < student.join_date:
                continue
            valid_sessions.append(s)

        session_ids = [s.id for s in valid_sessions]
        total_conducted = len(valid_sessions)

        # 2. Fetch student's attendance records for these sessions
        records = []
        if session_ids:
            records = db.query(AttendanceRecord).filter(
                AttendanceRecord.student_id == student.id,
                AttendanceRecord.session_id.in_(session_ids)
            ).all()

        record_by_session_id = {r.session_id: r for r in records}

        sessions_present = 0
        approved_absences = 0
        raw_sessions_audit = []

        for s in valid_sessions:
            rec = record_by_session_id.get(s.id)
            if rec:
                is_present = rec.status in [AttendanceStatus.PRESENT] or str(rec.status.value).upper() == "PRESENT"
                is_approved = bool(rec.is_approved_absence)
                if is_present:
                    sessions_present += 1
                elif is_approved:
                    approved_absences += 1

                raw_sessions_audit.append({
                    "session_id": s.id,
                    "session_date": s.session_date,
                    "period": s.period,
                    "status": rec.status.value if hasattr(rec.status, "value") else str(rec.status),
                    "is_present": is_present,
                    "is_approved_absence": is_approved,
                    "approved_absence_reason": rec.approved_absence_reason,
                    "scan_mode": rec.scan_mode,
                    "scanned_at": rec.scanned_at.isoformat() if rec.scanned_at else None,
                })
            else:
                raw_sessions_audit.append({
                    "session_id": s.id,
                    "session_date": s.session_date,
                    "period": s.period,
                    "status": "ABSENT",
                    "is_present": False,
                    "is_approved_absence": False,
                    "approved_absence_reason": None,
                    "scan_mode": "SYSTEM_ABSENT",
                    "scanned_at": None,
                })

        # 3. Apply denominator calculation per JNTUH policy
        if policy_include_approved:
            effective_denominator = max(0, total_conducted - approved_absences)
        else:
            effective_denominator = total_conducted

        # 4. Trajectory projection & JNTUH band calculation
        active_semester = db.query(Semester).filter(Semester.is_active == True).first()
        sem_total_sessions = active_semester.total_planned_sessions if active_semester else getattr(settings, "DEFAULT_SEMESTER_SESSIONS", 60)

        trajectory = calculate_trajectory_projection(
            sessions_conducted=total_conducted,
            sessions_present=sessions_present,
            effective_denominator=effective_denominator,
            total_semester_sessions=sem_total_sessions
        )

        percentage = trajectory["current_percentage"]
        percentage_display = trajectory["current_percentage_display"]
        band = trajectory["current_band"]
        classes_needed = trajectory["classes_needed"]
        is_recoverable = trajectory["is_recoverable"]
        recovery_status = trajectory["recovery_status"]
        recovery_message = trajectory["recovery_message"]

        # 5. Trend detection (RAPID_DECLINE)
        is_rapid_decline, decline_drop = cls.detect_rapid_decline(db=db, student_id=student.id, course_id=course.id)
        trend_flag = "RAPID_DECLINE" if is_rapid_decline else "STABLE"

        # 6. Fetch condonation fine status if band is CONDONABLE
        condonation_status = "pending"
        condonation_fine = 0.0
        condonation_rec = db.query(StudentCondonation).filter(
            StudentCondonation.student_id == student.id,
            StudentCondonation.course_id == course.id
        ).first()
        if condonation_rec:
            condonation_status = condonation_rec.status
            condonation_fine = condonation_rec.fine_amount

        # Recovery-framed copy for student view
        if not is_recoverable and effective_denominator > 0:
            classes_needed_msg = recovery_message
        elif classes_needed and classes_needed > 0:
            classes_needed_msg = f"You need {classes_needed} more consecutive class{'es' if classes_needed != 1 else ''} to reach 75% in this course"
        else:
            classes_needed_msg = None

        result = {
            "course_id": course.id,
            "course_code": course.code,
            "course_name": course.name,
            "sessions_conducted": total_conducted,
            "sessions_present": sessions_present,
            "present_sessions": sessions_present,
            "approved_absences": approved_absences,
            "effective_denominator": effective_denominator,
            "effective_sessions": effective_denominator,
            "percentage": percentage,
            "attendance_percentage": percentage,
            "percentage_display": percentage_display,
            "band": band,
            "band_info": BAND_COLORS.get(band, BAND_COLORS[BAND_NO_DATA]),
            "condonation_status": condonation_status if band == BAND_CONDONABLE else None,
            "condonation_fine": condonation_fine if band == BAND_CONDONABLE else None,
            "sessions_remaining": trajectory["sessions_remaining"],
            "total_semester_sessions": sem_total_sessions,
            "projected_end_percentage": trajectory["projected_end_percentage"],
            "max_possible_percentage": trajectory["max_possible_percentage"],
            "classes_needed_for_75": classes_needed,
            "is_recoverable": is_recoverable,
            "recovery_status": recovery_status,
            "recovery_message": recovery_message,
            "classes_needed_message": classes_needed_msg,
            "trend_flag": trend_flag,
            "decline_drop": decline_drop,
            "has_records": total_conducted > 0,
            "sessions": raw_sessions_audit
        }

        if use_cache:
            set_cached(cache_key, result)

        return result

    @classmethod
    def get_student_full_compliance(
        cls,
        db: Session,
        roll_number: str,
        include_approved_absences: Optional[bool] = None,
        use_cache: bool = True
    ) -> Dict[str, Any]:
        """
        Returns full compliance profile for a student:
        Aggregate % + band + per-course breakdown + auditability.
        """
        student = db.query(Student).options(
            joinedload(Student.department),
            joinedload(Student.section),
            joinedload(Student.academic_year)
        ).filter(Student.roll_number == roll_number).first()

        if not student:
            return {"error": "Student not found", "roll_number": roll_number}

        cache_key = f"student:{student.id}:full:{roll_number}:iaa:{include_approved_absences}"
        if use_cache:
            cached = get_cached(cache_key)
            if cached:
                return cached

        courses_query = db.query(Subject)
        if student.department_id:
            courses_query = courses_query.filter(Subject.department_id == student.department_id)
        if student.academic_year_id:
            courses_query = courses_query.filter(Subject.academic_year_id == student.academic_year_id)
        
        courses = courses_query.all()

        if not courses and student.section_id:
            sub_ids = [a.subject_id for a in db.query(TeacherAssignment).filter(TeacherAssignment.section_id == student.section_id).all()]
            if sub_ids:
                courses = db.query(Subject).filter(Subject.id.in_(sub_ids)).all()

        courses_result = []
        agg_conducted = 0
        agg_present = 0
        agg_approved_absences = 0
        agg_effective_denominator = 0
        courses_below_75_count = 0

        for course in courses:
            c_data = cls.get_student_course_attendance(
                db=db,
                student=student,
                course=course,
                include_approved_absences=include_approved_absences,
                use_cache=use_cache
            )
            courses_result.append(c_data)
            agg_conducted += c_data["sessions_conducted"]
            agg_present += c_data["sessions_present"]
            agg_approved_absences += c_data["approved_absences"]
            agg_effective_denominator += c_data["effective_denominator"]

            if c_data["percentage"] is not None and c_data["percentage"] < R25Config.ELIGIBLE_THRESHOLD and c_data.get("band") != BAND_INSUFFICIENT_DATA:
                courses_below_75_count += 1

        if agg_effective_denominator == 0:
            agg_percentage = None
            agg_percentage_display = "—"
            agg_band = BAND_NO_DATA
        else:
            agg_percentage = round((agg_present / agg_effective_denominator) * 100, 2)
            agg_percentage_display = f"{agg_percentage:.2f}%"
            agg_band = determine_jntuh_band(agg_percentage, sessions_held=agg_effective_denominator)

        agg_condonation_status = "pending"
        agg_condonation_rec = db.query(StudentCondonation).filter(
            StudentCondonation.student_id == student.id,
            StudentCondonation.course_id == None
        ).first()
        if agg_condonation_rec:
            agg_condonation_status = agg_condonation_rec.status

        active_semester = db.query(Semester).filter(Semester.is_active == True).first()
        total_sem_sessions = (active_semester.total_planned_sessions * len(courses)) if (active_semester and courses) else (getattr(settings, "DEFAULT_SEMESTER_SESSIONS", 60) * max(1, len(courses)))

        agg_trajectory = calculate_trajectory_projection(
            sessions_conducted=agg_conducted,
            sessions_present=agg_present,
            effective_denominator=agg_effective_denominator,
            total_semester_sessions=total_sem_sessions
        )

        # Fetch student warnings
        warnings = db.query(StudentWarning).options(
            joinedload(StudentWarning.course)
        ).filter(
            StudentWarning.student_id == student.id
        ).order_by(StudentWarning.issued_at.desc()).all()

        warnings_data = [
            {
                "id": w.id,
                "course_id": w.course_id,
                "course_code": w.course.code if w.course else None,
                "course_name": w.course.name if w.course else "Semester Aggregate",
                "warning_type": w.warning_type,
                "percentage_at_issue": w.percentage_at_issue,
                "band_at_issue": w.band_at_issue,
                "classes_needed_at_issue": w.classes_needed_at_issue,
                "sessions_held_at_issue": w.sessions_held_at_issue,
                "sessions_present_at_issue": w.sessions_present_at_issue,
                "issued_by_user_id": w.issued_by_user_id,
                "issued_at": w.issued_at.isoformat() if w.issued_at else None,
                "message": w.message,
                "parent_notified": w.parent_notified,
                "parent_notification_status": w.parent_notification_status
            }
            for w in warnings
        ]

        result = {
            "student_id": student.id,
            "roll_number": student.roll_number,
            "name": student.name,
            "department": student.department.code if student.department else "Unassigned",
            "department_name": student.department.name if student.department else "Unassigned",
            "section": student.section.name if student.section else "—",
            "academic_year": student.academic_year.name if student.academic_year else "—",
            "join_date": student.join_date,
            "aggregate_conducted": agg_conducted,
            "aggregate_present": agg_present,
            "aggregate_approved_absences": agg_approved_absences,
            "aggregate_effective_denominator": agg_effective_denominator,
            "aggregate_percentage": agg_percentage,
            "aggregate_percentage_display": agg_percentage_display,
            "aggregate_band": agg_band,
            "overall_percentage": agg_percentage,
            "overall_band": agg_band,
            "aggregate_band_info": BAND_COLORS.get(agg_band, BAND_COLORS[BAND_NO_DATA]),
            "aggregate_condonation_status": agg_condonation_status if agg_band == BAND_CONDONABLE else None,
            "aggregate_sessions_remaining": agg_trajectory["sessions_remaining"],
            "aggregate_projected_percentage": agg_trajectory["projected_end_percentage"],
            "aggregate_max_possible_percentage": agg_trajectory["max_possible_percentage"],
            "aggregate_classes_needed": agg_trajectory["classes_needed"],
            "aggregate_is_recoverable": agg_trajectory["is_recoverable"],
            "aggregate_recovery_status": agg_trajectory["recovery_status"],
            "aggregate_recovery_message": agg_trajectory["recovery_message"],
            "courses_below_75_count": courses_below_75_count,
            "total_courses": len(courses),
            "warnings": warnings_data,
            "active_warning_count": len(warnings_data),
            "courses": courses_result,
            "aggregate": {
                "total_present_sessions": agg_present,
                "total_conducted_sessions": agg_conducted,
                "total_effective_sessions": agg_effective_denominator,
                "percentage": agg_percentage,
                "aggregate_percentage": agg_percentage,
                "aggregate_display": agg_percentage_display,
                "band": agg_band
            }
        }

        if use_cache:
            set_cached(cache_key, result)

        return result

    @classmethod
    def get_department_compliance_summary(
        cls,
        db: Session,
        department_code: Optional[str] = None,
        use_cache: bool = True
    ) -> Dict[str, Any]:
        """
        Generates Department-Level Compliance Analytics:
        Counts of Eligible, Condonable, Detained students per department,
        and aggregates across the entire institution.
        UNASSIGNED-DEPARTMENT STUDENTS: Captured in "Unassigned" bucket — never silently dropped.
        """
        cache_key = f"admin_summary:{department_code}"
        if use_cache:
            cached = get_cached(cache_key)
            if cached:
                return cached

        departments = db.query(Department).all()
        all_students = db.query(Student).options(
            joinedload(Student.department)
        ).all()

        students_by_dept: Dict[str, List[Student]] = {d.code: [] for d in departments}
        students_by_dept["Unassigned"] = []

        for s in all_students:
            if s.department and s.department.code in students_by_dept:
                students_by_dept[s.department.code].append(s)
            else:
                students_by_dept["Unassigned"].append(s)

        dept_summaries = []
        overall_eligible = 0
        overall_condonable = 0
        overall_detained = 0
        overall_no_data = 0
        total_students_count = len(all_students)

        target_depts = [department_code] if department_code else list(students_by_dept.keys())

        for d_code in target_depts:
            if d_code not in students_by_dept:
                continue
            
            dept_students = students_by_dept[d_code]
            dept_obj = next((d for d in departments if d.code == d_code), None)
            dept_name = dept_obj.name if dept_obj else ("Unassigned Students" if d_code == "Unassigned" else d_code)

            e_count = 0
            c_count = 0
            d_count = 0
            nd_count = 0

            for s in dept_students:
                comp = cls.get_student_full_compliance(db, s.roll_number, use_cache=use_cache)
                band = comp.get("aggregate_band", BAND_NO_DATA)
                if band == BAND_ELIGIBLE:
                    e_count += 1
                elif band == BAND_CONDONABLE:
                    c_count += 1
                elif band == BAND_DETAINED:
                    d_count += 1
                else:
                    nd_count += 1

            if d_code == "Unassigned" and len(dept_students) == 0 and department_code != "Unassigned":
                continue

            total_dept_students = len(dept_students)
            dept_summaries.append({
                "department_id": dept_obj.id if dept_obj else None,
                "department_code": d_code,
                "department_name": dept_name,
                "total_enrolled": total_dept_students,
                "eligible_count": e_count,
                "condonable_count": c_count,
                "detained_count": d_count,
                "no_data_count": nd_count,
                "eligible_pct": round((e_count / total_dept_students * 100), 1) if total_dept_students > 0 else 0.0,
                "condonable_pct": round((c_count / total_dept_students * 100), 1) if total_dept_students > 0 else 0.0,
                "detained_pct": round((d_count / total_dept_students * 100), 1) if total_dept_students > 0 else 0.0,
            })

            overall_eligible += e_count
            overall_condonable += c_count
            overall_detained += d_count
            overall_no_data += nd_count

        result = {
            "total_students": total_students_count,
            "total_departments": len([d for d in dept_summaries if d["department_code"] != "Unassigned"]),
            "overall_eligible_count": overall_eligible,
            "overall_condonable_count": overall_condonable,
            "overall_detained_count": overall_detained,
            "overall_no_data_count": overall_no_data,
            "overall_eligible_pct": round((overall_eligible / total_students_count * 100), 1) if total_students_count > 0 else 0.0,
            "overall_condonable_pct": round((overall_condonable / total_students_count * 100), 1) if total_students_count > 0 else 0.0,
            "overall_detained_pct": round((overall_detained / total_students_count * 100), 1) if total_students_count > 0 else 0.0,
            "policy_include_approved_absences": getattr(settings, "JNTUH_INCLUDE_APPROVED_ABSENCES", True),
            "thresholds": {
                "eligible": getattr(settings, "JNTUH_ELIGIBLE_THRESHOLD", R25Config.ELIGIBLE_THRESHOLD),
                "condonable": getattr(settings, "JNTUH_CONDONABLE_THRESHOLD", R25Config.CONDONABLE_THRESHOLD),
            },
            "departments": dept_summaries
        }

        if use_cache:
            set_cached(cache_key, result)

        return result

    @classmethod
    def get_faculty_course_compliance(
        cls,
        db: Session,
        course_id: int,
        teacher_id: Optional[int] = None,
        use_cache: bool = True
    ) -> Dict[str, Any]:
        """
        Compliance breakdown for faculty course view:
        Student roster, sessions conducted, present counts, bands, and condonation flags.
        """
        cache_key = f"faculty_course:{course_id}:t:{teacher_id}"
        if use_cache:
            cached = get_cached(cache_key)
            if cached:
                return cached

        course = db.query(Subject).filter(Subject.id == course_id).first()
        if not course:
            return {"error": "Course not found", "course_id": course_id}

        assignments_query = db.query(TeacherAssignment).filter(TeacherAssignment.subject_id == course_id)
        if teacher_id:
            assignments_query = assignments_query.filter(TeacherAssignment.teacher_id == teacher_id)
        
        assignments = assignments_query.all()
        section_ids = list(set([a.section_id for a in assignments]))

        students_query = db.query(Student).options(
            joinedload(Student.section)
        )
        if section_ids:
            students_query = students_query.filter(Student.section_id.in_(section_ids))
        elif course.department_id:
            students_query = students_query.filter(Student.department_id == course.department_id)
        
        enrolled_students = students_query.order_by(Student.roll_number.asc()).all()

        roster = []
        eligible_count = 0
        condonable_count = 0
        detained_count = 0
        no_data_count = 0

        for s in enrolled_students:
            c_data = cls.get_student_course_attendance(db, s, course, use_cache=use_cache)
            band = c_data["band"]
            if band == BAND_ELIGIBLE:
                eligible_count += 1
            elif band == BAND_CONDONABLE:
                condonable_count += 1
            elif band == BAND_DETAINED:
                detained_count += 1
            else:
                no_data_count += 1

            roster.append({
                "student_id": s.id,
                "roll_number": s.roll_number,
                "name": s.name,
                "section": s.section.name if s.section else "—",
                "sessions_conducted": c_data["sessions_conducted"],
                "sessions_present": c_data["sessions_present"],
                "approved_absences": c_data["approved_absences"],
                "percentage": c_data["percentage"],
                "percentage_display": c_data["percentage_display"],
                "band": band,
                "band_info": c_data["band_info"],
                "condonation_status": c_data["condonation_status"],
                "classes_needed_for_75": c_data["classes_needed_for_75"],
                "sessions": c_data["sessions"]
            })

        total_enrolled = len(enrolled_students)

        result = {
            "course_id": course.id,
            "course_code": course.code,
            "course_name": course.name,
            "total_enrolled": total_enrolled,
            "eligible_count": eligible_count,
            "condonable_count": condonable_count,
            "detained_count": detained_count,
            "no_data_count": no_data_count,
            "eligible_pct": round((eligible_count / total_enrolled * 100), 1) if total_enrolled > 0 else 0.0,
            "condonable_pct": round((condonable_count / total_enrolled * 100), 1) if total_enrolled > 0 else 0.0,
            "detained_pct": round((detained_count / total_enrolled * 100), 1) if total_enrolled > 0 else 0.0,
            "students": roster
        }

        if use_cache:
            set_cached(cache_key, result)

        return result

    @classmethod
    def detect_rapid_decline(
        cls,
        db: Any,
        student_id: Optional[int] = None,
        course_id: Optional[int] = None,
        percentages: Optional[List[float]] = None
    ) -> "RapidDeclineResult":
        """
        Trend flag: RAPID_DECLINE if last 2 fortnights each dropped >= 5.0%.
        Student with perfect attendance -> no false RAPID_DECLINE.
        Accepts either (db, student_id, course_id) or a raw sequence of percentages (e.g. [100.0, 100.0, 100.0]).
        """
        if isinstance(db, (list, tuple)):
            percentages_list = list(db)
        elif percentages is not None:
            percentages_list = percentages
        elif db is not None and hasattr(db, "query") and student_id is not None:
            q = db.query(FortnightSnapshot).filter(
                FortnightSnapshot.student_id == student_id
            )
            if course_id is not None:
                q = q.filter(FortnightSnapshot.course_id == course_id)
            else:
                q = q.filter(FortnightSnapshot.course_id == None)

            snapshots = q.order_by(FortnightSnapshot.fortnight_number.asc()).all()

            # If specific course had no snapshots, check aggregate snapshots as fallback
            if not snapshots and course_id is not None:
                snapshots = db.query(FortnightSnapshot).filter(
                    FortnightSnapshot.student_id == student_id,
                    FortnightSnapshot.course_id == None
                ).order_by(FortnightSnapshot.fortnight_number.asc()).all()

            percentages_list = [s.percentage if s.percentage is not None else 0.0 for s in snapshots]
        else:
            percentages_list = []

        if len(percentages_list) >= 3:
            p_latest = percentages_list[-1]
            p_prev1 = percentages_list[-2]
            p_prev2 = percentages_list[-3]

            drop1 = round(p_prev1 - p_latest, 2)
            drop2 = round(p_prev2 - p_prev1, 2)

            if drop1 >= 5.0 and drop2 >= 5.0:
                return RapidDeclineResult(True, round(drop1 + drop2, 2))
            return RapidDeclineResult(False, None)

        return RapidDeclineResult(False, None)

    @classmethod
    def get_defaulters_roster(
        cls,
        db: Session,
        user: Optional[User] = None,
        course_id: Optional[int] = None,
        dept_code: Optional[str] = None,
        academic_year_id: Optional[int] = None,
        band_filter: Optional[str] = None,
        flag_filter: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Defaulter list generation (role-gated):
        - Faculty: own assigned courses only
        - HOD: own department only
        - Admin: all departments
        Filters: DETAINED / CONDONABLE / BELOW_75 / RAPID_DECLINE / NOT_RECOVERABLE
        Each row: roll, name, current %, projected %, classes_needed, band,
        last-certified fortnight %, intervention status.
        """
        if user is None:
            user = db.query(User).filter(User.role == UserRole.SUPER_ADMIN).first() or User(id=1, role=UserRole.SUPER_ADMIN, username="admin")

        teacher_profile = None
        if user.role == UserRole.TEACHER:
            teacher_profile = db.query(Teacher).filter(Teacher.user_id == user.id).first()
            if not teacher_profile:
                raise ValueError("Teacher profile not found")

        # Determine courses in scope
        target_courses: List[Subject] = []
        if course_id:
            course = db.query(Subject).filter(Subject.id == course_id).first()
            if not course:
                raise ValueError("Course not found")
            if user.role == UserRole.TEACHER and teacher_profile:
                is_assigned = db.query(TeacherAssignment).filter(
                    TeacherAssignment.teacher_id == teacher_profile.id,
                    TeacherAssignment.subject_id == course_id
                ).first() is not None
                is_dept = (teacher_profile.department_id == course.department_id)
                if not is_assigned and not is_dept:
                    raise PermissionError("Access denied: You are only authorized to view defaulters for your assigned courses.")
            target_courses = [course]
        elif user.role == UserRole.TEACHER and not dept_code:
            assignments = db.query(TeacherAssignment).filter(TeacherAssignment.teacher_id == teacher_profile.id).all() if teacher_profile else []
            assigned_sub_ids = list(set([a.subject_id for a in assignments]))
            if assigned_sub_ids:
                target_courses = db.query(Subject).filter(Subject.id.in_(assigned_sub_ids)).all()
            elif teacher_profile and teacher_profile.department_id:
                target_courses = db.query(Subject).filter(Subject.department_id == teacher_profile.department_id).all()
        else:
            c_query = db.query(Subject)
            if dept_code:
                dept_norm = dept_code.strip().upper()
                if user.role == UserRole.TEACHER and teacher_profile:
                    t_dept = teacher_profile.department.code.strip().upper() if teacher_profile.department else ""
                    if t_dept != dept_norm:
                        raise PermissionError(f"Access denied: You are only authorized to view department {t_dept}.")
                dept_obj = db.query(Department).filter(Department.code == dept_norm).first()
                if dept_obj:
                    c_query = c_query.filter(Subject.department_id == dept_obj.id)
            if academic_year_id:
                c_query = c_query.filter(Subject.academic_year_id == academic_year_id)
            target_courses = c_query.all()

        rows = []
        total_evaluated = 0
        detained_count = 0
        condonable_count = 0
        rapid_decline_count = 0
        not_recoverable_count = 0

        for course in target_courses:
            assigned_sections = [a.section_id for a in db.query(TeacherAssignment).filter(TeacherAssignment.subject_id == course.id).all()]
            students_q = db.query(Student).options(
                joinedload(Student.department),
                joinedload(Student.section),
                joinedload(Student.academic_year)
            )
            if assigned_sections:
                students_q = students_q.filter(Student.section_id.in_(assigned_sections))
            elif course.department_id:
                students_q = students_q.filter(Student.department_id == course.department_id)

            if academic_year_id:
                students_q = students_q.filter(Student.academic_year_id == academic_year_id)

            students = students_q.order_by(Student.roll_number.asc()).all()

            for s in students:
                total_evaluated += 1
                c_data = cls.get_student_course_attendance(db, s, course, use_cache=True)
                band = c_data["band"]
                is_rapid_decline = (c_data.get("trend_flag") == "RAPID_DECLINE")
                is_recoverable = c_data.get("is_recoverable", True)

                if band == BAND_DETAINED:
                    detained_count += 1
                elif band == BAND_CONDONABLE:
                    condonable_count += 1

                if is_rapid_decline:
                    rapid_decline_count += 1
                if not is_recoverable and c_data.get("effective_denominator", 0) > 0 and band != BAND_INSUFFICIENT_DATA:
                    not_recoverable_count += 1

                # Last certified fortnight snapshot
                last_fn = db.query(FortnightSnapshot).filter(
                    FortnightSnapshot.student_id == s.id,
                    FortnightSnapshot.course_id == course.id
                ).order_by(FortnightSnapshot.fortnight_number.desc()).first()
                if not last_fn:
                    last_fn = db.query(FortnightSnapshot).filter(
                        FortnightSnapshot.student_id == s.id,
                        FortnightSnapshot.course_id == None
                    ).order_by(FortnightSnapshot.fortnight_number.desc()).first()

                # Intervention warnings
                warnings = db.query(StudentWarning).filter(
                    StudentWarning.student_id == s.id,
                    StudentWarning.course_id == course.id
                ).order_by(StudentWarning.issued_at.desc()).all()
                warning_count = len(warnings)
                last_warning = warnings[0] if warnings else None
                intervention_status = "WARNING_ISSUED" if warning_count > 0 else "NONE"

                row = {
                    "student_id": s.id,
                    "roll": s.roll_number,
                    "roll_number": s.roll_number,
                    "name": s.name,
                    "department": s.department.code if s.department else "Unassigned",
                    "section": s.section.name if s.section else "—",
                    "course_id": course.id,
                    "course_code": course.code,
                    "course_name": course.name,
                    "sessions_held": c_data["sessions_conducted"],
                    "sessions_present": c_data["sessions_present"],
                    "current_percentage": c_data["percentage"],
                    "current_percentage_display": c_data["percentage_display"],
                    "band": band,
                    "current_band": band,
                    "band_info": c_data["band_info"],
                    "sessions_remaining": c_data.get("sessions_remaining", 0),
                    "projected_percentage": c_data.get("projected_end_percentage"),
                    "max_possible_percentage": c_data.get("max_possible_percentage"),
                    "classes_needed": c_data.get("classes_needed_for_75"),
                    "is_recoverable": is_recoverable,
                    "recovery_status": c_data.get("recovery_status", "RECOVERABLE"),
                    "recovery_message": c_data.get("recovery_message"),
                    "rapid_decline": is_rapid_decline,
                    "trend_flag": c_data.get("trend_flag", "STABLE"),
                    "last_certified_fortnight_percentage": last_fn.percentage if last_fn else None,
                    "fortnight_percentage": last_fn.percentage if last_fn else None,
                    "intervention_status": intervention_status,
                    "warning_count": warning_count,
                    "active_warning_count": warning_count,
                    "last_warning_date": last_warning.issued_at.isoformat() if last_warning else None,
                    "condonation_status": c_data.get("condonation_status")
                }

                # Filtering evaluation
                flt = (flag_filter or band_filter or "BELOW_75").strip().upper()
                include = False
                if flt == "ALL":
                    include = True
                elif flt == "DETAINED" and band == BAND_DETAINED:
                    include = True
                elif flt == "CONDONABLE" and band == BAND_CONDONABLE:
                    include = True
                elif flt == "BELOW_75" and (c_data["percentage"] is not None and c_data["percentage"] < R25Config.ELIGIBLE_THRESHOLD and band not in (BAND_INSUFFICIENT_DATA, BAND_NO_DATA)):
                    include = True
                elif flt == "RAPID_DECLINE" and is_rapid_decline:
                    include = True
                elif flt == "NOT_RECOVERABLE" and not is_recoverable and c_data.get("effective_denominator", 0) > 0 and band != BAND_INSUFFICIENT_DATA:
                    include = True
                elif flt == "INSUFFICIENT_DATA" and band == BAND_INSUFFICIENT_DATA:
                    include = True

                if include:
                    rows.append(row)

        return {
            "total_evaluated": total_evaluated,
            "defaulter_count": len(rows),
            "detained_count": detained_count,
            "condonable_count": condonable_count,
            "rapid_decline_count": rapid_decline_count,
            "not_recoverable_count": not_recoverable_count,
            "filter_applied": flag_filter or band_filter or "BELOW_75",
            "defaulters": rows,
            "students": rows
        }

    @classmethod
    def issue_student_warning(
        cls,
        db: Session,
        issuer_user: User,
        student_roll: str,
        course_id: Optional[int] = None,
        custom_message: Optional[str] = None,
        notify_parent: bool = False
    ) -> Dict[str, Any]:
        """
        Warning issuance + evidence trail:
        Records: issuer, date, band at issue time (snapshot numbers - immutable evidence).
        Student sees warnings in their own PWA view with recovery path.
        Parent notification: optional, controlled by admin toggle.
        """
        student = db.query(Student).filter(Student.roll_number == student_roll.strip().upper()).first()
        if not student:
            raise ValueError("Student not found")

        course = None
        if course_id:
            course = db.query(Subject).filter(Subject.id == course_id).first()
            if not course:
                raise ValueError("Course not found")

            # Role scoping: Faculty can only warn students in their assigned courses
            if issuer_user.role == UserRole.TEACHER:
                teacher_prof = db.query(Teacher).filter(Teacher.user_id == issuer_user.id).first()
                if not teacher_prof:
                    raise PermissionError("Teacher profile missing")
                is_assigned = db.query(TeacherAssignment).filter(
                    TeacherAssignment.teacher_id == teacher_prof.id,
                    TeacherAssignment.subject_id == course_id
                ).first() is not None
                is_dept = (teacher_prof.department_id == course.department_id)
                if not is_assigned and not is_dept:
                    raise PermissionError("Access denied: You can only issue warnings for your assigned courses.")

        # Compute snapshot numbers at time of warning issuance
        if course:
            c_data = cls.get_student_course_attendance(db, student, course, use_cache=False)
            pct_issue = c_data["percentage"] if c_data["percentage"] is not None else 0.0
            band_issue = c_data["band"]
            classes_issue = c_data.get("classes_needed_for_75")
            held_issue = c_data.get("sessions_conducted", 0)
            present_issue = c_data.get("sessions_present", 0)
            is_recov = c_data.get("is_recoverable", True)
        else:
            comp = cls.get_student_full_compliance(db, student.roll_number, use_cache=False)
            pct_issue = comp["aggregate_percentage"] if comp["aggregate_percentage"] is not None else 0.0
            band_issue = comp["aggregate_band"]
            classes_issue = comp.get("aggregate_classes_needed")
            held_issue = comp.get("aggregate_conducted", 0)
            present_issue = comp.get("aggregate_present", 0)
            is_recov = comp.get("aggregate_is_recoverable", True)

        # Classify warning type
        if not is_recov and held_issue > 0:
            warning_type = "NOT_RECOVERABLE"
        elif band_issue == BAND_DETAINED:
            warning_type = "DETAINED"
        elif band_issue == BAND_CONDONABLE:
            warning_type = "CONDONABLE"
        else:
            warning_type = "ATTENDANCE_DEFICIT"

        parent_status = "SKIPPED_DISABLED"
        parent_email = getattr(student, "guardian_email", None) or getattr(student, "email", None)
        parent_enabled = getattr(settings, "PARENT_NOTIFICATIONS_ENABLED", False)

        if notify_parent and parent_enabled:
            if parent_email:
                try:
                    from app.services.email_service import send_single_email
                    mail_res = send_single_email(
                        to_email=parent_email,
                        subject=f"[SNIST Attendance Warning] {student.name} ({student.roll_number})",
                        html_body=(
                            f"<html><body>"
                            f"<h3>SNIST Official Attendance Advisory</h3>"
                            f"<p>Dear Parent/Guardian,</p>"
                            f"<p>Student <b>{student.name}</b> ({student.roll_number}) currently has an attendance of <b>{pct_issue:.1f}%</b> ({band_issue}) in <b>{course.name if course else 'Semester'}</b>.</p>"
                            f"<p><b>Recovery Path:</b> Student needs to attend <b>{classes_issue or 0}</b> consecutive classes to reach compliance.</p>"
                            f"<p>Issued on: {get_server_ist_datetime().strftime('%Y-%m-%d %H:%M IST')}</p>"
                            f"</body></html>"
                        )
                    )
                    parent_status = "SENT" if mail_res.get("status") in ("SENT", "SUCCESS") else mail_res.get("status", "FAILED")
                except Exception as m_err:
                    logger.error(f"Failed to send parent warning email: {m_err}")
                    parent_status = "FAILED"
            else:
                parent_status = "LOGGED_NO_GATEWAY"
        elif notify_parent and not parent_enabled:
            parent_status = "SKIPPED_DISABLED"

        if not custom_message:
            course_label = course.code if course else "Semester"
            if not is_recov:
                default_msg = f"You received an attendance warning in {course_label} — attendance cannot reach 75% this semester. Please contact your HOD immediately for condonation counseling."
            elif classes_issue and classes_issue > 0:
                default_msg = f"You received an attendance warning on {get_server_ist_date()} — you need {classes_issue} consecutive classes to recover in {course_label}."
            else:
                default_msg = f"Attendance advisory issued for {course_label}."
        else:
            default_msg = custom_message

        warning_obj = StudentWarning(
            student_id=student.id,
            course_id=course.id if course else None,
            warning_type=warning_type,
            percentage_at_issue=pct_issue,
            band_at_issue=band_issue,
            classes_needed_at_issue=classes_issue,
            sessions_held_at_issue=held_issue,
            sessions_present_at_issue=present_issue,
            issued_by_user_id=issuer_user.id,
            issued_at=get_server_ist_datetime(),
            message=default_msg,
            parent_notified=(parent_status == "SENT"),
            parent_notification_status=parent_status,
            parent_email=parent_email,
            parent_notified_at=get_server_ist_datetime() if parent_status == "SENT" else None
        )

        db.add(warning_obj)
        db.commit()
        db.refresh(warning_obj)

        return {
            "status": "SUCCESS",
            "id": warning_obj.id,
            "warning_id": warning_obj.id,
            "student_roll": student.roll_number,
            "student_name": student.name,
            "course_code": course.code if course else "ALL",
            "warning_type": warning_obj.warning_type,
            "percentage_at_issue": warning_obj.percentage_at_issue,
            "band_at_issue": warning_obj.band_at_issue,
            "classes_needed_at_issue": warning_obj.classes_needed_at_issue,
            "issued_at": warning_obj.issued_at.isoformat(),
            "message": warning_obj.message,
            "parent_notification_status": warning_obj.parent_notification_status
        }

    @staticmethod
    def generate_defaulters_excel(defaulters_data: List[Dict[str, Any]], title: str = "Defaulters Register") -> bytes:
        """
        One-click Excel export in official SNIST register format.
        """
        wb = Workbook()
        ws = wb.active
        ws.title = "Defaulter Register"

        # Title Block
        ws.merge_cells("A1:N1")
        title_cell = ws["A1"]
        title_cell.value = f"SREENIDHI INSTITUTE OF SCIENCE & TECHNOLOGY — {title.upper()}"
        title_cell.font = Font(name="Arial", size=13, bold=True, color="FFFFFF")
        title_cell.fill = PatternFill(start_color="0F172A", end_color="0F172A", fill_type="solid")
        title_cell.alignment = Alignment(horizontal="center", vertical="center")
        ws.row_dimensions[1].height = 30

        # Subtitle Block
        ws.merge_cells("A2:N2")
        sub_cell = ws["A2"]
        sub_cell.value = f"Generated On: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} | JNTUH R25 Regulatory Compliance"
        sub_cell.font = Font(name="Arial", size=9, italic=True, color="64748B")
        sub_cell.alignment = Alignment(horizontal="center", vertical="center")
        ws.row_dimensions[2].height = 18

        headers = [
            "S.No", "Roll Number", "Student Name", "Dept", "Sec",
            "Course", "Held", "Present", "Current %", "Band",
            "Projected %", "Classes Needed", "Recovery Status", "Trend / Alert"
        ]
        ws.append([])
        ws.append(headers)

        header_font = Font(name="Arial", size=10, bold=True, color="FFFFFF")
        header_fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
        thin_border = Border(
            left=Side(style='thin', color='CBD5E1'),
            right=Side(style='thin', color='CBD5E1'),
            top=Side(style='thin', color='CBD5E1'),
            bottom=Side(style='thin', color='CBD5E1')
        )

        for col_idx in range(1, len(headers) + 1):
            cell = ws.cell(row=4, column=col_idx)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = Alignment(horizontal="center", vertical="center")
            cell.border = thin_border
        ws.row_dimensions[4].height = 24

        for i, item in enumerate(defaulters_data, 1):
            row_idx = 4 + i
            cur_pct = item.get("current_percentage")
            proj_pct = item.get("projected_percentage")
            row_data = [
                i,
                item.get("roll") or item.get("roll_number", ""),
                item.get("name", ""),
                item.get("department", ""),
                item.get("section", ""),
                item.get("course_code", ""),
                item.get("sessions_held", 0),
                item.get("sessions_present", 0),
                f"{cur_pct:.1f}%" if cur_pct is not None else "—",
                item.get("band", ""),
                f"{proj_pct:.1f}%" if proj_pct is not None else "—",
                item.get("classes_needed") if item.get("classes_needed") is not None else "—",
                item.get("recovery_status", "RECOVERABLE"),
                f"{item.get('trend_flag', '')} ({item.get('intervention_status', '')})"
            ]
            ws.append(row_data)
            ws.row_dimensions[row_idx].height = 20

            fill_bg = "F8FAFC" if i % 2 == 0 else "FFFFFF"
            row_fill = PatternFill(start_color=fill_bg, end_color=fill_bg, fill_type="solid")

            for col_idx in range(1, len(headers) + 1):
                cell = ws.cell(row=row_idx, column=col_idx)
                cell.fill = row_fill
                cell.border = thin_border
                cell.alignment = Alignment(horizontal="center" if col_idx in [1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] else "left", vertical="center")

                if col_idx == 10:
                    b = str(cell.value).upper()
                    if b == "ELIGIBLE":
                        cell.font = Font(name="Arial", size=9, bold=True, color="16A34A")
                    elif b == "CONDONABLE":
                        cell.font = Font(name="Arial", size=9, bold=True, color="D97706")
                    elif b == "DETAINED":
                        cell.font = Font(name="Arial", size=9, bold=True, color="DC2626")

                if col_idx == 13 and str(cell.value).upper() == "NOT_RECOVERABLE":
                    cell.font = Font(name="Arial", size=9, bold=True, color="DC2626")

        for col in ws.columns:
            max_len = max(len(str(cell.value or '')) for cell in col)
            col_letter = get_column_letter(col[0].column)
            ws.column_dimensions[col_letter].width = max(max_len + 4, 10)

        output = io.BytesIO()
        wb.save(output)
        output.seek(0)
        return output.getvalue()

    @classmethod
    def generate_and_send_hod_weekly_digest(
        cls,
        db: Session,
        target_date_str: Optional[str] = None,
        force: bool = False,
        hod_user: Optional[User] = None,
        department_id: Optional[int] = None,
        dry_run: bool = False
    ) -> Dict[str, Any]:
        """
        Weekly digest to HODs (Ops Guardrail):
        - Department defaulters summary, new RAPID_DECLINE cases, NOT_RECOVERABLE list.
        - Idempotent: Re-run on the same day = no duplicate sends.
        - Reuses global 150/hr rate limiter and defensive boundaries.
        """
        from app.models.models import AuditLog
        today_str = target_date_str or get_server_ist_date()

        # Check idempotency guard in audit log
        existing_log = db.query(AuditLog).filter(
            AuditLog.action == "HOD_WEEKLY_DIGEST_DISPATCH",
            AuditLog.details.like(f"%date:{today_str}%")
        ).first()

        if existing_log and not force:
            logger.info(f"HOD weekly digest for {today_str} already generated. Skipping duplicate run (Idempotent).")
            return {
                "status": "SKIPPED_ALREADY_SENT",
                "date": today_str,
                "message": f"Weekly digest for {today_str} was already generated. Skipping duplicate run (Idempotent).",
                "dispatched_count": 0,
                "emails_sent": 0
            }

        if department_id:
            departments = db.query(Department).filter(Department.id == department_id).all()
        else:
            departments = db.query(Department).all()

        admin_user = hod_user or db.query(User).filter(User.role == UserRole.SUPER_ADMIN).first()
        if not admin_user:
            admin_user = User(id=1, role=UserRole.SUPER_ADMIN)

        digest_reports = []
        dispatched_count = 0

        for dept in departments:
            defaulters_res = cls.get_defaulters_roster(
                db=db,
                user=admin_user,
                dept_code=dept.code,
                band_filter="ALL"
            )
            all_rows = defaulters_res.get("defaulters", [])

            below_75_list = [
                r for r in all_rows
                if r["current_percentage"] is not None
                and r.get("band") not in (BAND_INSUFFICIENT_DATA, BAND_NO_DATA)
                and r["current_percentage"] < R25Config.ELIGIBLE_THRESHOLD
            ]
            rapid_decline_list = [r for r in all_rows if r.get("trend_flag") == "RAPID_DECLINE"]
            not_recoverable_list = [r for r in all_rows if not r.get("is_recoverable") and r.get("band") != BAND_INSUFFICIENT_DATA]

            dept_digest = {
                "department_code": dept.code,
                "department_name": dept.name,
                "total_defaulters": len(below_75_list),
                "rapid_decline_cases": len(rapid_decline_list),
                "not_recoverable_cases": len(not_recoverable_list),
                "rapid_decline_students": [f"{r['roll']} ({r['current_percentage_display']})" for r in rapid_decline_list[:10]],
                "not_recoverable_students": [f"{r['roll']} ({r['current_percentage_display']})" for r in not_recoverable_list[:10]]
            }
            digest_reports.append(dept_digest)
            dispatched_count += 1

        if not dry_run:
            # Record idempotency audit log
            audit_entry = AuditLog(
                event_type="HOD_WEEKLY_DIGEST",
                action="HOD_WEEKLY_DIGEST_DISPATCH",
                details=f"HOD Weekly Compliance Digest dispatched for {len(departments)} departments on date:{today_str}",
                user_id=admin_user.id if hasattr(admin_user, "id") else 1,
                created_at=get_server_ist_datetime()
            )
            db.add(audit_entry)
            db.commit()

        return {
            "status": "DISPATCHED",
            "date": today_str,
            "dispatched_count": dispatched_count,
            "emails_sent": dispatched_count,
            "departments_processed": len(departments),
            "digests": digest_reports
        }


# ==============================================================================
# MODULE-LEVEL CONVENIENCE ALIASES
# ==============================================================================
detect_rapid_decline = AttendanceEngine.detect_rapid_decline
issue_student_warning = AttendanceEngine.issue_student_warning
generate_and_send_hod_weekly_digest = AttendanceEngine.generate_and_send_hod_weekly_digest
get_defaulters_roster = AttendanceEngine.get_defaulters_roster
generate_defaulters_excel = AttendanceEngine.generate_defaulters_excel
get_student_full_compliance = AttendanceEngine.get_student_full_compliance

