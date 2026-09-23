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
  | 'attendance_confirmed'
  | 'attendance_queued_offline';

export type FailureErrorType =
  | 'permission_denied'
  | 'camera_unavailable'
  | 'camera_in_use'
  | 'camera_open_timeout'
  | 'insecure_origin'
  | 'decode_timeout'       // >15s without successful decode
  | 'token_expired'
  | 'device_binding_403'
  | 'rate_limited'
  | 'server_5xx'
  | 'network_error'
  | 'wasm_or_jsqr_crash'
  | 'multi_code_detected'
  | 'multi_qr_rejected'
  | 'engine_fallback';

export type DistanceBucket = '<=5m' | '5-10m' | '10-15m';

export type DeviceBucket = 'old' | 'mid' | 'new';

export type DisplayType = 'projector' | 'phone_screen' | 'laptop';

export type TokenFormat = 'legacy' | 'short';

export type TelemetryEventType =
  | FunnelStage
  | 'scan_failed'
  | 'scan_retried'
  | 'ladder_rung_transition'
  | 'manual_search_used'
  | 'manual_mark_created'
  | 'decode_duration_histogram';

export type ScannerEngine = 'jsqr' | 'wasm';

export interface ScanTelemetryEvent {
  event_type: TelemetryEventType;
  stage?: FunnelStage;
  error_type?: FailureErrorType;
  device_bucket: DeviceBucket;
  display_type?: DisplayType;
  token_format?: TokenFormat;
  render_version?: 'v1' | 'v2';
  engine?: ScannerEngine;
  distance_bucket?: DistanceBucket;
  decode_scale?: number;
  duration_ms?: number;
  decode_duration_ms?: number;
  session_id?: string;
  ladder_rung?: number;
  from_rung?: number;
  app_version?: string;
  ts: number; // Client timestamp in epoch ms
  details?: Record<string, any>;
}

export interface TelemetryBatchPayload {
  events: ScanTelemetryEvent[];
  sent_at: number;
}
