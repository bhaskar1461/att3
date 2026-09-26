import { z } from 'zod';

export const OnboardingStudentSchema = z
  .object({
    student_id: z.union([z.number(), z.string()]).optional().nullable(),
    id: z.union([z.number(), z.string()]).optional().nullable(),
    roll_number: z.string(),
    name: z.string(),
    department: z.string().optional().nullable(),
    section: z.string().optional().nullable(),
    email: z.string().optional().nullable(),
    mobile: z.string().optional().nullable(),
    onboarding_state: z.string().optional().nullable(),
    state: z.string().optional().nullable(),
    magic_link_sent_at: z.string().optional().nullable(),
    link_sent_at: z.string().optional().nullable(),
    link_opened_at: z.string().optional().nullable(),
    activated_at: z.string().optional().nullable(),
    otp_verified: z.boolean().optional().nullable(),
    pin_set: z.boolean().optional().nullable(),
    device_uuid: z.string().optional().nullable(),
    rebind_count: z.number().optional().nullable(),
    batch_ref: z.string().optional().nullable(),
  })
  .passthrough()
  .transform((item) => {
    const rawId = item.student_id ?? item.id ?? 0;
    const student_id = typeof rawId === 'string' ? parseInt(rawId, 10) || 0 : rawId;
    const stateVal = item.onboarding_state || item.state || 'PENDING_ONBOARDING';
    const linkSent = item.magic_link_sent_at ?? item.link_sent_at ?? null;
    return {
      ...item,
      student_id,
      id: student_id,
      onboarding_state: stateVal,
      state: stateVal,
      magic_link_sent_at: linkSent,
      link_sent_at: linkSent,
    };
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
