import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Camera, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw, 
  X, 
  ShieldCheck, 
  Sparkles, 
  Zap, 
  Check, 
  RotateCcw,
  Layers,
  ChevronRight
} from 'lucide-react';
import { apiRequest } from '../services/api';
import { getDeviceHeaders } from '../services/deviceCredential';

interface PostAttendanceSelfieModalProps {
  attendanceId: number;
  rollNumber: string;
  studentName?: string;
  subjectName?: string;
  onComplete: () => void;
  onSkip?: () => void;
}

type CaptureStage = 'INITIALIZING' | 'COUNTDOWN' | 'BURST_CAPTURING' | 'UPLOADING' | 'SUCCESS' | 'ERROR';

const TOTAL_BURST_FRAMES = 3;
const COUNTDOWN_SECONDS = 3;

export const PostAttendanceSelfieModal: React.FC<PostAttendanceSelfieModalProps> = ({
  attendanceId,
  rollNumber,
  studentName,
  subjectName,
  onComplete,
  onSkip
}) => {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [captureStage, setCaptureStage] = useState<CaptureStage>('INITIALIZING');
  
  // Timer ring and countdown
  const [countdownRemaining, setCountdownRemaining] = useState<number>(COUNTDOWN_SECONDS);
  const [ringProgress, setRingProgress] = useState<number>(0); // 0 to 1
  
  // Multi-frame captures
  const [capturedFrames, setCapturedFrames] = useState<string[]>([]);
  const [currentFrameIndex, setCurrentFrameIndex] = useState<number>(0);
  const [isFlashing, setIsFlashing] = useState<boolean>(false);
  const [isSkipping, setIsSkipping] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const countdownIntervalRef = useRef<any>(null);
  const animationFrameRef = useRef<number | null>(null);
  const isCapturingRef = useRef<boolean>(false);

  // Play subtle shutter click via Web Audio API (cross-platform, zero dependencies)
  const playShutterSound = useCallback(() => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(220, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.08);
    } catch {}
  }, []);

  // Stop active camera stream
  const stopCamera = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach(track => {
        try { track.stop(); } catch {}
      });
      setStream(null);
    }
  }, [stream]);

  // Capture single frame from user video to canvas
  const grabFrame = useCallback((): string | null => {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 640;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Mirror image for user-facing camera
    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    ctx.restore();

    return canvas.toDataURL('image/jpeg', 0.88);
  }, []);

  // Start front selfie camera automatically
  const startCamera = useCallback(async () => {
    setCameraError(null);
    setUploadError(null);
    setCapturedFrames([]);
    setCurrentFrameIndex(0);
    setRingProgress(0);
    setCountdownRemaining(COUNTDOWN_SECONDS);
    setCaptureStage('INITIALIZING');
    isCapturingRef.current = false;

    try {
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
      }
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 720 },
          height: { ideal: 720 }
        },
        audio: false
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        videoRef.current.onloadedmetadata = () => {
          try {
            videoRef.current?.play();
          } catch {}
          // Transition to COUNTDOWN after 600ms visual buffer
          setTimeout(() => {
            setCaptureStage('COUNTDOWN');
          }, 600);
        };
      }
    } catch (err: any) {
      console.warn('[PostAttendanceSelfie] Front camera acquisition failed:', err);
      setCameraError(
        err.name === 'NotAllowedError'
          ? 'Front camera permission denied. You can skip photo verification without losing your PRESENT status.'
          : 'Front selfie camera unavailable on this device. You may safely skip.'
      );
      setCaptureStage('ERROR');
    }
  }, [stream]);

  // Initialize camera on mount and teardown on unmount
  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, []);

  // Upload multi-frame burst to backend storage
  const uploadBurstSelfies = useCallback(async (frames: string[]) => {
    if (frames.length === 0) return;
    setCaptureStage('UPLOADING');
    stopCamera();

    try {
      const formData = new FormData();
      const cleanName = (studentName || 'student').trim().replace(/[^a-zA-Z0-9]/g, '_');
      
      // Convert all frames to blobs and append
      for (let i = 0; i < frames.length; i++) {
        const frameRes = await fetch(frames[i]);
        const blob = await frameRes.blob();
        const filename = `${rollNumber}_${cleanName}_f${i + 1}.jpg`;
        formData.append('files', blob, filename);
        if (i === 0) {
          // Backward compatibility for legacy single-file endpoint handlers
          formData.append('file', blob, filename);
        }
      }

      formData.append('total_frames', String(frames.length));

      const token = localStorage.getItem('token');
      const response = await fetch(`/api/v1/attendance/records/${attendanceId}/selfie`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          ...getDeviceHeaders(),
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: formData
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.detail || 'Failed to archive burst photos to training storage');
      }

      setCaptureStage('SUCCESS');
      // Auto-complete after 1.8 seconds so student sees the success confirmation
      setTimeout(() => {
        onComplete();
      }, 1800);
    } catch (err: any) {
      console.error('[Selfie Upload Error]:', err);
      setUploadError(err.message || 'Network error during upload');
      setCaptureStage('ERROR');
    }
  }, [attendanceId, rollNumber, studentName, onComplete, stopCamera]);

  // Execute rapid 3-frame burst capture sequence
  const startBurstCapture = useCallback(async () => {
    if (isCapturingRef.current) return;
    isCapturingRef.current = true;
    setCaptureStage('BURST_CAPTURING');

    const frames: string[] = [];
    const BURST_INTERVAL_MS = 380; // 380ms between frames provides natural micro-variation for dataset

    for (let i = 0; i < TOTAL_BURST_FRAMES; i++) {
      setCurrentFrameIndex(i + 1);
      
      // Flash effect & shutter click
      setIsFlashing(true);
      playShutterSound();
      
      const frameData = grabFrame();
      if (frameData) {
        frames.push(frameData);
        setCapturedFrames([...frames]);
      }

      await new Promise(r => setTimeout(r, 120));
      setIsFlashing(false);

      if (i < TOTAL_BURST_FRAMES - 1) {
        await new Promise(r => setTimeout(r, BURST_INTERVAL_MS - 120));
      }
    }

    // Complete burst and proceed to upload
    await uploadBurstSelfies(frames);
  }, [grabFrame, playShutterSound, uploadBurstSelfies]);

  // Countdown timer logic with smooth radial ring progress
  useEffect(() => {
    if (captureStage !== 'COUNTDOWN') return;

    const startTime = Date.now();
    const durationMs = COUNTDOWN_SECONDS * 1000;

    const tick = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(1, elapsed / durationMs);
      setRingProgress(progress);

      const remaining = Math.max(1, Math.ceil((durationMs - elapsed) / 1000));
      setCountdownRemaining(remaining);

      if (elapsed < durationMs) {
        animationFrameRef.current = requestAnimationFrame(tick);
      } else {
        setRingProgress(1);
        startBurstCapture();
      }
    };

    animationFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [captureStage, startBurstCapture]);

  // Handle user or camera error skip (Strict Rule: NEVER revokes PRESENT status)
  const handleSkip = async (reason: string = 'USER_SKIPPED') => {
    setIsSkipping(true);
    stopCamera();
    try {
      await apiRequest(`/attendance/records/${attendanceId}/selfie-skip`, {
        method: 'POST',
        body: JSON.stringify({ reason })
      });
    } catch (err) {
      console.warn('[Selfie Skip Notice]:', err);
    } finally {
      setIsSkipping(false);
      if (onSkip) {
        onSkip();
      } else {
        onComplete();
      }
    }
  };

  // Radial Timer Ring SVG Calculations
  const RADIUS = 46;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  const strokeDashoffset = CIRCUMFERENCE * (1 - ringProgress);

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 select-none animate-in fade-in duration-200">
      <div className="bg-[#0b1329] border border-white/10 rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl p-5 text-center space-y-4 font-sans text-white relative">
        
        {/* Shutter White Flash Overlay */}
        <div 
          className={`absolute inset-0 bg-white pointer-events-none transition-opacity duration-150 z-40 ${
            isFlashing ? 'opacity-90' : 'opacity-0'
          }`} 
        />

        {/* Top Header Bar */}
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2 text-left">
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="font-bold text-sm text-white">Attendance Confirmed</h3>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  PRESENT
                </span>
              </div>
              <p className="text-[11px] text-slate-400 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-cyan-400" />
                AI Face Model Dataset Enrollment
              </p>
            </div>
          </div>
          
          <button
            type="button"
            onClick={() => handleSkip('USER_CLOSED')}
            className="p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
            title="Skip photo verification"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Student Credential Badge */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-2.5 flex items-center justify-between text-xs px-3">
          <div className="text-left">
            <span className="text-[10px] uppercase font-bold tracking-wider text-cyan-400 block">Student Identity</span>
            <span className="font-mono font-bold text-slate-100">{rollNumber}</span>
            {studentName && <span className="text-slate-300 ml-1.5 font-medium">({studentName})</span>}
          </div>
          {subjectName && (
            <div className="text-right">
              <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block">Class</span>
              <span className="font-semibold text-slate-200 truncate max-w-[120px] inline-block">{subjectName}</span>
            </div>
          )}
        </div>

        {/* ── Main Viewport Area ── */}
        {captureStage === 'SUCCESS' ? (
          <div className="py-6 space-y-3 animate-in zoom-in-95 duration-300">
            <div className="w-20 h-20 bg-emerald-500/20 text-emerald-400 border-2 border-emerald-500/40 rounded-full flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/20">
              <ShieldCheck className="w-12 h-12 animate-bounce" />
            </div>
            <h4 className="font-black text-lg text-white">Dataset Photos Archived!</h4>
            <p className="text-xs text-slate-300 max-w-xs mx-auto leading-relaxed">
              {TOTAL_BURST_FRAMES} biometric burst frames saved under roll number <strong className="text-emerald-400">{rollNumber}</strong> for model training.
            </p>
            
            {/* Captured Frames Thumbnail Row */}
            <div className="flex justify-center gap-2 pt-2">
              {capturedFrames.map((img, idx) => (
                <div key={idx} className="relative w-16 h-16 rounded-xl overflow-hidden border border-emerald-400/60 shadow-md">
                  <img src={img} alt={`Burst ${idx + 1}`} className="w-full h-full object-cover" />
                  <span className="absolute bottom-0 right-0 px-1 bg-black/70 text-[9px] font-bold text-emerald-300">
                    f{idx + 1}
                  </span>
                </div>
              ))}
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={onComplete}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-lg transition flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span>Done</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : cameraError || captureStage === 'ERROR' ? (
          /* Error / Camera Fallback Screen */
          <div className="py-4 space-y-3">
            <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl text-center space-y-2 text-rose-200">
              <AlertCircle className="w-8 h-8 mx-auto text-rose-400" />
              <p className="text-xs leading-relaxed">{cameraError || uploadError || 'Unable to access camera.'}</p>
            </div>

            <div className="space-y-2 pt-2">
              <button
                type="button"
                onClick={() => startCamera()}
                className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs rounded-2xl shadow transition flex items-center justify-center gap-2 cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Retry Front Camera</span>
              </button>
              <button
                type="button"
                disabled={isSkipping}
                onClick={() => handleSkip('CAMERA_UNAVAILABLE')}
                className="w-full py-2.5 bg-white/10 hover:bg-white/15 text-slate-300 font-semibold text-xs rounded-xl transition cursor-pointer"
              >
                {isSkipping ? 'Finalizing Attendance…' : 'Skip Photo Step (Attendance Remains PRESENT)'}
              </button>
            </div>
          </div>
        ) : (
          /* ── Camera Viewfinder with Circular Animated Timer Ring ── */
          <div className="space-y-3">
            <div className="relative w-64 h-64 mx-auto flex items-center justify-center">
              
              {/* Circular SVG Timer Ring */}
              <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none z-20" viewBox="0 0 100 100">
                <defs>
                  <linearGradient id="timerRingGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#06b6d4" />
                    <stop offset="50%" stopColor="#10b981" />
                    <stop offset="100%" stopColor="#3b82f6" />
                  </linearGradient>
                </defs>
                {/* Background Ring Track */}
                <circle
                  cx="50"
                  cy="50"
                  r={RADIUS}
                  fill="none"
                  stroke="rgba(255, 255, 255, 0.12)"
                  strokeWidth="4.5"
                />
                {/* Active Animated Countdown Ring */}
                <circle
                  cx="50"
                  cy="50"
                  r={RADIUS}
                  fill="none"
                  stroke="url(#timerRingGradient)"
                  strokeWidth="4.5"
                  strokeLinecap="round"
                  strokeDasharray={CIRCUMFERENCE}
                  strokeDashoffset={strokeDashoffset}
                  className="transition-all duration-75"
                />
              </svg>

              {/* Circular Video Camera Feed */}
              <div className="w-[214px] h-[214px] rounded-full overflow-hidden bg-slate-950 border-2 border-white/20 shadow-inner flex items-center justify-center relative z-10">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover -scale-x-100"
                />

                {/* Biometric Face Guide Reticle */}
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <div className="w-32 h-40 border-2 border-dashed border-cyan-400/40 rounded-[50px] animate-pulse" />
                </div>

                {/* Countdown Large Number Overlay */}
                {captureStage === 'COUNTDOWN' && (
                  <div className="absolute inset-0 bg-black/30 backdrop-blur-xs flex items-center justify-center">
                    <span className="font-mono font-black text-6xl text-white drop-shadow-[0_4px_12px_rgba(0,0,0,0.8)] animate-ping">
                      {countdownRemaining}
                    </span>
                  </div>
                )}

                {/* Burst Capturing Status Overlay */}
                {captureStage === 'BURST_CAPTURING' && (
                  <div className="absolute inset-0 bg-black/40 backdrop-blur-xs flex flex-col items-center justify-center space-y-1">
                    <Zap className="w-8 h-8 text-amber-400 animate-bounce" />
                    <span className="font-mono font-black text-sm tracking-wider text-amber-300">
                      CAPTURING {currentFrameIndex}/{TOTAL_BURST_FRAMES}
                    </span>
                  </div>
                )}

                {/* Uploading Status Overlay */}
                {captureStage === 'UPLOADING' && (
                  <div className="absolute inset-0 bg-black/60 backdrop-blur-xs flex flex-col items-center justify-center space-y-2">
                    <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin" />
                    <span className="font-bold text-xs text-cyan-300">
                      Saving to Training Storage…
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Hidden canvas for video frame extraction */}
            <canvas ref={canvasRef} className="hidden" />

            {/* Frame Indicator Pill & Instructions */}
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-center gap-2">
                {Array.from({ length: TOTAL_BURST_FRAMES }).map((_, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold transition-all ${
                      capturedFrames.length > i
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        : i === currentFrameIndex - 1 && captureStage === 'BURST_CAPTURING'
                        ? 'bg-amber-500/30 text-amber-300 border border-amber-500/50 animate-pulse'
                        : 'bg-white/5 text-slate-500 border border-white/10'
                    }`}
                  >
                    {capturedFrames.length > i ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Camera className="w-3 h-3" />
                    )}
                    <span>Frame {i + 1}</span>
                  </div>
                ))}
              </div>

              <p className="text-[11px] text-slate-400 leading-tight">
                {captureStage === 'INITIALIZING' && 'Initializing front selfie camera…'}
                {captureStage === 'COUNTDOWN' && 'Center your face inside the circle. Capturing automatically…'}
                {captureStage === 'BURST_CAPTURING' && 'Hold still! Taking rapid burst frames…'}
                {captureStage === 'UPLOADING' && 'Encoding frames and cataloging dataset records…'}
              </p>
            </div>

            {/* Bottom Actions: Retake / Skip */}
            <div className="pt-2 flex items-center justify-between text-xs border-t border-white/10">
              <button
                type="button"
                onClick={() => startCamera()}
                className="text-slate-400 hover:text-white flex items-center gap-1 transition cursor-pointer"
                title="Restart countdown"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Restart Timer</span>
              </button>

              <button
                type="button"
                disabled={isSkipping}
                onClick={() => handleSkip('USER_SKIPPED')}
                className="text-slate-400 hover:text-amber-400 transition cursor-pointer"
              >
                Skip Photo
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
