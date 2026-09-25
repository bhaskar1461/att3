import { z } from 'zod';

export const LoginRequestSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
  device_public_id: z.string().optional().nullable(),
  device_secret: z.string().optional().nullable(),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const TokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string().default('bearer'),
  role: z.string(),
  username: z.string(),
  full_name: z.string(),
  user_id: z.number(),
  refresh_token: z.string().optional().nullable(),
});
export type TokenResponse = z.infer<typeof TokenResponseSchema>;

export const UserResponseSchema = z.object({
  id: z.number(),
  username: z.string(),
  email: z.string().optional().nullable(),
  role: z.string(),
  full_name: z.string(),
});
export type UserResponse = z.infer<typeof UserResponseSchema>;

export const MagicTokenInfoSchema = z.object({
  valid: z.boolean(),
  roll_number: z.string().optional().nullable(),
  student_name: z.string().optional().nullable(),
  expires_at: z.string().optional().nullable(),
  message: z.string().optional().nullable(),
}).passthrough();
export type MagicTokenInfo = z.infer<typeof MagicTokenInfoSchema>;

export const ChangePasswordRequestSchema = z.object({
  old_password: z.string(),
  new_password: z.string().min(6),
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;
