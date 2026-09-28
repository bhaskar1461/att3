/**
 * SNIST ERP — Scanner Finite State Machine (FSM)
 * Specification v2 — FIX-6 & FIX-1
 *
 * States and transitions:
 * IDLE -> CAMERA_READY -> SCANNING
 * SCANNING -> QR_VALIDATED -> LINK_CHECK
 * SCANNING -> QR_INVALID -> ERROR
 * LINK_CHECK -> LINK_UNBOUND_OR_LEGACY -> ENROLLING
 * LINK_CHECK -> LINK_V2_CONFIRMED -> SUBMITTING
 * ENROLLING -> TICKET_ISSUED -> OTP_VERIFY
 * ENROLLING -> ENROLL_FAILED -> ERROR
 * OTP_VERIFY -> OTP_VERIFIED -> SUBMITTING
 * OTP_VERIFY -> OTP_RESEND -> OTP_VERIFY
 * OTP_VERIFY -> OTP_FAILED -> ERROR
 * SUBMITTING -> SUBMIT_SUCCESS -> SUCCESS
 * SUBMITTING -> SUBMIT_FAILED -> ERROR
 * ERROR -> RETRY / DISMISS -> SCANNING
 * SUCCESS -> NEXT_SCAN -> SCANNING
 *
 * Invariants:
 * - Single-flight: One active transition/action at a time.
 * - ERROR always carries a reason from Section 3.1.
 * - SUBMITTING tracks staged progress: validating_token -> signing -> submitting -> confirming.
 * - Persistence to sessionStorage. Resume on remount only for SUBMITTING/OTP_VERIFY with valid payload.
 */

export type ScannerState =
  | 'IDLE'
  | 'SCANNING'
  | 'LINK_CHECK'
  | 'ENROLLING'
  | 'OTP_VERIFY'
  | 'SUBMITTING'
  | 'SUCCESS'
  | 'ERROR';

export type SubmittingStage =
  | 'validating_token'
  | 'signing'
  | 'submitting'
  | 'confirming';

export type ErrorCode =
  | 'client_abort'
  | 'server_token_expired'
  | 'binding_upgrade_required'
  | 'no_active_binding'
  | 'device_replaced'
  | 'binding_revoked_post_grace'
  | 'qr_type_invalid'
  | 'qr_expired'
  | 'session_not_active'
  | 'otp_cooldown'
  | 'otp_delivery_failed'
  | 'selfie_store_failed'
  | 'job_not_found'
  | 'network_error'
  | 'camera_error'
  | 'generic_error';

export interface ScannerErrorInfo {
  code: ErrorCode;
  message: string;
  primaryAction: string;
  secondaryAction?: string;
  requestId?: string;
  retryAfterSeconds?: number;
}

export interface CanonicalQrPayload {
  v: number; // 2
  qr_type: 'live_session' | 'frequency_extended';
  session_id: string | number;
  token: string;
  issued_at: number; // ms
  exp: number; // ms
}

export interface CachedQrPayload {
  payload: CanonicalQrPayload | { token: string; [key: string]: any };
  captured_at: number; // ms
}

export interface EnrollmentTicketInfo {
  ticket: string;
  expires_at: string;
  grace_until?: string;
  masked_recipient?: string;
}

export interface FsmContext {
  state: ScannerState;
  submittingStage?: SubmittingStage;
  errorInfo?: ScannerErrorInfo;
  cachedPayload?: CachedQrPayload;
  enrollmentTicket?: EnrollmentTicketInfo;
  successData?: any;
  isActionInFlight: boolean;
  updatedAt: number;
}

export type ScannerEvent =
  | { type: 'CAMERA_READY' }
  | { type: 'QR_VALIDATED'; payload: CanonicalQrPayload | { token: string; [key: string]: any } }
  | { type: 'QR_INVALID'; error: ScannerErrorInfo }
  | { type: 'LINK_UNBOUND_OR_LEGACY'; ticket?: EnrollmentTicketInfo }
  | { type: 'LINK_V2_CONFIRMED' }
  | { type: 'SET_SUBMITTING_STAGE'; stage: SubmittingStage }
  | { type: 'TICKET_ISSUED'; ticket: EnrollmentTicketInfo }
  | { type: 'ENROLL_FAILED'; error: ScannerErrorInfo }
  | { type: 'ENROLLED' }
  | { type: 'OTP_RESEND' }
  | { type: 'OTP_VERIFIED' }
  | { type: 'OTP_FAILED'; error: ScannerErrorInfo }
  | { type: 'SUBMIT_SUCCESS'; result: any }
  | { type: 'SUBMIT_FAILED'; error: ScannerErrorInfo }
  | { type: 'RETRY' }
  | { type: 'DISMISS' }
  | { type: 'NEXT_SCAN' }
  | { type: 'TOKEN_EXPIRED' }
  | { type: 'SET_IN_FLIGHT'; inFlight: boolean };

const SESSION_STORAGE_KEY = 'snist_scanner_fsm_state';
const PAYLOAD_VALIDITY_TTL_MS = 30000; // 30s

/**
 * Standard Section 3.1 error descriptions and actions
 */
export const ERROR_CODE_TAXONOMY: Record<ErrorCode, { message: string; primary: string; secondary?: string }> = {
  client_abort: {
    message: 'Taking longer than usual',
    primary: 'Retry submit',
    secondary: 'Rescan QR'
  },
  server_token_expired: {
    message: 'Session expired — sign in again',
    primary: 'Re-login'
  },
  binding_upgrade_required: {
    message: 'One-time device security upgrade',
    primary: 'Enroll now',
    secondary: 'Later'
  },
  no_active_binding: {
    message: 'Device not enrolled — enroll to mark attendance',
    primary: 'Enroll now',
    secondary: 'Later'
  },
  device_replaced: {
    message: 'Device replaced — move attendance to this phone',
    primary: 'Move attendance here',
    secondary: 'Later'
  },
  binding_revoked_post_grace: {
    message: 'This device must be re-enrolled',
    primary: 'Re-enroll',
    secondary: 'Contact support'
  },
  qr_type_invalid: {
    message: 'Wrong QR — scan the live session QR',
    primary: 'Rescan'
  },
  qr_expired: {
    message: 'QR expired — rescan',
    primary: 'Rescan'
  },
  session_not_active: {
    message: 'Session ended server-side',
    primary: 'Rescan'
  },
  otp_cooldown: {
    message: 'Resend too soon; please wait',
    primary: 'Wait'
  },
  otp_delivery_failed: {
    message: 'Code not delivered',
    primary: 'Resend email',
    secondary: 'Send SMS'
  },
  selfie_store_failed: {
    message: "Photo didn't save",
    primary: 'Retry upload'
  },
  job_not_found: {
    message: 'Attendance verification expired',
    primary: 'Rescan QR'
  },
  network_error: {
    message: 'No connection',
    primary: 'Retry'
  },
  camera_error: {
    message: 'Camera unavailable',
    primary: 'Retry'
  },
  generic_error: {
    message: 'An unexpected error occurred',
    primary: 'Retry'
  }
};

export function buildErrorInfo(
  code: ErrorCode,
  overrideMessage?: string,
  requestId?: string,
  retryAfterSeconds?: number
): ScannerErrorInfo {
  const meta = ERROR_CODE_TAXONOMY[code] || ERROR_CODE_TAXONOMY.generic_error;
  return {
    code,
    message: overrideMessage || meta.message,
    primaryAction: meta.primary,
    secondaryAction: meta.secondary,
    requestId,
    retryAfterSeconds
  };
}

/**
 * Validate cached payload freshness (valid for <= 30s and exp > now)
 */
export function isCachedPayloadValid(cached?: CachedQrPayload): boolean {
  if (!cached || !cached.payload) return false;
  const now = Date.now();
  if (now - cached.captured_at > PAYLOAD_VALIDITY_TTL_MS) {
    return false;
  }
  const exp = (cached.payload as any).exp;
  if (exp && exp <= now) {
    return false;
  }
  return true;
}

/**
 * Persist context to sessionStorage
 */
export function persistFsmContext(ctx: FsmContext) {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify({
          state: ctx.state,
          cachedPayload: ctx.cachedPayload,
          enrollmentTicket: ctx.enrollmentTicket,
          updatedAt: ctx.updatedAt
        })
      );
    }
  } catch {}
}

/**
 * Load initial context from sessionStorage on mount
 */
export function getInitialFsmContext(): FsmContext {
  const defaultCtx: FsmContext = {
    state: 'IDLE',
    isActionInFlight: false,
    updatedAt: Date.now()
  };

  try {
    if (typeof sessionStorage !== 'undefined') {
      const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (
          (parsed.state === 'SUBMITTING' || parsed.state === 'OTP_VERIFY') &&
          isCachedPayloadValid(parsed.cachedPayload)
        ) {
          return {
            ...defaultCtx,
            state: parsed.state,
            cachedPayload: parsed.cachedPayload,
            enrollmentTicket: parsed.enrollmentTicket,
            updatedAt: parsed.updatedAt || Date.now()
          };
        }
      }
    }
  } catch {}

  return defaultCtx;
}

/**
 * Pure transition function
 */
export function scannerFsmReducer(ctx: FsmContext, event: ScannerEvent | { type: string; [key: string]: any } | string): FsmContext {
  const now = Date.now();
  const evt: any = typeof event === 'string' ? { type: event } : event;

  // In-flight action guard: Reject event if another action is currently in flight
  if (
    ctx.isActionInFlight &&
    evt.type !== 'SET_IN_FLIGHT' &&
    evt.type !== 'SET_SUBMITTING_STAGE' &&
    evt.type !== 'SUBMIT_SUCCESS' &&
    evt.type !== 'SUBMIT_FAILED' &&
    evt.type !== 'ENROLL_FAILED' &&
    evt.type !== 'ENROLLED' &&
    evt.type !== 'LINK_UNBOUND_OR_LEGACY' &&
    evt.type !== 'TOKEN_EXPIRED' &&
    evt.type !== 'TICKET_ISSUED' &&
    evt.type !== 'OTP_FAILED' &&
    evt.type !== 'OTP_VERIFIED'
  ) {
    console.warn(`[ScannerFSM] Rejected event ${evt.type} while action in flight from state ${ctx.state}`);
    return ctx;
  }

  switch (evt.type) {
    case 'SET_IN_FLIGHT':
      return {
        ...ctx,
        isActionInFlight: evt.inFlight,
        updatedAt: now
      };

    case 'CAMERA_READY':
      if (ctx.state === 'IDLE') {
        const next: FsmContext = {
          ...ctx,
          state: 'SCANNING',
          errorInfo: undefined,
          updatedAt: now
        };
        persistFsmContext(next);
        return next;
      }
      return ctx;

    case 'QR_VALIDATED':
      if (ctx.state === 'SCANNING') {
        const next: FsmContext = {
          ...ctx,
          state: 'LINK_CHECK',
          cachedPayload: {
            payload: evt.payload,
            captured_at: now
          },
          errorInfo: undefined,
          updatedAt: now
        };
        persistFsmContext(next);
        return next;
      }
      return ctx;

    case 'QR_INVALID':
      if (ctx.state === 'SCANNING') {
        const next: FsmContext = {
          ...ctx,
          state: 'ERROR',
          errorInfo: evt.error,
          updatedAt: now
        };
        persistFsmContext(next);
        return next;
      }
      return ctx;

    case 'LINK_UNBOUND_OR_LEGACY': {
      const next: FsmContext = {
        ...ctx,
        state: 'ENROLLING',
        enrollmentTicket: evt.ticket,
        isActionInFlight: false,
        updatedAt: now
      };
      persistFsmContext(next);
      return next;
    }

    case 'TOKEN_EXPIRED': {
      const next: FsmContext = {
        ...ctx,
        state: 'ERROR',
        errorInfo: buildErrorInfo('qr_expired', 'QR expired — rescan'),
        isActionInFlight: false,
        updatedAt: now
      };
      persistFsmContext(next);
      return next;
    }

    case 'ENROLLED':
      if (ctx.state === 'ENROLLING' || ctx.state === 'OTP_VERIFY') {
        if (isCachedPayloadValid(ctx.cachedPayload)) {
          const next: FsmContext = {
            ...ctx,
            state: 'SUBMITTING',
            submittingStage: 'submitting',
            isActionInFlight: false,
            updatedAt: now
          };
          persistFsmContext(next);
          return next;
        } else {
          const next: FsmContext = {
            ...ctx,
            state: 'ERROR',
            errorInfo: buildErrorInfo('qr_expired', 'QR expired — rescan'),
            isActionInFlight: false,
            updatedAt: now
          };
          persistFsmContext(next);
          return next;
        }
      }
      return ctx;

    case 'LINK_V2_CONFIRMED':
      if (ctx.state === 'LINK_CHECK') {
        const next: FsmContext = {
          ...ctx,
          state: 'SUBMITTING',
          submittingStage: 'validating_token',
          updatedAt: now
        };
        persistFsmContext(next);
        return next;
      }
      return ctx;

    case 'SET_SUBMITTING_STAGE':
      if (ctx.state === 'SUBMITTING') {
        return {
          ...ctx,
          submittingStage: evt.stage,
          updatedAt: now
        };
      }
      return ctx;

    case 'TICKET_ISSUED':
      if (ctx.state === 'ENROLLING') {
        const next: FsmContext = {
          ...ctx,
          state: 'OTP_VERIFY',
          enrollmentTicket: evt.ticket,
          updatedAt: now
        };
        persistFsmContext(next);
        return next;
      }
      return ctx;

    case 'ENROLL_FAILED':
      if (ctx.state === 'ENROLLING') {
        const next: FsmContext = {
          ...ctx,
          state: 'ERROR',
          errorInfo: evt.error,
          isActionInFlight: false,
          updatedAt: now
        };
        persistFsmContext(next);
        return next;
      }
      return ctx;

    case 'OTP_RESEND':
      if (ctx.state === 'OTP_VERIFY') {
        return {
          ...ctx,
          updatedAt: now
        };
      }
      return ctx;

    case 'OTP_VERIFIED':
      if (ctx.state === 'OTP_VERIFY') {
        // Resume submission with cached payload if valid
        if (isCachedPayloadValid(ctx.cachedPayload)) {
          const next: FsmContext = {
            ...ctx,
            state: 'SUBMITTING',
            submittingStage: 'submitting',
            isActionInFlight: false,
            updatedAt: now
          };
          persistFsmContext(next);
          return next;
        } else {
          const next: FsmContext = {
            ...ctx,
            state: 'ERROR',
            errorInfo: buildErrorInfo('qr_expired', 'QR expired — rescan'),
            isActionInFlight: false,
            updatedAt: now
          };
          persistFsmContext(next);
          return next;
        }
      }
      return ctx;

    case 'OTP_FAILED':
      if (ctx.state === 'OTP_VERIFY') {
        const next: FsmContext = {
          ...ctx,
          state: 'ERROR',
          errorInfo: evt.error,
          isActionInFlight: false,
          updatedAt: now
        };
        persistFsmContext(next);
        return next;
      }
      return ctx;

    case 'SUBMIT_SUCCESS':
      if (ctx.state === 'SUBMITTING') {
        const next: FsmContext = {
          ...ctx,
          state: 'SUCCESS',
          successData: evt.result,
          isActionInFlight: false,
          updatedAt: now
        };
        persistFsmContext(next);
        return next;
      }
      return ctx;

    case 'SUBMIT_FAILED':
      if (ctx.state === 'SUBMITTING') {
        const next: FsmContext = {
          ...ctx,
          state: 'ERROR',
          errorInfo: evt.error,
          isActionInFlight: false,
          updatedAt: now
        };
        persistFsmContext(next);
        return next;
      }
      return ctx;

    case 'RETRY':
      if (ctx.state === 'ERROR') {
        // Primary retry action
        const next: FsmContext = {
          ...ctx,
          state: 'SCANNING',
          errorInfo: undefined,
          isActionInFlight: false,
          updatedAt: now
        };
        persistFsmContext(next);
        return next;
      }
      return ctx;

    case 'DISMISS':
      if (ctx.state === 'ERROR') {
        const next: FsmContext = {
          ...ctx,
          state: 'SCANNING',
          errorInfo: undefined,
          isActionInFlight: false,
          updatedAt: now
        };
        persistFsmContext(next);
        return next;
      }
      return ctx;

    case 'NEXT_SCAN':
      if (ctx.state === 'SUCCESS') {
        const next: FsmContext = {
          ...ctx,
          state: 'SCANNING',
          successData: undefined,
          cachedPayload: undefined,
          isActionInFlight: false,
          updatedAt: now
        };
        persistFsmContext(next);
        return next;
      }
      return ctx;

    default:
      return ctx;
  }
}
