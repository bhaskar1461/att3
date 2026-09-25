import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { Role } from '../types';
import { queryClient } from '../queryClient';
import { authEndpoints } from '../api/endpoints/auth';
import type { UserResponse } from '../api/schemas/auth';
import { ApiError } from '../api/client';

export type AuthUser = UserResponse;

export interface AuthContextType {
  user: AuthUser | null;
  role: Role | null;
  booting: boolean;
  login: (username: string, password: string, devicePublicId?: string, deviceSecret?: string) => Promise<AuthUser>;
  logout: () => void;
  refreshUser: () => Promise<AuthUser | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function normalizeRole(backendRole: string): Role {
  const lower = backendRole.toLowerCase();
  if (lower.includes('admin')) return 'admin';
  if (lower.includes('teacher') || lower.includes('faculty')) return 'teacher';
  return 'student';
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [booting, setBooting] = useState<boolean>(true);

  const logout = useCallback(() => {
    try {
      localStorage.removeItem('access_token');
      localStorage.removeItem('token');
      localStorage.removeItem('role');
    } catch {
      // Ignore storage errors
    }
    queryClient.clear();
    setUser(null);
    setRole(null);
  }, []);

  const refreshUser = useCallback(async (): Promise<AuthUser | null> => {
    try {
      const token = localStorage.getItem('access_token') || localStorage.getItem('token');
      if (!token) {
        setUser(null);
        setRole(null);
        return null;
      }
      const meData = await authEndpoints.me();
      setUser(meData);
      setRole(normalizeRole(meData.role));
      return meData;
    } catch {
      logout();
      return null;
    }
  }, [logout]);

  // Initial boot check
  useEffect(() => {
    const token = typeof localStorage !== 'undefined' ? (localStorage.getItem('access_token') || localStorage.getItem('token')) : null;
    if (!token) {
      setBooting(false);
      return;
    }
    refreshUser().finally(() => {
      setBooting(false);
    });
  }, [refreshUser]);

  // Global 401 unauthorized listener from core client
  useEffect(() => {
    const handleUnauthorized = () => {
      logout();
    };
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => {
      window.removeEventListener('auth:unauthorized', handleUnauthorized);
    };
  }, [logout]);

  const login = async (
    username: string,
    password: string,
    devicePublicId?: string,
    deviceSecret?: string
  ): Promise<AuthUser> => {
    const tokenData = await authEndpoints.login({
      username,
      password,
      device_public_id: devicePublicId,
      device_secret: deviceSecret,
    });

    localStorage.setItem('access_token', tokenData.access_token);
    localStorage.setItem('token', tokenData.access_token);
    if (tokenData.role) {
      localStorage.setItem('role', tokenData.role);
    }

    try {
      const meData = await authEndpoints.me();
      setUser(meData);
      const parsedRole = normalizeRole(meData.role);
      setRole(parsedRole);
      return meData;
    } catch {
      // Fallback to token payload if me() fails
      const fallbackUser: AuthUser = {
        id: tokenData.user_id,
        username: tokenData.username,
        role: tokenData.role,
        full_name: tokenData.full_name,
      };
      setUser(fallbackUser);
      setRole(normalizeRole(tokenData.role));
      return fallbackUser;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        role,
        booting,
        login,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export { ApiError };
