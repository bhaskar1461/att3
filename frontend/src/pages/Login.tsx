import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Shield, UserCheck, GraduationCap, ArrowRight, Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { Toast } from '../components/Toast';

export const Login: React.FC = () => {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
          <img 
            src="/snist_logo.jpg" 
            alt="SNIST ERP Logo" 
            className="w-12 h-12 object-contain rounded-lg"
          />
        </div>

        {/* Headline */}
        <h2 className="text-3xl font-bold text-[#1b1b1d] mb-2 text-center tracking-tight font-geist">
          Welcome back.
        </h2>
        <p className="text-xs text-[#5e5e63] mb-8 text-center font-medium">
          SNIST Academic Attendance Portal
        </p>

        {/* Login Form */}
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

        {/* Demo Roles Section */}
        <div className="w-full pt-8 mt-6 border-t border-[#D2D2D7]">
          <p className="text-[11px] font-bold text-[#5e5e63] uppercase tracking-wider mb-3 text-center">
            Quick Roles Demo Fill
          </p>

          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => handleDemoFill('admin', 'admin123')}
              className="p-2.5 rounded-xl bg-white hover:bg-[#F5F5F7] border border-[#D2D2D7] shadow-sm text-center transition-all hover:-translate-y-0.5 group"
            >
              <Shield className="w-4 h-4 text-[#E22126] mx-auto mb-1 group-hover:scale-110 transition-transform" />
              <span className="block text-xs font-bold text-[#1b1b1d]">Admin</span>
            </button>

            <button
              onClick={() => handleDemoFill('teacher1', 'teacher123')}
              className="p-2.5 rounded-xl bg-white hover:bg-[#F5F5F7] border border-[#D2D2D7] shadow-sm text-center transition-all hover:-translate-y-0.5 group"
            >
              <UserCheck className="w-4 h-4 text-[#001e40] mx-auto mb-1 group-hover:scale-110 transition-transform" />
              <span className="block text-xs font-bold text-[#1b1b1d]">Teacher</span>
            </button>

            <button
              onClick={() => handleDemoFill('21311A0501', '21311A0501')}
              className="p-2.5 rounded-xl bg-white hover:bg-[#F5F5F7] border border-[#D2D2D7] shadow-sm text-center transition-all hover:-translate-y-0.5 group"
            >
              <GraduationCap className="w-4 h-4 text-[#24A249] mx-auto mb-1 group-hover:scale-110 transition-transform" />
              <span className="block text-xs font-bold text-[#1b1b1d]">Student</span>
            </button>
          </div>
        </div>

      </div>

    </div>
  );
};
