import React, { useState, useEffect } from 'react';
import { 
  X, Smartphone, KeyRound, Mail, ArrowRight, CheckCircle2, 
  AlertTriangle, RefreshCw, Clock, ShieldCheck 
} from 'lucide-react';
import { unbindDevice } from '../services/binding';
import { useAuth } from '../context/AuthContext';
import { getOrCreateDeviceCredentials, getDeviceHeaders } from '../services/deviceCredential';

interface SelfServiceDeviceResetModalProps {
  initialRollNumber?: string;
  onClose: () => void;
  onSuccess: (rollNumber: string) => void;
}

export const SelfServiceDeviceResetModal: React.FC<SelfServiceDeviceResetModalProps> = ({
  initialRollNumber = '',
  onClose,
  onSuccess
}) => {
  const { login } = useAuth();
  const [step, setStep] = useState<'CREDENTIALS' | 'OTP' | 'SUCCESS'>('CREDENTIALS');
  const [rollNumber, setRollNumber] = useState<string>(initialRollNumber);
  const [password, setPassword] = useState<string>('');
  const [otp, setOtp] = useState<string>('');
  const [maskedEmail, setMaskedEmail] = useState<string>('');
  
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number>(600); // 10 minutes

  // Countdown timer for OTP
  useEffect(() => {
    if (step !== 'OTP' || countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [step, countdown]);

  const formatTimer = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rollNumber.trim() || !password.trim()) {
      setErrorMsg('Please enter both your Roll Number / SAP ID and Password.');
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/v1/devices/request-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roll_number: rollNumber.trim().toUpperCase(),
          password: password.trim()
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.message || 'Failed to request verification code.');
      }

      setMaskedEmail(data.masked_email || 'your registered email');
      setCountdown(600);
      setStep('OTP');
    } catch (err: any) {
      setErrorMsg(err.message || 'An error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otp.trim() || otp.trim().length !== 6) {
      setErrorMsg('Please enter the 6-digit verification code sent to your email.');
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);

    try {
      const creds = getOrCreateDeviceCredentials();
      const res = await fetch('/api/v1/devices/verify-reset', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...getDeviceHeaders()
        },
        body: JSON.stringify({
          roll_number: rollNumber.trim().toUpperCase(),
          otp: otp.trim(),
          new_device_public_id: creds.device_public_id,
          new_device_secret: creds.device_secret
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.message || 'Verification failed.');
      }

      // Wipe local keypair handles to ensure fresh enrollment ceremony on next scan
      await unbindDevice();

      setStep('SUCCESS');

      // If backend returned access token and user info, log in immediately
      if (data.access_token && data.user) {
        login(data.access_token, data.user, data.refresh_token);
        setTimeout(() => {
          window.location.href = '/student?scan=true';
        }, 1500);
      } else {
        setTimeout(() => {
          onSuccess(rollNumber.trim().toUpperCase());
        }, 1800);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Invalid verification code. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white text-slate-900 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col font-sans border border-slate-200">
        
        {/* Header */}
        <div className="bg-[#15347e] text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center">
              <Smartphone className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-sm">Self-Service Device Recovery</h3>
              <p className="text-[11px] text-blue-200">Authorize your new or replaced phone</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-white/10 text-white/70 hover:text-white transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          
          {errorMsg && (
            <div className="bg-rose-50 border border-rose-200 rounded-2xl p-3.5 flex items-start gap-2.5 text-xs text-rose-800 font-medium">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="leading-snug">{errorMsg}</div>
            </div>
          )}

          {/* STEP 1: Enter credentials */}
          {step === 'CREDENTIALS' && (
            <form onSubmit={handleRequestOtp} className="space-y-4">
              <div className="text-xs text-slate-600 leading-relaxed">
                If you replaced your phone or changed browsers, verify your institutional credentials to send a one-time code to your college email.
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  SAP ID / Roll Number
                </label>
                <input
                  type="text"
                  placeholder="e.g. 23311A05Y6"
                  value={rollNumber}
                  onChange={(e) => setRollNumber(e.target.value.toUpperCase())}
                  className="snist-input w-full uppercase font-mono text-sm tracking-wider font-bold"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Portal Password
                </label>
                <input
                  type="password"
                  placeholder="Enter your current portal password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="snist-input w-full text-sm font-medium"
                  required
                />
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-[11px] text-slate-500 leading-snug">
                <strong>Policy:</strong> Students can self-reset up to 5 times per semester. Code will be sent to your official college email.
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3.5 px-4 bg-[#15347e] hover:bg-[#102766] text-white rounded-2xl font-bold text-sm shadow-md transition active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" /> Verifying...
                  </>
                ) : (
                  <>
                    Send Verification Code <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          )}

          {/* STEP 2: Enter OTP */}
          {step === 'OTP' && (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3.5 text-xs text-blue-900 leading-relaxed">
                A 6-digit verification code was sent to <strong className="font-mono text-blue-950">{maskedEmail}</strong>.
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-slate-700">
                    Enter 6-Digit Verification Code
                  </label>
                  <span className="text-[11px] font-mono font-bold text-amber-600 flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {formatTimer(countdown)}
                  </span>
                </div>
                <input
                  type="text"
                  maxLength={6}
                  placeholder="• • • • • •"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                  className="w-full text-center tracking-[12px] text-2xl font-black font-mono py-3 rounded-2xl border-2 border-slate-300 focus:border-[#15347e] focus:outline-none bg-slate-50"
                  autoFocus
                  required
                />
              </div>

              <button
                type="submit"
                disabled={isLoading || otp.length !== 6 || countdown <= 0}
                className="w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold text-sm shadow-md transition active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" /> Authorizing Device...
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" /> Authorize This Phone & Login
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => setStep('CREDENTIALS')}
                className="w-full text-center text-xs text-slate-500 hover:text-slate-800 font-semibold"
              >
                ← Back to change details
              </button>
            </form>
          )}

          {/* STEP 3: Success state */}
          {step === 'SUCCESS' && (
            <div className="py-6 flex flex-col items-center text-center space-y-3">
              <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto shadow-inner">
                <CheckCircle2 className="w-10 h-10" />
              </div>
              <h4 className="font-extrabold text-base text-slate-900">Device Successfully Bound!</h4>
              <p className="text-xs text-slate-500 max-w-xs">
                Your current device is now registered to your student account. Redirecting you to login...
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
