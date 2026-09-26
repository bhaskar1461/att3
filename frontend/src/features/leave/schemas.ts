import { z } from 'zod';

export const LeaveRequestSchema = z.object({
  id: z.string(),
  student_name: z.string(),
  roll_number: z.string(),
  department: z.string(),
  start_date: z.string(),
  end_date: z.string(),
  reason: z.string(),
  status: z.enum(['pending', 'approved', 'rejected']),
  created_at: z.string(),
});

export type LeaveRequest = z.infer<typeof LeaveRequestSchema>;

export const LeaveActionSchema = z.object({
  id: z.string(),
  action: z.enum(['approve', 'reject']),
  note: z.string().optional(),
});

export type LeaveAction = z.infer<typeof LeaveActionSchema>;
