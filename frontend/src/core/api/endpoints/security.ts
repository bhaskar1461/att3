import { z } from 'zod';
import { api } from '../client';
import { s } from '../schemas';

export const securityEndpoints = {
  listAuditLogs: (limit: number = 50) =>
    api(`/api/v1/admin/audit-logs?limit=${limit}`, s.AuditLogListSchema),

  getScannerHealth: (timeframeDays: number = 7) =>
    api(`/api/v1/telemetry/scanner-health?timeframe_days=${timeframeDays}`, s.ScannerHealthResponseSchema),

  getTelemetrySummary: () =>
    api('/api/v1/telemetry/summary', s.TelemetrySummaryResponseSchema),

  clearLockouts: () =>
    api('/api/v1/admin/admin/operations/security/clear-lockouts', z.record(z.string(), z.unknown()), {
      method: 'POST',
      body: JSON.stringify({}),
    }),
};
