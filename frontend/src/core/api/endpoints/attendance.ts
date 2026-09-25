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
};
