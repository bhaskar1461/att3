import { getDeviceHeaders } from './deviceCredential';

const API_BASE = '/api/v1';
let refreshTimer: any = null;
let lastRefreshTime = Date.now();
let activeRefreshPromise: Promise<string | null> | null = null;

/**
 * Performs a silent token refresh using httpOnly cookie or fallback refresh_token.
 * Deduplicates concurrent refresh requests using a singleton Promise.
 */
export async function performTokenRefresh(): Promise<string | null> {
  if (activeRefreshPromise) {
    return activeRefreshPromise;
  }

  activeRefreshPromise = (async () => {
    try {
      const storedRefreshToken = typeof localStorage !== 'undefined' ? localStorage.getItem('refresh_token') : null;
      const currentToken = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
      const deviceHeaders = getDeviceHeaders();

      const refreshResponse = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include', // Sends snist_refresh_token httpOnly cookie
        headers: {
          'Content-Type': 'application/json',
          ...deviceHeaders,
          ...(currentToken ? { 'Authorization': `Bearer ${currentToken}` } : {})
        },
        body: JSON.stringify({
          refresh_token: storedRefreshToken || undefined,
          ...deviceHeaders
        })
      });

      if (refreshResponse.ok) {
        const data = await refreshResponse.json();
        if (data && data.access_token) {
          localStorage.setItem('token', data.access_token);
          if (data.refresh_token) {
            localStorage.setItem('refresh_token', data.refresh_token);
          }
          lastRefreshTime = Date.now();
          scheduleTokenAutoRefresh();
          return data.access_token;
        }
      }

      // If refresh failed with 401 or 403, the session is definitively terminated
      if (refreshResponse.status === 401 || refreshResponse.status === 403) {
        localStorage.removeItem('token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('user');
        if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
          window.location.href = '/login?reason=session_expired';
        }
        return null;
      }

      // Other HTTP statuses (e.g. 500, 502) should not immediately wipe the session
      return null;
    } catch (err) {
      // Network error or offline — do NOT wipe session on transient connection glitches!
      console.warn('Silent token refresh network warning:', err);
      return null;
    } finally {
      activeRefreshPromise = null;
    }
  })();

  return activeRefreshPromise;
}

/**
 * Schedules a sliding-window token auto-renewal (10 minutes for a 15-minute access token).
 */
export function scheduleTokenAutoRefresh() {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }

  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
  const userStr = typeof localStorage !== 'undefined' ? localStorage.getItem('user') : null;
  if (!token || !userStr) return;

  try {
    const user = JSON.parse(userStr);
    if (user.role === 'STUDENT' || user.role === 'TEACHER' || user.role === 'SUPER_ADMIN') {
      // Renew every 10 minutes (600,000 ms) while active, well before 15-minute expiry
      refreshTimer = setTimeout(async () => {
        await performTokenRefresh();
      }, 600000);
    }
  } catch (err) {
    console.warn('Error scheduling token refresh:', err);
  }
}

// Setup visibility listener to renew token when device wakes up or returns to tab
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      const elapsedMs = Date.now() - lastRefreshTime;
      // If student wakes device after 8+ minutes idle, silently refresh right away
      if (elapsedMs > 480000) {
        const token = localStorage.getItem('token');
        if (token) {
          performTokenRefresh().catch(() => {});
        }
      }
    }
  });
}

export async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('token');
  const deviceHeaders = getDeviceHeaders();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...deviceHeaders,
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const url = endpoint.startsWith('/') ? `${API_BASE}${endpoint}` : `${API_BASE}/${endpoint}`;
    const response = await fetch(url, {
      ...options,
      credentials: 'include',
      headers,
    });

    if (response.status === 401 && endpoint !== '/auth/refresh' && !(options as any)._isRetry) {
      // Attempt seamless token renewal before kicking out to login
      const newToken = await performTokenRefresh();
      if (newToken) {
        return apiRequest<T>(endpoint, { ...(options as any), _isRetry: true });
      }

      // If token refresh definitively failed, performTokenRefresh already handled redirect if 401/403
      throw new Error('Session expired. Please log in again.');
    }

    const text = await response.text().catch(() => '');

    if (!response.ok) {
      let msg = `Request failed (${response.status})`;
      if (text) {
        try {
          const errData = JSON.parse(text);
          if (typeof errData.detail === 'string') msg = errData.detail;
          else if (typeof errData.message === 'string') msg = errData.message;
          else if (Array.isArray(errData.detail)) msg = errData.detail.map((d: any) => d.msg || d).join(', ');
        } catch {
          if (!text.includes('<html')) msg = text;
        }
      }
      throw new Error(msg);
    }

    if (!text || text.trim() === '') {
      return {} as T;
    }

    try {
      const data = JSON.parse(text) as T;
      scheduleTokenAutoRefresh();
      return data;
    } catch {
      throw new Error('Server returned invalid data format. Please refresh and try again.');
    }
  } catch (err: any) {
    let message = err?.message || 'Network request failed';
    if (message.includes('pattern') || message.includes('SyntaxError') || message.includes('Unexpected token')) {
      message = 'Connection error. Please refresh the page.';
    }
    throw new Error(message);
  }
}
