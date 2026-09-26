import { z } from 'zod';
import { api } from '../client';
import { s } from '../schemas';
import type { ScanAttendanceRequest, MarkAttendanceRequest } from '../schemas/attendance';

export const attendanceEndpoints = {
  getDashboardStats: () =>
    api('/api/v1/admin/dashboard-stats', s.DashboardStatsSchema),

  getStudentAttendanceSummary: () =>
    api('/api/v1/student/attendance-summary', s.StudentAttendanceSummarySchema),

  scanAttendance: (data: ScanAttendanceRequest) =>
    api('/api/v1/attendance/scan', s.ScanAttendanceResponseSchema, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  manualMark: (data: MarkAttendanceRequest) =>
    api('/api/v1/attendance/manual-mark', z.record(z.string(), z.unknown()), {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  markAllAbsent: (sessionId: number) =>
    api('/api/v1/attendance/mark-all-absent', z.record(z.string(), z.unknown()), {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId }),
    }),

  getAttendanceRecords: (params?: { range?: 'today' | 'week' | 'month'; scope?: 'mine' | 'all'; teacher_id?: number }) => {
    const qp = new URLSearchParams();
    if (params?.range) qp.set('range', params.range);
    if (params?.scope) qp.set('scope', params.scope);
    if (params?.teacher_id) qp.set('teacher_id', String(params.teacher_id));
    const qs = qp.toString() ? `?${qp.toString()}` : '';
    return api(`/api/v1/attendance/records${qs}`, z.array(s.AttendanceRecordSchema));
  },
};
