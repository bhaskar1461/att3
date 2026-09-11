import React, { useState, useEffect, useCallback } from 'react';
import { apiRequest } from '../services/api';
import { Shield, Mail, Lock, Smartphone, CheckCircle2, AlertCircle, ArrowRight, Loader2 } from 'lucide-react';

interface StudentInfo {
  roll_number: string;
  name: string;
  email: string;
  department: string;
  section: string;
  academic_year: string;
  gender: string;
}

type WizardStep = 'validating' | 'details' | 'otp' | 'pin' | 'device' | 'activated' | 'error';

export const OnboardingWizard: React.FC = () => {
  const [step, setStep] = useState<WizardStep>('validating');
  const [sessionToken, setSessionToken] = useState('');
  const [student, setStudent] = useState<StudentInfo | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // OTP state
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [emailHint, setEmailHint] = useState('');

  // PIN state
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');

  // Device state
  const [consent, setConsent] = useState(false);
  const [deviceUuid, setDeviceUuid] = useState('');

  // Activation result
  const [activationResult, setActivationResult] = useState<any>(null);

  // Parse token from URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (!token) {
      setError('Student onboarding now uses direct permanent login. Please sign in directly with your SAP ID / Roll Number and PIN.');
      setStep('error');
      return;
    }
    verifyToken(token);
  }, []);

  // Generate device UUID
  useEffect(() => {
    const storedId = localStorage.getItem('device_public_id');
    if (storedId) {
      setDeviceUuid(storedId);
    } else {
      const newId = crypto.randomUUID ? crypto.randomUUID() : 
        'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
          const r = Math.random() * 16 | 0;
          return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
      localStorage.setItem('device_public_id', newId);
      setDeviceUuid(newId);
    }
  }, []);

  const verifyToken = async (token: string) => {
    setLoading(true);
    setError('');
    try {
      const res: any = await apiRequest('/onboard/verify-token', {
        method: 'POST',
        body: JSON.stringify({ token }),
      });
      setSessionToken(res.session_token);
      setStudent(res.student);
      
      // Resume from last completed step
      if (res.pin_set) {
        setStep('device');
      } else if (res.otp_verified) {
        setStep('pin');
      } else {
        setStep('details');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to verify onboarding link.');
      setStep('error');
    } finally {
      setLoading(false);
    }
  };

  const requestOtp = async () => {
    setLoading(true);
    setError('');
    try {
      const res: any = await apiRequest('/onboard/request-otp', {
        method: 'POST',
        body: JSON.stringify({ session_token: sessionToken }),
      });
      setOtpSent(true);
      setEmailHint(res.email_hint || '');
      setStep('otp');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async () => {
    if (otpCode.length !== 6) return;
    setLoading(true);
    setError('');
    try {
      await apiRequest('/onboard/verify-otp', {
        method: 'POST',
        body: JSON.stringify({ session_token: sessionToken, otp_code: otpCode }),
      });
      setStep('pin');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const submitPin = async () => {
    if (pin !== pinConfirm) {
      setError('PINs do not match.');
      return;
    }
    if (pin.length < 4 || pin.length > 6 || !/^\d+$/.test(pin)) {
      setError('PIN must be 4-6 digits.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await apiRequest('/onboard/set-pin', {
        method: 'POST',
        body: JSON.stringify({ session_token: sessionToken, pin }),
      });
      setStep('device');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const activateAccount = async () => {
    if (!consent) {
      setError('You must agree to the attendance policy.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res: any = await apiRequest('/onboard/activate', {
        method: 'POST',
        body: JSON.stringify({
          session_token: sessionToken,
          device_uuid: deviceUuid,
          consent: true,
        }),
      });
      setActivationResult(res);
      setStep('activated');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // --- Step indicators ---
  const steps = [
    { key: 'details', label: 'Verify Details', icon: Shield },
    { key: 'otp', label: 'Email OTP', icon: Mail },
    { key: 'pin', label: 'Set PIN', icon: Lock },
    { key: 'device', label: 'Bind Device', icon: Smartphone },
    { key: 'activated', label: 'Activated', icon: CheckCircle2 },
  ];

  const currentStepIndex = steps.findIndex(s => s.key === step);

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f7f9fe] to-[#ecf1fb] flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-lg">

        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="font-heading text-2xl font-extrabold text-[#15347e]">Student Onboarding</h1>
          <p className="text-sm text-[#6a7894] mt-1">SNIST AI QR Attendance System</p>
        </div>

        {/* Stepper */}
        {step !== 'validating' && step !== 'error' && (
          <div className="flex items-center justify-between mb-8 px-2">
            {steps.map((s, i) => {
              const Icon = s.icon;
              const isActive = s.key === step;
              const isComplete = currentStepIndex > i;
              return (
                <React.Fragment key={s.key}>
                  <div className="flex flex-col items-center gap-1">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                      isComplete ? 'bg-emerald-500 text-white' :
                      isActive ? 'bg-[#2f53d7] text-white ring-4 ring-[#2f53d7]/20' :
                      'bg-slate-200 text-slate-400'
                    }`}>
                      {isComplete ? <CheckCircle2 className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
                    </div>
                    <span className={`text-[10px] font-bold ${isActive ? 'text-[#2f53d7]' : 'text-slate-400'}`}>
                      {s.label}
                    </span>
                  </div>
                  {i < steps.length - 1 && (
                    <div className={`flex-1 h-0.5 mx-1 rounded ${isComplete ? 'bg-emerald-400' : 'bg-slate-200'}`} />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        )}

        {/* Card */}
        <div className="snist-card p-6 sm:p-8 space-y-5">

          {/* Error display */}
          {error && (
            <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* STEP: Validating */}
          {step === 'validating' && (
            <div className="text-center py-12">
              <Loader2 className="w-10 h-10 text-[#2f53d7] animate-spin mx-auto mb-4" />
              <p className="text-[#6a7894] font-medium">Verifying your onboarding link...</p>
            </div>
          )}

          {/* STEP: Error */}
          {step === 'error' && (
            <div className="text-center py-8 space-y-4">
              <div className="w-14 h-14 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-2">
                <Shield className="w-8 h-8 text-amber-600" />
              </div>
              <h2 className="font-heading text-lg font-bold text-[#15347e]">Student Direct Login Portal</h2>
              <p className="text-sm text-[#6a7894] max-w-sm mx-auto">
                {error || 'Student onboarding now uses direct permanent login. Please sign in with your SAP ID / Roll Number and PIN.'}
              </p>
              <div className="pt-2">
                <a
                  href="/login"
                  className="inline-flex items-center gap-2 px-6 py-2.5 snist-btn-primary text-sm font-bold shadow-md hover:shadow-lg transition active:scale-95"
                >
                  Go to Login Portal →
                </a>
              </div>
              <p className="text-xs text-slate-400">If you need your initial PIN, your teacher or administrator can reset it instantly from the Onboarding Manager.</p>
            </div>
          )}

          {/* STEP: Details */}
          {step === 'details' && student && (
            <>
              <h2 className="font-heading text-lg font-bold text-[#15347e]">Verify Your Details</h2>
              <p className="text-sm text-[#6a7894]">Please confirm the information below is correct.</p>

              <div className="bg-[#f0f4ff] border border-[#d4dff7] rounded-xl p-4 space-y-3">
                {[
                  ['Roll Number', student.roll_number],
                  ['Name', student.name],
                  ['Email', student.email],
                  ['Department', student.department],
                  ['Section', student.section],
                  ['Year', student.academic_year],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between items-center">
                    <span className="text-xs font-bold text-[#6a7894] uppercase">{label}</span>
                    <span className="text-sm font-semibold text-[#15347e] font-mono">{value || '—'}</span>
                  </div>
                ))}
              </div>

              <button
                onClick={requestOtp}
                disabled={loading}
                className="w-full py-3 snist-btn-primary text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                Confirm & Send Verification Email
              </button>
            </>
          )}

          {/* STEP: OTP */}
          {step === 'otp' && (
            <>
              <h2 className="font-heading text-lg font-bold text-[#15347e]">Email Verification</h2>
              <p className="text-sm text-[#6a7894]">
                A 6-digit verification code has been sent to <strong>{emailHint}</strong>
              </p>

              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={otpCode}
                onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                className="w-full text-center text-3xl font-mono font-bold tracking-[12px] py-4 border-2 border-[#d4dff7] rounded-xl focus:border-[#2f53d7] focus:ring-4 focus:ring-[#2f53d7]/10 outline-none transition"
              />

              <button
                onClick={verifyOtp}
                disabled={loading || otpCode.length !== 6}
                className="w-full py-3 snist-btn-primary text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Verify Code
              </button>

              <button
                onClick={requestOtp}
                disabled={loading}
                className="w-full py-2.5 text-xs font-semibold text-[#2f53d7] hover:underline"
              >
                Didn't receive it? Send again
              </button>
            </>
          )}

          {/* STEP: PIN */}
          {step === 'pin' && (
            <>
              <h2 className="font-heading text-lg font-bold text-[#15347e]">Set Your Login PIN</h2>
              <p className="text-sm text-[#6a7894]">
                Choose a 4-6 digit PIN for daily attendance login. Keep it secret.
              </p>

              <div className="space-y-3">
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={pin}
                  onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="Enter PIN"
                  className="w-full text-center text-2xl font-mono font-bold tracking-[8px] py-3 border-2 border-[#d4dff7] rounded-xl focus:border-[#2f53d7] focus:ring-4 focus:ring-[#2f53d7]/10 outline-none transition"
                />
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={pinConfirm}
                  onChange={e => setPinConfirm(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="Confirm PIN"
                  className="w-full text-center text-2xl font-mono font-bold tracking-[8px] py-3 border-2 border-[#d4dff7] rounded-xl focus:border-[#2f53d7] focus:ring-4 focus:ring-[#2f53d7]/10 outline-none transition"
                />
              </div>

              {pin && pinConfirm && pin !== pinConfirm && (
                <p className="text-xs text-red-500 font-medium">PINs do not match.</p>
              )}

              <button
                onClick={submitPin}
                disabled={loading || !pin || pin !== pinConfirm || pin.length < 4}
                className="w-full py-3 snist-btn-primary text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                Set PIN & Continue
              </button>
            </>
          )}

          {/* STEP: Device Bind + Consent */}
          {step === 'device' && (
            <>
              <h2 className="font-heading text-lg font-bold text-[#15347e]">Device Binding & Consent</h2>
              <p className="text-sm text-[#6a7894]">
                Your account will be permanently bound to this device. You can request a device change (max 5/semester) through your coordinator.
              </p>

              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2">
                <p className="text-xs font-bold text-amber-700">⚠️ DEVICE BINDING</p>
                <p className="text-xs text-amber-800">Device ID: <code className="bg-amber-100 px-1.5 py-0.5 rounded font-mono text-[10px]">{deviceUuid.slice(0, 16)}...</code></p>
                <p className="text-xs text-amber-600">This device will be your registered attendance device. Logging in from other devices will be blocked.</p>
              </div>

              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={e => setConsent(e.target.checked)}
                  className="mt-1 w-4 h-4 rounded border-slate-300 text-[#2f53d7] focus:ring-[#2f53d7]"
                />
                <span className="text-xs text-[#6a7894] leading-relaxed">
                  I agree to the SNIST Attendance Policy. I understand that my device is being registered, my attendance is tracked via QR scan, and any attempt to manipulate the system may result in disciplinary action.
                </span>
              </label>

              <button
                onClick={activateAccount}
                disabled={loading || !consent}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 transition disabled:opacity-50"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Activate My Account
              </button>
            </>
          )}

          {/* STEP: Activated */}
          {step === 'activated' && (
            <div className="text-center py-6 space-y-4">
              <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-10 h-10 text-emerald-600" />
              </div>
              <h2 className="font-heading text-xl font-bold text-emerald-700">Account Activated!</h2>
              <p className="text-sm text-[#6a7894]">
                Your SNIST attendance account is ready. You can now log in using your roll number and PIN.
              </p>
              {activationResult?.user && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-left space-y-2">
                  <p className="text-xs"><strong>Roll Number:</strong> {activationResult.user.roll_number}</p>
                  <p className="text-xs"><strong>Name:</strong> {activationResult.user.name}</p>
                </div>
              )}
              <a
                href="/login"
                className="inline-block px-8 py-3 snist-btn-primary text-sm font-bold"
              >
                Go to Login →
              </a>
            </div>
          )}

        </div>

        {/* Footer */}
        <p className="text-center text-[10px] text-slate-400 mt-6">
          Sreenidhi Institute of Science & Technology — AI QR Attendance System
        </p>
      </div>
    </div>
  );
};
