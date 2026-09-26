import type { StudentQueryParams } from './endpoints/roster';
import type { ClassMatrixQueryParams } from './endpoints/reports';

export type Range = 'today' | 'week' | 'month';

export const keys = {
  auth: {
    all: () => ['auth'] as const,
    me: () => ['auth', 'me'] as const,
  },
  roster: {
    all: () => ['roster'] as const,
    students: (params?: StudentQueryParams) => ['roster', 'students', params] as const,
    teachers: () => ['roster', 'teachers'] as const,
    departments: () => ['roster', 'departments'] as const,
    sections: () => ['roster', 'sections'] as const,
    subjects: () => ['roster', 'subjects'] as const,
    years: () => ['roster', 'years'] as const,
  },
  attendance: {
    all: () => ['attendance'] as const,
    dashboardStats: () => ['attendance', 'dashboard-stats'] as const,
    studentSummary: () => ['attendance', 'student-summary'] as const,
  },
  sessions: {
    all: () => ['sessions'] as const,
    assignedClasses: () => ['sessions', 'assigned-classes'] as const,
    historicalSessions: () => ['sessions', 'historical'] as const,
    broadcastToken: (sessionId: number) => ['sessions', 'broadcast-token', sessionId] as const,
  },
  reports: {
    all: () => ['reports'] as const,
    lowAttendance: (threshold?: number) => ['reports', 'low-attendance', threshold] as const,
    classSheetMatrix: (params?: ClassMatrixQueryParams) => ['reports', 'class-sheet-matrix', params] as const,
  },
  devices: {
    all: () => ['devices'] as const,
    studentDeviceInfo: (rollNumber: string) => ['devices', 'student-info', rollNumber] as const,
    bindingStatus: () => ['devices', 'binding-status'] as const,
  },
  onboarding: {
    all: () => ['onboarding'] as const,
    status: (page?: number, pageSize?: number) => ['onboarding', 'status', { page, pageSize }] as const,
    rebindRequests: () => ['onboarding', 'rebind-requests'] as const,
  },
  security: {
    all: () => ['security'] as const,
    alerts: (status?: string) => ['security', 'alerts', status ?? 'open'] as const,
    auditLogs: (limit?: number) => ['security', 'audit-logs', limit] as const,
    scannerHealth: (timeframeDays?: number) => ['security', 'scanner-health', timeframeDays] as const,
    telemetrySummary: () => ['security', 'telemetry-summary'] as const,
  },
  sync: {
    all: () => ['sync'] as const,
    status: () => ['sync', 'status'] as const,
  },
  overview: {
    all: () => ['overview'] as const,
    stats: (range: Range = 'today', scope: 'mine' | 'all' = 'all') => ['overview', 'stats', range, scope] as const,
    heatmap: (range: Range = 'today') => ['overview', 'heatmap', range] as const,
    sources: (range: Range = 'today') => ['overview', 'sources', range] as const,
    trends: (range: Range = 'week') => ['overview', 'trends', range] as const,
  },
};
