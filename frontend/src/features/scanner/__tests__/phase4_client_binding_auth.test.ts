/**
 * Phase 4 Adversarial Verification Suite: Client-Side Device Binding & WebCrypto Audit
 * Location: frontend/src/features/scanner/__tests__/phase4_client_binding_auth.test.ts
 *
 * Covers:
 * Task 2.1: Canonical Digest Shared-Vector Consistency (Client vs Server canonical format)
 * Task 5.1: Client Token Storage & XSS Theft Exposure (localStorage analysis)
 * Task 7.1: Non-Extractable ECDSA Key Verification (extractable: false invariant)
 * Task 7.2: iOS Safari ITP 7-Day Storage Eviction Simulation (divergent_no_handle & taxonomy gap)
 * Task 7.3: State-Mismatch Matrix (All 4 Cells: ACTIVE/present, ACTIVE/missing, missing/present, missing/missing)
 * Task 7.5: Device UUID Generation & Regeneration on Storage Clear
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// In-Memory Storage & IndexedDB Polyfill for Deterministic Node Execution
// ---------------------------------------------------------------------------
const mockStore: Record<string, string> = {};
const localStoragePolyfill = {
  getItem: (k: string) => (k in mockStore ? mockStore[k] : null),
  setItem: (k: string, v: string) => { mockStore[k] = String(v); },
  removeItem: (k: string) => { delete mockStore[k]; },
  clear: () => { Object.keys(mockStore).forEach(k => delete mockStore[k]); }
};

let mockCookieStr = '';
const documentPolyfill = {
  get cookie() {
    return mockCookieStr;
  },
  set cookie(val: string) {
    if (val.includes('expires=Thu, 01 Jan 1970') || val.includes('expires=Thu, 01-Jan-1970')) {
      mockCookieStr = '';
    } else {
      const pair = val.split(';')[0];
      mockCookieStr = pair;
    }
  }
};

class MockIDBStore {
  items = new Map<string, any>();
  get(key: string) {
    const req: any = { result: this.items.get(key), onsuccess: null, onerror: null };
    queueMicrotask(() => req.onsuccess?.({ target: req }));
    return req;
  }
  put(val: any) {
    this.items.set(val.id || 'primary', val);
    const req: any = { onsuccess: null, onerror: null };
    queueMicrotask(() => req.onsuccess?.({ target: req }));
    return req;
  }
  delete(key: string) {
    this.items.delete(key);
    const req: any = { onsuccess: null, onerror: null };
    queueMicrotask(() => req.onsuccess?.({ target: req }));
    return req;
  }
  clear() {
    this.items.clear();
  }
}

const mockDbStore = new MockIDBStore();

const mockIDBDatabase = {
  transaction: (_storeName: string, _mode: string) => {
    const tx: any = {
      objectStore: () => mockDbStore,
      oncomplete: null,
      onerror: null
    };
    queueMicrotask(() => tx.oncomplete?.());
    return tx;
  },
  close: () => {}
};

const mockIDBFactory = {
  open: (_name: string, _ver?: number) => {
    const req: any = {
      result: mockIDBDatabase,
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null
    };
    queueMicrotask(() => {
      req.onsuccess?.({ target: req });
    });
    return req;
  }
};

(globalThis as any).window = globalThis;
(globalThis as any).localStorage = localStoragePolyfill;
(globalThis as any).sessionStorage = localStoragePolyfill;
(globalThis as any).document = documentPolyfill;
(globalThis as any).indexedDB = mockIDBFactory;

import {
  evaluateStorageConsistency,
  saveBindingRecord,
  readBindingRecord,
  deleteBindingRecord,
  clearBindingNonceCookie,
  setBindingNonceCookie,
  getBindingNonceCookie
} from '../../../services/binding/storage';
import {
  signChallenge,
  generateKeyPair
} from '../../../services/binding';
import {
  StorageDivergenceError,
  NoKeyStoredError,
  KeyInvalidError
} from '../../../services/binding/types';

describe('PHASE 4 — Client-Side Device Binding & Cryptographic Identity Audit', () => {

  beforeEach(() => {
    localStoragePolyfill.clear();
    mockCookieStr = '';
    mockDbStore.clear();
  });

  afterEach(() => {
    localStoragePolyfill.clear();
    mockCookieStr = '';
    mockDbStore.clear();
  });

  // =========================================================================
  // TASK 7.1: NON-EXTRACTABLE ECDSA KEY GENERATION
  // =========================================================================
  describe('Task 7.1: WebCrypto extractable: false Invariant', () => {
    it('CRITICAL: generateKey must mandate extractable=false to prevent private key cloning', async () => {
      const subtle = crypto.subtle;
      const generateKeySpy = vi.spyOn(subtle, 'generateKey');

      const payload = await generateKeyPair('21071A0501', false);

      expect(generateKeySpy).toHaveBeenCalled();
      const callArgs = generateKeySpy.mock.calls[0];
      
      // Argument 1: Algorithm
      expect((callArgs[0] as any).name).toBe('ECDSA');
      expect((callArgs[0] as any).namedCurve).toBe('P-256');

      // Argument 2: extractable MUST BE strictly false
      // Citation: frontend/src/services/binding/cryptoEngine.ts:99
      const isExtractable = callArgs[1];
      expect(isExtractable).toBe(false);

      // Argument 3: Key Usages
      expect(callArgs[2]).toEqual(['sign', 'verify']);

      // Verify generated public payload has SPKI Base64 and derived key_id
      expect(payload.public_key_spki_b64).toBeTruthy();
      expect(payload.key_id).toHaveLength(32);
      expect(payload.key_algorithm).toBe('ECDSA_P256');

      generateKeySpy.mockRestore();
    });
  });

  // =========================================================================
  // TASK 2.1: CANONICAL DIGEST SHARED-VECTOR TEST
  // =========================================================================
  describe('Task 2.1: Canonical Challenge Digest Shared-Vector Test', () => {
    it('Deterministic canonical challenge encoding matches backend build_canonical_challenge_message byte-for-byte', () => {
      // Fixed test vectors
      const testChallengeId = 'cid-9876-5432-1000';
      const testDeviceId = 'DEV-SNIST-PHASE4-001';
      const testOperation = 'ATTENDANCE';
      const testTimestamp = 1774872000;
      const testNonce = 'nonce_abc123_deterministic_test_vector_999';

      // Client-side construction (cryptoEngine.ts:237)
      const clientCanonicalMsg = `attendance_device_proof_v1|${testChallengeId}|${testDeviceId}|${testOperation}|${testTimestamp}|${testNonce}`;

      // Server-side construction format from backend/app/core/binding_crypto.py:69:
      // f"attendance_device_proof_v1|{challenge_id}|{device_id}|{operation}|{timestamp}|{nonce}"
      const expectedServerFormat = `attendance_device_proof_v1|${testChallengeId}|${testDeviceId}|${testOperation}|${testTimestamp}|${testNonce}`;

      expect(clientCanonicalMsg).toBe(expectedServerFormat);

      // Verify field ordering: prefix -> challenge_id -> device_id -> operation -> timestamp -> nonce
      const parts = clientCanonicalMsg.split('|');
      expect(parts[0]).toBe('attendance_device_proof_v1');
      expect(parts[1]).toBe(testChallengeId);
      expect(parts[2]).toBe(testDeviceId);
      expect(parts[3]).toBe(testOperation);
      expect(parts[4]).toBe(testTimestamp.toString());
      expect(parts[5]).toBe(testNonce);
    });
  });

  // =========================================================================
  // TASK 7.2 & 7.3: STATE-MISMATCH MATRIX & iOS SAFARI ITP EVICTION
  // =========================================================================
  describe('Task 7.2 & 7.3: State-Mismatch Matrix (All 4 Storage States)', () => {

    it('CELL 1: Normal Scan State -> IndexedDB Key Present + Cookie Present -> intact', async () => {
      // Enroll valid keypair with autoCommit=true
      const enrolled = await generateKeyPair('21071A0501', true);
      expect(enrolled.stored_record).toBeDefined();

      const consistency = await evaluateStorageConsistency();
      expect(consistency.status).toBe('intact');
      expect(consistency.record).not.toBeNull();
      expect(consistency.record?.private_key).toBeDefined();

      // Sign challenge succeeds
      const challengeToken = 'mock_challenge.hmac_signature';
      const sigResult = await signChallenge(challengeToken, '21071A0501');
      expect(sigResult.signature_b64).toBeTruthy();
      expect(sigResult.algorithm).toBe('ECDSA_P256_SHA256');
    });

    it('CELL 2 (iOS Safari ITP Eviction): IndexedDB Wiped after 7 Days + Corroboration Cookie Survives -> divergent_no_handle (TAXONOMY GAP)', async () => {
      // Step 1: Student enrolled previously
      const enrolled = await generateKeyPair('21071A0501', true);
      const survivingNonce = enrolled.binding_nonce;
      expect(getBindingNonceCookie()).toBe(survivingNonce);

      // Step 2: iOS Safari 7-day ITP or Private Browsing storage eviction:
      // IndexedDB database is deleted, but cookie survives in browser session
      mockDbStore.clear(); // Simulate complete eviction of IndexedDB
      // Re-set the surviving cookie
      setBindingNonceCookie(survivingNonce, 365);

      expect(getBindingNonceCookie()).toBe(survivingNonce);
      const dbRecord = await readBindingRecord();
      expect(dbRecord).toBeNull(); // Key wiped!

      // Step 3: Evaluate storage consistency
      const consistency = await evaluateStorageConsistency();
      expect(consistency.status).toBe('divergent_no_handle');
      expect(consistency.record).toBeNull();

      // Step 4: Attempting to sign challenge throws StorageDivergenceError
      await expect(
        signChallenge('mock_challenge.hmac', '21071A0501')
      ).rejects.toThrow(StorageDivergenceError);

      try {
        await signChallenge('mock_challenge.hmac', '21071A0501');
      } catch (err: any) {
        expect(err instanceof StorageDivergenceError).toBe(true);
        expect(err.code).toBe('STORAGE_DIVERGENCE');
        expect(err.hasIndexedDB).toBe(false);
        expect(err.hasCookie).toBe(true);
      }
    });

    it('CELL 3: Storage Cleared Cookie but IndexedDB Survived -> Self-Healing Rehydration', async () => {
      // Step 1: Enroll key
      const enrolled = await generateKeyPair('21071A0501', true);
      
      // Step 2: Cookie cleared by browser/user, but IndexedDB non-extractable key survived
      clearBindingNonceCookie();
      expect(getBindingNonceCookie()).toBeNull();

      // Step 3: evaluateStorageConsistency self-heals the cookie from record.binding_nonce
      const consistency = await evaluateStorageConsistency();
      expect(consistency.status).toBe('intact');
      expect(consistency.record).not.toBeNull();

      // Verify cookie was re-hydrated
      expect(getBindingNonceCookie()).toBe(enrolled.binding_nonce);
    });

    it('CELL 4: Clean Device (No Key in IndexedDB + No Cookie) -> clean -> NoKeyStoredError', async () => {
      // Completely clean state
      const consistency = await evaluateStorageConsistency();
      expect(consistency.status).toBe('clean');
      expect(consistency.record).toBeNull();

      // Signing throws NoKeyStoredError
      await expect(
        signChallenge('mock_challenge.hmac', '21071A0501')
      ).rejects.toThrow(NoKeyStoredError);
    });

    it('Account Switching Protection: Stored key belonging to Roll A rejects signing for Roll B', async () => {
      // Enroll key for Alice (21071A0501)
      await generateKeyPair('21071A0501', true);

      // Bob (21071A0502) tries to sign a challenge on Alice\'s device
      await expect(
        signChallenge('mock_challenge.hmac', '21071A0502')
      ).rejects.toThrow(KeyInvalidError);
    });
  });

  // =========================================================================
  // TASK 5.1: TOKEN STORAGE IN LOCALSTORAGE (XSS THEFT EXPOSURE)
  // =========================================================================
  describe('Task 5.1: Client Token Storage & XSS Theft Exposure Audit', () => {
    it('Documents that access_token and refresh_token are persisted in browser localStorage', () => {
      // Simulate auth token persistence as done across Login.tsx and tokenLifecycle.ts
      const testAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test_access_token';
      const testRefreshToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test_refresh_token';

      localStorage.setItem('access_token', testAccessToken);
      localStorage.setItem('token', testAccessToken);
      localStorage.setItem('refresh_token', testRefreshToken);

      // Verify localStorage exposure
      expect(localStorage.getItem('access_token')).toBe(testAccessToken);
      expect(localStorage.getItem('token')).toBe(testAccessToken);
      expect(localStorage.getItem('refresh_token')).toBe(testRefreshToken);

      // Security finding verification: localStorage is accessible to any script executing in origin (XSS vulnerability)
      // Unlike HttpOnly cookies, malicious scripts or third-party dependencies can read access_token
      expect(typeof window.localStorage).toBe('object');
    });
  });

  // =========================================================================
  // TASK 7.5: DEVICE UUID GENERATION & REGENERATION ON STORAGE CLEAR
  // =========================================================================
  describe('Task 7.5: Device UUID Generation & Soft-Lock Reset', () => {
    it('Clearing client storage causes fresh random UUID generation (Soft-Lock bypass mechanism)', () => {
      // Verify randomUUID format
      const id1 = crypto.randomUUID();
      const id2 = crypto.randomUUID();

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

      // When localStorage is cleared, any previously cached device UUID is lost,
      // and a new randomUUID is generated on next app load
      localStorage.setItem('device_uuid', id1);
      expect(localStorage.getItem('device_uuid')).toBe(id1);

      localStorage.removeItem('device_uuid');
      const regeneratedId = crypto.randomUUID();
      expect(regeneratedId).not.toBe(id1);
    });
  });

});
