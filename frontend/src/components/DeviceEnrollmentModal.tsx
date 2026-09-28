import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  CheckCircle,
  AlertTriangle,
  AlertOctagon,
  Smartphone,
  Mail,
  KeyRound,
  X,
  Loader2,
  Lock,
  ArrowRight,
  RefreshCw
} from 'lucide-react';
import {
  getBindingState,
  checkServerBindingStatus,
  enrollCurrentDevice,
  requestRebindOtp,
  verifyRebindOtp,
  ServerBindingStatus,
  unbindDevice
} from '../services/binding';

export interface DeviceEnrollmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onEnrolled?: () => void;
  studentRoll?: string;
  initialStatus?: ServerBindingStatus | null;
}

export type ModalFlowStep =
  | 'INSPECTING'
  | 'FIRST_TIME'
  | 'TAKEOVER_PROMPT'
  | 'OTP_INPUT'
  | 'ENROLLED'
  | 'LOCKED'
  | 'UNSUPPORTED'
  | 'ERROR';

export const DeviceEnrollmentModal: React.FC<DeviceEnrollmentModalProps> = ({
  isOpen,
  onClose,
  onEnrolled,
  studentRoll = '',
  initialStatus
}) => {
  const [step, setStep] = useState<ModalFlowStep>('INSPECTING');
  const [otpValue, setOtpValue] = useState<string>('');
  const [maskedEmail, setMaskedEmail] = useState<string>('');
  const [replacedAt, setReplacedAt] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number>(600); // 10 minutes OTP validity
  const [resendCooldown, setResendCooldown] = useState<number>(0);

  // OTP Countdown Timer
  useEffect(() => {
    if (step !== 'OTP_INPUT' || countdown <= 0) return;
    const timer = setInterval(() => setCountdown(prev => prev - 1), 1000);
    return () => clearInterval(timer);
  }, [step, countdown]);

  // Resend Cooldown Timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => setResendCooldown(prev => prev - 1), 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  // Inspect authoritative state upon opening
  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    const inspect = async () => {
      setStep('INSPECTING');
      setErrorMsg(null);
      setOtpValue('');

      try {
        const localState = await getBindingState(studentRoll);
        if (localState === 'unsupported') {
          if (isMounted) setStep('UNSUPPORTED');
          return;
        }

        const serverStatus = initialStatus || (await checkServerBindingStatus());
        if (!isMounted) return;

        if (serverStatus?.state === 'device_locked') {
          setStep('LOCKED');
          return;
        }

        if (
          serverStatus?.state === 'binding_exists_mismatch' ||
          serverStatus?.state === 'revoked' ||
          serverStatus?.status === 'MISMATCH' ||
          serverStatus?.replaced_at
        ) {
          setReplacedAt(serverStatus?.replaced_at || null);
          setStep('TAKEOVER_PROMPT');
          return;
        }

        if (serverStatus?.state === 'active' && localState === 'enrolled') {
          setStep('ENROLLED');
          return;
        }

        // First-time enrollment or clean client
        setStep('FIRST_TIME');
      } catch (err: any) {
        if (isMounted) {
          setErrorMsg(err?.message || 'Failed to determine device binding status.');
          setStep('FIRST_TIME');
        }
      }
    };

    inspect();
    return () => {
      isMounted = false;
    };
  }, [isOpen, studentRoll, initialStatus]);

  if (!isOpen) return null;

  // Handle first-time direct registration (login session authenticated)
  const handleRegisterDirect = async () => {
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const activeRoll = studentRoll || (localStorage.getItem('user') ? JSON.parse(localStorage.getItem('user') || '{}').roll_number : '');
      const res = await enrollCurrentDevice(activeRoll);

      if (res.requiresOtp) {
        setMaskedEmail(res.maskedEmail || 'your registered college email');
        setCountdown(600);
        setResendCooldown(30);
        setStep('OTP_INPUT');
        return;
      }

      if (res.success) {
        setStep('ENROLLED');
        setTimeout(() => {
          if (onEnrolled) onEnrolled();
        }, 1200);
        return;
      }

      setErrorMsg(res.error || 'Enrollment could not be completed.');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to enroll device.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle requesting takeover OTP
  const handleRequestOtp = async () => {
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await requestRebindOtp();
      if (res.success) {
        setMaskedEmail(res.maskedEmail || 'your registered college email');
        setCountdown(600);
        setResendCooldown(30);
        setStep('OTP_INPUT');
      } else {
        setErrorMsg(res.error || 'Failed to send verification code.');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to request verification code.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle verifying takeover OTP
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpValue.trim() || otpValue.trim().length !== 6) {
      setErrorMsg('Please enter the 6-digit verification code.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const activeRoll = studentRoll || (localStorage.getItem('user') ? JSON.parse(localStorage.getItem('user') || '{}').roll_number : '');
      const res = await verifyRebindOtp(otpValue.trim(), activeRoll);
      if (res.success) {
        setStep('ENROLLED');
        setTimeout(() => {
          if (onEnrolled) onEnrolled();
        }, 1200);
      } else {
        setErrorMsg(res.error || 'Verification code invalid or expired.');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to verify code.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatTimer = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-150">
      <div className="relative w-full max-w-md overflow-hidden bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl">
        {/* Top Accent Band */}
        <div className="h-1.5 w-full bg-gradient-to-r from-blue-600 via-indigo-500 to-emerald-400" />

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 rounded-full transition-colors"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="p-6">
          {/* STEP 0: INSPECTING */}
          {step === 'INSPECTING' && (
            <div className="flex flex-col items-center justify-center py-12 space-y-3">
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
              <p className="text-sm font-medium text-slate-300">Checking device security status…</p>
            </div>
          )}

          {/* STEP 1: FIRST-TIME ENROLLMENT */}
          {step === 'FIRST_TIME' && (
            <div className="space-y-5">
              <div className="flex items-center space-x-3.5">
                <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-400 shrink-0">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white tracking-tight">Link This Device</h3>
                  <p className="text-xs text-slate-400">Institutional Device Security Setup</p>
                </div>
              </div>

              <p className="text-sm text-slate-300 leading-relaxed">
                To mark attendance, your student account must be linked to this phone. A private hardware key
                is created locally to prevent proxy marking.
              </p>

              <div className="p-3.5 space-y-2 rounded-2xl bg-slate-800/40 border border-slate-800 text-xs text-slate-400">
                <div className="flex items-center space-x-2 text-slate-200 font-semibold">
                  <Lock className="w-4 h-4 text-blue-400 shrink-0" />
                  <span>One-Click Verification</span>
                </div>
                <p className="leading-normal">
                  No passwords or SMS required. Your current login session authenticates this device instantly.
                </p>
              </div>

              {errorMsg && (
                <div className="p-3 text-xs text-rose-300 rounded-xl bg-rose-500/10 border border-rose-500/20">
                  {errorMsg}
                </div>
              )}

              <div className="pt-2 flex flex-col sm:flex-row gap-2.5">
                <button
                  type="button"
                  onClick={handleRegisterDirect}
                  disabled={isSubmitting}
                  className="flex-1 py-3 px-4 bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-500 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-sm rounded-xl shadow-lg shadow-blue-500/25 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Linking Device…</span>
                    </>
                  ) : (
                    <>
                      <span>Link Device Now</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isSubmitting}
                  className="px-4 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-sm rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: TAKEOVER PROMPT (BINDING ON ANOTHER DEVICE) */}
          {step === 'TAKEOVER_PROMPT' && (
            <div className="space-y-5">
              <div className="flex items-center space-x-3.5">
                <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 shrink-0">
                  <Smartphone className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white tracking-tight">Move Attendance Here</h3>
                  <p className="text-xs text-amber-400 font-medium">Active on Another Device</p>
                </div>
              </div>

              <p className="text-sm text-slate-300 leading-relaxed">
                Your account is currently linked to another phone
                {replacedAt ? ` (replaced: ${new Date(replacedAt).toLocaleDateString()})` : ''}.
                You can easily move attendance to this phone via a one-time verification code.
              </p>

              <div className="p-3.5 space-y-2 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300">
                <p className="font-semibold">Self-Service Device Recovery</p>
                <p className="text-amber-200/80 leading-normal">
                  We'll send a 6-digit code to your registered college email. Verifying will activate this phone
                  and disconnect the old one.
                </p>
              </div>

              {errorMsg && (
                <div className="p-3 text-xs text-rose-300 rounded-xl bg-rose-500/10 border border-rose-500/20">
                  {errorMsg}
                </div>
              )}

              <div className="pt-2 flex flex-col sm:flex-row gap-2.5">
                <button
                  type="button"
                  onClick={handleRequestOtp}
                  disabled={isSubmitting}
                  className="flex-1 py-3 px-4 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black text-sm rounded-xl shadow-lg shadow-amber-500/20 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                      <span>Sending Code…</span>
                    </>
                  ) : (
                    <>
                      <Mail className="w-4 h-4 text-slate-950" />
                      <span>Send Verification Code</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isSubmitting}
                  className="px-4 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-sm rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: OTP INPUT */}
          {step === 'OTP_INPUT' && (
            <form onSubmit={handleVerifyOtp} className="space-y-5">
              <div className="flex items-center space-x-3.5">
                <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 shrink-0">
                  <KeyRound className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white tracking-tight">Enter Verification Code</h3>
                  <p className="text-xs text-slate-400">Sent to {maskedEmail}</p>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs text-slate-300 font-medium block">6-Digit Email Code</label>
                <input
                  type="text"
                  maxLength={6}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={otpValue}
                  onChange={(e) => setOtpValue(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="123456"
                  className="w-full py-3.5 px-4 bg-slate-800/80 border border-slate-700 rounded-xl text-center text-2xl font-mono tracking-[0.4em] font-bold text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all placeholder:text-slate-600"
                  autoFocus
                />
                <div className="flex justify-between items-center text-[11px] text-slate-400 px-1 pt-1">
                  <span>Code expires in: <strong className="text-amber-300 font-mono">{formatTimer(countdown)}</strong></span>
                  {resendCooldown > 0 ? (
                    <span className="text-slate-500 font-mono">Resend in {resendCooldown}s</span>
                  ) : (
                    <button
                      type="button"
                      onClick={handleRequestOtp}
                      disabled={isSubmitting}
                      className="text-blue-400 hover:text-blue-300 underline font-semibold cursor-pointer"
                    >
                      Resend Code
                    </button>
                  )}
                </div>
              </div>

              {errorMsg && (
                <div className="p-3 text-xs text-rose-300 rounded-xl bg-rose-500/10 border border-rose-500/20">
                  {errorMsg}
                </div>
              )}

              <div className="pt-2 flex flex-col sm:flex-row gap-2.5">
                <button
                  type="submit"
                  disabled={isSubmitting || otpValue.trim().length !== 6}
                  className="flex-1 py-3 px-4 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-black text-sm rounded-xl shadow-lg shadow-emerald-500/25 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                      <span>Verifying & Linking…</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-4 h-4 text-slate-950" />
                      <span>Confirm & Activate Device</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isSubmitting}
                  className="px-4 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-sm rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {/* STEP 4: ENROLLED SUCCESS */}
          {step === 'ENROLLED' && (
            <div className="space-y-5 text-center py-4">
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 border-2 border-emerald-400 text-emerald-400 flex items-center justify-center mx-auto animate-in zoom-in duration-200">
                <CheckCircle className="w-8 h-8" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white tracking-tight">Device Successfully Linked!</h3>
                <p className="text-xs text-emerald-300/90 mt-1 font-medium">Hardware-Locked Cryptographic Key Active</p>
              </div>
              <p className="text-sm text-slate-300 max-w-xs mx-auto">
                This phone is now authorized for fast, instant attendance scanning.
              </p>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  if (onEnrolled) onEnrolled();
                }}
                className="w-full py-3 px-4 bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-black text-sm rounded-xl shadow-lg transition active:scale-98 cursor-pointer flex items-center justify-center gap-2"
              >
                <span>Continue to Scanner</span>
                <ArrowRight className="w-4 h-4 text-slate-950" />
              </button>
            </div>
          )}

          {/* STEP 5: LOCKED OUT (CHURN LIMIT EXCEEDED) */}
          {step === 'LOCKED' && (
            <div className="space-y-5">
              <div className="flex items-center space-x-3.5">
                <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 shrink-0">
                  <AlertOctagon className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white tracking-tight">Device Limit Reached</h3>
                  <p className="text-xs text-rose-400 font-medium">Institutional Policy Cap</p>
                </div>
              </div>

              <p className="text-sm text-slate-300 leading-relaxed">
                You have reached the maximum number of device switches allowed in a 30-day period (security limit).
              </p>

              <div className="p-3.5 space-y-2 rounded-2xl bg-slate-800/60 border border-slate-700 text-xs text-slate-300">
                <p className="font-semibold text-white">How to Resolve:</p>
                <ol className="list-decimal list-inside space-y-1 text-slate-400">
                  <li>Contact your department coordinator or attendance administrator.</li>
                  <li>Provide your Roll Number / SAP ID for an administrative device reset.</li>
                </ol>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="w-full py-3 px-4 bg-slate-800 hover:bg-slate-700 text-white font-medium text-sm rounded-xl transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          )}

          {/* STEP 6: UNSUPPORTED BROWSER */}
          {step === 'UNSUPPORTED' && (
            <div className="space-y-5">
              <div className="flex items-center space-x-3.5">
                <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 shrink-0">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white tracking-tight">Browser Unsupported</h3>
                  <p className="text-xs text-rose-400 font-medium">Web Crypto ECDSA Required</p>
                </div>
              </div>

              <p className="text-sm text-slate-300 leading-relaxed">
                This browser lacks standard cryptographic hardware key support. Please open SNIST ERP in Google Chrome or Safari to continue.
              </p>

              <button
                type="button"
                onClick={onClose}
                className="w-full py-3 px-4 bg-slate-800 hover:bg-slate-700 text-white font-medium text-sm rounded-xl transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
