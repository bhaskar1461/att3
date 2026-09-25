import { z } from 'zod';

export const RegisteredDeviceDetailSchema = z.object({
  device_id: z.string().optional().nullable(),
  device_model: z.string().optional().nullable(),
  fingerprint: z.string().optional().nullable(),
  registered_at: z.string().optional().nullable(),
  last_used_at: z.string().optional().nullable(),
  status: z.string().optional().nullable(),
}).passthrough();
export type RegisteredDeviceDetail = z.infer<typeof RegisteredDeviceDetailSchema>;

export const StudentDeviceInfoSchema = z.object({
  roll_number: z.string(),
  name: z.string(),
  email: z.string().optional().nullable(),
  has_registered_device: z.boolean(),
  registered_device: RegisteredDeviceDetailSchema.optional().nullable(),
  self_resets_this_semester: z.number(),
  max_self_resets: z.number(),
});
export type StudentDeviceInfo = z.infer<typeof StudentDeviceInfoSchema>;

export const DeviceBindingSchema = z.object({
  id: z.number().optional().nullable(),
  device_public_id: z.string().optional().nullable(),
  device_name: z.string().optional().nullable(),
  student_id: z.number().optional().nullable(),
  roll_number: z.string().optional().nullable(),
  status: z.string(),
  bound_at: z.string().optional().nullable(),
  last_used_at: z.string().optional().nullable(),
  revoked_reason: z.string().optional().nullable(),
});
export type DeviceBinding = z.infer<typeof DeviceBindingSchema>;

export const BindingListSchema = z.object({
  items: z.array(DeviceBindingSchema).default([]),
  total: z.number().default(0),
});
export type BindingList = z.infer<typeof BindingListSchema>;

export const DeviceResetRequestSchema = z.object({
  roll_number: z.string(),
  reason: z.string().optional().nullable(),
});
export type DeviceResetRequest = z.infer<typeof DeviceResetRequestSchema>;

export const DeviceResetVerifySchema = z.object({
  roll_number: z.string(),
  otp: z.string(),
});
export type DeviceResetVerify = z.infer<typeof DeviceResetVerifySchema>;

export const DeviceResetResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  resets_remaining: z.number().optional().nullable(),
}).passthrough();
export type DeviceResetResponse = z.infer<typeof DeviceResetResponseSchema>;

export const BulkResetRequestSchema = z.object({
  section_id: z.number().optional().nullable(),
  department_id: z.number().optional().nullable(),
  roll_numbers: z.array(z.string()).optional().nullable(),
  reason: z.string().default('Admin mass unlock'),
});
export type BulkResetRequest = z.infer<typeof BulkResetRequestSchema>;

export const BindingStatusSchema = z.object({
  has_active_binding: z.boolean().default(false),
  bound_device_key_id: z.string().optional().nullable(),
  lockout_remaining_minutes: z.number().optional().nullable(),
  status: z.string().optional().nullable(),
  roll_number: z.string().optional().nullable(),
}).passthrough();
export type BindingStatus = z.infer<typeof BindingStatusSchema>;
