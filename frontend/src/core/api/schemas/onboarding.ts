import { z } from 'zod';

export const OnboardingStudentSchema = z.object({
  student_id: z.number(),
  roll_number: z.string(),
  name: z.string(),
  department: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  mobile: z.string().optional().nullable(),
  onboarding_state: z.string(),
  magic_link_sent_at: z.string().optional().nullable(),
  activated_at: z.string().optional().nullable(),
});
export type OnboardingStudent = z.infer<typeof OnboardingStudentSchema>;

export const OnboardingStatusResponseSchema = z.object({
  total: z.number(),
  page: z.number().optional().nullable(),
  page_size: z.number().optional().nullable(),
  students: z.array(OnboardingStudentSchema).default([]),
});
export type OnboardingStatusResponse = z.infer<typeof OnboardingStatusResponseSchema>;

export const DispatchOnboardingRequestSchema = z.object({
  section_id: z.number().optional().nullable(),
  department_id: z.number().optional().nullable(),
  roll_numbers: z.array(z.string()).optional().nullable(),
  force_resend: z.boolean().default(false),
});
export type DispatchOnboardingRequest = z.infer<typeof DispatchOnboardingRequestSchema>;

export const DispatchOnboardingResponseSchema = z.object({
  success: z.boolean().default(true),
  dispatched_count: z.number().optional().nullable(),
  message: z.string().optional().nullable(),
  status: z.string().optional().nullable(),
}).passthrough();
export type DispatchOnboardingResponse = z.infer<typeof DispatchOnboardingResponseSchema>;

export const RebindRequestItemSchema = z.object({
  id: z.number().optional().nullable(),
  request_id: z.number().optional().nullable(),
  student_id: z.number().optional().nullable(),
  roll_number: z.string().optional().nullable(),
  student_name: z.string().optional().nullable(),
  reason: z.string().optional().nullable(),
  created_at: z.string().optional().nullable(),
  status: z.string().optional().nullable(),
}).passthrough();
export type RebindRequestItem = z.infer<typeof RebindRequestItemSchema>;

export const RebindRequestsListSchema = z.object({
  count: z.number().default(0),
  requests: z.array(RebindRequestItemSchema).default([]),
});
export type RebindRequestsList = z.infer<typeof RebindRequestsListSchema>;
