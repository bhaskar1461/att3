import { z } from 'zod';

export const LowAttendanceStudentSchema = z.object({
  student_id: z.number(),
  roll_number: z.string(),
  student_name: z.string(),
  department: z.string().optional().nullable(),
  section: z.string().optional().nullable(),
  total_classes: z.number(),
  attended: z.number(),
  percentage: z.number(),
});
export type LowAttendanceStudent = z.infer<typeof LowAttendanceStudentSchema>;

export const LowAttendanceListSchema = z.array(LowAttendanceStudentSchema);
export type LowAttendanceList = z.infer<typeof LowAttendanceListSchema>;

export const ClassSheetMatrixRowSchema = z.object({
  sno: z.number().optional().nullable(),
  student_id: z.number(),
  roll_number: z.string(),
  name: z.string(),
  department: z.string().optional().nullable(),
  section: z.string().optional().nullable(),
  daily_status: z.record(z.string(), z.string()).default({}),
  total_sessions: z.number(),
  present_count: z.number(),
  absent_count: z.number(),
  percentage: z.number(),
});
export type ClassSheetMatrixRow = z.infer<typeof ClassSheetMatrixRowSchema>;

export const ClassSheetMatrixSchema = z.object({
  dates: z.array(z.string()).default([]),
  rows: z.array(ClassSheetMatrixRowSchema).default([]),
  total_students: z.number(),
  total_dates: z.number(),
});
export type ClassSheetMatrix = z.infer<typeof ClassSheetMatrixSchema>;

export const ExportReportParamsSchema = z.object({
  section_id: z.number().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  format: z.enum(['csv', 'excel', 'pdf']).default('csv'),
});
export type ExportReportParams = z.infer<typeof ExportReportParamsSchema>;
