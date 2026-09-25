import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../core/auth/AuthProvider';
import { keys } from '../../core/api/keys';
import { authEndpoints } from '../../core/api/endpoints/auth';

export const useLoginMutation = () => {
  const { login } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      username,
      password,
      devicePublicId,
      deviceSecret,
    }: {
      username: string;
      password: string;
      devicePublicId?: string;
      deviceSecret?: string;
    }) => {
      return login(username, password, devicePublicId, deviceSecret);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.auth.all() });
    },
  });
};

export const useLogoutMutation = () => {
  const { logout } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      logout();
    },
    onSettled: () => {
      queryClient.clear();
    },
  });
};

export const useCurrentUserQuery = () => {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('access_token') : null;
  return useQuery({
    queryKey: keys.auth.me(),
    queryFn: authEndpoints.me,
    enabled: !!token,
  });
};
