import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { keys } from '../../core/api/keys';
import { onboardingEndpoints } from '../../core/api/endpoints/onboarding';
import { invalidateFor } from '../../core/api/invalidation';
import type { OnboardingStatusResponse } from '../../core/api/schemas/onboarding';

export interface PollingOptions {
  pollMs?: number;
}

export const useOnboardingStatusQuery = (page?: number, pageSize?: number, opts?: PollingOptions) => {
  return useQuery({
    queryKey: keys.onboarding.status(page, pageSize),
    queryFn: () => onboardingEndpoints.getStatus(page, pageSize),
    refetchInterval: opts?.pollMs,
  });
};

export const useOnboardingRebindRequestsQuery = (opts?: PollingOptions) => {
  return useQuery({
    queryKey: keys.onboarding.rebindRequests(),
    queryFn: onboardingEndpoints.listRebindRequests,
    refetchInterval: opts?.pollMs,
  });
};

export const useOnboardingDispatchLinksMutation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: onboardingEndpoints.dispatchLinks,
    onSettled: () => invalidateFor(qc, 'onboarding.dispatchLinks'),
  });
};

export const useOnboardingResendLinkMutation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: onboardingEndpoints.resendLink,
    onSettled: () => invalidateFor(qc, 'onboarding.resendLink'),
  });
};

export const useOnboardingApproveRebindMutation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: onboardingEndpoints.approveRebind,
    onSettled: () => invalidateFor(qc, 'onboarding.approveRebind'),
  });
};

export const useOnboardingDenyRebindMutation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: onboardingEndpoints.denyRebind,
    onSettled: () => invalidateFor(qc, 'onboarding.denyRebind'),
  });
};

export const useOnboardingDispatchCredentialsMutation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: onboardingEndpoints.dispatchCredentials,
    onSettled: () => invalidateFor(qc, 'onboarding.dispatchCredentials'),
  });
};

// Pure testable selectors
export const selectPendingOnboardingCount = (res: OnboardingStatusResponse | undefined): number => {
  if (!res?.students) return 0;
  return res.students.filter((s) => s.onboarding_state === 'PENDING_ONBOARDING').length;
};

export const selectActivatedCount = (res: OnboardingStatusResponse | undefined): number => {
  if (!res?.students) return 0;
  return res.students.filter((s) => s.onboarding_state === 'ACTIVATED').length;
};
