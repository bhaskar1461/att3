import { ZodType } from 'zod';

export class ApiError extends Error {
  constructor(public status: number, public body: string) {
    super(`API ${status}`);
    this.name = 'ApiError';
  }
}

export async function api<T>(path: string, schema: ZodType<T>, init?: RequestInit): Promise<T> {
  const BASE = import.meta.env.VITE_API_BASE ?? '';
  const url = `${BASE}${path}`;

  const headers = new Headers(init?.headers || {});
  
  if (!headers.has('Content-Type') && !(init?.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('access_token') : null;
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(url, {
    ...init,
    headers,
  });

  if (response.status === 401) {
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
    const errText = await response.text().catch(() => 'Unauthorized');
    throw new ApiError(401, errText);
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText);
    throw new ApiError(response.status, errText);
  }

  const jsonData = await response.json();
  return schema.parse(jsonData);
}
