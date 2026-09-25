import { z } from 'zod';

export const DashboardStatsSchema = z.object({
  total_students: z.number(),
  total_teachers: z.number(),
  total_departments: z.number(),
  present_today: z.number(),
  absent_today: z.number(),
  attendance_percentage: z.number(),
  active_live_classes: z.number(),
});
export type DashboardStats = z.infer<typeof DashboardStatsSchema>;

export const AttendanceRecordSchema = z.object({
  id: z.number(),
  student_id: z.number(),
  session_id: z.number(),
  status: z.string(),
  verification_method: z.string().optional().nullable(),
  verified_at: z.string().optional().nullable(),
  sap_id: z.string().optional().nullable(),
  created_at: z.string().optional().nullable(),
});
export type AttendanceRecord = z.infer<typeof AttendanceRecordSchema>;

export const StudentSubjectAttendanceSchema = z.object({
  subject_id: z.number().optional().nullable(),
  subject_name: z.string(),
  subject_code: z.string().optional().nullable(),
  total_classes: z.number(),
  attended: z.number(),
  percentage: z.number(),
});
export type StudentSubjectAttendance = z.infer<typeof StudentSubjectAttendanceSchema>;

export const StudentAttendanceSummarySchema = z.object({
  total_conducted: z.number(),
  total_present: z.number(),
  total_absent: z.number(),
  overall_percentage: z.number(),
  has_records: z.boolean(),
  subjects: z.array(StudentSubjectAttendanceSchema).default([]),
});
export type StudentAttendanceSummary = z.infer<typeof StudentAttendanceSummarySchema>;

export const ScanAttendanceRequestSchema = z.object({
  token: z.string(),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  device_id: z.string().optional().nullable(),
});
export type ScanAttendanceRequest = z.infer<typeof ScanAttendanceRequestSchema>;

export const ScanAttendanceResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  attendance_id: z.number().optional().nullable(),
  student_name: z.string().optional().nullable(),
  roll_number: z.string().optional().nullable(),
  status: z.string().optional().nullable(),
  requires_selfie: z.boolean().optional().nullable(),
}).passthrough();
export type ScanAttendanceResponse = z.infer<typeof ScanAttendanceResponseSchema>;

export const MarkAttendanceRequestSchema = z.object({
  session_id: z.number(),
  student_id: z.number(),
  status: z.enum(['PRESENT', 'ABSENT', 'LATE']),
  verification_method: z.string().optional().nullable(),
});
export type MarkAttendanceRequest = z.infer<typeof MarkAttendanceRequestSchema>;
