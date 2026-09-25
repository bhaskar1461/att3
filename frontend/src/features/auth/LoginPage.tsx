import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useLoginMutation } from './hooks';
import { ApiError } from '../../core/api/client';
import { Lock, User, AlertCircle, Loader2 } from 'lucide-react';

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loginMutation = useLoginMutation();

  const searchParams = new URLSearchParams(location.search);
  const nextDestination = searchParams.get('next');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!username.trim() || !password.trim()) {
      setErrorMessage('Please enter both username and password.');
      return;
    }

    try {
      const user = await loginMutation.mutateAsync({
        username: username.trim(),
        password,
      });

      if (nextDestination && nextDestination.startsWith('/')) {
        navigate(nextDestination, { replace: true });
        return;
      }

      const roleLower = user.role.toLowerCase();
      if (roleLower.includes('admin')) {
        navigate('/admin', { replace: true });
      } else if (roleLower.includes('teacher') || roleLower.includes('faculty')) {
        navigate('/teacher', { replace: true });
      } else {
        navigate('/student', { replace: true });
      }
    } catch (err) {
      if (err instanceof ApiError) {
        try {
          const parsed = JSON.parse(err.body);
          setErrorMessage(parsed.detail || parsed.message || `Login failed (HTTP ${err.status})`);
        } catch {
          setErrorMessage(err.body || `Authentication failed (HTTP ${err.status})`);
        }
      } else if (err instanceof Error) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('An unexpected error occurred during login.');
      }
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#141416] text-[#f8fafc] flex flex-col justify-center items-center px-4 font-sans select-none">
      {/* Background radial gradient glow */}
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] from-indigo-500/10 via-transparent to-transparent" />

      <div className="relative w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-600 to-violet-600 shadow-xl shadow-indigo-500/20 mb-4 border border-indigo-400/30">
            <Lock className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">SNIST ERP Portal</h1>
          <p className="text-sm text-[#9ca3af] mt-1">Sign in with institutional SAP ID / Roll Number</p>
        </div>

        {/* Card */}
        <div className="bg-[#1e1f24] border border-[#2a2b31] rounded-2xl p-6 sm:p-8 shadow-2xl shadow-black/40 backdrop-blur-xl">
          {errorMessage && (
            <div className="mb-6 p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{errorMessage}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-semibold text-[#9ca3af] uppercase tracking-wider mb-2">
                Username / Roll Number
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#9ca3af]">
                  <User className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. 23311A0525 or admin"
                  autoComplete="username"
                  disabled={loginMutation.isPending}
                  className="w-full pl-10 pr-4 py-2.5 bg-[#141416] border border-[#2a2b31] rounded-xl text-sm text-white placeholder-[#6b7280] focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#9ca3af] uppercase tracking-wider mb-2">
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#9ca3af]">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  autoComplete="current-password"
                  disabled={loginMutation.isPending}
                  className="w-full pl-10 pr-4 py-2.5 bg-[#141416] border border-[#2a2b31] rounded-xl text-sm text-white placeholder-[#6b7280] focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loginMutation.isPending}
              className="w-full py-2.5 px-4 mt-2 bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] hover:from-[#5558e6] hover:to-[#7c4deb] text-white text-sm font-semibold rounded-xl shadow-lg shadow-indigo-500/25 transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loginMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Signing In...</span>
                </>
              ) : (
                <span>Sign In to Dashboard</span>
              )}
            </button>
          </form>

          {/* Institutional note: no registration link per ledger */}
          <div className="mt-6 pt-5 border-t border-[#2a2b31] text-center">
            <p className="text-xs text-[#9ca3af]">
              First time login? Use the institutional magic link dispatched to your college email.
            </p>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-[#6b7280] mt-6">
          Sreenidhi Institute of Science & Technology · AI Attendance System
        </p>
      </div>
    </div>
  );
};
