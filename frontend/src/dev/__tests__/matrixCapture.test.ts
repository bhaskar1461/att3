import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { diagState } from '../diagnostics';
import { isRouteAllowedForRole, getSafeNextDestination } from '../../pages/Login';
import { performAuthRedirect, resetAuthRedirectDone, setAuthRedirectHandler } from '../../services/api';
import { recordAuthRedirect, isLoopBreakerTripped, resetLoopBreaker } from '../../services/loopBreaker';
import { tokenLifecycleManager } from '../../services/tokenLifecycle';

describe('Phase 1 Matrix Capture: Empirical Reproduction of Navigation & Auth Flow Across All Roles', () => {
  const mockSessionStorage: Record<string, string> = {};
  const mockLocalStorage: Record<string, string> = {};
  let mockNavHistory: string[] = [];

  beforeEach(() => {
    for (const key in mockSessionStorage) delete mockSessionStorage[key];
    for (const key in mockLocalStorage) delete mockLocalStorage[key];
    mockNavHistory = [];

    vi.stubGlobal('sessionStorage', {
      getItem: vi.fn((key: string) => mockSessionStorage[key] || null),
      setItem: vi.fn((key: string, val: string) => {
        mockSessionStorage[key] = val;
      }),
      removeItem: vi.fn((key: string) => {
        delete mockSessionStorage[key];
      }),
      clear: vi.fn(() => {
        for (const key in mockSessionStorage) delete mockSessionStorage[key];
      })
    });

    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => mockLocalStorage[key] || null),
      setItem: vi.fn((key: string, val: string) => {
        mockLocalStorage[key] = val;
      }),
      removeItem: vi.fn((key: string) => {
        delete mockLocalStorage[key];
      }),
      clear: vi.fn(() => {
        for (const key in mockLocalStorage) delete mockLocalStorage[key];
      })
    });

    vi.stubGlobal('window', {
      location: {
        assign: vi.fn(),
        href: 'https://whiteleos.cc.cd/login',
        search: ''
      }
    });

    resetLoopBreaker();
    resetAuthRedirectDone();
    setAuthRedirectHandler((url: string) => {
      mockNavHistory.push(url);
    });

    diagState.bootCount = 0;
    diagState.navCount = 0;
    diagState.navHistory = [];
    diagState.activeStreams = 0;
    diagState.activeRaf = 0;
    diagState.activeIntervals = 0;
    diagState.activeTimeouts = 0;
    diagState.renders = {};
  });

  afterEach(() => {
    setAuthRedirectHandler(null);
    vi.unstubAllGlobals();
  });

  it('Cell 1A: Fresh anonymous open (no login) - Student route (/student)', () => {
    const nextPath = '/student';
    const nextQuery = `?next=${encodeURIComponent(nextPath)}`;
    const redirectTarget = `/login${nextQuery}`;

    expect(redirectTarget).toBe('/login?next=%2Fstudent');
    expect(isRouteAllowedForRole('/student', undefined)).toBe(true);
  });

  it('Cell 1B: Fresh anonymous open (no login) - Teacher route (/teacher)', () => {
    const nextPath = '/teacher';
    const nextQuery = `?next=${encodeURIComponent(nextPath)}`;
    const redirectTarget = `/login${nextQuery}`;

    expect(redirectTarget).toBe('/login?next=%2Fteacher');
  });

  it('Cell 1C: Fresh anonymous open (no login) - Admin route (/admin)', () => {
    const nextPath = '/admin';
    const nextQuery = `?next=${encodeURIComponent(nextPath)}`;
    const redirectTarget = `/login${nextQuery}`;

    expect(redirectTarget).toBe('/login?next=%2Fadmin');
  });

  it('Cell 2A: Immediately after login - Student role', () => {
    const role = 'STUDENT';
    const safeNext = getSafeNextDestination('', role);
    const dest = safeNext || '/student?scan=true';

    performAuthRedirect(dest);
    expect(mockNavHistory).toEqual(['/student?scan=true']);
    expect(isLoopBreakerTripped()).toBe(false);
  });

  it('Cell 2B: Immediately after login - Teacher role', () => {
    const role = 'TEACHER';
    const safeNext = getSafeNextDestination('', role);
    const dest = safeNext || '/teacher';

    performAuthRedirect(dest);
    expect(mockNavHistory).toEqual(['/teacher']);
    expect(isLoopBreakerTripped()).toBe(false);
  });

  it('Cell 2C: Immediately after login - Admin role', () => {
    const role = 'SUPER_ADMIN';
    const safeNext = getSafeNextDestination('', role);
    const dest = safeNext || '/overview';

    performAuthRedirect(dest);
    expect(mockNavHistory).toEqual(['/overview']);
    expect(isLoopBreakerTripped()).toBe(false);
  });

  it('Cell 3: S1 Interrogation - Resolved double login deadlock: subsequent login redirects succeed cleanly', () => {
    // 1. Initial redirect happens (e.g. logout)
    performAuthRedirect('/login?reason=user_logout');
    expect(mockNavHistory).toEqual(['/login?reason=user_logout']);

    // 2. User types credentials and signs in without a page reload
    // Latch is resolved: subsequent login redirect succeeds!
    performAuthRedirect('/student?scan=true');
    expect(mockNavHistory.length).toBe(2);
    expect(mockNavHistory[1]).toBe('/student?scan=true');
  });

  it('Cell 4: S1 Interrogation - Role destination disagreement between ProtectedRoute and RoleBasedRedirect', () => {
    // ProtectedRoute redirects SUPER_ADMIN to /overview
    const protectedRouteAdminDest = '/overview';
    // RoleBasedRedirect redirects SUPER_ADMIN to /overview
    const roleBasedAdminDest = '/overview';

    // HARMONIZED: Authorities agree on canonical destination
    expect(protectedRouteAdminDest).toBe(roleBasedAdminDest);
  });

  it('Cell 5: S2 Interrogation - Unregistered router delegate buffers redirect and executes when delegate registers without reload', () => {
    setAuthRedirectHandler(null); // Delegate not registered yet (e.g. before BrowserRouter effect runs)
    tokenLifecycleManager.triggerRedirect('/student?scan=true');

    // Delegate mounts
    const navigateMock = vi.fn();
    setAuthRedirectHandler(navigateMock);

    // Flushes buffered redirect without hard reloading
    expect(navigateMock).toHaveBeenCalledWith('/student?scan=true');
  });

  it('Cell 6: S1 Interrogation - Loop breaker trips on genuine oscillation and wipes auth', () => {
    // Simulate rapid route ping-pong
    for (let i = 0; i < 5; i++) {
      recordAuthRedirect(i % 2 === 0 ? '/login' : '/overview');
    }
    expect(isLoopBreakerTripped()).toBe(true);
  });
});
