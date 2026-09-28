/**
 * Phase 4 Verification: IndexedDB Bounded Queue & Reconnection Jitter Backoff
 *
 * Verifies:
 * 1. calculateJitterDelay bounds (2s - 30s) across 100 iterations
 * 2. calculateExponentialBackoff progression and upper-bound capping (30s max)
 * 3. Constant integrity (MAX_QUEUE_CAPACITY = 50, MAX_RETRY_ATTEMPTS = 5, MAX_ITEM_AGE = 24h)
 * 4. Staggered scheduling: scheduleJitteredFlush and cancelScheduledFlush
 * 5. Bounded queue pruning: Prevents storage exhaustion when queue exceeds 50 items
 */

import {
  calculateJitterDelay,
  calculateExponentialBackoff,
  MIN_RECONNECT_JITTER_MS,
  MAX_RECONNECT_JITTER_MS,
  MAX_QUEUE_CAPACITY,
  MAX_RETRY_ATTEMPTS,
  MAX_ITEM_AGE_MS,
  offlineSubmissionQueue
} from '../offlineSubmissionQueue';
import { saveScanToOfflineQueue, getOfflineQueue, clearOfflineQueue, MAX_OFFLINE_QUEUE_SIZE } from '../offlineSync';

import { describe, it, expect } from 'vitest';

// Mock localStorage if not running in full browser
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => store.get(key) || null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] || null,
    length: store.size
  } as any;
}

describe('Phase 4 Verification: IndexedDB Bounded Queue & Reconnection Jitter Backoff', () => {
  it('executes all jitter and queue assertions cleanly', () => {
    let passed = 0;
    let failed = 0;

    function assert(condition: boolean, testName: string, detail?: string) {
      expect(condition, `${testName}${detail ? ` - ${detail}` : ''}`).toBe(true);
      if (condition) {
        passed++;
        console.log(`  [PASS] ${testName}`);
      } else {
        failed++;
        console.error(`  [FAIL] ${testName}${detail ? ` - ${detail}` : ''}`);
      }
    }

console.log('\n======================================================');
console.log('RUNNING PHASE 4 OFFLINE QUEUE & JITTER TEST SUITE');
console.log('======================================================\n');

// -----------------------------------------------------------------------------
// Suite 1: Reconnection Jitter Distribution
// -----------------------------------------------------------------------------
console.log('Suite 1: Reconnection Jitter Distribution & Bounds (2s - 30s)');

assert(MIN_RECONNECT_JITTER_MS === 2000, 'MIN_RECONNECT_JITTER_MS is exactly 2,000ms');
assert(MAX_RECONNECT_JITTER_MS === 30000, 'MAX_RECONNECT_JITTER_MS is exactly 30,000ms');

let minObserved = Infinity;
let maxObserved = -Infinity;
let allWithinBounds = true;
const sampleDelays = new Set<number>();

for (let i = 0; i < 200; i++) {
  const delay = calculateJitterDelay();
  if (delay < 2000 || delay > 30000) {
    allWithinBounds = false;
  }
  if (delay < minObserved) minObserved = delay;
  if (delay > maxObserved) maxObserved = delay;
  sampleDelays.add(delay);
}

assert(allWithinBounds, '200 pseudo-random jitter delays all strictly fall within [2000ms, 30000ms]');
assert(sampleDelays.size > 150, `High entropy verified (${sampleDelays.size}/200 unique delays sampled)`);
assert(minObserved < 5000, `Lower percentile spread confirmed (lowest: ${minObserved}ms)`);
assert(maxObserved > 25000, `Upper percentile spread confirmed (highest: ${maxObserved}ms)`);

// -----------------------------------------------------------------------------
// Suite 2: Exponential Backoff Progression with Jitter
// -----------------------------------------------------------------------------
console.log('\nSuite 2: Exponential Backoff Progression with Jitter');

for (let attempt = 0; attempt <= 6; attempt++) {
  const backoff = calculateExponentialBackoff(attempt);
  if (attempt === 0) {
    assert(backoff >= 2000 && backoff <= 3000, `Attempt 0 backoff: ${backoff}ms (expected 2000-3000ms)`);
  } else if (attempt === 1) {
    assert(backoff >= 4000 && backoff <= 5000, `Attempt 1 backoff: ${backoff}ms (expected 4000-5000ms)`);
  } else if (attempt === 2) {
    assert(backoff >= 8000 && backoff <= 9000, `Attempt 2 backoff: ${backoff}ms (expected 8000-9000ms)`);
  } else if (attempt === 3) {
    assert(backoff >= 16000 && backoff <= 17000, `Attempt 3 backoff: ${backoff}ms (expected 16000-17000ms)`);
  } else if (attempt >= 4) {
    assert(backoff >= 30000 && backoff <= 31000, `Attempt ${attempt} backoff properly capped at ~30s: ${backoff}ms`);
  }
}

// -----------------------------------------------------------------------------
// Suite 3: Scheduling Timer Controls
// -----------------------------------------------------------------------------
console.log('\nSuite 3: Staggered Scheduling Timer Controls');

offlineSubmissionQueue.cancelScheduledFlush();
assert(!offlineSubmissionQueue.isScheduled(), 'Queue starts untripped without scheduled timer');

const scheduledDelay = offlineSubmissionQueue.scheduleJitteredFlush(2000, 5000);
assert(offlineSubmissionQueue.isScheduled(), 'Queue enters scheduled state upon jittered trigger');
assert(scheduledDelay >= 2000 && scheduledDelay <= 5000, `Scheduled delay in target window: ${scheduledDelay}ms`);

offlineSubmissionQueue.cancelScheduledFlush();
assert(!offlineSubmissionQueue.isScheduled(), 'cancelScheduledFlush cleanly disarms the reconnection timer');

// -----------------------------------------------------------------------------
// Suite 4: Bounded Queue Capacity & Pruning (MAX_QUEUE_CAPACITY = 50)
// -----------------------------------------------------------------------------
console.log('\nSuite 4: Bounded Queue Capacity & Pruning');

assert(MAX_QUEUE_CAPACITY === 50, 'MAX_QUEUE_CAPACITY constant is 50');
assert(MAX_RETRY_ATTEMPTS === 5, 'MAX_RETRY_ATTEMPTS is 5 attempts');
assert(MAX_ITEM_AGE_MS === 86400000, 'MAX_ITEM_AGE_MS is 24 hours (86,400,000ms)');

// Test offlineSync bounded queue
clearOfflineQueue();
assert(getOfflineQueue().length === 0, 'Offline batch queue starts empty');

for (let i = 1; i <= 65; i++) {
  saveScanToOfflineQueue({
    session_id: 100 + i,
    qr_payload: `SNIST-TOKEN-TEST-${i}`,
    scanned_at: new Date(Date.now() - (65 - i) * 1000).toISOString()
  });
}

const queueAfter65 = getOfflineQueue();
assert(queueAfter65.length === MAX_OFFLINE_QUEUE_SIZE, `Offline queue strictly capped at ${MAX_OFFLINE_QUEUE_SIZE} (pruned oldest 15 items)`);
assert(queueAfter65[0].session_id === 116, `Oldest remaining item is item 16 (session_id 116)`);
assert(queueAfter65[queueAfter65.length - 1].session_id === 165, `Latest item is item 65 (session_id 165)`);

clearOfflineQueue();
assert(getOfflineQueue().length === 0, 'Offline batch queue cleared cleanly');

console.log('\n======================================================');
console.log(`TEST RESULTS: ${passed} / ${passed + failed} PASSED (${failed === 0 ? '100% SUCCESS' : 'FAILURES DETECTED'})`);
console.log('======================================================\n');

    expect(failed).toBe(0);
    expect(passed).toBeGreaterThan(0);
  });
});
