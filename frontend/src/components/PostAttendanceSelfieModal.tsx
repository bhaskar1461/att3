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
  ChevronRight,
  Eye,
  Users,
  Sun,
  Maximize2
} from 'lucide-react';
import { apiRequest } from '../services/api';
import { getDeviceHeaders } from '../services/deviceCredential';
import {
  detectFaceInVideo,
  FaceDetectionResult,
  FaceStabilityBuffer,
  OvalBounds
} from '../utils/faceDetector';

export type SelfieState =
  | 'IDLE'
  | 'CAMERA_INITIALIZING'
  | 'CAMERA_PERMISSION_REQUESTING'
  | 'CAMERA_PERMISSION_DENIED'
  | 'CAMERA_PERMISSION_PERMANENTLY_DENIED'
  | 'CAMERA_READY'
  | 'FACE_DETECTING'
  | 'FACE_NOT_DETECTED'
  | 'FACE_DETECTED'
  | 'COUNTDOWN'
  | 'CAPTURING'
  | 'IMAGE_VALIDATING'
  | 'UPLOAD_PENDING'
  | 'UPLOAD_SUCCESS'
  | 'UPLOAD_FAILED'
  | 'COMPLETED';

interface PostAttendanceSelfieModalProps {
  attendanceId: number;
  sessionId?: number;
  rollNumber: string;
  studentName?: string;
  subjectName?: string;
  onComplete: () => void;
  onSkip?: () => void;
}

// Normalized oval boundaries for face alignment
const OVAL_BOUNDS: OvalBounds = {
  normCenterX: 0.5,
  normCenterY: 0.48,
  normWidth: 0.52,
  normHeight: 0.68,
};

// Platform detection for platform-adaptive visual polish
const isIOS =
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

const isAndroid =
  typeof navigator !== 'undefined' && /Android/.test(navigator.userAgent);

export const PostAttendanceSelfieModal: React.FC<PostAttendanceSelfieModalProps> = ({
  attendanceId,
  sessionId,
  rollNumber,
  studentName,
  subjectName,
  onComplete,
  onSkip,
}) => {
  // Authoritative State Machine
  const [selfieState, setSelfieState] = useState<SelfieState>('CAMERA_INITIALIZING');
  const selfieStateRef = useRef<SelfieState>('CAMERA_INITIALIZING');
  selfieStateRef.current = selfieState;

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [guidanceMessage, setGuidanceMessage] = useState<string>('Initializing front camera…');
  
  // Countdown & Visual Indicators
  const [countdownRemaining, setCountdownRemaining] = useState<number>(3);
  const [isFlashing, setIsFlashing] = useState<boolean>(false);
  const [isSkipping, setIsSkipping] = useState<boolean>(false);
  const [capturedPreview, setCapturedPreview] = useState<string | null>(null);
  const [detectionMetrics, setDetectionMetrics] = useState<FaceDetectionResult | null>(null);

  // Refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const countdownTimerRef = useRef<any>(null);
  const countdownStartTimeRef = useRef<number>(0);
  const detectionLoopRef = useRef<number | null>(null);
  const lastDetectionTimeRef = useRef<number>(0);
  const isDestroyedRef = useRef<boolean>(false);
  const stabilityBufferRef = useRef<FaceStabilityBuffer>(new FaceStabilityBuffer(3, 2));

  // Cross-platform subtle haptic feedback
  const triggerHaptic = useCallback((pattern: number | number[] = 15) => {
    try {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate(pattern);
      }
    } catch {}
  }, []);

  // Web Audio click sound (no external audio assets required)
  const playShutterSound = useCallback(() => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(920, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(180, ctx.currentTime + 0.09);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.09);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.09);
    } catch {}
  }, []);

  // Safe camera track teardown
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
      streamRef.current = null;
    }
    setStream(null);
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  // Cancellation of countdown when face is lost
  const cancelCountdown = useCallback((reason: string) => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setCountdownRemaining(3);
    setSelfieState('FACE_NOT_DETECTED');
    stabilityBufferRef.current.reset();
    setGuidanceMessage(reason || 'Face moved. Position your face inside the oval');
    triggerHaptic(isIOS ? [10, 40, 10] : [25, 30, 25]);
  }, [triggerHaptic]);

  // Upload selfie payload to backend
  const uploadSelfie = useCallback(async (blob: Blob) => {
    setSelfieState('UPLOAD_PENDING');
    setGuidanceMessage('Saving verification photo…');
    stopCamera();

    try {
      const formData = new FormData();
      const cleanName = (studentName || 'student').trim().replace(/[^a-zA-Z0-9]/g, '_');
      const filename = `${rollNumber}_${cleanName}_selfie.jpg`;
      
      // Clean single file submission (avoids duplicate appending)
      formData.append('file', blob, filename);
      if (sessionId) {
        formData.append('session_id', String(sessionId));
      }

      const token = localStorage.getItem('token');
      const targetId = attendanceId && attendanceId > 0 ? attendanceId : (sessionId || 0);
      const response = await fetch(`/api/v1/attendance/records/${targetId}/selfie`, {
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
        throw new Error(errJson.detail || 'Failed to archive verification selfie');
      }

      setSelfieState('UPLOAD_SUCCESS');
      setGuidanceMessage('Selfie submitted successfully ✓');
      triggerHaptic(isIOS ? [20, 60, 20] : [35, 50, 35]);

      // Graceful completion after brief confirmation
      setTimeout(() => {
        if (!isDestroyedRef.current) {
          setSelfieState('COMPLETED');
          onComplete();
        }
      }, 1500);
    } catch (err: any) {
      console.error('[Selfie Upload Error]:', err);
      setSelfieState('UPLOAD_FAILED');
      setErrorMessage(err.message || 'Network error while uploading photo.');
      setGuidanceMessage('Upload failed. Your attendance remains PRESENT.');
    }
  }, [attendanceId, sessionId, rollNumber, studentName, onComplete, stopCamera, triggerHaptic]);

  // Execute snapshot capture from front camera
  const executeCapture = useCallback(async () => {
    if (selfieStateRef.current === 'CAPTURING' || selfieStateRef.current === 'IMAGE_VALIDATING') return;
    
    setSelfieState('CAPTURING');
    setGuidanceMessage('Capturing photo…');
    setIsFlashing(true);
    playShutterSound();
    triggerHaptic(isIOS ? [40, 30, 40] : [60]);

    setTimeout(() => {
      setIsFlashing(false);
    }, 140);

    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      setSelfieState('UPLOAD_FAILED');
      setErrorMessage('Video frame was not readable at capture time.');
      return;
    }

    const vw = video.videoWidth;
    const vh = video.videoHeight;

    // Preserve high facial fidelity capped at 1080 to prevent massive upload payloads
    const maxDim = 1080;
    let targetW = vw;
    let targetH = vh;
    if (targetW > maxDim || targetH > maxDim) {
      if (targetW > targetH) {
        targetH = Math.round((targetH * maxDim) / targetW);
        targetW = maxDim;
      } else {
        targetW = Math.round((targetW * maxDim) / targetH);
        targetH = maxDim;
      }
    }

    const canvas = canvasRef.current || document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setSelfieState('UPLOAD_FAILED');
      setErrorMessage('Failed to initialize canvas drawing context.');
      return;
    }

    // Mirror user-facing camera for natural stored image
    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    ctx.restore();

    setSelfieState('IMAGE_VALIDATING');
    setGuidanceMessage('Checking photo quality…');

    canvas.toBlob(
      async (blob) => {
        if (!blob || blob.size === 0) {
          setSelfieState('UPLOAD_FAILED');
          setErrorMessage('Captured image frame was empty.');
          return;
        }

        if (blob.size > 5 * 1024 * 1024) {
          setSelfieState('UPLOAD_FAILED');
          setErrorMessage('Captured image exceeded 5MB size limit.');
          return;
        }

        const previewUrl = URL.createObjectURL(blob);
        setCapturedPreview(previewUrl);

        // Upload to backend
        await uploadSelfie(blob);
      },
      'image/jpeg',
      0.88
    );
  }, [playShutterSound, triggerHaptic, uploadSelfie]);

  // Start 3-second auto countdown when stable face is locked
  const startCountdown = useCallback(() => {
    if (selfieStateRef.current === 'COUNTDOWN' || selfieStateRef.current === 'CAPTURING') return;
    
    setSelfieState('COUNTDOWN');
    setCountdownRemaining(3);
    countdownStartTimeRef.current = Date.now();
    triggerHaptic(isIOS ? 20 : 30);

    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);

    countdownTimerRef.current = setInterval(() => {
      const elapsedSec = Math.floor((Date.now() - countdownStartTimeRef.current) / 1000);
      const remaining = 3 - elapsedSec;

      if (remaining > 0) {
        setCountdownRemaining(remaining);
        triggerHaptic(10);
      } else {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
        setCountdownRemaining(0);
        executeCapture();
      }
    }, 200);
  }, [triggerHaptic, executeCapture]);

  // Start front camera with 350ms sensor cooldown and defensive listener binding
  const startCamera = useCallback(async () => {
    setErrorMessage(null);
    setCapturedPreview(null);
    setCountdownRemaining(3);
    setSelfieState('CAMERA_INITIALIZING');
    setGuidanceMessage('Opening front camera…');
    stabilityBufferRef.current.reset();

    // MANDATORY SENSOR COOLDOWN:
    // Prevents NotReadableError contention on Android Camera2 HAL (Realme, Samsung, Xiaomi)
    // and iOS AVFoundation when transitioning from rear QR scanner.
    await new Promise((r) => setTimeout(r, 350));
    if (isDestroyedRef.current) return;

    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => {
          try {
            t.stop();
          } catch {}
        });
        streamRef.current = null;
      }

      setSelfieState('CAMERA_PERMISSION_REQUESTING');

      let mediaStream: MediaStream;
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'user' },
            width: { ideal: 1080 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
      } catch (idealErr) {
        // Fallback for devices rejecting exact resolution or ideal constraints
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' },
          audio: false,
        });
      }

      if (isDestroyedRef.current) {
        mediaStream.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = mediaStream;
      setStream(mediaStream);

      const video = videoRef.current;
      if (video) {
        video.playsInline = true;
        video.muted = true;
        video.autoplay = true;

        const onVideoActive = () => {
          setSelfieState('CAMERA_READY');
          setTimeout(() => {
            if (!isDestroyedRef.current) {
              setSelfieState('FACE_DETECTING');
              setGuidanceMessage('Position your face inside the oval');
            }
          }, 300);
        };

        // Bind listener BEFORE assigning srcObject to eliminate metadata race condition
        video.onloadedmetadata = () => {
          video.play().then(onVideoActive).catch((playErr) => {
            console.warn('[Selfie] Video play exception:', playErr);
            onVideoActive();
          });
        };

        video.srcObject = mediaStream;
      }
    } catch (err: any) {
      console.warn('[Selfie Camera Acquisition Failed]:', err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setSelfieState('CAMERA_PERMISSION_DENIED');
        setErrorMessage(
          'Front camera permission was denied. You can allow camera access or safely skip without losing your PRESENT status.'
        );
      } else {
        setSelfieState('CAMERA_PERMISSION_DENIED');
        setErrorMessage(
          'Front camera unavailable on this device. You may safely skip without losing your attendance.'
        );
      }
      setGuidanceMessage('Camera unavailable');
    }
  }, []);

  // Continuous face detection loop throttled to ~14 FPS (70ms)
  useEffect(() => {
    const runDetection = async (timestamp: number) => {
      if (isDestroyedRef.current) return;

      const currentState = selfieStateRef.current;
      const isDetectionActive =
        currentState === 'FACE_DETECTING' ||
        currentState === 'FACE_NOT_DETECTED' ||
        currentState === 'FACE_DETECTED' ||
        currentState === 'COUNTDOWN';

      if (
        isDetectionActive &&
        videoRef.current &&
        videoRef.current.readyState >= 2 &&
        timestamp - lastDetectionTimeRef.current >= 70
      ) {
        lastDetectionTimeRef.current = timestamp;

        try {
          const res = await detectFaceInVideo(videoRef.current, OVAL_BOUNDS);
          setDetectionMetrics(res);

          if (res.faceCount > 1) {
            // Quality gate: Multiple faces
            stabilityBufferRef.current.reset();
            if (currentState === 'COUNTDOWN') {
              cancelCountdown('Multiple faces visible');
            } else {
              setSelfieState('FACE_NOT_DETECTED');
            }
            setGuidanceMessage('Multiple faces visible. Ensure only your face is in frame.');
          } else if (!res.hasFace) {
            // Quality gate: No face
            stabilityBufferRef.current.reset();
            if (currentState === 'COUNTDOWN') {
              cancelCountdown('Face moved out of frame');
            } else {
              setSelfieState('FACE_NOT_DETECTED');
            }
            setGuidanceMessage('Position your face inside the oval');
          } else if (!res.isValid) {
            // Face present but fails centering, size, lighting, or blur criteria
            const { wasCancelled } = stabilityBufferRef.current.registerFrame(false);
            if (wasCancelled && currentState === 'COUNTDOWN') {
              cancelCountdown(res.message);
            }
            setGuidanceMessage(res.message);
          } else {
            // All quality criteria passed!
            const { isStable } = stabilityBufferRef.current.registerFrame(true);
            setGuidanceMessage('Face detected. Hold still…');

            if (isStable) {
              if (currentState === 'FACE_DETECTING' || currentState === 'FACE_NOT_DETECTED') {
                setSelfieState('FACE_DETECTED');
                startCountdown();
              }
            }
          }
        } catch (cvErr) {
          console.warn('[Face Detection Exception]:', cvErr);
        }
      }

      detectionLoopRef.current = requestAnimationFrame(runDetection);
    };

    detectionLoopRef.current = requestAnimationFrame(runDetection);

    return () => {
      if (detectionLoopRef.current) {
        cancelAnimationFrame(detectionLoopRef.current);
        detectionLoopRef.current = null;
      }
    };
  }, [cancelCountdown, startCountdown]);

  // Mount initialization & unmount teardown
  useEffect(() => {
    isDestroyedRef.current = false;
    startCamera();

    return () => {
      isDestroyedRef.current = true;
      stopCamera();
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
      if (detectionLoopRef.current) {
        cancelAnimationFrame(detectionLoopRef.current);
        detectionLoopRef.current = null;
      }
    };
  }, [startCamera, stopCamera]);

  // Decoupled skip handler: Attendance status NEVER reverts from PRESENT
  const handleSkip = async (reason: string = 'USER_SKIPPED') => {
    setIsSkipping(true);
    stopCamera();
    try {
      const targetId = attendanceId && attendanceId > 0 ? attendanceId : (sessionId || 0);
      await apiRequest(`/attendance/records/${targetId}/selfie-skip`, {
        method: 'POST',
        body: JSON.stringify({ reason, session_id: sessionId }),
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

  // Determine current oval border state and colors
  const isLocked = selfieState === 'FACE_DETECTED' || selfieState === 'COUNTDOWN';
  const isMultipleFaces = detectionMetrics && detectionMetrics.faceCount > 1;
  const isErrorState =
    selfieState === 'CAMERA_PERMISSION_DENIED' ||
    selfieState === 'CAMERA_PERMISSION_PERMANENTLY_DENIED' ||
    selfieState === 'UPLOAD_FAILED';

  return (
    <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-lg flex items-center justify-center p-3 select-none animate-in fade-in duration-200">
      <div className="bg-[#080d1a] border border-white/10 rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl p-5 text-center font-sans text-white relative">
        
        {/* Shutter White Flash Effect */}
        <div
          className={`absolute inset-0 bg-white pointer-events-none transition-opacity duration-150 z-40 ${
            isFlashing ? 'opacity-95' : 'opacity-0'
          }`}
        />

        {/* ── Top Header Bar ── */}
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2.5 text-left">
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="font-bold text-sm text-white">Attendance Confirmed</h3>
                <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                  PRESENT
                </span>
              </div>
              <p className="text-[11px] text-slate-400 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-cyan-400" />
                <span>Verification Selfie Capture</span>
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

        {/* ── Student Credential Badge ── */}
        <div className="mt-3 bg-white/5 border border-white/10 rounded-2xl p-2.5 flex items-center justify-between text-xs px-3">
          <div className="text-left">
            <span className="text-[9px] uppercase font-bold tracking-wider text-cyan-400 block">
              Student ID
            </span>
            <span className="font-mono font-bold text-slate-100">{rollNumber}</span>
            {studentName && (
              <span className="text-slate-300 ml-1.5 font-medium truncate max-w-[110px] inline-block align-bottom">
                ({studentName})
              </span>
            )}
          </div>
          {subjectName && (
            <div className="text-right">
              <span className="text-[9px] uppercase font-bold tracking-wider text-slate-400 block">
                Class
              </span>
              <span className="font-semibold text-slate-200 truncate max-w-[110px] inline-block">
                {subjectName}
              </span>
            </div>
          )}
        </div>

        {/* ── Main Viewport Area ── */}
        {selfieState === 'UPLOAD_SUCCESS' || selfieState === 'COMPLETED' ? (
          /* Success Screen */
          <div className="py-6 space-y-3 animate-in zoom-in-95 duration-300">
            <div className="w-20 h-20 bg-emerald-500/20 text-emerald-400 border-2 border-emerald-500/50 rounded-full flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/20">
              <ShieldCheck className="w-12 h-12 animate-bounce" />
            </div>
            <h4 className="font-black text-lg text-white">Selfie Verified & Archived!</h4>
            <p className="text-xs text-slate-300 max-w-xs mx-auto leading-relaxed">
              Biometric verification photo saved for roll number <strong className="text-emerald-400">{rollNumber}</strong>.
            </p>

            {capturedPreview && (
              <div className="pt-1 flex justify-center">
                <div className="w-20 h-24 rounded-2xl overflow-hidden border-2 border-emerald-400/80 shadow-md">
                  <img src={capturedPreview} alt="Selfie Preview" className="w-full h-full object-cover" />
                </div>
              </div>
            )}

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
        ) : isErrorState ? (
          /* Error & Permission Denial Screen */
          <div className="py-5 space-y-3">
            <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl text-center space-y-2 text-rose-200">
              <AlertCircle className="w-8 h-8 mx-auto text-rose-400" />
              <h5 className="font-bold text-xs text-rose-300">Camera Notice</h5>
              <p className="text-xs leading-relaxed">{errorMessage || 'Unable to access camera.'}</p>
            </div>

            <div className="space-y-2 pt-2">
              <button
                type="button"
                onClick={() => startCamera()}
                className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs rounded-xl shadow transition flex items-center justify-center gap-2 cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Retry Front Camera</span>
              </button>
              <button
                type="button"
                disabled={isSkipping}
                onClick={() => handleSkip('CAMERA_PERMISSION_DENIED')}
                className="w-full py-2.5 bg-white/10 hover:bg-white/15 text-slate-300 font-semibold text-xs rounded-xl transition cursor-pointer"
              >
                {isSkipping ? 'Finalizing Attendance…' : 'Skip Photo (Attendance Remains PRESENT)'}
              </button>
            </div>
          </div>
        ) : (
          /* ── Camera Viewfinder with Oval Face Reticle ── */
          <div className="space-y-3 mt-3">
            
            <div className="relative w-64 h-80 mx-auto flex items-center justify-center overflow-hidden rounded-3xl bg-slate-950 border border-white/10 shadow-inner">
              
              {/* Live Front Camera Video */}
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="absolute inset-0 w-full h-full object-cover -scale-x-100"
              />

              {/* ── Platform-Adaptive Oval Reticle ── */}
              <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center z-20">
                
                {/* Oval Mask Frame */}
                <div
                  className={`relative w-48 h-64 rounded-[100px] transition-all duration-300 ${
                    isLocked
                      ? isIOS
                        ? 'border-4 border-emerald-400 shadow-[0_0_25px_rgba(52,211,153,0.6)]'
                        : 'border-4 border-emerald-400 shadow-[0_0_20px_rgba(52,211,153,0.5)]'
                      : isMultipleFaces
                      ? 'border-4 border-rose-500 shadow-[0_0_20px_rgba(244,63,94,0.5)] animate-pulse'
                      : isIOS
                      ? 'border-2 border-cyan-400/80 shadow-[0_0_15px_rgba(6,182,212,0.3)]'
                      : 'border-2 border-dashed border-cyan-400/70'
                  }`}
                >
                  {/* iOS Style: Subtle Face-ID-inspired sweep beam across oval */}
                  {isIOS && !isLocked && !isMultipleFaces && (
                    <div className="absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-cyan-300 to-transparent blur-xs animate-[bounce_2.5s_infinite] opacity-75" />
                  )}

                  {/* Android Style: Material pulsating radar ripple */}
                  {isAndroid && !isLocked && (
                    <div className="absolute inset-0 rounded-[100px] border border-cyan-400/30 animate-ping" />
                  )}

                  {/* Corner Accent Guides */}
                  <div className="absolute -top-1 -left-1 w-4 h-4 border-t-2 border-l-2 border-white/60 rounded-tl-lg" />
                  <div className="absolute -top-1 -right-1 w-4 h-4 border-t-2 border-r-2 border-white/60 rounded-tr-lg" />
                  <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-2 border-l-2 border-white/60 rounded-bl-lg" />
                  <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 border-white/60 rounded-br-lg" />
                </div>

                {/* Large 3-2-1 Countdown Animation Overlay */}
                {selfieState === 'COUNTDOWN' && (
                  <div className="absolute inset-0 bg-black/25 backdrop-blur-[1px] flex flex-col items-center justify-center z-30">
                    <div className="w-20 h-20 rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center shadow-lg shadow-emerald-500/30">
                      <span className="font-mono font-black text-5xl text-white drop-shadow-md animate-pulse">
                        {countdownRemaining}
                      </span>
                    </div>
                    <span className="mt-2 text-xs font-bold uppercase tracking-wider text-emerald-300 bg-black/60 px-3 py-1 rounded-full">
                      Hold Still…
                    </span>
                  </div>
                )}

                {/* Capturing Status */}
                {selfieState === 'CAPTURING' && (
                  <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center space-y-1 z-30">
                    <Zap className="w-10 h-10 text-amber-400 animate-bounce" />
                    <span className="font-mono font-black text-sm tracking-wider text-amber-300">
                      CAPTURING…
                    </span>
                  </div>
                )}

                {/* Uploading Status */}
                {selfieState === 'UPLOAD_PENDING' && (
                  <div className="absolute inset-0 bg-black/60 backdrop-blur-xs flex flex-col items-center justify-center space-y-2 z-30">
                    <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin" />
                    <span className="font-bold text-xs text-cyan-300">Archiving Selfie…</span>
                  </div>
                )}
              </div>

              {/* Status Pill Badge at Viewfinder Bottom */}
              <div className="absolute bottom-3 inset-x-3 z-30 flex justify-center">
                <div
                  className={`px-3 py-1.5 rounded-full text-[11px] font-bold shadow-lg backdrop-blur-md transition-all flex items-center gap-1.5 ${
                    isLocked
                      ? 'bg-emerald-500/90 text-white'
                      : isMultipleFaces
                      ? 'bg-rose-600/90 text-white'
                      : 'bg-black/75 text-slate-200 border border-white/20'
                  }`}
                >
                  {isLocked ? (
                    <Check className="w-3.5 h-3.5 text-white" />
                  ) : isMultipleFaces ? (
                    <Users className="w-3.5 h-3.5 text-white" />
                  ) : (
                    <Eye className="w-3.5 h-3.5 text-cyan-400" />
                  )}
                  <span>{guidanceMessage}</span>
                </div>
              </div>
            </div>

            {/* Hidden canvas for snapshot rasterization */}
            <canvas ref={canvasRef} className="hidden" />

            {/* Subtle Platform UX Indicator */}
            <div className="flex items-center justify-between px-1 text-[11px] text-slate-400">
              <span className="flex items-center gap-1">
                {isIOS ? 'Face-Scan UX' : isAndroid ? 'Material Motion' : 'Auto Face Gate'}
              </span>
              <span className="font-mono text-[10px] text-slate-400">
                {selfieState === 'COUNTDOWN'
                  ? `Capture in ${countdownRemaining}s`
                  : isLocked
                  ? 'Face Locked'
                  : 'Waiting for face'}
              </span>
            </div>

            {/* Bottom Actions: Retake / Skip */}
            <div className="pt-2 flex items-center justify-between text-xs border-t border-white/10">
              <button
                type="button"
                onClick={() => startCamera()}
                className="text-slate-400 hover:text-white flex items-center gap-1 transition cursor-pointer"
                title="Reset Camera"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Camera</span>
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
