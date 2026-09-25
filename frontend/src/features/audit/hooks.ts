import { useQuery } from '@tanstack/react-query';
import { keys } from '../../core/api/keys';
import { securityEndpoints } from '../../core/api/endpoints/security';

export interface PollingOptions {
  pollMs?: number;
}

export const useAuditLogsQuery = (limit: number = 50, opts?: PollingOptions) => {
  return useQuery({
    queryKey: keys.security.auditLogs(limit),
    queryFn: () => securityEndpoints.listAuditLogs(limit),
    refetchInterval: opts?.pollMs,
  });
};
