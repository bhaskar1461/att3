import { useState, useRef, useCallback, useEffect, useReducer } from 'react';
import { apiRequest } from '../../../services/api';
import { offlineSubmissionQueue } from '../../../services/offlineSubmissionQueue';
import { scannerTelemetry } from '../../../services/scannerTelemetry';
import { BINDING_V2_ENABLED, signChallenge, getBindingState, generateKeyPair, commitBindingRecord } from '../../../services/binding';
import { ScannerEngine } from '../../../services/qrEngine';
import { GeoCoordinates } from './useGeoVerification';
import { tokenLifecycleManager } from '../../../services/tokenLifecycle';
import {
  ScannerState,
  SubmittingStage,
  ScannerErrorInfo,
  EnrollmentTicketInfo,
  CanonicalQrPayload,
  CachedQrPayload,
  ScannerEvent,
  scannerFsmReducer,
  getInitialFsmContext,
  buildErrorInfo,
  isCachedPayloadValid
} from '../state/scannerFSM';

const SCAN_SUBMIT_TIMEOUT_MS = Number(import.meta.env.VITE_SCAN_SUBMIT_TIMEOUT_MS) || 8000;

async function computeIdempotencyKey(tokenStr: string, deviceId?: string): Promise<string> {
  const devId = deviceId || (typeof localStorage !== 'undefined' ? localStorage.getItem('snist_device_uuid') : null) || 'dev_client';
  try {
    const msgBuffer = new TextEncoder().encode(tokenStr);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    return `${devId}:${hashHex.slice(0, 16)}`;
  } catch {
    let hash = 0;
    for (let i = 0; i < tokenStr.length; i++) {
      hash = ((hash << 5) - hash) + tokenStr.charCodeAt(i);
      hash |= 0;
    }
    return `${devId}:${Math.abs(hash).toString(16).padStart(16, '0').slice(0, 16)}`;
  }
}

export type ScannerFlowState =
  | 'INITIALIZING'
  | 'IDLE_SCANNING'
  | 'DECODED'
  | 'ENROLLING'
  | 'REBIND_OTP'
  | 'SUBMITTING'
  | 'SUCCESS'
  | 'TIMEOUT'
  | 'STALE_QR'
  | 'RATE_LIMITED'
  | 'ERROR'
  | 'BLOCKED';

export interface ParsedQrPayload {
  token: string;
  sourceType: 'launch_url' | 'launch_path' | 'short_code' | 'legacy' | 'raw_token';
  canonical?: CanonicalQrPayload | { token: string; [key: string]: any };
  validationError?: 'qr_type_invalid' | 'qr_expired';
}

export interface NormalizedApiError {
  code: string;
  message: string;
  status?: number;
  details?: {
    ticket?: string | null;
    enrollment_ticket?: any;
    grace_until?: string;
    requestId?: string;
    retryAfter?: number;
    [key: string]: any;
  };
  raw?: any;
}

export function toApiError(err: unknown): NormalizedApiError {
  if (!err) {
    return { code: 'unknown', message: 'Unknown error occurred' };
  }
  const e = err as any;
  const status = e.status || e.response?.status;
  const rawData = e.data || e.response?.data;
  const detailObj = typeof e.detail === 'object' && e.detail !== null
    ? e.detail
    : (rawData?.detail && typeof rawData.detail === 'object' ? rawData.detail : null);

  const rawMsg = (
    (typeof e.detail === 'string' ? e.detail : null) ||
    detailObj?.message ||
    detailObj?.msg ||
    e.message ||
    ''
  );
  const lowerMsg = (typeof rawMsg === 'string' ? rawMsg : JSON.stringify(rawMsg)).toLowerCase();

  let code = (
    e.code ||
    e.error_code ||
    e.phase7_code ||
    detailObj?.code ||
    detailObj?.error_code ||
    detailObj?.phase7_code ||
    rawData?.code ||
    rawData?.error_code ||
    ''
  );

  if (!code) {
    if (status === 409 || lowerMsg.includes('upgrade') || lowerMsg.includes('security upgrade')) {
      code = 'binding_upgrade_required';
    } else if (status === 403 && (lowerMsg.includes('no_active_binding') || lowerMsg.includes('binding_required'))) {
      code = 'no_active_binding';
    } else if (status === 410 || lowerMsg.includes('re-enroll') || lowerMsg.includes('grace period')) {
      code = 'binding_revoked_post_grace';
    } else if (status === 401 || lowerMsg.includes('session expired') || lowerMsg.includes('token expired')) {
      code = 'server_token_expired';
    } else if (status === 422 || lowerMsg.includes('wrong qr')) {
      code = 'qr_type_invalid';
    } else if (status === 429 || lowerMsg.includes('too many') || lowerMsg.includes('cooldown')) {
      code = 'otp_cooldown';
    } else if (status === 502 || lowerMsg.includes('not delivered')) {
      code = 'otp_delivery_failed';
    } else if (lowerMsg.includes('photo') || lowerMsg.includes('selfie')) {
      code = 'selfie_store_failed';
    } else if (lowerMsg.includes('expired') || lowerMsg.includes('stale')) {
      code = 'qr_expired';
    } else if (lowerMsg.includes('session ended') || lowerMsg.includes('qr-session-end')) {
      code = 'session_not_active';
    } else if (!navigator.onLine || lowerMsg.includes('network') || lowerMsg.includes('failed to fetch')) {
      code = 'network_error';
    } else {
      code = 'unknown';
    }
  }

  // Normalize server code strings that contain embedded codes (e.g. "no_active_binding")
  if (code === 'no_active_binding' || (typeof code === 'string' && code.includes('no_active_binding'))) {
    code = 'no_active_binding';
  }

  const rawTicket = (
    e.enrollment_ticket ||
    detailObj?.enrollment_ticket ||
    rawData?.enrollment_ticket ||
    e.ticket ||
    detailObj?.ticket ||
    rawData?.ticket
  );

  let ticketStr: string | null = null;
  if (typeof rawTicket === 'string') {
    ticketStr = rawTicket;
  } else if (rawTicket && typeof rawTicket === 'object') {
    ticketStr = rawTicket.ticket || rawTicket.ticket_code || null;
  }
  if (!ticketStr && code === 'binding_upgrade_required') {
    ticketStr = 'et_inline';
  }

  const graceUntil = e.grace_until || detailObj?.grace_until || rawData?.grace_until;
  const requestId = e.request_id || e.requestId || detailObj?.request_id || rawData?.request_id;
  const retryAfter = e.retry_after || detailObj?.retry_after || rawData?.retry_after;

  return {
    code,
    message: rawMsg || (code === 'binding_upgrade_required' ? 'This device needs a one-time security upgrade.' : 'Something went wrong'),
    status,
    details: {
      ticket: ticketStr,
      enrollment_ticket: rawTicket,
      grace_until: graceUntil,
      requestId,
      retryAfter
    },
    raw: e
  };
}

function getJwtExpMs(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) b64 += '=';
    const payload = JSON.parse(atob(b64));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

export interface UseAttendanceSubmissionProps {
  studentRoll?: string;
  getStudentGeolocation: () => Promise<GeoCoordinates>;
  studentGeoRef: React.MutableRefObject<GeoCoordinates | null>;
  onScanComplete?: (result?: any) => void;
  onStopCamera: () => void;
  onGuideChange: (text: string) => void;
  onNextScanReady: () => void;
  isDebugMode?: boolean;
}

export function useAttendanceSubmission({
  studentRoll,
  getStudentGeolocation,
  studentGeoRef,
  onScanComplete,
  onStopCamera,
  onGuideChange,
  onNextScanReady,
  isDebugMode = false
}: UseAttendanceSubmissionProps) {
  const [fsmCtx, fsmDispatch] = useReducer(scannerFsmReducer, undefined, getInitialFsmContext);
  const [flowState, setFlowState] = useState<ScannerFlowState>('INITIALIZING');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanErrorCode, setScanErrorCode] = useState<string | null>(null);
  const [upgradeTicket, setUpgradeTicket] = useState<string | null>(null);
  const [successResult, setSuccessResult] = useState<any>(null);
  const [isInlineEnrolling, setIsInlineEnrolling] = useState<boolean>(false);


  // ONE canonical error interpreter: every catch site calls this
  const handleScanError = useCallback((err: unknown) => {
    const apiErr = toApiError(err);

    setIsSubmitting(false);
    isScanningLockedRef.current = false;
    inFlightTokenStrRef.current = null;

    switch (apiErr.code) {
      case 'binding_upgrade_required':
      case 'no_active_binding':
        // Both codes route to the same enrollment flow:
        // Preserve STRUCTURE — code + ticket, never a flattened string
        setScanErrorCode(apiErr.code);
        setScanError(null);
        setUpgradeTicket(apiErr.details?.ticket ?? null);
        fsmDispatch({
          type: 'LINK_UNBOUND_OR_LEGACY',
          ticket: apiErr.details?.enrollment_ticket || (apiErr.details?.ticket ? {
            ticket: apiErr.details.ticket,
            expires_at: new Date(Date.now() + 600000).toISOString(),
            grace_until: apiErr.details.grace_until
          } : undefined)
        });
        setFlowState('BLOCKED'); // Dismisses the spinner immediately!
        onGuideChange(apiErr.code === 'no_active_binding' ? 'Device not enrolled — enroll to continue' : 'One-time security upgrade required');
        return;

      case 'qr_expired':
        setScanErrorCode('qr_expired');
        setScanError(null);
        fsmDispatch({ type: 'TOKEN_EXPIRED' });
        setFlowState('BLOCKED');
        onGuideChange('QR expired — rescan');
        return;

      case 'client_abort':
        setScanErrorCode('client_abort');
        setScanError(null);
        fsmDispatch({ type: 'SUBMIT_FAILED', error: buildErrorInfo('client_abort') });
        setFlowState('TIMEOUT');
        onGuideChange('Taking longer than usual');
        return;

      case 'binding_revoked_post_grace':
        try {
          localStorage.removeItem('binding_status');
          localStorage.removeItem('binding_status_ts');
        } catch {}
        setScanErrorCode('binding_revoked_post_grace');
        setScanError(apiErr.message);
        fsmDispatch({
          type: 'SUBMIT_FAILED',
          error: buildErrorInfo('binding_revoked_post_grace', apiErr.message, apiErr.details?.requestId)
        });
        setFlowState('BLOCKED');
        onGuideChange('This device must be re-enrolled');
        return;

      case 'server_token_expired':
        setScanErrorCode('server_token_expired');
        setScanError(apiErr.message);
        fsmDispatch({ type: 'SUBMIT_FAILED', error: buildErrorInfo('server_token_expired', apiErr.message) });
        setFlowState('ERROR');
        onGuideChange('Session expired — sign in again');
        return;

      case 'qr_type_invalid':
        setScanErrorCode('qr_type_invalid');
        setScanError(apiErr.message);
        fsmDispatch({ type: 'SUBMIT_FAILED', error: buildErrorInfo('qr_type_invalid') });
        setFlowState('ERROR');
        onGuideChange('Wrong QR — scan the live session QR');
        return;

      case 'session_not_active':
        setScanErrorCode('session_not_active');
        setScanError(apiErr.message);
        fsmDispatch({ type: 'SUBMIT_FAILED', error: buildErrorInfo('session_not_active') });
        setFlowState('ERROR');
        onGuideChange('Session ended server-side');
        return;

      case 'otp_cooldown': {
        const retrySec = apiErr.details?.retryAfter || 30;
        setScanErrorCode('otp_cooldown');
        setScanError(apiErr.message);
        fsmDispatch({ type: 'SUBMIT_FAILED', error: buildErrorInfo('otp_cooldown', apiErr.message, undefined, retrySec) });
        setFlowState('ERROR');
        onGuideChange('Resend too soon; please wait');
        return;
      }

      case 'otp_delivery_failed':
        setScanErrorCode('otp_delivery_failed');
        setScanError(apiErr.message);
        fsmDispatch({ type: 'SUBMIT_FAILED', error: buildErrorInfo('otp_delivery_failed') });
        setFlowState('ERROR');
        onGuideChange('Code not delivered');
        return;

      case 'selfie_store_failed':
        setScanErrorCode('selfie_store_failed');
        setScanError(apiErr.message);
        fsmDispatch({ type: 'SUBMIT_FAILED', error: buildErrorInfo('selfie_store_failed') });
        setFlowState('ERROR');
        onGuideChange("Photo didn't save");
        return;

      case 'network_error':
        setScanErrorCode('network_error');
        setScanError(apiErr.message);
        fsmDispatch({ type: 'SUBMIT_FAILED', error: buildErrorInfo('network_error') });
        setFlowState('ERROR');
        onGuideChange('No connection');
        return;

      default:
        setScanErrorCode('unknown');
        setScanError(apiErr.message || 'Something went wrong');
        fsmDispatch({ type: 'SUBMIT_FAILED', error: buildErrorInfo('generic_error', apiErr.message) });
        setFlowState('ERROR');
        onGuideChange(apiErr.message || 'Unable to mark attendance');
    }
  }, [onGuideChange]);

  const [isOffline, setIsOffline] = useState<boolean>(!navigator.onLine);
  const [isOfflineQueued, setIsOfflineQueued] = useState<boolean>(false);
  const [queuedSessionInfo, setQueuedSessionInfo] = useState<any>(null);
  const [pendingQueueCount, setPendingQueueCount] = useState<number>(0);
  const [cachedSessionHint, setCachedSessionHint] = useState<any>(null);
  const [isRetryingQueue, setIsRetryingQueue] = useState<boolean>(false);

  // Rate Limiting
  const [rateLimitSecondsLeft, setRateLimitSecondsLeft] = useState<number>(0);
  const rateLimitCooldownTimerRef = useRef<any>(null);

  // In-flight and Token Cache Guards
  const isScanningLockedRef = useRef<boolean>(false);
  const inFlightTokenStepRef = useRef<number | null>(null);
  const inFlightTokenStrRef = useRef<string | null>(null);
  const failedTokensCacheRef = useRef<Map<string, number>>(new Map());
  const lastExpiredPayloadRef = useRef<string | null>(null);
  const lastFailedPayloadRef = useRef<string | null>(null);
  const lastExpiredStepRef = useRef<number | null>(null);
  const currentAbortCtrlRef = useRef<AbortController | null>(null);

  // Binding State
  const bindingProofRef = useRef<{
    challenge_token?: string;
    binding_signature?: string;
    device_id?: string;
  } | null>(null);
  const [rebindOtpRequired, setRebindOtpRequired] = useState<boolean>(false);
  const [rebindMaskedEmail, setRebindMaskedEmail] = useState<string>('');
  const [rebindOtpValue, setRebindOtpValue] = useState<string>('');
  const [cachedEnrollPayload, setCachedEnrollPayload] = useState<any>(null);
  const [isSubmittingRebindOtp, setIsSubmittingRebindOtp] = useState<boolean>(false);
  const [rebindOtpError, setRebindOtpError] = useState<string | null>(null);

  // Selfie Modal Tracking
  const [showSelfieModal, setShowSelfieModal] = useState<boolean>(false);
  const [selfieAttendanceId, setSelfieAttendanceId] = useState<number | null>(null);
  const [selfieSessionId, setSelfieSessionId] = useState<number | null>(null);
  const [selfieCompleted, setSelfieCompleted] = useState<boolean>(false);

  // Fallback Code State
  const [fallbackCode, setFallbackCode] = useState<string>('');
  const [fallbackSubmitting, setFallbackSubmitting] = useState<boolean>(false);
  const [fallbackError, setFallbackError] = useState<string | null>(null);

  // Student Profile Info
  const [studentInfo, setStudentInfo] = useState<{ roll_number: string; name: string; section: string }>({
    roll_number: '',
    name: '',
    section: ''
  });

  const pageOpenTimeRef = useRef<number>(Date.now());

  // Haptic & Audio Feedback
  const triggerFeedback = useCallback((isSuccess: boolean) => {
    try {
      if (navigator.vibrate) {
        navigator.vibrate(isSuccess ? [100, 50, 100] : [150, 80, 150, 80, 200]);
      }
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = isSuccess ? 'sine' : 'sawtooth';
      osc.frequency.setValueAtTime(isSuccess ? 880 : 220, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + (isSuccess ? 0.2 : 0.4));
    } catch {}
  }, []);

  // Pre-cache Binding V2 proof at mount
  useEffect(() => {
    if (!BINDING_V2_ENABLED) return;
    let cancelled = false;
    (async () => {
      try {
        const state = await getBindingState(studentRoll);
        if (cancelled || state !== 'enrolled') return;
        const challengeRes: any = await apiRequest('/binding/challenge', {
          method: 'POST',
          body: JSON.stringify({})
        });
        if (cancelled || !challengeRes?.challenge_token) return;
        const sigResult = await signChallenge(challengeRes.challenge_token, studentRoll);
        bindingProofRef.current = {
          challenge_token: challengeRes.challenge_token,
          binding_signature: sigResult.signature_b64,
          device_id: sigResult.device_id
        };
        console.log('[QR] Binding proof pre-cached at mount (challenge signed)');
      } catch (e: any) {
        console.warn('[QR] Binding pre-cache failed (non-fatal):', e?.message || e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [studentRoll]);

  // Load student profile
  useEffect(() => {
    try {
      const stored = localStorage.getItem('user');
      if (stored) {
        const u = JSON.parse(stored);
        setStudentInfo({
          roll_number: u.roll_number || u.username || 'STUDENT',
          name: u.name || 'Student',
          section: u.section || u.department || ''
        });
      }
    } catch {}

    apiRequest<any>('/student/profile')
      .then((prof) => {
        if (prof) {
          setStudentInfo({
            roll_number: prof.roll_number || prof.username || 'STUDENT',
            name: prof.name || 'Student',
            section: prof.section_name || prof.department_name || ''
          });
        }
      })
      .catch(() => {});
  }, []);

  // Online / Offline synchronization
  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      offlineSubmissionQueue.flush();
    };
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const unsubscribe = offlineSubmissionQueue.subscribe((cnt) => {
      setPendingQueueCount(cnt);
    });

    const cached = offlineSubmissionQueue.getCachedLastSession();
    if (cached) {
      setCachedSessionHint(cached);
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      unsubscribe();
      if (rateLimitCooldownTimerRef.current) {
        clearInterval(rateLimitCooldownTimerRef.current);
      }
    };
  }, []);

  // Helper functions for parsing QR payloads
  const extractPayloadStep = (payload: string): { step: number | null; sessionId: string | null } => {
    try {
      if (!payload) return { step: null, sessionId: null };
      const vMatch = payload.match(/[?&]v=(\d+)/);
      const sMatch = payload.match(/[?&]s=([A-Za-z0-9_-]+)/);
      if (vMatch) {
        return { step: parseInt(vMatch[1], 10), sessionId: sMatch ? sMatch[1] : null };
      }

      let rawToken = payload;
      if (payload.includes('/a/')) {
        const match = payload.match(/\/a\/([A-Za-z0-9_-]+)/);
        if (match) rawToken = match[1];
      }
      const cleanToken = rawToken.replace(/^[?&]/, '').split(/[?#&]/)[0];
      if (cleanToken.length >= 20 && /^[A-Za-z0-9_-]+$/.test(cleanToken)) {
        try {
          let b64 = cleanToken.replace(/-/g, '+').replace(/_/g, '/');
          while (b64.length % 4 !== 0) b64 += '=';
          const decoded = atob(b64);
          const parts = decoded.split(':');
          if (parts.length >= 4) {
            const step = parseInt(parts[2], 10);
            if (!isNaN(step)) {
              return { step, sessionId: parts[0] || null };
            }
          }
        } catch {}
      }
    } catch {}
    return { step: null, sessionId: null };
  };

  const parseAttendanceQrPayload = (decodedText: string): ParsedQrPayload | null => {
    const trimmed = decodedText.trim();
    if (!trimmed || trimmed.length < 6) return null;

    // 0. Canonical versioned JSON payload ({ v: 2, qr_type, session_id, token, issued_at, exp })
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const json = JSON.parse(trimmed);
        if (json && typeof json === 'object') {
          const rawToken = json.token || '';
          if (json.v === 2 || json.qr_type) {
            let validationError: 'qr_type_invalid' | 'qr_expired' | undefined = undefined;
            if (json.qr_type !== 'live_session' && json.qr_type !== 'frequency_extended') {
              validationError = 'qr_type_invalid';
            } else if (json.exp != null) {
              const now = Date.now();
              // 30s clock-skew tolerance
              if (now > Number(json.exp) + 30000) {
                validationError = 'qr_expired';
              }
            }
            return {
              token: rawToken,
              sourceType: 'raw_token',
              canonical: json,
              validationError
            };
          } else if (rawToken) {
            return {
              token: rawToken,
              sourceType: 'raw_token',
              canonical: json
            };
          }
        }
      } catch {}
    }

    if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
      try {
        const url = new URL(trimmed);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') {
          return null;
        }

        if (url.pathname.includes('/a/')) {
          const match = url.pathname.match(/\/a\/([A-Za-z0-9_-]{10,})/);
          if (match && match[1]) {
            return { token: match[1], sourceType: 'launch_url' };
          }
        }

        const tokenParam = url.searchParams.get('token') || url.searchParams.get('session_token');
        if (tokenParam && tokenParam.length >= 10) {
          return { token: tokenParam, sourceType: 'launch_url' };
        }

        const sParam = url.searchParams.get('s');
        const vParam = url.searchParams.get('v');
        if (sParam) {
          return {
            token: vParam ? `?s=${sParam}&v=${vParam}` : sParam,
            sourceType: 'short_code'
          };
        }

        return null;
      } catch {
        return null;
      }
    }

    if (trimmed.startsWith('/a/')) {
      const rawToken = trimmed.slice('/a/'.length).split(/[?#]/)[0];
      if (rawToken.length >= 10) {
        return { token: rawToken, sourceType: 'launch_path' };
      }
    }

    if (trimmed.includes('s=') && (trimmed.includes('v=') || trimmed.length <= 30)) {
      return { token: trimmed, sourceType: 'short_code' };
    }

    if (trimmed.startsWith('S|') || trimmed.startsWith('SNIST-SES|')) {
      return { token: trimmed, sourceType: 'legacy' };
    }

    if (/^[A-Za-z0-9_-]{6,}$/.test(trimmed)) {
      return {
        token: trimmed,
        sourceType: trimmed.length >= 30 ? 'raw_token' : 'short_code'
      };
    }

    return null;
  };

  const submitScannedSession = useCallback(async (
    payloadToken: string,
    parsed: ParsedQrPayload,
    customIdempotencyKey?: string
  ) => {
    isScanningLockedRef.current = true;
    setIsSubmitting(true);
    setFlowState('SUBMITTING');
    inFlightTokenStrRef.current = payloadToken;
    setScanError(null);
    setScanErrorCode(null);

    // Stage 1: validating_token (FIX-1: pre-refresh outside budget if exp - now < 10000ms)
    fsmDispatch({ type: 'SET_SUBMITTING_STAGE', stage: 'validating_token' });
    onGuideChange('Validating session token…');

    const userToken = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
    if (userToken) {
      const expMs = getJwtExpMs(userToken);
      if (expMs != null && expMs - Date.now() < 10000) {
        console.log('[QR] Access token exp within 10s budget — pre-refreshing outside submission budget');
        try {
          const refreshed = await tokenLifecycleManager.executeRefresh('pre-submit');
          if (!refreshed) {
            throw new Error('Pre-refresh failed');
          }
        } catch {
          console.warn('[QR] Pre-refresh failed — server_token_expired');
          handleScanError({ status: 401, error_code: 'server_token_expired' });
          return;
        }
      }
    }

    // Stage 2: signing (binding proof & idempotency key generation)
    fsmDispatch({ type: 'SET_SUBMITTING_STAGE', stage: 'signing' });
    onGuideChange('Signing request…');

    const idempotencyKey = customIdempotencyKey || await computeIdempotencyKey(payloadToken);
    let isSuccess = false;

    try {
      const geo = studentGeoRef.current || await getStudentGeolocation().catch(() => null);
      const binding = bindingProofRef.current;

      let res: any;
      let attempt = 0;
      let timedOut = false;

      // Submission with 1 silent retry on timeout (FIX-1)
      while (attempt < 2) {
        attempt++;
        const abortCtrl = new AbortController();
        currentAbortCtrlRef.current = abortCtrl;
        const timeoutId = setTimeout(() => abortCtrl.abort('timeout_submit'), SCAN_SUBMIT_TIMEOUT_MS);

        try {
          fsmDispatch({ type: 'SET_SUBMITTING_STAGE', stage: 'submitting' });
          onGuideChange(attempt === 1 ? 'Submitting Attendance…' : 'Finalizing attendance…');

          res = await apiRequest('/student/scan-session', {
            method: 'POST',
            signal: abortCtrl.signal,
            headers: {
              'Idempotency-Key': idempotencyKey
            },
            body: JSON.stringify({
              session_token: payloadToken,
              scan_mode: 'QR_CAMERA',
              qr_type: (parsed?.canonical as any)?.qr_type || 'live_session',
              exp: (parsed?.canonical as any)?.exp,
              issued_at: (parsed?.canonical as any)?.issued_at,
              ...(geo?.latitude != null ? {
                latitude: geo.latitude,
                longitude: geo.longitude,
                accuracy_m: geo.accuracy_m
              } : {}),
              ...(binding?.challenge_token ? { challenge_token: binding.challenge_token } : {}),
              ...(binding?.binding_signature ? {
                binding_signature: binding.binding_signature,
                device_signature: binding.binding_signature
              } : {}),
              ...(binding?.device_id ? { device_id: binding.device_id } : {})
            })
          });
          timedOut = false;
          break;
        } catch (abortErr: any) {
          if (abortErr?.name === 'AbortError' || abortCtrl.signal.aborted) {
            timedOut = true;
            console.warn(`[QR] Submit timeout on attempt ${attempt}/2 after ${SCAN_SUBMIT_TIMEOUT_MS}ms`);
            if (attempt === 1) {
              // Silent retry: retry with same Idempotency-Key & fresh budget
              continue;
            } else {
              break;
            }
          }
          throw abortErr;
        } finally {
          clearTimeout(timeoutId);
          currentAbortCtrlRef.current = null;
        }
      }

      if (timedOut) {
        // Second timeout reached -> ERROR(client_abort)
        const err = buildErrorInfo('client_abort', 'Taking longer than usual');
        fsmDispatch({ type: 'SUBMIT_FAILED', error: err });
        setScanError(err.message);
        setScanErrorCode(err.code);
        onGuideChange(err.message);
        setIsSubmitting(false);
        isScanningLockedRef.current = false;
        return;
      }

      // Stage 4: confirming (Job API polling if 202 or pending) (FIX-3)
      fsmDispatch({ type: 'SET_SUBMITTING_STAGE', stage: 'confirming' });
      onGuideChange('Confirming attendance…');

      if (res?.status === 'pending' || (res?.job_id && !res?.attendance_id)) {
        const pollUrl = res.poll_url || `/attendance/job/${res.job_id}`;
        let pollCount = 0;
        let committedRes: any = null;

        while (pollCount < 5) {
          await new Promise(r => setTimeout(r, 500));
          pollCount++;
          try {
            const jobRes: any = await apiRequest(pollUrl);
            if (jobRes?.status === 'committed') {
              committedRes = jobRes;
              break;
            } else if (jobRes?.status === 'failed') {
              throw {
                error_code: jobRes.error_code || 'selfie_store_failed',
                message: "Photo didn't save"
              };
            }
          } catch (pollErr: any) {
            if (pollErr?.status === 404 || pollErr?.error_code === 'job_not_found') {
              throw {
                error_code: 'job_not_found',
                message: 'Attendance verification expired'
              };
            }
          }
        }

        if (committedRes && committedRes.status === 'committed') {
          res = { ...res, ...committedRes, attendance_id: committedRes.attendance_id };
        } else {
          const err = buildErrorInfo('client_abort', 'Confirming attendance with server…');
          fsmDispatch({ type: 'SUBMIT_FAILED', error: err });
          setScanError(err.message);
          setScanErrorCode(err.code);
          setIsSubmitting(false);
          isScanningLockedRef.current = false;
          return;
        }
      }

      isSuccess = true;
      inFlightTokenStrRef.current = null;
      setIsSubmitting(false);
      setFlowState('SUCCESS');
      fsmDispatch({ type: 'SUBMIT_SUCCESS', result: res });
      console.log('[QR] Server response: SUCCESS —', res?.status || 'MARKED');

      try {
        offlineSubmissionQueue.saveCachedLastSession({
          subject_name: res.subject_name || 'Class Session',
          session_id: res.session_id,
          session_date: res.session_date || new Date().toISOString().split('T')[0],
          period_count: res.period_count || 1
        });
      } catch {}

      try {
        const totalFromOpen = Date.now() - pageOpenTimeRef.current;
        scannerTelemetry.recordStage('attendance_confirmed', totalFromOpen, res.session_id);
      } catch {}

      triggerFeedback(true);
      setSuccessResult(res);
      const attId = res?.attendance_id || (res?.session_id ? Number(res.session_id) : 1);
      const sId = res?.session_id ? Number(res.session_id) : null;
      setSelfieAttendanceId(attId);
      setSelfieSessionId(sId);
      setShowSelfieModal(true);
      onStopCamera();

    } catch (err: any) {
      failedTokensCacheRef.current.set(payloadToken, Date.now());
      lastFailedPayloadRef.current = payloadToken;
      inFlightTokenStrRef.current = null;

      const rawMsg = err?.message || err?.detail || '';
      const lowerMsg = (typeof rawMsg === 'string' ? rawMsg : JSON.stringify(rawMsg)).toLowerCase();

      // True duplicate / already marked
      if (err?.code === 'already_marked' || lowerMsg.includes('already marked') || lowerMsg.includes('already present')) {
        fsmDispatch({
          type: 'SUBMIT_SUCCESS',
          result: { already_marked: true, attendance_id: err.attendance_id || 1, message: 'Attendance already recorded for this session.' }
        });
        setSuccessResult({
          status: 'ALREADY_MARKED',
          message: 'Attendance already recorded for this session.',
          subject_name: err?.subject_name || 'Class Attendance Session',
          roll_number: studentInfo.roll_number || studentRoll,
          session_date: new Date().toISOString().split('T')[0]
        });
        onStopCamera();
        setIsSubmitting(false);
        isScanningLockedRef.current = false;
        return;
      }

      // Handle challenge invalid/expired
      if (lowerMsg.includes('challenge') && (lowerMsg.includes('expired') || lowerMsg.includes('invalid'))) {
        bindingProofRef.current = null;
        fsmDispatch({ type: 'DISMISS' });
        setFlowState('IDLE_SCANNING');
        onGuideChange('Align the QR inside the frame');
        isScanningLockedRef.current = false;
        setIsSubmitting(false);
        onNextScanReady();
        return;
      }

      // For 409 (upgrade) or 403 no_active_binding, cache the QR payload in sessionStorage before delegating to canonical error handler
      const status = err?.status;
      const errorCode = err?.error_code || err?.phase7_code || err?.code;
      const isBindingError = (
        status === 409 ||
        errorCode === 'binding_upgrade_required' ||
        errorCode === 'no_active_binding' ||
        lowerMsg.includes('binding_upgrade_required') ||
        lowerMsg.includes('no_active_binding') ||
        lowerMsg.includes('binding_required') ||
        lowerMsg.includes('security upgrade')
      );
      if (isBindingError) {
        try {
          localStorage.removeItem('binding_status');
          localStorage.removeItem('binding_status_ts');
        } catch {}
        const cached: CachedQrPayload = {
          payload: parsed.canonical || { token: payloadToken, exp: Date.now() + 30000 },
          captured_at: Date.now()
        };
        try {
          sessionStorage.setItem('snist_cached_qr_payload', JSON.stringify(cached));
        } catch {}
      }

      triggerFeedback(false);
      handleScanError(err);
    } finally {
      setIsSubmitting(false);
      inFlightTokenStrRef.current = null;
      if (!isSuccess && !rateLimitCooldownTimerRef.current) {
        setTimeout(() => {
          if (!rateLimitCooldownTimerRef.current) {
            isScanningLockedRef.current = false;
            onNextScanReady();
          }
        }, 1500);
      }
    }
  }, [
    getStudentGeolocation,
    onGuideChange,
    onNextScanReady,
    onStopCamera,
    studentGeoRef,
    studentInfo.roll_number,
    studentRoll,
    triggerFeedback
  ]);

  const handleScanSuccess = useCallback(async (decodedText: string, engineUsed?: ScannerEngine) => {
    if (isScanningLockedRef.current || isSubmitting || fsmCtx.isActionInFlight) return;

    const trimmed = decodedText.trim();
    if (!trimmed || trimmed.length < 6) return;

    const parsed = parseAttendanceQrPayload(trimmed);
    if (!parsed || !parsed.token) {
      console.warn('[QR] Unrecognized QR structure:', trimmed.slice(0, 40));
      const err = buildErrorInfo('qr_type_invalid', 'Wrong QR — scan the live session QR');
      fsmDispatch({ type: 'QR_INVALID', error: err });
      setScanError(err.message);
      setScanErrorCode(err.code);
      onGuideChange(err.message);
      triggerFeedback(false);
      return;
    }

    if (parsed.validationError === 'qr_type_invalid') {
      const err = buildErrorInfo('qr_type_invalid', 'Wrong QR — scan the live session QR');
      fsmDispatch({ type: 'QR_INVALID', error: err });
      setScanError(err.message);
      setScanErrorCode(err.code);
      onGuideChange(err.message);
      triggerFeedback(false);
      return;
    }

    if (parsed.validationError === 'qr_expired') {
      const err = buildErrorInfo('qr_expired', 'QR expired — rescan');
      fsmDispatch({ type: 'QR_INVALID', error: err });
      setScanError(err.message);
      setScanErrorCode(err.code);
      onGuideChange(err.message);
      triggerFeedback(false);
      return;
    }

    const payloadToken = parsed.token;
    const { step: scannedStep } = extractPayloadStep(trimmed.includes('?') ? trimmed : payloadToken);

    // Step-level freshness guard
    if (scannedStep != null && lastExpiredStepRef.current != null) {
      if (scannedStep <= lastExpiredStepRef.current) {
        onGuideChange('Old QR — waiting for the projector to refresh');
        setFlowState('STALE_QR');
        return;
      } else {
        lastExpiredStepRef.current = null;
        lastExpiredPayloadRef.current = null;
        lastFailedPayloadRef.current = null;
      }
    }

    // Exact payload guard
    if (
      payloadToken === lastExpiredPayloadRef.current || trimmed === lastExpiredPayloadRef.current ||
      payloadToken === lastFailedPayloadRef.current || trimmed === lastFailedPayloadRef.current
    ) {
      onGuideChange('Waiting for classroom QR to refresh...');
      setFlowState('STALE_QR');
      return;
    }

    // Deduplication window check
    const now = Date.now();
    const lastFailedAt = failedTokensCacheRef.current.get(payloadToken);
    if (lastFailedAt && (now - lastFailedAt < 12000)) {
      onGuideChange('Waiting for classroom QR to refresh...');
      setFlowState('STALE_QR');
      return;
    }

    lastExpiredPayloadRef.current = null;
    lastFailedPayloadRef.current = null;

    fsmDispatch({ type: 'QR_VALIDATED', payload: parsed.canonical || { token: payloadToken } });

    // Cache QR payload in sessionStorage
    const cachedQr: CachedQrPayload = {
      payload: parsed.canonical || { token: payloadToken, exp: Date.now() + 30000 },
      captured_at: Date.now()
    };
    try {
      sessionStorage.setItem('snist_cached_qr_payload', JSON.stringify(cachedQr));
    } catch {}

    // Offline fast-path
    if (!navigator.onLine) {
      try {
        await offlineSubmissionQueue.enqueue({
          client_id: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          session_token: payloadToken
        });
        triggerFeedback(true);
        onStopCamera();
        setIsOfflineQueued(true);
        setQueuedSessionInfo({
          token: payloadToken,
          sessionPreview: 'Class Session',
          queuedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });
      } catch {
        isScanningLockedRef.current = false;
        setIsSubmitting(false);
        setFlowState('IDLE_SCANNING');
      }
      return;
    }

    // Pre-check cached binding status (5-min TTL) (FIX-6 LINK_CHECK pre-check)
    const cachedBindingStatus = localStorage.getItem('binding_status');
    const cachedBindingTs = Number(localStorage.getItem('binding_status_ts') || '0');
    const isBindingCacheValid = Date.now() - cachedBindingTs < 5 * 60 * 1000;
    if (isBindingCacheValid && (cachedBindingStatus === 'unbound' || cachedBindingStatus === 'legacy')) {
      handleScanError({ status: 409, error_code: 'binding_upgrade_required' });
      return;
    }
    if (isBindingCacheValid && cachedBindingStatus === 'not_enrolled') {
      handleScanError({ status: 403, error_code: 'no_active_binding', code: 'no_active_binding' });
      return;
    }

    fsmDispatch({ type: 'LINK_V2_CONFIRMED' });
    await submitScannedSession(payloadToken, parsed);
  }, [
    fsmCtx.isActionInFlight,
    isSubmitting,
    onGuideChange,
    onStopCamera,
    submitScannedSession,
    triggerFeedback
  ]);

  const handleFallbackSubmit = useCallback(async (codeToSubmit?: string) => {
    const code = (codeToSubmit || fallbackCode).trim();
    if (!code) {
      setFallbackError('Please enter a valid session token or short code.');
      return;
    }
    setFallbackSubmitting(true);
    setFallbackError(null);
    try {
      const geo = studentGeoRef.current || await getStudentGeolocation();
      let bindingChallengeToken: string | undefined = undefined;
      let bindingSignature: string | undefined = undefined;
      let bindingDeviceId: string | undefined = undefined;
      if (BINDING_V2_ENABLED) {
        try {
          const bindingState = await getBindingState(studentRoll);
          if (bindingState === 'enrolled') {
            const challengeRes: any = await apiRequest('/binding/challenge', {
              method: 'POST',
              body: JSON.stringify({})
            });
            if (challengeRes?.challenge_token) {
              bindingChallengeToken = challengeRes.challenge_token;
              const sigResult = await signChallenge(bindingChallengeToken!, studentRoll);
              bindingSignature = sigResult.signature_b64;
              bindingDeviceId = sigResult.device_id;
            }
          }
        } catch (bindErr: any) {
          console.warn('[Binding V2 Fallback] Challenge/sign pipeline error:', bindErr?.message || bindErr);
        }
      }

      const res: any = await apiRequest('/student/scan-session', {
        method: 'POST',
        body: JSON.stringify({
          short_code: code.length <= 16 ? code : undefined,
          session_token: code.length > 16 ? code : undefined,
          scan_mode: 'QR_CAMERA_FALLBACK',
          ...(geo?.latitude != null ? { latitude: geo.latitude, longitude: geo.longitude, accuracy_m: geo.accuracy_m } : {}),
          ...(bindingChallengeToken ? { challenge_token: bindingChallengeToken } : {}),
          ...(bindingSignature ? { binding_signature: bindingSignature, device_signature: bindingSignature } : {}),
          ...(bindingDeviceId ? { device_id: bindingDeviceId } : {})
        })
      });

      triggerFeedback(true);
      setSuccessResult(res);
      const attId = res?.attendance_id || (res?.session_id ? Number(res.session_id) : 1);
      const sId = res?.session_id ? Number(res.session_id) : null;
      setSelfieAttendanceId(attId);
      setSelfieSessionId(sId);
      setShowSelfieModal(true);
      onStopCamera();
      return res;
    } catch (err: any) {
      const msg = err.message || '';
      const lower = msg.toLowerCase();
      if (lower.includes('not enrolled in this section') || (lower.includes('section') && (lower.includes('enrolled') || lower.includes('belong') || lower.includes('mismatch')))) {
        setFallbackError('Not enrolled in this section. Please contact faculty incharge.');
      } else {
        setFallbackError(err.message || 'Controlled fallback verification failed.');
      }
      throw err;
    } finally {
      setFallbackSubmitting(false);
    }
  }, [fallbackCode, getStudentGeolocation, onStopCamera, studentGeoRef, studentRoll, triggerFeedback]);

  const handleInlineEnroll = useCallback(async () => {
    setIsInlineEnrolling(true);
    setFlowState('ENROLLING');
    setRebindOtpError(null);
    setScanError(null);
    const enrollAbortCtrl = new AbortController();
    const enrollTimeoutId = setTimeout(() => enrollAbortCtrl.abort(), 6500);

    try {
      const activeRoll = studentRoll || studentInfo.roll_number || (localStorage.getItem('user') ? JSON.parse(localStorage.getItem('user') || '{}').roll_number : '');
      const payload = await generateKeyPair(activeRoll, false);
      setCachedEnrollPayload(payload);
      const res: any = await apiRequest('/binding/enroll', {
        method: 'POST',
        signal: enrollAbortCtrl.signal,
        body: JSON.stringify({
          public_key_spki_b64: payload.public_key_spki_b64,
          key_id: payload.key_id,
          corroboration_nonce: (payload as any).nonce || undefined,
          browser_profile_tag: (payload as any).browser_profile_tag || undefined
        })
      });

      if (res?.status === 'REBIND_REQUIRED' && res?.otp_required) {
        setRebindOtpRequired(true);
        setFlowState('REBIND_OTP');
        setRebindMaskedEmail(res.email_masked || 'your registered college email');
        setScanError(null);
        setScanErrorCode(null);
        fsmDispatch({
          type: 'TICKET_ISSUED',
          ticket: {
            ticket: res.enrollment_ticket?.ticket || 'et_rebind',
            expires_at: res.enrollment_ticket?.expires_at || new Date(Date.now() + 600000).toISOString(),
            masked_recipient: res.email_masked
          }
        });
        onGuideChange('Verification code sent to your email to link this device.');
        return;
      }

      if (res?.status === 'DEVICE_ENROLLED' || res?.message?.toLowerCase().includes('enrolled')) {
        if (payload.stored_record) {
          await commitBindingRecord(payload.stored_record);
        }
        setScanError(null);
        setScanErrorCode(null);
        setRebindOtpRequired(false);
        isScanningLockedRef.current = false;
        setIsSubmitting(false);
        triggerFeedback(true);

        try {
          localStorage.setItem('binding_status', 'v2');
          localStorage.setItem('binding_status_ts', String(Date.now()));
        } catch {}

        let cached: CachedQrPayload | null = null;
        try {
          const raw = sessionStorage.getItem('snist_cached_qr_payload');
          if (raw) cached = JSON.parse(raw);
        } catch {}

        if (cached && isCachedPayloadValid(cached)) {
          console.log('[QR] Enrollment complete — auto-resuming submission with cached payload');
          fsmDispatch({ type: 'ENROLLED' });
          onGuideChange('Device enrolled! Submitting attendance…');
          setTimeout(() => {
            submitScannedSession(cached!.payload.token, {
              token: cached!.payload.token,
              sourceType: 'raw_token',
              canonical: cached!.payload as any
            });
          }, 100);
        } else {
          console.log('[QR] Enrollment complete! Cached QR expired/absent — switching to scanner');
          fsmDispatch({ type: 'ENROLLED' });
          setFlowState('IDLE_SCANNING');
          setScanError(null);
          setScanErrorCode(null);
          onGuideChange('Device enrolled! Point your camera at the classroom QR.');
          isScanningLockedRef.current = false;
          onNextScanReady();
        }
      } else {
        throw new Error(res?.detail?.message || res?.message || 'Device enrollment rejected by server.');
      }
    } catch (err: any) {
      const errInfo = buildErrorInfo(
        'generic_error',
        err?.name === 'AbortError' || enrollAbortCtrl.signal.aborted
          ? 'Device enrollment timed out. Please check connection and try again.'
          : (err.message || 'Inline enrollment failed. Please try again.')
      );
      fsmDispatch({ type: 'ENROLL_FAILED', error: errInfo });
      setScanError(errInfo.message);
      setFlowState('ERROR');
    } finally {
      clearTimeout(enrollTimeoutId);
      setIsInlineEnrolling(false);
    }
  }, [onGuideChange, studentInfo.roll_number, studentRoll, submitScannedSession, triggerFeedback]);

  const handleConfirmRebindOtp = useCallback(async () => {
    if (!rebindOtpValue || rebindOtpValue.trim().length !== 6) {
      setRebindOtpError('Please enter the 6-digit verification code.');
      return;
    }
    if (!cachedEnrollPayload) {
      setRebindOtpError('Enrollment state missing. Please click Enroll again.');
      setRebindOtpRequired(false);
      setFlowState('IDLE_SCANNING');
      return;
    }

    setIsSubmittingRebindOtp(true);
    setRebindOtpError(null);
    try {
      const res: any = await apiRequest('/binding/enroll', {
        method: 'POST',
        body: JSON.stringify({
          public_key_spki_b64: cachedEnrollPayload.public_key_spki_b64,
          key_id: cachedEnrollPayload.key_id,
          rebind_otp: rebindOtpValue.trim(),
          corroboration_nonce: (cachedEnrollPayload as any).nonce || undefined
        })
      });

      if (res?.status === 'DEVICE_ENROLLED' || res?.message?.toLowerCase().includes('enrolled')) {
        if (cachedEnrollPayload?.stored_record) {
          await commitBindingRecord(cachedEnrollPayload.stored_record);
        }
        setRebindOtpRequired(false);
        setScanError(null);
        setScanErrorCode(null);
        setRebindOtpValue('');
        isScanningLockedRef.current = false;
        setIsSubmitting(false);
        triggerFeedback(true);

        try {
          localStorage.setItem('binding_status', 'v2');
          localStorage.setItem('binding_status_ts', String(Date.now()));
        } catch {}

        let cached: CachedQrPayload | null = null;
        try {
          const raw = sessionStorage.getItem('snist_cached_qr_payload');
          if (raw) cached = JSON.parse(raw);
        } catch {}

        if (cached && isCachedPayloadValid(cached)) {
          console.log('[QR] Rebind verified — auto-resuming submission with cached payload');
          fsmDispatch({ type: 'OTP_VERIFIED' });
          onGuideChange('Device verified! Submitting attendance…');
          setTimeout(() => {
            submitScannedSession(cached!.payload.token, {
              token: cached!.payload.token,
              sourceType: 'raw_token',
              canonical: cached!.payload as any
            });
          }, 100);
        } else {
          console.log('[QR] Rebind verified! Cached QR expired/absent — switching to scanner');
          fsmDispatch({ type: 'OTP_VERIFIED' });
          setFlowState('IDLE_SCANNING');
          setScanError(null);
          setScanErrorCode(null);
          onGuideChange('Device verified! Point your camera at the classroom QR.');
          isScanningLockedRef.current = false;
          onNextScanReady();
        }
      } else {
        throw new Error(res?.detail?.message || res?.message || 'Rebind verification failed.');
      }
    } catch (err: any) {
      const errInfo = buildErrorInfo('otp_delivery_failed', err.message || 'Invalid verification code. Please try again.');
      fsmDispatch({ type: 'OTP_FAILED', error: errInfo });
      setRebindOtpError(err.message || 'Invalid verification code. Please try again.');
    } finally {
      setIsSubmittingRebindOtp(false);
    }
  }, [cachedEnrollPayload, onGuideChange, rebindOtpValue, submitScannedSession, triggerFeedback]);

  const handleResendRebindOtp = useCallback(async () => {
    try {
      setRebindOtpError(null);
      fsmDispatch({ type: 'OTP_RESEND' });
      await apiRequest('/binding/request-rebind-otp', { method: 'POST' });
      onGuideChange('New verification code sent to your email.');
    } catch (err: any) {
      const isCooldown = err?.status === 429 || err?.error_code === 'otp_cooldown';
      const retrySec = err?.retry_after_s || err?.retry_after || 30;
      const errInfo = isCooldown
        ? buildErrorInfo('otp_cooldown', `Resend too soon; please wait ${retrySec}s`, undefined, retrySec)
        : buildErrorInfo('otp_delivery_failed', err.message || 'Failed to resend code. Please try again.');
      fsmDispatch({ type: 'OTP_FAILED', error: errInfo });
      setRebindOtpError(err.message || 'Failed to resend code. Please try again.');
    }
  }, [onGuideChange]);

  const cancelSubmission = useCallback(() => {
    if (currentAbortCtrlRef.current) {
      try {
        currentAbortCtrlRef.current.abort('user_cancelled');
      } catch {}
      currentAbortCtrlRef.current = null;
    }
    fsmDispatch({ type: 'DISMISS' });
    setIsSubmitting(false);
    setFlowState('IDLE_SCANNING');
    isScanningLockedRef.current = false;
    onGuideChange('Submission cancelled — scan again');
  }, [onGuideChange]);

  const resetAfterTimeoutOrStale = useCallback(() => {
    fsmDispatch({ type: 'DISMISS' });
    setFlowState('IDLE_SCANNING');
    setScanError(null);
    setScanErrorCode(null);
    onGuideChange('Align the QR inside the frame');
    lastExpiredPayloadRef.current = null;
    lastExpiredStepRef.current = null;
    isScanningLockedRef.current = false;
    onNextScanReady();
  }, [onGuideChange, onNextScanReady]);

  const retrySubmit = useCallback(async () => {
    let cached: CachedQrPayload | null = null;
    try {
      const raw = sessionStorage.getItem('snist_cached_qr_payload');
      if (raw) cached = JSON.parse(raw);
    } catch {}

    fsmDispatch({ type: 'RETRY' });
    setScanError(null);
    setScanErrorCode(null);

    if (cached && isCachedPayloadValid(cached)) {
      await submitScannedSession(cached.payload.token, {
        token: cached.payload.token,
        sourceType: 'raw_token',
        canonical: cached.payload as any
      });
    } else {
      isScanningLockedRef.current = false;
      setIsSubmitting(false);
      onNextScanReady();
      onGuideChange('Align the QR inside the frame');
    }
  }, [onGuideChange, onNextScanReady, submitScannedSession]);

  const retryOfflineQueue = useCallback(async () => {
    setIsRetryingQueue(true);
    const res = await offlineSubmissionQueue.flush();
    setIsRetryingQueue(false);
    if (res.success > 0) {
      triggerFeedback(true);
      setSuccessResult({
        status: 'SUCCESS',
        message: 'Attendance recorded successfully!',
        roll_number: studentInfo.roll_number || studentRoll,
        subject_name: 'Class Session',
        session_date: new Date().toISOString().split('T')[0]
      });
      setIsOfflineQueued(false);
    }
  }, [studentInfo.roll_number, studentRoll, triggerFeedback]);

  return {
    // FSM State Context
    fsmState: fsmCtx.state,
    submittingStage: fsmCtx.submittingStage || 'validating_token',
    errorInfo: fsmCtx.errorInfo || (scanError ? buildErrorInfo(scanErrorCode as any || 'generic_error', scanError) : null),
    enrollmentTicket: fsmCtx.enrollmentTicket,
    fsmDispatch,
    retrySubmit,
    // Flow State
    flowState,
    setFlowState,
    isSubmitting,
    scanError,
    setScanError,
    scanErrorCode,
    upgradeTicket,
    handleScanError,
    successResult,
    setSuccessResult,
    isOffline,
    isOfflineQueued,
    setIsOfflineQueued,
    queuedSessionInfo,
    pendingQueueCount,
    cachedSessionHint,
    isRetryingQueue,
    setIsRetryingQueue,
    retryOfflineQueue,
    rateLimitSecondsLeft,
    isScanningLockedRef,
    // Binding
    isInlineEnrolling,
    rebindOtpRequired,
    setRebindOtpRequired,
    rebindMaskedEmail,
    rebindOtpValue,
    setRebindOtpValue,
    rebindOtpError,
    isSubmittingRebindOtp,
    handleInlineEnroll,
    handleConfirmRebindOtp,
    handleResendRebindOtp,
    // Selfie
    showSelfieModal,
    setShowSelfieModal,
    selfieAttendanceId,
    selfieSessionId,
    selfieCompleted,
    setSelfieCompleted,
    // Fallback
    fallbackCode,
    setFallbackCode,
    fallbackSubmitting,
    fallbackError,
    setFallbackError,
    handleFallbackSubmit,
    // Student Info
    studentInfo,
    // Actions
    handleScanSuccess,
    cancelSubmission,
    resetAfterTimeoutOrStale,
    triggerFeedback
  };
}
