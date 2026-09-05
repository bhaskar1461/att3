import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { ArrowRight, Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { Toast } from '../components/Toast';
import { getOrCreateDeviceCredentials, getDeviceHeaders } from '../services/deviceCredential';

export const Login: React.FC = () => {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Magic link state (for faculty/students logging in via magic link)
  const [magicToken, setMagicToken] = useState<string | null>(null);
  const [magicUserInfo, setMagicUserInfo] = useState<{ username: string; full_name: string; role: string } | null>(null);
  const [isVerifyingMagic, setIsVerifyingMagic] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
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
      });

      if (data.password_updated) {
        setToast({ message: "Password set successfully! Entering portal...", type: 'success' });
      }

      setTimeout(() => {
        if (data.role === 'SUPER_ADMIN') window.location.href = '/admin';
        else if (data.role === 'TEACHER') window.location.href = '/teacher';
        else window.location.href = '/student';
      }, 400);

    } catch (err: any) {
      setToast({ message: err.message || 'Login failed', type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const deviceCreds = getOrCreateDeviceCredentials();
      const deviceHeaders = getDeviceHeaders();

      const formData = new URLSearchParams();
      formData.append('username', username);
      formData.append('password', password);
      formData.append('device_public_id', deviceCreds.device_public_id);
      formData.append('device_secret', deviceCreds.device_secret);

      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/x-www-form-urlencoded',
          ...deviceHeaders
        },
        body: formData,
      });

      const text = await res.text();

      if (!res.ok) {
        let msg = 'Invalid credentials. Please check your username & password.';
        try {
          const errData = JSON.parse(text);
          if (errData.detail) msg = typeof errData.detail === 'string' ? errData.detail : msg;
        } catch {}
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
      });

      if (response.role === 'SUPER_ADMIN') window.location.href = '/admin';
      else if (response.role === 'TEACHER') window.location.href = '/teacher';
      else window.location.href = '/student';

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
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
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
                disabled={isLoading}
                className="w-full flex justify-center items-center gap-2 py-3.5 px-4 border border-transparent rounded-lg text-white bg-[#001e40] hover:bg-[#003366] active:scale-[0.99] font-medium text-sm transition-all shadow-sm"
              >
                {isLoading ? 'Signing in...' : 'Sign In'} <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </form>
        )}


      </div>

    </div>
  );
};
