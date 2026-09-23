/**
 * QUARANTINED — Binding Phase 5 Legacy Soft-Binding Deletion
 * 
 * The client-asserted hardware fingerprint and legacy device credentials
 * (snist_device_public_id, snist_device_secret) have been retired in Phase 5.
 * All device identity and possession proof are now governed exclusively by
 * Device Binding V2 (non-extractable WebCrypto ECDSA P-256 via services/binding).
 * 
 * Hardware fingerprinting routines (WebGL, Canvas, AudioContext) have been removed
 * to reclaim bundle budget and eliminate decorative client assertions.
 */

export interface DeviceCredentials {
  device_public_id: string;
  device_secret: string;
}

const DEVICE_ID_KEY = 'snist_device_public_id';
const DEVICE_SECRET_KEY = 'snist_device_secret';

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : null;
}

/**
 * Returns stable, persistent client device credentials stored in localStorage.
 * Prevents mobile IP / cellular tower switching from mutating the device ID.
 */
export function getOrCreateDeviceCredentials(): DeviceCredentials {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return {
      device_public_id: 'DEV-FALLBACK',
      device_secret: 'LEGACY-SECRET'
    };
  }

  let pubId = localStorage.getItem(DEVICE_ID_KEY);
  let sec = localStorage.getItem(DEVICE_SECRET_KEY);

  if (!pubId || !sec || pubId === 'DEV-RETIRED-PHASE5' || sec === 'LEGACY-RETIRED') {
    const randPart = Math.random().toString(36).substring(2, 10).toUpperCase();
    const timePart = Date.now().toString(36).toUpperCase();
    pubId = `DEV-APP-${randPart}-${timePart}`;
    sec = `SEC-${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`;
    try {
      localStorage.setItem(DEVICE_ID_KEY, pubId);
      localStorage.setItem(DEVICE_SECRET_KEY, sec);
    } catch {}
  }

  return {
    device_public_id: pubId,
    device_secret: sec
  };
}

/**
 * Returns HTTP headers for device identity.
 */
export function getDeviceHeaders(): Record<string, string> {
  try {
    const creds = getOrCreateDeviceCredentials();
    return {
      'x-device-public-id': creds.device_public_id,
      'x-device-secret': creds.device_secret
    };
  } catch {
    return {};
  }
}

/**
 * Migration Hygiene: No-op for active device keys to preserve browser binding stability.
 */
export function cleanupLegacyDeviceStorage(): { cleaned: boolean } {
  return { cleaned: false };
}
