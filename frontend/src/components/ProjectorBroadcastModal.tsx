import React, { useState, useEffect, useRef } from 'react';
import { 
  X, Maximize2, Minimize2, Lock, RefreshCw, Users, CheckCircle, 
  Clock, ShieldCheck, Sparkles, BookOpen, AlertCircle, Tv, Eye
} from 'lucide-react';
import { apiRequest } from '../services/api';

interface ProjectorBroadcastModalProps {
  sessionId: number;
  initialPeriodCount?: number;
  onClose: () => void;
  onLockSession?: () => void;
}

export const ProjectorBroadcastModal: React.FC<ProjectorBroadcastModalProps> = ({
  sessionId,
  initialPeriodCount = 1,
  onClose,
  onLockSession
}) => {
  const [data, setData] = useState<any>(null);
  const [periodCount, setPeriodCount] = useState<number>(initialPeriodCount);
  const periodCountRef = useRef<number>(initialPeriodCount);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(10);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isLocking, setIsLocking] = useState<boolean>(false);
  const [isFullScreenQrMode, setIsFullScreenQrMode] = useState<boolean>(true);
  const [wakeLockActive, setWakeLockActive] = useState<boolean>(false);
  
  const modalContainerRef = useRef<HTMLDivElement | null>(null);
  const countdownIntervalRef = useRef<any>(null);
  const pollTimerRef = useRef<any>(null);
  const wakeLockSentinelRef = useRef<any>(null);

  const dataRef = useRef<any>(null);

  // Keep ref synchronized with state
  useEffect(() => {
    periodCountRef.current = periodCount;
  }, [periodCount]);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  // W3C Screen Wake Lock API to prevent projector sleep during 30-60 min lecture sessions
  useEffect(() => {
    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator && (navigator as any).wakeLock) {
          wakeLockSentinelRef.current = await (navigator as any).wakeLock.request('screen');
          setWakeLockActive(true);
          wakeLockSentinelRef.current.addEventListener('release', () => {
            setWakeLockActive(false);
          });
        }
      } catch (wlErr) {
        console.warn('Screen Wake Lock request failed or was rejected:', wlErr);
        setWakeLockActive(false);
      }
    };

    requestWakeLock();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        requestWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (wakeLockSentinelRef.current) {
        try {
          wakeLockSentinelRef.current.release();
        } catch {}
        wakeLockSentinelRef.current = null;
      }
    };
  }, []);

  // Fetch rotating token from backend with dynamic period_count
  const fetchBroadcastToken = async (overridePeriod?: number) => {
    const currentP = overridePeriod !== undefined ? overridePeriod : periodCountRef.current;
    try {
      const res: any = await apiRequest(`/teacher/sessions/${sessionId}/broadcast-token?period_count=${currentP}`);
      setData(res);
      setSecondsRemaining(res.seconds_remaining || 10);
      setError(null);
    } catch (err: any) {
      console.error('Failed to fetch broadcast token:', err);
      if (!dataRef.current) {
        setError(err.message || 'Error loading broadcast QR token');
      } else {
        // If already broadcasting, keep active QR code visible and silently retry in 2s
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        pollTimerRef.current = setTimeout(() => {
          fetchBroadcastToken(currentP);
        }, 2000);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBroadcastToken(periodCountRef.current);

    // 1-second countdown ticker for smooth visual bar
    countdownIntervalRef.current = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          // Trigger refresh when token reaches 0 using current selected period count
          fetchBroadcastToken(periodCountRef.current);
          return 10;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [sessionId]);

  // Fullscreen toggle handler
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      if (modalContainerRef.current?.requestFullscreen) {
        modalContainerRef.current.requestFullscreen().catch(() => {});
        setIsFullscreen(true);
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
        setIsFullscreen(false);
      }
    }
  };

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const handleLock = async () => {
    setIsLocking(true);
    try {
      if (onLockSession) {
        await onLockSession();
      } else {
        await apiRequest(`/teacher/sessions/${sessionId}/lock`, { method: 'POST' });
      }
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to lock session');
    } finally {
      setIsLocking(false);
    }
  };

  const progressPercent = Math.max(0, Math.min(100, (secondsRemaining / 10) * 100));

  return (
    <div 
      ref={modalContainerRef}
      className="fixed inset-0 z-50 bg-[#000d1a] text-white flex flex-col justify-between overflow-hidden font-sans select-none"
    >
      {/* FULL SCREEN ATTENDANCE QR MODE: Maximum projector pixel footprint (85-90% viewport height) */}
      {isFullScreenQrMode ? (
        <div className="flex-1 flex flex-col h-full justify-between">
          
          {/* Subtle Top Header bar with controls */}
          <div className="px-6 py-2 bg-black/40 border-b border-white/10 flex items-center justify-between text-xs">
            <div className="flex items-center gap-3">
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono font-bold flex items-center gap-1.5 border border-emerald-500/30">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                PROJECTOR MODE (85% DISPLAY)
              </span>
              <span className="text-slate-300 font-semibold hidden md:inline">
                {data?.subject_name} • {data?.section_name} • {data?.session_date}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {/* Screen Wake Lock Status */}
              <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/5 text-[11px] text-slate-300">
                {wakeLockActive ? (
                  <>
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-300 font-medium">Screen Kept Awake ✓</span>
                  </>
                ) : (
                  <span className="text-amber-300">Display sleep: set to Never</span>
                )}
              </div>

              {/* Toggle to Standard View */}
              <button
                onClick={() => setIsFullScreenQrMode(false)}
                className="px-3 py-1 bg-white/10 hover:bg-white/20 text-white rounded-lg font-bold flex items-center gap-1.5 transition border border-white/15"
                title="Switch to Standard Mode with full dashboards"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Standard Layout</span>
              </button>

              {/* Fullscreen Toggle */}
              <button
                onClick={toggleFullscreen}
                className="p-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg transition border border-white/15"
                title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
              >
                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>

              {/* Lock Session */}
              <button
                onClick={handleLock}
                disabled={isLocking}
                className="px-3 py-1 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-bold rounded-lg flex items-center gap-1.5 transition shadow"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Lock</span>
              </button>

              {/* Close */}
              <button
                onClick={onClose}
                className="p-1.5 bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white rounded-lg transition border border-white/15"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Center Stage: The Massive, Sharp, High-Contrast Projector QR Matrix */}
          <div className="flex-1 flex items-center justify-center p-2 sm:p-4 min-h-0">
            {loading && !data ? (
              <div className="flex flex-col items-center gap-4 text-center">
                <RefreshCw className="w-16 h-16 text-amber-400 animate-spin" />
                <p className="text-xl font-bold text-slate-300">Rendering High-Resolution Projector Token...</p>
              </div>
            ) : error && !data ? (
              <div className="p-6 bg-rose-500/20 border border-rose-500/40 rounded-2xl text-center space-y-3 max-w-md">
                <AlertCircle className="w-12 h-12 text-rose-400 mx-auto" />
                <h3 className="text-lg font-bold text-white">Broadcast Error</h3>
                <p className="text-sm text-rose-200">{error}</p>
                <button
                  onClick={() => { setError(null); setLoading(true); fetchBroadcastToken(); }}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-xs"
                >
                  Retry
                </button>
              </div>
            ) : (
              /* Maximum size square container without rounded corners, shadows, or noise */
              <div className="relative flex items-center justify-center bg-white p-4 sm:p-6" style={{ height: 'min(82vh, 82vw)', width: 'min(82vh, 82vw)' }}>
                {data?.qr_base64 && (
                  <img
                    src={data.qr_base64}
                    alt="Projector Attendance QR"
                    className="w-full h-full object-contain"
                    style={{
                      imageRendering: 'pixelated'
                    }}
                  />
                )}
              </div>
            )}
          </div>

          {/* Slim Bottom Telemetry & Countdown Strip */}
          <div className="px-6 py-2.5 bg-black/60 border-t border-white/10 flex flex-wrap items-center justify-between gap-4 text-xs font-mono">
            {/* Left: Section & Step Info */}
            <div className="flex items-center gap-4">
              <span className="text-slate-400">
                SEC: <strong className="text-white">{data?.section_name || 'Class'}</strong>
              </span>
              <span className="text-slate-400 hidden sm:inline">
                PERIODS: <strong className="text-white">{data?.period_count || 1}</strong>
              </span>
              <span className="text-slate-500 hidden md:inline">
                STEP: {data?.step}
              </span>
            </div>

            {/* Center: Live 10s Token Countdown */}
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5 text-slate-300 font-bold">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                <span>Refreshes in:</span>
              </span>
              <span className={`text-base font-black ${
                secondsRemaining > 4 ? 'text-emerald-400' : secondsRemaining > 2 ? 'text-amber-400' : 'text-rose-400'
              }`}>
                {secondsRemaining}s
              </span>
              <div className="w-24 sm:w-36 h-2 bg-white/10 rounded-full overflow-hidden border border-white/20">
                <div 
                  className={`h-full rounded-full transition-all duration-1000 ease-linear ${
                    secondsRemaining > 4 ? 'bg-emerald-400' : secondsRemaining > 2 ? 'bg-amber-400' : 'bg-rose-500'
                  }`}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>

            {/* Right: Live Attendance Headcount */}
            <div className="flex items-center gap-4 font-sans font-bold">
              <span className="text-slate-300">
                Marked: <span className="text-emerald-400 font-mono text-sm">{data?.total_marked || 0}</span> / {data?.total_enrolled || 0} ({data?.attendance_pct || 0}%)
              </span>
            </div>
          </div>

        </div>
      ) : (
        /* STANDARD DASHBOARD LAYOUT (Toggleable) */
        <div className="flex-1 flex flex-col justify-between p-4 sm:p-6 md:p-8 overflow-y-auto">
          {/* Top Bar: Header & Controls */}
          <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center font-black text-xl text-[#001e40] shadow-lg">
                SN
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-mono font-bold flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                    CLASSROOM PROJECTOR BROADCAST
                  </span>
                </div>
                <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight mt-0.5">
                  {data?.subject_name || 'Classroom Attendance Session'}
                </h1>
                <p className="text-xs sm:text-sm text-slate-300 font-medium">
                  Section: <span className="text-white font-bold">{data?.section_name || 'Class'}</span> • Date: <span className="font-mono text-slate-200">{data?.session_date}</span>
                </p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2 sm:gap-3">
              <button
                onClick={() => setIsFullScreenQrMode(true)}
                className="p-2.5 sm:px-4 sm:py-2.5 bg-amber-500 hover:bg-amber-600 text-[#001e40] rounded-xl text-xs font-black transition flex items-center gap-2 shadow-lg"
                title="Expand QR to 85% full-screen for long-distance hall scanning"
              >
                <Tv className="w-4 h-4" />
                <span>Full-Screen QR (Distance Mode)</span>
              </button>

              <button
                onClick={toggleFullscreen}
                className="p-2.5 sm:px-4 sm:py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold transition flex items-center gap-2 border border-white/15"
                title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen for Projector'}
              >
                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                <span className="hidden sm:inline">{isFullscreen ? 'Exit Fullscreen' : 'Projector Fullscreen'}</span>
              </button>

              <button
                onClick={handleLock}
                disabled={isLocking}
                className="px-4 py-2.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-bold rounded-xl text-xs flex items-center gap-2 shadow-lg transition"
              >
                <Lock className="w-4 h-4" />
                <span>Lock Attendance</span>
              </button>

              <button
                onClick={onClose}
                className="p-2.5 bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white rounded-xl transition border border-white/15"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Center Body: Standard QR View */}
          <div className="flex-1 flex flex-col items-center justify-center py-6">
            {loading && !data ? (
              <div className="flex flex-col items-center gap-4 text-center">
                <RefreshCw className="w-12 h-12 text-amber-400 animate-spin" />
                <p className="text-lg font-bold text-slate-300">Generating Rotating Projector Token...</p>
              </div>
            ) : error && !data ? (
              <div className="max-w-md p-6 bg-rose-500/20 border border-rose-500/40 rounded-2xl text-center space-y-3">
                <AlertCircle className="w-10 h-10 text-rose-400 mx-auto" />
                <h3 className="text-lg font-bold text-white">Broadcast Error</h3>
                <p className="text-sm text-rose-200">{error}</p>
                <button
                  onClick={() => { setError(null); setLoading(true); fetchBroadcastToken(); }}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-xs"
                >
                  Retry
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center max-w-xl w-full">
                <div className="text-center mb-5 space-y-1">
                  <span className="text-amber-400 text-xs sm:text-sm font-bold tracking-wider uppercase flex items-center justify-center gap-1.5">
                    <Sparkles className="w-4 h-4" /> Scan with SNIST Student Portal Camera
                  </span>
                  <p className="text-sm sm:text-base text-slate-300">
                    Hold your phone toward the screen to mark your attendance
                  </p>
                </div>

                <div className="relative p-6 bg-white rounded-2xl shadow-2xl transition-all duration-300">
                  {data?.qr_base64 && (
                    <img
                      src={data.qr_base64}
                      alt="Projector Attendance QR"
                      className="w-72 h-72 sm:w-88 sm:h-88 md:w-96 md:h-96 object-contain"
                      style={{ imageRendering: 'pixelated' }}
                    />
                  )}
                </div>

                {/* Animated 10-Second Countdown Progress Bar */}
                <div className="w-72 sm:w-88 md:w-96 mt-5 space-y-2">
                  <div className="flex items-center justify-between text-xs sm:text-sm font-mono font-bold">
                    <span className="flex items-center gap-1.5 text-slate-300">
                      <Clock className="w-4 h-4 text-amber-400 animate-pulse" />
                      Code Refreshes In:
                    </span>
                    <span className={`text-base font-black ${
                      secondsRemaining > 4 ? 'text-emerald-400' : secondsRemaining > 2 ? 'text-amber-400' : 'text-rose-400'
                    }`}>
                      {secondsRemaining}s
                    </span>
                  </div>

                  <div className="w-full h-3 bg-white/10 rounded-full overflow-hidden p-0.5 border border-white/20">
                    <div 
                      className={`h-full rounded-full transition-all duration-1000 ease-linear ${
                        secondsRemaining > 4 
                          ? 'bg-gradient-to-r from-emerald-500 to-teal-400' 
                          : secondsRemaining > 2 
                            ? 'bg-gradient-to-r from-amber-500 to-orange-500' 
                            : 'bg-gradient-to-r from-rose-500 to-red-600'
                      }`}
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Bottom Ticker: Real-Time Headcount & Attendance Rate */}
          {data && (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 sm:p-5 max-w-4xl mx-auto w-full">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
                <div className="p-2 sm:p-3 rounded-xl bg-white/5 border border-white/10">
                  <span className="text-[11px] sm:text-xs text-slate-400 font-bold uppercase tracking-wider block">
                    Total Enrolled
                  </span>
                  <span className="text-2xl sm:text-3xl font-black text-white font-mono mt-1 block">
                    {data.total_enrolled}
                  </span>
                </div>

                <div className="p-2 sm:p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
                  <span className="text-[11px] sm:text-xs text-emerald-300 font-bold uppercase tracking-wider block">
                    ✅ Present (Marked)
                  </span>
                  <span className="text-2xl sm:text-3xl font-black text-emerald-400 font-mono mt-1 block">
                    {data.total_marked}
                  </span>
                </div>

                <div className="p-2 sm:p-3 rounded-xl bg-rose-500/10 border border-rose-500/30">
                  <span className="text-[11px] sm:text-xs text-rose-300 font-bold uppercase tracking-wider block">
                    ❌ Absent (Unmarked)
                  </span>
                  <span className="text-2xl sm:text-3xl font-black text-rose-400 font-mono mt-1 block">
                    {Math.max(0, data.total_enrolled - data.total_marked)}
                  </span>
                </div>

                <div className="p-2 sm:p-3 rounded-xl bg-amber-500/10 border border-amber-500/30">
                  <span className="text-[11px] sm:text-xs text-amber-300 font-bold uppercase tracking-wider block">
                    Attendance Rate
                  </span>
                  <span className="text-2xl sm:text-3xl font-black text-amber-400 font-mono mt-1 block">
                    {data.attendance_pct}%
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
