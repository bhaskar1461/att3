import { z } from 'zod';
import { api } from '../client';
import { s } from '../schemas';
import type { LoginRequest, ChangePasswordRequest } from '../schemas/auth';

export const authEndpoints = {
  login: (data: LoginRequest) =>
    api('/api/v1/auth/login', s.TokenResponseSchema, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  me: () =>
    api('/api/v1/auth/me', s.UserResponseSchema),

  refresh: () =>
    api('/api/v1/auth/refresh', z.record(z.string(), z.unknown()), {
      method: 'POST',
    }),

  logout: () =>
    api('/api/v1/auth/logout', z.record(z.string(), z.unknown()), {
      method: 'POST',
    }),

  getMagicTokenInfo: (token: string) =>
    api(`/api/v1/auth/magic-token-info?token=${encodeURIComponent(token)}`, s.MagicTokenInfoSchema),

  changePassword: (data: ChangePasswordRequest) =>
    api('/api/v1/auth/change-password', z.record(z.string(), z.unknown()), {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};
