import { ZodType } from 'zod';
import { MOCK_ROUTES } from '../../services/mock/handlers';

export class ApiError extends Error {
  constructor(public status: number, public body: string) {
    super(`API ${status}`);
    this.name = 'ApiError';
  }
}

// Dev mock tracking event emitter
const mockHits = new Set<string>();
type MockHitListener = (count: number) => void;
const mockHitListeners = new Set<MockHitListener>();

export function markMockHit(path: string) {
  mockHits.add(path);
  mockHitListeners.forEach((listener) => listener(mockHits.size));
}

export function subscribeMockHits(listener: MockHitListener): () => void {
  mockHitListeners.add(listener);
  listener(mockHits.size);
  return () => {
    mockHitListeners.delete(listener);
  };
}

export function getMockHitsCount(): number {
  return mockHits.size;
}

export async function api<T>(path: string, schema: ZodType<T>, init?: RequestInit): Promise<T> {
  const BASE = import.meta.env.VITE_API_BASE ?? '';
  const url = `${BASE}${path}`;

  // Approved Phase 3 core edit: DEV-only mock interceptor
  if (import.meta.env.DEV) {
    const hit = MOCK_ROUTES.find((route) => route.match.test(path));
    if (hit) {
      markMockHit(path);
      const mockResult = await hit.handler(init, url);
      return schema.parse(mockResult);
    }
  }

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
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('auth:unauthorized'));
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
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
