import type { QueryClient } from '@tanstack/react-query';
import { keys } from './keys';

const INVALIDATION_MAP: Record<string, readonly (readonly unknown[])[]> = {
  // Roster mutations
  'roster.saveStudent': [keys.roster.all(), keys.attendance.dashboardStats()],
  'roster.updateTeacherSheet': [keys.roster.teachers(), keys.sessions.assignedClasses()],

  // Attendance mutations
  'attendance.scan': [keys.attendance.all(), keys.overview.all()],
  'attendance.manualMark': [keys.attendance.all(), keys.sessions.historicalSessions(), keys.reports.all(), keys.overview.all()],
  'attendance.markAllAbsent': [keys.attendance.all(), keys.sessions.historicalSessions(), keys.reports.all()],

  // Session mutations
  'sessions.start': [keys.sessions.all()],
  'sessions.lock': [keys.sessions.all(), keys.attendance.dashboardStats()],
  'sessions.unlock': [keys.sessions.all(), keys.attendance.dashboardStats()],
  'sessions.syncSheet': [keys.sessions.historicalSessions()],

  // Device mutations
  'devices.requestReset': [keys.devices.all()],
  'devices.verifyReset': [keys.devices.all()],
  'devices.bulkReset': [keys.devices.all()],
  'devices.revokeBinding': [keys.devices.all(), keys.security.all()],

  // Onboarding mutations
  'onboarding.dispatchLinks': [keys.onboarding.all()],
  'onboarding.resendLink': [keys.onboarding.all()],
  'onboarding.approveRebind': [keys.onboarding.all(), keys.devices.all(), keys.overview.all()],
  'onboarding.denyRebind': [keys.onboarding.all(), keys.overview.all()],
  'onboarding.reject': [keys.onboarding.all(), keys.overview.all()],
  'onboarding.dispatchCredentials': [keys.onboarding.all()],

  // Security mutations
  'security.clearLockouts': [keys.devices.all(), keys.security.all()],
  'security.dismissAlert': [keys.security.all(), keys.overview.all()],
  'security.escalateAlert': [keys.security.all(), keys.overview.all()],

  // Sync mutations
  'sync.batchScan': [keys.attendance.all(), keys.sessions.all(), keys.reports.all(), keys.sync.all(), keys.overview.all()],
};

export const invalidateFor = (queryClient: QueryClient, mutation: string) => {
  const queryKeysToInvalidate = INVALIDATION_MAP[mutation] ?? [];
  queryKeysToInvalidate.forEach((queryKey) => {
    queryClient.invalidateQueries({ queryKey });
  });
};
