import { useState, useEffect, useRef } from 'react';
import { apiRequest } from '../../services/api';

interface UseProjectorRotatingQrOptions {
  sessionId: number;
  initialPeriodCount?: number;
  onLockSession?: () => void;
  onClose: () => void;
}

export function useProjectorRotatingQr({
  sessionId,
  initialPeriodCount = 1,
  onLockSession,
  onClose,
}: UseProjectorRotatingQrOptions) {
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

      // SESSION ENDED Check: Stop immediately if session has ended or locked
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

      // Display Heartbeat Beacon: send every rotation
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

      // Rotation WATCHDOG: Detect if rendered epoch lags server epoch
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

    // Visibilitychange handler: on return to foreground, force immediate re-fetch + re-render
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

  return {
    data,
    periodCount,
    setPeriodCount,
    loading,
    setLoading,
    error,
    setError,
    secondsRemaining,
    isStale,
    isFullscreen,
    toggleFullscreen,
    isLocking,
    handleLock,
    isFullScreenQrMode,
    setIsFullScreenQrMode,
    wakeLockActive,
    wakeLockSupported,
    isSessionEnded,
    showResyncedToast,
    isDarkRoom,
    toggleDarkRoom,
    currentQr,
    incomingQr,
    isCrossfading,
    showControls,
    setShowControls,
    handleUserActivity,
    modalContainerRef,
    fetchBroadcastToken,
    circleRadius,
    circumference,
    strokeDashoffset,
    progressPercent,
    isPhoneDisplay,
  };
}
