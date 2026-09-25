import { useQuery } from '@tanstack/react-query';
import { keys } from '../../core/api/keys';
import { securityEndpoints } from '../../core/api/endpoints/security';

export interface PollingOptions {
  pollMs?: number;
}

export const useScannerHealthQuery = (timeframeDays: number = 7, opts?: PollingOptions) => {
  return useQuery({
    queryKey: keys.security.scannerHealth(timeframeDays),
    queryFn: () => securityEndpoints.getScannerHealth(timeframeDays),
    refetchInterval: opts?.pollMs,
  });
};

export const useTelemetrySummaryQuery = (opts?: PollingOptions) => {
  return useQuery({
    queryKey: keys.security.telemetrySummary(),
    queryFn: securityEndpoints.getTelemetrySummary,
    refetchInterval: opts?.pollMs,
  });
};
