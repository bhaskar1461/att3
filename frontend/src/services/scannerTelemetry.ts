/**
 * SNIST ERP — QR Scanner Funnel Telemetry Service
 * Week 1: Instrumentation & Forensics Layer
 *
 * PRIME DIRECTIVE: Zero impact on scan path.
 * - Non-blocking asynchronous background execution.
 * - Queue in memory + IndexedDB (survives tab close/reload).
 * - Batched transport via sendBeacon / fetch keepalive (>=10 events or 10s).
 * - Max 500 queued events (drops oldest on overflow).
 * - Silent drop after 3 retries (no retry storms).
 * - Schema-level No-PII enforcement: no roll numbers, names, or GPS metrics.
 */

import {
  FunnelStage,
  FailureErrorType,
  DeviceBucket,
  DisplayType,
  TokenFormat,
  ScannerEngine,
  ScanTelemetryEvent,
  TelemetryBatchPayload
} from '../types/telemetry';
import { getRuntimeDeviceBucket } from '../utils/deviceClassifier';
import { getActiveScannerEngine } from './qrEngine';

const DB_NAME = 'snist_scanner_telemetry';
const DB_VERSION = 1;
const STORE_NAME = 'queued_events';
const MAX_QUEUE_SIZE = 500;
const BATCH_SIZE = 10;
const FLUSH_INTERVAL_MS = 10000;
const MAX_BATCH_BYTES = 50 * 1024; // 50 KB
const MAX_RETRIES = 3;
const APP_VERSION = '1.0.0-w1';

// Defensive No-PII Regex Patterns
const ROLL_REGEX = /^[0-9]{2}[A-Za-z0-9]{8,10}$/;
const FORBIDDEN_KEY_REGEX = /(roll|name|student|email|phone|mobile|gps|lat|lng|coord|fingerprint|uuid)/i;

function containsPii(obj: any): boolean {
  if (!obj) return false;
  if (typeof obj === 'string') {
    return ROLL_REGEX.test(obj.trim());
  }
  if (typeof obj === 'object') {
    for (const [key, val] of Object.entries(obj)) {
      if (FORBIDDEN_KEY_REGEX.test(key)) return true;
      if (containsPii(val)) return true;
    }
  }
  return false;
}

class ScannerTelemetryManager {
  private memoryQueue: ScanTelemetryEvent[] = [];
  private db: IDBDatabase | null = null;
  private isFlushing: boolean = false;
  private flushTimer: any = null;
  private retryCounts: Map<string, number> = new Map();
  private isInitialized: boolean = false;

  constructor() {
    if (typeof window !== 'undefined') {
      this.initIndexedDb();
      this.setupLifecycleHooks();
      this.startFlushTimer();
    }
  }

  private initIndexedDb() {
    if (!('indexedDB' in window)) return;
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e: any) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = (e: any) => {
        this.db = e.target.result;
        this.isInitialized = true;
        this.loadPersistedEvents();
      };
      req.onerror = () => {
        // Fallback silently to in-memory queue only
        this.isInitialized = true;
      };
    } catch {
      this.isInitialized = true;
    }
  }

  private loadPersistedEvents() {
    if (!this.db) return;
    try {
      const tx = this.db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        if (req.result && req.result.length > 0) {
          // Merge persisted events into memory queue (avoid duplicates)
          const existingIds = new Set(this.memoryQueue.map(e => e.ts));
          for (const ev of req.result) {
            if (!existingIds.has(ev.ts)) {
              this.memoryQueue.push(ev);
            }
          }
          this.enforceMemoryCap();
        }
      };
    } catch {}
  }

  private persistEvent(event: ScanTelemetryEvent) {
    if (!this.db) return;
    try {
      const tx = this.db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.add(event);
      // Clean up overflow in IDB if needed
      const countReq = store.count();
      countReq.onsuccess = () => {
        if (countReq.result > MAX_QUEUE_SIZE) {
          // Delete oldest items
          const openReq = store.openCursor();
          let deleted = 0;
          const toDelete = countReq.result - MAX_QUEUE_SIZE;
          openReq.onsuccess = (e: any) => {
            const cursor = e.target.result;
            if (cursor && deleted < toDelete) {
              cursor.delete();
              deleted++;
              cursor.continue();
            }
          };
        }
      };
    } catch {}
  }

  private clearPersistedEvents(events: ScanTelemetryEvent[]) {
    if (!this.db || events.length === 0) return;
    try {
      const timestamps = new Set(events.map(e => e.ts));
      const tx = this.db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.openCursor();
      req.onsuccess = (e: any) => {
        const cursor = e.target.result;
        if (cursor) {
          if (timestamps.has(cursor.value.ts)) {
            cursor.delete();
          }
          cursor.continue();
        }
      };
    } catch {}
  }

  private enforceMemoryCap() {
    if (this.memoryQueue.length > MAX_QUEUE_SIZE) {
      // Drop oldest
      this.memoryQueue.splice(0, this.memoryQueue.length - MAX_QUEUE_SIZE);
    }
  }

  private setupLifecycleHooks() {
    const flushOnExit = () => {
      this.flush(true);
    };
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        flushOnExit();
      }
    });
    window.addEventListener('pagehide', flushOnExit);
    window.addEventListener('beforeunload', flushOnExit);
  }

  private startFlushTimer() {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = setInterval(() => {
      if (this.memoryQueue.length > 0) {
        this.flush(false);
      }
    }, FLUSH_INTERVAL_MS);
  }

  /**
   * Queue a telemetry event defensively.
   * Completely safe: if No-PII check fails or queueing fails, it drops silently.
   */
  public recordEvent(rawEvent: Omit<ScanTelemetryEvent, 'device_bucket' | 'ts' | 'app_version'>) {
    try {
      // Strict No-PII guard: drop if PII detected
      if (containsPii(rawEvent.details) || containsPii(rawEvent.session_id)) {
        console.warn('[Telemetry] Dropped event containing prohibited identity metric.');
        return;
      }

      const event: ScanTelemetryEvent = {
        ...rawEvent,
        engine: rawEvent.engine || getActiveScannerEngine(),
        device_bucket: getRuntimeDeviceBucket(),
        ts: Date.now(),
        app_version: APP_VERSION
      };

      this.memoryQueue.push(event);
      this.enforceMemoryCap();
      this.persistEvent(event);

      // Trigger immediate flush if batch threshold reached
      if (this.memoryQueue.length >= BATCH_SIZE) {
        this.flush(false);
      }
    } catch (e) {
      // Zero crash guarantee on scan path
    }
  }

  /**
   * Convenience helpers for the defined funnel stages
   */
  public recordStage(
    stage: FunnelStage, 
    durationMs?: number, 
    sessionId?: string, 
    details?: Record<string, any>,
    displayType?: DisplayType,
    decodeDurationMs?: number,
    tokenFormat?: TokenFormat,
    engine?: ScannerEngine
  ) {
    this.recordEvent({
      event_type: stage,
      stage,
      duration_ms: durationMs,
      decode_duration_ms: decodeDurationMs,
      display_type: displayType,
      token_format: tokenFormat,
      engine: engine || getActiveScannerEngine(),
      session_id: sessionId,
      details
    });
  }

  public recordFailure(
    errorType: FailureErrorType,
    stage?: FunnelStage,
    sessionId?: string,
    details?: Record<string, any>,
    displayType?: DisplayType,
    tokenFormat?: TokenFormat,
    engine?: ScannerEngine
  ) {
    this.recordEvent({
      event_type: 'scan_failed',
      stage,
      error_type: errorType,
      display_type: displayType,
      token_format: tokenFormat,
      engine: engine || getActiveScannerEngine(),
      session_id: sessionId,
      details
    });
  }

  public recordLadderTransition(fromRung: number, toRung: number, reason?: string, sessionId?: string) {
    this.recordEvent({
      event_type: 'ladder_rung_transition',
      session_id: sessionId,
      ladder_rung: toRung,
      from_rung: fromRung,
      details: {
        from_state: `rung_${fromRung}`,
        to_state: `rung_${toRung}`,
        reason: reason || 'degradation_ladder_progression'
      }
    });
  }

  public recordCameraOpenTimeout(ladderRung: number, sessionId?: string) {
    this.recordFailure(
      'camera_open_timeout',
      'camera_permission_result',
      sessionId,
      {
        constraint_ladder_rung: ladderRung,
        action: 'WATCHDOG_TIMEOUT_RETRY_NEXT_RUNG',
        timeout_ms: 8000
      }
    );
  }

  public recordRetry(attemptNo: number, sessionId?: string) {
    this.recordEvent({
      event_type: 'scan_retried',
      session_id: sessionId,
      details: { attempt_no: attemptNo }
    });
  }

  public recordManualSearch(queryType: 'roll' | 'name', sessionId?: string) {
    this.recordEvent({
      event_type: 'manual_search_used',
      session_id: sessionId,
      details: { query_type: queryType }
    });
  }

  public recordManualMark(reason: string, sessionId?: string) {
    this.recordEvent({
      event_type: 'manual_mark_created',
      session_id: sessionId,
      details: { reason: reason || 'faculty_manual_override' }
    });
  }

  /**
   * Flushes queued events to the backend telemetry ingest endpoint.
   */
  public async flush(isExiting: boolean = false) {
    if (this.isFlushing || this.memoryQueue.length === 0) return;
    this.isFlushing = true;

    // Take up to 50 events for this batch
    const batch = this.memoryQueue.slice(0, 50);
    const payload: TelemetryBatchPayload = {
      events: batch,
      sent_at: Date.now()
    };

    const payloadString = JSON.stringify(payload);
    // Enforce 50 KB hard cap
    if (new Blob([payloadString]).size > MAX_BATCH_BYTES) {
      // Trim batch in half if oversized
      batch.splice(25);
    }

    const token = localStorage.getItem('token');
    const endpoint = '/api/v1/telemetry/scan-events';

    const batchKey = `${batch[0]?.ts || 0}_${batch.length}`;
    const retries = this.retryCounts.get(batchKey) || 0;

    try {
      if (isExiting && typeof navigator !== 'undefined' && navigator.sendBeacon) {
        // Beacon requires blob with json content-type
        const blob = new Blob([JSON.stringify({ events: batch, sent_at: Date.now() })], {
          type: 'application/json'
        });
        const success = navigator.sendBeacon(endpoint, blob);
        if (success) {
          this.dequeueBatch(batch);
        }
      } else {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json'
        };
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        const res = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({ events: batch, sent_at: Date.now() }),
          keepalive: true
        });

        if (res.status === 202 || res.ok) {
          this.dequeueBatch(batch);
          this.retryCounts.delete(batchKey);
        } else {
          throw new Error(`Ingest failed with status ${res.status}`);
        }
      }
    } catch (err) {
      if (retries + 1 >= MAX_RETRIES) {
        // Drop silently after 3 retries — NO retry storms
        this.dequeueBatch(batch);
        this.retryCounts.delete(batchKey);
      } else {
        this.retryCounts.set(batchKey, retries + 1);
      }
    } finally {
      this.isFlushing = false;
    }
  }

  private dequeueBatch(batch: ScanTelemetryEvent[]) {
    const sentTimestamps = new Set(batch.map(e => e.ts));
    this.memoryQueue = this.memoryQueue.filter(e => !sentTimestamps.has(e.ts));
    this.clearPersistedEvents(batch);
  }
}

export const scannerTelemetry = new ScannerTelemetryManager();
