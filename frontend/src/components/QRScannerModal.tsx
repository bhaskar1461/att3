import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { X, Camera, Search, CheckCircle, AlertTriangle, RefreshCw, Clock, Zap, Activity, ShieldCheck, Flame } from 'lucide-react';
import { apiRequest } from '../services/api';
import { saveScanToOfflineQueue, addScanToBatchQueue, getBatchQueueSize } from '../services/offlineSync';
import { MultiQRDecoder, DecodedQRResult } from '../services/qrDecoder';

interface QRScannerModalProps {
  sessionId: number;
  initialPeriodCount?: number;
  onClose: () => void;
  onScanSuccess: (data: any) => void;
  onOpenManualSearch: () => void;
}

export const QRScannerModal: React.FC<QRScannerModalProps> = ({
  sessionId,
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
  const [periodCount, setPeriodCount] = useState<number>(initialPeriodCount || 4);
  const periodCountRef = useRef<number>(initialPeriodCount || 4);
  const [periodToast, setPeriodToast] = useState<string | null>(null);

  const handleSelectPeriod = (n: number) => {
    setPeriodCount(n);
    periodCountRef.current = n;
    setPeriodToast(`Selected ${n} Period${n > 1 ? 's' : ''}`);
    setTimeout(() => setPeriodToast(null), 1500);
  };

  // Real-time Performance HUD metrics
  const [fps, setFps] = useState<number>(60);
  const [decodeTimeMs, setDecodeTimeMs] = useState<number>(12);
  const [totalScanned, setTotalScanned] = useState<number>(0);
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

  // Fast Sound & Haptic Feedback
  const triggerFeedback = (isSuccess: boolean) => {
    try {
      if (navigator.vibrate) {
        navigator.vibrate(isSuccess ? [80, 40, 80] : [300]);
      }
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = isSuccess ? 'sine' : 'sawtooth';
      osc.frequency.setValueAtTime(isSuccess ? 880 : 300, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + (isSuccess ? 0.15 : 0.3));
    } catch {}
  };

  // Local Fast Validation (<5ms)
  const isPayloadValidLocally = (payload: string): boolean => {
    const raw = payload ? payload.trim() : '';
    if (raw.startsWith('V2|') && raw.split('|').length === 5) return true;
    if (raw.startsWith('SNIST|') && raw.split('|').length === 6) return true;
    if (raw.startsWith('{') && raw.includes('studentId')) return true;
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
      triggerFeedback(false);
      setLastScannedResult({ status: 'ERROR', message: 'Invalid or Tampered QR Payload' });
      setTimeout(() => setLastScannedResult(null), 1200);
      return;
    }

    // Instant local success trigger
    triggerFeedback(true);
    setTotalScanned(prev => prev + 1);

    if (!navigator.onLine) {
      saveScanToOfflineQueue({
        session_id: sessionId,
        qr_payload: qrPayload,
        scanned_at: new Date().toISOString()
      });
      setLastScannedResult({
        status: 'OFFLINE_QUEUED',
        message: 'Saved offline to queue.'
      });
      setQueueSize(getBatchQueueSize());
      setTimeout(() => setLastScannedResult(null), 1200);
      return;
    }

    // Add scan to high-speed batch upload queue
    addScanToBatchQueue({
      session_id: sessionId,
      qr_payload: qrPayload,
      period_count: periodCountRef.current,
      scanned_at: new Date().toISOString()
    });
    setQueueSize(getBatchQueueSize());

    // Send instant single API verification request for UI confirmation
    try {
      const response: any = await apiRequest('/attendance/scan', {
        method: 'POST',
        body: JSON.stringify({
          session_id: sessionId,
          qr_payload: qrPayload,
          period_count: periodCountRef.current
        })
      });

      setLastScannedResult(response);
      onScanSuccess(response);
      setTimeout(() => setLastScannedResult(null), 1000);
    } catch (err: any) {
      setLastScannedResult({
        status: 'ERROR',
        message: err.message || 'Verification Failed'
      });
      setTimeout(() => setLastScannedResult(null), 1200);
    }
  };

  // High-Speed Camera & Scanner Initialization
  useEffect(() => {
    let isMounted = true;
    let frameCount = 0;
    let lastFpsCalc = Date.now();

    const startNativeStream = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: facingMode,
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 60 }
          },
          audio: false
        });

        if (!isMounted) return;
        mediaStreamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        // Check flashlight/torch support
        const track = stream.getVideoTracks()[0];
        if (track) {
          const caps: any = track.getCapabilities ? track.getCapabilities() : {};
          if (caps.torch) setIsTorchSupported(true);
        }

        // Main 60 FPS Loop
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

          if (videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
            const results: DecodedQRResult[] = await multiDecoderRef.current.detectMulti(videoRef.current);
            const endTime = performance.now();
            setDecodeTimeMs(Math.round(endTime - startTime));

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

              // Process all detected QRs in frame simultaneously
              for (const res of results) {
                if (res.rawValue) {
                  processDecodedPayload(res.rawValue);
                }
              }
            } else {
              setDetectedBoxes([]);
            }
          }

          animFrameIdRef.current = requestAnimationFrame(scanFrameLoop);
        };

        if (multiDecoderRef.current.isNative) {
          animFrameIdRef.current = requestAnimationFrame(scanFrameLoop);
        } else {
          // Fallback to Html5Qrcode decoder if native BarcodeDetector missing
          const scanner = new Html5Qrcode("reader");
          html5QrcodeRef.current = scanner;
          await scanner.start(
            { facingMode: facingMode },
            { fps: 30, qrbox: { width: 300, height: 300 } },
            (decodedText) => {
              processDecodedPayload(decodedText);
            },
            () => {}
          );
        }

      } catch (err: any) {
        if (isMounted) {
          setCameraError(err?.message || "Could not access mobile camera. Please allow camera permissions.");
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
            <span>SNIST Live Scanner</span>
            <span className="text-[10px] px-2 py-0.5 bg-cyan-500/20 text-cyan-400 font-mono rounded-full border border-cyan-500/30">V2 60FPS</span>
          </h2>
        </div>

        <div className="flex items-center gap-2">
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

        {/* Center Scanner Frame & Laser */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <div className="relative" style={{ width: '74vw', height: '74vw', maxWidth: '340px', maxHeight: '340px' }}>
            <div className="absolute top-0 left-0 w-8 h-8 border-t-[3px] border-l-[3px] border-cyan-400 rounded-tl-xl" />
            <div className="absolute top-0 right-0 w-8 h-8 border-t-[3px] border-r-[3px] border-cyan-400 rounded-tr-xl" />
            <div className="absolute bottom-0 left-0 w-8 h-8 border-b-[3px] border-l-[3px] border-cyan-400 rounded-bl-xl" />
            <div className="absolute bottom-0 right-0 w-8 h-8 border-b-[3px] border-r-[3px] border-cyan-400 rounded-br-xl" />

            {/* Laser Line */}
            <div className="absolute left-2 right-2 height-0.5 bg-cyan-400 shadow-[0_0_15px_#22d3ee] animate-pulse" style={{ top: '50%' }} />
          </div>
        </div>

        {/* Performance HUD Overlay */}
        {showStats && (
          <div className="absolute top-3 left-3 z-30 bg-slate-950/85 backdrop-blur-md border border-slate-800 rounded-xl p-2.5 text-[11px] font-mono text-slate-300 space-y-1">
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-500">FPS:</span>
              <span className="font-bold text-emerald-400">{fps}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-500">Decode:</span>
              <span className="font-bold text-cyan-400">{decodeTimeMs} ms</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-500">Scanned:</span>
              <span className="font-bold text-orange-400">{totalScanned}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-500">Batch Q:</span>
              <span className="font-bold text-amber-400">{queueSize}</span>
            </div>
          </div>
        )}

        {/* Error State */}
        {cameraError && (
          <div className="absolute inset-0 bg-slate-900/95 flex flex-col items-center justify-center p-6 text-center z-40">
            <AlertTriangle className="w-12 h-12 text-rose-500 mb-3" />
            <p className="text-sm font-semibold text-rose-200 mb-4">{cameraError}</p>
            <button
              onClick={onOpenManualSearch}
              className="px-5 py-2.5 bg-cyan-500 text-slate-950 font-bold rounded-xl text-sm"
            >
              Use Manual Search
            </button>
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
          <div className={`absolute inset-0 z-40 flex flex-col items-center justify-center p-6 text-center backdrop-blur-md transition-all ${
            lastScannedResult.status === 'SUCCESS' ? 'bg-emerald-950/90 text-emerald-200' :
            lastScannedResult.status === 'DUPLICATE' ? 'bg-amber-950/90 text-amber-200' :
            lastScannedResult.status === 'OFFLINE_QUEUED' ? 'bg-cyan-950/90 text-cyan-200' :
            'bg-rose-950/90 text-rose-200'
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
            ) : (
              <>
                <AlertTriangle className="w-14 h-14 text-amber-400 mb-2" />
                <h3 className="text-lg font-bold text-white">{lastScannedResult.message || lastScannedResult.status}</h3>
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
