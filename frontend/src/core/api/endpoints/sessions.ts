import { z } from 'zod';
import { api } from '../client';
import { s } from '../schemas';
import type { StartSessionRequest } from '../schemas/sessions';

export const sessionsEndpoints = {
  listAssignedClasses: () =>
    api('/api/v1/teacher/assigned-classes', s.TeacherAssignedClassesListSchema),

  listHistoricalSessions: () =>
    api('/api/v1/teacher/historical-sessions', s.HistoricalSessionsListSchema),

  startSession: (data: StartSessionRequest) =>
    api('/api/v1/teacher/sessions/start', s.StartSessionResponseSchema, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getBroadcastToken: (sessionId: number) =>
    api(`/api/v1/teacher/sessions/${sessionId}/broadcast-token`, s.BroadcastTokenResponseSchema),

  lockSession: (sessionId: number) =>
    api(`/api/v1/teacher/sessions/${sessionId}/lock`, z.record(z.string(), z.unknown()), {
      method: 'POST',
    }),

  unlockSession: (sessionId: number) =>
    api(`/api/v1/teacher/sessions/${sessionId}/unlock`, z.record(z.string(), z.unknown()), {
      method: 'POST',
    }),

  syncSheet: (sessionId: number) =>
    api(`/api/v1/teacher/sessions/${sessionId}/sync-sheet`, z.record(z.string(), z.unknown()), {
      method: 'POST',
    }),
};
