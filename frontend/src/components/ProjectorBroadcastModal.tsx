import React, { useState, useEffect, useRef } from 'react';
import { 
  X, Maximize2, Minimize2, Lock, RefreshCw, Users, CheckCircle, 
  Clock, ShieldCheck, Sparkles, BookOpen, AlertCircle
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
  
  const modalContainerRef = useRef<HTMLDivElement | null>(null);
  const countdownIntervalRef = useRef<any>(null);
  const pollTimerRef = useRef<any>(null);

  // Keep ref synchronized with state
  useEffect(() => {
    periodCountRef.current = periodCount;
  }, [periodCount]);

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
      setError(err.message || 'Error loading broadcast QR token');
    } finally {
      setLoading(false);
    }
  };

  const handlePeriodChange = (newCount: number) => {
    setPeriodCount(newCount);
    periodCountRef.current = newCount;
    setLoading(true);
    fetchBroadcastToken(newCount);
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
      className="fixed inset-0 z-50 bg-[#001428] text-white flex flex-col justify-between p-4 sm:p-6 md:p-8 overflow-y-auto font-sans select-none"
    >
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
              {data && (
                <span className="px-2.5 py-0.5 rounded-full bg-white/10 text-amber-300 font-mono font-bold text-xs">
                  {data.period_count} Period{data.period_count > 1 ? 's' : ''}
                </span>
              )}
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight mt-0.5">
              {data?.subject_name || 'Classroom Attendance Session'}
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 font-medium">
              Section: <span className="text-white font-bold">{data?.section_name || 'Class'}</span> • Date: <span className="font-mono text-slate-200">{data?.session_date}</span>
            </p>
          </div>
        </div>

        {/* Top Right Action Buttons */}
        <div className="flex items-center gap-2 sm:gap-3">
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

      {/* Center Body: Massive Chunky QR & Live Countdown Bar */}
      <div className="flex-1 flex flex-col items-center justify-center py-6">
        {loading && !data ? (
          <div className="flex flex-col items-center gap-4 text-center">
            <RefreshCw className="w-12 h-12 text-amber-400 animate-spin" />
            <p className="text-lg font-bold text-slate-300">Generating Rotating Projector Token...</p>
          </div>
        ) : error ? (
          <div className="max-w-md p-6 bg-rose-500/20 border border-rose-500/40 rounded-2xl text-center space-y-3">
            <AlertCircle className="w-10 h-10 text-rose-400 mx-auto" />
            <h3 className="text-lg font-bold text-white">Broadcast Error</h3>
            <p className="text-sm text-rose-200">{error}</p>
            <button
              onClick={() => fetchBroadcastToken()}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-xs"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center max-w-xl w-full">

            {/* Period Credit Selector for Faculty */}
            <div className="flex flex-col items-center gap-1.5 mb-4">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                <span>⏱️</span> Grant Periods (Class Credit):
              </span>
              <div className="flex items-center gap-1.5 p-1.5 bg-white/10 backdrop-blur-md rounded-2xl border border-white/15 shadow-inner">
                {[1, 2, 3, 4, 5, 6].map((p) => (
                  <button
                    key={p}
                    onClick={() => handlePeriodChange(p)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-black font-mono transition-all flex items-center gap-1 ${
                      periodCount === p
                        ? 'bg-gradient-to-r from-amber-400 to-[#FF9F0A] text-[#001e40] shadow-lg scale-105'
                        : 'text-slate-300 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    <span>{p}</span>
                    <span className="font-sans font-bold text-[10px] uppercase">{p === 1 ? 'Period' : 'Periods'}</span>
                  </button>
                ))}
              </div>
            </div>
            
            {/* Student Instructions Banner */}
            <div className="text-center mb-4 space-y-1">
              <span className="text-amber-400 text-xs sm:text-sm font-bold tracking-wider uppercase flex items-center justify-center gap-1.5">
                <Sparkles className="w-4 h-4" /> Scan with SNIST Student Portal Camera
              </span>
              <p className="text-sm sm:text-base text-slate-300">
                Hold your phone toward the screen to be marked present for <span className="text-white font-extrabold">{data?.period_count} Period{data?.period_count > 1 ? 's' : ''}</span>
              </p>
            </div>

            {/* The High-Contrast Chunky QR Code Frame */}
            <div className="relative p-4 sm:p-6 bg-white rounded-3xl shadow-2xl border-4 border-amber-500/80 transition-all duration-300">
              {data?.qr_base64 && (
                <img
                  src={data.qr_base64}
                  alt="Projector Attendance QR"
                  className="w-64 h-64 sm:w-80 sm:h-80 md:w-96 md:h-96 object-contain image-rendering-pixelated"
                />
              )}

              {/* Corner Watermarks */}
              <div className="absolute top-2 left-2 text-[10px] font-mono text-slate-400 font-bold px-1.5 py-0.5 bg-slate-100 rounded">
                SEC: {data?.section_name}
              </div>
              <div className="absolute bottom-2 right-2 text-[10px] font-mono text-slate-400 font-bold px-1.5 py-0.5 bg-slate-100 rounded">
                STEP: {data?.step}
              </div>
            </div>

            {/* Animated 10-Second Countdown Progress Bar */}
            <div className="w-64 sm:w-80 md:w-96 mt-5 space-y-2">
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

              {/* Progress track */}
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

              <div className="flex items-center justify-between text-[11px] text-slate-400 font-medium pt-0.5">
                <span>🛡️ Anti-Proxy 10s Window</span>
                <span>✨ 20s Server Grace Buffer Active</span>
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

          <div className="mt-3 text-center text-xs text-slate-400 font-mono flex items-center justify-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Live count automatically refreshes as students scan the screen</span>
          </div>
        </div>
      )}

    </div>
  );
};
