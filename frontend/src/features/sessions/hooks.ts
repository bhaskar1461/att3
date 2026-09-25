import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { keys } from '../../core/api/keys';
import { sessionsEndpoints } from '../../core/api/endpoints/sessions';
import { invalidateFor } from '../../core/api/invalidation';
import type { HistoricalSession } from '../../core/api/schemas/sessions';

export interface PollingOptions {
  pollMs?: number;
}

export const useSessionsAssignedClassesQuery = (opts?: PollingOptions) => {
  return useQuery({
    queryKey: keys.sessions.assignedClasses(),
    queryFn: sessionsEndpoints.listAssignedClasses,
    refetchInterval: opts?.pollMs,
  });
};

export const useSessionsHistoricalQuery = (opts?: PollingOptions) => {
  return useQuery({
    queryKey: keys.sessions.historicalSessions(),
    queryFn: sessionsEndpoints.listHistoricalSessions,
    refetchInterval: opts?.pollMs,
  });
};

export const useSessionsBroadcastTokenQuery = (sessionId: number, opts?: PollingOptions) => {
  return useQuery({
    queryKey: keys.sessions.broadcastToken(sessionId),
    queryFn: () => sessionsEndpoints.getBroadcastToken(sessionId),
    enabled: sessionId > 0,
    refetchInterval: opts?.pollMs,
  });
};

export const useSessionsStartMutation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: sessionsEndpoints.startSession,
    onSettled: () => invalidateFor(qc, 'sessions.start'),
  });
};

export const useSessionsLockMutation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: sessionsEndpoints.lockSession,
    onSettled: () => invalidateFor(qc, 'sessions.lock'),
  });
};

export const useSessionsUnlockMutation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: sessionsEndpoints.unlockSession,
    onSettled: () => invalidateFor(qc, 'sessions.unlock'),
  });
};

export const useSessionsSyncSheetMutation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: sessionsEndpoints.syncSheet,
    onSettled: () => invalidateFor(qc, 'sessions.syncSheet'),
  });
};

// Pure testable selectors
export const selectOpenSessions = (sessions: HistoricalSession[] | undefined): HistoricalSession[] => {
  if (!sessions) return [];
  return sessions.filter((s) => s.status === 'OPEN');
};

export const selectLockedSessions = (sessions: HistoricalSession[] | undefined): HistoricalSession[] => {
  if (!sessions) return [];
  return sessions.filter((s) => s.status === 'LOCKED');
};
