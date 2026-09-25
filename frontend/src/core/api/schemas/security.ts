import { z } from 'zod';

export const AuditLogItemSchema = z.object({
  id: z.number(),
  username: z.string(),
  action: z.string(),
  details: z.string().optional().nullable(),
  timestamp: z.string(),
  ip_address: z.string().optional().nullable(),
});
export type AuditLogItem = z.infer<typeof AuditLogItemSchema>;

export const AuditLogEnvelopeSchema = z.object({
  items: z.array(AuditLogItemSchema),
  total: z.number(),
  page: z.number().optional().nullable(),
  page_size: z.number().optional().nullable(),
  total_pages: z.number().optional().nullable(),
});
export type AuditLogEnvelope = z.infer<typeof AuditLogEnvelopeSchema>;

export const AuditLogListSchema = z.union([
  z.array(AuditLogItemSchema),
  AuditLogEnvelopeSchema,
]);
export type AuditLogList = z.infer<typeof AuditLogListSchema>;

export const ScannerHealthResponseSchema = z.object({
  timeframe_days: z.number(),
  device_filter: z.string().optional().nullable(),
  display_filter: z.string().optional().nullable(),
  headline: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  funnel: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  decode_histogram: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  failure_matrix: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  top_error: z.string().optional().nullable(),
  manual_path: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  ladder_usage: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
}).passthrough();
export type ScannerHealthResponse = z.infer<typeof ScannerHealthResponseSchema>;

export const TelemetrySummaryResponseSchema = z.object({
  timeframe_hours: z.number().optional(),
  total_events: z.number().optional(),
  events_by_type: z.record(z.string(), z.number()).optional(),
  platform_breakdown: z.record(z.string(), z.number()).optional(),
}).passthrough();
export type TelemetrySummaryResponse = z.infer<typeof TelemetrySummaryResponseSchema>;
