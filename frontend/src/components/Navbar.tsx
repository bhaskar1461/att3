import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { QrCode, LogOut, Wifi, WifiOff, RefreshCw, BarChart2, Users, FileText, CheckSquare } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { getOfflineQueue, syncOfflineScans } from '../services/offlineSync';

export const Navbar: React.FC = () => {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(getOfflineQueue().length);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      handleSync();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const interval = setInterval(() => {
      setPendingCount(getOfflineQueue().length);
    }, 3000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, []);

  const handleSync = async () => {
    if (!isOnline || isSyncing) return;
    setIsSyncing(true);
    await syncOfflineScans();
    setPendingCount(getOfflineQueue().length);
    setIsSyncing(false);
  };

  const getRoleBadge = (role?: string) => {
    if (role === 'SUPER_ADMIN') return 'Super Admin';
    if (role === 'TEACHER') return 'Faculty Member';
    return 'Student';
  };

  // Standalone routes with their own navigation shell (/qr projector display and Phase 1+ Dashboard shell)
  if (
    location.pathname === '/qr' || 
    location.pathname.startsWith('/dashboard') || 
    location.pathname === '/admin' ||
    location.pathname.startsWith('/overview') ||
    location.pathname.startsWith('/roster') ||
    location.pathname.startsWith('/sessions')
  ) {
    return null;
  }

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/80 shadow-sm">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-16 sm:h-20 flex items-center justify-between gap-2">
        
        {/* SNIST Logo & Brand Header */}
        <Link to="/" className="flex items-center gap-2 sm:gap-3.5 group min-w-0">
          <div className="bg-white p-1 rounded-xl border border-slate-200 shadow-sm group-hover:scale-105 transition-transform shrink-0">
            <picture>
              <source srcSet="/snist_logo.webp" type="image/webp" />
              <img 
                src="/snist_logo.jpg" 
                alt="SNIST logo" 
                className="h-8 sm:h-11 w-auto object-contain rounded-lg"
                loading="lazy"
                decoding="async"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            </picture>
          </div>
          <div className="min-w-0">
            <h1 className="font-heading font-bold text-xs sm:text-base lg:text-xl text-[#15347e] leading-tight tracking-tight truncate">
              Attendance System
            </h1>
            <span className="text-[10px] sm:text-xs text-[#2f53d7] font-semibold block truncate">
              Sreenidhi Institute
            </span>
          </div>
        </Link>

        {/* Center Navigation Links */}
        {user && (
          <nav className="hidden lg:flex items-center gap-1.5 bg-slate-100/80 p-1.5 rounded-2xl border border-slate-200">
            {user.role === 'SUPER_ADMIN' && (
              <>
                <Link 
                  to="/admin" 
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                    location.pathname === '/admin' 
                      ? 'bg-white text-[#15347e] shadow-sm font-extrabold' 
                      : 'text-slate-600 hover:text-[#15347e] hover:bg-white/60'
                  }`}
                >
                  <BarChart2 className="w-4 h-4 text-[#2f53d7]" /> Dashboard
                </Link>
                <Link 
                  to="/admin/management" 
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                    location.pathname === '/admin/management' 
                      ? 'bg-white text-[#15347e] shadow-sm font-extrabold' 
                      : 'text-slate-600 hover:text-[#15347e] hover:bg-white/60'
                  }`}
                >
                  <Users className="w-4 h-4 text-[#2f53d7]" /> System Setup
                </Link>
                <Link 
                  to="/reports" 
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                    location.pathname === '/reports' 
                      ? 'bg-white text-[#15347e] shadow-sm font-extrabold' 
                      : 'text-slate-600 hover:text-[#15347e] hover:bg-white/60'
                  }`}
                >
                  <FileText className="w-4 h-4 text-[#2f53d7]" /> Reports
                </Link>
              </>
            )}

            {user.role === 'TEACHER' && (
              <>
                <Link 
                  to="/teacher" 
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                    location.pathname === '/teacher' 
                      ? 'bg-white text-[#15347e] shadow-sm font-extrabold' 
                      : 'text-slate-600 hover:text-[#15347e] hover:bg-white/60'
                  }`}
                >
                  <CheckSquare className="w-4 h-4 text-[#2f53d7]" /> My Classes & Scanner
                </Link>
                <Link 
                  to="/reports" 
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                    location.pathname === '/reports' 
                      ? 'bg-white text-[#15347e] shadow-sm font-extrabold' 
                      : 'text-slate-600 hover:text-[#15347e] hover:bg-white/60'
                  }`}
                >
                  <FileText className="w-4 h-4 text-[#2f53d7]" /> Reports
                </Link>
              </>
            )}

            {user.role === 'STUDENT' && (
              <Link 
                to="/student" 
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                  location.pathname === '/student' 
                    ? 'bg-white text-[#15347e] shadow-sm font-extrabold' 
                    : 'text-slate-600 hover:text-[#15347e] hover:bg-white/60'
                }`}
              >
                <QrCode className="w-4 h-4 text-[#2f53d7]" /> My Student QR
              </Link>
            )}
          </nav>
        )}

        {/* Right User Profile Pill & Actions */}
        <div className="flex items-center gap-2 shrink-0">
          
          {/* Online/Offline Status Pill */}
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 border border-slate-200 text-xs font-semibold">
            {isOnline ? (
              <span className="flex items-center gap-1.5 text-emerald-600">
                <Wifi className="w-3.5 h-3.5" /> Online
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-rose-600">
                <WifiOff className="w-3.5 h-3.5" /> Offline
              </span>
            )}

            {pendingCount > 0 && (
              <button 
                onClick={handleSync} 
                disabled={!isOnline || isSyncing}
                className="ml-1 pl-2 border-l border-slate-300 text-amber-600 flex items-center gap-1 hover:text-amber-700"
              >
                <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
                {pendingCount} queued
              </button>
            )}
          </div>

          {user ? (
            <div className="flex items-center gap-2">
              <div className="profile-pill flex items-center">
                <div className="profile-avatar shrink-0">
                  {user.full_name ? user.full_name[0].toUpperCase() : 'U'}
                </div>
                <div className="text-left leading-tight hidden sm:block">
                  <strong className="block text-xs font-bold text-[#17233c] max-w-[110px] truncate">{user.full_name}</strong>
                  <span className="text-[10px] text-[#6a7894] font-semibold block">{getRoleBadge(user.role)}</span>
                </div>
              </div>

              <button
                onClick={logout}
                title="Logout"
                className="p-2 sm:p-2.5 rounded-xl bg-slate-100 hover:bg-rose-50 border border-slate-200 text-slate-600 hover:text-rose-600 transition-colors shrink-0"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
};
