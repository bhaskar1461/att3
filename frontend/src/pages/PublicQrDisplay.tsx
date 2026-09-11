import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { Download, Maximize2, Minimize2, ShieldCheck, AlertCircle, X, Tv } from 'lucide-react';

export const PublicQrDisplay: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wakeLockSentinelRef = useRef<any>(null);

  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [wakeLockActive, setWakeLockActive] = useState<boolean>(false);
  const [showWakeLockHint, setShowWakeLockHint] = useState<boolean>(false);
  const [targetUrl, setTargetUrl] = useState<string>('');
  const [currentTime, setCurrentTime] = useState<string>('');
  const [isGeneratingPoster, setIsGeneratingPoster] = useState<boolean>(false);

  // 1. Derive canonical login target URL from window.location.origin
  useEffect(() => {
    const origin = window.location.origin;
    const loginUrl = `${origin}/login`;
    setTargetUrl(loginUrl);

    // Render high-resolution, high-contrast QR on canvas
    if (canvasRef.current) {
      QRCode.toCanvas(
        canvasRef.current,
        loginUrl,
        {
          errorCorrectionLevel: 'H',
          margin: 4, // 4-module standard quiet zone
          scale: 16, // High pixel density for sharp projection
          color: {
            dark: '#000000',
            light: '#ffffff',
          },
        },
        (error) => {
          if (error) {
            console.error('Failed to render public login QR code:', error);
          }
        }
      );
    }
  }, []);

  // 2. Screen Wake Lock API — Keeps display awake for continuous projector display
  useEffect(() => {
    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator && (navigator as any).wakeLock) {
          wakeLockSentinelRef.current = await (navigator as any).wakeLock.request('screen');
          setWakeLockActive(true);
          setShowWakeLockHint(false);

          wakeLockSentinelRef.current.addEventListener('release', () => {
            setWakeLockActive(false);
          });
        } else {
          setShowWakeLockHint(true);
        }
      } catch (err) {
        console.warn('Screen wake lock unavailable:', err);
        setWakeLockActive(false);
        setShowWakeLockHint(true);
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

  // 3. Live clock for slim footer
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleDateString('en-IN', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        })
      );
    };

    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  // 4. Fullscreen toggle for projector presentation
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      if (containerRef.current?.requestFullscreen) {
        containerRef.current.requestFullscreen().catch(() => {});
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

  // 5. Download Poster (PNG) at print resolution (1800 x 2400)
  const handleDownloadPoster = async () => {
    try {
      setIsGeneratingPoster(true);

      const posterCanvas = document.createElement('canvas');
      posterCanvas.width = 1800;
      posterCanvas.height = 2400;
      const ctx = posterCanvas.getContext('2d');
      if (!ctx) return;

      // Background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 1800, 2400);

      // Top Institutional Accent Band
      const gradient = ctx.createLinearGradient(0, 0, 1800, 0);
      gradient.addColorStop(0, '#001e40');
      gradient.addColorStop(0.5, '#15347e');
      gradient.addColorStop(1, '#001e40');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 1800, 420);

      // Institutional Header Text
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.font = 'bold 50px "Segoe UI", Arial, sans-serif';
      ctx.fillText('SREENIDHI INSTITUTE OF SCIENCE & TECHNOLOGY', 900, 130);

      ctx.fillStyle = '#ffb703';
      ctx.font = 'bold 74px "Segoe UI", Arial, sans-serif';
      ctx.fillText('SNIST ERP PORTAL', 900, 240);

      ctx.fillStyle = '#cbd5e1';
      ctx.font = 'bold 36px "Segoe UI", Arial, sans-serif';
      ctx.fillText('AI QR ATTENDANCE & ACADEMIC SYSTEM', 900, 320);

      // Call to action
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 56px "Segoe UI", Arial, sans-serif';
      ctx.fillText('SCAN TO LOGIN & MARK ATTENDANCE', 900, 520);

      ctx.fillStyle = '#475569';
      ctx.font = '36px "Segoe UI", Arial, sans-serif';
      ctx.fillText('Scan this code with your smartphone camera to open the portal', 900, 590);

      // Generate Print-Resolution QR Code
      const qrDataUrl = await QRCode.toDataURL(targetUrl || `${window.location.origin}/login`, {
        errorCorrectionLevel: 'H',
        margin: 2,
        scale: 24,
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      });

      const qrImg = new Image();
      qrImg.src = qrDataUrl;
      await new Promise((resolve) => {
        qrImg.onload = resolve;
      });

      // Draw QR Box & Image
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 6;
      ctx.strokeRect(270, 670, 1260, 1260);
      ctx.drawImage(qrImg, 300, 700, 1200, 1200);

      // Instructions Box
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(250, 2020, 1300, 220);
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 3;
      ctx.strokeRect(250, 2020, 1300, 220);

      ctx.fillStyle = '#001e40';
      ctx.font = 'bold 38px "Segoe UI", Arial, sans-serif';
      ctx.fillText('PORTAL URL: https://ather-os.de5.net/login', 900, 2090);

      ctx.fillStyle = '#64748b';
      ctx.font = '30px "Segoe UI", Arial, sans-serif';
      ctx.fillText('Android (Chrome: Install App) • iPhone (Safari: Add to Home Screen)', 900, 2150);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '24px "Segoe UI", Arial, sans-serif';
      ctx.fillText('Official Institutional Notice • Permanent Hall Poster', 900, 2200);

      // Trigger Download
      const link = document.createElement('a');
      link.download = 'SNIST_ERP_Login_QR_Poster.png';
      link.href = posterCanvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error('Error generating poster:', err);
    } finally {
      setIsGeneratingPoster(false);
    }
  };

  return (
    <div
      ref={containerRef}
      className="h-screen w-screen max-h-screen max-w-screen overflow-hidden bg-[#030914] text-white flex flex-col justify-between select-none relative font-sans"
    >
      {/* Top Bar: Headline & Projector Controls */}
      <header className="px-4 sm:px-8 pt-3 sm:pt-5 pb-2 flex items-center justify-between gap-4 z-10 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center font-black text-sm sm:text-base text-[#001e40] shadow-md shrink-0">
            SN
          </div>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl lg:text-3xl font-black tracking-tight text-white flex items-center gap-2">
              <span>SNIST ERP</span>
              <span className="hidden sm:inline-block px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-mono font-bold border border-emerald-500/30">
                PORTAL QR
              </span>
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 font-medium truncate">
              Scan to open &rarr; Login &rarr; Mark Attendance
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* Wake Lock Status Badge */}
          {wakeLockActive && (
            <span className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-mono font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Screen Awake
            </span>
          )}

          {/* Download Poster Button */}
          <button
            onClick={handleDownloadPoster}
            disabled={isGeneratingPoster}
            className="px-3 sm:px-4 py-2 bg-white/10 hover:bg-white/20 active:scale-95 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 sm:gap-2 border border-white/15 shadow-sm"
            title="Download high-resolution printable wall poster (PNG)"
          >
            <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-400" />
            <span className="hidden xs:inline">{isGeneratingPoster ? 'Generating...' : 'Download Poster (PNG)'}</span>
            <span className="xs:hidden">Poster</span>
          </button>

          {/* Fullscreen Toggle Button */}
          <button
            onClick={toggleFullscreen}
            className="p-2 sm:px-3 sm:py-2 bg-amber-500 hover:bg-amber-400 active:scale-95 text-[#001e40] rounded-xl text-xs font-black transition flex items-center gap-1.5 shadow-lg"
            title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen (Projector Mode)'}
          >
            {isFullscreen ? (
              <Minimize2 className="w-4 h-4 text-[#001e40]" />
            ) : (
              <Maximize2 className="w-4 h-4 text-[#001e40]" />
            )}
            <span className="hidden sm:inline">{isFullscreen ? 'Exit Fullscreen' : 'Fullscreen (F11)'}</span>
          </button>
        </div>
      </header>

      {/* Dismissible Wake Lock Warning Hint (for unsupported browsers) */}
      {showWakeLockHint && (
        <div className="mx-4 sm:mx-8 px-3 py-1.5 bg-amber-500/15 border border-amber-500/30 rounded-lg flex items-center justify-between gap-2 text-xs text-amber-300 z-10 shrink-0">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
            <span>Projector hint: Set display sleep to <strong>Never</strong> to prevent the screen from turning off.</span>
          </div>
          <button
            onClick={() => setShowWakeLockHint(false)}
            className="p-1 text-amber-300 hover:text-white rounded"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Center Stage: High-Resolution Pure Black-on-White QR Code */}
      <main className="flex-1 flex flex-col items-center justify-center p-2 sm:p-4 min-h-0 relative">
        <div
          className="relative flex items-center justify-center bg-white p-4 sm:p-7 rounded-2xl sm:rounded-3xl shadow-2xl border-4 border-slate-100"
          style={{
            height: 'min(74vh, 74vw)',
            width: 'min(74vh, 74vw)',
            maxHeight: 'calc(100vh - 140px)',
            maxWidth: 'calc(100vh - 140px)',
          }}
        >
          <canvas
            ref={canvasRef}
            className="w-full h-full object-contain"
            style={{
              imageRendering: 'pixelated',
            }}
          />
        </div>
      </main>

      {/* Slim Dim Footer Strip: Separated from QR, No Interference */}
      <footer className="px-4 sm:px-8 py-2.5 bg-[#02050b]/80 border-t border-white/5 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-400 z-10 shrink-0">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-slate-400">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Sreenidhi Institute of Science &amp; Technology</span>
          </span>
          <span className="hidden sm:inline text-slate-600">•</span>
          <span className="hidden sm:inline text-slate-400">Target: {targetUrl}</span>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-slate-400">{currentTime}</span>
          <span className="hidden md:inline px-2 py-0.5 rounded bg-white/5 border border-white/10 text-slate-300">
            Static Hall QR
          </span>
        </div>
      </footer>
    </div>
  );
};
