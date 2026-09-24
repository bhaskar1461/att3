import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiRequest } from '../services/api';
import { 
  CheckCircle2, 
  AlertCircle, 
  MapPin, 
  ShieldCheck, 
  UserCheck, 
  BookOpen, 
  User, 
  ArrowRight, 
  Eye, 
  EyeOff, 
  RefreshCw,
  Camera
} from 'lucide-react';
import { getBindingState, signChallenge, generateKeyPair, commitBindingRecord } from '../services/binding';
import { getOrCreateDeviceCredentials, getDeviceHeaders } from '../services/deviceCredential';
import { PostAttendanceSelfieModal } from '../components/PostAttendanceSelfieModal';

interface SessionMetadata {
  valid: boolean;
  session_id: number;
  subject_name: string;
  subject_code: string;
  section_name: string;
  teacher_name: string;
  session_date: string;
  period: string;
  session_status: string;
  is_open: boolean;
  short_code: string;
  v: number;
}

export const AttendanceLanding: React.FC = () => {
  const { launchToken } = useParams<{ launchToken: string }>();
  const { user, login } = useAuth();
  const navigate = useNavigate();

  // Session validation state
  const [isValidating, setIsValidating] = useState(true);
  const [sessionData, setSessionData] = useState<SessionMetadata | null>(null);
  const [validateError, setValidateError] = useState<string | null>(null);
  const [validateErrorCode, setValidateErrorCode] = useState<string | null>(null);
  const [claimToken, setClaimToken] = useState<string | null>(null);

  // Quick inline login state (if unauthenticated)
  const [loginRoll, setLoginRoll] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Attendance submission state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionSuccess, setSubmissionSuccess] = useState<any | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitErrorCode, setSubmitErrorCode] = useState<string | null>(null);
  const [isEnrollingDevice, setIsEnrollingDevice] = useState(false);
  const [, setGeoStatus] = useState<'idle' | 'acquiring' | 'ready' | 'denied'>('idle');
  const [showSelfieModal, setShowSelfieModal] = useState(false);
  const [selfieAttendanceId, setSelfieAttendanceId] = useState<number | null>(null);

  // Validate and exchange the launch token for a 3-minute claim ticket on mount
  useEffect(() => {
    let isMounted = true;
    const CLAIM_KEY = 'snist_launch_claim';

    async function checkToken() {
      if (!launchToken) {
        setValidateError('No attendance token was provided in the link.');
        setIsValidating(false);
        return;
      }

      try {
        setIsValidating(true);
        setValidateError(null);
        setValidateErrorCode(null);

        // 1. Check if we already have an active unexpired claim for this launch token in sessionStorage
        const storedClaimStr = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(CLAIM_KEY) : null;
        if (storedClaimStr) {
          try {
            const parsed = JSON.parse(storedClaimStr);
            const isUnexpired = Boolean(
              (parsed.expires_at && parsed.expires_at * 1000 > Date.now()) ||
              (parsed.saved_at_client && Date.now() - parsed.saved_at_client < (parsed.expires_in_seconds || 180) * 1000)
            );
            if (parsed.launch_token === launchToken && parsed.claim_token && isUnexpired) {
              if (isMounted) {
                setClaimToken(parsed.claim_token);
                const rawSession = parsed.session || parsed;
                setSessionData({
                  valid: Boolean(rawSession.valid ?? true),
                  session_id: rawSession.session_id,
                  subject_name: rawSession.subject_name || rawSession.subject || 'Classroom Session',
                  subject_code: rawSession.subject_code || '',
                  section_name: rawSession.section_name || rawSession.section || '',
                  teacher_name: rawSession.teacher_name || rawSession.faculty || '',
                  session_date: rawSession.session_date || '',
                  period: rawSession.period || '',
                  session_status: rawSession.session_status || (rawSession.is_open ? 'OPEN' : 'CLOSED'),
                  is_open: rawSession.is_open !== undefined ? Boolean(rawSession.is_open) : true,
                  short_code: rawSession.short_code || '',
                  v: rawSession.v || 0
                });
                setIsValidating(false);
              }
              return;
            }
          } catch {}
        }

        // 2. Immediate Token -> Claim exchange before login
        const claimRes: any = await apiRequest('/launch/claim', {
          method: 'POST',
          body: JSON.stringify({
            launch_token: launchToken
          })
        });

        if (isMounted) {
          if (claimRes?.valid && (claimRes?.claim_token || claimRes?.session_id)) {
            setClaimToken(claimRes.claim_token || null);
            const rawSession = claimRes.session || claimRes;
            const normalizedSession: SessionMetadata = {
              valid: Boolean(rawSession.valid ?? claimRes.valid),
              session_id: rawSession.session_id,
              subject_name: rawSession.subject_name || rawSession.subject || 'Classroom Session',
              subject_code: rawSession.subject_code || '',
              section_name: rawSession.section_name || rawSession.section || '',
              teacher_name: rawSession.teacher_name || rawSession.faculty || '',
              session_date: rawSession.session_date || '',
              period: rawSession.period || '',
              session_status: rawSession.session_status || (rawSession.is_open ? 'OPEN' : 'CLOSED'),
              is_open: rawSession.is_open !== undefined ? Boolean(rawSession.is_open) : true,
              short_code: rawSession.short_code || '',
              v: rawSession.v || 0
            };
            setSessionData(normalizedSession);
            try {
              sessionStorage.setItem(CLAIM_KEY, JSON.stringify({
                claim_token: claimRes.claim_token,
                launch_token: launchToken,
                session: normalizedSession,
                expires_at: claimRes.expires_at || Math.floor(Date.now() / 1000) + 180,
                expires_in_seconds: claimRes.expires_in_seconds || 180,
                saved_at_client: Date.now()
              }));
            } catch {}
          } else {
            throw new Error(claimRes?.message || 'Invalid launch token');
          }
          setIsValidating(false);
        }
      } catch (err: any) {
        if (isMounted) {
          const rawMsg = err?.message || err?.detail || '';
          const lowerMsg = rawMsg.toLowerCase();
          const p7Code = err?.phase7_code || err?.error_code || err?.qr_error_code;
          const code = p7Code || err?.code || (
            lowerMsg.includes('qr-session-end') || lowerMsg.includes('session has ended') ? 'QR-SESSION-END' :
            lowerMsg.includes('qr-old') || lowerMsg.includes('outdated') ? 'QR-OLD' :
            lowerMsg.includes('expired') ? 'expired' : 'invalid'
          );
          setValidateErrorCode(code);
          if (code === 'QR-SESSION-END' || lowerMsg.includes('session has ended')) {
            setValidateError('This class session has ended. See your faculty if you believe this is wrong. (Code: QR-SESSION-END)');
          } else if (code === 'QR-OLD' || code === 'expired' || lowerMsg.includes('outdated')) {
            setValidateError('The QR on the screen is outdated. Ask faculty to bring the QR window to the front / refresh it, then rescan. (Code: QR-OLD)');
          } else {
            setValidateError(rawMsg || 'Attendance link is invalid or has expired.');
          }
          setIsValidating(false);
        }
      }
    }

    checkToken();
    return () => {
      isMounted = false;
    };
  }, [launchToken]);

  // Handle Quick Inline Login
  const handleQuickLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginRoll || !loginPass) {
      setLoginError('Please enter both your Roll Number and password.');
      return;
    }

    try {
      setLoginLoading(true);
      setLoginError(null);
      const creds = getOrCreateDeviceCredentials();
      const formData = new URLSearchParams();
      formData.append('username', loginRoll.trim().toUpperCase());
      formData.append('password', loginPass);
      formData.append('device_public_id', creds.device_public_id);
      formData.append('device_secret', creds.device_secret);

      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 
          'Content-Type': 'application/x-www-form-urlencoded',
          ...getDeviceHeaders()
        },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Invalid credentials. Please check and try again.');
      }
      login(data.access_token, {
        id: data.user_id,
        username: data.username,
        role: data.role,
        full_name: data.full_name,
      }, data.refresh_token);
    } catch (err: any) {
      setLoginError(err.message || 'Invalid credentials. Please check and try again.');
    } finally {
      setLoginLoading(false);
    }
  };

  // Submit Attendance via Claim or Launch Token
  const handleConfirmAttendance = async () => {
    if ((!launchToken && !claimToken) || isSubmitting) return;

    setIsSubmitting(true);
    setSubmitError(null);
    setSubmitErrorCode(null);

    try {
      // 1. Acquire Geolocation
      setGeoStatus('acquiring');
      let geo: { latitude: number; longitude: number; accuracy_m: number } | null = null;
      try {
        if ('geolocation' in navigator) {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 6000,
              maximumAge: 10000
            });
          });
          geo = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy_m: pos.coords.accuracy
          };
          setGeoStatus('ready');
        }
      } catch (geoErr) {
        console.warn('Geolocation acquisition skipped or denied:', geoErr);
        setGeoStatus('denied');
      }

      // 2. Sign Binding Challenge if Enrolled (Device Binding V2)
      let bindingChallengeToken: string | undefined = undefined;
      let bindingSignature: string | undefined = undefined;

      const studentRoll = user?.username || loginRoll.trim().toUpperCase();
      try {
        let bindingState = await getBindingState(studentRoll);
        if (bindingState !== 'enrolled') {
          // Seamlessly auto-enroll device on first confirmation with deferred commitment
          try {
            const payload = await generateKeyPair(studentRoll, false);
            const enrollRes: any = await apiRequest('/binding/enroll', {
              method: 'POST',
              body: JSON.stringify({
                public_key_spki_b64: payload.public_key_spki_b64,
                key_id: payload.key_id
              })
            });
            if (enrollRes?.status === 'DEVICE_ENROLLED' || enrollRes?.message?.toLowerCase().includes('enrolled')) {
              if (payload.stored_record) {
                await commitBindingRecord(payload.stored_record);
              }
              bindingState = 'enrolled';
            }
          } catch (autoEnrollErr) {
            console.warn('[Launch Attendance] Auto-enroll fallback:', autoEnrollErr);
          }
        }
        if (bindingState === 'enrolled') {
          const challengeRes: any = await apiRequest('/binding/challenge', {
            method: 'POST',
            body: JSON.stringify({})
          });
          if (challengeRes?.challenge_token) {
            bindingChallengeToken = challengeRes.challenge_token;
            const sigResult = await signChallenge(bindingChallengeToken!, studentRoll);
            bindingSignature = sigResult.signature_b64;
          }
        }
      } catch (bindErr: any) {
        console.warn('[Launch Attendance] Binding sign warning:', bindErr?.message || bindErr);
      }

      // 3. Submit Attendance with 5-second Abort Watchdog
      const attendAbortCtrl = new AbortController();
      const attendTimeoutId = setTimeout(() => attendAbortCtrl.abort(), 5000);
      let res: any;
      try {
        res = await apiRequest('/launch/attend', {
          method: 'POST',
          signal: attendAbortCtrl.signal,
          body: JSON.stringify({
            claim_token: claimToken || undefined,
            launch_token: launchToken,
            entry_method: 'NORMAL_CAMERA',
            scan_mode: 'PROJECTOR_SCAN',
            ...(geo ? { latitude: geo.latitude, longitude: geo.longitude, accuracy_m: geo.accuracy_m } : {}),
            ...(bindingChallengeToken ? { challenge_token: bindingChallengeToken } : {}),
            ...(bindingSignature ? { binding_signature: bindingSignature } : {})
          })
        });
      } finally {
        clearTimeout(attendTimeoutId);
      }

      try {
        sessionStorage.removeItem('snist_launch_claim');
      } catch {}
      setSubmissionSuccess(res);
      if (res?.attendance_id) {
        setSelfieAttendanceId(res.attendance_id);
        setShowSelfieModal(true);
      }
    } catch (err: any) {
      const rawMsg = err?.message || err?.detail || '';
      const lowerMsg = rawMsg.toLowerCase();
      const p7Code = err?.phase7_code || err?.error_code || err?.qr_error_code;
      const isSectionMismatch = 
        lowerMsg.includes('section') || 
        lowerMsg.includes('not enrolled in this section') || 
        lowerMsg.includes('not enrolled in this class') ||
        lowerMsg.includes('faculty incharge') ||
        p7Code === 'section_mismatch' ||
        err?.code === 'section_mismatch';

      const code = isSectionMismatch ? 'section_mismatch' : (p7Code || err?.code || (
        lowerMsg.includes('qr-session-end') || lowerMsg.includes('session has ended') ? 'QR-SESSION-END' :
        lowerMsg.includes('binding') || lowerMsg.includes('device') ? 'no_active_binding' :
        lowerMsg.includes('qr-old') || lowerMsg.includes('outdated') ? 'QR-OLD' :
        lowerMsg.includes('expired') ? 'expired' :
        lowerMsg.includes('geofence') ? 'geofence_failed' :
        err?.name === 'AbortError' ? 'timeout' :
        'error'
      ));
      setSubmitErrorCode(code);
      if (code === 'section_mismatch' || isSectionMismatch) {
        setSubmitError('Not enrolled in this section. Please contact faculty incharge.');
      } else if (code === 'QR-SESSION-END' || lowerMsg.includes('session has ended')) {
        try { sessionStorage.removeItem('snist_launch_claim'); } catch {}
        setSubmitError('This class session has ended. See your faculty if you believe this is wrong. (Code: QR-SESSION-END)');
      } else if (code === 'QR-OLD' || code === 'expired' || lowerMsg.includes('outdated')) {
        try { sessionStorage.removeItem('snist_launch_claim'); } catch {}
        setSubmitError('The QR on the screen is outdated. Ask faculty to bring the QR window to the front / refresh it, then rescan. (Code: QR-OLD)');
      } else if (code === 'no_active_binding') {
        setSubmitError('This device is not linked. Please enroll this device once to record attendance.');
      } else if (code === 'geofence_failed') {
        setSubmitError('Location verification failed. Please make sure GPS is enabled and you are inside the classroom.');
      } else if (code === 'timeout' || err?.name === 'AbortError') {
        setSubmitError('Attendance submission timed out. Please tap Confirm Attendance again.');
      } else {
        setSubmitError(rawMsg || 'Attendance submission failed. Please try again or scan the refreshed QR.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Inline Device Enrollment with Deferred Commitment
  const handleEnrollDevice = async () => {
    const studentRoll = user?.username || loginRoll.trim().toUpperCase();
    if (!studentRoll) {
      setSubmitError('Please log in first to enroll this device.');
      return;
    }
    setIsEnrollingDevice(true);
    const enrollAbortCtrl = new AbortController();
    const enrollTimeoutId = setTimeout(() => enrollAbortCtrl.abort(), 6500);
    try {
      const payload = await generateKeyPair(studentRoll, false);
      const res: any = await apiRequest('/binding/enroll', {
        method: 'POST',
        signal: enrollAbortCtrl.signal,
        body: JSON.stringify({
          public_key_spki_b64: payload.public_key_spki_b64,
          key_id: payload.key_id
        })
      });
      if (res?.status === 'DEVICE_ENROLLED' || res?.message?.toLowerCase().includes('enrolled')) {
        if (payload.stored_record) {
          await commitBindingRecord(payload.stored_record);
        }
        setSubmitErrorCode(null);
        setSubmitError(null);
        // Automatically retry attendance with newly enrolled device
        await handleConfirmAttendance();
      } else {
        throw new Error(res?.detail?.message || res?.message || 'Device enrollment rejected by server.');
      }
    } catch (e: any) {
      if (e?.name === 'AbortError' || enrollAbortCtrl.signal.aborted) {
        setSubmitError('Device enrollment timed out. Please check your connection and try again.');
      } else {
        setSubmitError(e.message || 'Device enrollment failed. Please try again.');
      }
    } finally {
      clearTimeout(enrollTimeoutId);
      setIsEnrollingDevice(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md bg-slate-800/90 border border-slate-700/80 backdrop-blur-xl rounded-2xl shadow-2xl p-6 relative overflow-hidden">
        {/* Header Branding */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/30 mb-3">
            <ShieldCheck className="w-6 h-6 text-blue-400" />
          </div>
          <h1 className="text-xl font-bold text-white tracking-tight">SNIST Classroom Attendance</h1>
          <p className="text-xs text-slate-400 mt-1">Universal Direct Attendance Portal</p>
        </div>

        {/* 1. Loading State */}
        {isValidating && (
          <div className="py-12 flex flex-col items-center justify-center text-center">
            <RefreshCw className="w-8 h-8 text-blue-400 animate-spin mb-4" />
            <p className="text-sm font-medium text-slate-300">Validating classroom session...</p>
            <p className="text-xs text-slate-500 mt-1">Exchanging cryptographic launch claim</p>
          </div>
        )}

        {/* 2. Token Validation Error State */}
        {!isValidating && validateError && (
          <div className="py-6 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-red-500/10 text-red-400 border border-red-500/30 mb-4">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-bold text-red-400">QR Code Expired / Invalid</h2>
            <p className="text-sm text-slate-300 mt-2 mb-6 leading-relaxed">
              {validateError}
            </p>
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => navigate('/student?openScanner=1')}
                className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-lg transition flex items-center justify-center gap-2 cursor-pointer"
              >
                <Camera className="w-4 h-4" />
                <span>Open In-App Scanner</span>
              </button>
              <Link
                to="/student"
                className="block w-full py-2.5 px-4 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200 font-medium text-sm text-center transition"
              >
                Go to Student Portal
              </Link>
            </div>
          </div>
        )}

        {/* 3. Success State */}
        {!isValidating && submissionSuccess && (
          <div className="py-6 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 mb-4 shadow-lg shadow-emerald-950/40">
              <CheckCircle2 className="w-10 h-10 text-emerald-400 animate-bounce" />
            </div>
            <h2 className="text-xl font-bold text-emerald-400">Attendance Recorded!</h2>
            <p className="text-sm text-slate-300 mt-2">
              Marked <span className="font-semibold text-emerald-400">PRESENT</span> for{' '}
              <span className="text-white font-medium">{sessionData?.subject_name || 'Class Session'}</span>
            </p>
            {sessionData?.period && (
              <p className="text-xs text-slate-400 mt-1">Period: {sessionData.period}</p>
            )}

            <div className="mt-8">
              <button
                onClick={() => navigate('/student')}
                className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold text-sm shadow-lg transition flex items-center justify-center gap-2"
              >
                <span>Continue to Student Portal</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* 4. Active Session Card & Action Flow */}
        {!isValidating && !validateError && !submissionSuccess && sessionData && (
          <div>
            {/* Session Info Badge */}
            <div className="bg-slate-700/50 border border-slate-600/50 rounded-xl p-4 mb-6">
              <div className="flex items-center justify-between mb-2">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  ACTIVE SESSION
                </span>
                <span className="text-xs text-slate-400">{sessionData.session_date}</span>
              </div>

              <div className="space-y-2 mt-3">
                <div className="flex items-start gap-2.5">
                  <BookOpen className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-bold text-white leading-tight">{sessionData.subject_name}</p>
                    <p className="text-xs text-slate-400">{sessionData.subject_code || 'Subject Code'}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2.5">
                  <User className="w-4 h-4 text-indigo-400 shrink-0" />
                  <p className="text-xs text-slate-300">
                    Faculty: <span className="font-medium text-white">{sessionData.teacher_name}</span>
                  </p>
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-slate-600/40 text-xs text-slate-400">
                  <span>Section: <strong className="text-white">{sessionData.section_name}</strong></span>
                  <span>Period: <strong className="text-white">{sessionData.period}</strong></span>
                </div>
              </div>
            </div>

            {/* Error Message if Submission Failed */}
            {submitError && (
              <div className="mb-4 p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs space-y-2.5">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                  <span className="leading-relaxed">{submitError}</span>
                </div>
                {submitErrorCode === 'no_active_binding' && (
                  <button
                    type="button"
                    onClick={handleEnrollDevice}
                    disabled={isEnrollingDevice}
                    className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md transition flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    <span>{isEnrollingDevice ? 'Enrolling Device…' : 'Enroll this device'}</span>
                  </button>
                )}
                {submitErrorCode === 'expired' && (
                  <button
                    type="button"
                    onClick={() => navigate('/student?openScanner=1')}
                    className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md transition flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Camera className="w-4 h-4" />
                    <span>Open In-App Scanner</span>
                  </button>
                )}
              </div>
            )}

            {/* Sub-flow A: User Not Logged In -> Quick Login Form */}
            {!user && (
              <div className="space-y-4">
                <div className="text-center pb-2">
                  <h3 className="text-sm font-semibold text-white">Student Sign-In Required</h3>
                  <p className="text-xs text-slate-400 mt-0.5">Please authenticate with your student credentials to record attendance.</p>
                </div>

                {loginError && (
                  <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs">
                    {loginError}
                  </div>
                )}

                <form onSubmit={handleQuickLogin} className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Roll Number / SAP ID</label>
                    <input
                      type="text"
                      value={loginRoll}
                      onChange={(e) => setLoginRoll(e.target.value)}
                      placeholder="e.g. 23311A0501"
                      className="w-full px-3 py-2 bg-slate-900/80 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Password</label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={loginPass}
                        onChange={(e) => setLoginPass(e.target.value)}
                        placeholder="••••••••"
                        className="w-full px-3 py-2 bg-slate-900/80 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500 pr-10"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-200"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loginLoading}
                    className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm transition flex items-center justify-center gap-2 mt-4"
                  >
                    {loginLoading ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Signing In...</span>
                      </>
                    ) : (
                      <>
                        <span>Sign In & Verify</span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </form>

                <div className="text-center pt-2">
                  <Link
                    to={`/login?next=${encodeURIComponent(`/a/${launchToken || ''}`)}`}
                    className="text-xs text-blue-400 hover:text-blue-300 underline transition"
                  >
                    Or sign in with full student login portal
                  </Link>
                </div>
              </div>
            )}

            {/* Sub-flow B: Logged in as Teacher/Admin -> Warning */}
            {user && user.role !== 'STUDENT' && (
              <div className="text-center py-4">
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-300 text-xs mb-4">
                  Signed in as <strong>{user.role}</strong> ({user.full_name || user.username}). Attendance marking is only permitted for enrolled students.
                </div>
                <button
                  onClick={() => navigate(user?.role === 'SUPER_ADMIN' ? '/admin' : '/teacher')}
                  className="w-full py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium transition"
                >
                  Return to Dashboard
                </button>
              </div>
            )}

            {/* Sub-flow C: Logged in as Student -> Confirm Attendance Button */}
            {user && user.role === 'STUDENT' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-slate-900/60 rounded-xl border border-slate-700/60">
                  <div className="flex items-center gap-2.5">
                    <UserCheck className="w-5 h-5 text-emerald-400" />
                    <div>
                      <p className="text-xs font-semibold text-white">
                        {user.username}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        {user.full_name || 'Enrolled Student'}
                      </p>
                    </div>
                  </div>
                  <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    Verified
                  </span>
                </div>

                {submitErrorCode !== 'expired' && validateErrorCode !== 'expired' && (
                  <button
                    type="button"
                    onClick={handleConfirmAttendance}
                    disabled={isSubmitting}
                    className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-sm shadow-lg shadow-emerald-950/50 transition flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
                  >
                    {isSubmitting ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Recording Attendance...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-5 h-5" />
                        <span>Confirm Attendance Now</span>
                      </>
                    )}
                  </button>
                )}

                <p className="text-[11px] text-center text-slate-400 flex items-center justify-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-blue-400" />
                  <span>Campus GPS geofencing & device binding verified</span>
                </p>
              </div>
            )}
          </div>
        )}

        {/* 5. Fallback if session data is unexpectedly absent */}
        {!isValidating && !validateError && !submissionSuccess && !sessionData && (
          <div className="py-6 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 mb-4">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-bold text-amber-400">Class Session Not Available</h2>
            <p className="text-sm text-slate-300 mt-2 mb-6 leading-relaxed">
              We could not load the session details from this QR code. Please scan the current live QR code using the in-app scanner or sign into your student portal.
            </p>
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => navigate('/student?openScanner=1')}
                className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-lg transition flex items-center justify-center gap-2 cursor-pointer"
              >
                <Camera className="w-4 h-4" />
                <span>Open In-App Scanner</span>
              </button>
              <Link
                to="/student"
                className="block w-full py-2.5 px-4 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200 font-medium text-sm text-center transition"
              >
                Go to Student Portal
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* Post-Attendance Selfie Collection Modal */}
      {showSelfieModal && selfieAttendanceId && (
        <PostAttendanceSelfieModal
          attendanceId={selfieAttendanceId}
          rollNumber={user?.username || loginRoll.trim().toUpperCase()}
          studentName={user?.full_name}
          subjectName={sessionData?.subject_name}
          onComplete={() => {
            setShowSelfieModal(false);
          }}
          onSkip={() => {
            setShowSelfieModal(false);
          }}
        />
      )}
    </div>
  );
};
