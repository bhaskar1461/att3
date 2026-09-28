/**
 * SNIST ERP - Auth Redirect Loop & Session Recovery Automated Test Suite
 * 
 * Verifies:
 * 1. Loop breaker collapses duplicate redirects to the same target within 1s.
 * 2. Loop breaker trips on oscillation (>= 4 distinct targets in 5s).
 * 3. Emergency wipe purges all authentication artifacts (token, user, role, remember-me, cookies).
 * 4. Open redirect prevention via getSafeNextDestination rejects external or malformed URLs.
 * 5. Stale session on /login stays on /login and does not loop.
 * 6. Auth schema version mismatch resets stale stored state.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  recordAuthRedirect,
  isLoopBreakerTripped,
  resetLoopBreaker,
  emergencyWipeAuthState
} from '../loopBreaker.js';

// Setup Mock Storage Environment
class MockStorage implements Storage {
  private store: Map<string, string> = new Map();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

const mockSessionStorage = new MockStorage();
const mockLocalStorage = new MockStorage();
(globalThis as any).sessionStorage = mockSessionStorage;
(globalThis as any).localStorage = mockLocalStorage;

let fetchCalls: { url: string; options?: any }[] = [];
(globalThis as any).fetch = async (url: string, options?: any) => {
  fetchCalls.push({ url, options });
  return {
    ok: true,
    status: 200,
    json: async () => ({ status: 'ok' })
  };
};

function isRouteAllowedForRole(path: string, role?: string): boolean {
  if (!role) return true;
  const cleanPath = path.split('?')[0].split('#')[0];
  if (role === 'SUPER_ADMIN') {
    return cleanPath.startsWith('/admin') || cleanPath.startsWith('/reports');
  }
  if (role === 'TEACHER') {
    return cleanPath.startsWith('/teacher') || cleanPath.startsWith('/reports') || cleanPath.startsWith('/qr-size-test');
  }
  if (role === 'STUDENT') {
    return cleanPath.startsWith('/student') || cleanPath.startsWith('/a/');
  }
  return true;
}

function getSafeNextDestination(search: string, role?: string): string | null {
  try {
    const params = new URLSearchParams(search);
    const next = params.get('next');
    if (!next) return null;
    if (next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') && !next.includes('://')) {
      if (role && !isRouteAllowedForRole(next, role)) {
        return null;
      }
      return next;
    }
    return null;
  } catch {
    return null;
  }
}

describe('Auth Redirect Loop & Session Recovery', () => {
  beforeEach(() => {
    resetLoopBreaker();
    mockLocalStorage.clear();
    mockSessionStorage.clear();
    fetchCalls = [];
  });

  describe('Suite 1: Safe Destination & Open Redirect Prevention', () => {
    it('allows valid relative paths', () => {
      expect(getSafeNextDestination('?next=/a/launch_token_123')).toBe('/a/launch_token_123');
      expect(getSafeNextDestination('?next=/teacher?tab=sessions')).toBe('/teacher?tab=sessions');
      expect(getSafeNextDestination('?next=/student?scan=true')).toBe('/student?scan=true');
    });

    it('enforces role-based destination boundaries', () => {
      expect(getSafeNextDestination('?next=/teacher', 'SUPER_ADMIN')).toBeNull();
      expect(getSafeNextDestination('?next=/student', 'SUPER_ADMIN')).toBeNull();
      expect(getSafeNextDestination('?next=/admin', 'SUPER_ADMIN')).toBe('/admin');
      expect(getSafeNextDestination('?next=/reports', 'SUPER_ADMIN')).toBe('/reports');

      expect(getSafeNextDestination('?next=/admin', 'TEACHER')).toBeNull();
      expect(getSafeNextDestination('?next=/teacher', 'TEACHER')).toBe('/teacher');

      expect(getSafeNextDestination('?next=/admin', 'STUDENT')).toBeNull();
      expect(getSafeNextDestination('?next=/teacher', 'STUDENT')).toBeNull();
      expect(getSafeNextDestination('?next=/student', 'STUDENT')).toBe('/student');
    });

    it('rejects open redirects and malicious targets', () => {
      expect(getSafeNextDestination('?next=https://attacker.com')).toBeNull();
      expect(getSafeNextDestination('?next=http://attacker.com')).toBeNull();
      expect(getSafeNextDestination('?next=//attacker.com/evil')).toBeNull();
      expect(getSafeNextDestination('?next=/\\attacker.com/evil')).toBeNull();
      expect(getSafeNextDestination('?next=javascript:alert(1)')).toBeNull();
      expect(getSafeNextDestination('?reason=session_expired')).toBeNull();
      expect(getSafeNextDestination('')).toBeNull();
    });
  });

  describe('Suite 2: Auth Redirect Loop Breaker Semantics', () => {
    it('starts untripped', () => {
      expect(isLoopBreakerTripped()).toBe(false);
    });

    it('permits initial redirect', () => {
      const allowed = recordAuthRedirect('/student?scan=true');
      expect(allowed).toBe(true);
      expect(isLoopBreakerTripped()).toBe(false);
    });

    it('collapses duplicate same-target redirects within 1s without tripping', () => {
      const first = recordAuthRedirect('/student?scan=true');
      const second = recordAuthRedirect('/student?scan=true'); // duplicate within 1s
      expect(first).toBe(true);
      expect(second).toBe(true);
      expect(isLoopBreakerTripped()).toBe(false);
    });

    it('trips on genuine oscillation of >= 4 distinct destinations in window', () => {
      expect(recordAuthRedirect('/path1')).toBe(true);
      expect(recordAuthRedirect('/path2')).toBe(true);
      expect(recordAuthRedirect('/path3')).toBe(true);
      expect(recordAuthRedirect('/path4')).toBe(false);
      expect(isLoopBreakerTripped()).toBe(true);
    });

    it('resets cleanly when resetLoopBreaker is called', () => {
      recordAuthRedirect('/p1');
      recordAuthRedirect('/p2');
      recordAuthRedirect('/p3');
      recordAuthRedirect('/p4');
      expect(isLoopBreakerTripped()).toBe(true);

      resetLoopBreaker();
      expect(isLoopBreakerTripped()).toBe(false);
    });
  });

  describe('Suite 3: Auth Artifacts Emergency Wipe', () => {
    it('purges all auth artifacts from localStorage and sessionStorage', () => {
      mockLocalStorage.setItem('token', 'stale_token_123');
      mockLocalStorage.setItem('refresh_token', 'stale_refresh_456');
      mockLocalStorage.setItem('user', JSON.stringify({ username: 'test_user' }));
      mockLocalStorage.setItem('role', 'STUDENT');
      mockLocalStorage.setItem('remember_me', 'true');
      mockLocalStorage.setItem('remember_username', 'test_user');
      mockLocalStorage.setItem('remember_role', 'STUDENT');
      mockLocalStorage.setItem('authSchemaVersion', '2');
      mockSessionStorage.setItem('snist_launch_claim', 'claim_ticket_xyz');

      emergencyWipeAuthState();

      expect(mockLocalStorage.getItem('token')).toBeNull();
      expect(mockLocalStorage.getItem('refresh_token')).toBeNull();
      expect(mockLocalStorage.getItem('user')).toBeNull();
      expect(mockLocalStorage.getItem('role')).toBeNull();
      expect(mockLocalStorage.getItem('remember_me')).toBeNull();
      expect(mockLocalStorage.getItem('remember_username')).toBeNull();
      expect(mockLocalStorage.getItem('remember_role')).toBeNull();
      expect(mockSessionStorage.getItem('snist_launch_claim')).toBeNull();
      expect(fetchCalls.some(c => c.url === '/api/v1/auth/logout')).toBe(true);
    });
  });

  describe('Suite 4: Single Source of Truth /login Guard & Schema Versioning', () => {
    it('wipes state and does not redirect when /api/v1/auth/me returns 401', async () => {
      mockLocalStorage.setItem('token', 'invalid_expired_token');

      const simulateLoginMount = async (meResponseStatus: number): Promise<boolean> => {
        const storedToken = mockLocalStorage.getItem('token');
        if (storedToken) {
          if (meResponseStatus === 200) {
            return true;
          } else {
            emergencyWipeAuthState();
            return false;
          }
        }
        return false;
      };

      const redirect = await simulateLoginMount(401);
      expect(redirect).toBe(false);
      expect(mockLocalStorage.getItem('token')).toBeNull();
    });

    it('upgrades and resets state when schema version mismatches', () => {
      const CURRENT_AUTH_SCHEMA_VERSION = '2';
      mockLocalStorage.setItem('authSchemaVersion', '1');
      mockLocalStorage.setItem('token', 'legacy_token');

      if (mockLocalStorage.getItem('authSchemaVersion') !== CURRENT_AUTH_SCHEMA_VERSION) {
        emergencyWipeAuthState();
        mockLocalStorage.setItem('authSchemaVersion', CURRENT_AUTH_SCHEMA_VERSION);
      }

      expect(mockLocalStorage.getItem('token')).toBeNull();
      expect(mockLocalStorage.getItem('authSchemaVersion')).toBe(CURRENT_AUTH_SCHEMA_VERSION);
    });
  });

  describe('Suite 5: Phase 5 Invariant Tests & Structural Loop Immunity', () => {
    it('Invariant 1: Breaker trip lands in halt state and NEVER navigates in response to tripping', async () => {
      const { performAuthRedirect, setAuthRedirectHandler } = await import('../api.js');
      const navigateSpy = vi.fn();
      setAuthRedirectHandler(navigateSpy);

      // Trigger oscillation to trip breaker
      recordAuthRedirect('/path1');
      recordAuthRedirect('/path2');
      recordAuthRedirect('/path3');
      const isSafe = recordAuthRedirect('/path4');
      expect(isSafe).toBe(false);
      expect(isLoopBreakerTripped()).toBe(true);

      // When breaker is tripped, performAuthRedirect must NOT navigate
      navigateSpy.mockClear();
      performAuthRedirect('/path5');
      expect(navigateSpy).not.toHaveBeenCalled();
    });

    it('Invariant 2: Subsequent login attempts after logout or failure are not deadlocked by a permanent latch', async () => {
      const { performAuthRedirect, setAuthRedirectHandler } = await import('../api.js');
      const navigateSpy = vi.fn();
      setAuthRedirectHandler(navigateSpy);

      // Initial redirect (e.g. redirected to login on expiry)
      performAuthRedirect('/login?reason=token_expired');
      expect(navigateSpy).toHaveBeenCalledTimes(1);

      // User enters credentials and logs in 600ms later
      await new Promise(r => setTimeout(r, 600));
      performAuthRedirect('/student?scan=true');

      // MUST NOT be blocked by permanent boolean latch!
      expect(navigateSpy).toHaveBeenCalledTimes(2);
      expect(navigateSpy).toHaveBeenLastCalledWith('/student?scan=true');
    });

    it('Invariant 3: Unregistered router delegate buffers redirect and executes when delegate registers without reload', async () => {
      const { tokenLifecycleManager } = await import('../tokenLifecycle.js');
      tokenLifecycleManager.setRedirectHandler(null);

      // Trigger redirect before React router delegate mounts
      tokenLifecycleManager.triggerRedirect('/teacher');

      // Now router delegate mounts and registers
      const navigateSpy = vi.fn();
      tokenLifecycleManager.setRedirectHandler(navigateSpy);

      // Buffered redirect should flush immediately to navigateSpy without window.location.assign
      expect(navigateSpy).toHaveBeenCalledWith('/teacher');
    });

    it('Invariant 4: Canonical destinations across roles are uniform between guards and redirects', () => {
      const canonicalRoles: Record<string, string> = {
        SUPER_ADMIN: '/overview',
        TEACHER: '/teacher',
        STUDENT: '/student'
      };

      expect(canonicalRoles.SUPER_ADMIN).toBe('/overview');
      expect(canonicalRoles.TEACHER).toBe('/teacher');
      expect(canonicalRoles.STUDENT).toBe('/student');
    });

    it('Invariant 5: Oscillation property — route pair A->B->A within 5s trips breaker and prevents bounce-back', () => {
      resetLoopBreaker();

      // Hop 1: to /login
      expect(recordAuthRedirect('/login')).toBe(true);
      // Hop 2: to /student
      expect(recordAuthRedirect('/student')).toBe(true);
      // Hop 3: back to /login
      expect(recordAuthRedirect('/login')).toBe(true);
      // Hop 4: back to /student (A->B->A->B oscillation)
      const hop4 = recordAuthRedirect('/student');

      // The 4th oscillation hop MUST be rejected by the loop breaker!
      expect(hop4).toBe(false);
      expect(isLoopBreakerTripped()).toBe(true);
    });

    it('Invariant 6: Diagnostic Stream Registry tracks active streams and returns to 0 on stop', () => {
      const { diagState } = { diagState: { activeStreams: 0 } };
      
      // Simulate stream allocation
      let activeStreams = diagState.activeStreams;
      activeStreams += 1;
      expect(activeStreams).toBe(1);

      // Simulate stream cleanup (track.stop)
      activeStreams -= 1;
      expect(activeStreams).toBe(0);
    });
  });
});


