import { getDeviceHeaders } from './deviceCredential';

const API_BASE = '/api/v1';
let refreshTimer: any = null;

export function scheduleTokenAutoRefresh() {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }

  const token = localStorage.getItem('token');
  const userStr = localStorage.getItem('user');
  if (!token || !userStr) return;

  try {
    const user = JSON.parse(userStr);
    if (user.role === 'STUDENT') {
      // Schedule silent background token refresh every 20 seconds (before 30-sec expiry)
      refreshTimer = setTimeout(async () => {
        try {
          const res = await apiRequest<{ access_token: string }>('/auth/refresh', { method: 'POST' });
          if (res && res.access_token) {
            localStorage.setItem('token', res.access_token);
            scheduleTokenAutoRefresh();
          }
        } catch (err) {
          console.warn('Silent token refresh warning:', err);
        }
      }, 20000);
    }
  } catch (err) {
    console.warn('Error scheduling token refresh:', err);
  }
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
      headers,
    });

    if (response.status === 401 && endpoint !== '/auth/refresh' && !(options as any)._isRetry) {
      // Attempt seamless token renewal before kicking out to login
      try {
        const refreshResponse = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...deviceHeaders,
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          }
        });
        if (refreshResponse.ok) {
          const refreshData = await refreshResponse.json();
          if (refreshData && refreshData.access_token) {
            localStorage.setItem('token', refreshData.access_token);
            scheduleTokenAutoRefresh();
            return apiRequest<T>(endpoint, { ...(options as any), _isRetry: true });
          }
        }
      } catch {}

      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
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
