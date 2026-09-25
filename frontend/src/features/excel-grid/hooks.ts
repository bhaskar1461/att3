import { useQuery } from '@tanstack/react-query';
import { api } from '../../core/api/client';
import { z } from 'zod';

export interface PollingOptions {
  pollMs?: number;
}

export const ClassAssignmentItemSchema = z.object({
  id: z.number().optional().nullable(),
  assignment_id: z.number().optional().nullable(),
  subject_name: z.string().optional().nullable(),
  section_name: z.string().optional().nullable(),
}).passthrough();

export const useClassRegistersQuery = (opts?: PollingOptions) => {
  return useQuery({
    queryKey: ['excel-grid', 'assignments'],
    queryFn: () =>
      api('/api/v1/admin/assignments', z.union([z.array(ClassAssignmentItemSchema), z.record(z.string(), z.unknown())]))
        .catch(() => []),
    refetchInterval: opts?.pollMs,
  });
};
