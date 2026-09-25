import { useQuery } from '@tanstack/react-query';
import { api } from '../../core/api/client';
import { z } from 'zod';

export interface PollingOptions {
  pollMs?: number;
}

export const ComplianceSummarySchema = z.object({
  total_condonations: z.number().optional().default(0),
  total_defaulters: z.number().optional().default(0),
}).passthrough();
export type ComplianceSummary = z.infer<typeof ComplianceSummarySchema>;

export const useComplianceStatsQuery = (opts?: PollingOptions) => {
  return useQuery({
    queryKey: ['compliance', 'stats'],
    queryFn: () =>
      api('/api/v1/admin/defaulters', z.union([z.array(z.record(z.string(), z.unknown())), z.record(z.string(), z.unknown())]))
        .catch(() => ({ total_defaulters: 0 })),
    refetchInterval: opts?.pollMs,
  });
};

// Pure testable selector
export const selectDefaultersCount = (data: unknown): number => {
  if (Array.isArray(data)) return data.length;
  if (data && typeof data === 'object' && 'total_defaulters' in data) {
    return Number((data as { total_defaulters: number }).total_defaulters) || 0;
  }
  return 0;
};
