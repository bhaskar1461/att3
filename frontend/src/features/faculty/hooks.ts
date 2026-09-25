import { useQuery } from '@tanstack/react-query';
import { keys } from '../../core/api/keys';
import { rosterEndpoints } from '../../core/api/endpoints/roster';

export interface PollingOptions {
  pollMs?: number;
}

export const useFacultyListQuery = (opts?: PollingOptions) => {
  return useQuery({
    queryKey: keys.roster.teachers(),
    queryFn: rosterEndpoints.listTeachers,
    refetchInterval: opts?.pollMs,
  });
};
