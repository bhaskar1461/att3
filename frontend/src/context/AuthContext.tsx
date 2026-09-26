import React, { createContext, useContext, useState, useEffect } from 'react';
import { UserProfile } from '../types';
import { scheduleTokenAutoRefresh, performAuthRedirect } from '../services/api';
import { emergencyWipeAuthState } from '../services/loopBreaker';

export const AUTH_SCHEMA_VERSION = '2';
const SCHEMA_VERSION_KEY = 'snist_auth_schema_version';

interface AuthContextType {
  user: UserProfile | null;
  token: string | null;
  login: (token: string, user: UserProfile, refreshToken?: string) => void;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const AUTH_CHANNEL_NAME = 'snist_auth_channel';

/**
 * Clears all authentication artifacts from local and session storage,
 * and notifies the server to invalidate httpOnly refresh cookies.
 */
export async function clearAllAuthArtifacts(): Promise<void> {
  emergencyWipeAuthState();
  try {
    const channel = new BroadcastChannel(AUTH_CHANNEL_NAME);
    channel.postMessage({ type: 'LOGOUT' });
    channel.close();
  } catch {}
}

/**
 * Client-side JWT expiration check.
 * Decodes the JWT exp claim; returns true if expired or on parse failure.
 */
export function isTokenExpired(jwtToken: string): boolean {
  try {
    const parts = jwtToken.split('.');
    if (parts.length !== 3) return true;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    const decoded = JSON.parse(jsonPayload);
    if (!decoded || typeof decoded.exp !== 'number') return true;
    // Current time in seconds (with 10-second safety margin)
    return decoded.exp <= Math.floor(Date.now() / 1000) + 10;
  } catch {
    return true;
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isCancelled = false;

    async function initAuth() {
      // 1. Schema migration: if auth schema version does not match, purge stale storage
      if (typeof localStorage !== 'undefined') {
        const storedVersion = localStorage.getItem(SCHEMA_VERSION_KEY);
        if (storedVersion !== AUTH_SCHEMA_VERSION) {
          localStorage.removeItem('token');
          localStorage.removeItem('refresh_token');
          localStorage.removeItem('user');
          localStorage.setItem(SCHEMA_VERSION_KEY, AUTH_SCHEMA_VERSION);
        }
      }

      const storedToken = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
      const storedUser = typeof localStorage !== 'undefined' ? localStorage.getItem('user') : null;

      if (!storedToken || !storedUser || isTokenExpired(storedToken)) {
        if (storedToken || storedUser) {
          await clearAllAuthArtifacts();
        }
        if (!isCancelled) {
          setUser(null);
          setToken(null);
          setIsLoading(false);
        }
        return;
      }

      // 2. Server validation: Server is the single source of truth.
      // Verify token with GET /api/v1/auth/me before trusting local state.
      try {
        const res = await fetch('/api/v1/auth/me', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${storedToken}`,
            'Cache-Control': 'no-store, no-cache, must-revalidate'
          },
          credentials: 'include'
        });

        if (res.ok) {
          const verifiedUser: UserProfile = await res.json();
          if (!isCancelled) {
            setToken(storedToken);
            setUser(verifiedUser);
            localStorage.setItem('user', JSON.stringify(verifiedUser));
            scheduleTokenAutoRefresh();
            setIsLoading(false);
          }
        } else {
          // Token rejected by server (e.g. 401, 403, revoked session)
          await clearAllAuthArtifacts();
          if (!isCancelled) {
            setUser(null);
            setToken(null);
            setIsLoading(false);
          }
        }
      } catch {
        // Network error during startup verification — clear local state to prevent split-brain bounce
        await clearAllAuthArtifacts();
        if (!isCancelled) {
          setUser(null);
          setToken(null);
          setIsLoading(false);
        }
      }
    }

    initAuth();

    // Cross-tab sync via BroadcastChannel
    try {
      const channel = new BroadcastChannel(AUTH_CHANNEL_NAME);
      channel.onmessage = (event) => {
        if (event.data?.type === 'LOGOUT') {
          setToken(null);
          setUser(null);
        } else if (event.data?.type === 'LOGIN' && event.data?.token && event.data?.user) {
          setToken(event.data.token);
          setUser(event.data.user);
        }
      };
      return () => {
        isCancelled = true;
        channel.close();
      };
    } catch {
      return () => {
        isCancelled = true;
      };
    }
  }, []);

  const login = (newToken: string, newUser: UserProfile, newRefreshToken?: string) => {
    setToken(newToken);
    setUser(newUser);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('token', newToken);
      localStorage.setItem('access_token', newToken);
      if (newRefreshToken) {
        localStorage.setItem('refresh_token', newRefreshToken);
      }
      localStorage.setItem('user', JSON.stringify(newUser));
      localStorage.setItem(SCHEMA_VERSION_KEY, AUTH_SCHEMA_VERSION);
    }
    scheduleTokenAutoRefresh();
  };

  const logout = async () => {
    await clearAllAuthArtifacts();
    setToken(null);
    setUser(null);
    performAuthRedirect('/login?reason=user_logout');
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
