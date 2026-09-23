/**
 * SNIST ERP - Teacher Calendar Data Adapter
 * Phase 2: Calendar Foundation, Data Mapping & Safe Integration Layer
 * 
 * Purpose:
 * Transforms raw backend API payloads into a clean, normalized TeacherClassEvent[] model.
 * Enforces strict separation between Backend Data and Frontend-Derived Data.
 * Pure transformation layer - zero UI dependencies, zero direct fetch calls.
 */

import type { 
  TeacherClassEvent, 
  CalendarEventState 
} from '../types/calendar.ts';
import type { 
  TeacherAssignment, 
  HistoricalAttendanceSession 
} from '../types/index.ts';
import { 
  getTodayIST, 
  getCurrentTimeIST, 
  extractPeriodNumber, 
  extractPeriodCount, 
  getPeriodDefinition, 
  getMultiPeriodDefinition,
  isSameDate, 
  isDateBefore, 
  isDateAfter,
  detectPeriodFromTime
} from '../utils/dateUtils.ts';

/**
 * Normalizes an array of HistoricalAttendanceSession objects into TeacherClassEvent objects.
 * Safely handles missing fields, links assignments, and deterministically derives event states.
 */
export function adaptSessionsToCalendarEvents(
  sessions: HistoricalAttendanceSession[],
  assignments: TeacherAssignment[] = [],
  todayIST: string = getTodayIST(),
  currentTimeIST: string = getCurrentTimeIST()
): TeacherClassEvent[] {
  if (!Array.isArray(sessions)) {
    return [];
  }

  const assignmentMap = new Map<string, TeacherAssignment>();
  for (const a of assignments) {
    if (a && a.subject_id && a.section_id) {
      assignmentMap.set(`${a.subject_id}_${a.section_id}`, a);
    }
  }

  const currentPeriodNum = detectPeriodFromTime(currentTimeIST);

  return sessions
    .filter(s => s && s.session_id && s.session_date)
    .map(session => {
      const periodNum = extractPeriodNumber(session.period);
      const periodCount = session.period_count || extractPeriodCount(session.period) || 1;
      const periodDef = getMultiPeriodDefinition(periodNum, periodCount);

      // Match faculty assignment for department and academic year metadata
      const assignmentKey = `${session.subject_id}_${session.section_id}`;
      const matchedAssignment = assignmentMap.get(assignmentKey);

      const sessionDate = session.session_date.trim();
      const isToday = isSameDate(sessionDate, todayIST);
      const isPast = isDateBefore(sessionDate, todayIST);
      const isUpcoming = isDateAfter(sessionDate, todayIST);

      const isCurrentTimeSlot = isToday && currentPeriodNum === periodNum;
      const isOpen = session.status === 'OPEN';
      const isLocked = session.status === 'LOCKED';

      // An event is actively current if it is today and currently in-progress
      const isCurrent = isToday && (isOpen || isCurrentTimeSlot);

      // Deterministic Attendance State Derivation
      let attendanceState: CalendarEventState;
      if (isLocked) {
        attendanceState = 'LOCKED';
      } else if (isOpen && isCurrent) {
        attendanceState = 'CURRENT';
      } else if (isPast && (!session.present_count || Number(session.present_count) === 0)) {
        attendanceState = 'NO_ATTENDANCE';
      } else if (isOpen || (session.present_count && Number(session.present_count) > 0)) {
        attendanceState = 'ATTENDANCE_TAKEN';
      } else if (isPast) {
        attendanceState = 'NO_ATTENDANCE';
      } else {
        attendanceState = 'UPCOMING';
      }

      // Safe headcount metrics (guarded against strings, NaN, undefined)
      const rawTotal = Number(session.total_students);
      const totalStudents = !isNaN(rawTotal) && rawTotal > 0 ? Math.floor(rawTotal) : 0;
      const rawPresent = Number(session.present_count);
      const presentCount = !isNaN(rawPresent) && rawPresent > 0 ? Math.floor(rawPresent) : 0;
      const rawAbsent = session.absent_count !== undefined ? Number(session.absent_count) : (totalStudents - presentCount);
      const absentCount = !isNaN(rawAbsent) && rawAbsent >= 0 ? Math.floor(rawAbsent) : Math.max(0, totalStudents - presentCount);
      const attendancePercentage = totalStudents > 0 
        ? Math.round((presentCount / totalStudents) * 1000) / 10 
        : 0;

      // Derived UI Permission Hints (Backend remains authoritative on actual execution)
      const canStartAttendance = !isLocked;
      const canViewAttendance = true;
      const canEditAttendance = true; // If locked, faculty can unlock; if open, faculty can edit
      const canLockAttendance = isOpen;
      const canUnlockAttendance = isLocked;

      return {
        id: `session-${session.session_id}`,
        sessionId: session.session_id,
        sessionStatus: session.status,
        subjectId: session.subject_id,
        subjectCode: session.subject_code || matchedAssignment?.subject_code || '',
        subjectName: session.subject_name || matchedAssignment?.subject_name || 'Class',
        sectionId: session.section_id,
        sectionName: session.section_name || matchedAssignment?.section_name || '',
        department: matchedAssignment?.department || '',
        academicYear: matchedAssignment?.year || '',
        assignmentId: matchedAssignment?.assignment_id,
        room: `Room ${session.section_name || 'Classroom'}`,
        date: sessionDate,
        periodNumber: periodNum,
        periodLabel: session.period || periodDef.label,
        periodCount,
        startTime: periodDef.startTime,
        endTime: periodDef.endTime,
        displayTime: periodDef.displayTime,
        totalStudents,
        presentCount,
        absentCount,
        attendancePercentage,
        attendanceState,
        isToday,
        isCurrent,
        isPast,
        isUpcoming,
        hasSession: true,
        canStartAttendance,
        canViewAttendance,
        canEditAttendance,
        canLockAttendance,
        canUnlockAttendance
      };
    });
}

/**
 * Creates a normalized TeacherClassEvent for an allotted class that does NOT have an AttendanceSession yet.
 * Allows the calendar to display scheduled periods before attendance has been initiated.
 */
export function adaptAssignmentToScheduledEvent(
  assignment: TeacherAssignment,
  date: string,
  periodNumber: number,
  todayIST: string = getTodayIST(),
  currentTimeIST: string = getCurrentTimeIST()
): TeacherClassEvent {
  const periodDef = getPeriodDefinition(periodNumber);
  const cleanDate = date.trim();
  const isToday = isSameDate(cleanDate, todayIST);
  const isPast = isDateBefore(cleanDate, todayIST);
  const isUpcoming = isDateAfter(cleanDate, todayIST);

  const currentPeriodNum = detectPeriodFromTime(currentTimeIST);
  const isCurrentTimeSlot = isToday && currentPeriodNum === periodNumber;

  let attendanceState: CalendarEventState;
  if (isPast) {
    attendanceState = 'NO_ATTENDANCE';
  } else if (isCurrentTimeSlot) {
    attendanceState = 'CURRENT';
  } else {
    attendanceState = 'UPCOMING';
  }

  return {
    id: `sched-${assignment.assignment_id}-${cleanDate}-${periodNumber}`,
    sessionId: null,
    sessionStatus: null,
    subjectId: assignment.subject_id,
    subjectCode: assignment.subject_code,
    subjectName: assignment.subject_name,
    sectionId: assignment.section_id,
    sectionName: assignment.section_name,
    department: assignment.department || '',
    academicYear: assignment.year || '',
    assignmentId: assignment.assignment_id,
    room: `Room ${assignment.section_name}`,
    date: cleanDate,
    periodNumber,
    periodLabel: periodDef.label,
    periodCount: 1,
    startTime: periodDef.startTime,
    endTime: periodDef.endTime,
    displayTime: periodDef.displayTime,
    totalStudents: 0,
    presentCount: 0,
    absentCount: 0,
    attendancePercentage: 0,
    attendanceState,
    isToday,
    isCurrent: isCurrentTimeSlot,
    isPast,
    isUpcoming,
    hasSession: false,
    canStartAttendance: true, // Authorized teacher can start attendance for this class
    canViewAttendance: false, // No session to view yet
    canEditAttendance: false,
    canLockAttendance: false,
    canUnlockAttendance: false
  };
}

/**
 * Groups an array of TeacherClassEvents into an index-by-date map: { 'YYYY-MM-DD': TeacherClassEvent[] }.
 * Events on each date are automatically sorted chronologically by periodNumber and startTime.
 */
export function groupEventsByDate(events: TeacherClassEvent[]): Record<string, TeacherClassEvent[]> {
  const map: Record<string, TeacherClassEvent[]> = {};

  if (!Array.isArray(events)) {
    return map;
  }

  for (const event of events) {
    if (!event || !event.date) continue;
    if (!map[event.date]) {
      map[event.date] = [];
    }
    map[event.date].push(event);
  }

  // Sort each date's events by periodNumber ascending
  for (const dateStr of Object.keys(map)) {
    map[dateStr].sort((a, b) => {
      if (a.periodNumber !== b.periodNumber) {
        return a.periodNumber - b.periodNumber;
      }
      return a.startTime.localeCompare(b.startTime);
    });
  }

  return map;
}

/**
 * Merges scheduled assignment events with actual session events for a date.
 * If a session already exists for the same subject, section, and date, the session event takes precedence.
 */
export function mergeCalendarEvents(
  sessionEvents: TeacherClassEvent[],
  scheduledEvents: TeacherClassEvent[] = []
): TeacherClassEvent[] {
  const merged: TeacherClassEvent[] = [...sessionEvents];
  const existingKeys = new Set<string>();

  for (const se of sessionEvents) {
    existingKeys.add(`${se.date}_${se.subjectId}_${se.sectionId}_${se.periodNumber}`);
  }

  for (const sched of scheduledEvents) {
    const key = `${sched.date}_${sched.subjectId}_${sched.sectionId}_${sched.periodNumber}`;
    if (!existingKeys.has(key)) {
      merged.push(sched);
      existingKeys.add(key);
    }
  }

  return merged;
}

/**
 * Retrieves normalized events for a specific calendar date.
 */
export function getEventsForDate(
  eventsMap: Record<string, TeacherClassEvent[]>,
  dateStr: string
): TeacherClassEvent[] {
  if (!eventsMap || !dateStr) return [];
  return eventsMap[dateStr] || [];
}
