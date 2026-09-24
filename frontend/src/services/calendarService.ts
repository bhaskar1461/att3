/**
 * SNIST ERP - Teacher Calendar Service & Safe Integration Layer
 * Phase 2: Calendar Foundation, Data Mapping & Safe Integration Layer
 * 
 * Reuses existing apiRequest client.
 * Implements two-level data loading:
 *   Level 1: Summary data for calendar grid (lightweight, no student rosters)
 *   Level 2: Detailed session roster loaded strictly on demand when a class is selected
 */

import { apiRequest } from './api.ts';
import type { 
  TeacherAssignment, 
  HistoricalAttendanceSession, 
  AttendanceSession 
} from '../types/index.ts';
import type { 
  CalendarSummaryData, 
  TeacherClassEvent 
} from '../types/calendar.ts';
import { 
  adaptSessionsToCalendarEvents, 
  groupEventsByDate 
} from './calendarAdapter.ts';
import { 
  getTodayIST, 
  getCurrentTimeIST 
} from '../utils/dateUtils.ts';

interface SummaryCacheEntry {
  data: CalendarSummaryData;
  timestamp: number;
}

// Bounded in-memory cache to prevent duplicate fetches on quick date toggles (30s TTL)
const _SUMMARY_CACHE = new Map<string, SummaryCacheEntry>();
const CACHE_TTL_MS = 30000;

export function clearCalendarSummaryCache(): void {
  _SUMMARY_CACHE.clear();
}

/**
 * Level 1 Loader: Fetches lightweight summary data required to render calendar month/week grids.
 * Does NOT fetch 60-student rosters, keeping payload size minimal (<15KB).
 */
export async function fetchCalendarSummary(
  dateFilter?: string,
  forceRefresh: boolean = false
): Promise<CalendarSummaryData> {
  const cacheKey = dateFilter || '__ALL__';
  const cached = _SUMMARY_CACHE.get(cacheKey);
  const now = Date.now();

  if (!forceRefresh && cached && (now - cached.timestamp < CACHE_TTL_MS)) {
    return cached.data;
  }

  const todayIST = getTodayIST();
  const currentTimeIST = getCurrentTimeIST();

  // Execute existing backend endpoints concurrently
  const [assignmentsResult, sessionsResult, currentClassResult] = await Promise.allSettled([
    apiRequest<TeacherAssignment[]>('/teacher/assigned-classes'),
    apiRequest<HistoricalAttendanceSession[]>(
      dateFilter ? `/teacher/historical-sessions?date=${dateFilter}&limit=500` : '/teacher/historical-sessions?limit=500'
    ),
    apiRequest<any>('/teacher/current-class')
  ]);

  if (assignmentsResult.status === 'rejected') {
    throw new Error(assignmentsResult.reason?.message || 'Failed to load teacher class assignments');
  }
  if (sessionsResult.status === 'rejected') {
    throw new Error(sessionsResult.reason?.message || 'Failed to load attendance sessions');
  }

  const assignments = assignmentsResult.value || [];
  const sessions = sessionsResult.value || [];
  const currentClassInfo = currentClassResult.status === 'fulfilled' ? currentClassResult.value : null;

  const allEvents = adaptSessionsToCalendarEvents(
    sessions,
    assignments,
    currentClassInfo?.current_date || todayIST,
    currentClassInfo?.current_time || currentTimeIST
  );

  const eventsByDate = groupEventsByDate(allEvents);

  const summaryData: CalendarSummaryData = {
    eventsByDate,
    allEvents,
    todayIST: currentClassInfo?.current_date || todayIST,
    currentTimeIST: currentClassInfo?.current_time || currentTimeIST,
    detectedPeriod: currentClassInfo?.detected_period || null,
    activeSessionId: currentClassInfo?.existing_session_id || null
  };

  _SUMMARY_CACHE.set(cacheKey, {
    data: summaryData,
    timestamp: now
  });

  return summaryData;
}

/**
 * Level 2 Loader: Fetches full session details and student roster.
 * Strictly loaded only when the faculty member selects a specific class.
 */
export async function fetchClassDetailedRoster(sessionId: number): Promise<AttendanceSession> {
  if (!sessionId || sessionId <= 0) {
    throw new Error('Invalid session ID');
  }
  return apiRequest<AttendanceSession>(`/teacher/sessions/${sessionId}`);
}

/**
 * Starts a new attendance session or resumes an open session for a class.
 * Works for current live classes or previous dates where authorized.
 */
export async function startClassAttendanceSession(params: {
  subjectId: number;
  sectionId: number;
  period: string;
  periodCount?: number;
  date?: string;
  displayType?: 'projector' | 'phone_screen' | 'laptop';
}): Promise<{ session_id: number; status: string; message: string }> {
  clearCalendarSummaryCache();
  return apiRequest<{ session_id: number; status: string; message: string }>('/teacher/sessions/start', {
    method: 'POST',
    body: JSON.stringify({
      subject_id: params.subjectId,
      section_id: params.sectionId,
      period: params.period,
      period_count: params.periodCount,
      date: params.date,
      display_type: params.displayType || 'projector'
    })
  });
}

/**
 * Locks an active attendance session and initiates institutional background sync.
 */
export async function lockClassAttendanceSession(sessionId: number): Promise<{ status: string; message: string }> {
  clearCalendarSummaryCache();
  return apiRequest<{ status: string; message: string }>(`/teacher/sessions/${sessionId}/lock`, {
    method: 'POST'
  });
}

/**
 * Unlocks a locked past attendance session for historical corrections.
 */
export async function unlockClassAttendanceSession(sessionId: number): Promise<{ message: string }> {
  clearCalendarSummaryCache();
  return apiRequest<{ message: string }>(`/teacher/sessions/${sessionId}/unlock`, {
    method: 'POST'
  });
}
