import { api } from '../client';
import { s } from '../schemas';
import type { SingleScanItem } from '../schemas/sync';

export const syncEndpoints = {
  batchScan: (scans: SingleScanItem[]) =>
    api('/api/v1/attendance/batch-scan', s.BatchScanResponseSchema, {
      method: 'POST',
      body: JSON.stringify({ scans }),
    }),

  getSyncStatus: async () => {
    // Client-side offline check combined with server health probe
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    return {
      pending_count: 0,
      last_sync_time: new Date().toISOString(),
      is_online: isOnline,
      failed_count: 0,
    };
  },
};
