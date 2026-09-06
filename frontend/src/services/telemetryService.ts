/**
 * Lightweight client telemetry service for PWA installation and rollout tracking.
 * Fire-and-forget: never throws or disrupts student UX.
 */

export function detectPlatform(): { platform: 'ios' | 'android' | 'desktop' | 'unknown'; browser: string; isStandalone: boolean } {
  if (typeof window === 'undefined') {
    return { platform: 'unknown', browser: 'unknown', isStandalone: false };
  }

  const ua = navigator.userAgent.toLowerCase();
  
  // Standalone detection
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true ||
    document.referrer.includes('android-app://');

  // Platform detection (handling iPadOS 13+ desktop Mac spoofing via maxTouchPoints)
  let platform: 'ios' | 'android' | 'desktop' | 'unknown' = 'unknown';
  if (/iphone|ipod/.test(ua) || /ipad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
    platform = 'ios';
  } else if (/android/.test(ua)) {
    platform = 'android';
  } else if (/macintosh|windows|linux/.test(ua)) {
    platform = 'desktop';
  }

  // Browser detection
  let browser = 'other';
  if (
    /brave/.test(ua) ||
    (navigator as any).brave !== undefined ||
    (typeof window !== 'undefined' && ((window as any).ethereum?.isBraveWallet || (window as any).brave !== undefined))
  ) {
    browser = 'brave';
  } else if (/crios/.test(ua)) {
    browser = 'chrome'; // Chrome on iOS
  } else if (/fxios/.test(ua)) {
    browser = 'firefox'; // Firefox on iOS
  } else if (/edgios/.test(ua) || /edg\//.test(ua)) {
    browser = 'edge';
  } else if (/chrome|chromium/.test(ua)) {
    browser = 'chrome';
  } else if (/safari/.test(ua) && !/chrome|chromium/.test(ua)) {
    browser = 'safari';
  } else if (/firefox/.test(ua)) {
    browser = 'firefox';
  }

  return { platform, browser, isStandalone };
}

export async function sendPwaTelemetry(eventType: string, details?: Record<string, any>): Promise<void> {
  try {
    const { platform, browser, isStandalone } = detectPlatform();
    
    // Non-blocking fetch
    fetch('/api/v1/telemetry/pwa-install', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event_type: eventType,
        platform,
        browser,
        is_standalone: isStandalone,
        details: details || {}
      }),
      keepalive: true
    }).catch(() => {});
  } catch {
    // Ignore all telemetry errors
  }
}

// Global initialization helper to capture browser install lifecycle events
let isInitialized = false;
export function initPwaTelemetryListeners(): void {
  if (isInitialized || typeof window === 'undefined') return;
  isInitialized = true;

  const { isStandalone } = detectPlatform();

  // 1. Initial page load
  if (isStandalone) {
    sendPwaTelemetry('PWA_STANDALONE_LAUNCH');
  } else {
    sendPwaTelemetry('PWA_PAGE_LOAD');
  }

  // 2. Before install prompt shown
  window.addEventListener('beforeinstallprompt', () => {
    sendPwaTelemetry('PWA_PROMPT_SHOWN');
  });

  // 3. User accepted install
  window.addEventListener('appinstalled', () => {
    sendPwaTelemetry('PWA_INSTALLED');
  });
}
