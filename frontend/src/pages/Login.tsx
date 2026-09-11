import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { ArrowRight, Eye, EyeOff, Lock, Mail, Clock, AlertTriangle, Smartphone, Download, PlusSquare, X } from 'lucide-react';
import { Toast } from '../components/Toast';
import { getOrCreateDeviceCredentials, getDeviceHeaders } from '../services/deviceCredential';
import { SelfServiceDeviceResetModal } from '../components/SelfServiceDeviceResetModal';
import { initPwaTelemetryListeners } from '../services/telemetryService';
import { usePwaInstall } from '../hooks/usePwaInstall';
import { IosInstallGuideModal } from '../components/IosInstallGuideModal';

export const Login: React.FC = () => {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'warning' } | null>(null);
  const [onboardingWarning, setOnboardingWarning] = useState(false);
  const [lockoutSecondsRemaining, setLockoutSecondsRemaining] = useState<number | null>(null);
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);
  const [showResetModal, setShowResetModal] = useState<boolean>(false);
  const [deviceMismatchError, setDeviceMismatchError] = useState<boolean>(false);
  const {
    isStandalone,
    platform,
    browser,
    canInstallPrompt,
    isInstalling,
    showIosGuide,
    copied,
    setShowIosGuide,
    promptInstall,
    copyLink,
  } = usePwaInstall();

  useEffect(() => {
    initPwaTelemetryListeners();
  }, []);

  // Magic link state (for faculty/students logging in via magic link)
  const [magicToken, setMagicToken] = useState<string | null>(null);
  const [magicUserInfo, setMagicUserInfo] = useState<{ username: string; full_name: string; role: string } | null>(null);
  const [isVerifyingMagic, setIsVerifyingMagic] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reason = params.get('reason');
    if (reason === 'session_expired' || reason === 'idle_timeout') {
      setToast({ message: 'Your session expired after inactivity. Please sign in again.', type: 'warning' });
    } else if (reason === 'user_logout') {
      setToast({ message: 'You have been safely signed out.', type: 'success' });
    } else if (reason === 'binding_403' || reason === 'device_mismatch') {
      setDeviceMismatchError(true);
      setToast({ message: 'Your account is bound to another device. Please reset device binding or sign in on your registered device.', type: 'error' });
    }

    const token = params.get('magic_token') || params.get('token');
    if (token) {
      setMagicToken(token);
      setIsVerifyingMagic(true);
      fetch(`/api/v1/auth/magic-token-info?token=${encodeURIComponent(token)}`)
        .then(async (res) => {
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || 'Magic link is invalid or expired.');
          }
          return res.json();
        })
        .then((data) => {
          setMagicUserInfo(data);
        })
        .catch((err) => {
          setToast({ message: err.message, type: 'error' });
          setMagicToken(null);
        })
        .finally(() => {
          setIsVerifyingMagic(false);
        });
    }
  }, []);

  // Live lockout countdown timer
  useEffect(() => {
    if (lockoutSecondsRemaining === null || lockoutSecondsRemaining <= 0) return;
    const timer = setInterval(() => {
      setLockoutSecondsRemaining((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(timer);
          return null;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [lockoutSecondsRemaining]);

  const formatMMSS = (totalSeconds: number) => {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleMagicLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword && newPassword !== confirmPassword) {
      setToast({ message: "Passwords do not match. Please re-enter.", type: 'error' });
      return;
    }
    if (newPassword && newPassword.length < 4) {
      setToast({ message: "Password must be at least 4 characters.", type: 'error' });
      return;
    }

    setIsLoading(true);
    try {
      const deviceCreds = getOrCreateDeviceCredentials();
      const res = await fetch('/api/v1/auth/magic-login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: magicToken,
          new_password: newPassword ? newPassword.trim() : undefined,
          device_public_id: deviceCreds.device_public_id,
          device_secret: deviceCreds.device_secret,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Magic login failed.');
      }

      login(data.access_token, {
        id: data.user_id,
        username: data.username,
        role: data.role,
        full_name: data.full_name,
      }, data.refresh_token);

      if (data.password_updated) {
        setToast({ message: "Password set successfully! Entering portal...", type: 'success' });
      }

      setTimeout(() => {
        if (data.role === 'SUPER_ADMIN') window.location.href = '/admin';
        else if (data.role === 'TEACHER') window.location.href = '/teacher';
        else window.location.href = '/student?scan=true';
      }, 400);

    } catch (err: any) {
      setToast({ message: err.message || 'Login failed', type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lockoutSecondsRemaining !== null && lockoutSecondsRemaining > 0) {
      setToast({ 
        message: `Account is temporarily locked. Please wait ${formatMMSS(lockoutSecondsRemaining)} before retrying.`, 
        type: 'warning' 
      });
      return;
    }

    setIsLoading(true);
    setOnboardingWarning(false);
    try {
      const deviceCreds = getOrCreateDeviceCredentials();
      const deviceHeaders = getDeviceHeaders();

      const cleanUsername = username.trim();
      const cleanPassword = password.trim();

      const formData = new URLSearchParams();
      formData.append('username', cleanUsername);
      formData.append('password', cleanPassword);
      formData.append('device_public_id', deviceCreds.device_public_id);
      formData.append('device_secret', deviceCreds.device_secret);

      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 
          'Content-Type': 'application/x-www-form-urlencoded',
          ...deviceHeaders
        },
        body: formData,
      });

      const text = await res.text();

      if (!res.ok) {
        let msg = 'Invalid credentials. Please check your username & password.';
        let errData: any = {};
        try {
          errData = JSON.parse(text);
          if (errData.detail) msg = typeof errData.detail === 'string' ? errData.detail : msg;
        } catch {}

        // Detect premature login by unactivated student (HTTP 403)
        if (res.status === 403 && msg.toLowerCase().includes('activated yet')) {
          setOnboardingWarning(true);
          setToast({ message: msg, type: 'warning', duration: 8000 } as any);
          return;
        }

        // Detect unapproved device lockout (HTTP 403)
        if (res.status === 403 && (msg.toLowerCase().includes('different device') || msg.toLowerCase().includes('unapproved device') || msg.toLowerCase().includes('reset your device binding'))) {
          setDeviceMismatchError(true);
          setToast({ message: msg, type: 'error', duration: 10000 } as any);
          return;
        }

        // Handle HTTP 429: Account Lockout / Rate Limit
        if (res.status === 429) {
          const retryAfterHeader = res.headers.get('Retry-After');
          const seconds = errData.retry_after_seconds || (retryAfterHeader ? parseInt(retryAfterHeader, 10) : 1800);
          setLockoutSecondsRemaining(seconds);
          setToast({ message: msg, type: 'error', duration: 8000 } as any);
          return;
        }

        // Handle HTTP 401: Wrong Password with Attempts Countdown
        if (res.status === 401) {
          const attemptsRem = errData.attempts_remaining !== undefined && errData.attempts_remaining !== null
            ? errData.attempts_remaining
            : (res.headers.get('X-Attempts-Remaining') ? parseInt(res.headers.get('X-Attempts-Remaining')!, 10) : null);
          
          if (attemptsRem !== null && !isNaN(attemptsRem)) {
            setAttemptsRemaining(attemptsRem);
            if (attemptsRem > 1) {
              msg = `Incorrect password — ${attemptsRem} attempts remaining before a 30-minute lockout`;
            } else if (attemptsRem === 1) {
              msg = `⚠️ Incorrect password — LAST attempt remaining before a 30-minute lockout!`;
            } else {
              msg = `Incorrect password. Account locked for 30 minutes.`;
            }
          }
        }

        throw new Error(msg);
      }

      let response: any;
      try {
        response = JSON.parse(text);
      } catch {
        throw new Error('Server returned an unexpected response. Please try again.');
      }

      login(response.access_token, {
        id: response.user_id,
        username: response.username,
        role: response.role,
        full_name: response.full_name
      }, response.refresh_token);

      if (response.role === 'SUPER_ADMIN') window.location.href = '/admin';
      else if (response.role === 'TEACHER') window.location.href = '/teacher';
      else window.location.href = '/student?scan=true';

    } catch (err: any) {
      let message = err?.message || 'Login failed';
      if (message.includes('pattern') || message.includes('Unexpected token') || message.includes('SyntaxError')) {
        message = 'Invalid response or network error. Please try again.';
      }
      setToast({ message, type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };


  return (
    <div className="min-h-screen bg-[#FBFBFD] text-[#1b1b1d] font-sans flex flex-col justify-center items-center px-4 sm:px-6 lg:px-8 relative overflow-hidden">
      
      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} duration={toast.type === 'warning' ? 8000 : 4000} />
      )}

      {/* Ambient Blurred Accents */}
      <div className="fixed top-0 left-0 w-full h-full -z-10 overflow-hidden pointer-events-none flex justify-center items-center">
        <div className="absolute w-[800px] h-[800px] bg-[#d5e3ff]/30 rounded-full blur-[120px] opacity-50 -top-1/4 -right-1/4"></div>
        <div className="absolute w-[600px] h-[600px] bg-[#3a5f94]/10 rounded-full blur-[100px] opacity-60 bottom-0 -left-1/4"></div>
      </div>

      <div className="w-full max-w-sm flex flex-col items-center">
        
        {/* SNIST Logo Card */}
        <div className="mb-8 w-16 h-16 rounded-xl overflow-hidden bg-white shadow-sm flex items-center justify-center border border-[#D2D2D7] p-2">
          <picture>
            <source srcSet="/snist_logo.webp" type="image/webp" />
            <img 
              src="/snist_logo.jpg" 
              alt="SNIST ERP Logo" 
              className="w-12 h-12 object-contain rounded-lg"
              loading="lazy"
              decoding="async"
            />
          </picture>
        </div>

        {/* Headline */}
        <h2 className="text-3xl font-bold text-[#1b1b1d] mb-2 text-center tracking-tight font-geist">
          {magicUserInfo ? `Hello, ${magicUserInfo.full_name}` : 'Welcome back.'}
        </h2>
        <p className="text-xs text-[#5e5e63] mb-8 text-center font-medium">
          {magicUserInfo ? 'Faculty Direct Access & Password Setup' : 'SNIST Academic Attendance Portal'}
        </p>

        {isVerifyingMagic ? (
          <div className="w-full bg-white border border-[#D2D2D7] rounded-xl p-8 text-center shadow-sm">
            <div className="w-8 h-8 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-xs text-slate-500 font-medium">Verifying your secure sign-in link...</p>
          </div>
        ) : magicUserInfo ? (
          /* Magic Link Sign-In & Password Setup Form */
          <form onSubmit={handleMagicLoginSubmit} className="w-full space-y-4">
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
              <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide bg-emerald-200 text-emerald-800 mb-1.5">
                Authenticated Link
              </span>
              <p className="text-xs text-emerald-950 font-bold leading-tight">
                {magicUserInfo.full_name} ({magicUserInfo.username})
              </p>
              <p className="text-[11px] text-emerald-700 mt-1 leading-snug">
                You can choose a new password for yourself below, or leave it blank to keep your current password.
              </p>
            </div>

            {/* Optional New Password Input */}
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-slate-700">Choose New Password (Optional)</label>
              <div className="relative rounded-lg bg-white border border-[#D2D2D7] focus-within:border-emerald-600 transition-colors overflow-hidden flex items-center px-4 py-2.5 h-12 shadow-sm">
                <Lock className="w-4 h-4 text-[#737780] mr-2.5 shrink-0" />
                <input
                  type={showNewPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Set your own password (e.g. Sowjanya@2026)"
                  className="w-full bg-transparent border-0 p-0 text-[#1b1b1d] text-xs placeholder:text-slate-400 focus:ring-0 focus:outline-none pr-8"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-3 text-[#737780] hover:text-[#1b1b1d] focus:outline-none"
                >
                  {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {newPassword.length > 0 && (
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700">Confirm New Password</label>
                <div className="relative rounded-lg bg-white border border-[#D2D2D7] focus-within:border-emerald-600 transition-colors overflow-hidden flex items-center px-4 py-2.5 h-12 shadow-sm">
                  <Lock className="w-4 h-4 text-[#737780] mr-2.5 shrink-0" />
                  <input
                    type={showNewPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-type new password"
                    className="w-full bg-transparent border-0 p-0 text-[#1b1b1d] text-xs placeholder:text-slate-400 focus:ring-0 focus:outline-none"
                  />
                </div>
              </div>
            )}

            {/* Submit Button */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={isLoading}
                className="w-full flex justify-center items-center gap-2 py-3.5 px-4 border border-transparent rounded-lg text-white bg-emerald-700 hover:bg-emerald-800 active:scale-[0.99] font-bold text-sm transition-all shadow-md"
              >
                {isLoading ? (
                  'Signing in...'
                ) : newPassword ? (
                  <>Set Password &amp; Enter Dashboard <ArrowRight className="w-4 h-4" /></>
                ) : (
                  <>Instant Sign-In to Dashboard <ArrowRight className="w-4 h-4" /></>
                )}
              </button>
            </div>

            <div className="text-center pt-2">
              <button
                type="button"
                onClick={() => {
                  setMagicToken(null);
                  setMagicUserInfo(null);
                  window.history.replaceState({}, document.title, window.location.pathname);
                }}
                className="text-xs text-slate-500 hover:text-slate-800 underline cursor-pointer"
              >
                Sign in with standard username &amp; password instead
              </button>
            </div>
          </form>
        ) : (
          /* Standard Login Form */
          <form onSubmit={handleLoginSubmit} className="w-full space-y-4">

            {/* Device Mismatch Recovery Prompt (HTTP 403) — Prominent Top Placement */}
            {deviceMismatchError && (
              <div className="bg-rose-50 border-2 border-rose-400 rounded-2xl p-4 text-center shadow-sm animate-in fade-in duration-300">
                <div className="w-10 h-10 bg-rose-100 text-rose-800 rounded-full flex items-center justify-center mx-auto mb-2 border border-rose-300">
                  <Smartphone className="w-5 h-5 animate-pulse" />
                </div>
                <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide bg-rose-200 text-rose-900 mb-1">
                  Device Lockout (L2 Defense)
                </span>
                <p className="text-xs font-bold text-rose-950 mt-1">
                  Your account is registered to another device.
                </p>
                <p className="text-[11px] text-rose-800 mt-1 leading-relaxed">
                  To bind this phone to your account instead, reset your binding with a secure email verification code.
                </p>
                <button
                  type="button"
                  onClick={() => setShowResetModal(true)}
                  className="mt-3 w-full py-3 px-4 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 shadow-md active:scale-98"
                >
                  <Smartphone className="w-4 h-4" /> Reset Device Binding via Email OTP
                </button>
              </div>
            )}

            {/* Account Lockout Countdown Card (HTTP 429) */}
            {lockoutSecondsRemaining !== null && lockoutSecondsRemaining > 0 && (
              <div className="bg-amber-50 border-2 border-amber-400 rounded-2xl p-4 text-center shadow-sm animate-in fade-in duration-300">
                <div className="w-10 h-10 bg-amber-100 text-amber-800 rounded-full flex items-center justify-center mx-auto mb-2 border border-amber-300">
                  <Clock className="w-5 h-5 animate-pulse" />
                </div>
                <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide bg-amber-200 text-amber-900 mb-1">
                  Account Temporarily Locked
                </span>
                <p className="text-sm font-bold text-amber-950 mt-1">
                  Try again in <span className="font-mono text-base font-black text-amber-900 bg-amber-100 px-2 py-0.5 rounded-md border border-amber-300">{formatMMSS(lockoutSecondsRemaining)}</span>
                </p>
                <p className="text-[11px] text-amber-800 mt-2 leading-relaxed">
                  Too many failed attempts. Need urgent access? Contact your faculty or admin to reset your credentials instantly.
                </p>
              </div>
            )}

            {/* Wrong Password Attempts Remaining Banner (HTTP 401) */}
            {attemptsRemaining !== null && (!lockoutSecondsRemaining || lockoutSecondsRemaining <= 0) && attemptsRemaining <= 2 && (
              <div className="bg-rose-50 border border-rose-300 rounded-xl p-3 flex items-center gap-2.5 animate-in fade-in">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <p className="text-xs font-bold text-rose-800 leading-tight">
                  {attemptsRemaining === 1
                    ? '⚠️ Warning: Only 1 attempt remaining before a 30-minute device lockout!'
                    : `⚠️ ${attemptsRemaining} attempts remaining before a 30-minute lockout.`}
                </p>
              </div>
            )}

            {/* Onboarding Activation Required Banner */}
            {onboardingWarning && (
              <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 text-center animate-bounce-in">
                <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide bg-amber-200 text-amber-900 mb-1.5">
                  Onboarding Activation Required
                </span>
                <p className="text-xs text-amber-950 font-semibold leading-tight">
                  Your account has not been activated yet.
                </p>
                <p className="text-[11px] text-amber-700 mt-1.5 leading-snug">
                  Please click the onboarding link sent to your <strong>college email</strong> to set your PIN. Once your PIN is set, return here to sign in.
                </p>
              </div>
            )}

            {/* Email / ID Input */}
            <div className="relative">
              <label className="sr-only" htmlFor="college-id">College Email or ID</label>
              <div className="relative rounded-lg bg-white border border-[#D2D2D7] focus-within:border-[#001e40] transition-colors overflow-hidden flex items-center px-4 py-3 h-14 shadow-sm">
                <Mail className="w-5 h-5 text-[#737780] mr-3 shrink-0" />
                <input
                  id="college-id"
                  name="college-id"
                  type="text"
                  required
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="College Email or Roll Number"
                  className="w-full bg-transparent border-0 p-0 text-[#1b1b1d] text-sm placeholder:text-[#737780] focus:ring-0 focus:outline-none"
                />
              </div>
            </div>

            {/* Password Input */}
            <div className="relative">
              <label className="sr-only" htmlFor="password">Password</label>
              <div className="relative rounded-lg bg-white border border-[#D2D2D7] focus-within:border-[#001e40] transition-colors overflow-hidden flex items-center px-4 py-3 h-14 shadow-sm">
                <Lock className="w-5 h-5 text-[#737780] mr-3 shrink-0" />
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  className="w-full bg-transparent border-0 p-0 text-[#1b1b1d] text-sm placeholder:text-[#737780] focus:ring-0 focus:outline-none pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-[#737780] hover:text-[#1b1b1d] transition-colors focus:outline-none flex items-center justify-center"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {/* Remember Me */}
            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center">
                <input
                  id="remember-me"
                  name="remember-me"
                  type="checkbox"
                  defaultChecked
                  className="h-4 w-4 rounded border-[#D2D2D7] text-[#001e40] focus:ring-[#001e40] bg-white cursor-pointer"
                />
                <label htmlFor="remember-me" className="ml-2 block text-xs font-medium text-[#43474f] cursor-pointer">
                  Remember me
                </label>
              </div>
            </div>

            {/* Submit Button */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={isLoading || (lockoutSecondsRemaining !== null && lockoutSecondsRemaining > 0)}
                className={`w-full flex justify-center items-center gap-2 py-3.5 px-4 border border-transparent rounded-lg text-white font-medium text-sm transition-all shadow-sm ${
                  lockoutSecondsRemaining && lockoutSecondsRemaining > 0
                    ? 'bg-slate-400 cursor-not-allowed opacity-80'
                    : 'bg-[#001e40] hover:bg-[#003366] active:scale-[0.99]'
                }`}
              >
                {isLoading ? (
                  'Signing in...'
                ) : lockoutSecondsRemaining && lockoutSecondsRemaining > 0 ? (
                  <>
                    <Clock className="w-4 h-4 animate-pulse" />
                    <span>Locked ({formatMMSS(lockoutSecondsRemaining)})</span>
                  </>
                ) : (
                  <>
                    <span>Sign In</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>

            {/* Always accessible self-service recovery link */}
            <div className="pt-3 text-center">
              <button
                type="button"
                onClick={() => setShowResetModal(true)}
                className="text-xs text-slate-500 hover:text-[#15347e] font-medium transition inline-flex items-center gap-1.5"
              >
                <Smartphone className="w-3.5 h-3.5 text-slate-400" />
                Lost or replaced phone? Reset device
              </button>
            </div>
          </form>
        )}

      </div>

      {/* iOS Safari Native Toolbar Install Guide */}
      <IosInstallGuideModal
        isOpen={showIosGuide}
        onClose={() => setShowIosGuide(false)}
      />

      {/* Self-Service Device Reset Modal */}
      {showResetModal && (
        <SelfServiceDeviceResetModal
          initialRollNumber={username}
          onClose={() => setShowResetModal(false)}
          onSuccess={(roll) => {
            setShowResetModal(false);
            setDeviceMismatchError(false);
            setUsername(roll);
            setToast({ message: 'Device successfully authorized! You can now sign in.', type: 'success' });
          }}
        />
      )}

    </div>
  );
};
