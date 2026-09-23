/**
 * SNIST ERP — Client Keypair Infrastructure (Binding V2)
 * Phase 2 Typed Interfaces, Domain Models, and Error Taxonomy
 *
 * PRIME DIRECTIVE:
 * The binding KEY is a non-extractable crypto.subtle keypair; every
 * fingerprint/UA/heuristic signal is corroboration ONLY, never identity.
 * The client module must be small, lazy-loaded, and fail-closed-but-explicit.
 */

export type BindingState = 
  | 'enrolled'       // Keypair present in IndexedDB + paired nonce cookie matches + metadata intact
  | 'not_enrolled'   // Clean state: no key in IndexedDB and no nonce cookie
  | 'incomplete'     // Divergent state: handle missing but cookie present (or vice-versa) -> Phase 6 recovery required
  | 'unsupported';   // SubtleCrypto or P-256 unsupported on this client engine

export interface BindingMetadata {
  /** ISO timestamp when enrollment ceremony executed */
  enrolled_at: string;
  /** Cryptographic SHA-256 hash of student SAP/Roll Number (ZERO plaintext PII stored) */
  student_id_hash: string;
  /** Client-generated random UUID v4 identifier */
  device_id: string;
  /** Client application type (WEB, PWA, ANDROID) */
  client_type?: string;
  /** Low-entropy telemetry corroboration tag (UA family + screen dims) */
  browser_profile_tag: string;
  /** Base64 SPKI formatted public key (shareable with server) */
  public_key_spki_b64: string;
  /** Unique SHA-256 key identifier derived from public key bytes */
  key_id: string;
  /** Whether navigator.storage.persist() was granted by the browser */
  storage_persisted: boolean;
  /** Local epoch timestamp of key generation */
  created_at_epoch_ms: number;
}

export interface StoredBindingRecord {
  id: string; // Static primary key 'primary_device_key'
  private_key: CryptoKey;
  public_key: CryptoKey;
  metadata: BindingMetadata;
  binding_nonce: string;
}

export interface CanonicalChallengePayload {
  challenge_id: string;
  device_id: string;
  operation: string;
  timestamp: number;
  nonce: string;
  canonical_message?: string;
}

export interface BindingChallengePayload {
  session_token: string;
  timestamp: number;
  nonce: string;
  student_roll?: string;
}

export interface BindingSignatureResult {
  /** Base64 encoded raw IEEE P1363 ECDSA signature (64 bytes) */
  signature_b64: string;
  /** Client device identifier */
  device_id?: string;
  /** SHA-256 key identifier matching enrolled public key */
  key_id: string;
  /** Nonce echoed back to prevent replay */
  nonce: string;
  /** Low-entropy environment corroboration signal (telemetry only) */
  corroboration_tag: string;
  /** Client signing time in milliseconds */
  sign_duration_ms: number;
  /** Signature algorithm identifier */
  algorithm: string;
}

export interface DeviceEnrollmentRequestPayload {
  public_key_spki_b64: string;
  device_id: string;
  key_id: string;
  key_algorithm?: string;
  key_version?: number;
  client_type?: string;
  student_id_hash: string;
  corroboration_tag: string;
  binding_nonce: string;
  storage_persisted: boolean;
  keygen_duration_ms: number;
  stored_record?: StoredBindingRecord;
}

// ============================================================================
// TYPED ERROR TAXONOMY
// ============================================================================

export abstract class BindingError extends Error {
  abstract readonly code: string;
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class DeviceIdentityNotFoundError extends BindingError {
  readonly code = 'DEVICE_IDENTITY_NOT_FOUND';
  constructor(message: string = 'No cryptographic device identity keypair found in local secure storage.') {
    super(message);
  }
}

export class UnsupportedBrowserError extends BindingError {
  readonly code = 'UNSUPPORTED_BROWSER';
  constructor(reason: string = 'WebCrypto API or ECDSA P-256 is unavailable in this environment.') {
    super(`Unsupported browser: ${reason}`);
  }
}

export class NoKeyStoredError extends BindingError {
  readonly code = 'NO_KEY_STORED';
  constructor(message: string = 'No device binding keypair found in local storage.') {
    super(message);
  }
}

export class KeyInvalidError extends BindingError {
  readonly code = 'KEY_INVALID';
  constructor(reason: string) {
    super(`Stored binding key is corrupt or unusable: ${reason}`);
  }
}

export class StorageDivergenceError extends BindingError {
  readonly code = 'STORAGE_DIVERGENCE';
  readonly hasIndexedDB: boolean;
  readonly hasCookie: boolean;
  constructor(hasIndexedDB: boolean, hasCookie: boolean) {
    super(
      `Binding storage divergence detected: IndexedDB=${hasIndexedDB}, Cookie=${hasCookie}. ` +
      `Possible storage pressure eviction or browser data wipe.`
    );
    this.hasIndexedDB = hasIndexedDB;
    this.hasCookie = hasCookie;
  }
}

export class KeyExtractionForbiddenError extends BindingError {
  readonly code = 'KEY_EXTRACTION_FORBIDDEN';
  constructor() {
    super('Security violation: Attempted to export private key marked non-extractable.');
  }
}
