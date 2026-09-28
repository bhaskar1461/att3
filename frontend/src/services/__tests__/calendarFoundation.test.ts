/**
 * SNIST ERP - Calendar Foundation & Data Adapter Test Suite
 * Phase 2: Calendar Foundation, Data Mapping & Safe Integration Layer
 * 
 * Verifies all 9 mandatory requirements:
 * 1. Timetable / session response -> normalized event
 * 2. Missing session -> valid scheduled event
 * 3. Existing session -> valid event
 * 4. Locked session -> correct LOCKED state
 * 5. Past class -> correct date & state
 * 6. Timezone-safe date conversion (IST)
 * 7. Malformed API data does not crash adapter
 * 8. Attendance counts are preserved (not fabricated)
 * 9. Session ID is preserved correctly
 */

import { 
  adaptSessionsToCalendarEvents, 
  adaptAssignmentToScheduledEvent, 
  groupEventsByDate, 
  mergeCalendarEvents 
} from '../calendarAdapter.ts';
import { 
  getTodayIST, 
  parseDateComponents, 
  formatISTDisplayDate, 
  isSameDate, 
  isDateBefore, 
  isDateAfter, 
  addDays, 
  getMonthGridDays, 
  getWeekGridDays, 
  extractPeriodNumber, 
  extractPeriodCount, 
  detectPeriodFromTime 
} from '../../utils/dateUtils.ts';
import type { 
  HistoricalAttendanceSession, 
  TeacherAssignment 
} from '../../types/index.ts';
import { describe, it, expect } from 'vitest';

describe('Calendar Foundation & Data Adapter', () => {
  it('passes all 57 calendar mapping tests', () => {
    let passedTests = 0;
    let totalTests = 0;

    function assert(condition: boolean, testName: string, detail?: string) {
      totalTests++;
      expect(condition, `${testName} - ${detail || 'Assertion failed'}`).toBe(true);
      if (condition) {
        passedTests++;
        console.log(`  [PASS] ${testName}`);
      } else {
        console.error(`  [FAIL] ${testName} - ${detail || 'Assertion failed'}`);
      }
    }

console.log('\n======================================================');
console.log('RUNNING PHASE 2 CALENDAR FOUNDATION TEST SUITE');
console.log('======================================================\n');

// -----------------------------------------------------------
// TEST 1 & 3: Timetable/Session Response -> Normalized Event
// -----------------------------------------------------------
console.log('Suite 1: Session Response -> Normalized Event & ID Preservation');

const mockAssignment: TeacherAssignment = {
  assignment_id: 101,
  subject_id: 201,
  subject_code: 'CS501PC',
  subject_name: 'Data Structures',
  section_id: 301,
  section_name: 'CSE-A',
  department: 'CSE',
  year: '2025-26'
};

const mockSessionOpen: HistoricalAttendanceSession = {
  session_id: 5001,
  subject_id: 201,
  subject_code: 'CS501PC',
  subject_name: 'Data Structures',
  section_id: 301,
  section_name: 'CSE-A',
  period: 'Period 2',
  period_count: 1,
  session_date: '2026-09-12',
  status: 'OPEN',
  total_students: 60,
  present_count: 54,
  absent_count: 6,
  created_at: '2026-09-12T04:50:00Z'
};

const events = adaptSessionsToCalendarEvents([mockSessionOpen], [mockAssignment], '2026-09-12', '10:30');
assert(events.length === 1, 'Adapts 1 session to 1 event');

const e1 = events[0];
// Requirement 9: Session ID preserved correctly
assert(e1.sessionId === 5001, 'Preserves exact session_id 5001');
assert(e1.id === 'session-5001', 'Generates deterministic event id');

// Requirement 8: Attendance counts preserved
assert(e1.totalStudents === 60, 'Preserves total_students 60');
assert(e1.presentCount === 54, 'Preserves present_count 54');
assert(e1.absentCount === 6, 'Preserves absent_count 6');
assert(e1.attendancePercentage === 90, 'Calculates attendance percentage 90%');

// Metadata verification
assert(e1.subjectName === 'Data Structures', 'Preserves subject name');
assert(e1.sectionName === 'CSE-A', 'Preserves section name');
assert(e1.department === 'CSE', 'Enriches department from assignment');
assert(e1.academicYear === '2025-26', 'Enriches year from assignment');
assert(e1.periodNumber === 2, 'Extracts periodNumber 2');
assert(e1.startTime === '10:20', 'Maps Period 2 start time 10:20');
assert(e1.endTime === '11:10', 'Maps Period 2 end time 11:10');

// State verification
assert(e1.isToday === true, 'Correctly flags isToday = true');
assert(e1.isCurrent === true, 'Correctly flags isCurrent = true for active open period');
assert(e1.attendanceState === 'CURRENT', 'Assigns CURRENT attendanceState to live class');
assert(e1.canLockAttendance === true, 'Allows locking open session');

// -----------------------------------------------------------
// TEST 2: Missing Session -> Valid Event (Scheduled Allotment)
// -----------------------------------------------------------
console.log('\nSuite 2: Missing Session -> Valid Event (Scheduled Allotment)');

const scheduledEvent = adaptAssignmentToScheduledEvent(mockAssignment, '2026-09-12', 3, '2026-09-12', '10:30');
assert(scheduledEvent.sessionId === null, 'Session ID is null for unscheduled session');
assert(scheduledEvent.hasSession === false, 'hasSession is false');
assert(scheduledEvent.presentCount === 0, 'presentCount is 0');
assert(scheduledEvent.totalStudents === 0, 'totalStudents is 0 (unfabricated)');
assert(scheduledEvent.canStartAttendance === true, 'Faculty can start attendance for allotted class');
assert(scheduledEvent.canViewAttendance === false, 'Cannot view attendance when no session exists');
assert(scheduledEvent.attendanceState === 'UPCOMING', 'Period 3 is UPCOMING when time is 10:30');

// -----------------------------------------------------------
// TEST 4: Locked Session -> Correct State
// -----------------------------------------------------------
console.log('\nSuite 4: Locked Session State & Permissions');

const mockSessionLocked: HistoricalAttendanceSession = {
  session_id: 5002,
  subject_id: 201,
  subject_code: 'CS501PC',
  subject_name: 'Data Structures',
  section_id: 301,
  section_name: 'CSE-A',
  period: 'Period 1',
  period_count: 1,
  session_date: '2026-09-12',
  status: 'LOCKED',
  total_students: 60,
  present_count: 58,
  absent_count: 2
};

const lockedEvents = adaptSessionsToCalendarEvents([mockSessionLocked], [mockAssignment], '2026-09-12', '11:30');
const el = lockedEvents[0];
assert(el.sessionStatus === 'LOCKED', 'Preserves status = LOCKED');
assert(el.attendanceState === 'LOCKED', 'attendanceState is LOCKED');
assert(el.canLockAttendance === false, 'Cannot re-lock an already locked session');
assert(el.canUnlockAttendance === true, 'Faculty can unlock locked session');
assert(el.canViewAttendance === true, 'Can view attendance for locked session');

// -----------------------------------------------------------
// TEST 5: Past Class -> Correct Date & State
// -----------------------------------------------------------
console.log('\nSuite 5: Past Class Attendance States');

const pastSessionCompleted: HistoricalAttendanceSession = {
  session_id: 4990,
  subject_id: 201,
  subject_code: 'CS501PC',
  subject_name: 'Data Structures',
  section_id: 301,
  section_name: 'CSE-A',
  period: 'Period 3',
  session_date: '2026-09-08',
  status: 'LOCKED',
  total_students: 58,
  present_count: 55,
  absent_count: 3
};

const pastSessionNoAtt: HistoricalAttendanceSession = {
  session_id: 4991,
  subject_id: 201,
  subject_code: 'CS501PC',
  subject_name: 'Data Structures',
  section_id: 301,
  section_name: 'CSE-A',
  period: 'Period 4',
  session_date: '2026-09-08',
  status: 'OPEN',
  total_students: 58,
  present_count: 0,
  absent_count: 58
};

const pastEvents = adaptSessionsToCalendarEvents([pastSessionCompleted, pastSessionNoAtt], [mockAssignment], '2026-09-12', '12:00');
assert(pastEvents[0].isPast === true, 'Flags past session as isPast = true');
assert(pastEvents[0].isToday === false, 'Flags past session as isToday = false');
assert(pastEvents[0].attendanceState === 'LOCKED', 'Locked past class has LOCKED state');
assert(pastEvents[1].isPast === true, 'Flags past 0-attendance session as isPast = true');
assert(pastEvents[1].attendanceState === 'NO_ATTENDANCE', 'Past session with 0 present is NO_ATTENDANCE');

// -----------------------------------------------------------
// TEST 6: Timezone-Safe Date Conversion (IST)
// -----------------------------------------------------------
console.log('\nSuite 6: Timezone-Safe Date Handling & Boundary Arithmetic');

const todayIST = getTodayIST();
assert(/^\d{4}-\d{2}-\d{2}$/.test(todayIST), `getTodayIST returns YYYY-MM-DD (${todayIST})`);

const parsed = parseDateComponents('2026-09-12');
assert(parsed.year === 2026 && parsed.month === 9 && parsed.day === 12, 'parseDateComponents extracts exact numbers');

const displayStr = formatISTDisplayDate('2026-09-12');
assert(displayStr.includes('12 September 2026'), `formatISTDisplayDate contains 12 September 2026 (was: ${displayStr})`);

assert(isSameDate('2026-09-12', '2026-09-12'), 'isSameDate is true for identical dates');
assert(!isSameDate('2026-09-12', '2026-09-11'), 'isSameDate is false for different dates');
assert(isDateBefore('2026-09-11', '2026-09-12'), 'isDateBefore is true for earlier date');
assert(isDateAfter('2026-09-13', '2026-09-12'), 'isDateAfter is true for later date');

// Month rollover boundary tests (no UTC bugs)
const endOfFeb = addDays('2026-02-28', 1);
assert(endOfFeb === '2026-03-01', 'February 28 + 1 day = March 1 (2026 non-leap year)');

const endOfYear = addDays('2025-12-31', 1);
assert(endOfYear === '2026-01-01', 'December 31 + 1 day = January 1');

// Calendar Month Grid Generation
const gridSept2025 = getMonthGridDays(2025, 9, '2025-09-12', '2025-09-12');
assert(gridSept2025.length === 35, 'September 2025 generates 35 grid cells');
assert(gridSept2025[0].dayOfWeek === 0, 'Grid starts on Sunday');
assert(gridSept2025[0].date === '2025-08-31', 'First cell is August 31 (leading day)');
assert(gridSept2025[1].date === '2025-09-01', 'Second cell is September 1 (current month)');

const selectedCell = gridSept2025.find(c => c.date === '2025-09-12');
assert(selectedCell?.isSelected === true, 'Correctly flags selected date cell');
assert(selectedCell?.isToday === true, 'Correctly flags today cell');

// -----------------------------------------------------------
// TEST 7: Malformed API Data Robustness
// -----------------------------------------------------------
console.log('\nSuite 7: Malformed API Data Robustness');

const malformedSessions: any[] = [
  null,
  undefined,
  {},
  { session_id: null },
  { session_id: 9999, session_date: null },
  { session_id: 10001, session_date: '2026-09-12', status: null, total_students: 'invalid', present_count: undefined }
];

let didCrash = false;
let safeEvents: any[] = [];
try {
  safeEvents = adaptSessionsToCalendarEvents(malformedSessions, [], '2026-09-12', '12:00');
} catch (err) {
  didCrash = true;
}

assert(!didCrash, 'Adapter does not throw error on malformed array elements');
assert(safeEvents.length === 1, 'Safely filters out invalid entries and parses salvageable entry');
assert(safeEvents[0].totalStudents === 0, 'Defaults malformed non-numeric totalStudents to 0');
assert(safeEvents[0].presentCount === 0, 'Defaults undefined presentCount to 0');

// -----------------------------------------------------------
// Grouping & Merging
// -----------------------------------------------------------
console.log('\nSuite 8: Event Grouping and Merging');

const grouped = groupEventsByDate([e1, el]);
assert(grouped['2026-09-12']?.length === 2, 'Groups 2 events under date 2026-09-12');
assert(grouped['2026-09-12'][0].periodNumber === 1, 'Sorts Period 1 before Period 2 chronologically');

const merged = mergeCalendarEvents([e1], [scheduledEvent]);
assert(merged.length === 2, 'Merges session events and unscheduled events cleanly');

console.log('\n======================================================');
console.log(`TEST RESULTS: ${passedTests} / ${totalTests} PASSED (100% SUCCESS)`);
console.log('======================================================\n');
    expect(totalTests).toBe(57);
    expect(passedTests).toBe(57);
  });
});
