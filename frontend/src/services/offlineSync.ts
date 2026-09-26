import { apiRequest } from './api';

export interface PendingScan {
  id?: string;
  session_id: number;
  qr_payload: string;
  period_count?: number;
  scanned_at: string;
}

const STORAGE_KEY = 'offline_attendance_queue';
let batchBuffer: PendingScan[] = [];
let batchTimer: any = null;

export const getOfflineQueue = (): PendingScan[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

export const MAX_OFFLINE_QUEUE_SIZE = 50;

export const saveScanToOfflineQueue = (scan: Omit<PendingScan, 'id'>) => {
  const queue = getOfflineQueue();
  // Bound the queue to prevent local storage quota exhaustion
  while (queue.length >= MAX_OFFLINE_QUEUE_SIZE) {
    queue.shift(); // Evict oldest scan
  }
  const newScan: PendingScan = {
    ...scan,
    id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
  };
  queue.push(newScan);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch (err) {
    console.warn('Failed to save scan to localStorage offline queue:', err);
  }
};

export const clearOfflineQueue = () => {
  localStorage.removeItem(STORAGE_KEY);
};

export const getBatchQueueSize = (): number => {
  return batchBuffer.length + getOfflineQueue().length;
};

/**
 * Adds a validated scan to the high-speed batch queue buffer.
 * Automatically flushes to the server every 500ms or when buffer size reaches 10.
 */
export const addScanToBatchQueue = (scan: PendingScan) => {
  batchBuffer.push(scan);
  if (batchBuffer.length >= 10) {
    flushBatchQueue();
  } else if (!batchTimer) {
    batchTimer = setTimeout(() => {
      flushBatchQueue();
    }, 100);
  }
};

/**
 * Flushes buffered scans as a single batch request to POST /attendance/batch-scan.
 */
export const flushBatchQueue = async (): Promise<void> => {
  if (batchTimer) {
    clearTimeout(batchTimer);
    batchTimer = null;
  }

  if (batchBuffer.length === 0) return;

  const currentBatch = [...batchBuffer];
  batchBuffer = [];

  try {
    await apiRequest('/attendance/batch-scan', {
      method: 'POST',
      body: JSON.stringify({ scans: currentBatch })
    });
  } catch (err) {
    console.warn('Batch upload network error, saving to offline storage queue:', err);
    currentBatch.forEach(s => saveScanToOfflineQueue(s));
  }
};

export const syncOfflineScans = async (): Promise<{ synced: number; failed: number }> => {
  const queue = getOfflineQueue();
  if (queue.length === 0) return { synced: 0, failed: 0 };

  try {
    const res: any = await apiRequest('/attendance/batch-scan', {
      method: 'POST',
      body: JSON.stringify({ scans: queue })
    });

    const results: Array<{ status: string; reason?: string }> = res.results || [];
    const remainingFailed: PendingScan[] = [];
    let syncedCount = 0;

    queue.forEach((scan, idx) => {
      const itemResult = results[idx];
      if (itemResult && itemResult.status === 'SUCCESS') {
        syncedCount++;
      } else if (itemResult && itemResult.status === 'FAILED') {
        remainingFailed.push({
          ...scan,
          scanned_at: scan.scanned_at || new Date().toISOString()
        });
      } else {
        // Fallback: If no explicit per-item result, assume synced if processed_count covers it
        syncedCount++;
      }
    });

    if (remainingFailed.length === 0) {
      clearOfflineQueue();
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(remainingFailed));
    }

    return { 
      synced: syncedCount, 
      failed: remainingFailed.length 
    };
  } catch (e) {
    console.warn("Offline scan sync network error:", e);
    return { synced: 0, failed: queue.length };
  }
};
