import React from 'react';
import { 
  X, Maximize2, Minimize2, Lock, RefreshCw, 
  ShieldCheck, AlertCircle, Eye, Moon, Sun, Smartphone 
} from 'lucide-react';

interface ProjectorPresentationViewProps {
  data: any;
  isDarkRoom: boolean;
  showControls: boolean;
  wakeLockActive: boolean;
  isFullscreen: boolean;
  isLocking: boolean;
  isPhoneDisplay: boolean;
  loading: boolean;
  error: string | null;
  currentQr: string | null;
  incomingQr: string | null;
  isCrossfading: boolean;
  secondsRemaining: number;
  circleRadius: number;
  circumference: number;
  strokeDashoffset: number;
  toggleDarkRoom: () => void;
  setIsFullScreenQrMode: (val: boolean) => void;
  toggleFullscreen: () => void;
  handleLock: () => void;
  onClose: () => void;
  onRetry: () => void;
}

export const ProjectorPresentationView: React.FC<ProjectorPresentationViewProps> = ({
  data,
  isDarkRoom,
  showControls,
  wakeLockActive,
  isFullscreen,
  isLocking,
  isPhoneDisplay,
  loading,
  error,
  currentQr,
  incomingQr,
  isCrossfading,
  secondsRemaining,
  circleRadius,
  circumference,
  strokeDashoffset,
  toggleDarkRoom,
  setIsFullScreenQrMode,
  toggleFullscreen,
  handleLock,
  onClose,
  onRetry,
}) => {
  return (
    <div className="flex-1 relative flex flex-col h-full justify-between">
      {/* Top Header bar with auto-hide slide transition */}
      <div 
        className={`px-6 py-2 bg-black/60 backdrop-blur-md border-b border-white/10 flex items-center justify-between text-xs z-30 transition-all duration-300 ${
          showControls ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center gap-3">
          <span className={`px-2.5 py-0.5 rounded-full font-mono font-bold flex items-center gap-1.5 border ${
            isDarkRoom 
              ? 'bg-purple-500/20 text-purple-300 border-purple-500/30' 
              : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
          }`}>
            <span className={`w-2 h-2 rounded-full animate-ping ${isDarkRoom ? 'bg-purple-400' : 'bg-emerald-400'}`} />
            {isDarkRoom ? 'DARK-ROOM INVERTED (MAX CONTRAST)' : 'EDGE-TO-EDGE PRESENTATION MODE'}
          </span>
          <span className="text-slate-300 font-semibold hidden md:inline">
            {data?.subject_name} • {data?.section_name} • {data?.session_date}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Screen Wake Lock Status / Unsupported Warning */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-white/5 text-[11px] text-slate-300 border border-white/10">
            {wakeLockActive ? (
              <>
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-300 font-medium">Screen Awake ✓</span>
              </>
            ) : (
              <span className="text-amber-300 flex items-center gap-1 font-medium" title="Wake Lock Inactive">
                <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>Keep this window open & screen awake</span>
              </span>
            )}
          </div>

          {/* Dark-Room Mode Toggle (Faculty Preference) */}
          <button
            onClick={(e) => { e.stopPropagation(); toggleDarkRoom(); }}
            className={`px-2.5 py-1 rounded-lg font-bold flex items-center gap-1.5 transition border ${
              isDarkRoom 
                ? 'bg-purple-600/40 text-purple-200 border-purple-400 hover:bg-purple-600/60' 
                : 'bg-white/10 hover:bg-white/20 text-slate-200 border-white/15'
            }`}
            title="Toggle High-Contrast Inverted Mode for dimly lit projector halls"
          >
            {isDarkRoom ? <Sun className="w-3.5 h-3.5 text-amber-300" /> : <Moon className="w-3.5 h-3.5 text-purple-300" />}
            <span>{isDarkRoom ? 'Light Variant' : 'Dark-Room'}</span>
          </button>

          {/* Toggle to Standard View */}
          <button
            onClick={(e) => { e.stopPropagation(); setIsFullScreenQrMode(false); }}
            className="px-3 py-1 bg-white/10 hover:bg-white/20 text-white rounded-lg font-bold flex items-center gap-1.5 transition border border-white/15"
            title="Switch to Standard Mode with detailed metrics"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Standard Layout</span>
          </button>

          {/* Fullscreen Toggle */}
          <button
            onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
            className="p-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg transition border border-white/15"
            title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen (F11)'}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>

          {/* Lock Session */}
          <button
            onClick={(e) => { e.stopPropagation(); handleLock(); }}
            disabled={isLocking}
            className="px-3 py-1 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-bold rounded-lg flex items-center gap-1.5 transition shadow"
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Lock</span>
          </button>

          {/* Close */}
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="p-1.5 bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white rounded-lg transition border border-white/15"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Optional Phone Screen Broadcast Guidance Notice */}
      {isPhoneDisplay && showControls && (
        <div className="bg-amber-500/20 border-b border-amber-500/30 px-4 py-1.5 text-center text-xs text-amber-200 flex items-center justify-center gap-2 font-medium z-20">
          <Smartphone className="w-4 h-4 text-amber-400" />
          <span>📱 Phone-Screen Mode: Hold phone at arm's length (30–50cm) towards students. Set screen brightness to 100%.</span>
        </div>
      )}

      {/* Center Stage: The Massive Edge-to-Edge QR Matrix with Double-Buffered Crossfade */}
      <div className="flex-1 relative flex items-center justify-center p-1 sm:p-2 min-h-0">
        {loading && !currentQr ? (
          <div className="flex flex-col items-center gap-4 text-center">
            <RefreshCw className="w-16 h-16 text-amber-400 animate-spin" />
            <p className="text-xl font-bold text-slate-300">Rendering Crisp Optical QR Matrix...</p>
          </div>
        ) : error && !currentQr ? (
          <div className="p-6 bg-rose-500/20 border border-rose-500/40 rounded-2xl text-center space-y-3 max-w-md">
            <AlertCircle className="w-12 h-12 text-rose-400 mx-auto" />
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
          /* High-Contrast Container with Guaranteed 4-Module Quiet Zone and Zero Rounding */
          <div 
            className={`relative flex items-center justify-center transition-colors duration-300 ${
              isDarkRoom ? 'bg-black border border-white/20' : 'bg-white shadow-2xl'
            }`}
            style={{ 
              height: showControls ? 'min(82vh, 82vw)' : 'min(93vh, 93vw)', 
              width: showControls ? 'min(82vh, 82vw)' : 'min(93vh, 93vw)',
              padding: '3%' // Preserves >=4 module quiet zone buffer
            }}
          >
            {/* Double-Buffered Layer: Current Base QR */}
            {currentQr && (
              <img
                src={currentQr}
                alt="Attendance QR Matrix"
                className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-300 ${
                  isCrossfading ? 'opacity-0' : 'opacity-100'
                }`}
                style={{
                  imageRendering: 'pixelated',
                  padding: '3%'
                }}
              />
            )}

            {/* Double-Buffered Layer: Incoming Preloaded QR for 300ms Crossfade */}
            {incomingQr && (
              <img
                src={incomingQr}
                alt="Incoming Attendance QR Matrix"
                className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-300 ${
                  isCrossfading ? 'opacity-100' : 'opacity-0'
                }`}
                style={{
                  imageRendering: 'pixelated',
                  padding: '3%'
                }}
              />
            )}

            {/* Subtle Floating Controls Trigger when chrome is hidden */}
            {!showControls && (
              <div className="absolute top-2 right-2 px-2 py-1 rounded bg-black/50 text-[10px] text-slate-400 pointer-events-none backdrop-blur font-mono">
                Tap to show controls
              </div>
            )}
          </div>
        )}
      </div>

      {/* Slim Bottom Telemetry & Countdown Strip with Auto-Hide */}
      <div 
        className={`px-6 py-2 bg-black/70 backdrop-blur-md border-t border-white/10 flex flex-wrap items-center justify-between gap-4 text-xs font-mono z-30 transition-all duration-300 ${
          showControls ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0 pointer-events-none'
        }`}
      >
        {/* Left: Section & Step Info */}
        <div className="flex items-center gap-4">
          <span className="text-slate-400">
            SEC: <strong className="text-white">{data?.section_name || 'Class'}</strong>
          </span>
          <span className="text-slate-400 hidden sm:inline">
            PERIODS: <strong className="text-white">{data?.period_count || 1}</strong>
          </span>
          <span className="text-slate-500 hidden md:inline">
            RENDER: <strong className="text-amber-300 uppercase">{data?.render_version || 'V2'}</strong> (ECC L)
          </span>
        </div>

        {/* Center: High-Visibility Countdown Ring & Digital Ticker */}
        <div className="flex items-center gap-3">
          {/* Circular SVG Ring Countdown */}
          <div className="relative w-7 h-7 flex items-center justify-center">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
              <circle
                cx="50"
                cy="50"
                r={circleRadius}
                className="stroke-white/20"
                strokeWidth="10"
                fill="transparent"
              />
              <circle
                cx="50"
                cy="50"
                r={circleRadius}
                className={`transition-all duration-1000 ease-linear ${
                  secondsRemaining > 4 
                    ? 'stroke-emerald-400' 
                    : secondsRemaining > 2 
                      ? 'stroke-amber-400' 
                      : 'stroke-rose-400'
                }`}
                strokeWidth="10"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                fill="transparent"
              />
            </svg>
            <span className="absolute text-[10px] font-black font-mono">
              {secondsRemaining}
            </span>
          </div>

          <span className="text-slate-300 font-bold hidden sm:inline">
            Rotates in:
          </span>
          <span className={`text-base font-black ${
            secondsRemaining > 4 ? 'text-emerald-400' : secondsRemaining > 2 ? 'text-amber-400' : 'text-rose-400'
          }`}>
            {secondsRemaining}s
          </span>
        </div>

        {/* Right: Live Attendance Headcount */}
        <div className="flex items-center gap-4 font-sans font-bold">
          <span className="text-slate-300">
            Marked: <span className="text-emerald-400 font-mono text-sm">{data?.total_marked || 0}</span> / {data?.total_enrolled || 0} ({data?.attendance_pct || 0}%)
          </span>
        </div>
      </div>
    </div>
  );
};
