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

interface RedirectRecord {
  timestamps: number[];
}

/**
 * Reads the current list of redirect timestamps from sessionStorage.
 */
function getRedirectTimestamps(): number[] {
  if (typeof sessionStorage === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem(REDIRECT_TRACKER_KEY);
    if (!raw) return [];
    const parsed: RedirectRecord = JSON.parse(raw);
    const now = Date.now();
    // Prune timestamps older than WINDOW_MS (5 seconds)
    return (parsed.timestamps || []).filter(ts => (now - ts) < WINDOW_MS);
  } catch {
    return [];
  }
}

/**
 * Records an auth redirect attempt.
 * Returns `true` if the redirect is safe to proceed.
 * Returns `false` if the loop breaker has tripped (2+ redirects within 5s).
 */
export function recordAuthRedirect(): boolean {
  if (typeof sessionStorage === 'undefined') return true;

  const now = Date.now();
  const recent = getRedirectTimestamps();
  recent.push(now);

  try {
    sessionStorage.setItem(REDIRECT_TRACKER_KEY, JSON.stringify({ timestamps: recent }));
  } catch {}

  // If 2 or more redirects happened within the 5-second window, trip the circuit breaker!
  if (recent.length >= MAX_ALLOWED_REDIRECTS) {
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
}

/**
 * Emergency wipe: purges all stored auth state from localStorage,
 * and calls the backend logout endpoint to clear httpOnly cookies.
 */
export function emergencyWipeAuthState(): void {
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
