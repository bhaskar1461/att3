import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { keys } from '../../core/api/keys';
import { securityEndpoints } from '../../core/api/endpoints/security';
import { invalidateFor } from '../../core/api/invalidation';
import type { AuditLogItem, AuditLogList } from '../../core/api/schemas/security';

export interface PollingOptions {
  pollMs?: number;
}

export const useSecurityAuditLogsQuery = (limit: number = 50, opts?: PollingOptions) => {
  return useQuery({
    queryKey: keys.security.auditLogs(limit),
    queryFn: () => securityEndpoints.listAuditLogs(limit),
    refetchInterval: opts?.pollMs,
  });
};

export const useSecurityScannerHealthQuery = (timeframeDays: number = 7, opts?: PollingOptions) => {
  return useQuery({
    queryKey: keys.security.scannerHealth(timeframeDays),
    queryFn: () => securityEndpoints.getScannerHealth(timeframeDays),
    refetchInterval: opts?.pollMs,
  });
};

export const useSecurityTelemetrySummaryQuery = (opts?: PollingOptions) => {
  return useQuery({
    queryKey: keys.security.telemetrySummary(),
    queryFn: securityEndpoints.getTelemetrySummary,
    refetchInterval: opts?.pollMs,
  });
};

export const useSecurityClearLockoutsMutation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: securityEndpoints.clearLockouts,
    onSettled: () => invalidateFor(qc, 'security.clearLockouts'),
  });
};

// Pure testable selectors
export const selectAuditLogItems = (res: AuditLogList | undefined): AuditLogItem[] => {
  if (!res) return [];
  if (Array.isArray(res)) return res;
  return res.items || [];
};

export const selectCriticalActionsCount = (logs: AuditLogItem[]): number => {
  return logs.filter((log) =>
    log.action.toLowerCase().includes('revoke') ||
    log.action.toLowerCase().includes('delete') ||
    log.action.toLowerCase().includes('reset')
  ).length;
};
