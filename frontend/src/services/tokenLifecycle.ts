/**
 * SNIST ERP - Token Lifecycle Manager
 * 
 * Decouples sliding-window token auto-renewal from api transport and breaks
 * the circular recursion loop between performTokenRefresh and scheduleTokenAutoRefresh.
 * Provides explicit cancellation and teardown on logout / emergency wipe.
 */

import { emergencyWipeAuthState } from './loopBreaker';

const API_BASE = '/api/v1';
const REFRESH_INTERVAL_MS = 600000; // 10 minutes for a 15-minute access token
const WAKE_THRESHOLD_MS = 480000;    // 8 minutes idle before immediate refresh on tab focus

type RedirectCallback = (url: string) => void;

class TokenLifecycleManager {
  private refreshTimer: any = null;
  private lastRefreshTime: number = Date.now();
  private activeRefreshPromise: Promise<string | null> | null = null;
  private redirectHandler: RedirectCallback | null = null;
  private pendingRedirect: string | null = null;
  private isVisibilityListenerAttached = false;

  constructor() {
    this.initVisibilityListener();
  }

  /**
   * Registers custom redirect handler from AuthContext or navigation shell.
   * Flushes any buffered redirect pending delegate registration.
   */
  public setRedirectHandler(handler: RedirectCallback | null): void {
    this.redirectHandler = handler;
    if (handler && this.pendingRedirect) {
      const target = this.pendingRedirect;
      this.pendingRedirect = null;
      handler(target);
    }
  }

  /**
   * Performs an authorized navigation or fallback window redirect.
   * Buffers target if router delegate is still mounting to avoid full reload loop.
   */
  public triggerRedirect(targetUrl: string): void {
    if (this.redirectHandler) {
      this.redirectHandler(targetUrl);
      return;
    }

    // Buffer redirect if delegate hasn't registered yet
    this.pendingRedirect = targetUrl;

    if (typeof window !== 'undefined') {
      setTimeout(() => {
        if (this.pendingRedirect === targetUrl && !this.redirectHandler) {
          const current = window.location.pathname + window.location.search;
          if (current !== targetUrl) {
            console.warn('[auth] router delegate not ready — fallback replace');
            this.pendingRedirect = null;
            window.location.replace(targetUrl);
          }
        }
      }, 150);
    }
  }

  /**
   * Cancels any pending sliding-window auto-refresh timer.
   */
  public cancelAutoRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /**
   * Schedules a sliding-window token auto-renewal (10 minutes for a 15-minute access token).
   * Safe to call repeatedly; always clears existing pending timers.
   */
  public scheduleAutoRefresh(): void {
    this.cancelAutoRefresh();

    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
    const userStr = typeof localStorage !== 'undefined' ? localStorage.getItem('user') : null;
    if (!token || !userStr) return;

    try {
      const user = JSON.parse(userStr);
      if (user.role === 'STUDENT' || user.role === 'TEACHER' || user.role === 'SUPER_ADMIN') {
        this.refreshTimer = setTimeout(async () => {
          await this.executeRefresh('sliding_window_timer');
        }, REFRESH_INTERVAL_MS);
      }
    } catch (err) {
      console.warn('[TokenLifecycle] Error scheduling token refresh:', err);
    }
  }

  /**
   * Performs a silent token refresh using httpOnly cookie or fallback refresh_token.
   * Deduplicates concurrent refresh requests using a singleton Promise.
   */
  public async executeRefresh(reason: string = 'manual'): Promise<string | null> {
    if (this.activeRefreshPromise) {
      return this.activeRefreshPromise;
    }

    this.activeRefreshPromise = (async () => {
      try {
        const storedRefreshToken = typeof localStorage !== 'undefined' ? localStorage.getItem('refresh_token') : null;
        const currentToken = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;

        const refreshResponse = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          credentials: 'include', // Sends snist_refresh_token httpOnly cookie
          headers: {
            'Content-Type': 'application/json',
            ...(currentToken ? { 'Authorization': `Bearer ${currentToken}` } : {})
          },
          body: JSON.stringify({
            refresh_token: storedRefreshToken || undefined
          })
        });

        if (refreshResponse.ok) {
          const data = await refreshResponse.json();
          if (data && data.access_token) {
            if (typeof localStorage !== 'undefined') {
              localStorage.setItem('token', data.access_token);
              if (data.refresh_token) {
                localStorage.setItem('refresh_token', data.refresh_token);
              }
            }
            this.lastRefreshTime = Date.now();
            this.scheduleAutoRefresh();
            return data.access_token;
          }
        }

        // If refresh failed with 401 or 403, the session is definitively terminated
        if (refreshResponse.status === 401 || refreshResponse.status === 403) {
          this.cancelAutoRefresh();
          emergencyWipeAuthState();
          if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
            const currentPath = window.location.pathname + window.location.search;
            const nextParam = currentPath.startsWith('/a/') ? `&next=${encodeURIComponent(currentPath)}` : '';
            this.triggerRedirect(`/login?reason=token_expired${nextParam}`);
          }
          return null;
        }

        // Other HTTP statuses (e.g. 500, 502) should not immediately wipe the session
        return null;
      } catch (err) {
        // Network error or offline — do NOT wipe session on transient connection glitches!
        console.warn(`[TokenLifecycle] Silent token refresh network warning (${reason}):`, err);
        return null;
      } finally {
        this.activeRefreshPromise = null;
      }
    })();

    return this.activeRefreshPromise;
  }

  /**
   * Initializes tab visibility change listener to refresh tokens when waking up from background.
   */
  private initVisibilityListener(): void {
    if (this.isVisibilityListenerAttached || typeof document === 'undefined') return;

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        const elapsedMs = Date.now() - this.lastRefreshTime;
        // If user wakes device after 8+ minutes idle, silently refresh right away
        if (elapsedMs > WAKE_THRESHOLD_MS) {
          const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
          if (token) {
            this.executeRefresh('tab_wake_visibility').catch(() => {});
          }
        }
      }
    });

    this.isVisibilityListenerAttached = true;
  }
}

export const tokenLifecycleManager = new TokenLifecycleManager();
