const API_BASE = '/api/v1';

export async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
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

    if (response.status === 401) {
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
      return JSON.parse(text) as T;
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
