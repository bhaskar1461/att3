import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { keys } from '../../core/api/keys';
import { devicesEndpoints } from '../../core/api/endpoints/devices';
import { invalidateFor } from '../../core/api/invalidation';
import type { StudentDeviceInfo } from '../../core/api/schemas/devices';

export interface PollingOptions {
  pollMs?: number;
}

export const useDevicesStudentInfoQuery = (rollNumber: string, opts?: PollingOptions) => {
  return useQuery({
    queryKey: keys.devices.studentDeviceInfo(rollNumber),
    queryFn: () => devicesEndpoints.getStudentDeviceInfo(rollNumber),
    enabled: rollNumber.trim().length > 0,
    refetchInterval: opts?.pollMs,
  });
};

export const useDevicesBindingStatusQuery = (opts?: PollingOptions) => {
  return useQuery({
    queryKey: keys.devices.bindingStatus(),
    queryFn: devicesEndpoints.getBindingStatus,
    refetchInterval: opts?.pollMs,
  });
};

export const useDevicesRequestResetMutation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: devicesEndpoints.requestReset,
    onSettled: () => invalidateFor(qc, 'devices.requestReset'),
  });
};

export const useDevicesVerifyResetMutation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: devicesEndpoints.verifyReset,
    onSettled: () => invalidateFor(qc, 'devices.verifyReset'),
  });
};

export const useDevicesBulkResetMutation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: devicesEndpoints.bulkReset,
    onSettled: () => invalidateFor(qc, 'devices.bulkReset'),
  });
};

export const useDevicesRevokeBindingMutation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: devicesEndpoints.revokeBinding,
    onSettled: () => invalidateFor(qc, 'devices.revokeBinding'),
  });
};

// Pure testable selectors
export const selectHasActiveDevice = (info: StudentDeviceInfo | undefined): boolean => {
  return info?.has_registered_device ?? false;
};

export const selectRemainingResets = (info: StudentDeviceInfo | undefined): number => {
  if (!info) return 0;
  return Math.max(0, info.max_self_resets - info.self_resets_this_semester);
};
