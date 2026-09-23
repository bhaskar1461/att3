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
  signChallenge,
  verifyNonExtractable,
  sha256Hex
} from './cryptoEngine';
import {
  readBindingRecord,
  deleteBindingRecord,
  clearBindingNonceCookie,
  evaluateStorageConsistency
} from './storage';
import { getCorroborationTag, getCorroborationDetails } from './corroboration';

// Re-export all types and error classes
export * from './types';
export {
  isSubtleCryptoSupported,
  generateKeyPair,
  signChallenge,
  verifyNonExtractable,
  sha256Hex,
  readBindingRecord,
  deleteBindingRecord,
  getCorroborationTag,
  getCorroborationDetails
};

/**
 * Feature Flag: BINDING_V2
 * In Phase 5 Cutover, default is TRUE on dev (enabled by default unless explicitly 'false').
 */
export const BINDING_V2_ENABLED: boolean = 
  typeof import.meta !== 'undefined' && (import.meta as any).env ? (import.meta as any).env.VITE_BINDING_V2 !== 'false' : true;

/**
 * Evaluates the authoritative binding state of the current browser client.
 * If expectedStudentRoll is provided, verifies that stored key belongs to that student.
 * Returns one of:
 * - 'unsupported': Browser engine lacks WebCrypto or ECDSA P-256 support
 * - 'not_enrolled': Clean browser; no keypair has been generated
 * - 'enrolled': Valid non-extractable keypair stored and paired nonce verified
 * - 'incomplete': Divergent storage (cookie present without handle or vice versa)
 */
export async function getBindingState(expectedStudentRoll?: string): Promise<BindingState> {
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
        if (expectedStudentRoll && consistency.record?.metadata?.student_id_hash) {
          const expectedHash = await sha256Hex(expectedStudentRoll.trim().toUpperCase());
          if (consistency.record.metadata.student_id_hash !== expectedHash) {
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
