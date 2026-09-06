import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { X, Camera, Search, CheckCircle, AlertTriangle, RefreshCw, Clock, Zap, Activity, ShieldCheck, Flame, WifiOff } from 'lucide-react';
import { apiRequest } from '../services/api';
import { saveScanToOfflineQueue, addScanToBatchQueue, getBatchQueueSize } from '../services/offlineSync';
import { MultiQRDecoder, DecodedQRResult } from '../services/qrDecoder';

interface QRScannerModalProps {
  sessionId: number;
  sessionDate?: string;
  periodText?: string;
  subjectName?: string;
  sectionName?: string;
  initialPeriodCount?: number;
  onClose: () => void;
  onScanSuccess: (data: any) => void;
  onOpenManualSearch: () => void;
}

export const QRScannerModal: React.FC<QRScannerModalProps> = ({
  sessionId,
  sessionDate,
  periodText,
  subjectName,
  sectionName,
  initialPeriodCount,
  onClose,
  onScanSuccess,
  onOpenManualSearch
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [lastScannedResult, setLastScannedResult] = useState<any>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [isTorchSupported, setIsTorchSupported] = useState(false);
  const [isTorchOn, setIsTorchOn] = useState(false);
  const todayStr = new Date().toISOString().split('T')[0];
  const isPastSession = !!(sessionDate && sessionDate < todayStr);
  const [allowMakeup, setAllowMakeup] = useState<boolean>(isPastSession);

  const [periodCount, setPeriodCount] = useState<number>(initialPeriodCount || 4);
  const periodCountRef = useRef<number>(initialPeriodCount || 4);
  const [periodToast, setPeriodToast] = useState<string | null>(null);

  // Online network connectivity state
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleSelectPeriod = (n: number) => {
    setPeriodCount(n);
    periodCountRef.current = n;
    setPeriodToast(`Selected ${n} Period${n > 1 ? 's' : ''}`);
    setTimeout(() => setPeriodToast(null), 1500);
  };

  // Real-time Performance HUD & Verification metrics
  const [fps, setFps] = useState<number>(60);
  const [decodeTimeMs, setDecodeTimeMs] = useState<number>(12);
  const [totalScanned, setTotalScanned] = useState<number>(0);
  const [totalRejected, setTotalRejected] = useState<number>(0);
  const [isRejectPulsing, setIsRejectPulsing] = useState<boolean>(false);
  const [queueSize, setQueueSize] = useState<number>(0);
  const [showStats, setShowStats] = useState<boolean>(true);

  // Recent detected bounding boxes for multi-QR HUD overlays
  const [detectedBoxes, setDetectedBoxes] = useState<Array<{ id: string; x: number; y: number; width: number; height: number; value: string }>>([]);

  // Ref locks & sliding duplicate cache
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const html5QrcodeRef = useRef<Html5Qrcode | null>(null);
  const duplicateCacheRef = useRef<Map<string, number>>(new Map()); // payload -> timestamp
  const animFrameIdRef = useRef<number | null>(null);
  const multiDecoderRef = useRef<MultiQRDecoder>(new MultiQRDecoder());

  // Fast Sound & Haptic Feedback: 2 short pulses for success, 3 distinct pulses for error
  const triggerFeedback = (isSuccess: boolean) => {
    try {
      if (navigator.vibrate) {
        navigator.vibrate(isSuccess ? [80, 40, 80] : [150, 80, 150, 80, 200]);
      }
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = isSuccess ? 'sine' : 'sawtooth';
      osc.frequency.setValueAtTime(isSuccess ? 880 : 250, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + (isSuccess ? 0.15 : 0.35));
    } catch {}
  };

  // Helper to trigger 300ms red border pulse & increment rejected counter
  const recordRejection = (status: string, message: string) => {
    triggerFeedback(false);
    setTotalRejected(prev => prev + 1);
    setIsRejectPulsing(true);
    setTimeout(() => setIsRejectPulsing(false), 350);
    setLastScannedResult({
      status: status || 'REJECTED',
      message: message || 'Scan Rejected'
    });
    setTimeout(() => setLastScannedResult(null), 1600);
  };

  // Local Fast Validation (<5ms)
  const isPayloadValidLocally = (payload: string): boolean => {
    const raw = payload ? payload.trim() : '';
    if (raw.startsWith('V2|')) {
      const parts = raw.split('|');
      if (parts.length === 5 || parts.length === 6) return true;
    }
    if (raw.startsWith('SNIST|') && raw.split('|').length === 6) return true;
    if (raw.startsWith('{') && (raw.includes('studentId') || raw.includes('rollNumber'))) return true;
    return false;
  };

  // Core Multi-QR Handler
  const processDecodedPayload = async (qrPayload: string) => {
    const now = Date.now();
    const lastScannedTime = duplicateCacheRef.current.get(qrPayload) || 0;

    // 3000 ms sliding window deduplication
    if (now - lastScannedTime < 3000) {
      return;
    }
    duplicateCacheRef.current.set(qrPayload, now);

    // Clean old duplicate cache items periodically
    if (duplicateCacheRef.current.size > 100) {
      for (const [k, v] of duplicateCacheRef.current.entries()) {
        if (now - v > 5000) duplicateCacheRef.current.delete(k);
      }
    }

    const isValid = isPayloadValidLocally(qrPayload);
    if (!isValid) {
      recordRejection('INVALID_QR', 'Invalid or Unrecognized QR Code');
      return;
    }

    // Task 0: Honest Offline Handling
    if (!navigator.onLine) {
      saveScanToOfflineQueue({
        session_id: sessionId,
        qr_payload: qrPayload,
        scanned_at: new Date().toISOString()
      });
      triggerFeedback(false);
      setLastScannedResult({
        status: 'OFFLINE_QUEUED',
        message: 'Saved to offline sync queue (verification pending).'
      });
      setQueueSize(getBatchQueueSize());
      setTimeout(() => setLastScannedResult(null), 1500);
      return;
    }

    // Send instant single API verification request for UI confirmation
    try {
      const tScanStart = performance.now();
      const response: any = await apiRequest('/attendance/scan', {
        method: 'POST',
        body: JSON.stringify({
          session_id: sessionId,
          qr_payload: qrPayload,
          period_count: periodCountRef.current,
          allow_makeup: allowMakeup
        })
      });
      const tScanDuration = Math.round(performance.now() - tScanStart);
      console.log(`[PERF_LOG] QR API verification completed in ${tScanDuration}ms`);

      if (response.status === 'ALREADY_MARKED') {
        recordRejection('ALREADY_MARKED', response.message || 'Student already marked present today');
        return;
      }

      triggerFeedback(true);
      setTotalScanned(prev => prev + 1);
      setLastScannedResult(response);
      onScanSuccess(response);
      setTimeout(() => setLastScannedResult(null), 1200);
    } catch (err: any) {
      recordRejection('ERROR', err.message || 'Verification Failed');
    }
  };

  const [focusMode, setFocusMode] = useState<string>('auto');
  const [zoomLevel, setZoomLevel] = useState<number>(1.0);
  const [isZoomSupported, setIsZoomSupported] = useState<boolean>(false);
  const [zoomRange, setZoomRange] = useState<{ min: number; max: number; step: number }>({ min: 1, max: 3, step: 0.1 });

  const isDetectingRef = useRef<boolean>(false);

  const handleZoomChange = async (newZoom: number) => {
    setZoomLevel(newZoom);
    if (mediaStreamRef.current) {
      const track = mediaStreamRef.current.getVideoTracks()[0];
      if (track && track.applyConstraints) {
        try {
          await track.applyConstraints({ advanced: [{ zoom: newZoom }] as any });
        } catch (e) {
          console.warn("Zoom constraint error:", e);
        }
      }
    }
  };

  // High-Speed Camera & Scanner Initialization
  useEffect(() => {
    let isMounted = true;
    let frameCount = 0;
    let lastFpsCalc = Date.now();
    let lastHudUpdate = 0;

    const tMount = performance.now();
    console.log(`[PERF_LOG] Scanner modal mounted at +0ms`);

    const startNativeStream = async () => {
      try {
        const tUserMediaStart = performance.now();
        console.log(`[PERF_LOG] Scanner initialization started at +${Math.round(tUserMediaStart - tMount)}ms`);

        // Check if native BarcodeDetector is supported (Android Chrome / Edge)
        if (multiDecoderRef.current.isNative) {
          let stream: MediaStream;
          try {
            // Optimized 720p constraints for instant hardware ISP startup (<200ms)
            stream = await navigator.mediaDevices.getUserMedia({
              video: {
                facingMode: facingMode,
                width: { ideal: 1280 },
                height: { ideal: 720 }
              },
              audio: false
            });
          } catch (e) {
            // Fallback for iOS WebKit constraint matching
            stream = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: 'environment' },
              audio: false
            });
          }

          if (!isMounted) return;
          mediaStreamRef.current = stream;

          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            await videoRef.current.play();
          }

          // Hardware Feature Inspection: Torch, Autofocus, Zoom
          const track = stream.getVideoTracks()[0];
          if (track) {
            const caps: any = track.getCapabilities ? track.getCapabilities() : {};
            if (caps.torch) setIsTorchSupported(true);

            // Hardware Continuous Autofocus Request
            if (caps.focusMode && Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
              try {
                await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] as any });
                setFocusMode('continuous');
              } catch (e) {
                setFocusMode('auto');
              }
            } else {
              setFocusMode('auto');
            }

            // Hardware Zoom Range Inspection
            if (caps.zoom) {
              setIsZoomSupported(true);
              setZoomRange({
                min: caps.zoom.min || 1,
                max: Math.min(caps.zoom.max || 3, 3),
                step: caps.zoom.step || 0.1
              });
            }
          }

          // Main Throttled FPS Loop with Promise Overlap Protection
          const scanFrameLoop = async () => {
            if (!isMounted || !videoRef.current) return;

            const startTime = performance.now();
            frameCount++;

            const now = Date.now();
            if (now - lastFpsCalc >= 1000) {
              setFps(frameCount);
              frameCount = 0;
              lastFpsCalc = now;
            }

            if (videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA && !isDetectingRef.current) {
              isDetectingRef.current = true;
              try {
                const results: DecodedQRResult[] = await multiDecoderRef.current.detectMulti(videoRef.current);
                const endTime = performance.now();
                const decodeMs = Math.round(endTime - startTime);

                // Throttle HUD UI state updates to once every 500ms
                if (now - lastHudUpdate > 500) {
                  setDecodeTimeMs(decodeMs);
                  lastHudUpdate = now;
                }

                if (results && results.length > 0) {
                  const boxes = results.map(r => ({
                    id: Math.random().toString(36).substring(2, 7),
                    x: r.boundingBox.x,
                    y: r.boundingBox.y,
                    width: r.boundingBox.width,
                    height: r.boundingBox.height,
                    value: r.rawValue
                  }));
                  setDetectedBoxes(boxes);

                  for (const res of results) {
                    if (res.rawValue) {
                      processDecodedPayload(res.rawValue);
                    }
                  }
                } else if (now - lastHudUpdate > 500) {
                  setDetectedBoxes([]);
                }
              } catch (detectErr) {
                console.warn("Detection error:", detectErr);
              } finally {
                isDetectingRef.current = false;
              }
            }

            animFrameIdRef.current = requestAnimationFrame(scanFrameLoop);
          };

          animFrameIdRef.current = requestAnimationFrame(scanFrameLoop);
        } else {
          // iOS Safari / WebKit Fallback: Let Html5Qrcode acquire stream directly (avoids double getUserMedia conflict)
          const scanner = new Html5Qrcode("reader");
          html5QrcodeRef.current = scanner;
          
          await scanner.start(
            { facingMode: "environment" },
            { fps: 30, qrbox: { width: 280, height: 280 } },
            (decodedText) => {
              processDecodedPayload(decodedText);
            },
            () => {}
          );
        }

      } catch (err: any) {
        if (isMounted) {
          console.error("Camera startup error:", err);
          const rawErrMsg = err?.message || String(err);
          let userFriendlyMsg = "Could not access mobile camera. Please check camera permissions.";
          if (rawErrMsg.includes("pattern") || rawErrMsg.includes("SyntaxError")) {
            userFriendlyMsg = "Camera format mismatch. Retrying scanner stream...";
          }
          setCameraError(userFriendlyMsg);
        }
      }
    };

    startNativeStream();

    return () => {
      isMounted = false;
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (html5QrcodeRef.current && html5QrcodeRef.current.isScanning) {
        html5QrcodeRef.current.stop().catch(() => {});
      }
    };
  }, [facingMode]);

  // Torch Toggle Handler
  const toggleTorch = async () => {
    if (!mediaStreamRef.current) return;
    const track = mediaStreamRef.current.getVideoTracks()[0];
    if (track) {
      try {
        const nextState = !isTorchOn;
        await (track as any).applyConstraints({ advanced: [{ torch: nextState }] });
        setIsTorchOn(nextState);
      } catch (e) {
        console.warn("Torch control error", e);
      }
    }
  };

  const toggleCamera = () => {
    setFacingMode(prev => prev === 'environment' ? 'user' : 'environment');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col" style={{ height: '100dvh' }}>
      
      {/* Top Bar Header */}
      <div className="flex-none flex items-center justify-between px-4 py-3 bg-slate-950/90 backdrop-blur-md border-b border-slate-800/80">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Flame className="w-5 h-5 text-orange-500 animate-pulse" /> 
            <span>{subjectName || 'SNIST Live Scanner'} {sectionName ? `(${sectionName})` : ''}</span>
            <span className="text-[10px] px-2 py-0.5 bg-cyan-500/20 text-cyan-400 font-mono rounded-full border border-cyan-500/30">V2 60FPS</span>
          </h2>
          {(sessionDate || periodText) && (
            <p className="text-xs text-orange-400 font-mono font-bold mt-0.5">
              📅 {sessionDate || ''} • ⏱️ {periodText || ''}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Persistent Marked / Rejected Chip */}
          <div className="px-2.5 py-1 rounded-xl bg-slate-900/90 border border-slate-700/80 text-[11px] font-mono font-bold flex items-center gap-2">
            <span className="text-emerald-400">✅ {totalScanned}</span>
            <span className="text-slate-600">·</span>
            <span className="text-rose-400">⚠️ {totalRejected}</span>
          </div>

          {/* Stats Toggle */}
          <button
            onClick={() => setShowStats(!showStats)}
            className={`p-2 rounded-xl text-xs font-mono font-bold transition-all border ${
              showStats ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300' : 'bg-slate-800 border-slate-700 text-slate-400'
            }`}
          >
            <Activity className="w-4 h-4" />
          </button>

          <button 
            onClick={onClose} 
            className="p-2 rounded-full bg-slate-800/80 text-slate-300 active:bg-slate-700 border border-slate-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Task 0: Teacher Offline Warning Banner */}
      {!isOnline && (
        <div className="flex items-center justify-between px-4 py-2 bg-amber-500/20 border-b border-amber-500/40 text-amber-300 text-xs shrink-0 animate-in fade-in">
          <span className="flex items-center gap-1.5 font-bold">
            <WifiOff className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>Offline — Live verification paused</span>
          </span>
          <button
            type="button"
            onClick={onOpenManualSearch}
            className="px-2.5 py-1 rounded-lg bg-amber-500 text-slate-950 font-extrabold text-[11px] shadow-sm hover:bg-amber-400 transition"
          >
            Open Manual Roster
          </button>
        </div>
      )}

      {/* Make-up Mode Banner for Past Sessions */}
      {isPastSession && (
        <div className="flex items-center justify-between px-4 py-2 bg-amber-500/15 border-b border-amber-500/30 text-amber-300 text-xs shrink-0">
          <span className="flex items-center gap-1.5 font-bold">
            <span>⚠️ Make-up Session ({sessionDate})</span>
          </span>
          <button
            type="button"
            onClick={() => setAllowMakeup(!allowMakeup)}
            className={`px-3 py-1 rounded-lg font-bold text-[11px] transition-colors flex items-center gap-1.5 ${
              allowMakeup ? 'bg-amber-500 text-slate-950 font-extrabold shadow-sm' : 'bg-slate-800 text-slate-400 border border-slate-700'
            }`}
          >
            {allowMakeup ? '✓ Accepting Today\'s Live QRs' : 'Require Past Date QR'}
          </button>
        </div>
      )}

      {/* Camera Stream Area */}
      <div className="flex-1 relative overflow-hidden bg-black flex items-center justify-center">
        
        {/* Video feed element for 60 FPS BarcodeDetector */}
        <video 
          ref={videoRef} 
          className="absolute inset-0 w-full h-full object-cover" 
          playsInline 
          muted 
        />

        {/* Html5Qrcode fallback container */}
        <div id="reader" className="absolute inset-0 pointer-events-none" />

        {/* Real-time Multi-QR Bounding Box Overlays */}
        {detectedBoxes.map((box) => (
          <div
            key={box.id}
            className="absolute border-2 border-cyan-400 rounded-lg bg-cyan-400/10 pointer-events-none animate-pulse"
            style={{
              left: `${(box.x / (videoRef.current?.videoWidth || 1920)) * 100}%`,
              top: `${(box.y / (videoRef.current?.videoHeight || 1080)) * 100}%`,
              width: `${(box.width / (videoRef.current?.videoWidth || 1920)) * 100}%`,
              height: `${(box.height / (videoRef.current?.videoHeight || 1080)) * 100}%`,
            }}
          >
            <span className="absolute -top-6 left-0 bg-cyan-500 text-slate-950 text-[10px] font-bold px-1.5 py-0.5 rounded shadow">
              QR DETECTED
            </span>
          </div>
        ))}

        {/* Center Scanner Frame & Laser with 300ms Red Border Pulse on Rejection */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <div 
            className={`relative transition-all duration-200 ${
              isRejectPulsing 
                ? 'scale-105 ring-4 ring-rose-500 shadow-[0_0_35px_#f43f5e] rounded-2xl bg-rose-500/10' 
                : ''
            }`} 
            style={{ width: '74vw', height: '74vw', maxWidth: '340px', maxHeight: '340px' }}
          >
            <div className={`absolute top-0 left-0 w-8 h-8 border-t-[3px] border-l-[3px] rounded-tl-xl transition-colors ${
              isRejectPulsing ? 'border-rose-500' : 'border-cyan-400'
            }`} />
            <div className={`absolute top-0 right-0 w-8 h-8 border-t-[3px] border-r-[3px] rounded-tr-xl transition-colors ${
              isRejectPulsing ? 'border-rose-500' : 'border-cyan-400'
            }`} />
            <div className={`absolute bottom-0 left-0 w-8 h-8 border-b-[3px] border-l-[3px] rounded-bl-xl transition-colors ${
              isRejectPulsing ? 'border-rose-500' : 'border-cyan-400'
            }`} />
            <div className={`absolute bottom-0 right-0 w-8 h-8 border-b-[3px] border-r-[3px] rounded-br-xl transition-colors ${
              isRejectPulsing ? 'border-rose-500' : 'border-cyan-400'
            }`} />

            {/* Laser Line */}
            <div className={`absolute left-2 right-2 height-0.5 shadow-[0_0_15px_#22d3ee] animate-pulse transition-colors ${
              isRejectPulsing ? 'bg-rose-500 shadow-[0_0_15px_#f43f5e]' : 'bg-cyan-400'
            }`} style={{ top: '50%' }} />
          </div>
        </div>

        {/* Performance & Hardware Debug HUD Overlay */}
        {showStats && (
          <div className="absolute top-3 left-3 z-30 bg-slate-950/90 backdrop-blur-md border border-slate-800 rounded-xl p-3 text-[11px] font-mono text-slate-300 space-y-1 shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-500">Detector:</span>
              <span className="font-bold text-cyan-400">{multiDecoderRef.current.isNative ? 'BarcodeDetector' : 'Html5Qrcode'}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-500">FPS:</span>
              <span className="font-bold text-emerald-400">{fps}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-500">Decode Latency:</span>
              <span className="font-bold text-cyan-400">{decodeTimeMs} ms</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-500">Focus Mode:</span>
              <span className="font-bold text-amber-400">{focusMode}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-500">Hardware Zoom:</span>
              <span className="font-bold text-amber-400">{zoomLevel.toFixed(1)}x</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-500">Scanned Count:</span>
              <span className="font-bold text-orange-400">{totalScanned}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-500">Rejected Count:</span>
              <span className="font-bold text-rose-400">{totalRejected}</span>
            </div>
          </div>
        )}

        {/* Error State with Camera Permission Recovery */}
        {cameraError && (
          <div className="absolute inset-0 bg-slate-900/95 flex flex-col items-center justify-center p-6 text-center z-40">
            <AlertTriangle className="w-12 h-12 text-rose-500 mb-3" />
            <p className="text-sm font-semibold text-rose-200 mb-2">{cameraError}</p>
            <p className="text-xs text-slate-400 mb-4 max-w-xs">
              If blocked, tap the lock icon in the browser address bar and set Camera to Allow.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setFacingMode(prev => prev === 'environment' ? 'user' : 'environment')}
                className="px-4 py-2.5 bg-slate-800 text-slate-200 border border-slate-700 font-bold rounded-xl text-xs flex items-center gap-1.5 hover:bg-slate-700 active:scale-95 transition"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Retry Camera
              </button>
              <button
                onClick={onOpenManualSearch}
                className="px-5 py-2.5 bg-cyan-500 text-slate-950 font-bold rounded-xl text-xs hover:bg-cyan-400 active:scale-95 transition"
              >
                Use Manual Search
              </button>
            </div>
          </div>
        )}

        {/* Period Selection Feedback Toast Banner */}
        {periodToast && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 bg-cyan-500 text-slate-950 px-4 py-2 rounded-full font-bold text-xs shadow-lg shadow-cyan-500/30 border border-cyan-300 animate-bounce">
            {periodToast}
          </div>
        )}

        {/* Scanned Result Banner Overlay */}
        {lastScannedResult && (
          <div className={`absolute inset-0 z-40 flex flex-col items-center justify-center p-6 text-center backdrop-blur-md transition-all animate-in fade-in ${
            lastScannedResult.status === 'SUCCESS' ? 'bg-emerald-950/90 text-emerald-200' :
            lastScannedResult.status === 'PERIOD_UPDATED' ? 'bg-cyan-950/90 text-cyan-200' :
            lastScannedResult.status === 'OFFLINE_QUEUED' ? 'bg-amber-950/90 text-amber-200' :
            'bg-rose-950/95 text-rose-200'
          }`}>
            {lastScannedResult.status === 'SUCCESS' ? (
              <>
                <CheckCircle className="w-16 h-16 text-emerald-400 mb-2 animate-bounce" />
                <h3 className="text-xl font-bold text-white">{lastScannedResult.student_name || 'Attendance Logged'}</h3>
                <p className="text-sm font-mono text-emerald-300">{lastScannedResult.roll_number}</p>
                <span className="mt-2 px-3 py-1 bg-emerald-500/20 rounded-full text-xs font-bold text-emerald-300 flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5" /> VERIFIED INSTANTLY
                </span>
              </>
            ) : lastScannedResult.status === 'PERIOD_UPDATED' ? (
              <>
                <CheckCircle className="w-16 h-16 text-cyan-400 mb-2 animate-bounce" />
                <h3 className="text-xl font-bold text-white">{lastScannedResult.student_name || 'Period Updated'}</h3>
                <p className="text-sm font-mono text-cyan-300">{lastScannedResult.roll_number}</p>
                <span className="mt-2 px-3.5 py-1.5 bg-cyan-500/20 rounded-full text-xs font-bold text-cyan-300 flex items-center gap-1 border border-cyan-400/40">
                  <Zap className="w-3.5 h-3.5 text-cyan-300" /> {lastScannedResult.message || 'PERIOD COUNT UPDATED'}
                </span>
              </>
            ) : lastScannedResult.status === 'OFFLINE_QUEUED' ? (
              <>
                <WifiOff className="w-14 h-14 text-amber-400 mb-2 animate-pulse" />
                <span className="px-3 py-1 bg-amber-500/20 rounded-full text-xs font-bold text-amber-300 mb-2">
                  OFFLINE SCAN STORED
                </span>
                <h3 className="text-base font-bold text-white max-w-xs">{lastScannedResult.message}</h3>
                <p className="text-xs text-amber-300/80 mt-2 font-mono">Will sync automatically upon reconnection</p>
              </>
            ) : (
              /* Task 4: Rejection Awareness Overlay with prominent badge & reason */
              <>
                <div className="w-16 h-16 bg-rose-900/60 border-2 border-rose-500 rounded-full flex items-center justify-center mb-3 animate-pulse">
                  <AlertTriangle className="w-9 h-9 text-rose-400" />
                </div>
                <span className="px-3 py-1 bg-rose-500/30 border border-rose-400/50 rounded-full text-xs font-black uppercase tracking-wider text-rose-300 mb-2">
                  ⚠️ SCAN REJECTED
                </span>
                <h3 className="text-lg font-bold text-white max-w-xs">{lastScannedResult.message || lastScannedResult.status}</h3>
                <p className="text-xs text-rose-300 mt-2 font-mono">⚠️ Rejection counted in session tally</p>
              </>
            )}
          </div>
        )}
      </div>

      {/* Bottom Controls Bar */}
      <div className="flex-none bg-slate-950/90 backdrop-blur-md border-t border-slate-800 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3 bg-slate-900/60 p-2 rounded-2xl border border-slate-800/70">
          <div className="flex items-center gap-1.5 shrink-0 pl-1">
            <Clock className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider shrink-0">Periods:</span>
          </div>
          <div className="grid grid-cols-8 gap-1 flex-1 px-1">
            {[1, 2, 3, 4, 5, 6, 7, 8].map(n => (
              <button
                key={n}
                onClick={() => handleSelectPeriod(n)}
                className={`h-8 sm:h-9 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center justify-center active:scale-95 touch-manipulation ${
                  periodCount === n
                    ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/30 scale-105 font-extrabold'
                    : 'bg-slate-800/90 text-slate-300 border border-slate-700/80 hover:bg-slate-700'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>


        {/* Hardware Zoom Controls */}
        {isZoomSupported && (
          <div className="flex items-center justify-center gap-2 mb-3 bg-slate-900/60 p-2 rounded-2xl border border-slate-800/70">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mr-2">Zoom:</span>
            {[1.0, 1.5, 2.0].map((z) => (
              <button
                key={z}
                onClick={() => handleZoomChange(z)}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                  zoomLevel === z
                    ? 'bg-cyan-500 text-slate-950 font-extrabold shadow-sm'
                    : 'bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700'
                }`}
              >
                {z.toFixed(1)}x
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-around gap-2">
          {isTorchSupported && (
            <button
              onClick={toggleTorch}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold border transition-all ${
                isTorchOn ? 'bg-amber-500 text-slate-950 border-amber-400 font-bold' : 'bg-slate-800 text-slate-200 border-slate-700'
              }`}
            >
              <Zap className="w-4 h-4" /> Torch
            </button>
          )}

          <button
            onClick={toggleCamera}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 text-slate-200 text-xs font-semibold border border-slate-700"
          >
            <RefreshCw className="w-4 h-4 text-cyan-400" /> Switch
          </button>

          <button
            onClick={onOpenManualSearch}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-cyan-500 text-slate-950 text-xs font-bold shadow-lg shadow-cyan-500/20"
          >
            <Search className="w-4 h-4" /> Manual
          </button>
        </div>
      </div>

    </div>
  );
};
