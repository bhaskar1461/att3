from sqlalchemy import Column, Integer, BigInteger, String, Boolean, DateTime, Text, Float, Enum as SQLEnum, Index, UniqueConstraint, ForeignKey, text
from sqlalchemy.orm import relationship
from datetime import datetime
import enum
from app.core.database import Base

class UserRole(str, enum.Enum):
    SUPER_ADMIN = "SUPER_ADMIN"
    TEACHER = "TEACHER"
    STUDENT = "STUDENT"

class AttendanceStatus(str, enum.Enum):
    PRESENT = "PRESENT"
    ABSENT = "ABSENT"
    LATE = "LATE"

class SessionStatus(str, enum.Enum):
    OPEN = "OPEN"
    LOCKED = "LOCKED"

class BindingStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    EXPIRED = "EXPIRED"
    REVOKED = "REVOKED"
    LOCKED = "LOCKED"

class RevokedReason(str, enum.Enum):
    REBIND = "rebind"
    ADMIN_RESET = "admin_reset"
    CHURN_LIMIT = "churn_limit"
    STUDENT_REQUEST = "student_request"

class EnrolledVia(str, enum.Enum):
    SELF = "self"
    FACULTY_RESET = "faculty_reset"
    RECOVERY = "recovery"

# --- Onboarding & Credential Dispatch Enums ---

class OnboardingState(str, enum.Enum):
    PENDING_ONBOARDING = "PENDING_ONBOARDING"
    LINK_SENT = "LINK_SENT"
    LINK_OPENED = "LINK_OPENED"
    ACTIVATED = "ACTIVATED"
    EXPIRED = "EXPIRED"
    SUSPENDED = "SUSPENDED"

class CredentialEmailStatus(str, enum.Enum):
    PENDING = "PENDING"
    SENT = "SENT"
    FAILED = "FAILED"

class RebindRequestStatus(str, enum.Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    DENIED = "DENIED"
    AUTO_APPROVED = "AUTO_APPROVED"

class SecurityEventType(str, enum.Enum):
    LOGIN_SUCCESS = "LOGIN_SUCCESS"
    LOGIN_FAILURE = "LOGIN_FAILURE"
    DEVICE_REGISTERED = "DEVICE_REGISTERED"
    DEVICE_BOUND = "DEVICE_BOUND"
    ACCOUNT_SWITCH_ATTEMPT = "ACCOUNT_SWITCH_ATTEMPT"
    BINDING_EXPIRED = "BINDING_EXPIRED"
    AUTH_ATTEMPT_LIMIT_REACHED = "AUTH_ATTEMPT_LIMIT_REACHED"
    SESSION_EXPIRED = "SESSION_EXPIRED"
    DEVICE_REVOKED = "DEVICE_REVOKED"
    ATTENDANCE_SUBMITTED = "ATTENDANCE_SUBMITTED"
    ATTENDANCE_REJECTED = "ATTENDANCE_REJECTED"
    SUSPICIOUS_CONCURRENT_SCAN = "SUSPICIOUS_CONCURRENT_SCAN"
    UNAPPROVED_DEVICE_LOGIN = "UNAPPROVED_DEVICE_LOGIN"
    DEVICE_ENROLLMENT_AUTO = "DEVICE_ENROLLMENT_AUTO"
    DEVICE_ENROLLMENT_RESET = "DEVICE_ENROLLMENT_RESET"
    DEVICE_SELF_RESET = "DEVICE_SELF_RESET"
    DEVICE_SELF_RESET_CAP_EXCEEDED = "DEVICE_SELF_RESET_CAP_EXCEEDED"
    DEVICE_ADMIN_RESET = "DEVICE_ADMIN_RESET"
    DEVICE_VERIFIED = "DEVICE_VERIFIED"
    DEVICE_VERIFICATION_FAILED = "DEVICE_VERIFICATION_FAILED"
    DEVICE_RE_REGISTERED = "DEVICE_RE_REGISTERED"
    DEVICE_LIMIT_REACHED = "DEVICE_LIMIT_REACHED"
    DEVICE_CHALLENGE_EXPIRED = "DEVICE_CHALLENGE_EXPIRED"
    DEVICE_CHALLENGE_REPLAYED = "DEVICE_CHALLENGE_REPLAYED"
    DEVICE_KEY_MISSING = "DEVICE_KEY_MISSING"
    DEVICE_KEY_REUSE_REJECTED = "DEVICE_KEY_REUSE_REJECTED"
    PWA_TELEMETRY = "PWA_TELEMETRY"

class User(Base):
    __tablename__ = "qr_users"

    id = Column(Integer, primary_key=True)
    username = Column(String(50), unique=True, nullable=False)
    email = Column(String(100), unique=True, nullable=True)
    password_hash = Column(String(255), nullable=False)
    role = Column(SQLEnum(UserRole), default=UserRole.STUDENT, nullable=False)
    is_active = Column(Boolean, default=True)
    must_change_password = Column(Boolean, default=False)  # Enforced on first login after credential dispatch
    created_at = Column(DateTime, default=datetime.utcnow)

    teacher_profile = relationship("Teacher", primaryjoin="User.id==Teacher.user_id", foreign_keys="[Teacher.user_id]", uselist=False)
    student_profile = relationship("Student", primaryjoin="User.id==Student.user_id", foreign_keys="[Student.user_id]", uselist=False)
    audit_logs = relationship("AuditLog", primaryjoin="User.id==AuditLog.user_id", foreign_keys="[AuditLog.user_id]")

class Department(Base):
    __tablename__ = "qr_departments"

    id = Column(Integer, primary_key=True)
    code = Column(String(20), unique=True, nullable=False) # e.g. CSE, ECE
    name = Column(String(100), nullable=False)

    sections = relationship("Section", primaryjoin="Department.id==Section.department_id", foreign_keys="[Section.department_id]")
    subjects = relationship("Subject", primaryjoin="Department.id==Subject.department_id", foreign_keys="[Subject.department_id]")
    teachers = relationship("Teacher", primaryjoin="Department.id==Teacher.department_id", foreign_keys="[Teacher.department_id]")
    students = relationship("Student", primaryjoin="Department.id==Student.department_id", foreign_keys="[Student.department_id]")

class AcademicYear(Base):
    __tablename__ = "qr_academic_years"

    id = Column(Integer, primary_key=True)
    name = Column(String(50), nullable=False) # e.g. 1st Year, 2nd Year, 3rd Year, 4th Year

    sections = relationship("Section", primaryjoin="AcademicYear.id==Section.academic_year_id", foreign_keys="[Section.academic_year_id]")
    subjects = relationship("Subject", primaryjoin="AcademicYear.id==Subject.academic_year_id", foreign_keys="[Subject.academic_year_id]")
    students = relationship("Student", primaryjoin="AcademicYear.id==Student.academic_year_id", foreign_keys="[Student.academic_year_id]")

class Section(Base):
    __tablename__ = "qr_sections"

    id = Column(Integer, primary_key=True)
    name = Column(String(50), nullable=False) # e.g. CSE-A, CSE-B
    department_id = Column(Integer, nullable=False)
    academic_year_id = Column(Integer, nullable=False)

    department = relationship("Department", primaryjoin="Section.department_id==Department.id", foreign_keys="[Section.department_id]", overlaps="sections")
    academic_year = relationship("AcademicYear", primaryjoin="Section.academic_year_id==AcademicYear.id", foreign_keys="[Section.academic_year_id]", overlaps="sections")
    students = relationship("Student", primaryjoin="Section.id==Student.section_id", foreign_keys="[Student.section_id]")
    assignments = relationship("TeacherAssignment", primaryjoin="Section.id==TeacherAssignment.section_id", foreign_keys="[TeacherAssignment.section_id]")

class Subject(Base):
    __tablename__ = "qr_subjects"

    id = Column(Integer, primary_key=True)
    code = Column(String(30), unique=True, nullable=False) # e.g. CS301
    name = Column(String(150), nullable=False)
    department_id = Column(Integer, nullable=False)
    academic_year_id = Column(Integer, nullable=False)

    department = relationship("Department", primaryjoin="Subject.department_id==Department.id", foreign_keys="[Subject.department_id]", overlaps="subjects")
    academic_year = relationship("AcademicYear", primaryjoin="Subject.academic_year_id==AcademicYear.id", foreign_keys="[Subject.academic_year_id]", overlaps="subjects")
    assignments = relationship("TeacherAssignment", primaryjoin="Subject.id==TeacherAssignment.subject_id", foreign_keys="[TeacherAssignment.subject_id]")

class Teacher(Base):
    __tablename__ = "qr_teachers"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, unique=True, nullable=False)
    teacher_code = Column(String(50), unique=True, nullable=False)
    name = Column(String(100), nullable=False)
    department_id = Column(Integer, nullable=False)
    mobile = Column(String(20), nullable=True)
    google_sheet_id = Column(String(255), nullable=True)

    user = relationship("User", primaryjoin="Teacher.user_id==User.id", foreign_keys="[Teacher.user_id]", back_populates="teacher_profile")
    department = relationship("Department", primaryjoin="Teacher.department_id==Department.id", foreign_keys="[Teacher.department_id]", back_populates="teachers")
    assignments = relationship("TeacherAssignment", primaryjoin="Teacher.id==TeacherAssignment.teacher_id", foreign_keys="[TeacherAssignment.teacher_id]", back_populates="teacher")
    sessions = relationship("AttendanceSession", primaryjoin="Teacher.id==AttendanceSession.teacher_id", foreign_keys="[AttendanceSession.teacher_id]", back_populates="teacher")

class Student(Base):
    __tablename__ = "qr_students"
    __table_args__ = (
        Index("idx_student_section", "section_id"),
        Index("idx_student_dept_year_sec", "department_id", "academic_year_id", "section_id"),
    )

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, unique=True, nullable=True)
    roll_number = Column(String(50), unique=True, nullable=False)
    name = Column(String(100), nullable=False)
    department_id = Column(Integer, nullable=True)  # Nullable to support Unassigned department reconciliation
    academic_year_id = Column(Integer, nullable=True)
    section_id = Column(Integer, nullable=True)
    email = Column(String(100), nullable=True)
    mobile = Column(String(20), nullable=True)
    agency = Column(String(100), default="Regular")
    registered_device_id = Column(Integer, nullable=True)  # Bi-directional device binding (Layer 2 anti-proxy)
    join_date = Column(String(20), nullable=True)  # YYYY-MM-DD for late-join proration
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", primaryjoin="Student.user_id==User.id", foreign_keys="[Student.user_id]", back_populates="student_profile")
    department = relationship("Department", primaryjoin="Student.department_id==Department.id", foreign_keys="[Student.department_id]", back_populates="students")
    academic_year = relationship("AcademicYear", primaryjoin="Student.academic_year_id==AcademicYear.id", foreign_keys="[Student.academic_year_id]", back_populates="students")
    section = relationship("Section", primaryjoin="Student.section_id==Section.id", foreign_keys="[Student.section_id]", back_populates="students")
    records = relationship("AttendanceRecord", primaryjoin="Student.id==AttendanceRecord.student_id", foreign_keys="[AttendanceRecord.student_id]", back_populates="student")
    qr_tokens = relationship("QRToken", primaryjoin="Student.id==QRToken.student_id", foreign_keys="[QRToken.student_id]", back_populates="student")
    device_bindings = relationship("DeviceBinding", primaryjoin="Student.id==DeviceBinding.student_id", foreign_keys="[DeviceBinding.student_id]", back_populates="student")

class TeacherAssignment(Base):
    __tablename__ = "qr_teacher_assignments"

    id = Column(Integer, primary_key=True)
    teacher_id = Column(Integer, nullable=False)
    subject_id = Column(Integer, nullable=False)
    section_id = Column(Integer, nullable=False)
    excel_file_name = Column(String(255), nullable=True)
    excel_file_path = Column(String(500), nullable=True)
    google_sheet_id = Column(String(255), nullable=True)

    teacher = relationship("Teacher", primaryjoin="TeacherAssignment.teacher_id==Teacher.id", foreign_keys="[TeacherAssignment.teacher_id]", back_populates="assignments")
    subject = relationship("Subject", primaryjoin="TeacherAssignment.subject_id==Subject.id", foreign_keys="[TeacherAssignment.subject_id]", back_populates="assignments")
    section = relationship("Section", primaryjoin="TeacherAssignment.section_id==Section.id", foreign_keys="[TeacherAssignment.section_id]", back_populates="assignments")

class AttendanceSession(Base):
    __tablename__ = "qr_attendance_sessions"
    __table_args__ = (
        Index("idx_att_sess_teacher_date", "teacher_id", "session_date"),
        Index("idx_att_sess_subject_date", "subject_id", "session_date"),
        Index("idx_att_sess_section_date", "section_id", "session_date"),
        Index("idx_att_sess_teacher_created", "teacher_id", "created_at"),
    )

    id = Column(Integer, primary_key=True)
    teacher_id = Column(Integer, nullable=False)
    subject_id = Column(Integer, nullable=False)
    section_id = Column(Integer, nullable=False)
    period = Column(String(100), nullable=False) # e.g. Period 1, Period 1-4 (4 Periods)
    session_date = Column(String(20), nullable=False) # YYYY-MM-DD
    status = Column(SQLEnum(SessionStatus), default=SessionStatus.OPEN, nullable=False)
    display_type = Column(String(30), default="projector", nullable=True) # 'projector' | 'phone_screen' | 'laptop'
    faculty_latitude = Column(Float, nullable=True)
    faculty_longitude = Column(Float, nullable=True)
    faculty_accuracy_m = Column(Float, nullable=True)
    geofence_radius_m = Column(Float, default=100.0, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    locked_at = Column(DateTime, nullable=True)

    teacher = relationship("Teacher", primaryjoin="AttendanceSession.teacher_id==Teacher.id", foreign_keys="[AttendanceSession.teacher_id]", back_populates="sessions")
    subject = relationship("Subject", primaryjoin="AttendanceSession.subject_id==Subject.id", foreign_keys="[AttendanceSession.subject_id]")
    section = relationship("Section", primaryjoin="AttendanceSession.section_id==Section.id", foreign_keys="[AttendanceSession.section_id]")
    records = relationship("AttendanceRecord", primaryjoin="AttendanceSession.id==AttendanceRecord.session_id", foreign_keys="[AttendanceRecord.session_id]", back_populates="session", cascade="all, delete-orphan")

class AttendanceRecord(Base):
    __tablename__ = "qr_attendance_records"
    __table_args__ = (
        Index("idx_att_rec_session_student", "session_id", "student_id"),
        Index("idx_att_rec_student_id", "student_id"),
        Index("idx_att_rec_date", "session_date"),
        UniqueConstraint("session_id", "student_id", name="uq_session_student_attendance"),
    )

    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, nullable=False)
    student_id = Column(Integer, nullable=False)
    roll_number = Column(String(50), nullable=False)
    session_date = Column(String(20), nullable=False)
    period_count = Column(Integer, default=4, nullable=True)
    status = Column(SQLEnum(AttendanceStatus), default=AttendanceStatus.PRESENT, nullable=False)
    is_approved_absence = Column(Boolean, default=False, nullable=False, index=True)
    approved_absence_reason = Column(String(100), nullable=True) # e.g. MEDICAL, SPORTS, DUTY
    scan_mode = Column(String(50), default="QR") # QR or MANUAL or PROJECTOR_SCAN or QR_CAMERA_FALLBACK
    manual_reason = Column(String(50), nullable=True) # scanner_failed | device_lost | late_join | other
    manual_reason_detail = Column(String(255), nullable=True)
    manual_marked_by_id = Column(Integer, nullable=True) # Faculty user_id
    student_latitude = Column(Float, nullable=True)
    student_longitude = Column(Float, nullable=True)
    gps_accuracy_m = Column(Float, nullable=True)
    distance_m = Column(Float, nullable=True)
    device_binding_id = Column(Integer, nullable=True)
    selfie_status = Column(String(30), nullable=True) # PENDING | ACCEPTED | FAILED | SKIPPED
    selfie_storage_key = Column(String(255), nullable=True)
    entry_method = Column(String(30), nullable=True)  # WEB_CAMERA | WEB_URL | WEB_PASTE | ANDROID_APP | WEB_FALLBACK | None (legacy)
    scanned_at = Column(DateTime, default=datetime.utcnow)

    session = relationship("AttendanceSession", primaryjoin="AttendanceRecord.session_id==AttendanceSession.id", foreign_keys="[AttendanceRecord.session_id]", back_populates="records")
    student = relationship("Student", primaryjoin="AttendanceRecord.student_id==Student.id", foreign_keys="[AttendanceRecord.student_id]", back_populates="records")
    selfie = relationship("SelfieRecord", primaryjoin="AttendanceRecord.id==SelfieRecord.attendance_id", foreign_keys="[SelfieRecord.attendance_id]", uselist=False, back_populates="attendance_record", cascade="all, delete-orphan")

class SelfieRecord(Base):
    """
    Selfie metadata and private storage pointer collected post-attendance for future face-verification preparation.
    Attendance validity is NEVER conditional on selfie success.
    """
    __tablename__ = "selfie_records"
    __table_args__ = (
        Index("idx_selfie_att", "attendance_id"),
        Index("idx_selfie_student", "student_id"),
        Index("idx_selfie_session", "session_id"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    attendance_id = Column(Integer, nullable=False)
    student_id = Column(Integer, nullable=False)
    session_id = Column(Integer, nullable=False)
    object_storage_key = Column(String(255), unique=True, nullable=False)
    mime_type = Column(String(50), default="image/jpeg", nullable=False)
    file_size = Column(Integer, default=0, nullable=False)
    width = Column(Integer, nullable=True)
    height = Column(Integer, nullable=True)
    quality_status = Column(String(30), default="PASSED", nullable=False)
    face_count = Column(Integer, default=1, nullable=False)
    captured_at = Column(DateTime, nullable=True)
    uploaded_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    status = Column(String(30), default="UPLOADED", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    attendance_record = relationship("AttendanceRecord", primaryjoin="SelfieRecord.attendance_id==AttendanceRecord.id", foreign_keys="[SelfieRecord.attendance_id]", back_populates="selfie")
    student = relationship("Student", primaryjoin="SelfieRecord.student_id==Student.id", foreign_keys="[SelfieRecord.student_id]")
    session = relationship("AttendanceSession", primaryjoin="SelfieRecord.session_id==AttendanceSession.id", foreign_keys="[SelfieRecord.session_id]")

class QRToken(Base):
    __tablename__ = "qr_tokens"

    id = Column(Integer, primary_key=True)
    student_id = Column(Integer, nullable=False)
    encrypted_token = Column(Text, nullable=False)
    token_hash = Column(String(100), unique=True, nullable=False)
    is_active = Column(Boolean, default=True)
    expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    student = relationship("Student", primaryjoin="QRToken.student_id==Student.id", foreign_keys="[QRToken.student_id]", back_populates="qr_tokens")

class ShortTokenRegistry(Base):
    """
    Week 3 Short-Token Registry:
    Maps compact 8-character Crockford Base32 short codes to active session IDs.
    Indexed by short_code for O(1) in-memory/DB lookup with zero scan-path latency overhead.
    """
    __tablename__ = "qr_short_tokens"
    __table_args__ = (
        Index("idx_short_token_code", "short_code", unique=True),
        Index("idx_short_token_session", "session_id"),
    )

    id = Column(Integer, primary_key=True)
    short_code = Column(String(16), unique=True, nullable=False, index=True)
    session_id = Column(Integer, nullable=False, index=True)
    issued_slot = Column(Integer, nullable=False)
    expires_slot = Column(Integer, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

class SystemSettings(Base):
    __tablename__ = "qr_system_settings"

    id = Column(Integer, primary_key=True)
    key = Column(String(100), unique=True, nullable=False)
    value = Column(Text, nullable=False)
    description = Column(String(255), nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class DeviceRegistration(Base):
    __tablename__ = "qr_device_registrations"

    id = Column(Integer, primary_key=True)
    device_public_id = Column(String(100), unique=True, nullable=False, index=True)
    device_credential_hash = Column(String(255), nullable=False)
    first_registered_at = Column(DateTime, default=datetime.utcnow)
    last_seen_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    bindings = relationship("DeviceAccountBinding", primaryjoin="DeviceRegistration.id==DeviceAccountBinding.device_id", foreign_keys="[DeviceAccountBinding.device_id]")

class DeviceAccountBinding(Base):
    __tablename__ = "qr_device_account_bindings"
    __table_args__ = (
        Index("idx_dev_bind_lookup", "device_id", "status", "expires_at"),
        Index("idx_dev_bind_roll", "roll_number"),
    )

    id = Column(Integer, primary_key=True)
    device_id = Column(Integer, nullable=False, index=True)
    roll_number = Column(String(50), nullable=False, index=True)
    bound_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    attempt_count = Column(Integer, default=1, nullable=False)
    last_authentication_at = Column(DateTime, default=datetime.utcnow)
    status = Column(SQLEnum(BindingStatus), default=BindingStatus.ACTIVE, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    device = relationship("DeviceRegistration", primaryjoin="DeviceAccountBinding.device_id==DeviceRegistration.id", foreign_keys="[DeviceAccountBinding.device_id]", back_populates="bindings")

class AuditLog(Base):
    __tablename__ = "qr_audit_logs"
    __table_args__ = (
        Index("idx_audit_created_at", "created_at"),
        Index("idx_audit_created_user", "created_at", "user_id"),
        Index("idx_audit_roll", "roll_number"),
        Index("idx_audit_event_type", "event_type"),
    )

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, nullable=True)
    roll_number = Column(String(50), nullable=True)
    device_id = Column(Integer, nullable=True)
    event_type = Column(String(50), nullable=True)
    action = Column(String(100), nullable=False)
    details = Column(Text, nullable=True)
    ip_address = Column(String(50), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", primaryjoin="AuditLog.user_id==User.id", foreign_keys="[AuditLog.user_id]", back_populates="audit_logs")


# ============================================================
# DEVICE BINDING V2 MODELS (NON-EXTRACTABLE CLIENT KEYPAIRS)
# ============================================================

class DeviceBinding(Base):
    """
    Binding V2: Non-extractable asymmetric client keypair binding & Cryptographic Device Identity.
    Enforces device authorization strictly via private key possession proof.
    Physical hardware metadata is purely informational telemetry and never participates in authorization.
    """
    __tablename__ = "device_bindings"
    __table_args__ = (
        Index("idx_dev_bind_key_id", "key_id"),
        Index("idx_dev_bind_device_id", "device_id"),
        Index("idx_dev_bind_student", "student_id"),
        Index("idx_dev_bind_status", "status"),
        Index("idx_dev_bind_revoked", "revoked_at"),
        Index("uq_student_active_binding", "student_id", unique=True, sqlite_where=text("revoked_at IS NULL")),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    student_id = Column(Integer, nullable=False)
    device_id = Column(String(64), nullable=True, index=True)  # Client-generated random UUID v4 identifier
    public_key = Column(Text, nullable=False)  # SPKI DER Base64 (91 bytes raw / 124 chars Base64)
    key_id = Column(String(64), nullable=False)  # SHA-256 hex digest of SPKI
    key_algorithm = Column(String(32), default="ECDSA_P256", nullable=False)
    key_version = Column(Integer, default=1, nullable=False)
    client_type = Column(String(20), default="WEB", nullable=False)  # WEB | PWA | ANDROID
    status = Column(String(20), default="ACTIVE", nullable=False)  # ACTIVE | REVOKED | PENDING
    enrolled_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    enrolled_via = Column(String(30), default="self", nullable=False)  # self | faculty_reset | recovery
    storage_persist_granted = Column(Boolean, default=False, nullable=False)
    browser_profile_tag = Column(String(64), nullable=True)  # Telemetry-only corroboration tag
    last_seen_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_verified_at = Column(DateTime, nullable=True)
    revoked_at = Column(DateTime, nullable=True)
    revoked_reason = Column(String(30), nullable=True)  # rebind | admin_reset | churn_limit | student_request

    # Informational audit metadata (strictly telemetry only; NEVER for authorization/identity)
    device_label = Column(String(100), nullable=True)
    platform = Column(String(50), nullable=True)
    browser_family = Column(String(50), nullable=True)
    app_version = Column(String(30), nullable=True)
    registered_user_agent_metadata = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    student = relationship("Student", primaryjoin="DeviceBinding.student_id==Student.id", foreign_keys="[DeviceBinding.student_id]")


class DeviceRebindOTP(Base):
    """
    Stores single-use 6-digit email OTPs for high-friction device re-enrollment / rebind.
    """
    __tablename__ = "qr_device_rebind_otps"
    __table_args__ = (
        Index("idx_rebind_otp_student", "student_id"),
        Index("idx_rebind_otp_created", "created_at"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    student_id = Column(Integer, nullable=False)
    otp_hash = Column(String(64), nullable=False)  # SHA-256 of 6-digit code
    expires_at = Column(DateTime, nullable=False)
    attempts = Column(Integer, default=0, nullable=False)
    is_verified = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    student = relationship("Student", primaryjoin="DeviceRebindOTP.student_id==Student.id", foreign_keys="[DeviceRebindOTP.student_id]")


# ============================================================
# ONBOARDING & CREDENTIAL DISPATCH MODELS
# ============================================================

class StudentOnboarding(Base):
    """Tracks each student's onboarding state machine. One row per student."""
    __tablename__ = "qr_student_onboarding"
    __table_args__ = (
        Index("idx_onboard_roll", "roll_number"),
        Index("idx_onboard_state", "state"),
        Index("idx_onboard_device_uuid", "device_uuid"),
        Index("idx_onboard_section", "section_id"),
    )

    id = Column(Integer, primary_key=True)
    student_id = Column(Integer, nullable=True, unique=True)  # FK to qr_students.id — set on activation
    roll_number = Column(String(50), unique=True, nullable=False)  # Canonical identity key
    name = Column(String(100), nullable=False)
    email = Column(String(150), nullable=True)  # Generated college email (pattern-based)
    section = Column(String(50), nullable=True)  # Section letter from Excel
    department = Column(String(50), nullable=True)  # Department code
    gender = Column(String(20), nullable=True)
    academic_year = Column(String(50), nullable=True)
    semester = Column(String(20), nullable=True)
    state = Column(SQLEnum(OnboardingState), default=OnboardingState.PENDING_ONBOARDING, nullable=False)
    class_incharge_email = Column(String(150), nullable=True)  # Admin-provided at import time
    mobile_number = Column(String(20), nullable=True)  # Set during onboarding Step 2
    mobile_verified = Column(Boolean, default=False)
    pin_hash = Column(String(255), nullable=True)  # Set during onboarding Step 3 (4-6 digit PIN)
    device_uuid = Column(String(100), nullable=True)  # Bound device from Step 4
    department_id = Column(Integer, nullable=True)  # FK to qr_departments.id
    academic_year_id = Column(Integer, nullable=True)  # FK to qr_academic_years.id
    section_id = Column(Integer, nullable=True)  # FK to qr_sections.id
    import_batch_ref = Column(String(50), nullable=True)  # Links to import batch for traceability
    link_sent_at = Column(DateTime, nullable=True)
    link_opened_at = Column(DateTime, nullable=True)
    activated_at = Column(DateTime, nullable=True)
    rebind_count = Column(Integer, default=0)  # Incremented on each device rebind; capped per semester
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tokens = relationship("OnboardingToken", primaryjoin="StudentOnboarding.id==OnboardingToken.onboarding_id", foreign_keys="[OnboardingToken.onboarding_id]", back_populates="onboarding")
    otps = relationship("OnboardingOTP", primaryjoin="StudentOnboarding.id==OnboardingOTP.onboarding_id", foreign_keys="[OnboardingOTP.onboarding_id]", back_populates="onboarding")


class OnboardingToken(Base):
    """Magic link tokens — raw token NEVER stored, only SHA-256 hash."""
    __tablename__ = "qr_onboarding_tokens"
    __table_args__ = (
        Index("idx_onboard_token_hash", "token_hash", unique=True),
        Index("idx_onboard_token_active", "onboarding_id", "is_active"),
    )

    id = Column(Integer, primary_key=True)
    onboarding_id = Column(Integer, nullable=False)  # FK to qr_student_onboarding.id
    token_hash = Column(String(128), unique=True, nullable=False)  # SHA-256 hash of raw token
    is_consumed = Column(Boolean, default=False)  # Atomic single-use guard
    is_active = Column(Boolean, default=True)  # Set False when regenerated (invalidates prior links)
    expires_at = Column(DateTime, nullable=False)  # Default now + 48h (configurable)
    created_at = Column(DateTime, default=datetime.utcnow)
    consumed_at = Column(DateTime, nullable=True)  # Set on successful redemption

    onboarding = relationship("StudentOnboarding", primaryjoin="OnboardingToken.onboarding_id==StudentOnboarding.id", foreign_keys="[OnboardingToken.onboarding_id]", back_populates="tokens")


class OnboardingOTP(Base):
    """Email OTP records for verification during onboarding wizard."""
    __tablename__ = "qr_onboarding_otps"

    id = Column(Integer, primary_key=True)
    onboarding_id = Column(Integer, nullable=False)  # FK to qr_student_onboarding.id
    email = Column(String(150), nullable=False)  # Target email for OTP delivery
    otp_hash = Column(String(128), nullable=False)  # SHA-256 hash of 6-digit OTP code
    attempts = Column(Integer, default=0)  # Max 5 before lockout
    is_verified = Column(Boolean, default=False)
    expires_at = Column(DateTime, nullable=False)  # Default now + 10 minutes
    created_at = Column(DateTime, default=datetime.utcnow)

    onboarding = relationship("StudentOnboarding", primaryjoin="OnboardingOTP.onboarding_id==StudentOnboarding.id", foreign_keys="[OnboardingOTP.onboarding_id]", back_populates="otps")


class DeviceResetOTP(Base):
    """Email OTP records for self-service device reset with atomic single-use guard."""
    __tablename__ = "qr_device_reset_otps"
    __table_args__ = (
        Index("idx_dev_reset_roll", "roll_number"),
        Index("idx_dev_reset_created", "created_at"),
    )

    id = Column(Integer, primary_key=True)
    roll_number = Column(String(50), nullable=False, index=True)
    email = Column(String(150), nullable=False)
    otp_hash = Column(String(128), nullable=False)
    attempts = Column(Integer, default=0, nullable=False)
    is_consumed = Column(Boolean, default=False, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class DeviceRebindRequest(Base):
    """Admin-approval device rebinding flow."""
    __tablename__ = "qr_device_rebind_requests"

    id = Column(Integer, primary_key=True)
    onboarding_id = Column(Integer, nullable=False)  # FK to qr_student_onboarding.id
    roll_number = Column(String(50), nullable=False, index=True)
    old_device_uuid = Column(String(100), nullable=True)  # Current bound device
    new_device_uuid = Column(String(100), nullable=True)  # Requested new device
    reason = Column(Text, nullable=True)  # Student-provided reason
    status = Column(SQLEnum(RebindRequestStatus), default=RebindRequestStatus.PENDING, nullable=False)
    reviewed_by = Column(Integer, nullable=True)  # Admin user_id who approved/denied
    reviewed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    onboarding = relationship("StudentOnboarding", primaryjoin="DeviceRebindRequest.onboarding_id==StudentOnboarding.id", foreign_keys="[DeviceRebindRequest.onboarding_id]")


class CredentialBatch(Base):
    """Batch tracking for Module 2 credential email dispatch."""
    __tablename__ = "qr_credential_batches"

    id = Column(Integer, primary_key=True)
    batch_id = Column(String(50), unique=True, nullable=False, index=True)  # UUID-based identifier
    target_role = Column(String(20), nullable=False)  # "student" or "teacher"
    total_count = Column(Integer, default=0)
    sent_count = Column(Integer, default=0)
    failed_count = Column(Integer, default=0)
    is_dry_run = Column(Boolean, default=False)
    created_by = Column(Integer, nullable=True)  # Admin user_id
    created_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)

    items = relationship("CredentialItem", primaryjoin="CredentialBatch.batch_id==CredentialItem.batch_id", foreign_keys="[CredentialItem.batch_id]", back_populates="batch")


class CredentialItem(Base):
    """Per-recipient status within a credential batch."""
    __tablename__ = "qr_credential_items"
    __table_args__ = (
        Index("idx_cred_item_batch", "batch_id"),
        Index("idx_cred_item_sap", "sap_id"),
    )

    id = Column(Integer, primary_key=True)
    batch_id = Column(String(50), nullable=False)  # FK to qr_credential_batches.batch_id
    sap_id = Column(String(50), nullable=False)  # Roll number / teacher code
    name = Column(String(100), nullable=True)  # Recipient name for email personalization
    email = Column(String(150), nullable=False)  # Target email address
    temp_password_hash = Column(String(255), nullable=True)  # bcrypt hash — plaintext ONLY in email body
    status = Column(SQLEnum(CredentialEmailStatus), default=CredentialEmailStatus.PENDING, nullable=False)
    error_detail = Column(Text, nullable=True)  # Failure reason if FAILED
    sent_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    batch = relationship("CredentialBatch", primaryjoin="CredentialItem.batch_id==CredentialBatch.batch_id", foreign_keys="[CredentialItem.batch_id]", back_populates="items")


class OnboardingAuditLog(Base):
    """Dedicated onboarding audit trail — follows qr_audit_logs pattern."""
    __tablename__ = "qr_onboarding_audit_log"

    id = Column(Integer, primary_key=True)
    roll_number = Column(String(50), nullable=True, index=True)
    event_type = Column(String(50), nullable=False)  # LINK_GENERATED, LINK_REDEEMED, OTP_SENT, etc.
    action = Column(String(100), nullable=False)
    details = Column(Text, nullable=True)
    ip_address = Column(String(50), nullable=True)
    performed_by = Column(Integer, nullable=True)  # Admin user_id or null for student self-service
    created_at = Column(DateTime, default=datetime.utcnow)  # Server IST


# ============================================================
# JNTUH R25 COMPLIANCE & CONDONATION MODELS
# ============================================================

class StudentCondonation(Base):
    """Tracks condonation fine status per student per course or semester aggregate."""
    __tablename__ = "qr_student_condonations"
    __table_args__ = (
        Index("idx_condonation_student", "student_id"),
        UniqueConstraint("student_id", "course_id", "academic_year_id", name="uq_student_course_condonation"),
    )

    id = Column(Integer, primary_key=True)
    student_id = Column(Integer, nullable=False, index=True)
    course_id = Column(Integer, nullable=True)  # Nullable: None represents aggregate semester condonation
    academic_year_id = Column(Integer, nullable=True)
    status = Column(String(50), default="pending", nullable=False)  # pending, approved, paid, waived, rejected
    fine_amount = Column(Float, default=0.0)
    remarks = Column(Text, nullable=True)
    updated_by = Column(Integer, nullable=True)  # Admin user_id
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    @staticmethod
    def validate_transition(current_status: str, new_status: str) -> bool:
        """
        Validates condonation state machine transitions:
        - pending -> applied, approved, waived, rejected
        - applied -> approved, fine_paid, waived, rejected
        - approved -> fine_paid, waived
        - fine_paid / waived -> terminal
        - rejected -> terminal (STRICT: no rejected -> applied skip)
        """
        cur = (current_status or "pending").strip().lower()
        nxt = (new_status or "").strip().lower()
        if nxt == "paid":
            nxt = "fine_paid"
        if cur == "paid":
            cur = "fine_paid"

        allowed = {
            "pending": {"pending", "applied", "approved", "waived", "rejected"},
            "applied": {"applied", "approved", "fine_paid", "waived", "rejected"},
            "approved": {"approved", "fine_paid", "waived"},
            "fine_paid": {"fine_paid"},
            "waived": {"waived"},
            "rejected": {"rejected"}
        }
        return nxt in allowed.get(cur, set())


class Semester(Base):
    """Academic semester entities with planned session targets and date ranges."""
    __tablename__ = "qr_semesters"

    id = Column(Integer, primary_key=True)
    name = Column(String(100), nullable=False)  # e.g. "Odd Semester 2026-27"
    academic_year_id = Column(Integer, nullable=True)
    start_date = Column(String(20), nullable=False)  # ISO YYYY-MM-DD
    end_date = Column(String(20), nullable=False)    # ISO YYYY-MM-DD
    total_planned_sessions = Column(Integer, default=60, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    academic_year = relationship("AcademicYear", primaryjoin="Semester.academic_year_id==AcademicYear.id", foreign_keys="[Semester.academic_year_id]")


class FortnightSnapshot(Base):
    """Fortnightly certified attendance snapshot records (Compliance certification evidence)."""
    __tablename__ = "qr_fortnight_snapshots"
    __table_args__ = (
        Index("idx_fn_student_course", "student_id", "course_id"),
        Index("idx_fn_semester_num", "semester_id", "fortnight_number"),
        UniqueConstraint("student_id", "course_id", "semester_id", "fortnight_number", name="uq_student_course_semester_fortnight"),
    )

    id = Column(Integer, primary_key=True)
    semester_id = Column(Integer, nullable=True)
    fortnight_number = Column(Integer, nullable=False)
    start_date = Column(String(20), nullable=True)
    end_date = Column(String(20), nullable=True)
    student_id = Column(Integer, nullable=False, index=True)
    course_id = Column(Integer, nullable=True)  # Nullable: None represents aggregate semester fortnight
    sessions_held = Column(Integer, default=0, nullable=False)
    sessions_present = Column(Integer, default=0, nullable=False)
    percentage = Column(Float, nullable=True)
    band = Column(String(50), nullable=True)
    certified_by = Column(Integer, nullable=True)  # User ID who certified
    certified_at = Column(DateTime, nullable=True)
    is_countersigned = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    student = relationship("Student", primaryjoin="FortnightSnapshot.student_id==Student.id", foreign_keys="[FortnightSnapshot.student_id]")
    course = relationship("Subject", primaryjoin="FortnightSnapshot.course_id==Subject.id", foreign_keys="[FortnightSnapshot.course_id]")
    semester = relationship("Semester", primaryjoin="FortnightSnapshot.semester_id==Semester.id", foreign_keys="[FortnightSnapshot.semester_id]")


class StudentWarning(Base):
    """Immutable early-warning alert snapshots issued to students trending toward detention."""
    __tablename__ = "qr_student_warnings"
    __table_args__ = (
        Index("idx_warning_student", "student_id"),
        Index("idx_warning_course", "course_id"),
        Index("idx_warning_issued_at", "issued_at"),
        Index("idx_warning_student_course", "student_id", "course_id"),
    )

    id = Column(Integer, primary_key=True)
    student_id = Column(Integer, nullable=False, index=True)
    course_id = Column(Integer, nullable=True)  # Nullable: None represents aggregate warning
    semester_id = Column(Integer, nullable=True)
    warning_type = Column(String(50), default="ATTENDANCE_DEFICIT", nullable=False)  # ATTENDANCE_DEFICIT, RAPID_DECLINE, NOT_RECOVERABLE
    # Immutable snapshot numbers at time of warning issuance
    percentage_at_issue = Column(Float, nullable=False)
    band_at_issue = Column(String(50), nullable=False)
    classes_needed_at_issue = Column(Integer, nullable=True)
    sessions_held_at_issue = Column(Integer, nullable=True)
    sessions_present_at_issue = Column(Integer, nullable=True)
    issued_by_user_id = Column(Integer, nullable=False)
    issued_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    message = Column(Text, nullable=True)
    parent_notified = Column(Boolean, default=False, nullable=False)
    parent_notification_status = Column(String(50), default="SKIPPED_DISABLED", nullable=True)  # SENT, SKIPPED_DISABLED, LOGGED_NO_GATEWAY, FAILED
    parent_email = Column(String(150), nullable=True)
    parent_notified_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    student = relationship("Student", primaryjoin="StudentWarning.student_id==Student.id", foreign_keys="[StudentWarning.student_id]")
    course = relationship("Subject", primaryjoin="StudentWarning.course_id==Subject.id", foreign_keys="[StudentWarning.course_id]")
    semester = relationship("Semester", primaryjoin="StudentWarning.semester_id==Semester.id", foreign_keys="[StudentWarning.semester_id]")


class ScanTelemetryEvent(Base):
    """
    Raw QR scan funnel events (retention: 30 days).
    Strictly NO PII: stores pipeline stages, device tiers, timings, and error types.
    """
    __tablename__ = "qr_scan_telemetry_events"
    __table_args__ = (
        Index("idx_scan_tel_created_at", "created_at"),
        Index("idx_scan_tel_session_id", "session_id"),
    )

    id = Column(Integer, primary_key=True)
    session_id = Column(String(100), nullable=True)
    event_type = Column(String(50), nullable=False)
    stage = Column(String(50), nullable=True)
    error_type = Column(String(50), nullable=True)
    device_bucket = Column(String(20), nullable=False)  # 'old', 'mid', 'new'
    duration_ms = Column(Float, nullable=True)
    decode_duration_ms = Column(Float, nullable=True)  # delta from first_frame_captured to frame_decoded
    display_type = Column(String(30), default="projector", nullable=True)  # 'projector' | 'phone_screen' | 'laptop'
    token_format = Column(String(20), nullable=True)  # 'legacy' | 'short'
    render_version = Column(String(20), default="v1", nullable=True)  # 'v1' | 'v2'
    engine = Column(String(20), default="jsqr", nullable=True)  # 'jsqr' | 'wasm'
    distance_bucket = Column(String(20), nullable=True)  # '<=5m' | '5-10m' | '10-15m'
    decode_scale = Column(Integer, nullable=True)  # 640 | 960 | 1080
    ladder_rung = Column(Integer, nullable=True)  # 1 to 5 (Part B Degradation Ladder)
    from_rung = Column(Integer, nullable=True)  # Previous ladder rung
    app_version = Column(String(30), nullable=True)
    payload_json = Column(Text, nullable=True)  # sanitized JSON metadata (strictly no PII)
    client_timestamp = Column(BigInteger, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class ScanTelemetryDailyRollup(Base):
    """
    Aggregated historical daily scan metrics per device bucket (kept indefinitely).
    Generated by nightly rollup job on the background worker budget.
    """
    __tablename__ = "qr_scan_telemetry_daily_rollup"
    __table_args__ = (
        UniqueConstraint("date", "device_bucket", name="uq_telemetry_date_bucket"),
    )

    id = Column(Integer, primary_key=True)
    date = Column(String(20), nullable=False)  # ISO YYYY-MM-DD
    device_bucket = Column(String(20), nullable=False)  # 'old', 'mid', 'new', 'all'
    total_scans_started = Column(Integer, default=0, nullable=False)
    total_scans_confirmed = Column(Integer, default=0, nullable=False)
    first_attempt_success_count = Column(Integer, default=0, nullable=False)
    first_attempt_success_rate = Column(Float, default=0.0, nullable=False)
    legacy_format_count = Column(Integer, default=0, nullable=False)
    short_format_count = Column(Integer, default=0, nullable=False)
    avg_time_to_mark_ms = Column(Float, default=0.0, nullable=False)
    p50_time_to_mark_ms = Column(Float, default=0.0, nullable=False)
    p95_time_to_mark_ms = Column(Float, default=0.0, nullable=False)
    stage_dropoffs_json = Column(Text, nullable=True)  # JSON dict of counts per stage
    failure_counts_json = Column(Text, nullable=True)  # JSON dict of counts per error_type
    decode_p50_ms = Column(Float, nullable=True)
    decode_p95_ms = Column(Float, nullable=True)
    decode_histogram_json = Column(Text, nullable=True)  # JSON dict with brackets: <1s, 1-3s, 3-5s, 5-8s, 8-15s, >15s
    manual_searches_count = Column(Integer, default=0, nullable=False)
    manual_marks_count = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


