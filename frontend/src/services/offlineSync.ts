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

export const saveScanToOfflineQueue = (scan: Omit<PendingScan, 'id'>) => {
  const queue = getOfflineQueue();
  const newScan: PendingScan = {
    ...scan,
    id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
  };
  queue.push(newScan);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
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
    }, 500);
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
    clearOfflineQueue();
    return { synced: res.processed_count || queue.length, failed: 0 };
  } catch (e) {
    console.warn("Offline scan sync error:", e);
    return { synced: 0, failed: queue.length };
  }
};
