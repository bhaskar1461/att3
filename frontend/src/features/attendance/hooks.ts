import { useQuery } from '@tanstack/react-query';
import { keys } from '../../core/api/keys';
import { attendanceEndpoints } from '../../core/api/endpoints/attendance';
import { sessionsEndpoints } from '../../core/api/endpoints/sessions';
import { api } from '../../core/api/client';
import { z } from 'zod';
import type { DashboardStats, AttendanceRecord } from '../../core/api/schemas/attendance';
import type { HistoricalSession } from '../../core/api/schemas/sessions';

export interface PollingOptions {
  pollMs?: number;
}

export const useDashboardStatsQuery = (opts?: PollingOptions) => {
  return useQuery({
    queryKey: keys.attendance.dashboardStats(),
    queryFn: attendanceEndpoints.getDashboardStats,
    refetchInterval: opts?.pollMs,
  });
};

export const DailySheetStudentSchema = z.object({
  student_id: z.number(),
  roll_number: z.string(),
  name: z.string(),
  email: z.string().optional().nullable(),
  status: z.string(),
  period_count: z.number().optional().nullable(),
  scan_mode: z.string().optional().nullable(),
  scanned_at: z.string().optional().nullable(),
});
export type DailySheetStudent = z.infer<typeof DailySheetStudentSchema>;

export const DailySheetWeekDaySchema = z.object({
  date: z.string(),
  day_name: z.string(),
  day_num: z.string(),
  is_selected: z.boolean(),
  present_count: z.number(),
  absent_count: z.number(),
  total_students: z.number(),
  has_session: z.boolean(),
});

export const DailySheetResponseSchema = z.object({
  date: z.string(),
  section_id: z.number(),
  section_name: z.string(),
  department_name: z.string().optional().nullable(),
  session_id: z.number().optional().nullable(),
  total_students: z.number(),
  present_count: z.number(),
  absent_count: z.number(),
  unmarked_count: z.number(),
  students: z.array(DailySheetStudentSchema),
  week_days: z.array(DailySheetWeekDaySchema).optional().default([]),
});
export type DailySheetResponse = z.infer<typeof DailySheetResponseSchema>;

export const useDailySheetQuery = (date?: string, sectionId: number = 1, opts?: PollingOptions) => {
  return useQuery({
    queryKey: ['attendance', 'daily-sheet', date, sectionId],
    queryFn: () => {
      const qp = new URLSearchParams();
      if (date) qp.set('date', date);
      if (sectionId) qp.set('section_id', String(sectionId));
      const query = qp.toString() ? `?${qp.toString()}` : '';
      return api(`/api/v1/attendance/admin/daily-sheet${query}`, DailySheetResponseSchema);
    },
    refetchInterval: opts?.pollMs,
  });
};

export interface ScopedAttendanceData {
  presentCount: number;
  totalCount: number;
  rate: number;
  activeSessions: number;
  records: AttendanceRecord[];
}

/**
 * Universal Attendance Query: role-aware scope ('mine' vs 'all')
 */
export const useScopedAttendanceQuery = (scope: 'mine' | 'all' = 'all', opts?: PollingOptions) => {
  return useQuery({
    queryKey: ['attendance', 'scoped', scope],
    queryFn: async (): Promise<ScopedAttendanceData> => {
      if (scope === 'mine') {
        // Teacher-scoped data
        // TODO-REAL: pass teacher_id param to GET /api/v1/attendance/records when server endpoint supports it
        const sessions: HistoricalSession[] = await sessionsEndpoints.listHistoricalSessions();
        const todayStr = new Date().toISOString().split('T')[0];
        
        let present = 0;
        let total = 0;
        let active = 0;

        for (const s of sessions) {
          if (s.status === 'OPEN') active++;
          if (s.session_date === todayStr) {
            present += (s.present_count ?? 0);
            total += (s.total_students ?? 0);
          }
        }

        // If no sessions yet today, aggregate recent session
        if (total === 0 && sessions.length > 0) {
          const recent = sessions[0];
          present = recent.present_count ?? 0;
          total = recent.total_students ?? 1;
        }

        const rate = total > 0 ? Math.round((present / total) * 1000) / 10 : 0;
        return {
          presentCount: present,
          totalCount: total,
          rate,
          activeSessions: active,
          records: [],
        };
      } else {
        // Admin-scoped data (global university)
        const stats: DashboardStats = await attendanceEndpoints.getDashboardStats();
        return {
          presentCount: stats.present_today,
          totalCount: stats.present_today + stats.absent_today,
          rate: stats.attendance_percentage,
          activeSessions: stats.active_live_classes,
          records: [],
        };
      }
    },
    refetchInterval: opts?.pollMs,
  });
};

export interface UseRecordsParams {
  range?: 'today' | 'week' | 'month';
  scope?: 'mine' | 'all';
  teacher_id?: number;
}

/**
 * useRecords: queries REAL /api/v1/attendance/records for range and role-scoped teacher isolation.
 * Month range is capped to backend max (1000) for bounded client-side aggregation.
 */
export const useRecords = (params: UseRecordsParams = {}, opts?: PollingOptions) => {
  const range = params.range || 'week';
  const scope = params.scope || 'all';
  return useQuery({
    queryKey: keys.overview.stats(range, scope),
    queryFn: () => attendanceEndpoints.getAttendanceRecords({ range, scope, teacher_id: params.teacher_id }),
    refetchInterval: opts?.pollMs,
  });
};

