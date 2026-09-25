import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { keys } from '../../core/api/keys';
import { syncEndpoints } from '../../core/api/endpoints/sync';
import { invalidateFor } from '../../core/api/invalidation';
import type { SingleScanItem, SyncStatus } from '../../core/api/schemas/sync';

export interface PollingOptions {
  pollMs?: number;
}

export const useSyncBatchScanMutation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (scans: SingleScanItem[]) => syncEndpoints.batchScan(scans),
    onSettled: () => invalidateFor(qc, 'sync.batchScan'),
  });
};

export const useSyncStatusQuery = (opts?: PollingOptions) => {
  return useQuery({
    queryKey: keys.sync.status(),
    queryFn: syncEndpoints.getSyncStatus,
    refetchInterval: opts?.pollMs,
  });
};

// Pure testable selector
export const selectIsSystemOnline = (status: SyncStatus | undefined): boolean => {
  return status?.is_online ?? true;
};
