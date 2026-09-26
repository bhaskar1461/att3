import { useState, useRef, useEffect, useCallback } from 'react';
import { apiRequest } from '../../../services/api';
import { getDeviceHeaders } from '../../../services/deviceCredential';
import {
  detectFaceInVideo,
  FaceDetectionResult,
  FaceStabilityBuffer,
  OvalBounds
} from '../../../utils/faceDetector';

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

export const OVAL_BOUNDS: OvalBounds = {
  normCenterX: 0.5,
  normCenterY: 0.48,
  normWidth: 0.52,
  normHeight: 0.68,
};

const isIOS =
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

interface UseSelfieCaptureOptions {
  attendanceId: number;
  sessionId?: number;
  rollNumber: string;
  onComplete: () => void;
  onSkip?: () => void;
}

export function useSelfieCapture({
  attendanceId,
  sessionId,
  rollNumber,
  onComplete,
  onSkip,
}: UseSelfieCaptureOptions) {
  const [selfieState, setSelfieState] = useState<SelfieState>('CAMERA_INITIALIZING');
  const selfieStateRef = useRef<SelfieState>('CAMERA_INITIALIZING');
  selfieStateRef.current = selfieState;

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [guidanceMessage, setGuidanceMessage] = useState<string>('Initializing front camera…');
  const [countdownRemaining, setCountdownRemaining] = useState<number>(3);
  const [isFlashing, setIsFlashing] = useState<boolean>(false);
  const [isSkipping, setIsSkipping] = useState<boolean>(false);
  const [capturedPreview, setCapturedPreview] = useState<string | null>(null);
  const [detectionMetrics, setDetectionMetrics] = useState<FaceDetectionResult | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectionLoopRef = useRef<number | null>(null);
  const countdownTimerRef = useRef<any>(null);
  const countdownStartTimeRef = useRef<number>(0);
  const stabilityBufferRef = useRef<FaceStabilityBuffer>(new FaceStabilityBuffer(5, 0.7));
  const isDestroyedRef = useRef<boolean>(false);
  const lastDetectionTimeRef = useRef<number>(0);

  const triggerHaptic = useCallback((ms: number = 20) => {
    try {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate(ms);
      }
    } catch {}
  }, []);

  const playShutterSound = useCallback(() => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(220, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.08);
    } catch {}
  }, []);

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

  const uploadSelfie = useCallback(
    async (base64Image: string) => {
      setSelfieState('UPLOAD_PENDING');
      setGuidanceMessage('Saving verification photo…');

      try {
        const deviceHeaders = getDeviceHeaders();
        const targetId = attendanceId && attendanceId > 0 ? attendanceId : (sessionId || 0);

        await apiRequest(`/attendance/records/${targetId}/selfie-audit`, {
          method: 'POST',
          headers: {
            ...deviceHeaders,
          },
          body: JSON.stringify({
            image_b64: base64Image,
            roll_number: rollNumber,
            session_id: sessionId,
            detected_face_count: detectionMetrics?.faceCount || 1,
            liveness_score: detectionMetrics?.confidence || 0.95,
          }),
        });

        setSelfieState('UPLOAD_SUCCESS');
        setGuidanceMessage('Selfie verified & recorded!');
        triggerHaptic(50);

        setTimeout(() => {
          if (!isDestroyedRef.current) {
            setSelfieState('COMPLETED');
            stopCamera();
            onComplete();
          }
        }, 1200);
      } catch (err: any) {
        console.warn('[Selfie Upload Warning]:', err);
        setSelfieState('UPLOAD_FAILED');
        setErrorMessage(
          err.message || 'Photo upload encountered a network issue. You can retry or complete without re-upload.'
        );
        setGuidanceMessage('Upload failed');
      }
    },
    [attendanceId, sessionId, rollNumber, detectionMetrics, triggerHaptic, stopCamera, onComplete]
  );

  const executeCapture = useCallback(() => {
    if (isDestroyedRef.current || !videoRef.current || !canvasRef.current) return;

    setSelfieState('CAPTURING');
    setIsFlashing(true);
    playShutterSound();
    triggerHaptic(40);
    setTimeout(() => setIsFlashing(false), 200);

    const video = videoRef.current;
    const canvas = canvasRef.current;

    const size = Math.min(video.videoWidth || 640, video.videoHeight || 640);
    canvas.width = Math.min(size, 720);
    canvas.height = Math.min(size, 720);

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const sx = Math.max(0, (video.videoWidth - size) / 2);
    const sy = Math.max(0, (video.videoHeight - size) / 2);

    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, size, size, 0, 0, canvas.width, canvas.height);
    ctx.restore();

    setSelfieState('IMAGE_VALIDATING');
    setGuidanceMessage('Optimizing photo…');

    let quality = 0.82;
    let dataUrl = canvas.toDataURL('image/jpeg', quality);
    if (dataUrl.length > 400000) {
      quality = 0.65;
      dataUrl = canvas.toDataURL('image/jpeg', quality);
    }

    setCapturedPreview(dataUrl);
    uploadSelfie(dataUrl);
  }, [playShutterSound, triggerHaptic, uploadSelfie]);

  const cancelCountdown = useCallback(
    (reason: string) => {
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
      setCountdownRemaining(3);
      setSelfieState('FACE_NOT_DETECTED');
      setGuidanceMessage(reason || 'Position face within oval');
      stabilityBufferRef.current.reset();
    },
    []
  );

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

  const startCamera = useCallback(async () => {
    setErrorMessage(null);
    setCapturedPreview(null);
    setCountdownRemaining(3);
    setSelfieState('CAMERA_INITIALIZING');
    setGuidanceMessage('Opening front camera…');
    stabilityBufferRef.current.reset();

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
      } catch {
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

        video.onloadedmetadata = () => {
          video.play().then(onVideoActive).catch(() => {
            onVideoActive();
          });
        };

        video.srcObject = mediaStream;
      }
    } catch (err: any) {
      console.warn('[Selfie Camera Acquisition Failed]:', err);
      setSelfieState('CAMERA_PERMISSION_DENIED');
      setErrorMessage(
        'Front camera unavailable or permission denied. You may safely skip without losing your attendance.'
      );
      setGuidanceMessage('Camera unavailable');
    }
  }, []);

  // Face detection loop
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
            stabilityBufferRef.current.reset();
            if (currentState === 'COUNTDOWN') {
              cancelCountdown('Multiple faces visible');
            } else {
              setSelfieState('FACE_NOT_DETECTED');
            }
            setGuidanceMessage('Multiple faces visible. Ensure only your face is in frame.');
          } else if (!res.hasFace) {
            stabilityBufferRef.current.reset();
            if (currentState === 'COUNTDOWN') {
              cancelCountdown('Face moved out of frame');
            } else {
              setSelfieState('FACE_NOT_DETECTED');
            }
            setGuidanceMessage('Position your face inside the oval');
          } else if (!res.isValid) {
            const { wasCancelled } = stabilityBufferRef.current.registerFrame(false);
            if (wasCancelled && currentState === 'COUNTDOWN') {
              cancelCountdown(res.message);
            }
            setGuidanceMessage(res.message);
          } else {
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

  return {
    selfieState,
    stream,
    errorMessage,
    guidanceMessage,
    countdownRemaining,
    isFlashing,
    isSkipping,
    capturedPreview,
    detectionMetrics,
    videoRef,
    canvasRef,
    startCamera,
    stopCamera,
    executeCapture,
    handleSkip,
  };
}
