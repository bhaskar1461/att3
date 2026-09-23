/**
 * SNIST ERP — Device Binding V2 Client Module Facade
 * 
 * Exposes lazy-loaded, typed high-level binding functions:
 * - getBindingState()
 * - generateKeyPair()
 * - signChallenge()
 * - BINDING_V2_ENABLED flag (default false)
 */

import { BindingState, StoredBindingRecord } from './types';
import {
  isSubtleCryptoSupported,
  generateKeyPair,
  commitBindingRecord,
  signChallenge,
  verifyNonExtractable,
  sha256Hex
} from './cryptoEngine';
import {
  readBindingRecord,
  saveBindingRecord,
  deleteBindingRecord,
  clearBindingNonceCookie,
  evaluateStorageConsistency
} from './storage';
import { getCorroborationTag, getCorroborationDetails } from './corroboration';
import { apiRequest } from '../api';

// Re-export all types and error classes
export * from './types';
export {
  isSubtleCryptoSupported,
  generateKeyPair,
  commitBindingRecord,
  signChallenge,
  verifyNonExtractable,
  sha256Hex,
  readBindingRecord,
  deleteBindingRecord,
  getCorroborationTag,
  getCorroborationDetails
};

export interface ServerBindingStatus {
  enrolled: boolean;
  status: 'BOUND' | 'MISMATCH' | 'NOT_ENROLLED';
  roll_number?: string;
  active_key_id?: string | null;
  device_matches?: boolean | null;
}

/**
 * Queries server-authoritative binding status for the logged-in student.
 */
export async function checkServerBindingStatus(keyId?: string): Promise<ServerBindingStatus | null> {
  try {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token) return null;
    const url = keyId ? `/binding/status?key_id=${encodeURIComponent(keyId)}` : '/binding/status';
    return await apiRequest<ServerBindingStatus>(url);
  } catch (err) {
    console.warn('[Binding] Server status check skipped or failed:', err);
    return null;
  }
}

/**
 * Feature Flag: BINDING_V2
 * In Phase 5 Cutover, default is TRUE on dev (enabled by default unless explicitly 'false').
 */
export const BINDING_V2_ENABLED: boolean = 
  typeof import.meta !== 'undefined' && (import.meta as any).env ? (import.meta as any).env.VITE_BINDING_V2 !== 'false' : true;

export interface BindingStateOptions {
  verifyWithServer?: boolean;
  serverBoundKeyId?: string | null;
}

/**
 * Evaluates the authoritative binding state of the current browser client.
 * If expectedStudentRoll is provided, verifies that stored key belongs to that student.
 * If options.serverBoundKeyId is provided, validates that stored key matches server.
 * If options.verifyWithServer is true, queries /binding/status.
 * Returns one of:
 * - 'unsupported': Browser engine lacks WebCrypto or ECDSA P-256 support
 * - 'not_enrolled': Clean browser, or unconfirmed/mismatched key
 * - 'enrolled': Valid non-extractable keypair stored, verified locally and by server
 * - 'incomplete': Divergent storage (cookie present without handle or vice versa)
 */
export async function getBindingState(
  expectedStudentRoll?: string,
  options?: BindingStateOptions
): Promise<BindingState> {
  // 1. Capability check
  if (!isSubtleCryptoSupported()) {
    return 'unsupported';
  }

  // 2. Storage consistency check
  try {
    const consistency = await evaluateStorageConsistency();
    switch (consistency.status) {
      case 'intact':
        // Account isolation: check if stored key belongs to this student
        if (expectedStudentRoll) {
          const expectedHash = await sha256Hex(expectedStudentRoll.trim().toUpperCase());
          if (consistency.record?.metadata?.student_id_hash) {
            if (consistency.record.metadata.student_id_hash !== expectedHash) {
              return 'not_enrolled';
            }
          } else if (consistency.record) {
            // Retroactively associate existing key with the current student profile
            if (!consistency.record.metadata) {
              (consistency.record as any).metadata = {};
            }
            consistency.record.metadata.student_id_hash = expectedHash;
            try {
              await saveBindingRecord(consistency.record);
            } catch {
              // Best-effort persistence
            }
          }
        }

        // Server-authoritative check via passed serverBoundKeyId (e.g. from profile)
        if (options?.serverBoundKeyId !== undefined) {
          if (options.serverBoundKeyId === null) {
            // Server explicitly has no active device binding for this student
            return 'not_enrolled';
          }
          const localKeyId = consistency.record?.metadata?.key_id;
          if (localKeyId && localKeyId !== options.serverBoundKeyId) {
            // Device key mismatch: student is logged in from a second, unlinked device
            return 'not_enrolled';
          }
        }

        // Active server roundtrip verification if requested
        if (options?.verifyWithServer) {
          const localKeyId = consistency.record?.metadata?.key_id;
          const serverStatus = await checkServerBindingStatus(localKeyId);
          if (serverStatus && (!serverStatus.enrolled || serverStatus.status === 'MISMATCH')) {
            return 'not_enrolled';
          }
        }

        return 'enrolled';
      case 'clean':
        return 'not_enrolled';
      case 'divergent_no_handle':
      case 'divergent_no_cookie':
        return 'incomplete';
      default:
        return 'not_enrolled';
    }
  } catch {
    return 'incomplete';
  }
}

/**
 * Clears both IndexedDB key handle and paired corroboration cookie.
 * Used during deliberate device revocation, logout with wipe, or unit testing.
 */
export async function unbindDevice(): Promise<void> {
  await deleteBindingRecord();
  clearBindingNonceCookie();
}
