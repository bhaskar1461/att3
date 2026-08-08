from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, Float, Enum as SQLEnum
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

class User(Base):
    __tablename__ = "qr_users"

    id = Column(Integer, primary_key=True)
    username = Column(String(50), unique=True, nullable=False)
    email = Column(String(100), unique=True, nullable=True)
    password_hash = Column(String(255), nullable=False)
    role = Column(SQLEnum(UserRole), default=UserRole.STUDENT, nullable=False)
    is_active = Column(Boolean, default=True)
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

    department = relationship("Department", primaryjoin="Section.department_id==Department.id", foreign_keys="[Section.department_id]")
    academic_year = relationship("AcademicYear", primaryjoin="Section.academic_year_id==AcademicYear.id", foreign_keys="[Section.academic_year_id]")
    students = relationship("Student", primaryjoin="Section.id==Student.section_id", foreign_keys="[Student.section_id]")
    assignments = relationship("TeacherAssignment", primaryjoin="Section.id==TeacherAssignment.section_id", foreign_keys="[TeacherAssignment.section_id]")

class Subject(Base):
    __tablename__ = "qr_subjects"

    id = Column(Integer, primary_key=True)
    code = Column(String(30), unique=True, nullable=False) # e.g. CS301
    name = Column(String(150), nullable=False)
    department_id = Column(Integer, nullable=False)
    academic_year_id = Column(Integer, nullable=False)

    department = relationship("Department", primaryjoin="Subject.department_id==Department.id", foreign_keys="[Subject.department_id]")
    academic_year = relationship("AcademicYear", primaryjoin="Subject.academic_year_id==AcademicYear.id", foreign_keys="[Subject.academic_year_id]")
    assignments = relationship("TeacherAssignment", primaryjoin="Subject.id==TeacherAssignment.subject_id", foreign_keys="[TeacherAssignment.subject_id]")

class Teacher(Base):
    __tablename__ = "qr_teachers"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, unique=True, nullable=False)
    teacher_code = Column(String(50), unique=True, nullable=False)
    name = Column(String(100), nullable=False)
    department_id = Column(Integer, nullable=False)
    mobile = Column(String(20), nullable=True)

    user = relationship("User", primaryjoin="Teacher.user_id==User.id", foreign_keys="[Teacher.user_id]", back_populates="teacher_profile")
    department = relationship("Department", primaryjoin="Teacher.department_id==Department.id", foreign_keys="[Teacher.department_id]", back_populates="teachers")
    assignments = relationship("TeacherAssignment", primaryjoin="Teacher.id==TeacherAssignment.teacher_id", foreign_keys="[TeacherAssignment.teacher_id]", back_populates="teacher")
    sessions = relationship("AttendanceSession", primaryjoin="Teacher.id==AttendanceSession.teacher_id", foreign_keys="[AttendanceSession.teacher_id]", back_populates="teacher")

class Student(Base):
    __tablename__ = "qr_students"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, unique=True, nullable=True)
    roll_number = Column(String(50), unique=True, nullable=False)
    name = Column(String(100), nullable=False)
    department_id = Column(Integer, nullable=False)
    academic_year_id = Column(Integer, nullable=False)
    section_id = Column(Integer, nullable=False)
    email = Column(String(100), nullable=True)
    mobile = Column(String(20), nullable=True)
    agency = Column(String(100), default="Regular")
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", primaryjoin="Student.user_id==User.id", foreign_keys="[Student.user_id]", back_populates="student_profile")
    department = relationship("Department", primaryjoin="Student.department_id==Department.id", foreign_keys="[Student.department_id]", back_populates="students")
    academic_year = relationship("AcademicYear", primaryjoin="Student.academic_year_id==AcademicYear.id", foreign_keys="[Student.academic_year_id]", back_populates="students")
    section = relationship("Section", primaryjoin="Student.section_id==Section.id", foreign_keys="[Student.section_id]", back_populates="students")
    records = relationship("AttendanceRecord", primaryjoin="Student.id==AttendanceRecord.student_id", foreign_keys="[AttendanceRecord.student_id]", back_populates="student")
    qr_tokens = relationship("QRToken", primaryjoin="Student.id==QRToken.student_id", foreign_keys="[QRToken.student_id]", back_populates="student")

class TeacherAssignment(Base):
    __tablename__ = "qr_teacher_assignments"

    id = Column(Integer, primary_key=True)
    teacher_id = Column(Integer, nullable=False)
    subject_id = Column(Integer, nullable=False)
    section_id = Column(Integer, nullable=False)

    teacher = relationship("Teacher", primaryjoin="TeacherAssignment.teacher_id==Teacher.id", foreign_keys="[TeacherAssignment.teacher_id]", back_populates="assignments")
    subject = relationship("Subject", primaryjoin="TeacherAssignment.subject_id==Subject.id", foreign_keys="[TeacherAssignment.subject_id]", back_populates="assignments")
    section = relationship("Section", primaryjoin="TeacherAssignment.section_id==Section.id", foreign_keys="[TeacherAssignment.section_id]", back_populates="assignments")

class AttendanceSession(Base):
    __tablename__ = "qr_attendance_sessions"

    id = Column(Integer, primary_key=True)
    teacher_id = Column(Integer, nullable=False)
    subject_id = Column(Integer, nullable=False)
    section_id = Column(Integer, nullable=False)
    period = Column(String(20), nullable=False) # e.g. Period 1, Period 2
    session_date = Column(String(20), nullable=False) # YYYY-MM-DD
    status = Column(SQLEnum(SessionStatus), default=SessionStatus.OPEN, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    locked_at = Column(DateTime, nullable=True)

    teacher = relationship("Teacher", primaryjoin="AttendanceSession.teacher_id==Teacher.id", foreign_keys="[AttendanceSession.teacher_id]", back_populates="sessions")
    subject = relationship("Subject", primaryjoin="AttendanceSession.subject_id==Subject.id", foreign_keys="[AttendanceSession.subject_id]")
    section = relationship("Section", primaryjoin="AttendanceSession.section_id==Section.id", foreign_keys="[AttendanceSession.section_id]")
    records = relationship("AttendanceRecord", primaryjoin="AttendanceSession.id==AttendanceRecord.session_id", foreign_keys="[AttendanceRecord.session_id]", back_populates="session", cascade="all, delete-orphan")

class AttendanceRecord(Base):
    __tablename__ = "qr_attendance_records"

    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, nullable=False)
    student_id = Column(Integer, nullable=False)
    roll_number = Column(String(50), nullable=False)
    session_date = Column(String(20), nullable=False)
    status = Column(SQLEnum(AttendanceStatus), default=AttendanceStatus.PRESENT, nullable=False)
    scan_mode = Column(String(20), default="QR") # QR or MANUAL
    scanned_at = Column(DateTime, default=datetime.utcnow)

    session = relationship("AttendanceSession", primaryjoin="AttendanceRecord.session_id==AttendanceSession.id", foreign_keys="[AttendanceRecord.session_id]", back_populates="records")
    student = relationship("Student", primaryjoin="AttendanceRecord.student_id==Student.id", foreign_keys="[AttendanceRecord.student_id]", back_populates="records")

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

