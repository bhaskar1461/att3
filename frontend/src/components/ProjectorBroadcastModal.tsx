import React, { useState, useEffect, useRef } from 'react';
import { 
  X, Maximize2, Minimize2, Lock, RefreshCw, Users, CheckCircle, 
  Clock, ShieldCheck, Sparkles, BookOpen, AlertCircle, Tv, Eye,
  Moon, Sun, Smartphone
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
  const [isStale, setIsStale] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isLocking, setIsLocking] = useState<boolean>(false);
  const [isFullScreenQrMode, setIsFullScreenQrMode] = useState<boolean>(true);
  const [wakeLockActive, setWakeLockActive] = useState<boolean>(false);
  const [wakeLockSupported, setWakeLockSupported] = useState<boolean>(true);

  // Phase 7 Stage 2: Display Hardening & Watchdog States
  const [isSessionEnded, setIsSessionEnded] = useState<boolean>(false);
  const isSessionEndedRef = useRef<boolean>(false);
  const [showResyncedToast, setShowResyncedToast] = useState<boolean>(false);
  const renderedEpochRef = useRef<number | null>(null);
  const lagStartTimeRef = useRef<number | null>(null);
  const refreshIntervalSecRef = useRef<number>(10);

  // Server-authoritative timing refs (Never trust client laptop clock)
  const serverOffsetRef = useRef<number>(0);
  const expiresAtRef = useRef<number>(0);
  const isFetchingRef = useRef<boolean>(false);
  const failCountRef = useRef<number>(0);

  // Week 5: Dark-room inverted variant & Double-buffering state
  const [isDarkRoom, setIsDarkRoom] = useState<boolean>(() => {
    try {
      return localStorage.getItem('snist_qr_dark_room') === 'true';
    } catch {
      return false;
    }
  });

  // Double-buffering image state for seamless zero-blank-frame crossfade
  const [currentQr, setCurrentQr] = useState<string | null>(null);
  const [incomingQr, setIncomingQr] = useState<string | null>(null);
  const [isCrossfading, setIsCrossfading] = useState<boolean>(false);
  const currentQrRef = useRef<string | null>(null);

  // Auto-hiding chrome controls for distraction-free presentation mode
  const [showControls, setShowControls] = useState<boolean>(true);
  const hideControlsTimerRef = useRef<any>(null);
  
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

  useEffect(() => {
    isSessionEndedRef.current = isSessionEnded;
  }, [isSessionEnded]);

  // Handle auto-hiding chrome when in fullscreen presentation mode
  const handleUserActivity = () => {
    setShowControls(true);
    if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
    if (isFullScreenQrMode) {
      hideControlsTimerRef.current = setTimeout(() => {
        setShowControls(false);
      }, 3500);
    }
  };

  useEffect(() => {
    handleUserActivity();
    return () => {
      if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
    };
  }, [isFullScreenQrMode]);

  // W3C Screen Wake Lock API to prevent projector sleep during 30-60 min lecture sessions
  useEffect(() => {
    if (!('wakeLock' in navigator)) {
      setWakeLockSupported(false);
      return;
    }

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

  // Fetch rotating token from backend (Server-driven rotation)
  const fetchBroadcastToken = async (overridePeriod?: number, overrideDarkMode?: boolean, force?: boolean) => {
    if (isSessionEndedRef.current) return;
    if (isFetchingRef.current && !force) return;
    isFetchingRef.current = true;
    const currentP = overridePeriod !== undefined ? overridePeriod : periodCountRef.current;
    const currentDark = overrideDarkMode !== undefined ? overrideDarkMode : isDarkRoom;
    try {
      const clientReqTime = Date.now();
      const res: any = await apiRequest(
        `/teacher/sessions/${sessionId}/broadcast-token?period_count=${currentP}&dark_mode=${currentDark}&_t=${clientReqTime}`,
        {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'Pragma': 'no-cache'
          }
        }
      );

      // 5. SESSION ENDED Check: Stop immediately if session has ended or locked
      if (res?.is_ended || res?.session_status === 'LOCKED') {
        console.warn('[Projector] Session is locked or ended. Stopping broadcast.');
        setIsSessionEnded(true);
        isSessionEndedRef.current = true;
        setCurrentQr(null);
        setIncomingQr(null);
        currentQrRef.current = null;
        if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        return;
      }

      // Server time drift correction: compute server clock offset
      const clientResTime = Date.now();
      const serverNowSec = res.server_now ?? res.serverNow;
      if (serverNowSec !== undefined) {
        const roundTripMs = clientResTime - clientReqTime;
        const estimatedServerNowMs = (serverNowSec * 1000) + (roundTripMs / 2);
        serverOffsetRef.current = estimatedServerNowMs - clientResTime;
      }

      const expSec = res.expires_at ?? res.expiresAt;
      if (expSec !== undefined) {
        expiresAtRef.current = expSec * 1000;
      } else {
        expiresAtRef.current = (Date.now() + serverOffsetRef.current) + 10000;
      }

      // Record rendered epoch and refresh interval from server
      if (res?.step !== undefined) {
        renderedEpochRef.current = Number(res.step);
      }
      if (res?.refresh_interval) {
        refreshIntervalSecRef.current = Number(res.refresh_interval);
      }

      setData(res);
      const estServerTime = Date.now() + serverOffsetRef.current;
      const secLeft = Math.max(0, Math.ceil((expiresAtRef.current - estServerTime) / 1000));
      setSecondsRemaining(secLeft);
      setError(null);
      setIsStale(false);
      failCountRef.current = 0;

      // Double-buffering transition: Preload before swapping into DOM
      if (res?.qr_base64) {
        if (!currentQrRef.current) {
          setCurrentQr(res.qr_base64);
          currentQrRef.current = res.qr_base64;
        } else if (res.qr_base64 !== currentQrRef.current) {
          const img = new Image();
          img.src = res.qr_base64;
          img.onload = () => {
            setIncomingQr(res.qr_base64);
            setIsCrossfading(true);
            setTimeout(() => {
              setCurrentQr(res.qr_base64);
              currentQrRef.current = res.qr_base64;
              setIncomingQr(null);
              setIsCrossfading(false);
            }, 300); // 300ms smooth crossfade
          };
        }
      }

      // 6. Display Heartbeat Beacon: send every rotation
      try {
        const beaconPayload = JSON.stringify({
          session_id: sessionId,
          epoch: res.step ?? 0,
          ts: Date.now() / 1000
        });
        if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
          const blob = new Blob([beaconPayload], { type: 'application/json' });
          navigator.sendBeacon('/api/v1/qr-display-heartbeat', blob);
        } else {
          fetch('/api/v1/qr-display-heartbeat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: beaconPayload,
            keepalive: true
          }).catch(() => {});
        }
      } catch (hbErr) {
        console.debug('[Projector] Heartbeat beacon suppressed:', hbErr);
      }
    } catch (err: any) {
      console.error('Failed to fetch broadcast token:', err);

      // Check if server indicated session ended/locked
      const errStr = String(err?.message || err?.detail?.message || err?.detail || '').toLowerCase();
      const isEnded = errStr.includes('locked') || errStr.includes('ended') || err?.code === 'session_ended' || err?.detail?.code === 'session_ended';
      if (isEnded) {
        console.warn('[Projector] Received locked session error from server. Displaying SESSION ENDED overlay.');
        setIsSessionEnded(true);
        isSessionEndedRef.current = true;
        setCurrentQr(null);
        setIncomingQr(null);
        currentQrRef.current = null;
        if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        return;
      }

      failCountRef.current += 1;
      const estServerTime = Date.now() + serverOffsetRef.current;
      const isPastExpiry = expiresAtRef.current > 0 && estServerTime >= expiresAtRef.current;

      if (!dataRef.current) {
        setError(err.message || 'Error loading broadcast QR token');
      } else {
        if (isPastExpiry || failCountRef.current >= 2) {
          setIsStale(true);
        }
        // Exponential backoff retry: 1.5s, 2.25s, 3.3s, up to 6s
        const backoff = Math.min(6000, Math.round(1500 * Math.pow(1.5, failCountRef.current - 1)));
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        pollTimerRef.current = setTimeout(() => {
          fetchBroadcastToken(currentP, currentDark);
        }, backoff);
      }
    } finally {
      isFetchingRef.current = false;
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBroadcastToken(periodCountRef.current, isDarkRoom);

    // High frequency drift-free server countdown ticker (runs every 250ms)
    countdownIntervalRef.current = setInterval(() => {
      if (isSessionEndedRef.current) return;
      if (!expiresAtRef.current) return;
      const currentServerNow = Date.now() + serverOffsetRef.current;
      const secRemaining = Math.max(0, Math.ceil((expiresAtRef.current - currentServerNow) / 1000));
      setSecondsRemaining(secRemaining);

      // 3. Rotation WATCHDOG: Detect if rendered epoch lags server epoch
      const stepWindow = refreshIntervalSecRef.current || 10;
      const expectedServerEpoch = Math.floor((currentServerNow / 1000) / stepWindow);
      const renderedEpoch = renderedEpochRef.current;

      if (renderedEpoch !== null && expectedServerEpoch > renderedEpoch) {
        const lag = expectedServerEpoch - renderedEpoch;
        if (lag >= 1) {
          if (!lagStartTimeRef.current) {
            lagStartTimeRef.current = Date.now();
          } else if (Date.now() - lagStartTimeRef.current > 5000) {
            // Lags for > 5 seconds
            if (lag >= 2) {
              console.warn(`[WATCHDOG] Critical rotation lag (${lag} >= 2) for >5s. Reloading page...`);
              window.location.reload();
              return;
            } else if (lag >= 1) {
              console.warn(`[WATCHDOG] Rotation lag (${lag} >= 1) for >5s. Auto re-fetching...`);
              lagStartTimeRef.current = null;
              isFetchingRef.current = false;
              fetchBroadcastToken(periodCountRef.current, isDarkRoom, true);
              setShowResyncedToast(true);
              setTimeout(() => setShowResyncedToast(false), 3000);
            }
          }
        } else {
          lagStartTimeRef.current = null;
        }
      } else {
        lagStartTimeRef.current = null;
      }

      if (currentServerNow >= expiresAtRef.current && !isFetchingRef.current) {
        fetchBroadcastToken(periodCountRef.current, isDarkRoom);
      }
    }, 250);

    // 2. Visibilitychange handler: on return to foreground, force immediate re-fetch + re-render
    const handleVisibilitySync = () => {
      if (document.visibilityState === 'visible' && !isSessionEndedRef.current) {
        console.log('[Projector] Window returned to foreground — forcing immediate re-fetch + re-render');
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        isFetchingRef.current = false;
        fetchBroadcastToken(periodCountRef.current, isDarkRoom, true);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilitySync);

    return () => {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      document.removeEventListener('visibilitychange', handleVisibilitySync);
    };
  }, [sessionId, isDarkRoom]);

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

  const toggleDarkRoom = () => {
    const nextVal = !isDarkRoom;
    setIsDarkRoom(nextVal);
    try {
      localStorage.setItem('snist_qr_dark_room', String(nextVal));
    } catch {}
    fetchBroadcastToken(undefined, nextVal);
  };

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

  // SVG Circular countdown calculation: circumference = 2 * PI * 44 ≈ 276.46
  const circleRadius = 44;
  const circumference = 2 * Math.PI * circleRadius;
  const strokeDashoffset = circumference * (1 - secondsRemaining / 10);
  const progressPercent = Math.max(0, Math.min(100, (secondsRemaining / 10) * 100));

  const isPhoneDisplay = data?.display_type === 'phone_screen';

  return (
    <div 
      ref={modalContainerRef}
      onMouseMove={handleUserActivity}
      onTouchStart={handleUserActivity}
      onClick={() => { if (!showControls) setShowControls(true); }}
      className={`fixed inset-0 z-50 flex flex-col justify-between overflow-hidden font-sans select-none transition-colors duration-500 ${
        isDarkRoom ? 'bg-black text-white' : 'bg-[#000d1a] text-white'
      }`}
    >
      {/* Phase 7: Transient Re-synced Toast from Watchdog */}
      {showResyncedToast && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 bg-emerald-600 text-white px-5 py-2.5 rounded-full shadow-2xl flex items-center gap-2 text-xs sm:text-sm font-bold animate-bounce border border-emerald-400">
          <CheckCircle className="w-4 h-4 text-emerald-200" />
          <span>Re-synced with Server Time</span>
        </div>
      )}

      {/* Wake Lock Inactive Hint Banner */}
      {!wakeLockActive && !isSessionEnded && showControls && (
        <div className="z-40 bg-amber-500/20 text-amber-200 border-b border-amber-500/30 px-4 py-1.5 text-center text-xs flex items-center justify-center gap-2 font-medium">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
          <span>Keep this window open & screen awake to ensure uninterrupted classroom scanning.</span>
        </div>
      )}

      {/* Red STALE Banner: Displayed if token refresh fails or network stalled */}
      {isStale && !isSessionEnded && (
        <div className="z-50 bg-rose-600 text-white px-6 py-2.5 flex items-center justify-between shadow-2xl font-sans border-b border-rose-400 animate-pulse">
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-5 h-5 text-amber-200 shrink-0" />
            <div>
              <span className="font-black tracking-wide uppercase text-xs sm:text-sm bg-rose-800/80 px-2 py-0.5 rounded mr-2">
                STALE - refresh failed
              </span>
              <span className="text-xs sm:text-sm font-medium text-rose-100">
                The projected QR code is expired. Retrying connection...
              </span>
            </div>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); fetchBroadcastToken(); }}
            className="px-3.5 py-1 bg-white hover:bg-rose-50 text-rose-800 rounded-lg text-xs font-black shadow-md transition flex items-center gap-1.5 shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5 text-rose-700" />
            <span>Retry Now</span>
          </button>
        </div>
      )}

      {/* 5. SESSION ENDED State: Stops rendering QR and displays prominent overlay */}
      {isSessionEnded ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-slate-950 text-white select-none z-40">
          <div className="w-24 h-24 rounded-3xl bg-rose-500/10 border-2 border-rose-500/40 flex items-center justify-center mb-6 shadow-2xl animate-pulse">
            <Lock className="w-12 h-12 text-rose-400" />
          </div>
          <h1 className="text-3xl sm:text-5xl md:text-6xl font-black text-white tracking-tight uppercase mb-4">
            SESSION ENDED
          </h1>
          <p className="text-lg sm:text-2xl font-bold text-rose-300 max-w-xl mb-4">
            No further scans are accepted. Attendance window has closed.
          </p>
          <p className="text-sm text-slate-400 max-w-md mb-8">
            This class session has been locked by the instructor. See your faculty if you require manual attendance reconciliation.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 text-slate-300 font-mono text-xs sm:text-sm bg-white/5 px-6 py-3 rounded-xl border border-white/10 mb-8">
            <span>Session #{sessionId}</span>
            <span>•</span>
            <span>{data?.subject_name || 'Class'}</span>
            <span>•</span>
            <span>{data?.section_name || 'Section'}</span>
            <span>•</span>
            <span>{data?.session_date || 'Today'}</span>
          </div>
          <button
            onClick={onClose}
            className="px-8 py-3.5 bg-rose-600 hover:bg-rose-700 text-white font-black rounded-xl text-sm transition shadow-2xl flex items-center gap-2"
          >
            <X className="w-4 h-4" />
            <span>Close Projector Screen</span>
          </button>
        </div>
      ) : isFullScreenQrMode ? (
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
                  onClick={() => { setError(null); setLoading(true); fetchBroadcastToken(); }}
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
      )}
    </div>
  );
};
