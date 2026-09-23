/**
 * SNIST ERP - Normalized Calendar Event & View Type Definitions
 * Phase 2: Calendar Foundation, Data Mapping & Safe Integration Layer
 */

export type CalendarViewMode = 'month' | 'week' | 'day' | 'list';

/**
 * Normalized calendar event state system derived deterministically from backend data.
 * 
 * State Derivation Rules:
 * - LOCKED: Backend AttendanceSession.status === 'LOCKED'
 * - CURRENT: Class time matches current IST period OR AttendanceSession.status === 'OPEN' right now today
 * - COMPLETED: Past class with AttendanceSession.status === 'LOCKED' and present_count > 0
 * - ATTENDANCE_TAKEN: AttendanceSession exists with present_count > 0 and status === 'OPEN'
 * - NO_ATTENDANCE: Past class date with no session created, or session created with 0 attendance
 * - UPCOMING: Future date/time slot with no session started yet
 */
export type CalendarEventState = 
  | 'UPCOMING'
  | 'CURRENT'
  | 'COMPLETED'
  | 'NO_ATTENDANCE'
  | 'ATTENDANCE_TAKEN'
  | 'LOCKED';

/**
 * Standard Period Slot Definition
 */
export interface PeriodDefinition {
  num: number;
  label: string;
  startTime: string; // HH:MM in IST (24-hour)
  endTime: string;   // HH:MM in IST (24-hour)
  displayTime: string; // e.g. "09:30 AM - 10:20 AM"
}

/**
 * Normalized Teacher Class Event
 * Represents either an active/past AttendanceSession or a scheduled/allotted class.
 */
export interface TeacherClassEvent {
  // --- IDENTIFIERS & METADATA (BACKEND DATA) ---
  /** Unique deterministic identifier: 'session-{sessionId}' or 'sched-{assignmentId}-{date}-{periodNum}' */
  id: string;

  /** Session ID if an AttendanceSession row exists in the database; null if scheduled class has no session yet */
  sessionId: number | null;

  /** Session lifecycle status in database: 'OPEN' | 'LOCKED' | null */
  sessionStatus: 'OPEN' | 'LOCKED' | null;

  /** Subject ID from qr_subjects */
  subjectId: number;

  /** Subject Code e.g. "CS501PC" */
  subjectCode: string;

  /** Subject Name e.g. "Data Structures", "Career Enhancement Training (CET)" */
  subjectName: string;

  /** Section ID from qr_sections */
  sectionId: number;

  /** Section Name e.g. "CSE-A", "CS-B" */
  sectionName: string;

  /** Department Code e.g. "CSE", "ECE" */
  department: string;

  /** Academic Year e.g. "2025-26" */
  academicYear: string;

  /** Assignment ID from qr_teacher_assignments (if matched to faculty allotment) */
  assignmentId?: number;

  /** Optional classroom/lab room number if provided by backend or section metadata */
  room?: string;

  // --- TIME & SCHEDULE (BACKEND / SERVER-AUTHORITATIVE) ---
  /** Calendar date in server-authoritative IST format: YYYY-MM-DD */
  date: string;

  /** Primary Period Number (1 to 8) */
  periodNumber: number;

  /** Period Label e.g. "Period 2", "Period 1-4 (4 Periods)" */
  periodLabel: string;

  /** Period Count credit (1 to 8) */
  periodCount: number;

  /** Start Time in HH:MM (IST, 24-hr) */
  startTime: string;

  /** End Time in HH:MM (IST, 24-hr) */
  endTime: string;

  /** Formatted 12-hour display time e.g. "09:30 AM - 10:20 AM" */
  displayTime: string;

  // --- ATTENDANCE HEADCOUNT (BACKEND DATA) ---
  /** Total enrolled students in section (from backend query) */
  totalStudents: number;

  /** Total marked present count (from AttendanceRecord query) */
  presentCount: number;

  /** Total absent count (totalStudents - presentCount) */
  absentCount: number;

  /** Attendance percentage (presentCount / totalStudents * 100) */
  attendancePercentage: number;

  // --- STATUS & DERIVED FLAGS (FRONTEND DERIVED DATA) ---
  /** Normalized display and badge state */
  attendanceState: CalendarEventState;

  /** Whether the event's date matches server-authoritative today IST */
  isToday: boolean;

  /** Whether the event matches current IST period time or is an active open session right now */
  isCurrent: boolean;

  /** Whether the event is strictly in the past (date < today IST or earlier period today) */
  isPast: boolean;

  /** Whether the event is strictly in the future (date > today IST or later period today) */
  isUpcoming: boolean;

  /** Whether an AttendanceSession row already exists in the database for this event */
  hasSession: boolean;

  // --- PERMISSION HINTS (FRONTEND DERIVED HINTS - SERVER AUTHORITATIVE ON EXECUTION) ---
  /** UI Hint: Teacher can launch session (e.g. valid allotment and session not locked) */
  canStartAttendance: boolean;

  /** UI Hint: Teacher can view existing student attendance roster */
  canViewAttendance: boolean;

  /** UI Hint: Teacher can edit attendance records (session is open or unlockable) */
  canEditAttendance: boolean;

  /** UI Hint: Teacher can lock the active session */
  canLockAttendance: boolean;

  /** UI Hint: Teacher can unlock the locked past session for historical edits */
  canUnlockAttendance: boolean;
}

/**
 * Calendar Grid Day Cell (Level 1 Calendar View)
 */
export interface CalendarDayCell {
  /** Date string in YYYY-MM-DD (IST) */
  date: string;

  /** Day number (1 to 31) */
  dayNumber: number;

  /** Day of week (0 = Sun, 1 = Mon, ..., 6 = Sat) */
  dayOfWeek: number;

  /** Day name abbreviation: "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat" */
  dayName: string;

  /** Whether this day belongs to the currently viewed calendar month */
  isCurrentMonth: boolean;

  /** Whether this day is today in IST */
  isToday: boolean;

  /** Whether this day is currently selected by the faculty member */
  isSelected: boolean;

  /** List of normalized class events for this day */
  events: TeacherClassEvent[];

  /** Quick summary flag if any event on this day has an active open session */
  hasActiveSession: boolean;

  /** Total number of classes on this day */
  totalClasses: number;
}

/**
 * Level 1 Calendar Summary Response
 * High-efficiency summary payload used to render month/week grids without loading student rosters.
 */
export interface CalendarSummaryData {
  /** Normalized events grouped by date: { 'YYYY-MM-DD': TeacherClassEvent[] } */
  eventsByDate: Record<string, TeacherClassEvent[]>;

  /** Flat list of all normalized events in the loaded window */
  allEvents: TeacherClassEvent[];

  /** Current server IST date */
  todayIST: string;

  /** Current server IST time (HH:MM) */
  currentTimeIST: string;

  /** Detected active period right now (if any) */
  detectedPeriod: string | null;

  /** Active session ID right now (if any) */
  activeSessionId: number | null;
}
