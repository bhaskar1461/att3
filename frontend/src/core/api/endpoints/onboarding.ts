import { z } from 'zod';
import { api } from '../client';
import { s } from '../schemas';
import type { DispatchOnboardingRequest } from '../schemas/onboarding';

export const onboardingEndpoints = {
  getStatus: (page?: number, pageSize?: number) => {
    const qp = new URLSearchParams();
    if (page) qp.set('page', String(page));
    if (pageSize) qp.set('page_size', String(pageSize));
    const query = qp.toString() ? `?${qp.toString()}` : '';
    return api(`/api/v1/admin/onboard/status${query}`, s.OnboardingStatusResponseSchema);
  },

  dispatchLinks: (data: DispatchOnboardingRequest) =>
    api('/api/v1/admin/onboard/dispatch-links', s.DispatchOnboardingResponseSchema, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  resendLink: (rollNumber: string) =>
    api(`/api/v1/admin/onboard/resend/${encodeURIComponent(rollNumber)}`, z.record(z.string(), z.unknown()), {
      method: 'POST',
    }),

  listRebindRequests: () =>
    api('/api/v1/admin/onboard/rebind-requests', s.RebindRequestsListSchema),

  approveRebind: (requestId: number) =>
    api(`/api/v1/admin/onboard/rebind/${requestId}/approve`, z.record(z.string(), z.unknown()), {
      method: 'POST',
    }),

  denyRebind: (requestId: number) =>
    api(`/api/v1/admin/onboard/rebind/${requestId}/deny`, z.record(z.string(), z.unknown()), {
      method: 'POST',
    }),

  dispatchCredentials: (data: { section_id?: number; department_id?: number; roll_numbers?: string[] }) =>
    api('/api/v1/admin/credentials/dispatch', z.record(z.string(), z.unknown()), {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};
