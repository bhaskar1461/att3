import React from 'react';
import { 
  X, Maximize2, Minimize2, Lock, RefreshCw, 
  Clock, Sparkles, AlertCircle, Tv, Moon, Sun 
} from 'lucide-react';

interface ProjectorStandardViewProps {
  data: any;
  isDarkRoom: boolean;
  isFullscreen: boolean;
  isLocking: boolean;
  loading: boolean;
  error: string | null;
  currentQr: string | null;
  secondsRemaining: number;
  progressPercent: number;
  setIsFullScreenQrMode: (val: boolean) => void;
  toggleDarkRoom: () => void;
  toggleFullscreen: () => void;
  handleLock: () => void;
  onClose: () => void;
  onRetry: () => void;
}

export const ProjectorStandardView: React.FC<ProjectorStandardViewProps> = ({
  data,
  isDarkRoom,
  isFullscreen,
  isLocking,
  loading,
  error,
  currentQr,
  secondsRemaining,
  progressPercent,
  setIsFullScreenQrMode,
  toggleDarkRoom,
  toggleFullscreen,
  handleLock,
  onClose,
  onRetry,
}) => {
  return (
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
                STANDARD BROADCAST VIEW
              </span>
              <span className="px-2 py-0.5 rounded bg-white/10 text-slate-300 text-xs font-mono">
                ECC L • QUIET ZONE ≥4
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
            title="Expand QR to edge-to-edge presentation mode for long-distance hall scanning"
          >
            <Tv className="w-4 h-4" />
            <span>Presentation Mode</span>
          </button>

          <button
            onClick={toggleDarkRoom}
            className={`p-2.5 sm:px-3 sm:py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 border ${
              isDarkRoom 
                ? 'bg-purple-600/40 text-purple-200 border-purple-400' 
                : 'bg-white/10 hover:bg-white/20 text-white border-white/15'
            }`}
            title="Toggle Dark-Room High Contrast Inverted QR"
          >
            {isDarkRoom ? <Sun className="w-4 h-4 text-amber-300" /> : <Moon className="w-4 h-4 text-purple-300" />}
            <span className="hidden sm:inline">{isDarkRoom ? 'Light Variant' : 'Dark Variant'}</span>
          </button>

          <button
            onClick={toggleFullscreen}
            className="p-2.5 sm:px-4 sm:py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold transition flex items-center gap-2 border border-white/15"
            title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen for Projector'}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            <span className="hidden sm:inline">{isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}</span>
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
        {loading && !currentQr ? (
          <div className="flex flex-col items-center gap-4 text-center">
            <RefreshCw className="w-12 h-12 text-amber-400 animate-spin" />
            <p className="text-lg font-bold text-slate-300">Generating Rotating Projector Token...</p>
          </div>
        ) : error && !currentQr ? (
          <div className="max-w-md p-6 bg-rose-500/20 border border-rose-500/40 rounded-2xl text-center space-y-3">
            <AlertCircle className="w-10 h-10 text-rose-400 mx-auto" />
            <h3 className="text-lg font-bold text-white">Broadcast Error</h3>
            <p className="text-sm text-rose-200">{error}</p>
            <button
              onClick={onRetry}
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

            <div className={`relative p-6 rounded-2xl shadow-2xl transition-all duration-300 ${
              isDarkRoom ? 'bg-black border border-white/20' : 'bg-white'
            }`}>
              {currentQr && (
                <img
                  src={currentQr}
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
  );
};
