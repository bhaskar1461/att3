/**
 * SNIST ERP — Binding V2 Cryptographic Engine
 * 
 * Implements non-extractable WebCrypto ECDSA P-256 keypair operations.
 * Enforces Zero-PII metadata, hardware-locked signature generation, and DevTools
 * key extraction prevention.
 */

import {
  BindingMetadata,
  StoredBindingRecord,
  CanonicalChallengePayload,
  BindingChallengePayload,
  BindingSignatureResult,
  DeviceEnrollmentRequestPayload,
  UnsupportedBrowserError,
  NoKeyStoredError,
  KeyInvalidError,
  KeyExtractionForbiddenError,
  StorageDivergenceError
} from './types';
import {
  saveBindingRecord,
  readBindingRecord,
  setBindingNonceCookie,
  requestStoragePersistence,
  evaluateStorageConsistency
} from './storage';
import { getCorroborationTag } from './corroboration';

const ECDSA_ALGORITHM = {
  name: 'ECDSA',
  namedCurve: 'P-256'
};

const SIGN_ALGORITHM = {
  name: 'ECDSA',
  hash: { name: 'SHA-256' }
};

/**
 * Checks if the WebCrypto API and ECDSA P-256 algorithm are supported.
 */
export function isSubtleCryptoSupported(): boolean {
  if (typeof window === 'undefined' && typeof globalThis !== 'undefined') {
    return !!(globalThis.crypto && globalThis.crypto.subtle);
  }
  return !!(typeof window !== 'undefined' && window.crypto && window.crypto.subtle);
}

function getSubtle(): SubtleCrypto {
  if (!isSubtleCryptoSupported()) {
    throw new UnsupportedBrowserError('crypto.subtle is not supported or accessible.');
  }
  return (typeof window !== 'undefined' ? window.crypto : globalThis.crypto).subtle;
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  if (typeof btoa !== 'undefined') {
    return btoa(binary);
  }
  return Buffer.from(binary, 'binary').toString('base64');
}

function generateSecureNonce(length: number = 32): string {
  const bytes = new Uint8Array(length);
  const cryptoObj = typeof window !== 'undefined' ? window.crypto : globalThis.crypto;
  cryptoObj.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(text: string): Promise<string> {
  const subtle = getSubtle();
  const enc = new TextEncoder();
  const digest = await subtle.digest('SHA-256', enc.encode(text));
  const bytes = new Uint8Array(digest);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generates an immutable, non-extractable ECDSA P-256 keypair, stores it in IndexedDB,
 * sets the paired corroboration cookie, and returns the public enrollment payload.
 */
export async function generateKeyPair(studentRollOrId: string = '', autoCommit: boolean = false): Promise<DeviceEnrollmentRequestPayload> {
  const t0 = performance.now();
  const subtle = getSubtle();

  // 1. Generate non-extractable keypair
  // Non-extractable flag (false) is mandatory: prevents key extraction via DevTools or malware
  let keyPair: CryptoKeyPair;
  try {
    keyPair = await subtle.generateKey(
      ECDSA_ALGORITHM,
      false, // non-extractable private key
      ['sign', 'verify']
    );
  } catch (err: any) {
    throw new UnsupportedBrowserError(`Failed to generate ECDSA P-256 keypair: ${err.message || err}`);
  }

  // 2. Export public key in standard SubjectPublicKeyInfo (SPKI) format
  const spkiBuffer = await subtle.exportKey('spki', keyPair.publicKey);
  const publicSpkiB64 = bufferToBase64(spkiBuffer);

  // 3. Derive key_id from public key hash
  const keyIdDigest = await subtle.digest('SHA-256', spkiBuffer);
  const keyId = Array.from(new Uint8Array(keyIdDigest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .substring(0, 32)
    .toUpperCase();

  // 4. Secure Nonce, Corroboration Tag & Device ID
  const nonce = generateSecureNonce(32);
  const corroborationTag = await getCorroborationTag();
  const studentIdHash = studentRollOrId ? await sha256Hex(studentRollOrId.trim().toUpperCase()) : '';
  const deviceId = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : `${generateSecureNonce(8)}-${generateSecureNonce(4)}-4${generateSecureNonce(3)}-a${generateSecureNonce(3)}-${generateSecureNonce(12)}`;

  // 5. Solicit storage persistence
  const persisted = await requestStoragePersistence();

  // 6. Build metadata & record
  const metadata: BindingMetadata = {
    enrolled_at: new Date().toISOString(),
    student_id_hash: studentIdHash,
    device_id: deviceId,
    client_type: 'WEB',
    browser_profile_tag: corroborationTag,
    public_key_spki_b64: publicSpkiB64,
    key_id: keyId,
    storage_persisted: persisted,
    created_at_epoch_ms: Date.now()
  };

  const storedRecord: StoredBindingRecord = {
    id: 'primary',
    private_key: keyPair.privateKey,
    public_key: keyPair.publicKey,
    metadata,
    binding_nonce: nonce
  };

  // 7. Save to IndexedDB and set paired cookie only if autoCommit requested
  if (autoCommit) {
    await saveBindingRecord(storedRecord);
    setBindingNonceCookie(nonce, 365);
  }

  const keygenMs = performance.now() - t0;

  return {
    public_key_spki_b64: publicSpkiB64,
    device_id: deviceId,
    key_id: keyId,
    key_algorithm: 'ECDSA_P256',
    key_version: 1,
    client_type: 'WEB',
    student_id_hash: studentIdHash,
    corroboration_tag: corroborationTag,
    binding_nonce: nonce,
    storage_persisted: persisted,
    keygen_duration_ms: Math.round(keygenMs * 100) / 100,
    stored_record: storedRecord
  };
}

/**
 * Commits a generated binding record to persistent storage (IndexedDB & Cookie).
 * Must ONLY be called once the server confirms successful enrollment (HTTP 200).
 */
export async function commitBindingRecord(record: StoredBindingRecord): Promise<void> {
  await saveBindingRecord(record);
  if (record.binding_nonce) {
    setBindingNonceCookie(record.binding_nonce, 365);
  }
}

/**
 * Signs an authentication or attendance challenge using the local non-extractable private key.
 */
export async function signChallenge(
  challenge: CanonicalChallengePayload | BindingChallengePayload | string | Uint8Array,
  expectedStudentRoll?: string
): Promise<BindingSignatureResult> {
  const t0 = performance.now();
  const subtle = getSubtle();

  // 1. Storage consistency check
  const consistency = await evaluateStorageConsistency();
  if (consistency.status === 'clean') {
    throw new NoKeyStoredError('Cannot sign challenge: No device binding key is enrolled.');
  }
  if (consistency.status === 'divergent_no_handle' || consistency.status === 'divergent_no_cookie') {
    throw new StorageDivergenceError(
      consistency.status !== 'divergent_no_handle',
      consistency.status !== 'divergent_no_cookie'
    );
  }

  const record = consistency.record;
  if (!record || !record.private_key) {
    throw new NoKeyStoredError('No valid private key handle found in storage record.');
  }

  // Account switching isolation: verify key ownership if student identifier is known
  const checkRoll = expectedStudentRoll || 
    (typeof challenge === 'object' && !(challenge instanceof Uint8Array) && 'student_roll' in challenge ? (challenge as any).student_roll : undefined);
  if (checkRoll && record.metadata?.student_id_hash) {
    const expectedHash = await sha256Hex(checkRoll.trim().toUpperCase());
    if (record.metadata.student_id_hash !== expectedHash) {
      throw new KeyInvalidError('Stored security key belongs to a different student account.');
    }
  }

  // 2. Format challenge buffer
  let dataToSign: Uint8Array;
  let nonceVal = '';

  if (typeof challenge === 'string') {
    dataToSign = new TextEncoder().encode(challenge);
    nonceVal = 'raw_string';
  } else if (challenge instanceof Uint8Array) {
    dataToSign = challenge;
    nonceVal = 'raw_bytes';
  } else if ('challenge_id' in challenge) {
    // Canonical challenge format: attendance_device_proof_v1|{challenge_id}|{device_id}|{operation}|{timestamp}|{nonce}
    const c = challenge as CanonicalChallengePayload;
    nonceVal = c.nonce || '';
    const devId = c.device_id || record.metadata?.device_id || '';
    const canonicalMsg = c.canonical_message || 
      `attendance_device_proof_v1|${c.challenge_id}|${devId}|${c.operation || 'ATTENDANCE_VERIFICATION'}|${c.timestamp}|${c.nonce}`;
    dataToSign = new TextEncoder().encode(canonicalMsg);
  } else {
    // Canonical JSON serialization fallback
    const b = challenge as BindingChallengePayload;
    nonceVal = b.nonce || '';
    const canonicalPayload = JSON.stringify({
      session_token: b.session_token,
      timestamp: b.timestamp,
      nonce: b.nonce,
      student_roll: b.student_roll || ''
    });
    dataToSign = new TextEncoder().encode(canonicalPayload);
  }

  // 3. Execute signature operation
  let signatureBuffer: ArrayBuffer;
  try {
    signatureBuffer = await subtle.sign(
      SIGN_ALGORITHM,
      record.private_key,
      dataToSign as BufferSource
    );
  } catch (signErr: any) {
    throw new KeyInvalidError(`SubtleCrypto sign failed: ${signErr.message || signErr}`);
  }

  const signatureB64 = bufferToBase64(signatureBuffer);
  const signDurationMs = performance.now() - t0;
  const corroborationTag = await getCorroborationTag();

  return {
    signature_b64: signatureB64,
    device_id: record.metadata?.device_id,
    key_id: record.metadata?.key_id || '',
    nonce: nonceVal,
    corroboration_tag: corroborationTag,
    sign_duration_ms: Math.round(signDurationMs * 100) / 100,
    algorithm: 'ECDSA_P256_SHA256'
  };
}

/**
 * Adversarial validation tool: confirms that attempting to export the private key
 * throws an InvalidAccessError, proving the key cannot be transplanted.
 */
export async function verifyNonExtractable(privateKey: CryptoKey): Promise<boolean> {
  const subtle = getSubtle();
  try {
    await subtle.exportKey('pkcs8', privateKey);
    // If export succeeded, non-extractable failed!
    return false;
  } catch {
    // Expected behavior: export must fail
    return true;
  }
}
