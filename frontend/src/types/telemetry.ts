/**
 * SNIST ERP — QR Scan Funnel Telemetry Types
 * Week 1: Instrumentation & Forensics Layer
 *
 * PRIME DIRECTIVE: Zero PII. Telemetry measures pipeline stages and device tiers, never student identities.
 */

export type FunnelStage =
  | 'scan_page_opened'
  | 'camera_permission_requested'
  | 'camera_permission_result'
  | 'camera_opened'
  | 'first_frame_captured'
  | 'frame_decoded'
  | 'token_submitted'
  | 'server_response'
  | 'attendance_confirmed';

export type FailureErrorType =
  | 'permission_denied'
  | 'camera_unavailable'
  | 'camera_open_timeout'
  | 'decode_timeout'       // >15s without successful decode
  | 'token_expired'
  | 'device_binding_403'
  | 'rate_limited'
  | 'server_5xx'
  | 'network_error'
  | 'wasm_or_jsqr_crash';   // Future-proofing for W4 WASM

export type DeviceBucket = 'old' | 'mid' | 'new';

export type DisplayType = 'projector' | 'phone_screen' | 'laptop';

export type TokenFormat = 'legacy' | 'short';

export type TelemetryEventType =
  | FunnelStage
  | 'scan_failed'
  | 'scan_retried'
  | 'manual_search_used'
  | 'manual_mark_created'
  | 'decode_duration_histogram';

export interface ScanTelemetryEvent {
  event_type: TelemetryEventType;
  stage?: FunnelStage;
  error_type?: FailureErrorType;
  device_bucket: DeviceBucket;
  display_type?: DisplayType;
  token_format?: TokenFormat;
  duration_ms?: number;
  decode_duration_ms?: number;
  session_id?: string;
  app_version?: string;
  ts: number; // Client timestamp in epoch ms
  details?: Record<string, any>;
}

export interface TelemetryBatchPayload {
  events: ScanTelemetryEvent[];
  sent_at: number;
}
