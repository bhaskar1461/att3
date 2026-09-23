/**
 * SNIST ERP — Binding V2 Client Storage Engine
 * 
 * Manages dual-layer persistence:
 * 1. Primary Store: IndexedDB ('snist_binding_v2' -> 'binding_records') storing non-extractable CryptoKey handles
 * 2. Paired Corroboration Cookie: 'snist_b2_nonce' (SameSite=Strict, Path=/)
 * 
 * Storage divergence (handle present without cookie, or cookie present without handle)
 * indicates browser data clearing, storage pressure eviction, or environment tampering.
 */

import { StoredBindingRecord, StorageDivergenceError } from './types';

const DB_NAME = 'snist_binding_v2';
const DB_VERSION = 1;
const STORE_NAME = 'binding_records';
const RECORD_ID = 'primary';
const NONCE_COOKIE_NAME = 'snist_b2_nonce';

/**
 * Opens or initializes the binding IndexedDB instance.
 */
export function openBindingDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB is not supported in this environment.'));
    }

    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e: IDBVersionChangeEvent) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB.'));
  });
}

/**
 * Saves the binding record (private key handle, public key, metadata, nonce) to IndexedDB.
 */
export async function saveBindingRecord(record: StoredBindingRecord): Promise<void> {
  const db = await openBindingDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const putReq = store.put({ ...record, id: RECORD_ID });

      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error || new Error('Failed to save binding record.'));
      tx.oncomplete = () => db.close();
    } catch (err) {
      db.close();
      reject(err);
    }
  });
}

/**
 * Reads the binding record from IndexedDB.
 */
export async function readBindingRecord(): Promise<StoredBindingRecord | null> {
  try {
    const db = await openBindingDB();
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const getReq = store.get(RECORD_ID);

        getReq.onsuccess = () => {
          resolve(getReq.result || null);
        };
        getReq.onerror = () => reject(getReq.error);
        tx.oncomplete = () => db.close();
      } catch (err) {
        db.close();
        reject(err);
      }
    });
  } catch {
    return null;
  }
}

/**
 * Completely removes the binding record from IndexedDB.
 */
export async function deleteBindingRecord(): Promise<void> {
  try {
    const db = await openBindingDB();
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const delReq = store.delete(RECORD_ID);

        delReq.onsuccess = () => resolve();
        delReq.onerror = () => reject(delReq.error);
        tx.oncomplete = () => db.close();
      } catch (err) {
        db.close();
        reject(err);
      }
    });
  } catch {
    // Non-fatal if DB doesn't exist
  }
}

// ============================================================================
// CORROBORATION COOKIE MANAGEMENT
// ============================================================================

export function getBindingNonceCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp('(^| )' + NONCE_COOKIE_NAME + '=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : null;
}

export function setBindingNonceCookie(nonce: string, days: number = 365): void {
  if (typeof document === 'undefined') return;
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  const secureFlag = (typeof location !== 'undefined' && location.protocol === 'https:') ? '; Secure' : '';
  document.cookie = `${NONCE_COOKIE_NAME}=${encodeURIComponent(nonce)}; expires=${expires}; path=/; SameSite=Strict${secureFlag}`;
}

export function clearBindingNonceCookie(): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${NONCE_COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Strict`;
}

// ============================================================================
// STORAGE PERSISTENCE & DIVERGENCE DETECTION
// ============================================================================

/**
 * Solicits permanent persistence from the browser to prevent eviction on low-storage devices.
 */
export async function requestStoragePersistence(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
    try {
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Validates storage consistency across IndexedDB and paired cookie.
 */
export async function evaluateStorageConsistency(): Promise<{
  status: 'clean' | 'intact' | 'divergent_no_handle' | 'divergent_no_cookie';
  record: StoredBindingRecord | null;
}> {
  const [record, cookieNonce] = await Promise.all([
    readBindingRecord(),
    Promise.resolve(getBindingNonceCookie())
  ]);

  const hasHandle = !!(record && record.private_key);
  const hasCookie = !!cookieNonce;

  if (!hasHandle && !hasCookie) {
    return { status: 'clean', record: null };
  }

  if (hasHandle && hasCookie) {
    // Both present: verify nonce match
    if (record?.binding_nonce && record.binding_nonce === cookieNonce) {
      return { status: 'intact', record };
    }
    // Nonce mismatch implies transplant or manual cookie manipulation
    return { status: 'divergent_no_cookie', record };
  }

  if (!hasHandle && hasCookie) {
    // Cookie survived but IndexedDB was evicted or wiped
    return { status: 'divergent_no_handle', record: null };
  }

  // hasHandle && !hasCookie: Cookie cleared but IndexedDB survived with non-extractable private key.
  // Self-heal: re-hydrate corroboration cookie from record.binding_nonce to prevent false divergence lockouts.
  if (record?.binding_nonce) {
    setBindingNonceCookie(record.binding_nonce, 365);
    return { status: 'intact', record };
  }
  return { status: 'divergent_no_cookie', record };
}
