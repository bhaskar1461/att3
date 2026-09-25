import { z } from 'zod';

export const SingleScanItemSchema = z.object({
  session_id: z.number(),
  qr_payload: z.string(),
  period_count: z.number().optional().default(4),
  scanned_at: z.string().optional().nullable(),
  allow_makeup: z.boolean().optional().default(false),
});
export type SingleScanItem = z.infer<typeof SingleScanItemSchema>;

export const BatchScanRequestSchema = z.object({
  scans: z.array(SingleScanItemSchema),
});
export type BatchScanRequest = z.infer<typeof BatchScanRequestSchema>;

export const BatchScanResultItemSchema = z.object({
  roll_number: z.string().optional().nullable(),
  status: z.string(),
  message: z.string().optional().nullable(),
  student_name: z.string().optional().nullable(),
}).passthrough();
export type BatchScanResultItem = z.infer<typeof BatchScanResultItemSchema>;

export const BatchScanResponseSchema = z.object({
  status: z.string(),
  processed_count: z.number(),
  results: z.array(BatchScanResultItemSchema).default([]),
});
export type BatchScanResponse = z.infer<typeof BatchScanResponseSchema>;

export const SyncStatusSchema = z.object({
  pending_count: z.number().default(0),
  last_sync_time: z.string().optional().nullable(),
  is_online: z.boolean().default(true),
  failed_count: z.number().default(0),
});
export type SyncStatus = z.infer<typeof SyncStatusSchema>;
