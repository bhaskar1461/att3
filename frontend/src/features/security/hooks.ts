import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { keys } from '../../core/api/keys';
import { securityEndpoints } from '../../core/api/endpoints/security';
import { invalidateFor } from '../../core/api/invalidation';
import type { AuditLogItem, AuditLogList } from '../../core/api/schemas/security';

export interface PollingOptions {
  pollMs?: number;
}

export interface AlertItem {
  id: number;
  type: 'spoof' | 'recovery' | 'onboarding';
  title: string;
  subtitle?: string;
  student: string;
  action: string;
  details?: string | null;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'OPEN' | 'RESOLVED' | 'ESCALATED';
  created_at: string;
  timestamp: string;
  raw: AuditLogItem;
}

export interface UseAlertsOptions {
  status?: 'open' | 'all';
  pollMs?: number;
}

export const normalizeAlertItem = (log: AuditLogItem): AlertItem => {
  const act = (log.action || '').toUpperCase();
  const details = log.details || '';
  
  let type: 'spoof' | 'recovery' | 'onboarding' = 'spoof';
  if (act.includes('RECOVERY') || act.includes('RESET') || act.includes('REBIND')) {
    type = 'recovery';
  } else if (act.includes('ONBOARD') || act.includes('REGISTR') || act.includes('MAGIC')) {
    type = 'onboarding';
  }

  let status: 'OPEN' | 'RESOLVED' | 'ESCALATED' = 'OPEN';
  if (details.includes('[RESOLVED') || details.includes('DISMISSED') || act === 'SECURITY_ALERT_DISMISSED') {
    status = 'RESOLVED';
  } else if (details.includes('[ESCALATED') || act === 'SECURITY_ALERT_ESCALATED') {
    status = 'ESCALATED';
  }

  let severity: 'low' | 'medium' | 'high' | 'critical' = 'medium';
  if (act.includes('ACCOUNT_SWITCH') || act.includes('REVOKE') || act.includes('CRITICAL')) {
    severity = 'critical';
  } else if (act.includes('PROJECTOR_TOKEN') || act.includes('RESET')) {
    severity = 'high';
  } else if (act.includes('WARNING') || act.includes('LOCKOUT')) {
    severity = 'medium';
  } else {
    severity = 'low';
  }

  const student = log.username || 'Student';
  let title = `${student}: ${act.replace(/_/g, ' ').toLowerCase()}`;
  if (type === 'recovery') {
    title = `${student}: Device recovery request`;
  } else if (type === 'onboarding') {
    title = `${student}: Onboarding approval`;
  } else if (act === 'ACCOUNT_SWITCH_ATTEMPT') {
    title = `${student}: Account switch blocked`;
  } else if (act === 'PROJECTOR_TOKEN_REJECTED') {
    title = `${student}: Stale QR scan rejected`;
  }

  const createdAt = log.timestamp || new Date().toISOString();

  return {
    id: log.id,
    type,
    title,
    subtitle: details || act,
    student,
    action: log.action,
    details: log.details,
    severity,
    status,
    created_at: createdAt,
    timestamp: createdAt,
    raw: log,
  };
};

export const useAlerts = (opts?: UseAlertsOptions) => {
  return useQuery({
    queryKey: keys.security.alerts(opts?.status ?? 'open'),
    queryFn: async (): Promise<AlertItem[]> => {
      const res = await securityEndpoints.listAuditLogs(100);
      const items: AuditLogItem[] = Array.isArray(res) ? res : res.items || [];
      return items.map(normalizeAlertItem);
    },
    refetchInterval: () =>
      typeof document !== 'undefined' && document.visibilityState === 'visible'
        ? (opts?.pollMs ?? 60_000)
        : false,
  });
};

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

export const useSecurityDismissAlertMutation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (alertId: number | string) => securityEndpoints.dismissAlert(alertId),
    onSettled: () => invalidateFor(qc, 'security.dismissAlert'),
  });
};

export const useSecurityEscalateAlertMutation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (alertId: number | string) => securityEndpoints.escalateAlert(alertId),
    onSettled: () => invalidateFor(qc, 'security.escalateAlert'),
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
