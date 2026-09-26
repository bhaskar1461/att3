import { z } from 'zod';
import { api } from '../client';
import { s } from '../schemas';
import type {
  DeviceResetRequest,
  DeviceResetVerify,
  BulkResetRequest,
} from '../schemas/devices';

export const devicesEndpoints = {
  getStudentDeviceInfo: (rollNumber: string) =>
    api(`/api/v1/devices/student-device-info?roll_number=${encodeURIComponent(rollNumber)}`, s.StudentDeviceInfoSchema),

  requestReset: (data: DeviceResetRequest) =>
    api('/api/v1/devices/request-reset', s.DeviceResetResponseSchema, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  verifyReset: (data: DeviceResetVerify) =>
    api('/api/v1/devices/verify-reset', s.DeviceResetResponseSchema, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  bulkReset: (data: BulkResetRequest) =>
    api('/api/v1/devices/bulk-reset', z.record(z.string(), z.unknown()), {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getBindingStatus: () =>
    api('/api/v1/binding/status', s.BindingStatusSchema),

  revokeBinding: (studentId: number) =>
    api(`/api/v1/binding/admin/revoke/${studentId}`, z.record(z.string(), z.unknown()), {
      method: 'POST',
    }),

  resetStudentBinding: (data: { student_id?: number; roll_number?: string; sap_id?: string; reason?: string; notes?: string }) =>
    api('/api/v1/binding/admin/reset-student-binding', z.record(z.string(), z.unknown()), {
      method: 'POST',
      body: JSON.stringify({
        ...data,
        reason: data.reason || 'ADMIN_RESET'
      }),
    }),
};

