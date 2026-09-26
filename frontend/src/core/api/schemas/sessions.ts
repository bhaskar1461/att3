import { z } from 'zod';

export const TeacherAssignedClassSchema = z.object({
  assignment_id: z.number(),
  subject_id: z.number(),
  subject_code: z.string().optional().nullable(),
  subject_name: z.string(),
  section_id: z.number(),
  section_name: z.string(),
  department: z.string().optional().nullable(),
  year: z.string().optional().nullable(),
  excel_file_name: z.string().optional().nullable(),
  has_excel_register: z.boolean().default(false),
  google_sheet_id: z.string().optional().nullable(),
  google_sheet_url: z.string().optional().nullable(),
});
export type TeacherAssignedClass = z.infer<typeof TeacherAssignedClassSchema>;

export const TeacherAssignedClassesListSchema = z.array(TeacherAssignedClassSchema);
export type TeacherAssignedClassesList = z.infer<typeof TeacherAssignedClassesListSchema>;

export const HistoricalSessionSchema = z.object({
  session_id: z.number(),
  subject_id: z.number().optional().nullable(),
  subject_name: z.string(),
  subject_code: z.string().optional().nullable(),
  section_id: z.number().optional().nullable(),
  section_name: z.string(),
  period: z.string(),
  period_count: z.number().optional().nullable(),
  session_date: z.string(),
  status: z.enum(['OPEN', 'LOCKED', 'CLOSED']),
  total_students: z.number(),
  present_count: z.number().optional().nullable(),
  manual_count: z.number().optional().nullable(),
  manual_pct: z.number().optional().nullable(),
  absent_count: z.number().optional().nullable(),
  created_at: z.string().optional().nullable(),
});
export type HistoricalSession = z.infer<typeof HistoricalSessionSchema>;

export const HistoricalSessionsListSchema = z.array(HistoricalSessionSchema);
export type HistoricalSessionsList = z.infer<typeof HistoricalSessionsListSchema>;

export const StartSessionRequestSchema = z.object({
  subject_id: z.number(),
  section_id: z.number(),
  period: z.string().default('Period 1'),
  duration_minutes: z.number().optional().nullable(),
});
export type StartSessionRequest = z.infer<typeof StartSessionRequestSchema>;

export const StartSessionResponseSchema = z.object({
  session_id: z.number(),
  status: z.string(),
  subject_name: z.string().optional().nullable(),
  section_name: z.string().optional().nullable(),
  qr_token: z.string().optional().nullable(),
  broadcast_token: z.string().optional().nullable(),
}).passthrough();
export type StartSessionResponse = z.infer<typeof StartSessionResponseSchema>;

export const BroadcastTokenResponseSchema = z.object({
  session_id: z.number().optional().nullable(),
  token: z.string().optional().nullable(),
  broadcast_token: z.string().optional().nullable(),
  remaining_seconds: z.number().optional().nullable(),
  expires_in: z.number().optional().nullable(),
  status: z.string().optional().nullable(),
}).passthrough();
export type BroadcastTokenResponse = z.infer<typeof BroadcastTokenResponseSchema>;
