import { useQuery } from '@tanstack/react-query';
import { keys } from '../../core/api/keys';
import { sessionsEndpoints } from '../../core/api/endpoints/sessions';

export interface PollingOptions {
  pollMs?: number;
}

export const useAssignedClassesQuery = (opts?: PollingOptions) => {
  return useQuery({
    queryKey: keys.sessions.assignedClasses(),
    queryFn: sessionsEndpoints.listAssignedClasses,
    refetchInterval: opts?.pollMs,
  });
};
