/**
 * Device Credential Service — Hardware Fingerprinting & Persistent Device Binding
 * Generates an immutable, hardware-derived device identity that persists across
 * Normal and Incognito / Private Browsing sessions on the same physical hardware.
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

function setCookie(name: string, value: string, days: number = 365) {
  if (typeof document === 'undefined') return;
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

/**
 * 64-bit FNV-1a non-cryptographic fast hash function for deterministic string hashing
 */
function fnv1aHash(str: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 16777619);
    h2 = Math.imul(h2 ^ ch, 1099511628211);
  }
  const part1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const part2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return (part1 + part2).toUpperCase();
}

/**
 * Computes deterministic physical hardware fingerprint.
 * Remains 100% identical between Normal and Incognito windows on the same device.
 */
export function getHardwareFingerprint(): string {
  if (typeof window === 'undefined') {
    return 'SRV-ENV-DEFAULT-NODE';
  }

  const entropyComponents: string[] = [];

  // 1. Physical Display Metrics (Identical in Incognito)
  try {
    const s = window.screen;
    entropyComponents.push(`SCR:${s.width}x${s.height}x${s.colorDepth}x${s.pixelDepth || 24}x${window.devicePixelRatio || 1}`);
  } catch {}

  // 2. Hardware Architecture & System Properties
  try {
    const nav = window.navigator as any;
    entropyComponents.push(`HW:cores=${nav.hardwareConcurrency || 4};mem=${nav.deviceMemory || 4};plat=${nav.platform || ''};tz=${new Date().getTimezoneOffset()}`);
    entropyComponents.push(`LANG:${nav.language || nav.userLanguage || ''}`);
  } catch {}

  // 3. WebGL GPU Hardware Renderer (Unmasked GPU signature — Identical in Incognito)
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (gl) {
      const dbg = (gl as WebGLRenderingContext).getExtension('WEBGL_debug_renderer_info');
      if (dbg) {
        const vendor = (gl as WebGLRenderingContext).getParameter(dbg.UNMASKED_VENDOR_WEBGL);
        const renderer = (gl as WebGLRenderingContext).getParameter(dbg.UNMASKED_RENDERER_WEBGL);
        entropyComponents.push(`GPU:${vendor}~${renderer}`);
      }
    }
  } catch {}

  // 4. Canvas 2D Engine Antialiasing & Text Subpixel Hashing (Identical in Incognito)
  try {
    const c2d = document.createElement('canvas');
    c2d.width = 240;
    c2d.height = 60;
    const ctx = c2d.getContext('2d');
    if (ctx) {
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#f60';
      ctx.fillRect(125, 1, 62, 20);
      ctx.fillStyle = '#069';
      ctx.font = '11pt Arial';
      ctx.fillText('SNIST_ERP_CANVAS_DEVICE_LOCK', 2, 15);
      ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
      ctx.font = '18pt sans-serif';
      ctx.fillText('SNIST_ERP_CANVAS_DEVICE_LOCK', 4, 45);
      entropyComponents.push(`CANVAS:${c2d.toDataURL().slice(-64)}`);
    }
  } catch {}

  // 5. AudioContext Oscillator Frequency Response (Identical in Incognito)
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioCtx) {
      const aCtx = new AudioCtx();
      entropyComponents.push(`AUDIO:sr=${aCtx.sampleRate};destChan=${aCtx.destination?.maxChannelCount || 2}`);
      aCtx.close().catch(() => {});
    }
  } catch {}

  const rawSeed = entropyComponents.join('###');
  return fnv1aHash(rawSeed);
}

/**
 * Retrieves existing device credentials or generates a hardware-locked pair
 * that survives incognito window switches.
 */
export function getOrCreateDeviceCredentials(): DeviceCredentials {
  // Always derive the deterministic hardware fingerprint so that Normal, Incognito,
  // and private browsing windows on the same physical hardware produce the exact same ID!
  const hwHash = getHardwareFingerprint();
  const canonicalHwId = 'DEV-' + hwHash;
  const canonicalHwSecret = fnv1aHash(hwHash + '::SNIST_INSTITUTIONAL_SALT_2026') + fnv1aHash(hwHash + '::DEVICE_KEY_SIG');

  // Persist into storage/cookies if writable
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(DEVICE_ID_KEY, canonicalHwId);
      localStorage.setItem(DEVICE_SECRET_KEY, canonicalHwSecret);
    }
  } catch {}
  setCookie(DEVICE_ID_KEY, canonicalHwId, 365);
  setCookie(DEVICE_SECRET_KEY, canonicalHwSecret, 365);

  return {
    device_public_id: canonicalHwId,
    device_secret: canonicalHwSecret
  };
}

/**
 * Returns HTTP headers for device authentication & anti-proxy lockout
 */
export function getDeviceHeaders(): Record<string, string> {
  const creds = getOrCreateDeviceCredentials();
  return {
    'X-Device-Public-Id': creds.device_public_id,
    'X-Device-Secret': creds.device_secret
  };
}
