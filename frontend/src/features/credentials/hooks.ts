import { useMutation, useQueryClient } from '@tanstack/react-query';
import { onboardingEndpoints } from '../../core/api/endpoints/onboarding';
import { invalidateFor } from '../../core/api/invalidation';

export const useDispatchCredentialsMutation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: onboardingEndpoints.dispatchCredentials,
    onSettled: () => invalidateFor(qc, 'onboarding.dispatchCredentials'),
  });
};
