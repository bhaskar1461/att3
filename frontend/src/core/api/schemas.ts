import { z } from 'zod';

export const StudentSchema = z.object({
  id: z.number(),
  roll_number: z.string(),
  name: z.string(),
  department: z.string(),
  year: z.string(),
  section: z.string(),
  email: z.string().optional().nullable(),
  mobile: z.string().optional().nullable(),
  sap_id: z.string().optional().nullable(),
});
export type Student = z.infer<typeof StudentSchema>;

export const RegisterRowSchema = z.object({
  roll_number: z.string(),
  student_name: z.string(),
  department: z.string(),
  section: z.string(),
  attendance_status: z.string(),
  verified_at: z.string().optional().nullable(),
  verification_method: z.string().optional().nullable(),
});
export type RegisterRow = z.infer<typeof RegisterRowSchema>;

export const AlertItemSchema = z.object({
  id: z.union([z.string(), z.number()]),
  title: z.string(),
  message: z.string(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  timestamp: z.string(),
  resolved: z.boolean().default(false),
  sap_id: z.string().optional().nullable(),
});
export type AlertItem = z.infer<typeof AlertItemSchema>;

export const SessionRowSchema = z.object({
  session_id: z.number(),
  subject_name: z.string(),
  subject_code: z.string().optional().nullable(),
  section_name: z.string(),
  period: z.string(),
  session_date: z.string(),
  status: z.enum(['OPEN', 'LOCKED']),
  total_students: z.number(),
  present_count: z.number().optional().nullable(),
});
export type SessionRow = z.infer<typeof SessionRowSchema>;
