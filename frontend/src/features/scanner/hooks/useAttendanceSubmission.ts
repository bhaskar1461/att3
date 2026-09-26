import { useState, useRef, useCallback, useEffect } from 'react';
import { apiRequest } from '../../../services/api';
import { offlineSubmissionQueue } from '../../../services/offlineSubmissionQueue';
import { scannerTelemetry } from '../../../services/scannerTelemetry';
import { BINDING_V2_ENABLED, signChallenge, getBindingState, generateKeyPair, commitBindingRecord } from '../../../services/binding';
import { ScannerEngine } from '../../../services/qrEngine';
import { GeoCoordinates } from './useGeoVerification';

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
  const [flowState, setFlowState] = useState<ScannerFlowState>('INITIALIZING');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanErrorCode, setScanErrorCode] = useState<string | null>(null);
  const [successResult, setSuccessResult] = useState<any>(null);

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
  const [isInlineEnrolling, setIsInlineEnrolling] = useState<boolean>(false);
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

  const handleScanSuccess = useCallback(async (decodedText: string, engineUsed?: ScannerEngine) => {
    if (isScanningLockedRef.current || isSubmitting) return;

    const trimmed = decodedText.trim();
    if (!trimmed || trimmed.length < 6) return;

    const parsed = parseAttendanceQrPayload(trimmed);
    if (!parsed || !parsed.token) {
      console.warn('[QR] Unrecognized QR structure:', trimmed.slice(0, 40));
      setScanError('QR not recognized. Please scan the current classroom QR.');
      onGuideChange('QR not recognized — scan classroom QR');
      setFlowState('ERROR');
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

    isScanningLockedRef.current = true;
    setIsSubmitting(true);
    setFlowState('SUBMITTING');
    inFlightTokenStepRef.current = scannedStep;
    inFlightTokenStrRef.current = payloadToken;
    setScanError(null);
    setScanErrorCode(null);
    onGuideChange('Submitting Attendance…');
    console.log(`[QR] Token extracted (${payloadToken.length}ch, type=${parsed.sourceType}) — submitting directly to attendance API`);

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

    let isSuccess = false;
    try {
      const geo = studentGeoRef.current;
      const binding = bindingProofRef.current;

      const abortCtrl = new AbortController();
      currentAbortCtrlRef.current = abortCtrl;
      const timeoutId = setTimeout(() => abortCtrl.abort('timeout_4s'), 4000);

      let res: any;
      try {
        res = await apiRequest('/student/scan-session', {
          method: 'POST',
          signal: abortCtrl.signal,
          body: JSON.stringify({
            session_token: payloadToken,
            scan_mode: 'QR_CAMERA',
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
      } catch (abortErr: any) {
        if (abortErr?.name === 'AbortError' || abortCtrl.signal.aborted) {
          console.warn('[QR] Submission timed out after 4s — returning to scanning');
          failedTokensCacheRef.current.set(payloadToken, Date.now());
          lastFailedPayloadRef.current = payloadToken;
          const { step } = extractPayloadStep(payloadToken);
          if (step != null) {
            lastExpiredStepRef.current = Math.max(lastExpiredStepRef.current ?? 0, step);
          }
          inFlightTokenStepRef.current = null;
          inFlightTokenStrRef.current = null;
          setIsSubmitting(false);
          setFlowState('TIMEOUT');
          setScanError('Attendance request timed out. The 10s rotating QR token expired during submission.');
          onGuideChange('Timed out — waiting for refreshed QR');
          setTimeout(() => {
            if (!rateLimitCooldownTimerRef.current) {
              isScanningLockedRef.current = false;
              onNextScanReady();
            }
          }, 1500);
          return;
        }
        throw abortErr;
      } finally {
        clearTimeout(timeoutId);
        currentAbortCtrlRef.current = null;
      }

      isSuccess = true;
      inFlightTokenStepRef.current = null;
      inFlightTokenStrRef.current = null;
      setIsSubmitting(false);
      setFlowState('SUCCESS');
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
      const { step: failedStep } = extractPayloadStep(payloadToken);
      inFlightTokenStepRef.current = null;
      inFlightTokenStrRef.current = null;

      const rawMsg = err?.message || err?.detail || '';
      const lowerMsg = rawMsg.toLowerCase();
      const p7Code = err?.phase7_code || err?.error_code || err?.qr_error_code;
      const isSectionMismatch = 
        lowerMsg.includes('section') || 
        lowerMsg.includes('not enrolled in this section') || 
        lowerMsg.includes('faculty incharge') ||
        p7Code === 'section_mismatch' ||
        err?.code === 'section_mismatch';

      const code: string = isSectionMismatch ? 'section_mismatch' : (p7Code || err?.code || (
        err?.status === 429 || lowerMsg.includes('too many') || lowerMsg.includes('rate_limited') ? 'rate_limited' :
        lowerMsg.includes('qr-session-end') || lowerMsg.includes('session has ended') ? 'QR-SESSION-END' :
        lowerMsg.includes('qr-old') || lowerMsg.includes('outdated') ? 'QR-OLD' :
        lowerMsg.includes('expired') ? 'expired' :
        lowerMsg.includes('invalid') ? 'invalid' :
        (lowerMsg.includes('no_active_binding') || lowerMsg.includes('binding_required') || lowerMsg.includes('device')) ? 'no_active_binding' :
        (lowerMsg.includes('geofence') || lowerMsg.includes('location') || lowerMsg.includes('gps')) ? 'geofence_failed' :
        'error'
      ));

      console.warn('[QR] Scan submission error:', rawMsg, 'Code:', code);
      setScanErrorCode(code);

      if (code === 'rate_limited' || err?.status === 429 || lowerMsg.includes('too many scan attempts')) {
        const retrySec = Math.max(1, Number(err?.retry_after || 20));
        isScanningLockedRef.current = true;
        setFlowState('RATE_LIMITED');
        setRateLimitSecondsLeft(retrySec);
        setScanError(`Too many scan attempts. Please wait ${retrySec}s before scanning again.`);
        onGuideChange(`Rate limit active — cooldown ${retrySec}s`);

        if (rateLimitCooldownTimerRef.current) clearInterval(rateLimitCooldownTimerRef.current);
        let countdown = retrySec;
        rateLimitCooldownTimerRef.current = setInterval(() => {
          countdown -= 1;
          if (countdown <= 0) {
            clearInterval(rateLimitCooldownTimerRef.current);
            rateLimitCooldownTimerRef.current = null;
            setRateLimitSecondsLeft(0);
            setScanError(null);
            setFlowState('IDLE_SCANNING');
            onGuideChange('Align the QR inside the frame');
            isScanningLockedRef.current = false;
            onNextScanReady();
          } else {
            setRateLimitSecondsLeft(countdown);
            setScanError(`Too many scan attempts. Please wait ${countdown}s before scanning again.`);
            onGuideChange(`Rate limit active — cooldown ${countdown}s`);
          }
        }, 1000);
        return;
      }

      const isNetErr = !navigator.onLine ||
        lowerMsg.includes('failed to fetch') ||
        lowerMsg.includes('networkerror') ||
        lowerMsg.includes('load failed');

      if (isNetErr) {
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
            sessionPreview: 'Class Attendance Session',
            queuedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          });
        } catch {}
        return;
      }

      triggerFeedback(false);

      if (code === 'QR-SESSION-END' || lowerMsg.includes('qr-session-end') || lowerMsg.includes('session has ended')) {
        lastFailedPayloadRef.current = payloadToken;
        setFlowState('ERROR');
        setScanError('This class session has ended. If faculty refreshed or started attendance, please scan the active projector QR. (Code: QR-SESSION-END)');
        onGuideChange('Session ended — point camera at active QR');
        return;
      }

      if (code === 'QR-OLD' || code === 'expired' || lowerMsg.includes('outdated') || lowerMsg.includes('expired')) {
        lastExpiredPayloadRef.current = payloadToken;
        if (failedStep != null) {
          lastExpiredStepRef.current = Math.max(lastExpiredStepRef.current ?? 0, failedStep);
        }
        setFlowState('STALE_QR');
        onGuideChange('Old QR — waiting for the projector to refresh');
        setScanError('The QR on the screen has expired. Waiting for projector rotation. (Code: QR-OLD)');
        return;
      }

      const isChallengeReused = lowerMsg.includes('challenge') && (lowerMsg.includes('replayed') || lowerMsg.includes('used'));
      if (!isChallengeReused && (err?.code === 'already_marked' || lowerMsg.includes('already marked') || lowerMsg.includes('already present') || lowerMsg.includes('already been marked'))) {
        setSuccessResult({
          status: 'ALREADY_MARKED',
          message: 'Attendance already recorded for this session.',
          subject_name: err?.subject_name || 'Class Attendance Session',
          roll_number: studentInfo.roll_number || studentRoll,
          session_date: new Date().toISOString().split('T')[0]
        });
        setFlowState('SUCCESS');
        onStopCamera();
        return;
      }

      if (code === 'geofence_failed' || lowerMsg.includes('location') || lowerMsg.includes('geofence') || lowerMsg.includes('gps')) {
        setFlowState('ERROR');
        setScanError(rawMsg || 'Location verification failed. Please ensure you are inside the classroom.');
        onGuideChange('Location check failed');
        return;
      }

      if (code === 'section_mismatch' || isSectionMismatch) {
        setFlowState('ERROR');
        setScanError('Not enrolled in this section. Please contact faculty incharge.');
        onGuideChange('Section mismatch — contact faculty');
        return;
      }

      if (code === 'no_active_binding' || lowerMsg.includes('no_active_binding') || lowerMsg.includes('binding_required')) {
        setFlowState('BLOCKED');
        setScanError('This device is not linked. Please enroll this device to record attendance.');
        onGuideChange('Device not linked — enroll below');
        return;
      }

      if (lowerMsg.includes('challenge') && (lowerMsg.includes('expired') || lowerMsg.includes('invalid'))) {
        bindingProofRef.current = null;
        (async () => {
          try {
            const challengeRes: any = await apiRequest('/binding/challenge', {
              method: 'POST', body: JSON.stringify({})
            });
            if (challengeRes?.challenge_token) {
              const sigResult = await signChallenge(challengeRes.challenge_token, studentRoll);
              bindingProofRef.current = {
                challenge_token: challengeRes.challenge_token,
                binding_signature: sigResult.signature_b64,
                device_id: sigResult.device_id
              };
            }
          } catch {}
        })();
        setFlowState('IDLE_SCANNING');
        onGuideChange('Align the QR inside the frame');
        isScanningLockedRef.current = false;
        onNextScanReady();
        return;
      }

      setFlowState('ERROR');
      setScanError(rawMsg || 'Unable to mark attendance. Please try again.');
      onGuideChange('Scan failed — please try again');
    } finally {
      setIsSubmitting(false);
      inFlightTokenStepRef.current = null;
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
    isSubmitting,
    onGuideChange,
    onNextScanReady,
    onStopCamera,
    studentGeoRef,
    studentInfo.roll_number,
    studentRoll,
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
        setFlowState('IDLE_SCANNING');
        onGuideChange('Device enrolled securely! Rescan the attendance QR now.');
        triggerFeedback(true);
      } else {
        throw new Error(res?.detail?.message || res?.message || 'Device enrollment rejected by server.');
      }
    } catch (err: any) {
      if (err?.name === 'AbortError' || enrollAbortCtrl.signal.aborted) {
        setScanError('Device enrollment timed out. Please check connection and try again.');
      } else {
        setScanError(err.message || 'Inline enrollment failed. Please try again.');
      }
      setFlowState('ERROR');
    } finally {
      clearTimeout(enrollTimeoutId);
      setIsInlineEnrolling(false);
    }
  }, [onGuideChange, studentInfo.roll_number, studentRoll, triggerFeedback]);

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
        setFlowState('IDLE_SCANNING');
        onGuideChange('New device verified & linked! Rescan the attendance QR now.');
        triggerFeedback(true);
      } else {
        throw new Error(res?.detail?.message || res?.message || 'Rebind verification failed.');
      }
    } catch (err: any) {
      setRebindOtpError(err.message || 'Invalid verification code. Please try again.');
    } finally {
      setIsSubmittingRebindOtp(false);
    }
  }, [cachedEnrollPayload, onGuideChange, rebindOtpValue, triggerFeedback]);

  const handleResendRebindOtp = useCallback(async () => {
    try {
      setRebindOtpError(null);
      await apiRequest('/binding/request-rebind-otp', { method: 'POST' });
      onGuideChange('New verification code sent to your email.');
    } catch (err: any) {
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
    setIsSubmitting(false);
    setFlowState('IDLE_SCANNING');
    isScanningLockedRef.current = false;
    onGuideChange('Submission cancelled — scan again');
  }, [onGuideChange]);

  const resetAfterTimeoutOrStale = useCallback(() => {
    setFlowState('IDLE_SCANNING');
    setScanError(null);
    onGuideChange('Align the QR inside the frame');
    lastExpiredPayloadRef.current = null;
    lastExpiredStepRef.current = null;
    isScanningLockedRef.current = false;
    onNextScanReady();
  }, [onGuideChange, onNextScanReady]);

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
    flowState,
    setFlowState,
    isSubmitting,
    scanError,
    setScanError,
    scanErrorCode,
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
