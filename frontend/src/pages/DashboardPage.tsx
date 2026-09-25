import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DashboardShell } from '../components/dashboard/DashboardShell';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 60000,
    },
  },
});

export const DashboardPage: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <DashboardShell />
    </QueryClientProvider>
  );
};
