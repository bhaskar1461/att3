import { getDeviceHeaders } from './deviceCredential';
import { emergencyWipeAuthState, recordAuthRedirect } from './loopBreaker';
import { tokenLifecycleManager } from './tokenLifecycle';

const API_BASE = '/api/v1';

type AuthRedirectHandler = (url: string) => void;

export function setAuthRedirectHandler(handler: AuthRedirectHandler | null) {
  tokenLifecycleManager.setRedirectHandler(handler);
}

export function performAuthRedirect(url: string) {
  const isSafe = recordAuthRedirect();
  const targetUrl = isSafe ? url : '/login?reason=loop_breaker_tripped';
  if (!isSafe) {
    emergencyWipeAuthState();
    tokenLifecycleManager.cancelAutoRefresh();
  }

  tokenLifecycleManager.triggerRedirect(targetUrl);
}

/**
 * Performs a silent token refresh using httpOnly cookie or fallback refresh_token.
 * Deduplicates concurrent refresh requests using a singleton Promise via TokenLifecycleManager.
 */
export async function performTokenRefresh(): Promise<string | null> {
  return tokenLifecycleManager.executeRefresh('api_request_interceptor');
}

/**
 * Schedules a sliding-window token auto-renewal (10 minutes for a 15-minute access token).
 */
export function scheduleTokenAutoRefresh() {
  tokenLifecycleManager.scheduleAutoRefresh();
}

/**
 * Explicitly cancels the sliding-window token auto-renewal timer (e.g. on logout or session wipe).
 */
export function cancelTokenAutoRefresh() {
  tokenLifecycleManager.cancelAutoRefresh();
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

      // If token refresh failed, parse response error code if available
      let reason = 'token_expired';
      try {
        const errText = await response.text();
        const parsed = JSON.parse(errText);
        if (parsed.code) reason = parsed.code;
        else if (parsed.detail?.code) reason = parsed.detail.code;
      } catch {}

      emergencyWipeAuthState();
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        const currentPath = window.location.pathname + window.location.search;
        const nextParam = currentPath && currentPath !== '/' ? `&next=${encodeURIComponent(currentPath)}` : '';
        performAuthRedirect(`/login?reason=${reason}${nextParam}`);
      }
      throw new Error('Session expired. Please log in again.');
    }

    const text = await response.text().catch(() => '');

    if (!response.ok) {
      let msg = `Request failed (${response.status})`;
      let code: string | undefined;
      let phase7Code: string | undefined;
      let errorCode: string | undefined;
      let serverNow: number | undefined;
      let retryAfter: number | undefined;
      if (text) {
        try {
          const errData = JSON.parse(text);
          if (typeof errData.detail === 'string') {
            msg = errData.detail;
          } else if (errData.detail && typeof errData.detail === 'object') {
            msg = errData.detail.message || errData.detail.msg || msg;
            code = errData.detail.code;
            phase7Code = errData.detail.phase7_code;
            errorCode = errData.detail.error_code;
            serverNow = errData.detail.serverNow;
            retryAfter = errData.detail.retry_after;
          } else if (typeof errData.message === 'string') {
            msg = errData.message;
          } else if (Array.isArray(errData.detail)) {
            msg = errData.detail.map((d: any) => d.msg || d).join(', ');
          }
          if (!code && errData.code) code = errData.code;
          if (!phase7Code && errData.phase7_code) phase7Code = errData.phase7_code;
          if (!errorCode && errData.error_code) errorCode = errData.error_code;
          if (!serverNow && errData.serverNow) serverNow = errData.serverNow;
          if (!retryAfter && errData.retry_after) retryAfter = errData.retry_after;
        } catch {
          if (!text.includes('<html')) msg = text;
        }
      }
      if (!retryAfter && response.headers.get('Retry-After')) {
        const parsedRa = parseInt(response.headers.get('Retry-After') || '0', 10);
        if (!isNaN(parsedRa) && parsedRa > 0) retryAfter = parsedRa;
      }
      const apiErr: any = new Error(msg);
      apiErr.status = response.status;
      if (code) apiErr.code = code;
      if (phase7Code) apiErr.phase7_code = phase7Code;
      if (errorCode) apiErr.error_code = errorCode;
      if (serverNow) apiErr.serverNow = serverNow;
      if (retryAfter) apiErr.retry_after = retryAfter;
      throw apiErr;
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
    if (err?.name === 'AbortError' || err?.message?.toLowerCase().includes('abort')) {
      const abortErr: any = new Error('Request was aborted.');
      abortErr.name = 'AbortError';
      abortErr.code = 'aborted';
      throw abortErr;
    }
    let message = err?.message || 'Network request failed';
    if (message.includes('pattern') || message.includes('SyntaxError') || message.includes('Unexpected token')) {
      message = 'Connection error. Please refresh the page.';
    }
    const finalErr: any = new Error(message);
    if (err?.name) finalErr.name = err.name;
    if (err?.code) finalErr.code = err.code;
    if (err?.phase7_code) finalErr.phase7_code = err.phase7_code;
    if (err?.error_code) finalErr.error_code = err.error_code;
    if (err?.status) finalErr.status = err.status;
    if (err?.serverNow) finalErr.serverNow = err.serverNow;
    if (err?.retry_after) finalErr.retry_after = err.retry_after;
    throw finalErr;
  }
}
