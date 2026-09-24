import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import jsQR from 'jsqr';
import { 
  X, Camera, CheckCircle, AlertTriangle, RefreshCw,
  Clock, WifiOff, Flashlight, User, KeyRound, ShieldCheck,
  Copy, ExternalLink, Globe
} from 'lucide-react';
import { apiRequest } from '../services/api';
import { PwaInstallGuard } from './PwaInstallGuard';
import { scannerTelemetry } from '../services/scannerTelemetry';
import { FailureErrorType, DisplayType } from '../types/telemetry';
import { decodeFrame, getActiveScannerEngine, syncScannerEngineFromServer, ScannerEngine } from '../services/qrEngine';
import { initWasmScanner } from '../services/wasmScanner';
import { offlineSubmissionQueue } from '../services/offlineSubmissionQueue';
import { BINDING_V2_ENABLED, signChallenge, getBindingState, generateKeyPair, commitBindingRecord } from '../services/binding';
import { PostAttendanceSelfieModal } from './PostAttendanceSelfieModal';

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

interface StudentClassScannerModalProps {
  onClose: () => void;
  onScanComplete: (result?: any) => void;
  displayType?: DisplayType;
  studentRoll?: string;
}

export const StudentClassScannerModal: React.FC<StudentClassScannerModalProps> = ({
  onClose,
  onScanComplete,
  displayType = 'projector',
  studentRoll
}) => {
  const [flowState, setFlowState] = useState<ScannerFlowState>('INITIALIZING');
  const inFlightTokenStepRef = useRef<number | null>(null);
  const inFlightTokenStrRef = useRef<string | null>(null);
  const failedTokensCacheRef = useRef<Map<string, number>>(new Map());
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isOfflineQueued, setIsOfflineQueued] = useState<boolean>(false);
  const [queuedSessionInfo, setQueuedSessionInfo] = useState<any>(null);
  const [pendingQueueCount, setPendingQueueCount] = useState<number>(0);
  const [cachedSessionHint, setCachedSessionHint] = useState<any>(null);
  const [isRetryingQueue, setIsRetryingQueue] = useState<boolean>(false);
  const [successResult, setSuccessResult] = useState<any>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState<boolean>(!navigator.onLine);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');

  // Dynamic Camera Capabilities
  const [hasZoomCapability, setHasZoomCapability] = useState<boolean>(false);
  const [zoomRange, setZoomRange] = useState<{ min: number; max: number; step: number }>({ min: 1, max: 1, step: 0.1 });
  const [currentZoom, setCurrentZoom] = useState<number>(1);
  const [autoZoomEnabled, setAutoZoomEnabled] = useState<boolean>(true);
  const [hasTorchCapability, setHasTorchCapability] = useState<boolean>(false);
  const [torchActive, setTorchActive] = useState<boolean>(false);

  // Dynamic Visual Guidance Text
  const [guideText, setGuideText] = useState<string>('Align the QR inside the frame');
  const [permissionState, setPermissionState] = useState<'prompt' | 'granted' | 'denied' | 'insecure_origin' | 'unknown'>('unknown');

  // iOS & Specific Browser Detection for Context-Aware Permission Rescue
  const browserInfo = useMemo(() => {
    if (typeof navigator === 'undefined') return { isIOS: false, name: 'Browser', isBrave: false, isSafari: true };
    const ua = navigator.userAgent || '';
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isBrave = !!(navigator as any).brave?.isBrave || /Brave/i.test(ua);
    const isChromeIOS = /CriOS/i.test(ua);
    const isFirefoxIOS = /FxiOS/i.test(ua);
    const isEdgeIOS = /EdgiOS/i.test(ua);
    const isSafari = isIOS && !isBrave && !isChromeIOS && !isFirefoxIOS && !isEdgeIOS;

    let name = 'Safari';
    if (isBrave) name = 'Brave';
    else if (isChromeIOS) name = 'Chrome';
    else if (isFirefoxIOS) name = 'Firefox';
    else if (isEdgeIOS) name = 'Edge';
    else if (!isIOS) name = 'Browser';

    return { isIOS, name, isBrave, isChromeIOS, isFirefoxIOS, isSafari };
  }, []);

  const [copiedSafariLink, setCopiedSafariLink] = useState<boolean>(false);
  const handleCopySafariLink = () => {
    try {
      navigator.clipboard.writeText(window.location.href);
      setCopiedSafariLink(true);
      setTimeout(() => setCopiedSafariLink(false), 3000);
    } catch {
      // fallback
    }
  };

  // Authorized debug mode flag: only active if explicitly requested via ?debug=1 or localStorage
  const isDebugMode = typeof window !== 'undefined' && (
    new URLSearchParams(window.location.search).get('debug') === '1' ||
    localStorage.getItem('scanner_debug') === '1'
  );
  const [diagHud, setDiagHud] = useState<{
    cam: string; eng: string; qr: string; url: string; submit: string;
  }>({ cam: 'INIT', eng: '-', qr: 'SEARCHING', url: '-', submit: 'IDLE' });
  const diagHudRef = useRef<{ cam: string; eng: string; qr: string; url: string; submit: string }>({ cam: 'INIT', eng: '-', qr: 'SEARCHING', url: '-', submit: 'IDLE' });

  // Lifecycle & Permission Refs
  const isMountedRef = useRef<boolean>(true);
  const permStatusRef = useRef<PermissionStatus | null>(null);

  // 3. Scanner: Track last expired and failed payloads to prevent rapid duplicate frame submissions
  const lastExpiredPayloadRef = useRef<string | null>(null);
  const lastFailedPayloadRef = useRef<string | null>(null);
  const lastExpiredStepRef = useRef<number | null>(null);
  const currentAbortCtrlRef = useRef<AbortController | null>(null);
  const rateLimitCooldownTimerRef = useRef<any>(null);
  const [rateLimitSecondsLeft, setRateLimitSecondsLeft] = useState<number>(0);
  const [scanErrorCode, setScanErrorCode] = useState<string | null>(null);

  // Pre-cached binding proof — computed once at mount, not per-scan
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
  const hasSoftRestartedRef = useRef<boolean>(false);

  // Stage 5 & Stage 6: GPS Geofence, Controlled Fallback & Post-Attendance Selfie
  const [showSelfieModal, setShowSelfieModal] = useState<boolean>(false);
  const [selfieAttendanceId, setSelfieAttendanceId] = useState<number | null>(null);
  const [showFallbackInput, setShowFallbackInput] = useState<boolean>(false);
  const [fallbackCode, setFallbackCode] = useState<string>('');
  const [fallbackSubmitting, setFallbackSubmitting] = useState<boolean>(false);
  const [fallbackError, setFallbackError] = useState<string | null>(null);
  const studentGeoRef = useRef<{ latitude: number; longitude: number; accuracy_m: number } | null>(null);

  const getStudentGeolocation = useCallback((): Promise<{ latitude?: number; longitude?: number; accuracy_m?: number }> => {
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !navigator.geolocation) {
        return resolve({});
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy_m: pos.coords.accuracy
          };
          studentGeoRef.current = coords;
          resolve(coords);
        },
        (err) => {
          console.warn('[Student GPS] Location acquisition warning:', err.message);
          resolve({});
        },
        { enableHighAccuracy: true, timeout: 6000, maximumAge: 10000 }
      );
    });
  }, []);

  useEffect(() => {
    getStudentGeolocation();
  }, [getStudentGeolocation]);

  const handleFallbackSubmit = async () => {
    const code = fallbackCode.trim();
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
      if (res.attendance_id) {
        setSelfieAttendanceId(res.attendance_id);
      }
      setShowFallbackInput(false);
      setShowHelpSheet(false);
      stopCamera();
    } catch (err: any) {
      const msg = err.message || '';
      const lower = msg.toLowerCase();
      if (lower.includes('not enrolled in this section') || (lower.includes('section') && (lower.includes('enrolled') || lower.includes('belong') || lower.includes('mismatch')))) {
        setFallbackError('Not enrolled in this section. Please contact faculty incharge.');
      } else {
        setFallbackError(err.message || 'Controlled fallback verification failed.');
      }
    } finally {
      setFallbackSubmitting(false);
    }
  };

  const handleInlineEnroll = async () => {
    setIsInlineEnrolling(true);
    setFlowState('ENROLLING');
    setRebindOtpError(null);
    setScanError(null);
    const enrollAbortCtrl = new AbortController();
    const enrollTimeoutId = setTimeout(() => enrollAbortCtrl.abort(), 6500);

    try {
      const activeRoll = studentRoll || studentInfo.roll_number || (localStorage.getItem('user') ? JSON.parse(localStorage.getItem('user') || '{}').roll_number : '');
      // Generate keypair with deferred commitment (autoCommit = false)
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
        setGuideText('Verification code sent to your email to link this device.');
        return;
      }

      if (res?.status === 'DEVICE_ENROLLED' || res?.message?.toLowerCase().includes('enrolled')) {
        // Commit to persistent IndexedDB ONLY upon server confirmation!
        if (payload.stored_record) {
          await commitBindingRecord(payload.stored_record);
        }
        setScanError(null);
        setScanErrorCode(null);
        setRebindOtpRequired(false);
        isScanningLockedRef.current = false;
        setIsSubmitting(false);
        setFlowState('IDLE_SCANNING');
        setGuideText('Device enrolled securely! Rescan the attendance QR now.');
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
  };

  const handleConfirmRebindOtp = async () => {
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
        // Commit to persistent IndexedDB upon OTP confirmation
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
        setGuideText('New device verified & linked! Rescan the attendance QR now.');
        triggerFeedback(true);
      } else {
        throw new Error(res?.detail?.message || res?.message || 'Rebind verification failed.');
      }
    } catch (err: any) {
      setRebindOtpError(err.message || 'Invalid verification code. Please try again.');
    } finally {
      setIsSubmittingRebindOtp(false);
    }
  };

  const handleResendRebindOtp = async () => {
    try {
      setRebindOtpError(null);
      await apiRequest('/binding/request-rebind-otp', { method: 'POST' });
      setGuideText('New verification code sent to your email.');
    } catch (err: any) {
      setRebindOtpError(err.message || 'Failed to resend code. Please try again.');
    }
  };

  // Week 8: Degradation Ladder & Acquisition Hardening States
  const [showHelpSheet, setShowHelpSheet] = useState<boolean>(false);
  const [showRollCard, setShowRollCard] = useState<boolean>(false);
  const [studentInfo, setStudentInfo] = useState<{ roll_number: string; name: string; section: string }>({ roll_number: '', name: '', section: '' });
  const [cameraStarting, setCameraStarting] = useState<boolean>(false);
  const [recoveryBrowser, setRecoveryBrowser] = useState<'chrome' | 'ios'>('chrome');
  const [isCameraInUse, setIsCameraInUse] = useState<boolean>(false);
  const [secondsScanning, setSecondsScanning] = useState<number>(0);

  // Strict Single-Instance Refs (No Memory Leaks / No Zombie Loops)
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);
  const isScanningLockedRef = useRef<boolean>(false);
  const barcodeDetectorRef = useRef<any>(null);
  const wakeLockRef = useRef<any>(null);

  // Frame Budget & Back-Pressure Instrumentation (Week 6)
  const isDecodingRef = useRef<boolean>(false);
  const framesCapturedRef = useRef<number>(0);
  const framesDecodedRef = useRef<number>(0);
  const framesSkippedRef = useRef<number>(0);
  const lastDecodeMsRef = useRef<number>(0);
  const totalDecodeMsRef = useRef<number>(0);
  const activeEngineRef = useRef<ScannerEngine>(getActiveScannerEngine());

  // Dynamic Resolution Ladder & Multi-QR Tracking (Week 7)
  const consecutiveMissesRef = useRef<number>(0);
  const frameAttemptCounterRef = useRef<number>(0);
  const lastDecodeScaleRef = useRef<number>(640);
  const lastTapTimeRef = useRef<number>(0);

  // Decode Throttling & Auto-Zoom Timing Refs (~8-10 fps execution)
  const lastDecodeTimeRef = useRef<number>(0);
  const scanStartTimeRef = useRef<number>(Date.now());
  const DECODE_INTERVAL_MS = 110; // Throttle to ~9 fps to ensure low-end chipset friendliness

  // Touch gesture pinch-to-zoom tracking
  const pinchStartDistanceRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef<number>(1);

  // Scan Funnel Telemetry Refs (Week 1 Instrumentation)
  const pageOpenTimeRef = useRef<number>(Date.now());
  const permissionReqTimeRef = useRef<number>(0);
  const cameraOpenTimeRef = useRef<number>(0);
  const firstFrameTimeRef = useRef<number>(0);
  const frameDecodedTimeRef = useRef<number>(0);
  const tokenSubmitTimeRef = useRef<number>(0);
  const attemptCountRef = useRef<number>(1);
  const hasCapturedFirstFrameRef = useRef<boolean>(false);
  const decodeWatchdogTimerRef = useRef<any>(null);
  const sessionIdRef = useRef<string>('');

  // Funnel Stage: scan_page_opened & timer cleanup
  useEffect(() => {
    // Eagerly pre-warm WASM runtime in parallel while camera initializes
    initWasmScanner().catch(() => {});

    syncScannerEngineFromServer()
      .then((eng) => {
        activeEngineRef.current = eng;
      })
      .catch(() => {});
    scannerTelemetry.recordStage('scan_page_opened', undefined, undefined, undefined, displayType, undefined, undefined, activeEngineRef.current);
    return () => {
      if (rateLimitCooldownTimerRef.current) {
        clearInterval(rateLimitCooldownTimerRef.current);
      }
    };
  }, []);

  // Pre-cache Binding V2 proof at mount (not per-scan)
  // The challenge/sign pipeline takes 100-500ms network + 10-30ms crypto.
  // Running it once at mount removes this latency from every scan.
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
    return () => { cancelled = true; };
  }, [studentRoll]);

  // Week 8: Load student profile for Rung 4 / 5 manual mark handoff
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
      .then(prof => {
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

  // Online/Offline network state listener + Offline queue subscription
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
    };
  }, []);

  // Sound and Haptic feedback: 2 short pulses for success, 3 distinct pulses for error
  const triggerFeedback = (isSuccess: boolean) => {
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
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // ═══════════════════════════════════════════════════════════════════════════
  // SAFE QR DATA PARSER — Treats QR purely as attendance data payload.
  // NEVER performs browser navigation, window.open, or location redirects.
  // ═══════════════════════════════════════════════════════════════════════════
  interface ParsedQrPayload {
    token: string;
    sourceType: 'launch_url' | 'launch_path' | 'short_code' | 'legacy' | 'raw_token';
  }

  /**
   * Robust step counter & session extractor for rotating QR tokens.
   * Recognizes:
   * - Crockford URL query ?s=...&v=123 or ?v=123
   * - Base64 URL-safe launch tokens: {session_id}:{short_code}:{v}:{nonce}:{exp_ts}:{hmac}
   */
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

    // 1. Full HTTPS / HTTP URL (e.g. https://ather-os.de5.net/a/<token>)
    if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
      try {
        const url = new URL(trimmed);
        // Protocol guard: only accept https: (or http: in local dev/testing)
        if (url.protocol !== 'https:' && url.protocol !== 'http:') {
          return null;
        }

        // Check for /a/<token> launch URL pattern
        if (url.pathname.includes('/a/')) {
          const match = url.pathname.match(/\/a\/([A-Za-z0-9_-]{10,})/);
          if (match && match[1]) {
            return { token: match[1], sourceType: 'launch_url' };
          }
        }

        // Check for query parameters (?token=... or ?session_token=...)
        const tokenParam = url.searchParams.get('token') || url.searchParams.get('session_token');
        if (tokenParam && tokenParam.length >= 10) {
          return { token: tokenParam, sourceType: 'launch_url' };
        }

        // Check for ?s=... Crockford short code
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

    // 2. Relative launch path: /a/<token>
    if (trimmed.startsWith('/a/')) {
      const rawToken = trimmed.slice('/a/'.length).split(/[?#]/)[0];
      if (rawToken.length >= 10) {
        return { token: rawToken, sourceType: 'launch_path' };
      }
    }

    // 3. Short code query string (?s=... or s=...)
    if (trimmed.includes('s=') && (trimmed.includes('v=') || trimmed.length <= 30)) {
      return { token: trimmed, sourceType: 'short_code' };
    }

    // 4. Legacy format (S|... or SNIST-SES|...)
    if (trimmed.startsWith('S|') || trimmed.startsWith('SNIST-SES|')) {
      return { token: trimmed, sourceType: 'legacy' };
    }

    // 5. Raw token string (Base64 launch token or Crockford code)
    if (/^[A-Za-z0-9_-]{6,}$/.test(trimmed)) {
      return {
        token: trimmed,
        sourceType: trimmed.length >= 30 ? 'raw_token' : 'short_code'
      };
    }

    return null;
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // THIN CLIENT handleScanSuccess — Detect → Extract Token → Submit → Show Result
  //
  // ALL security validation lives on the server (HMAC, expiry, binding, GPS).
  // The client only:
  //   1. Parses the QR string as data (NEVER navigates browser)
  //   2. Concurrency-locks against duplicate submissions
  //   3. Immediately POSTs the extracted token to the attendance API
  //   4. Shows the result in-modal
  // ═══════════════════════════════════════════════════════════════════════════
  const handleScanSuccess = async (decodedText: string, engineUsed?: ScannerEngine) => {
    // Concurrency guard: Ignore duplicate frames if already submitting or locked
    if (isScanningLockedRef.current || isSubmitting) return;

    const trimmed = decodedText.trim();
    if (!trimmed || trimmed.length < 6) return;

    // Parse payload safely as DATA — NEVER navigate browser to the QR text
    const parsed = parseAttendanceQrPayload(trimmed);
    if (!parsed || !parsed.token) {
      console.warn('[QR] Unrecognized QR structure:', trimmed.slice(0, 40));
      setScanError('QR not recognized. Please scan the current classroom QR.');
      setGuideText('QR not recognized — scan classroom QR');
      setFlowState('ERROR');
      triggerFeedback(false);
      return;
    }

    const payloadToken = parsed.token;
    const { step: scannedStep } = extractPayloadStep(trimmed.includes('?') ? trimmed : payloadToken);

    // 1. Step-level freshness guard: if we know the token belongs to an expired rotation step, reject client-side!
    if (scannedStep != null && lastExpiredStepRef.current != null) {
      if (scannedStep <= lastExpiredStepRef.current) {
        setGuideText('Old QR — waiting for the projector to refresh');
        diagHudRef.current = { ...diagHudRef.current, qr: 'FOUND', submit: 'WAIT_REFRESH' };
        if (isDebugMode) setDiagHud({ ...diagHudRef.current });
        setFlowState('STALE_QR');
        return;
      } else {
        // Step has advanced! Clear expired trackers because we have a genuinely fresh token!
        lastExpiredStepRef.current = null;
        lastExpiredPayloadRef.current = null;
        lastFailedPayloadRef.current = null;
      }
    }

    // 2. Exact token payload guard: Never resubmit a payload that just failed or expired until the projector QR refreshes
    if (
      payloadToken === lastExpiredPayloadRef.current || trimmed === lastExpiredPayloadRef.current ||
      payloadToken === lastFailedPayloadRef.current || trimmed === lastFailedPayloadRef.current
    ) {
      setGuideText('Waiting for classroom QR to refresh...');
      diagHudRef.current = { ...diagHudRef.current, qr: 'FOUND', submit: 'WAIT_REFRESH' };
      if (isDebugMode) setDiagHud({ ...diagHudRef.current });
      setFlowState('STALE_QR');
      return;
    }

    // 3. Deduplication window check: If this exact token failed/timed out in last 12s, reject client-side
    const now = Date.now();
    const lastFailedAt = failedTokensCacheRef.current.get(payloadToken);
    if (lastFailedAt && (now - lastFailedAt < 12000)) {
      setGuideText('Waiting for classroom QR to refresh...');
      setFlowState('STALE_QR');
      return;
    }

    // When a fresh payload is detected, clear the expired and failed trackers
    lastExpiredPayloadRef.current = null;
    lastFailedPayloadRef.current = null;

    // Cancel decode watchdog
    if (decodeWatchdogTimerRef.current) {
      clearTimeout(decodeWatchdogTimerRef.current);
      decodeWatchdogTimerRef.current = null;
    }

    // Lock scanner atomically before making network request
    isScanningLockedRef.current = true;
    setIsSubmitting(true);
    setFlowState('SUBMITTING');
    inFlightTokenStepRef.current = scannedStep;
    inFlightTokenStrRef.current = payloadToken;
    setScanError(null);
    setScanErrorCode(null);
    setGuideText('Submitting Attendance…');
    console.log(`[QR] Token extracted (${payloadToken.length}ch, type=${parsed.sourceType}) — submitting directly to attendance API`);
    diagHudRef.current = { ...diagHudRef.current, qr: 'FOUND', submit: 'SENDING…' };
    if (isDebugMode) setDiagHud({ ...diagHudRef.current });

    // Offline fast-path: queue to IndexedDB without any network call
    if (!navigator.onLine) {
      try {
        await offlineSubmissionQueue.enqueue({
          client_id: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          session_token: payloadToken
        });
        triggerFeedback(true);
        stopCamera();
        setIsOfflineQueued(true);
        setQueuedSessionInfo({
          token: payloadToken,
          sessionPreview: 'Class Session',
          queuedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });
        diagHudRef.current = { ...diagHudRef.current, submit: 'QUEUED OFFLINE' };
        if (isDebugMode) setDiagHud({ ...diagHudRef.current });
      } catch {
        isScanningLockedRef.current = false;
        setIsSubmitting(false);
        setFlowState('IDLE_SCANNING');
      }
      return;
    }

    let isSuccess = false;
    try {
      // Use pre-cached GPS (acquired at mount, never blocks scan)
      const geo = studentGeoRef.current;
      // Use pre-cached binding proof (signed at mount, never blocks scan)
      const binding = bindingProofRef.current;

      // 4.0-second submission watchdog: Prevents client from lagging behind 10s QR rotation interval.
      // On timeout or slow network, aborts instantly, discards stale token, and transitions state cleanly.
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
          setGuideText('Timed out — waiting for refreshed QR');
          diagHudRef.current = { ...diagHudRef.current, submit: 'TIMEOUT 4s' };
          if (isDebugMode) setDiagHud({ ...diagHudRef.current });
          setTimeout(() => {
            if (!rateLimitCooldownTimerRef.current && isMountedRef.current) {
              isScanningLockedRef.current = false;
              if (mediaStreamRef.current) {
                animationFrameIdRef.current = requestAnimationFrame(processFrame);
              }
            }
          }, 1500);
          return;
        }
        throw abortErr; // Re-throw non-abort errors to the outer catch
      } finally {
        clearTimeout(timeoutId);
        currentAbortCtrlRef.current = null;
      }

      // ── Success! ──
      isSuccess = true;
      inFlightTokenStepRef.current = null;
      inFlightTokenStrRef.current = null;
      setIsSubmitting(false);
      setFlowState('SUCCESS');
      console.log('[QR] Server response: SUCCESS —', res?.status || 'MARKED');
      diagHudRef.current = { ...diagHudRef.current, qr: 'FOUND', submit: 'SUCCESS ✓' };
      if (isDebugMode) setDiagHud({ ...diagHudRef.current });

      // Cache session hint for offline resilience (fire-and-forget)
      try {
        offlineSubmissionQueue.saveCachedLastSession({
          subject_name: res.subject_name || 'Class Session',
          session_id: res.session_id,
          session_date: res.session_date || new Date().toISOString().split('T')[0],
          period_count: res.period_count || 1
        });
      } catch {}

      // Fire-and-forget telemetry (never blocks UI)
      try {
        const totalFromOpen = Date.now() - pageOpenTimeRef.current;
        scannerTelemetry.recordStage('attendance_confirmed', totalFromOpen, res.session_id);
      } catch {}

      triggerFeedback(true);
      setSuccessResult(res);
      if (res.attendance_id) setSelfieAttendanceId(res.attendance_id);
      stopCamera();

    } catch (err: any) {
      // Record failed token immediately so the camera won't immediately refire against this same QR frame
      failedTokensCacheRef.current.set(payloadToken, Date.now());
      lastFailedPayloadRef.current = payloadToken;
      const { step: failedStep } = extractPayloadStep(payloadToken);
      inFlightTokenStepRef.current = null;
      inFlightTokenStrRef.current = null;

      // ── Clean Error Handling ──
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
      diagHudRef.current = { ...diagHudRef.current, qr: 'FOUND', submit: code };
      if (isDebugMode) setDiagHud({ ...diagHudRef.current });

      // HTTP 429 Rate Limiting Cooldown: Lock camera and show countdown
      if (code === 'rate_limited' || err?.status === 429 || lowerMsg.includes('too many scan attempts')) {
        const retrySec = Math.max(1, Number(err?.retry_after || 20));
        isScanningLockedRef.current = true;
        setFlowState('RATE_LIMITED');
        setRateLimitSecondsLeft(retrySec);
        setScanError(`Too many scan attempts. Please wait ${retrySec}s before scanning again.`);
        setGuideText(`Rate limit active — cooldown ${retrySec}s`);

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
            setGuideText('Align the QR inside the frame');
            isScanningLockedRef.current = false;
            if (mediaStreamRef.current && isMountedRef.current) {
              animationFrameIdRef.current = requestAnimationFrame(processFrame);
            }
          } else {
            setRateLimitSecondsLeft(countdown);
            setScanError(`Too many scan attempts. Please wait ${countdown}s before scanning again.`);
            setGuideText(`Rate limit active — cooldown ${countdown}s`);
          }
        }, 1000);
        return;
      }

      // Network failure → save to offline queue
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
          stopCamera();
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
        setGuideText('Session ended — point camera at active QR');
        return;
      }

      if (code === 'QR-OLD' || code === 'expired' || lowerMsg.includes('outdated') || lowerMsg.includes('expired')) {
        lastExpiredPayloadRef.current = payloadToken;
        if (failedStep != null) {
          lastExpiredStepRef.current = Math.max(lastExpiredStepRef.current ?? 0, failedStep);
        }
        setFlowState('STALE_QR');
        setGuideText('Old QR — waiting for the projector to refresh');
        setScanError('The QR on the screen has expired. Waiting for projector rotation. (Code: QR-OLD)');
        return;
      }

      // Already marked (ensuring challenge replay errors are not misidentified as attendance)
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
        stopCamera();
        return;
      }

      // Geofence / Location failure
      if (code === 'geofence_failed' || lowerMsg.includes('location') || lowerMsg.includes('geofence') || lowerMsg.includes('gps')) {
        setFlowState('ERROR');
        setScanError(rawMsg || 'Location verification failed. Please ensure you are inside the classroom.');
        setGuideText('Location check failed');
        return;
      }

      // Section mismatch (student not enrolled in this section)
      if (
        code === 'section_mismatch' ||
        lowerMsg.includes('not enrolled in this section') ||
        lowerMsg.includes('does not belong to class section') ||
        lowerMsg.includes('does not belong to this session') ||
        lowerMsg.includes('faculty incharge') ||
        (lowerMsg.includes('section') && (lowerMsg.includes('enrolled') || lowerMsg.includes('belong') || lowerMsg.includes('mismatch')))
      ) {
        setFlowState('ERROR');
        setScanError('Not enrolled in this section. Please contact faculty incharge.');
        setGuideText('Section mismatch — contact faculty');
        return;
      }

      // Binding not enrolled → show clean device link message & action
      if (code === 'no_active_binding' || lowerMsg.includes('no_active_binding') || lowerMsg.includes('binding_required')) {
        setFlowState('BLOCKED');
        setScanError('This device is not linked. Please enroll this device to record attendance.');
        setGuideText('Device not linked — enroll below');
        return;
      }

      // Binding challenge expired → re-cache proof and unlock for retry
      if (lowerMsg.includes('challenge') && (lowerMsg.includes('expired') || lowerMsg.includes('invalid'))) {
        console.log('[QR] Binding challenge expired — re-caching proof');
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
        setGuideText('Align the QR inside the frame');
        isScanningLockedRef.current = false;
        if (mediaStreamRef.current && isMountedRef.current) {
          animationFrameIdRef.current = requestAnimationFrame(processFrame);
        }
        return;
      }

      // Generic error: never show ERR_FAILED or raw crash
      setFlowState('ERROR');
      setScanError(rawMsg || 'Unable to mark attendance. Please try again.');
      setGuideText('Scan failed — please try again');
    } finally {
      // Release processing lock in a finally block after every API result
      setIsSubmitting(false);
      inFlightTokenStepRef.current = null;
      inFlightTokenStrRef.current = null;
      if (!isSuccess && !rateLimitCooldownTimerRef.current) {
        // Debounce camera frame unlock by 1.5s to allow scanning next rotation promptly
        setTimeout(() => {
          if (!rateLimitCooldownTimerRef.current) {
            isScanningLockedRef.current = false;
            if (mediaStreamRef.current && isMountedRef.current) {
              animationFrameIdRef.current = requestAnimationFrame(processFrame);
            }
          }
        }, 1500);
      }
    }
  };

  // Safe Track Zoom Controller (Clamped to Hardware Limits)
  const applyZoom = async (zoomVal: number) => {
    const stream = mediaStreamRef.current;
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    if (!track) return;

    const clamped = Math.max(zoomRange.min, Math.min(zoomRange.max, zoomVal));
    try {
      if ('applyConstraints' in track) {
        await track.applyConstraints({
          advanced: [{ zoom: clamped } as any]
        });
        setCurrentZoom(clamped);
      }
    } catch (e) {
      console.warn('Hardware zoom constraint not supported on this track:', e);
    }
  };

  // Safe Track Torch Controller
  const toggleTorch = async () => {
    const stream = mediaStreamRef.current;
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    if (!track) return;

    const nextState = !torchActive;
    try {
      if ('applyConstraints' in track) {
        await track.applyConstraints({
          advanced: [{ torch: nextState } as any]
        });
        setTorchActive(nextState);
      }
    } catch (e) {
      console.warn('Torch constraint failed:', e);
    }
  };

  // Auto-Zoom Calculation Loop
  const triggerAutoZoomIfNeeded = (boxFraction: number) => {
    if (!autoZoomEnabled || !hasZoomCapability || zoomRange.max <= 1) return;

    // If QR occupies less than 20% of frame width, compute ideal zoom to fill ~40%
    if (boxFraction > 0.02 && boxFraction < 0.22) {
      const idealZoom = Math.min(zoomRange.max, currentZoom * (0.42 / boxFraction));
      if (idealZoom > currentZoom + 0.3) {
        setGuideText('QR detected — zooming in…');
        applyZoom(idealZoom);
      }
    }
  };

  // Performance-Throttled Decode Loop (~8-10 fps)
  const processFrame = useCallback(async () => {
    if (!isMountedRef.current) return;
    if (isScanningLockedRef.current || isSubmitting) {
      // Do not process or re-request animation frame while submitting or locked
      return;
    }
    const video = videoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      animationFrameIdRef.current = requestAnimationFrame(processFrame);
      return;
    }

    // [QR] Periodic diagnostic log every 60 frames (~7s at 9fps)
    if (framesCapturedRef.current % 60 === 0 && framesCapturedRef.current > 0) {
      console.log(`[QR] Frame stats: captured=${framesCapturedRef.current}, decoded=${framesDecodedRef.current}, skipped=${framesSkippedRef.current}, avgMs=${framesDecodedRef.current > 0 ? Math.round(totalDecodeMsRef.current / framesDecodedRef.current) : 0}, engine=${activeEngineRef.current}, zoom=${currentZoom}`);
    }

    framesCapturedRef.current += 1;
    frameAttemptCounterRef.current += 1;

    // BACK-PRESSURE GUARD (Week 6): If decoder is busy, DROP incoming frame immediately (never queue)
    if (isDecodingRef.current) {
      framesSkippedRef.current += 1;
      animationFrameIdRef.current = requestAnimationFrame(processFrame);
      return;
    }

    if (!hasCapturedFirstFrameRef.current) {
      hasCapturedFirstFrameRef.current = true;
      firstFrameTimeRef.current = performance.now();
      const msSinceCam = cameraOpenTimeRef.current > 0 ? (firstFrameTimeRef.current - cameraOpenTimeRef.current) : 0;
      scannerTelemetry.recordStage('first_frame_captured', msSinceCam, undefined, undefined, displayType, undefined, undefined, activeEngineRef.current);
    }

    const now = performance.now();
    if (now - lastDecodeTimeRef.current < DECODE_INTERVAL_MS) {
      animationFrameIdRef.current = requestAnimationFrame(processFrame);
      return;
    }
    lastDecodeTimeRef.current = now;

    const videoW = video.videoWidth;
    const videoH = video.videoHeight;
    if (!videoW || !videoH) {
      animationFrameIdRef.current = requestAnimationFrame(processFrame);
      return;
    }

    let detectedCandidate = false;

    // Active Engine Resolution
    const currentEng = getActiveScannerEngine();
    activeEngineRef.current = currentEng;

    if (currentEng === 'wasm') {
      // PATH 1: zxing-cpp WASM FRAME PIPELINE (Week 6 & Week 7)
      // FIX: Central 50% ROI crop for distant projector scanning.
      // Previously downscaled the ENTIRE 16:9 frame to 640px, causing distant QR codes
      // to shrink below the readable threshold. Now extracts the central 50% ROI at
      // high resolution (960px) where the student's crosshair is aiming.
      const shouldProbeHigherRes = consecutiveMissesRef.current >= 6 && (frameAttemptCounterRef.current % 3 === 0);
      const MAX_DOWNSCALE_W = shouldProbeHigherRes ? 960 : 640;
      lastDecodeScaleRef.current = MAX_DOWNSCALE_W;

      let canvas = canvasRef.current;
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvasRef.current = canvas;
      }

      // --- PASS A: Central 50% ROI Crop (high-res for distant projectors) ---
      const roiFraction = 0.50;
      const roiSrcW = Math.floor(videoW * roiFraction);
      const roiSrcH = Math.floor(videoH * roiFraction);
      const roiSrcX = Math.floor((videoW - roiSrcW) / 2);
      const roiSrcY = Math.floor((videoH - roiSrcH) / 2);
      // Scale the ROI crop to 960px wide for high-res decoding
      const roiTargetW = Math.min(960, roiSrcW);
      const roiScale = roiTargetW / roiSrcW;
      const roiTargetH = Math.round(roiSrcH * roiScale);

      canvas.width = roiTargetW;
      canvas.height = roiTargetH;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      let decodedInRoi = false;
      if (ctx) {
        // Draw only the central 50% of the video frame, scaled up
        ctx.drawImage(video, roiSrcX, roiSrcY, roiSrcW, roiSrcH, 0, 0, roiTargetW, roiTargetH);
        const roiImgData = ctx.getImageData(0, 0, roiTargetW, roiTargetH);

        isDecodingRef.current = true;
        try {
          const { result, usedEngine } = await decodeFrame(roiImgData, currentEng);
          activeEngineRef.current = usedEngine;
          framesDecodedRef.current += 1;
          lastDecodeMsRef.current = result.ms_taken;
          totalDecodeMsRef.current += result.ms_taken;

          // Multi-QR Guard
          if (result.candidateCount && result.candidateCount > 1) {
            setScanError('Multiple QR codes detected. Please frame only one QR code.');
            setGuideText('Multiple QRs detected — frame single QR');
            scannerTelemetry.recordFailure('multi_code_detected', 'frame_decoded', undefined, { candidate_count: result.candidateCount, scale: roiTargetW }, displayType, undefined, usedEngine);
            triggerFeedback(false);
            animationFrameIdRef.current = requestAnimationFrame(processFrame);
            return;
          }

          if (result.ok) {
            consecutiveMissesRef.current = 0;
            detectedCandidate = true;
            decodedInRoi = true;
            diagHudRef.current = { ...diagHudRef.current, eng: usedEngine.toUpperCase(), qr: `DETECTED (ROI ${result.text?.length || 0}ch)` };
            if (isDebugMode) setDiagHud({ ...diagHudRef.current });
            if (result.boundingBox && roiTargetW > 0) {
              const approxFraction = result.boundingBox.width / roiTargetW;
              triggerAutoZoomIfNeeded(approxFraction);
            }
            if (result.text) {
              console.log(`[QR] QR detected by ${usedEngine} (ROI crop): length=${result.text.length}, ms=${result.ms_taken.toFixed(1)}`);
              handleScanSuccess(result.text, usedEngine);
              return;
            }
          } else {
            consecutiveMissesRef.current += 1;
          }
        } finally {
          isDecodingRef.current = false;
        }
      }

      // --- PASS B: Full-frame downscaled fallback (only if ROI missed) ---
      if (!decodedInRoi && ctx) {
        const scale = videoW > MAX_DOWNSCALE_W ? (MAX_DOWNSCALE_W / videoW) : 1.0;
        const targetW = Math.round(videoW * scale);
        const targetH = Math.round(videoH * scale);
        canvas.width = targetW;
        canvas.height = targetH;
        ctx.drawImage(video, 0, 0, targetW, targetH);
        const imgData = ctx.getImageData(0, 0, targetW, targetH);

        isDecodingRef.current = true;
        try {
          const { result, usedEngine } = await decodeFrame(imgData, currentEng);
          activeEngineRef.current = usedEngine;
          framesDecodedRef.current += 1;
          lastDecodeMsRef.current = result.ms_taken;
          totalDecodeMsRef.current += result.ms_taken;

          if (result.candidateCount && result.candidateCount > 1) {
            setScanError('Multiple QR codes detected. Please frame only one QR code.');
            setGuideText('Multiple QRs detected — frame single QR');
            scannerTelemetry.recordFailure('multi_code_detected', 'frame_decoded', undefined, { candidate_count: result.candidateCount, scale: targetW }, displayType, undefined, usedEngine);
            triggerFeedback(false);
            animationFrameIdRef.current = requestAnimationFrame(processFrame);
            return;
          }

          if (result.ok) {
            consecutiveMissesRef.current = 0;
            detectedCandidate = true;
            diagHudRef.current = { ...diagHudRef.current, eng: usedEngine.toUpperCase(), qr: `DETECTED (FULL ${result.text?.length || 0}ch)` };
            if (isDebugMode) setDiagHud({ ...diagHudRef.current });
            if (result.boundingBox && targetW > 0) {
              const approxFraction = result.boundingBox.width / targetW;
              triggerAutoZoomIfNeeded(approxFraction);
            }
            if (result.text) {
              console.log(`[QR] QR detected by ${usedEngine} (full-frame): length=${result.text.length}, ms=${result.ms_taken.toFixed(1)}`);
              handleScanSuccess(result.text, usedEngine);
              return;
            }
          } else {
            consecutiveMissesRef.current += 1;
          }
        } finally {
          isDecodingRef.current = false;
        }
      }

      // Update HUD on miss
      if (!detectedCandidate) {
        diagHudRef.current = { ...diagHudRef.current, qr: 'SEARCHING' };
        if (isDebugMode && consecutiveMissesRef.current % 15 === 0) {
          setDiagHud({ ...diagHudRef.current });
        }
      }
    } else {
      // PATH 2: DEFAULT jsQR ENGINE PATH (Untouched & 100% Functional)
      // PASS 1: Native BarcodeDetector (Chrome/Android C++ engine)
      if (barcodeDetectorRef.current) {
        try {
          const barcodes = await barcodeDetectorRef.current.detect(video);
          if (barcodes && barcodes.length > 0) {
            // Multi-QR Guard for native detector
            if (barcodes.length > 1) {
              setScanError('Multiple QR codes detected. Please frame only one QR code.');
              setGuideText('Multiple QRs detected — frame single QR');
              scannerTelemetry.recordFailure(
                'multi_code_detected',
                'frame_decoded',
                undefined,
                { candidate_count: barcodes.length },
                displayType,
                undefined,
                'jsqr'
              );
              triggerFeedback(false);
              animationFrameIdRef.current = requestAnimationFrame(processFrame);
              return;
            }
            detectedCandidate = true;
            for (const b of barcodes) {
              // Auto-zoom probe from detected bounding box
              if (b.boundingBox && videoW > 0) {
                const fraction = b.boundingBox.width / videoW;
                triggerAutoZoomIfNeeded(fraction);
              }
              if (b.rawValue) {
                animationFrameIdRef.current = requestAnimationFrame(processFrame);
                handleScanSuccess(b.rawValue, 'jsqr');
                return;
              }
            }
          }
        } catch {
          // Fall through to Pass 2 on detector failure
        }
      }

      // PASS 2 & 3: Single Canvas Buffer for jsQR (Safari / Firefox / Distance Fallback)
      let canvas = canvasRef.current;
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvasRef.current = canvas;
      }

      if (canvas.width !== videoW || canvas.height !== videoH) {
        canvas.width = videoW;
        canvas.height = videoH;
      }

      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(video, 0, 0, videoW, videoH);

        isDecodingRef.current = true;
        const decodeStart = performance.now();
        try {
          // Pass 2: Full-Frame jsQR scan
          const fullImgData = ctx.getImageData(0, 0, videoW, videoH);
          const codeFull = jsQR(fullImgData.data, videoW, videoH, { inversionAttempts: 'dontInvert' });
          const msTaken = Math.max(0.1, performance.now() - decodeStart);
          framesDecodedRef.current += 1;
          lastDecodeMsRef.current = msTaken;
          totalDecodeMsRef.current += msTaken;

          if (codeFull) {
            detectedCandidate = true;
            if (codeFull.location && videoW > 0) {
              const approxWidth = Math.abs(codeFull.location.topRightCorner.x - codeFull.location.topLeftCorner.x);
              triggerAutoZoomIfNeeded(approxWidth / videoW);
            }
            if (codeFull.data) {
              handleScanSuccess(codeFull.data, 'jsqr');
              return;
            }
          }

          // Pass 3: Central 45% ROI Adaptive Software Crop (for distant 10m-30m projectors)
          const roiW = Math.floor(videoW * 0.45);
          const roiH = Math.floor(videoH * 0.45);
          const roiX = Math.floor((videoW - roiW) / 2);
          const roiY = Math.floor((videoH - roiH) / 2);

          const roiImgData = ctx.getImageData(roiX, roiY, roiW, roiH);
          const codeRoi = jsQR(roiImgData.data, roiW, roiH, { inversionAttempts: 'dontInvert' });

          if (codeRoi) {
            detectedCandidate = true;
            if (codeRoi.data) {
              handleScanSuccess(codeRoi.data, 'jsqr');
              return;
            }
          }
        } finally {
          isDecodingRef.current = false;
        }
      }
    }

    // Dynamic Guidance Text Updates
    if (detectedCandidate) {
      setGuideText((prev) => prev !== 'QR detected — hold steady…' ? 'QR detected — hold steady…' : prev);
    } else {
      setGuideText((prev) => prev !== 'Align the QR inside the frame' ? 'Align the QR inside the frame' : prev);
    }

    // Schedule next throttled frame
    animationFrameIdRef.current = requestAnimationFrame(processFrame);
  }, [autoZoomEnabled, hasZoomCapability, zoomRange, currentZoom, hasTorchCapability, torchActive]);

  // Part A.2: getUserMedia Constraint Ladder Rungs
  const CAMERA_LADDER_RUNGS: MediaStreamConstraints[] = [
    // Rung 1: Ideal 720p landscape environment camera (no min framerate constraint to prevent Safari OverconstrainedError)
    {
      audio: false,
      video: {
        facingMode: { ideal: facingMode },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    },
    // Rung 2: Basic environment camera without dimension constraints
    {
      audio: false,
      video: {
        facingMode: { ideal: facingMode }
      }
    },
    // Rung 3: Absolute fallback: any available video device
    {
      audio: false,
      video: true
    }
  ];

  // Robust Video Stream Setup & Playback for iOS Safari & Android
  const playVideoStream = useCallback(async (video: HTMLVideoElement, stream: MediaStream): Promise<void> => {
    console.log('[Scanner] video element found');
    try {
      video.setAttribute('autoplay', 'true');
      video.setAttribute('muted', 'true');
      video.setAttribute('playsinline', 'true');
      video.setAttribute('webkit-playsinline', 'true');
      video.playsInline = true;
      video.autoplay = true;
      video.muted = true;

      if (video.srcObject !== stream) {
        video.srcObject = stream;
        console.log('[Scanner] stream attached');
      }

      // Ensure video metadata and dimensions are loaded before calling play()
      await new Promise<void>((resolve) => {
        if (video.readyState >= 1 && video.videoWidth > 0 && video.videoHeight > 0) {
          console.log('[Scanner] metadata loaded');
          console.log(`[Scanner] video dimensions: ${video.videoWidth}x${video.videoHeight}`);
          resolve();
          return;
        }

        let resolved = false;
        const onLoaded = () => {
          if (!resolved) {
            resolved = true;
            video.removeEventListener('loadedmetadata', onLoaded);
            video.removeEventListener('canplay', onLoaded);
            console.log('[Scanner] metadata loaded');
            console.log(`[Scanner] video dimensions: ${video.videoWidth}x${video.videoHeight}`);
            resolve();
          }
        };

        video.addEventListener('loadedmetadata', onLoaded, { once: true });
        video.addEventListener('canplay', onLoaded, { once: true });

        // Safety fallback: don't hang indefinitely if browser delays metadata event
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            video.removeEventListener('loadedmetadata', onLoaded);
            video.removeEventListener('canplay', onLoaded);
            console.log('[Scanner] metadata loaded (timeout fallback)');
            console.log(`[Scanner] video dimensions: ${video.videoWidth}x${video.videoHeight}`);
            resolve();
          }
        }, 2000);
      });

      // Now start playback with playsInline & muted verified
      try {
        await video.play();
        console.log('[Scanner] video playing');
      } catch (playErr) {
        console.warn('[Scanner] video.play() caught:', playErr);
        // Fallback for strict browser autoplay policies: play on first user touch
        const onUserInteraction = () => {
          if (videoRef.current) {
            videoRef.current.play()
              .then(() => console.log('[Scanner] video playing (touch resumed)'))
              .catch(() => {});
          }
          window.removeEventListener('touchstart', onUserInteraction);
          window.removeEventListener('click', onUserInteraction);
        };
        window.addEventListener('touchstart', onUserInteraction, { once: true });
        window.addEventListener('click', onUserInteraction, { once: true });
      }

      console.log(`[Scanner] video dimensions: ${video.videoWidth}x${video.videoHeight}, readyState=${video.readyState}`);
    } catch (e) {
      console.warn('[Scanner] playVideoStream error:', e);
    }
  }, []);

  // Callback ref to attach stream whenever the video node mounts/updates
  const attachVideoRef = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    if (node && mediaStreamRef.current) {
      playVideoStream(node, mediaStreamRef.current);
    }
  }, [playVideoStream]);

  // Part A.3: Camera-Open Watchdog (>8s abort + retry next rung)
  const getUserMediaWithTimeout = (constraints: MediaStreamConstraints, timeoutMs: number = 8000): Promise<MediaStream> => {
    return new Promise((resolve, reject) => {
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        const err = new Error('CAMERA_OPEN_TIMEOUT');
        err.name = 'CameraOpenTimeoutError';
        reject(err);
      }, timeoutMs);

      navigator.mediaDevices.getUserMedia(constraints)
        .then((stream) => {
          if (!timedOut) {
            clearTimeout(timer);
            resolve(stream);
          } else {
            // Late arrival after watchdog aborted; stop tracks cleanly to avoid zombie indicator
            stream.getTracks().forEach((t) => {
              try { t.stop(); } catch {}
            });
          }
        })
        .catch((err) => {
          if (!timedOut) {
            clearTimeout(timer);
            reject(err);
          }
        });
    });
  };

  // Camera Lifecycle Start with Constraint Ladder & Watchdog
  const startCamera = async (targetRung: number = 1) => {
    try {
      setCameraStarting(true);
      setCameraError(null);
      setIsCameraInUse(false);
      stopCamera();
      scanStartTimeRef.current = Date.now();
      setGuideText('Point your camera at the attendance QR');

      // Part A.1: Insecure origin detection (HTTP on non-localhost)
      if (typeof window !== 'undefined' && !window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        setPermissionState('insecure_origin');
        setCameraStarting(false);
        setCameraError('Camera access requires HTTPS or localhost. Current origin is not secure.');
        scannerTelemetry.recordFailure('insecure_origin', 'camera_permission_requested', sessionIdRef.current, { origin: window.location.origin }, displayType);
        return;
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraStarting(false);
        setCameraError('Browser does not support mediaDevices.getUserMedia. Please open in Chrome or Safari.');
        scannerTelemetry.recordFailure('camera_unavailable', 'camera_permission_requested', sessionIdRef.current, { reason: 'mediaDevices_missing' }, displayType);
        return;
      }

      // Check native BarcodeDetector support
      if ('BarcodeDetector' in window) {
        try {
          const supportedFormats = await (window as any).BarcodeDetector.getSupportedFormats();
          if (supportedFormats.includes('qr_code')) {
            barcodeDetectorRef.current = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
            console.log('[Scanner] QR decoder initialized (native BarcodeDetector)');
          }
        } catch {
          barcodeDetectorRef.current = null;
        }
      } else {
        barcodeDetectorRef.current = null;
        console.log('[Scanner] QR decoder initialized (WASM / jsQR)');
      }

      permissionReqTimeRef.current = performance.now();
      console.log('[Scanner] requesting camera');
      scannerTelemetry.recordStage('camera_permission_requested', undefined, sessionIdRef.current, undefined, displayType);

      let stream: MediaStream | null = null;
      let usedRung = targetRung;
      for (let r = targetRung; r <= 3; r++) {
        usedRung = r;
        try {
          stream = await getUserMediaWithTimeout(CAMERA_LADDER_RUNGS[r - 1], 8000);
          if (!isMountedRef.current) {
            if (stream) {
              stream.getTracks().forEach((t) => {
                try { t.stop(); } catch {}
              });
            }
            return;
          }
          if (stream) break;
        } catch (rungErr: any) {
          console.warn(`[Scanner] Camera ladder constraint rung ${r} failed:`, rungErr?.name || rungErr);
          if (rungErr?.name === 'CameraOpenTimeoutError') {
            scannerTelemetry.recordCameraOpenTimeout(r, sessionIdRef.current);
          }
          if (rungErr?.name === 'NotAllowedError' || rungErr?.name === 'PermissionDeniedError') {
            throw rungErr;
          }
          if (rungErr?.name === 'NotReadableError' || rungErr?.name === 'TrackStartError') {
            setIsCameraInUse(true);
            throw rungErr;
          }
          if (r === 3) throw rungErr;
        }
      }

      if (!isMountedRef.current) {
        if (stream) {
          stream.getTracks().forEach((t) => {
            try { t.stop(); } catch {}
          });
        }
        return;
      }

      if (!stream) {
        throw new Error('Unable to initialize device camera stream.');
      }

      const permDuration = performance.now() - permissionReqTimeRef.current;
      console.log('[Scanner] permission result: GRANTED');
      scannerTelemetry.recordStage('camera_permission_result', permDuration, sessionIdRef.current, { granted: true, constraint_ladder_rung: usedRung }, displayType);
      setPermissionState('granted');

      const vTracks = stream.getVideoTracks();
      console.log(`[Scanner] stream acquired (${vTracks.length} video tracks, active=${stream.active})`);
      if (vTracks[0]) {
        const track = vTracks[0];
        console.log(`[Scanner] primary video track: ${track.label}, readyState=${track.readyState}, enabled=${track.enabled}, muted=${track.muted}`);
        try {
          const settings = track.getSettings();
          console.log(`[Scanner] videoTrack settings: ${settings.width}x${settings.height}, facingMode=${settings.facingMode}`);
        } catch {}
      }

      mediaStreamRef.current = stream;

      if (videoRef.current) {
        await playVideoStream(videoRef.current, stream);
      }

      cameraOpenTimeRef.current = performance.now();
      const camMs = cameraOpenTimeRef.current - permissionReqTimeRef.current;
      hasCapturedFirstFrameRef.current = false;
      frameDecodedTimeRef.current = 0;
      scannerTelemetry.recordStage('camera_opened', camMs, sessionIdRef.current, { constraint_ladder_rung: usedRung }, displayType);

      // Start 15-second decode watchdog timer
      if (decodeWatchdogTimerRef.current) clearTimeout(decodeWatchdogTimerRef.current);
      decodeWatchdogTimerRef.current = setTimeout(() => {
        if (!frameDecodedTimeRef.current) {
          scannerTelemetry.recordFailure('decode_timeout', 'camera_opened', sessionIdRef.current, {
            elapsed_ms: 15000,
            constraint_ladder_rung: usedRung
          }, displayType);
        }
      }, 15000);

      // Probe track capabilities safely
      const track = stream.getVideoTracks()[0];
      if (track) {
        track.onended = () => {
          console.warn('[Camera] Track ended unexpectedly.');
          setCameraActive(false);
          setCameraError('Camera stream disconnected. Please tap Retry.');
        };

        if ('getCapabilities' in track) {
          const capabilities: any = track.getCapabilities();

          if (capabilities.focusMode && capabilities.focusMode.includes('continuous')) {
            try {
              await track.applyConstraints({
                advanced: [{ focusMode: 'continuous' } as any]
              });
            } catch {}
          }

          if (capabilities.zoom) {
            setHasZoomCapability(true);
            const minZ = capabilities.zoom.min || 1;
            const maxZ = capabilities.zoom.max || 1;
            const stepZ = capabilities.zoom.step || 0.1;
            setZoomRange({ min: minZ, max: maxZ, step: stepZ });
            const startZoom = Math.max(1.0, minZ);
            setCurrentZoom(startZoom);
            console.log(`[QR] Camera zoom init: min=${minZ}, max=${maxZ}, startZoom=${startZoom} (clamped from min=${minZ})`);
            try {
              await track.applyConstraints({
                advanced: [{ zoom: startZoom } as any]
              });
            } catch {}
          } else {
            setHasZoomCapability(false);
            console.log('[QR] Camera zoom: not supported on this device');
          }

          if (capabilities.torch) {
            setHasTorchCapability(true);
          } else {
            setHasTorchCapability(false);
          }
        }
      }

      // Request Screen Wake Lock
      if ('wakeLock' in navigator) {
        try {
          wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        } catch {}
      }

      setCameraStarting(false);
      setCameraActive(true);
      console.log('[Scanner] scanning started');
      animationFrameIdRef.current = requestAnimationFrame(processFrame);
    } catch (err: any) {
      setCameraStarting(false);
      setCameraActive(false);
      console.error('[Scanner] Camera initialization error:', err);
      const permDuration = permissionReqTimeRef.current > 0 ? (performance.now() - permissionReqTimeRef.current) : 0;
      const isDenied = err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError';
      const isReadable = err.name === 'NotReadableError' || err.name === 'TrackStartError';
      const failType: FailureErrorType = isDenied 
        ? 'permission_denied' 
        : isReadable 
          ? 'camera_in_use' 
          : 'camera_unavailable';

      if (isDenied) {
        console.log('[Scanner] permission result: DENIED');
        setPermissionState('denied');
      }
      scannerTelemetry.recordStage('camera_permission_result', permDuration, sessionIdRef.current, { granted: false }, displayType);
      scannerTelemetry.recordFailure(failType, 'camera_permission_requested', sessionIdRef.current, { error: err.name || err.message }, displayType);
      triggerFeedback(false);

      if (isDenied) {
        if (browserInfo.isBrave && browserInfo.isIOS) {
          setCameraError('Camera blocked by Brave Shields. Lower Shields for this site (lion icon in address bar) and tap Reload Page, or open in Safari.');
        } else if (browserInfo.isIOS && !browserInfo.isSafari) {
          setCameraError(`Camera blocked in ${browserInfo.name}. Enable camera in iOS Settings → ${browserInfo.name} → Camera and tap Reload Page, or open in Safari.`);
        } else if (browserInfo.isSafari) {
          setCameraError('Camera access blocked. Enable camera access in iOS Settings → Safari → Camera and tap Reload Page.');
        } else {
          setCameraError('Camera access blocked. Please allow camera access in your browser settings and reload the page.');
        }
      } else if (isReadable) {
        setCameraError('Camera is in use by another app. Please close other camera apps (WhatsApp, Camera, Instagram) and retry.');
      } else {
        setCameraError('Camera unavailable. Allow camera access to scan the classroom QR.');
      }
      setCameraActive(false);
    }
  };

  // Camera Lifecycle Stop (Complete Teardown: Green Light Turns Off)
  const stopCamera = useCallback(() => {
    console.log('[Scanner] stopCamera invoked');
    if (decodeWatchdogTimerRef.current) {
      clearTimeout(decodeWatchdogTimerRef.current);
      decodeWatchdogTimerRef.current = null;
    }
    if (animationFrameIdRef.current) {
      cancelAnimationFrame(animationFrameIdRef.current);
      animationFrameIdRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
          console.log(`[Scanner] track ${track.label} stopped`);
        } catch {}
      });
      mediaStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (wakeLockRef.current) {
      try {
        wakeLockRef.current.release();
      } catch {}
      wakeLockRef.current = null;
    }
    barcodeDetectorRef.current = null;
    canvasRef.current = null;
    setTorchActive(false);
    setCurrentZoom(1);
    setCameraActive(false);
  }, []);

  // Part A.1 & A.4: Permission-Aware Initialization & Page Lifecycle Listener
  useEffect(() => {
    isMountedRef.current = true;
    console.log('[Scanner] mounted');

    // Insecure origin pre-check
    if (typeof window !== 'undefined' && !window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      setPermissionState('insecure_origin');
      setCameraError('Camera access requires HTTPS or localhost. Current origin is not secure.');
      return;
    }

    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'camera' as any })
        .then((status) => {
          if (!isMountedRef.current) return;
          permStatusRef.current = status;
          console.log('[Scanner] permission state queried:', status.state);
          setPermissionState(status.state as any);
          if (status.state === 'denied') {
            console.log('[Scanner] permission result: DENIED');
            setCameraError('Camera access blocked. Enable camera access in browser settings and try again.');
          } else {
            // Both 'granted' and 'prompt' must start camera so getUserMedia prompts or activates immediately
            startCamera(1);
          }
          status.onchange = () => {
            if (!isMountedRef.current) return;
            console.log('[Scanner] permission status changed:', status.state);
            setPermissionState(status.state as any);
            if (status.state !== 'denied' && !mediaStreamRef.current) {
              startCamera(1);
            }
          };
        })
        .catch((err) => {
          if (!isMountedRef.current) return;
          console.log('[Scanner] permissions.query not supported on this browser (Safari/WebKit fallback):', err?.message || err);
          setPermissionState('unknown');
          startCamera(1);
        });
    } else {
      setPermissionState('unknown');
      startCamera(1);
    }

    // Part A.4: visibilitychange listener (pause stream when backgrounded / re-acquire on foreground)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (mediaStreamRef.current) {
          stopCamera();
          (window as any).__snist_resume_camera_after_vis__ = true;
        }
      } else if (document.visibilityState === 'visible') {
        if ((window as any).__snist_resume_camera_after_vis__) {
          (window as any).__snist_resume_camera_after_vis__ = false;
          startCamera(1);
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isMountedRef.current = false;
      if (currentAbortCtrlRef.current) {
        try {
          currentAbortCtrlRef.current.abort('unmount');
        } catch {}
        currentAbortCtrlRef.current = null;
      }
      if (permStatusRef.current) {
        try {
          permStatusRef.current.onchange = null;
        } catch {}
        permStatusRef.current = null;
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      stopCamera();
    };
  }, [facingMode]);

  const toggleFacingMode = () => {
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  };

  // Pinch-to-zoom gesture handlers with propagation stop (prevents mobile sheet drag collapse)
  const handleTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation();
    if (e.touches.length === 2 && hasZoomCapability) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      pinchStartDistanceRef.current = dist;
      pinchStartZoomRef.current = currentZoom;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    e.stopPropagation();
    if (e.touches.length === 2 && pinchStartDistanceRef.current !== null && hasZoomCapability) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const factor = dist / pinchStartDistanceRef.current;
      const targetZ = pinchStartZoomRef.current * factor;
      setAutoZoomEnabled(false); // Manual pinch disables auto-zoom
      applyZoom(targetZ);
    }
  };

  const handleDoubleTap = () => {
    if (!hasZoomCapability) return;
    const target = currentZoom > 1.5 ? 1 : Math.min(zoomRange.max, 2);
    setAutoZoomEnabled(false);
    applyZoom(target);
  };

  const handleTouchEnd = (e?: React.TouchEvent) => {
    if (e) e.stopPropagation();
    const now = Date.now();
    if (now - lastTapTimeRef.current < 300) {
      handleDoubleTap();
    }
    lastTapTimeRef.current = now;
    pinchStartDistanceRef.current = null;
  };

  return (
    <PwaInstallGuard onDismiss={() => { stopCamera(); onClose(); }}>
      <div 
        className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-4"
        style={{ overscrollBehavior: 'contain' }}
      >
        <div 
          className="bg-white text-slate-900 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col max-h-[92vh] sm:max-h-[90vh] font-sans border border-slate-100 flex-shrink-0"
          style={{ overscrollBehavior: 'contain' }}
        >
          
          {isOfflineQueued ? (
            /* Offline Buffered Confirmation Screen */
            <div className="p-6 sm:p-8 flex flex-col items-center justify-center text-center space-y-5 animate-in fade-in zoom-in-95 duration-300 w-full">
              <div className="w-20 h-20 rounded-full bg-blue-50 border-2 border-blue-200 text-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/10">
                <CheckCircle className="w-10 h-10 text-blue-600" />
              </div>

              <div className="space-y-1.5">
                <span className="inline-block px-3 py-1 rounded-full text-xs font-bold tracking-wide uppercase bg-blue-100 text-blue-800">
                  Saved Offline
                </span>
                <h2 className="text-2xl font-black text-[#001e40] tracking-tight">
                  Attendance Saved!
                </h2>
                <p className="text-xs text-slate-500 font-medium max-w-xs mx-auto leading-relaxed">
                  Your attendance has been securely saved on this device and will submit automatically when connectivity returns.
                </p>
              </div>

              <div className="w-full bg-slate-50 rounded-2xl p-4 border border-slate-200/80 text-left space-y-2 text-xs">
                <div className="flex justify-between items-center py-0.5">
                  <span className="text-slate-500 font-medium">Session</span>
                  <span className="font-bold text-slate-800">{queuedSessionInfo?.sessionPreview || 'Class Session'}</span>
                </div>
                <div className="flex justify-between items-center py-0.5 border-t border-slate-200/50 pt-1.5">
                  <span className="text-slate-500 font-medium">Time</span>
                  <span className="font-semibold text-slate-700">{queuedSessionInfo?.queuedAt || 'Just now'}</span>
                </div>
                {pendingQueueCount > 1 && (
                  <div className="flex justify-between items-center py-0.5 border-t border-slate-200/50 pt-1.5">
                    <span className="text-slate-500 font-medium">Queue</span>
                    <span className="font-semibold text-blue-700">{pendingQueueCount} scans waiting to sync</span>
                  </div>
                )}
              </div>

              <div className="space-y-2 w-full pt-1">
                {navigator.onLine && (
                  <button
                    type="button"
                    disabled={isRetryingQueue}
                    onClick={async () => {
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
                    }}
                    className="w-full py-3.5 bg-[#001e40] hover:bg-[#002f6c] text-white font-bold text-sm rounded-2xl shadow-lg transition flex items-center justify-center gap-2 active:scale-98 disabled:opacity-50 cursor-pointer"
                  >
                    <RefreshCw className={`w-4 h-4 ${isRetryingQueue ? 'animate-spin' : ''}`} />
                    <span>{isRetryingQueue ? 'Submitting to Server…' : 'Sync Now to Server'}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    onScanComplete(queuedSessionInfo || { status: 'OFFLINE_QUEUED' });
                    onClose();
                  }}
                  className="w-full py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm rounded-2xl transition active:scale-98 cursor-pointer"
                >
                  Done
                </button>
              </div>
            </div>
          ) : successResult ? (
            /* Clean Production Attendance Success Screen */
            <div className="p-6 sm:p-8 flex flex-col items-center justify-center text-center space-y-5 animate-in fade-in zoom-in-95 duration-300 w-full">
              {/* Checkmark Circle */}
              <div className="w-20 h-20 rounded-full bg-emerald-50 border-2 border-emerald-200 text-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/10">
                <CheckCircle className="w-10 h-10 animate-in zoom-in-75 duration-300 text-emerald-600" />
              </div>

              <div className="space-y-1.5">
                <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold tracking-wide uppercase ${
                  successResult.status === 'ALREADY_MARKED'
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-emerald-100 text-emerald-800'
                }`}>
                  {successResult.status === 'ALREADY_MARKED' ? 'Already Marked' : 'Attendance Marked'}
                </span>
                <h2 className="text-2xl font-black text-[#001e40] tracking-tight">
                  {successResult.status === 'ALREADY_MARKED' ? 'Already Present' : 'Present!'}
                </h2>
                <p className="text-sm text-slate-600 font-medium">
                  Present for <span className="font-bold text-slate-900">{successResult.subject_name || 'Class Attendance Session'}</span>
                </p>
              </div>

              {/* Clean Student & Session Card */}
              <div className="w-full bg-slate-50 rounded-2xl p-4 border border-slate-200/80 text-left space-y-2 text-xs">
                <div className="flex justify-between items-center py-0.5">
                  <span className="text-slate-500 font-medium">Student</span>
                  <span className="font-bold text-slate-800">{studentInfo.name || 'Student'} ({studentInfo.roll_number || studentRoll})</span>
                </div>
                <div className="flex justify-between items-center py-0.5 border-t border-slate-200/50 pt-1.5">
                  <span className="text-slate-500 font-medium">Time</span>
                  <span className="font-semibold text-slate-700">
                    {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • Today
                  </span>
                </div>
              </div>

              {/* Institutional Selfie CTA if required */}
              {selfieAttendanceId && (
                <div className="w-full p-4 bg-indigo-50 border border-indigo-200 rounded-2xl text-left space-y-2 animate-in fade-in">
                  <div className="flex items-center gap-2 text-indigo-900 font-bold text-xs">
                    <Camera className="w-4 h-4 text-indigo-600" />
                    <span>Quick Photo Verification</span>
                  </div>
                  <p className="text-xs text-indigo-700 leading-relaxed">
                    Attendance recorded! Take a quick front-camera selfie to verify institutional photo records.
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowSelfieModal(true)}
                    className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl transition flex items-center justify-center gap-1.5 shadow-sm active:scale-98 cursor-pointer"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>Take Selfie</span>
                  </button>
                </div>
              )}

              {/* Done Button */}
              <button
                type="button"
                onClick={() => {
                  onScanComplete(successResult);
                  onClose();
                }}
                className="w-full py-3.5 bg-[#001e40] hover:bg-[#002f6c] text-white font-bold text-sm rounded-2xl shadow-lg transition active:scale-98 cursor-pointer"
              >
                Done
              </button>
            </div>
          ) : (
            /* Active Camera Scanner View */
            <div className="w-full flex flex-col items-center">
              
              {/* Dominant Camera Viewport */}
              <div 
                className="relative w-full h-[58vh] sm:h-[420px] min-h-[320px] bg-black overflow-hidden select-none flex items-center justify-center"
                style={{ touchAction: 'none' }}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onDoubleClick={handleDoubleTap}
              >
                {/* 1. Camera Video Feed - Rendered directly above background and behind reticle */}
                <video
                  ref={attachVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="absolute inset-0 w-full h-full object-cover"
                  style={{ zIndex: 1, transform: 'translateZ(0)', WebkitTransform: 'translateZ(0)' }}
                />

                {/* 2. Top Floating Control Bar */}
                <div className="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-auto" style={{ zIndex: 50 }}>
                  <div className="flex items-center gap-1.5 px-3 py-1.5 bg-black/50 backdrop-blur-md rounded-full text-white/90 text-xs font-medium border border-white/10 shadow-sm">
                    <Camera className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Scan Classroom QR</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {hasTorchCapability && (
                      <button
                        type="button"
                        onClick={toggleTorch}
                        className={`p-2 rounded-full backdrop-blur-md transition shadow-sm ${
                          torchActive
                            ? 'bg-amber-400 text-slate-950 shadow-amber-400/30'
                            : 'bg-black/50 text-white/80 hover:text-white border border-white/10'
                        }`}
                        title={torchActive ? 'Turn off torch' : 'Turn on torch'}
                      >
                        <Flashlight className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={toggleFacingMode}
                      className="p-2 rounded-full bg-black/50 text-white/80 hover:text-white backdrop-blur-md border border-white/10 transition shadow-sm"
                      title="Flip camera"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        stopCamera();
                        onClose();
                      }}
                      className="p-2 rounded-full bg-black/50 text-white/80 hover:text-white backdrop-blur-md border border-white/10 transition shadow-sm"
                      title="Close"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* 3. Clean Corner Bracket Reticle */}
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center" style={{ zIndex: 10 }}>
                  <div className="relative w-56 h-56 sm:w-64 sm:h-64">
                    <div className="absolute top-0 left-0 w-8 h-8 border-t-3 border-l-3 border-emerald-400 rounded-tl-xl shadow-[0_0_12px_rgba(52,211,153,0.4)]" />
                    <div className="absolute top-0 right-0 w-8 h-8 border-t-3 border-r-3 border-emerald-400 rounded-tr-xl shadow-[0_0_12px_rgba(52,211,153,0.4)]" />
                    <div className="absolute bottom-0 left-0 w-8 h-8 border-b-3 border-l-3 border-emerald-400 rounded-bl-xl shadow-[0_0_12px_rgba(52,211,153,0.4)]" />
                    <div className="absolute bottom-0 right-0 w-8 h-8 border-b-3 border-r-3 border-emerald-400 rounded-br-xl shadow-[0_0_12px_rgba(52,211,153,0.4)]" />
                    <div className="absolute inset-0 border border-emerald-400/20 rounded-xl" />
                  </div>
                </div>

                {/* 4. Minimal Unobtrusive Zoom Pills */}
                {hasZoomCapability && zoomRange.max >= 1.5 && (
                  <div className="absolute bottom-3.5 left-1/2 -translate-x-1/2 flex items-center bg-black/50 backdrop-blur-md rounded-full p-1 border border-white/15 shadow-lg" style={{ zIndex: 20 }}>
                    <button
                      type="button"
                      onClick={() => applyZoom(1)}
                      className={`px-3 py-0.5 rounded-full text-xs font-bold transition-all ${
                        Math.abs(currentZoom - 1) < 0.2
                          ? 'bg-white text-slate-950 shadow-sm'
                          : 'text-white/80 hover:text-white'
                      }`}
                    >
                      1×
                    </button>
                    <button
                      type="button"
                      onClick={() => applyZoom(Math.min(zoomRange.max, 2))}
                      className={`px-3 py-0.5 rounded-full text-xs font-bold transition-all ${
                        Math.abs(currentZoom - 2) < 0.2
                          ? 'bg-white text-slate-950 shadow-sm'
                          : 'text-white/80 hover:text-white'
                      }`}
                    >
                      2×
                    </button>
                    {zoomRange.max >= 3 && (
                      <button
                        type="button"
                        onClick={() => applyZoom(Math.min(zoomRange.max, 3))}
                        className={`px-3 py-0.5 rounded-full text-xs font-bold transition-all ${
                          Math.abs(currentZoom - 3) < 0.2
                            ? 'bg-white text-slate-950 shadow-sm'
                            : 'text-white/80 hover:text-white'
                        }`}
                      >
                        3×
                      </button>
                    )}
                  </div>
                )}

                {/* 5. Submitting Overlay (strictly tied to flowState === 'SUBMITTING') */}
                {flowState === 'SUBMITTING' && (
                  <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center gap-3 text-white animate-in fade-in duration-150 px-4 text-center" style={{ zIndex: 40 }}>
                    <div className="w-10 h-10 rounded-full border-3 border-emerald-400 border-t-transparent animate-spin" />
                    <span className="text-xs font-bold tracking-wide">Marking Attendance…</span>
                    <p className="text-[11px] text-white/70 max-w-xs">Contacting attendance server securely…</p>
                    <button
                      type="button"
                      onClick={() => {
                        if (currentAbortCtrlRef.current) {
                          try { currentAbortCtrlRef.current.abort('user_cancelled'); } catch {}
                          currentAbortCtrlRef.current = null;
                        }
                        setIsSubmitting(false);
                        setFlowState('IDLE_SCANNING');
                        isScanningLockedRef.current = false;
                        setGuideText('Submission cancelled — scan again');
                      }}
                      className="mt-1 px-3 py-1 bg-white/15 hover:bg-white/25 text-white/90 text-[11px] font-semibold rounded-full border border-white/20 transition active:scale-95 cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {/* 6. Camera Starting Overlay */}
                {cameraStarting && !cameraError && (
                  <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-sm flex flex-col items-center justify-center gap-2.5 p-4 text-center" style={{ zIndex: 25 }}>
                    <RefreshCw className="w-7 h-7 text-emerald-400 animate-spin" />
                    <p className="text-xs font-bold text-white tracking-wide">Starting camera…</p>
                  </div>
                )}

                {/* 7. Camera Blocked / Error In-Viewport State */}
                {(cameraError || permissionState === 'denied') && (
                  <div className="absolute inset-0 bg-slate-950/95 flex flex-col items-center justify-center p-6 text-center space-y-3.5" style={{ zIndex: 25 }}>
                    <div className="w-12 h-12 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center border border-rose-500/30">
                      <Camera className="w-6 h-6 text-rose-400" />
                    </div>
                    <div className="space-y-1.5 max-w-xs">
                      <h3 className="text-sm font-bold text-white">
                        {browserInfo.isBrave && browserInfo.isIOS 
                          ? 'Camera blocked by Brave Shields' 
                          : permissionState === 'denied' 
                            ? `Camera blocked in ${browserInfo.name}` 
                            : 'Camera unavailable'}
                      </h3>
                      <p className="text-xs text-slate-300 leading-relaxed">
                        {cameraError || (permissionState === 'denied'
                          ? (browserInfo.isBrave && browserInfo.isIOS
                              ? 'Turn OFF Brave Shields (lion icon in address bar) and tap Reload Page, or open in Safari.' 
                              : `Enable camera access in ${browserInfo.name} settings and reload.`)
                          : 'Allow camera access to scan the classroom QR.')}
                      </p>
                    </div>

                    <div className="flex flex-col gap-2 w-full max-w-xs pt-1">
                      {/* Reload button breaks the iOS WebKit permission cache loop */}
                      <button
                        type="button"
                        onClick={() => window.location.reload()}
                        className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-lg transition flex items-center justify-center gap-2 cursor-pointer active:scale-95"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Reload Page (Reset Permission)</span>
                      </button>

                      {browserInfo.isIOS && !browserInfo.isSafari && (
                        <button
                          type="button"
                          onClick={handleCopySafariLink}
                          className="w-full py-2 bg-indigo-600/90 hover:bg-indigo-600 text-white font-bold text-xs rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          <span>{copiedSafariLink ? 'Copied! Open Safari & Paste' : 'Open in Safari (Copy Link)'}</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => setShowRollCard(true)}
                        className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <User className="w-3.5 h-3.5 text-amber-400" />
                        <span>Show Roll No. for Verification</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Bottom Clean Guidance & Action Area */}
              <div className="w-full p-4 sm:p-5 flex flex-col items-center text-center space-y-2 bg-white flex-shrink-0">
                
                {/* Camera Permission / Error Card */}
                {(cameraError || permissionState === 'denied' || permissionState === 'insecure_origin' || isCameraInUse) ? (
                  <div className="w-full p-3.5 bg-rose-50 border border-rose-200 rounded-2xl text-center space-y-2.5 animate-in fade-in">
                    <div className="w-8 h-8 bg-rose-100 text-rose-700 rounded-full flex items-center justify-center mx-auto">
                      <AlertTriangle className="w-4 h-4 text-rose-600" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-rose-950">
                        {browserInfo.isBrave && browserInfo.isIOS 
                          ? 'Brave Shields Blocking Camera' 
                          : permissionState === 'denied' 
                            ? `Camera Blocked in ${browserInfo.name}` 
                            : isCameraInUse 
                              ? 'Camera In Use' 
                              : 'Camera Unavailable'}
                      </h4>
                      <p className="text-[11px] text-rose-800 mt-0.5 leading-relaxed">
                        {browserInfo.isBrave && browserInfo.isIOS
                          ? 'Turn OFF Brave Shields (lion icon in address bar) and tap Reload Page, or switch to Safari.'
                          : permissionState === 'denied'
                            ? `Please enable camera in your ${browserInfo.name} settings and reload.`
                            : isCameraInUse
                              ? 'Another application is using your camera. Please close it and retry.'
                              : cameraError || 'Could not connect to camera.'}
                      </p>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => window.location.reload()}
                        className="flex-1 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-sm active:scale-95 cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Reload Page</span>
                      </button>
                      {browserInfo.isIOS && !browserInfo.isSafari && (
                        <button
                          type="button"
                          onClick={handleCopySafariLink}
                          className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-sm active:scale-95 cursor-pointer"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          <span>{copiedSafariLink ? 'Copied Link!' : 'Use Safari'}</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setShowRollCard(true)}
                        className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1"
                      >
                        <User className="w-3 h-3 text-slate-500" />
                        <span>Show Roll No.</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <h3 className="font-extrabold text-sm text-[#001e40]">
                      {flowState === 'SUBMITTING' && 'Marking Attendance…'}
                      {flowState === 'TIMEOUT' && 'Submission Timed Out'}
                      {flowState === 'STALE_QR' && 'Expired QR Code'}
                      {flowState === 'RATE_LIMITED' && 'Scan Cooldown Active'}
                      {flowState === 'BLOCKED' && 'Device Not Linked'}
                      {flowState === 'ENROLLING' && 'Enrolling Device…'}
                      {flowState === 'REBIND_OTP' && 'Verify New Device'}
                      {(flowState === 'IDLE_SCANNING' || flowState === 'INITIALIZING' || flowState === 'DECODED' || flowState === 'ERROR') && guideText}
                    </h3>
                    <p className="text-xs text-slate-400 font-medium">
                      {flowState === 'SUBMITTING' && 'Contacting attendance server securely...'}
                      {flowState === 'TIMEOUT' && 'Network delayed; token expired. Scan the current screen QR.'}
                      {flowState === 'STALE_QR' && 'Projector rotated. Point camera at the refreshed classroom QR.'}
                      {flowState === 'RATE_LIMITED' && `Please wait ${rateLimitSecondsLeft}s before scanning again.`}
                      {flowState === 'BLOCKED' && 'Link this device to record attendance for your roll number.'}
                      {flowState === 'ENROLLING' && 'Generating crypto keys and registering with college server...'}
                      {flowState === 'REBIND_OTP' && `Enter 6-digit code sent to ${rebindMaskedEmail}`}
                      {(flowState === 'IDLE_SCANNING' || flowState === 'INITIALIZING' || flowState === 'DECODED' || flowState === 'ERROR') && 'Point your camera at the QR displayed by your faculty'}
                    </p>

                    {/* State-specific Alert / Action Banner */}
                    {flowState === 'TIMEOUT' && (
                      <div className="w-full p-2.5 rounded-xl text-xs font-medium bg-amber-50 border border-amber-300 text-amber-900 space-y-2 animate-in fade-in">
                        <div className="flex items-center justify-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                          <span>Attendance request timed out. Discarded stale token.</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setFlowState('IDLE_SCANNING');
                            setScanError(null);
                            setGuideText('Align the QR inside the frame');
                            isScanningLockedRef.current = false;
                            if (mediaStreamRef.current && isMountedRef.current) {
                              animationFrameIdRef.current = requestAnimationFrame(processFrame);
                            }
                          }}
                          className="w-full py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
                        >
                          <RefreshCw className="w-3 h-3" />
                          <span>Scan Current QR</span>
                        </button>
                      </div>
                    )}

                    {flowState === 'STALE_QR' && (
                      <div className="w-full p-2.5 rounded-xl text-xs font-medium bg-blue-50 border border-blue-200 text-blue-800 flex items-center justify-center gap-1.5 animate-in fade-in">
                        <RefreshCw className="w-3.5 h-3.5 text-blue-600 shrink-0 animate-spin" />
                        <span>The 10s token sync rotated. Aim camera at the newly updated QR.</span>
                      </div>
                    )}

                    {flowState === 'RATE_LIMITED' && (
                      <div className="w-full p-2.5 rounded-xl text-xs font-medium bg-amber-50 border border-amber-300 text-amber-900 space-y-2 animate-in fade-in">
                        <div className="flex items-center justify-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0 animate-pulse" />
                          <span>Too many scan attempts. Cooldown: {rateLimitSecondsLeft}s</span>
                        </div>
                        <div className="w-full bg-amber-200/60 rounded-full h-1.5 overflow-hidden">
                          <div
                            className="bg-amber-500 h-1.5 rounded-full transition-all duration-1000"
                            style={{ width: `${Math.min(100, Math.max(0, (rateLimitSecondsLeft / 20) * 100))}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {flowState === 'BLOCKED' && (
                      <div className="w-full p-2.5 rounded-xl text-xs font-medium bg-indigo-50 border border-indigo-200 text-indigo-900 space-y-2 animate-in fade-in">
                        <div className="flex items-center justify-center gap-1.5">
                          <ShieldCheck className="w-4 h-4 text-indigo-600 shrink-0" />
                          <span>This device is not linked. Please enroll this device to record attendance.</span>
                        </div>
                        <button
                          type="button"
                          onClick={handleInlineEnroll}
                          disabled={isInlineEnrolling}
                          className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-sm active:scale-95 cursor-pointer"
                        >
                          <ShieldCheck className="w-4 h-4" />
                          <span>{isInlineEnrolling ? 'Enrolling Device…' : 'Enroll this device'}</span>
                        </button>
                      </div>
                    )}

                    {/* Generic Error (only when flowState === 'ERROR' and NOT in submitting/timeout/stale/rate-limited/blocked) */}
                    {flowState === 'ERROR' && scanError && (
                      <div className="w-full p-2.5 rounded-xl text-xs font-medium bg-rose-50 border border-rose-200 text-rose-700 space-y-2 animate-in fade-in">
                        <div className="flex items-center justify-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                          <span>{scanError}</span>
                        </div>
                        {scanErrorCode === 'no_active_binding' && (
                          <button
                            type="button"
                            onClick={handleInlineEnroll}
                            disabled={isInlineEnrolling}
                            className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-sm active:scale-95 cursor-pointer"
                          >
                            <ShieldCheck className="w-4 h-4" />
                            <span>{isInlineEnrolling ? 'Enrolling Device…' : 'Enroll this device'}</span>
                          </button>
                        )}
                      </div>
                    )}

                    {/* Actionable Option: Having trouble -> Show Roll Number to Faculty */}
                    <div className="pt-2 flex items-center justify-between w-full border-t border-slate-100 mt-1">
                      <button
                        type="button"
                        onClick={() => setShowRollCard(true)}
                        className="text-xs text-slate-500 hover:text-[#001e40] font-semibold transition cursor-pointer flex items-center gap-1"
                      >
                        <User className="w-3.5 h-3.5 text-slate-400" />
                        <span>Can't scan? Show Roll Number</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          stopCamera();
                          onClose();
                        }}
                        className="text-xs text-slate-400 hover:text-slate-600 font-medium transition cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Roll Card Modal (High-Contrast Screen for Faculty Visual Verification) */}
          {showRollCard && (
            <div className="fixed inset-0 z-70 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in">
              <div className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl p-6 text-center space-y-4 font-sans animate-in zoom-in-95">
                <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto">
                  <User className="w-6 h-6" />
                </div>

                <div>
                  <h3 className="font-extrabold text-base text-[#001e40]">
                    Faculty Manual Verification
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Show this screen to your faculty to record attendance
                  </p>
                </div>

                {/* Big Legible Roll Card */}
                <div className="bg-slate-950 text-white rounded-2xl p-5 border-2 border-emerald-500/80 shadow-inner space-y-1">
                  <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">
                    Roll Number / SAP ID
                  </span>
                  <p className="font-mono font-black text-2xl sm:text-3xl text-amber-300 tracking-wider">
                    {studentInfo.roll_number || studentRoll || 'STUDENT'}
                  </p>
                  <p className="text-xs font-bold text-slate-200 pt-1">
                    {studentInfo.name || 'Student'}
                  </p>
                  {studentInfo.section && (
                    <p className="text-[11px] text-slate-400">
                      {studentInfo.section}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setShowRollCard(false)}
                    className="w-full py-3 bg-[#001e40] hover:bg-[#002d60] text-white font-bold text-xs rounded-xl shadow transition cursor-pointer"
                  >
                    Return to Scanner
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowRollCard(false);
                      stopCamera();
                      onClose();
                    }}
                    className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs rounded-xl transition cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Device Rebind Modal (If device changed and requires email OTP) */}
          {rebindOtpRequired && (
            <div className="fixed inset-0 z-70 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in">
              <div className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl p-6 text-center space-y-4 font-sans animate-in zoom-in-95">
                <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center mx-auto">
                  <KeyRound className="w-6 h-6 text-amber-700" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base text-[#001e40]">
                    Authorize New Device
                  </h3>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    Enter the 6-digit code sent to <strong className="font-semibold text-slate-800">{rebindMaskedEmail}</strong> to register this device.
                  </p>
                </div>

                {rebindOtpError && (
                  <div className="text-xs text-rose-600 font-bold bg-rose-50 border border-rose-200 rounded-xl p-2">
                    {rebindOtpError}
                  </div>
                )}

                <div className="space-y-3">
                  <input
                    type="text"
                    maxLength={6}
                    placeholder="123456"
                    value={rebindOtpValue}
                    onChange={(e) => setRebindOtpValue(e.target.value.replace(/\D/g, ''))}
                    className="w-full py-3 text-center text-lg font-mono font-bold tracking-widest bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  <button
                    type="button"
                    disabled={isSubmittingRebindOtp || rebindOtpValue.length !== 6}
                    onClick={handleConfirmRebindOtp}
                    className="w-full py-3 bg-[#001e40] hover:bg-[#002d60] text-white font-bold text-xs rounded-xl shadow transition flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
                  >
                    {isSubmittingRebindOtp ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                    <span>Verify & Link Device</span>
                  </button>
                  <div className="flex justify-between items-center text-xs text-slate-500 pt-1">
                    <button
                      type="button"
                      onClick={handleResendRebindOtp}
                      className="text-amber-800 hover:text-amber-900 underline font-semibold cursor-pointer"
                    >
                      Resend code
                    </button>
                    <button
                      type="button"
                      onClick={() => { setRebindOtpRequired(false); setScanError(null); }}
                      className="text-slate-500 hover:text-slate-700 cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Stage 6: Post-Attendance Selfie Collection Modal */}
      {showSelfieModal && selfieAttendanceId && (
        <PostAttendanceSelfieModal
          attendanceId={selfieAttendanceId}
          rollNumber={studentInfo.roll_number || studentRoll || 'STUDENT'}
          studentName={studentInfo.name}
          subjectName={successResult?.subject_name}
          onComplete={() => {
            setShowSelfieModal(false);
            onScanComplete();
            onClose();
          }}
          onSkip={() => {
            setShowSelfieModal(false);
            onScanComplete();
            onClose();
          }}
        />
      )}

    </PwaInstallGuard>
  );
};
