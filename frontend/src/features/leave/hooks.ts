import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { leaveApi } from './api';
import { LeaveAction, LeaveRequest } from './schemas';
import { setBadge } from '../../core/badges';

export const leaveKeys = {
  all: ['leave'] as const,
  list: () => [...leaveKeys.all, 'list'] as const,
};

export function useLeaveRequestsQuery() {
  const query = useQuery<LeaveRequest[], Error>({
    queryKey: leaveKeys.list(),
    queryFn: leaveApi.fetchLeaveRequests,
    staleTime: 30000,
  });

  useEffect(() => {
    if (query.data) {
      const pendingCount = query.data.filter((r) => r.status === 'pending').length;
      setBadge('leave-open-count', pendingCount);
    }
  }, [query.data]);

  return query;
}

export function useActOnLeaveMutation() {
  const queryClient = useQueryClient();

  return useMutation<LeaveRequest, Error, LeaveAction>({
    mutationFn: (action: LeaveAction) => leaveApi.actOnLeaveRequest(action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: leaveKeys.all });
    },
  });
}
