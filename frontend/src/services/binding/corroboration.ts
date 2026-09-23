/**
 * SNIST ERP — Low-Entropy Corroboration Signal
 * 
 * ARCHITECTURAL RULE:
 * This corroboration signal is STRICTLY TELEMETRY ONLY. It is NEVER used as an
 * authentication factor, identity source, or access grant mechanism. Its sole purpose
 * is to detect extreme environment anomalies (e.g. key signed from a completely different
 * OS or architecture) for offline forensic auditing.
 */

export interface CorroborationDetails {
  platform_bucket: string;
  screen_bucket: string;
  tz_offset: number;
  cores_bucket: string;
}

/**
 * Derives a coarse-grained, low-entropy corroboration signal.
 */
export function getCorroborationDetails(): CorroborationDetails {
  if (typeof window === 'undefined') {
    return {
      platform_bucket: 'node_env',
      screen_bucket: '0x0',
      tz_offset: 0,
      cores_bucket: 'unknown'
    };
  }

  const nav = window.navigator as any;
  const screen = window.screen;

  // 1. Platform bucket (coarse: android | ios | windows | mac | linux | other)
  const ua = (nav.userAgent || '').toLowerCase();
  let platformBucket = 'other';
  if (/android/.test(ua)) platformBucket = 'android';
  else if (/iphone|ipad|ipod/.test(ua)) platformBucket = 'ios';
  else if (/windows/.test(ua)) platformBucket = 'windows';
  else if (/macintosh|mac os x/.test(ua)) platformBucket = 'macos';
  else if (/linux/.test(ua)) platformBucket = 'linux';

  // 2. Screen bucket (orientation-independent, binned to 50px steps)
  const w = screen ? Math.min(screen.width || 0, screen.height || 0) : 0;
  const h = screen ? Math.max(screen.width || 0, screen.height || 0) : 0;
  const binnedW = Math.round(w / 50) * 50;
  const binnedH = Math.round(h / 50) * 50;
  const screenBucket = `${binnedW}x${binnedH}`;

  // 3. Timezone offset in minutes
  const tzOffset = new Date().getTimezoneOffset();

  // 4. CPU cores bucket (binned: <=2 | 4 | 8 | >8)
  const cores = nav.hardwareConcurrency || 4;
  let coresBucket = '4';
  if (cores <= 2) coresBucket = '<=2';
  else if (cores === 4) coresBucket = '4';
  else if (cores === 8) coresBucket = '8';
  else if (cores > 8) coresBucket = '>8';

  return {
    platform_bucket: platformBucket,
    screen_bucket: screenBucket,
    tz_offset: tzOffset,
    cores_bucket: coresBucket
  };
}

/**
 * Computes deterministic 16-hex-char corroboration tag.
 */
export async function getCorroborationTag(): Promise<string> {
  const details = getCorroborationDetails();
  const rawString = `${details.platform_bucket}#${details.screen_bucket}#${details.tz_offset}#${details.cores_bucket}`;

  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const enc = new TextEncoder();
      const hashBuf = await crypto.subtle.digest('SHA-256', enc.encode(rawString));
      const hashArr = Array.from(new Uint8Array(hashBuf));
      return hashArr.slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    } catch {
      // Fallback
    }
  }

  // Fast fallback hash
  let h = 0x811c9dc5;
  for (let i = 0; i < rawString.length; i++) {
    h = Math.imul(h ^ rawString.charCodeAt(i), 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0').toUpperCase();
}
