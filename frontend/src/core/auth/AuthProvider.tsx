import React, { createContext, useContext, useMemo, useCallback } from 'react';
import type { Role } from '../types';
import { queryClient } from '../queryClient';
import { authEndpoints } from '../api/endpoints/auth';
import type { UserResponse } from '../api/schemas/auth';
import { ApiError } from '../api/client';
import { useAuth as useRootAuth } from '../../context/AuthContext';

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
  const lower = (backendRole || '').toLowerCase();
  if (lower.includes('admin')) return 'admin';
  if (lower.includes('teacher') || lower.includes('faculty')) return 'teacher';
  return 'student';
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const rootAuth = useRootAuth();
  const rootUser = rootAuth.user;
  const booting = rootAuth.isLoading;

  const user: AuthUser | null = useMemo(() => {
    if (!rootUser) return null;
    return {
      id: rootUser.id,
      username: rootUser.username,
      email: rootUser.email || null,
      role: rootUser.role,
      full_name: rootUser.full_name,
    };
  }, [rootUser]);

  const role: Role | null = useMemo(() => {
    return user ? normalizeRole(user.role) : null;
  }, [user]);

  const logout = useCallback(() => {
    queryClient.clear();
    rootAuth.logout();
  }, [rootAuth]);

  const refreshUser = useCallback(async (): Promise<AuthUser | null> => {
    try {
      const meData = await authEndpoints.me();
      return meData;
    } catch {
      return null;
    }
  }, []);

  const login = useCallback(async (
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

    rootAuth.login(
      tokenData.access_token,
      {
        id: tokenData.user_id,
        username: tokenData.username,
        role: tokenData.role as any,
        full_name: tokenData.full_name,
      },
      tokenData.refresh_token || undefined
    );

    try {
      const meData = await authEndpoints.me();
      return meData;
    } catch {
      const fallbackUser: AuthUser = {
        id: tokenData.user_id,
        username: tokenData.username,
        role: tokenData.role,
        full_name: tokenData.full_name,
      };
      return fallbackUser;
    }
  }, [rootAuth]);

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
