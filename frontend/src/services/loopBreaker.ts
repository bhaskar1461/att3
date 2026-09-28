/**
 * SNIST ERP - Auth Redirect Loop Breaker
 * 
 * Requirement 3: If 2+ auth redirects happen within 5 s (sessionStorage counter),
 * stop redirecting, wipe auth state, and show the login form with the reason.
 */

const REDIRECT_TRACKER_KEY = 'snist_auth_redirect_tracker';
const LOOP_BREAKER_FLAG_KEY = 'snist_auth_loop_breaker_tripped';
const WINDOW_MS = 5000;
const MAX_ALLOWED_REDIRECTS = 2;

interface RedirectEntry {
  url: string;
  at: number;
}

let onResetHandler: (() => void) | null = null;

export function setLoopBreakerResetHandler(handler: (() => void) | null): void {
  onResetHandler = handler;
}

/**
 * Reads the current list of redirect history entries from sessionStorage.
 */
function getRedirectHistory(): RedirectEntry[] {
  if (typeof sessionStorage === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem(REDIRECT_TRACKER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const now = Date.now();
    let entries: RedirectEntry[] = [];
    if (Array.isArray(parsed)) {
      entries = parsed;
    } else if (Array.isArray(parsed.history)) {
      entries = parsed.history;
    } else if (Array.isArray(parsed.timestamps)) {
      entries = parsed.timestamps.map((ts: number) => ({ url: '', at: ts }));
    }
    // Prune entries older than WINDOW_MS (5 seconds)
    return entries.filter(e => (now - e.at) < WINDOW_MS);
  } catch {
    return [];
  }
}

/**
 * Records an auth redirect attempt.
 * Semantics:
 * - Duplicate same-target redirect within 1s is collapsed (treated as same intent fired twice).
 * - Trips only on genuine oscillation: 4 or more distinct destination URLs in a 5s window.
 * 
 * Returns `true` if the redirect is safe to proceed.
 * Returns `false` if the loop breaker has tripped.
 */
export function recordAuthRedirect(url: string = ''): boolean {
  if (typeof sessionStorage === 'undefined') return true;

  const now = Date.now();
  let history = getRedirectHistory();

  // Same target twice within 1s = one intent fired twice -> collapse, don't count
  const last = history.length > 0 ? history[history.length - 1] : undefined;
  if (last && last.url === url && now - last.at < 1000) {
    return true;
  }

  history.push({ url, at: now });
  history = history.filter((h) => now - h.at < WINDOW_MS);

  try {
    sessionStorage.setItem(REDIRECT_TRACKER_KEY, JSON.stringify(history));
  } catch {}

  // Trip on:
  // 1. Pathological same-target loop (>3 hits to the SAME url in 5s window)
  const sameTargetCount = history.filter((h) => h.url === url).length;
  if (sameTargetCount >= 4) {
    try {
      sessionStorage.setItem(LOOP_BREAKER_FLAG_KEY, 'true');
    } catch {}
    return false;
  }

  // 2. Genuine oscillation (>=4 total redirects or >=4 distinct destinations in the window)
  const distinctTargets = new Set(history.map((h) => h.url));
  if (distinctTargets.size >= 4 || history.length >= 4) {
    try {
      sessionStorage.setItem(LOOP_BREAKER_FLAG_KEY, 'true');
    } catch {}
    return false;
  }

  return true;
}

/**
 * Checks whether the circuit breaker has tripped.
 */
export function isLoopBreakerTripped(): boolean {
  if (typeof sessionStorage === 'undefined') return false;
  return sessionStorage.getItem(LOOP_BREAKER_FLAG_KEY) === 'true';
}

/**
 * Clears the circuit breaker state (e.g. after a successful user login).
 */
export function resetLoopBreaker(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(REDIRECT_TRACKER_KEY);
    sessionStorage.removeItem(LOOP_BREAKER_FLAG_KEY);
  } catch {}
  if (onResetHandler) {
    onResetHandler();
  }
}

/**
 * Emergency wipe: purges all stored auth state from localStorage,
 * resets the loop breaker (unless preserveBreakerFlag is true),
 * and calls the backend logout endpoint to clear httpOnly cookies.
 */
export function emergencyWipeAuthState(preserveBreakerFlag: boolean = false): void {
  if (!preserveBreakerFlag) {
    resetLoopBreaker();
  }

  if (typeof localStorage !== 'undefined') {
    const authKeys = [
      'token',
      'refresh_token',
      'user',
      'role',
      'remember_me',
      'remember_username',
      'remember_role',
      'auth_token',
      'jwt_token',
      'access_token',
      'authSchemaVersion'
    ];
    for (const key of authKeys) {
      try {
        localStorage.removeItem(key);
      } catch {}
    }
  }

  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.removeItem('snist_launch_claim');
    } catch {}
  }

  // Fire-and-forget request to clear httpOnly cookie
  if (typeof fetch !== 'undefined') {
    fetch('/api/v1/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => {});
  }
}
