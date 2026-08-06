import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Shield, UserCheck, GraduationCap, ArrowRight, Lock, KeyRound } from 'lucide-react';
import { Toast } from '../components/Toast';

export const Login: React.FC = () => {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const formData = new URLSearchParams();
      formData.append('username', username);
      formData.append('password', password);

      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/x-www-form-urlencoded'
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

  const handleDemoFill = (u: string, p: string) => {
    setUsername(u);
    setPassword(p);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f7f9fe] to-[#ecf1fb] flex items-center justify-center p-4 sm:p-6">
      
      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}

      {/* SNIST Helpdesk Shell Container */}
      <div className="w-full max-w-4xl bg-white rounded-3xl border border-white/80 shadow-[0_24px_60px_rgba(27,44,94,0.12)] overflow-hidden flex flex-col">
        
        {/* Header Block with SNIST Logo */}
        <header className="p-6 sm:p-8 bg-gradient-to-b from-[#f1f6ff] to-white border-b border-[#15347e]/10 flex flex-col sm:flex-row items-center sm:items-center justify-between gap-6">
          <div className="flex items-center gap-5">
            <div className="bg-white p-2 rounded-2xl border border-slate-200 shadow-sm shrink-0">
              <img 
                src="/snist_logo.jpg" 
                alt="SNIST logo" 
                className="h-16 w-auto object-contain rounded-lg"
              />
            </div>
            <div>
              <h1 className="font-heading text-2xl sm:text-3xl font-extrabold text-[#15347e] tracking-tight leading-tight">
                Welcome To Attendance Management !!
              </h1>
              <p className="text-sm font-medium text-[#6a7894] mt-0.5">
                Sreenidhi Institute of Science and Technology
              </p>
            </div>
          </div>

          <span className="px-3.5 py-1.5 bg-[#2f53d7]/10 text-[#2f53d7] border border-[#2f53d7]/20 rounded-full text-xs font-extrabold tracking-wider uppercase shrink-0">
            PWA Portal
          </span>
        </header>

        {/* Login Stage Body */}
        <div className="p-6 sm:p-10 flex flex-col items-center justify-center bg-gradient-to-b from-white to-[#fbfcff]">
          
          <div className="w-full max-w-md space-y-6">
            
            <div className="text-center space-y-1">
              <h2 className="font-heading text-2xl font-bold text-[#17233c]">Sign In</h2>
              <p className="text-xs font-medium text-[#6a7894]">Access your attendance management portal account.</p>
            </div>

            {/* Login Form */}
            <form onSubmit={handleLoginSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#17233c] uppercase tracking-wider mb-1.5">
                  Username / Roll Number
                </label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. admin, teacher1, 21311A0501"
                  className="snist-input w-full"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#17233c] uppercase tracking-wider mb-1.5">
                  Password
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="snist-input w-full"
                />
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3.5 px-4 snist-btn-primary font-bold text-sm flex items-center justify-center gap-2 mt-2"
              >
                {isLoading ? 'Signing in...' : 'Sign In'} <ArrowRight className="w-4 h-4" />
              </button>
            </form>

            {/* Demo Shortcuts */}
            <div className="pt-6 border-t border-slate-200">
              <p className="text-[11px] font-bold text-[#6a7894] uppercase tracking-wider mb-3 text-center">
                Quick Demo Shortcuts
              </p>

              <div className="grid grid-cols-3 gap-2.5">
                <button
                  onClick={() => handleDemoFill('admin', 'admin123')}
                  className="p-3 rounded-2xl bg-white hover:bg-slate-50 border border-slate-200 shadow-sm text-center transition-all hover:-translate-y-0.5 group"
                >
                  <Shield className="w-5 h-5 text-rose-600 mx-auto mb-1 group-hover:scale-110 transition-transform" />
                  <span className="block text-xs font-bold text-[#17233c]">Admin</span>
                  <span className="block text-[10px] text-slate-500 mt-0.5">admin / admin123</span>
                </button>

                <button
                  onClick={() => handleDemoFill('teacher1', 'teacher123')}
                  className="p-3 rounded-2xl bg-white hover:bg-slate-50 border border-slate-200 shadow-sm text-center transition-all hover:-translate-y-0.5 group"
                >
                  <UserCheck className="w-5 h-5 text-[#2f53d7] mx-auto mb-1 group-hover:scale-110 transition-transform" />
                  <span className="block text-xs font-bold text-[#17233c]">Teacher</span>
                  <span className="block text-[10px] text-slate-500 mt-0.5">teacher1 / teacher123</span>
                </button>

                <button
                  onClick={() => handleDemoFill('21311A0501', '21311A0501')}
                  className="p-3 rounded-2xl bg-white hover:bg-slate-50 border border-slate-200 shadow-sm text-center transition-all hover:-translate-y-0.5 group"
                >
                  <GraduationCap className="w-5 h-5 text-emerald-600 mx-auto mb-1 group-hover:scale-110 transition-transform" />
                  <span className="block text-xs font-bold text-[#17233c]">Student</span>
                  <span className="block text-[10px] text-slate-500 mt-0.5">21311A0501</span>
                </button>
              </div>
            </div>

          </div>

        </div>

      </div>

    </div>
  );
};
