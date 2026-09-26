/**
 * SNIST ERP — Offline Submission Queue Service (Week 9: Flaky-Network Tolerance)
 *
 * Implements persistent IndexedDB + LocalStorage fallback queue for attendance scans:
 * 1. Buffers decoded tokens when network drops mid-submit or device is offline.
 * 2. Retries up to 3 times with exponential backoff (~10s window).
 * 3. Enforces server submit grace policy (SUBMIT_GRACE_MINUTES = 10 post session lock).
 * 4. Automatically synchronizes when browser transitions to 'online'.
 * 5. Idempotent: server rejects duplicate tokens without double-counting (ALREADY_MARKED).
 */

import { apiRequest } from './api';

export const MIN_RECONNECT_JITTER_MS = 2000;  // 2s minimum delay to eliminate simultaneous campus-wide Wi-Fi stampedes
export const MAX_RECONNECT_JITTER_MS = 30000; // 30s maximum randomized spread
export const MAX_QUEUE_CAPACITY = 50;         // Bounded queue limit; discards stale/oldest attempts when quota reached
export const MAX_RETRY_ATTEMPTS = 5;          // Maximum retry attempts before dropping permanently failed scans
export const MAX_ITEM_AGE_MS = 24 * 60 * 60 * 1000; // 24-hour TTL

/**
 * Calculates uniform pseudo-random jitter between minMs and maxMs to de-synchronize
 * client reconnects during campus-wide network restoration.
 */
export function calculateJitterDelay(minMs: number = MIN_RECONNECT_JITTER_MS, maxMs: number = MAX_RECONNECT_JITTER_MS): number {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

/**
 * Calculates exponential backoff with full jitter for retry attempts:
 * backoff = min(maxMs, baseMs * 2^attempt) + random_jitter(0..1000ms)
 */
export function calculateExponentialBackoff(attempt: number, baseMs: number = 2000, maxMs: number = 30000): number {
  const exp = Math.min(maxMs, baseMs * Math.pow(2, Math.max(0, attempt)));
  const jitter = Math.floor(Math.random() * 1000);
  return exp + jitter;
}

export interface QueuedSubmission {
  id?: number;
  client_id: string; // Unique idempotency key per scan attempt
  session_token?: string;
  short_code?: string;
  v?: number;
  token_format?: string;
  device_uuid?: string;
  queued_at: number; // Unix epoch ms
  attempts: number;
  last_error?: string;
  next_retry_at?: number; // Unix epoch ms before which this item should not be retried
  ttl_expires_at?: number; // Unix epoch ms after which this item is dropped
}

const DB_NAME = 'snist_offline_attendance_db';
const DB_VERSION = 1;
const STORE_NAME = 'submissions';
const LAST_SESSION_STORAGE_KEY = 'snist_cached_last_session';
const FALLBACK_STORAGE_KEY = 'snist_offline_submissions_backup';

type QueueListener = (count: number) => void;

class OfflineSubmissionQueueService {
  private db: IDBDatabase | null = null;
  private isInitialized = false;
  private isSyncing = false;
  private reconnectTimer: any = null;
  private listeners: QueueListener[] = [];

  constructor() {
    if (typeof window !== 'undefined') {
      this.initDb();
      window.addEventListener('online', () => {
        // Prevent reconnection stampede: apply exponential backoff jitter (2s-30s)
        this.scheduleJitteredFlush();
      });
    }
  }

  private initDb() {
    if (!('indexedDB' in window)) {
      this.isInitialized = true;
      return;
    }

    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e: any) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
          store.createIndex('client_id', 'client_id', { unique: true });
          store.createIndex('queued_at', 'queued_at', { unique: false });
        }
      };
      req.onsuccess = (e: any) => {
        this.db = e.target.result;
        this.isInitialized = true;
        this.notifyListeners();
        // Stagger startup sync via jittered flush to avoid multi-tab thundering herd
        if (navigator.onLine) {
          this.scheduleJitteredFlush();
        }
      };
      req.onerror = () => {
        this.isInitialized = true;
      };
    } catch {
      this.isInitialized = true;
    }
  }

  /**
   * Schedules a flush operation delayed by a pseudo-random jitter window (2s-30s).
   * Returns the scheduled delay in milliseconds.
   */
  public scheduleJitteredFlush(minMs: number = MIN_RECONNECT_JITTER_MS, maxMs: number = MAX_RECONNECT_JITTER_MS): number {
    this.cancelScheduledFlush();
    const delay = calculateJitterDelay(minMs, maxMs);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.flush();
    }, delay);
    return delay;
  }

  public cancelScheduledFlush(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  public isScheduled(): boolean {
    return this.reconnectTimer !== null;
  }

  public subscribe(listener: QueueListener): () => void {
    this.listeners.push(listener);
    this.getCount().then((cnt) => listener(cnt)).catch(() => {});
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notifyListeners() {
    this.getCount().then((cnt) => {
      this.listeners.forEach((l) => l(cnt));
    }).catch(() => {});
  }

  /**
   * Enqueues a scanned token that could not be transmitted due to network drop.
   * Enforces bounded queue capacity (MAX_QUEUE_CAPACITY=50) to prevent storage exhaustion.
   */
  public async enqueue(sub: Omit<QueuedSubmission, 'queued_at' | 'attempts'>): Promise<void> {
    // 1. Bound check: Prune oldest submissions if queue capacity is reached
    const existing = await this.getAllQueued();
    if (existing.length >= MAX_QUEUE_CAPACITY) {
      // Sort oldest first and prune
      existing.sort((a, b) => a.queued_at - b.queued_at);
      const toRemove = existing.slice(0, existing.length - MAX_QUEUE_CAPACITY + 1);
      for (const oldItem of toRemove) {
        await this.remove(oldItem);
      }
    }

    const item: QueuedSubmission = {
      ...sub,
      queued_at: Date.now(),
      attempts: 0,
      ttl_expires_at: Date.now() + MAX_ITEM_AGE_MS
    };

    if (this.db) {
      await new Promise<void>((resolve) => {
        try {
          const tx = this.db!.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          store.add(item);
          tx.oncomplete = () => {
            this.notifyListeners();
            resolve();
          };
          tx.onerror = () => {
            this.saveToLocalStorageFallback(item);
            this.notifyListeners();
            resolve();
          };
        } catch {
          this.saveToLocalStorageFallback(item);
          this.notifyListeners();
          resolve();
        }
      });
    } else {
      this.saveToLocalStorageFallback(item);
      this.notifyListeners();
    }
  }

  /**
   * Retrieves count of pending offline submissions.
   */
  public async getCount(): Promise<number> {
    if (this.db) {
      return new Promise<number>((resolve) => {
        try {
          const tx = this.db!.transaction(STORE_NAME, 'readonly');
          const store = tx.objectStore(STORE_NAME);
          const countReq = store.count();
          countReq.onsuccess = () => resolve(countReq.result);
          countReq.onerror = () => resolve(this.getLocalStorageFallback().length);
        } catch {
          resolve(this.getLocalStorageFallback().length);
        }
      });
    }
    return this.getLocalStorageFallback().length;
  }

  /**
   * Synchronizes queued submissions with the backend server.
   * If isManualUserAction is true (e.g. user pressed "Sync Now"), backoff delay checks are bypassed.
   */
  public async flush(options?: { isManualUserAction?: boolean }): Promise<{ success: number; failed: number }> {
    if (this.isSyncing || !navigator.onLine) {
      return { success: 0, failed: 0 };
    }

    this.cancelScheduledFlush();
    this.isSyncing = true;
    let successCount = 0;
    let failCount = 0;
    const now = Date.now();
    const isManual = Boolean(options?.isManualUserAction);

    try {
      const items = await this.getAllQueued();
      for (const item of items) {
        // TTL Check: Drop items older than 24 hours
        if (item.ttl_expires_at && now > item.ttl_expires_at) {
          await this.remove(item);
          continue;
        }

        // Retry limit check: Drop after max retries exhausted
        if (item.attempts >= MAX_RETRY_ATTEMPTS) {
          await this.remove(item);
          failCount++;
          continue;
        }

        // Exponential backoff check: Skip item if backoff window has not elapsed (unless manual sync)
        if (!isManual && item.next_retry_at && now < item.next_retry_at) {
          continue;
        }

        try {
          const res: any = await apiRequest('/student/scan-session', {
            method: 'POST',
            body: JSON.stringify({
              session_token: item.session_token || item.short_code,
              short_code: item.short_code,
              v: item.v,
              token_format: item.token_format || 'short',
              is_offline_submission: true,
              queued_at: item.queued_at
            })
          });

          // If successful or already marked (server idempotency guarantee), remove from queue
          if (res?.status === 'SUCCESS' || res?.status === 'ALREADY_MARKED') {
            await this.remove(item);
            successCount++;
          }
        } catch (err: any) {
          const msg = (err.message || '').toLowerCase();
          // If expired beyond grace window or section mismatch, drop item to avoid endless replay
          if (msg.includes('expired') || msg.includes('not enrolled') || msg.includes('invalid')) {
            await this.remove(item);
            failCount++;
          } else {
            // Transient error: increment attempts and schedule exponential backoff with jitter
            item.attempts += 1;
            item.last_error = err.message || 'Network error';
            item.next_retry_at = Date.now() + calculateExponentialBackoff(item.attempts);
            await this.update(item);
            failCount++;
          }
        }
      }
    } finally {
      this.isSyncing = false;
      this.notifyListeners();
    }

    return { success: successCount, failed: failCount };
  }

  private async getAllQueued(): Promise<QueuedSubmission[]> {
    if (this.db) {
      return new Promise<QueuedSubmission[]>((resolve) => {
        try {
          const tx = this.db!.transaction(STORE_NAME, 'readonly');
          const store = tx.objectStore(STORE_NAME);
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => resolve(this.getLocalStorageFallback());
        } catch {
          resolve(this.getLocalStorageFallback());
        }
      });
    }
    return this.getLocalStorageFallback();
  }

  private async remove(item: QueuedSubmission): Promise<void> {
    if (this.db && item.id !== undefined) {
      await new Promise<void>((resolve) => {
        try {
          const tx = this.db!.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          store.delete(item.id!);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        } catch {
          resolve();
        }
      });
    }
    this.removeFromLocalStorageFallback(item.client_id);
  }

  private async update(item: QueuedSubmission): Promise<void> {
    if (this.db && item.id !== undefined) {
      await new Promise<void>((resolve) => {
        try {
          const tx = this.db!.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          store.put(item);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        } catch {
          resolve();
        }
      });
    }
  }

  // --- LocalStorage Fallback Helpers ---
  private getLocalStorageFallback(): QueuedSubmission[] {
    try {
      const raw = localStorage.getItem(FALLBACK_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  private saveToLocalStorageFallback(item: QueuedSubmission) {
    try {
      const items = this.getLocalStorageFallback();
      if (!items.some((i) => i.client_id === item.client_id)) {
        items.push(item);
        localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(items));
      }
    } catch {}
  }

  private removeFromLocalStorageFallback(clientId: string) {
    try {
      const items = this.getLocalStorageFallback().filter((i) => i.client_id !== clientId);
      localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(items));
    } catch {}
  }

  // --- Cached Session Hint Helpers (never a blank screen when offline) ---
  public saveCachedLastSession(sessionMeta: any) {
    try {
      if (sessionMeta) {
        localStorage.setItem(LAST_SESSION_STORAGE_KEY, JSON.stringify({
          ...sessionMeta,
          cached_at: Date.now()
        }));
      }
    } catch {}
  }

  public getCachedLastSession(): any | null {
    try {
      const raw = localStorage.getItem(LAST_SESSION_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
}

export interface QueuedManualMark {
  client_id: string;
  session_id: number;
  roll_number: string;
  status: 'PRESENT' | 'ABSENT';
  period_count: number;
  reason: string;
  reason_detail?: string;
  confirm_high_volume?: boolean;
  queued_at: number;
}

const FACULTY_MANUAL_STORAGE_KEY = 'snist_faculty_offline_manual_marks';

class FacultyManualMarkQueueService {
  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.flush();
      });
    }
  }

  public getQueue(): QueuedManualMark[] {
    try {
      const raw = localStorage.getItem(FACULTY_MANUAL_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  public enqueue(mark: Omit<QueuedManualMark, 'queued_at'>): void {
    try {
      const queue = this.getQueue();
      queue.push({
        ...mark,
        queued_at: Date.now()
      });
      localStorage.setItem(FACULTY_MANUAL_STORAGE_KEY, JSON.stringify(queue));
    } catch {}
  }

  public async flush(): Promise<{ success: number; failed: number }> {
    if (!navigator.onLine) return { success: 0, failed: 0 };
    const queue = this.getQueue();
    if (queue.length === 0) return { success: 0, failed: 0 };

    let success = 0;
    let failed = 0;
    const remaining: QueuedManualMark[] = [];

    for (const item of queue) {
      try {
        await apiRequest('/attendance/manual-mark', {
          method: 'POST',
          body: JSON.stringify({
            session_id: item.session_id,
            roll_number: item.roll_number,
            status: item.status,
            period_count: item.period_count,
            reason: item.reason,
            reason_detail: item.reason_detail,
            confirm_high_volume: item.confirm_high_volume
          })
        });
        success++;
      } catch (err: any) {
        const msg = (err.message || '').toLowerCase();
        if (msg.includes('not found') || msg.includes('does not match') || msg.includes('duplicate')) {
          // Terminal error, drop item
        } else {
          remaining.push(item);
          failed++;
        }
      }
    }

    try {
      localStorage.setItem(FACULTY_MANUAL_STORAGE_KEY, JSON.stringify(remaining));
    } catch {}

    return { success, failed };
  }

  public getCount(): number {
    return this.getQueue().length;
  }
}

export const offlineSubmissionQueue = new OfflineSubmissionQueueService();
export const facultyManualMarkQueue = new FacultyManualMarkQueueService();
