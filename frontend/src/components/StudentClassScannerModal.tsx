import React, { useEffect, useRef, useState, useCallback } from 'react';
import jsQR from 'jsqr';
import { 
  X, Camera, CheckCircle, AlertTriangle, RefreshCw,
  Clock, WifiOff, Flashlight, ZoomIn, ZoomOut, Sliders
} from 'lucide-react';
import { apiRequest } from '../services/api';
import { getOrCreateDeviceCredentials } from '../services/deviceCredential';
import { PwaInstallGuard } from './PwaInstallGuard';
import { scannerTelemetry } from '../services/scannerTelemetry';
import { FailureErrorType, DisplayType, TokenFormat } from '../types/telemetry';

interface StudentClassScannerModalProps {
  onClose: () => void;
  onScanComplete: () => void;
  displayType?: DisplayType;
}

export const StudentClassScannerModal: React.FC<StudentClassScannerModalProps> = ({
  onClose,
  onScanComplete,
  displayType = 'projector'
}) => {
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [successResult, setSuccessResult] = useState<any>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState<boolean>(!navigator.onLine);
  const [qrExpiredCountdown, setQrExpiredCountdown] = useState<number | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');

  // Dynamic Camera Capabilities
  const [hasZoomCapability, setHasZoomCapability] = useState<boolean>(false);
  const [zoomRange, setZoomRange] = useState<{ min: number; max: number; step: number }>({ min: 1, max: 1, step: 0.1 });
  const [currentZoom, setCurrentZoom] = useState<number>(1);
  const [autoZoomEnabled, setAutoZoomEnabled] = useState<boolean>(true);
  const [hasTorchCapability, setHasTorchCapability] = useState<boolean>(false);
  const [torchActive, setTorchActive] = useState<boolean>(false);

  // Dynamic Visual Guidance Text (Honesty Rule)
  const [guideText, setGuideText] = useState<string>('Point your camera at the attendance QR');
  const [permissionState, setPermissionState] = useState<'prompt' | 'granted' | 'denied' | 'unknown'>('unknown');
  const [isSteadying, setIsSteadying] = useState<boolean>(false);
  const [activeLadderRung, setActiveLadderRung] = useState<number>(1);
  const hasSoftRestartedRef = useRef<boolean>(false);

  // Strict Single-Instance Refs (No Memory Leaks / No Zombie Loops)
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);
  const isScanningLockedRef = useRef<boolean>(false);
  const barcodeDetectorRef = useRef<any>(null);
  const wakeLockRef = useRef<any>(null);

  // Decode Throttling & Auto-Zoom Timing Refs (~8-10 fps execution)
  const lastDecodeTimeRef = useRef<number>(0);
  const scanStartTimeRef = useRef<number>(Date.now());
  const DECODE_INTERVAL_MS = 110; // Throttle to ~9 fps to ensure low-end chipset friendliness

  // Touch gesture pinch-to-zoom tracking
  const pinchStartDistanceRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef<number>(1);

  // Scan Funnel Telemetry Refs (Week 1 Instrumentation)
  const pageOpenTimeRef = useRef<number>(Date.now());
  const permissionReqTimeRef = useRef<number>(0);
  const cameraOpenTimeRef = useRef<number>(0);
  const firstFrameTimeRef = useRef<number>(0);
  const frameDecodedTimeRef = useRef<number>(0);
  const tokenSubmitTimeRef = useRef<number>(0);
  const attemptCountRef = useRef<number>(1);
  const hasCapturedFirstFrameRef = useRef<boolean>(false);
  const decodeWatchdogTimerRef = useRef<any>(null);
  const sessionIdRef = useRef<string>('');

  // Funnel Stage: scan_page_opened
  useEffect(() => {
    scannerTelemetry.recordStage('scan_page_opened', undefined, undefined, undefined, displayType);
  }, []);

  // Online/Offline network state listener
  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Live QR expiry countdown ticker
  useEffect(() => {
    if (qrExpiredCountdown === null || qrExpiredCountdown <= 0) return;
    const timer = setInterval(() => {
      setQrExpiredCountdown((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(timer);
          isScanningLockedRef.current = false;
          setIsSubmitting(false);
          return null;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [qrExpiredCountdown]);

  // Sound and Haptic feedback: 2 short pulses for success, 3 distinct pulses for error
  const triggerFeedback = (isSuccess: boolean) => {
    try {
      if (navigator.vibrate) {
        navigator.vibrate(isSuccess ? [100, 50, 100] : [150, 80, 150, 80, 200]);
      }
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = isSuccess ? 'sine' : 'sawtooth';
      osc.frequency.setValueAtTime(isSuccess ? 880 : 220, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + (isSuccess ? 0.2 : 0.4));
    } catch {}
  };

  const handleScanSuccess = async (decodedText: string) => {
    if (isScanningLockedRef.current || isSubmitting) return;

    const trimmed = decodedText.trim();
    // Dual-format detection: Legacy (SNIST-SES| or S|) vs Short (?s=...&v=...)
    const isLegacy = trimmed.startsWith('SNIST-SES|') || trimmed.startsWith('S|') || trimmed.includes('token=SNIST-SES');
    const isShort = (trimmed.includes('s=') && trimmed.includes('v=')) ||
                    /^[0-9A-HJ-NP-Za-km-z]{6,12}[:|][0-9]+$/i.test(trimmed) ||
                    /^\?s=[0-9A-HJ-NP-Za-km-z]{6,12}&v=[0-9]+$/i.test(trimmed);

    if (!isLegacy && !isShort) {
      return;
    }

    const detectedFormat: TokenFormat = isShort ? 'short' : 'legacy';

    if (decodeWatchdogTimerRef.current) {
      clearTimeout(decodeWatchdogTimerRef.current);
      decodeWatchdogTimerRef.current = null;
    }

    // Extract session preview from token
    let sessionPreview: string | undefined = undefined;
    if (isLegacy) {
      const parts = trimmed.split('|');
      sessionPreview = parts.length > 1 ? `SES_${parts[1]}` : undefined;
    } else {
      const sMatch = trimmed.match(/[?&]s=([0-9A-Za-z]+)/i) || trimmed.match(/^([0-9A-Za-z]+)[:|]/);
      sessionPreview = sMatch ? `CODE_${sMatch[1]}` : undefined;
    }
    sessionIdRef.current = sessionPreview || '';

    frameDecodedTimeRef.current = performance.now();
    const msSinceFirstFrame = firstFrameTimeRef.current > 0 ? Math.round(frameDecodedTimeRef.current - firstFrameTimeRef.current) : 0;
    scannerTelemetry.recordStage('frame_decoded', msSinceFirstFrame, sessionPreview, { decode_duration_ms: msSinceFirstFrame, display_type: displayType, token_format: detectedFormat }, displayType, msSinceFirstFrame, detectedFormat);
    scannerTelemetry.recordEvent({
      event_type: 'decode_duration_histogram',
      stage: 'frame_decoded',
      duration_ms: msSinceFirstFrame,
      decode_duration_ms: msSinceFirstFrame,
      display_type: displayType,
      token_format: detectedFormat,
      session_id: sessionPreview
    });

    // Honest offline check: classroom QR rotation requires instantaneous server verification
    if (!navigator.onLine) {
      triggerFeedback(false);
      setIsOffline(true);
      setScanError(null);
      scannerTelemetry.recordFailure('network_error', 'frame_decoded', sessionPreview, { reason: 'offline' }, displayType, detectedFormat);
      return;
    }

    isScanningLockedRef.current = true;
    setIsSubmitting(true);
    setScanError(null);
    setQrExpiredCountdown(null);

    tokenSubmitTimeRef.current = performance.now();
    const msSinceDecode = tokenSubmitTimeRef.current - frameDecodedTimeRef.current;
    scannerTelemetry.recordStage('token_submitted', msSinceDecode, sessionPreview, { token_format: detectedFormat }, displayType, undefined, detectedFormat);

    try {
      const deviceCred = getOrCreateDeviceCredentials();
      const res: any = await apiRequest('/student/scan-session', {
        method: 'POST',
        body: JSON.stringify({
          session_token: trimmed,
          token_format: detectedFormat,
          device_uuid: deviceCred?.device_public_id || ''
        })
      });

      const serverMs = performance.now() - tokenSubmitTimeRef.current;
      scannerTelemetry.recordStage('server_response', serverMs, sessionPreview, { status: res?.status || 'SUCCESS', token_format: detectedFormat }, displayType, undefined, detectedFormat);
      const totalFromOpen = Date.now() - pageOpenTimeRef.current;
      scannerTelemetry.recordStage('attendance_confirmed', totalFromOpen, sessionPreview, { token_format: detectedFormat }, displayType, undefined, detectedFormat);

      triggerFeedback(true);
      setSuccessResult(res);

      // Stop camera once successfully processed
      stopCamera();
    } catch (err: any) {
      triggerFeedback(false);
      const serverMs = tokenSubmitTimeRef.current > 0 ? (performance.now() - tokenSubmitTimeRef.current) : 0;
      const rawMsg = err.message || '';
      const lowerMsg = rawMsg.toLowerCase();
      scannerTelemetry.recordStage('server_response', serverMs, sessionPreview, { status: 'ERROR', error: rawMsg });

      let failType: FailureErrorType = 'network_error';
      if (!navigator.onLine || lowerMsg.includes('failed to fetch') || lowerMsg.includes('networkerror')) {
        failType = 'network_error';
      } else if (lowerMsg.includes('expired') || lowerMsg.includes('invalid') || lowerMsg.includes('session token')) {
        failType = 'token_expired';
      } else if (lowerMsg.includes('revoked') || lowerMsg.includes('disabled') || lowerMsg.includes('403') || lowerMsg.includes('forbidden') || lowerMsg.includes('binding')) {
        failType = 'device_binding_403';
      } else if (lowerMsg.includes('rate') || lowerMsg.includes('too many') || lowerMsg.includes('429')) {
        failType = 'rate_limited';
      } else if (lowerMsg.includes('500') || lowerMsg.includes('server error')) {
        failType = 'server_5xx';
      }
      scannerTelemetry.recordFailure(failType, 'token_submitted', sessionPreview, { error: rawMsg });

      // Check if network connection dropped
      if (!navigator.onLine || lowerMsg.includes('failed to fetch') || lowerMsg.includes('networkerror')) {
        setIsOffline(true);
        isScanningLockedRef.current = false;
        setIsSubmitting(false);
        return;
      }

      // Check for rotating token expiry
      if (lowerMsg.includes('expired') || lowerMsg.includes('invalid') || lowerMsg.includes('session token')) {
        setQrExpiredCountdown(5);
        attemptCountRef.current += 1;
        scannerTelemetry.recordRetry(attemptCountRef.current, sessionPreview);
      } else {
        setScanError(rawMsg || 'Scan verification failed. Please try again.');
        // Unlock after 2 seconds to allow rescanning
        setTimeout(() => {
          isScanningLockedRef.current = false;
          setIsSubmitting(false);
          attemptCountRef.current += 1;
          scannerTelemetry.recordRetry(attemptCountRef.current, sessionPreview);
        }, 2000);
      }
    }
  };

  // Safe Track Zoom Controller (Clamped to Hardware Limits)
  const applyZoom = async (zoomVal: number) => {
    const stream = mediaStreamRef.current;
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    if (!track) return;

    const clamped = Math.max(zoomRange.min, Math.min(zoomRange.max, zoomVal));
    try {
      if ('applyConstraints' in track) {
        await track.applyConstraints({
          advanced: [{ zoom: clamped } as any]
        });
        setCurrentZoom(clamped);
      }
    } catch (e) {
      console.warn('Hardware zoom constraint not supported on this track:', e);
    }
  };

  // Safe Track Torch Controller
  const toggleTorch = async () => {
    const stream = mediaStreamRef.current;
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    if (!track) return;

    const nextState = !torchActive;
    try {
      if ('applyConstraints' in track) {
        await track.applyConstraints({
          advanced: [{ torch: nextState } as any]
        });
        setTorchActive(nextState);
      }
    } catch (e) {
      console.warn('Torch constraint failed:', e);
    }
  };

  // Auto-Zoom Calculation Loop
  const triggerAutoZoomIfNeeded = (boxFraction: number) => {
    if (!autoZoomEnabled || !hasZoomCapability || zoomRange.max <= 1) return;

    // If QR occupies less than 20% of frame width, compute ideal zoom to fill ~40%
    if (boxFraction > 0.02 && boxFraction < 0.22) {
      const idealZoom = Math.min(zoomRange.max, currentZoom * (0.42 / boxFraction));
      if (idealZoom > currentZoom + 0.3) {
        setGuideText('QR detected — zooming in…');
        applyZoom(idealZoom);
      }
    }
  };

  // Performance-Throttled Decode Loop (~8-10 fps)
  const processFrame = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || isScanningLockedRef.current) {
      animationFrameIdRef.current = requestAnimationFrame(processFrame);
      return;
    }

    if (!hasCapturedFirstFrameRef.current) {
      hasCapturedFirstFrameRef.current = true;
      firstFrameTimeRef.current = performance.now();
      const msSinceCam = cameraOpenTimeRef.current > 0 ? (firstFrameTimeRef.current - cameraOpenTimeRef.current) : 0;
      scannerTelemetry.recordStage('first_frame_captured', msSinceCam);
    }

    const now = performance.now();
    if (now - lastDecodeTimeRef.current < DECODE_INTERVAL_MS) {
      animationFrameIdRef.current = requestAnimationFrame(processFrame);
      return;
    }
    lastDecodeTimeRef.current = now;

    const videoW = video.videoWidth;
    const videoH = video.videoHeight;
    if (!videoW || !videoH) {
      animationFrameIdRef.current = requestAnimationFrame(processFrame);
      return;
    }

    let detectedCandidate = false;

    // PASS 1: Native BarcodeDetector (Chrome/Android C++ engine)
    if (barcodeDetectorRef.current) {
      try {
        const barcodes = await barcodeDetectorRef.current.detect(video);
        if (barcodes && barcodes.length > 0) {
          detectedCandidate = true;
          for (const b of barcodes) {
            // Auto-zoom probe from detected bounding box
            if (b.boundingBox && videoW > 0) {
              const fraction = b.boundingBox.width / videoW;
              triggerAutoZoomIfNeeded(fraction);
            }
            if (b.rawValue) {
              handleScanSuccess(b.rawValue);
              return;
            }
          }
        }
      } catch {
        // Fall through to Pass 2 on detector failure
      }
    }

    // PASS 2 & 3: Single Canvas Buffer for jsQR (Safari / Firefox / Distance Fallback)
    let canvas = canvasRef.current;
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvasRef.current = canvas;
    }

    if (canvas.width !== videoW || canvas.height !== videoH) {
      canvas.width = videoW;
      canvas.height = videoH;
    }

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      ctx.drawImage(video, 0, 0, videoW, videoH);

      // Pass 2: Full-Frame jsQR scan
      const fullImgData = ctx.getImageData(0, 0, videoW, videoH);
      const codeFull = jsQR(fullImgData.data, videoW, videoH, { inversionAttempts: 'dontInvert' });

      if (codeFull) {
        detectedCandidate = true;
        if (codeFull.location && videoW > 0) {
          const approxWidth = Math.abs(codeFull.location.topRightCorner.x - codeFull.location.topLeftCorner.x);
          triggerAutoZoomIfNeeded(approxWidth / videoW);
        }
        if (codeFull.data) {
          handleScanSuccess(codeFull.data);
          return;
        }
      }

      // Pass 3: Central 45% ROI Adaptive Software Crop (for distant 10m-30m projectors)
      // HONESTY: Only amplifies sensor pixel density in the center; does not synthesize data.
      const roiW = Math.floor(videoW * 0.45);
      const roiH = Math.floor(videoH * 0.45);
      const roiX = Math.floor((videoW - roiW) / 2);
      const roiY = Math.floor((videoH - roiH) / 2);

      const roiImgData = ctx.getImageData(roiX, roiY, roiW, roiH);
      const codeRoi = jsQR(roiImgData.data, roiW, roiH, { inversionAttempts: 'dontInvert' });

      if (codeRoi) {
        detectedCandidate = true;
        if (codeRoi.data) {
          handleScanSuccess(codeRoi.data);
          return;
        }
      }
    }

    // Dynamic Guidance Text Updates & Quick Win C.4 Decode-Loop Soft Restart
    const elapsedSeconds = (Date.now() - scanStartTimeRef.current) / 1000;
    if (detectedCandidate) {
      setGuideText('QR detected — hold steady…');
    } else if (elapsedSeconds > 5.0 && !hasSoftRestartedRef.current) {
      // C.4 Soft restart on 5s decode stall: reset frame loop + subtle steadying hint
      hasSoftRestartedRef.current = true;
      setIsSteadying(true);
      setGuideText('Steadying camera focus…');
      if (animationFrameIdRef.current) cancelAnimationFrame(animationFrameIdRef.current);
      setTimeout(() => {
        setIsSteadying(false);
        setGuideText('Point your camera at the attendance QR');
        scanStartTimeRef.current = Date.now();
        hasSoftRestartedRef.current = false;
        animationFrameIdRef.current = requestAnimationFrame(processFrame);
      }, 400);
      return;
    } else if (elapsedSeconds > 3.0) {
      setGuideText('Move closer or increase zoom');
    } else {
      setGuideText('Point your camera at the attendance QR');
    }

    // Schedule next throttled frame
    animationFrameIdRef.current = requestAnimationFrame(processFrame);
  }, [autoZoomEnabled, hasZoomCapability, zoomRange, currentZoom]);

  // Quick Win C.3: Camera Constraint Fallback Ladder Rungs
  const CAMERA_LADDER_RUNGS: MediaStreamConstraints[] = [
    // Rung 1: Ideal 720p / 1080p without rigid min dimensions that cause OverconstrainedError
    {
      audio: false,
      video: {
        facingMode: { ideal: facingMode },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, min: 15 }
      }
    },
    // Rung 2: Standard VGA (640x480) for low-end / older chipsets
    {
      audio: false,
      video: {
        facingMode: { ideal: facingMode },
        width: { ideal: 640 },
        height: { ideal: 480 }
      }
    },
    // Rung 3: Basic unconstrained video feed
    {
      audio: false,
      video: {
        facingMode: { ideal: facingMode }
      }
    }
  ];

  // Camera Lifecycle Start with C.3 Constraint Ladder
  const startCamera = async (targetRung: number = 1) => {
    try {
      setCameraError(null);
      stopCamera();
      scanStartTimeRef.current = Date.now();
      setGuideText('Point your camera at the attendance QR');

      // 1. Check native BarcodeDetector support
      if ('BarcodeDetector' in window) {
        try {
          const supportedFormats = await (window as any).BarcodeDetector.getSupportedFormats();
          if (supportedFormats.includes('qr_code')) {
            barcodeDetectorRef.current = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
          }
        } catch {
          barcodeDetectorRef.current = null;
        }
      } else {
        barcodeDetectorRef.current = null;
      }

      permissionReqTimeRef.current = performance.now();
      scannerTelemetry.recordStage('camera_permission_requested', undefined, undefined, undefined, displayType);

      let stream: MediaStream | null = null;
      let usedRung = targetRung;
      for (let r = targetRung; r <= 3; r++) {
        usedRung = r;
        try {
          stream = await navigator.mediaDevices.getUserMedia(CAMERA_LADDER_RUNGS[r - 1]);
          if (stream) break;
        } catch (rungErr: any) {
          console.warn(`Camera ladder rung ${r} failed:`, rungErr?.name);
          if (rungErr?.name === 'NotAllowedError' || rungErr?.name === 'PermissionDeniedError') {
            throw rungErr;
          }
          if (r === 3) throw rungErr;
        }
      }

      if (!stream) {
        throw new Error('Unable to initialize device camera stream.');
      }

      setActiveLadderRung(usedRung);
      const permDuration = performance.now() - permissionReqTimeRef.current;
      scannerTelemetry.recordStage('camera_permission_result', permDuration, undefined, { granted: true, ladder_rung: usedRung }, displayType);
      setPermissionState('granted');

      mediaStreamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      cameraOpenTimeRef.current = performance.now();
      const camMs = cameraOpenTimeRef.current - permissionReqTimeRef.current;
      hasCapturedFirstFrameRef.current = false;
      frameDecodedTimeRef.current = 0;
      scannerTelemetry.recordStage('camera_opened', camMs, sessionIdRef.current, { ladder_rung: usedRung }, displayType);

      // Start 15-second decode watchdog timer
      if (decodeWatchdogTimerRef.current) clearTimeout(decodeWatchdogTimerRef.current);
      decodeWatchdogTimerRef.current = setTimeout(() => {
        if (!frameDecodedTimeRef.current) {
          scannerTelemetry.recordFailure('decode_timeout', 'camera_opened', sessionIdRef.current, {
            elapsed_ms: 15000,
            ladder_rung: usedRung
          }, displayType);
        }
      }, 15000);

      // 3. Probe track capabilities safely
      const track = stream.getVideoTracks()[0];
      if (track && 'getCapabilities' in track) {
        const capabilities: any = track.getCapabilities();

        // Continuous Autofocus
        if (capabilities.focusMode && capabilities.focusMode.includes('continuous')) {
          try {
            await track.applyConstraints({
              advanced: [{ focusMode: 'continuous' } as any]
            });
          } catch {}
        }

        // Hardware Zoom: reset to 1x on scanner open
        if (capabilities.zoom) {
          setHasZoomCapability(true);
          const minZ = capabilities.zoom.min || 1;
          const maxZ = capabilities.zoom.max || 1;
          const stepZ = capabilities.zoom.step || 0.1;
          setZoomRange({ min: minZ, max: maxZ, step: stepZ });
          setCurrentZoom(minZ);
          // Apply initial 1x zoom reset
          try {
            await track.applyConstraints({
              advanced: [{ zoom: minZ } as any]
            });
          } catch {}
        } else {
          setHasZoomCapability(false);
        }

        // Torch / Flashlight
        if (capabilities.torch) {
          setHasTorchCapability(true);
        } else {
          setHasTorchCapability(false);
        }
      }

      // 4. Request Screen Wake Lock during active scanning
      if ('wakeLock' in navigator) {
        try {
          wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        } catch {}
      }

      setCameraActive(true);
      animationFrameIdRef.current = requestAnimationFrame(processFrame);
    } catch (err: any) {
      console.error('Camera initialization error:', err);
      const permDuration = permissionReqTimeRef.current > 0 ? (performance.now() - permissionReqTimeRef.current) : 0;
      const isDenied = err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError';
      const failType: FailureErrorType = isDenied ? 'permission_denied' : 'camera_unavailable';
      if (isDenied) {
        setPermissionState('denied');
      }
      scannerTelemetry.recordStage('camera_permission_result', permDuration, undefined, { granted: false }, displayType);
      scannerTelemetry.recordFailure(failType, 'camera_permission_requested', undefined, { error: err.name || err.message }, displayType);
      triggerFeedback(false);
      setCameraError(
        isDenied 
          ? 'Camera permission was denied. Tap the lock or camera icon in your browser address bar, enable Camera, and tap Retry.' 
          : (err.message || 'Unable to access device camera. Please check camera permissions in browser settings.')
      );
      setCameraActive(false);
    }
  };

  // Camera Lifecycle Stop (Complete Teardown: Green Light Turns Off)
  const stopCamera = useCallback(() => {
    if (decodeWatchdogTimerRef.current) {
      clearTimeout(decodeWatchdogTimerRef.current);
      decodeWatchdogTimerRef.current = null;
    }
    if (animationFrameIdRef.current) {
      cancelAnimationFrame(animationFrameIdRef.current);
      animationFrameIdRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
      mediaStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (wakeLockRef.current) {
      try {
        wakeLockRef.current.release();
      } catch {}
      wakeLockRef.current = null;
    }
    barcodeDetectorRef.current = null;
    canvasRef.current = null;
    setTorchActive(false);
    setCurrentZoom(1);
    setCameraActive(false);
  }, []);

  // Quick Win C.1: Permission-Aware Initialization (Explainer for prompt, Auto-Start if granted)
  useEffect(() => {
    let isMounted = true;
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'camera' as any })
        .then((status) => {
          if (!isMounted) return;
          setPermissionState(status.state as any);
          if (status.state === 'granted') {
            startCamera(1);
          }
          status.onchange = () => {
            if (!isMounted) return;
            setPermissionState(status.state as any);
          };
        })
        .catch(() => {
          if (!isMounted) return;
          setPermissionState('unknown');
          startCamera(1);
        });
    } else {
      setPermissionState('unknown');
      startCamera(1);
    }
    return () => {
      isMounted = false;
      stopCamera();
    };
  }, [facingMode]);

  const toggleFacingMode = () => {
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  };

  // Pinch-to-zoom gesture handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && hasZoomCapability) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      pinchStartDistanceRef.current = dist;
      pinchStartZoomRef.current = currentZoom;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchStartDistanceRef.current !== null && hasZoomCapability) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const factor = dist / pinchStartDistanceRef.current;
      const targetZ = pinchStartZoomRef.current * factor;
      setAutoZoomEnabled(false); // Manual pinch disables auto-zoom
      applyZoom(targetZ);
    }
  };

  const handleTouchEnd = () => {
    pinchStartDistanceRef.current = null;
  };

  return (
    <PwaInstallGuard onDismiss={() => { stopCamera(); onClose(); }}>
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white text-slate-900 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col max-h-[95vh] font-sans">
        
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 bg-slate-50/90">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#001e40] text-white flex items-center justify-center font-bold text-xs shadow-sm">
              <Camera className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-extrabold text-sm text-[#001e40]">Scan Classroom QR</h3>
              <p className="text-[11px] font-semibold text-slate-500">
                {guideText}
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="p-1.5 rounded-full hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Area */}
        <div className="p-4 sm:p-6 flex-1 flex flex-col items-center justify-center overflow-y-auto">
          {successResult ? (
            /* Celebration Success Screen */
            <div className="text-center space-y-4 py-4 animate-in fade-in zoom-in-95 duration-300 w-full">
              <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
                <CheckCircle className="w-12 h-12 animate-bounce" />
              </div>

              <div>
                <span className={`inline-block px-3 py-1 rounded-full text-xs font-black uppercase mb-1 ${
                  successResult.status === 'ALREADY_MARKED'
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-emerald-100 text-emerald-800'
                }`}>
                  {successResult.status === 'ALREADY_MARKED' ? 'Already Present' : 'Verified Present'}
                </span>
                <h2 className="text-2xl font-black text-[#001e40]">
                  {successResult.status === 'ALREADY_MARKED' ? "You're Already Marked Present ✅" : 'Marked Present!'}
                </h2>
                <p className="text-xs text-slate-600 font-medium mt-1">
                  {successResult.message}
                </p>
              </div>

              <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200/80 text-left space-y-2 text-xs">
                <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
                  <span className="text-slate-500 font-medium">Subject:</span>
                  <span className="font-bold text-slate-800">{successResult.subject_name || 'Class Session'}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
                  <span className="text-slate-500 font-medium">Period Count:</span>
                  <span className="font-bold text-emerald-700 font-mono">
                    {successResult.period_count} Period{successResult.period_count > 1 ? 's' : ''}
                  </span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
                  <span className="text-slate-500 font-medium">Roll Number:</span>
                  <span className="font-mono font-bold text-slate-800">{successResult.roll_number}</span>
                </div>
                <div className="flex justify-between items-center py-1">
                  <span className="text-slate-500 font-medium">Date:</span>
                  <span className="font-mono text-slate-700">{successResult.session_date}</span>
                </div>
              </div>

              <button
                onClick={() => {
                  onScanComplete();
                  onClose();
                }}
                className="w-full py-3.5 bg-[#001e40] hover:bg-[#002f6c] text-white font-black text-sm rounded-2xl shadow-lg transition active:scale-98"
              >
                Back to Dashboard
              </button>
            </div>
          ) : (
            /* Active Camera Scanner View */
            <div className="w-full flex flex-col items-center space-y-3.5">
              
              {/* Task 0: Honest Offline Amber Card */}
              {isOffline && (
                <div className="w-full p-3.5 bg-amber-50 border-2 border-amber-300 rounded-2xl text-center space-y-2 animate-in fade-in">
                  <div className="w-8 h-8 bg-amber-100 text-amber-800 rounded-full flex items-center justify-center mx-auto border border-amber-300">
                    <WifiOff className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-amber-950 uppercase tracking-wide">Offline — Live Verification Required</h4>
                    <p className="text-xs font-semibold text-amber-900 mt-1">
                      No connection — ask your teacher to mark you present manually.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (navigator.onLine) {
                        setIsOffline(false);
                        isScanningLockedRef.current = false;
                        setIsSubmitting(false);
                      } else {
                        triggerFeedback(false);
                      }
                    }}
                    className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 mx-auto shadow-sm active:scale-95"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Check Connection &amp; Rescan</span>
                  </button>
                </div>
              )}

              {/* Task 1: Actionable QR Expiry Countdown Ticker */}
              {qrExpiredCountdown !== null && qrExpiredCountdown > 0 && (
                <div className="w-full p-3.5 bg-amber-50 border-2 border-amber-300 rounded-2xl text-center space-y-2 animate-in fade-in">
                  <div className="w-8 h-8 bg-amber-100 text-amber-800 rounded-full flex items-center justify-center mx-auto border border-amber-300">
                    <Clock className="w-4 h-4 animate-pulse" />
                  </div>
                  <h4 className="text-xs font-bold text-amber-950">QR Code Expired</h4>
                  <p className="text-xs text-amber-900 font-semibold">
                    QR expired — code refreshes automatically. Rescan in a few seconds ⏳
                  </p>
                  <div className="inline-block px-3 py-1 bg-amber-200 text-amber-900 rounded-full text-xs font-mono font-extrabold">
                    Rescanning in {qrExpiredCountdown}s...
                  </div>
                </div>
              )}

              {/* Wide Viewfinder (Zero Cropping Constraint) */}
              <div 
                className="relative w-full max-w-[320px] sm:max-w-[340px] h-[300px] rounded-3xl overflow-hidden bg-slate-950 border-4 border-[#001e40] shadow-xl"
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
              >
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />

                {/* Targeting Crosshair Lines */}
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <div className="w-56 h-56 border-2 border-dashed border-amber-400/80 rounded-2xl animate-pulse flex items-center justify-center">
                    <div className="w-4 h-4 border border-amber-300/60 rounded-full" />
                  </div>
                </div>

                {/* Quick Win C.4: Steadying Focus Pill */}
                {isSteadying && (
                  <div className="absolute top-4 left-1/2 -translate-x-1/2 px-3 py-1 bg-indigo-950/90 text-indigo-200 border border-indigo-500/50 rounded-full text-xs font-semibold flex items-center gap-1.5 shadow-lg animate-in fade-in pointer-events-none z-10">
                    <RefreshCw className="w-3 h-3 animate-spin text-cyan-400" />
                    <span>Steadying camera focus…</span>
                  </div>
                )}

                {/* Submitting Overlay */}
                {isSubmitting && (
                  <div className="absolute inset-0 bg-black/65 backdrop-blur-sm flex flex-col items-center justify-center gap-2 text-white">
                    <RefreshCw className="w-8 h-8 text-amber-400 animate-spin" />
                    <span className="text-xs font-bold font-mono">Verifying Attendance...</span>
                  </div>
                )}
              </div>

              {/* Quick Win C.1: Pre-permission Explainer Card */}
              {permissionState === 'prompt' && !cameraActive && !cameraError && (
                <div className="w-full max-w-[320px] p-4 bg-slate-50 border-2 border-indigo-200 rounded-2xl text-center space-y-2.5 animate-in fade-in mt-2">
                  <div className="w-10 h-10 bg-indigo-100 text-[#001e40] rounded-xl flex items-center justify-center mx-auto">
                    <Camera className="w-5 h-5 text-indigo-600" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-[#001e40] uppercase tracking-wide">Camera Access Required</h4>
                    <p className="text-[11px] text-slate-600 mt-0.5 leading-relaxed">
                      Camera needed to scan attendance QR displayed on screen. No pictures are saved or uploaded.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => startCamera(1)}
                    className="px-4 py-1.5 bg-[#001e40] hover:bg-[#002d60] text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 mx-auto shadow-sm active:scale-95"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>Enable Camera</span>
                  </button>
                </div>
              )}

              {/* Camera Access Error Notification */}
              {cameraError && (
                <div className="w-full p-3.5 bg-rose-50 border-2 border-rose-300 rounded-2xl text-center space-y-2 animate-in fade-in">
                  <div className="w-8 h-8 bg-rose-100 text-rose-700 rounded-full flex items-center justify-center mx-auto border border-rose-300">
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-rose-950 uppercase tracking-wide">Camera Access Blocked</h4>
                    <p className="text-xs font-medium text-rose-800 mt-1 leading-relaxed">
                      {cameraError.toLowerCase().includes('permission') || cameraError.toLowerCase().includes('denied') || cameraError.toLowerCase().includes('notallowed')
                        ? 'Camera permission was denied. Tap the lock or camera icon in your browser address bar, enable Camera, and tap Retry.'
                        : cameraError}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => startCamera()}
                    className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 mx-auto shadow-sm active:scale-95 cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Retry Camera</span>
                  </button>
                </div>
              )}

              {/* Status or Error Notifications */}
              {scanError && (
                <div className="w-full p-3 bg-rose-50 border border-rose-200 rounded-2xl text-xs text-rose-700 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
                  <p className="font-medium">{scanError}</p>
                </div>
              )}

              {/* Camera Zoom Slider & Controls (ALWAYS visible when capabilities.zoom exists) */}
              <div className="w-full flex flex-col items-center gap-2 pt-1">
                {hasZoomCapability && (
                  <div className="w-full max-w-[320px] bg-slate-50 p-2.5 rounded-2xl border border-slate-200 space-y-2">
                    {/* Zoom Slider Header */}
                    <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                      <span className="flex items-center gap-1">
                        <Sliders className="w-3.5 h-3.5 text-[#001e40]" />
                        <span>Camera Zoom:</span>
                      </span>
                      <span className="font-mono text-[#001e40] font-black">{currentZoom.toFixed(1)}×</span>
                      <button
                        type="button"
                        onClick={() => {
                          setAutoZoomEnabled(!autoZoomEnabled);
                        }}
                        className={`text-[10px] px-2 py-0.5 rounded-md font-bold transition ${
                          autoZoomEnabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        Auto: {autoZoomEnabled ? 'ON' : 'OFF'}
                      </button>
                    </div>

                    {/* Continuous Range Slider */}
                    <div className="flex items-center gap-2">
                      <ZoomOut className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <input
                        type="range"
                        min={zoomRange.min}
                        max={zoomRange.max}
                        step={zoomRange.step}
                        value={currentZoom}
                        onChange={(e) => {
                          setAutoZoomEnabled(false); // Manual slider interaction disables auto-zoom
                          applyZoom(parseFloat(e.target.value));
                        }}
                        className="w-full accent-[#001e40] cursor-pointer h-1.5 bg-slate-200 rounded-lg appearance-none"
                      />
                      <ZoomIn className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    </div>

                    {/* Quick Preset Buttons (Always reset to 1x option available) */}
                    <div className="flex items-center justify-between gap-1 pt-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          setAutoZoomEnabled(true);
                          applyZoom(1);
                        }}
                        className={`flex-1 py-1 rounded-lg text-xs font-mono font-black transition ${
                          Math.abs(currentZoom - 1) < 0.1 ? 'bg-[#001e40] text-white shadow-sm' : 'bg-white text-slate-700 hover:bg-slate-200'
                        }`}
                      >
                        1× (Reset)
                      </button>
                      {zoomRange.max >= 2 && (
                        <button
                          type="button"
                          onClick={() => {
                            setAutoZoomEnabled(false);
                            applyZoom(2);
                          }}
                          className={`flex-1 py-1 rounded-lg text-xs font-mono font-black transition ${
                            Math.abs(currentZoom - 2) < 0.1 ? 'bg-[#001e40] text-white shadow-sm' : 'bg-white text-slate-700 hover:bg-slate-200'
                          }`}
                        >
                          2×
                        </button>
                      )}
                      {zoomRange.max >= 3 && (
                        <button
                          type="button"
                          onClick={() => {
                            setAutoZoomEnabled(false);
                            applyZoom(3);
                          }}
                          className={`flex-1 py-1 rounded-lg text-xs font-mono font-black transition ${
                            Math.abs(currentZoom - 3) < 0.1 ? 'bg-[#001e40] text-white shadow-sm' : 'bg-white text-slate-700 hover:bg-slate-200'
                          }`}
                        >
                          3×
                        </button>
                      )}
                      {zoomRange.max >= 4 && (
                        <button
                          type="button"
                          onClick={() => {
                            setAutoZoomEnabled(false);
                            applyZoom(zoomRange.max);
                          }}
                          className={`flex-1 py-1 rounded-lg text-xs font-mono font-black transition ${
                            Math.abs(currentZoom - zoomRange.max) < 0.1 ? 'bg-[#001e40] text-white shadow-sm' : 'bg-white text-slate-700 hover:bg-slate-200'
                          }`}
                        >
                          {zoomRange.max.toFixed(0)}×
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Secondary Controls: Torch & Camera Flip */}
                <div className="flex items-center gap-2.5">
                  {hasTorchCapability && (
                    <button
                      type="button"
                      onClick={toggleTorch}
                      className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm ${
                        torchActive
                          ? 'bg-amber-400 text-[#001e40]'
                          : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                      }`}
                    >
                      <Flashlight className="w-3.5 h-3.5" />
                      <span>{torchActive ? 'Torch On' : 'Torch Off'}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={toggleFacingMode}
                    className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Flip Camera</span>
                  </button>
                </div>
              </div>

              {/* Camera Error & Permission Recovery */}
              {cameraError && (
                <div className="w-full p-4 bg-rose-50 border border-rose-200 rounded-2xl text-center space-y-3">
                  <div className="w-9 h-9 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto">
                    <Camera className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-rose-900">Camera Permission Required</h4>
                    <p className="text-[11px] text-rose-700 mt-1">
                      To scan classroom QR, enable camera access in browser settings (tap the lock icon in the address bar → Site permissions → Allow camera).
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => startCamera(1)}
                    className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 mx-auto shadow-sm active:scale-95"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Retry Camera Permission</span>
                  </button>
                </div>
              )}

            </div>
          )}
        </div>

      </div>
    </div>
    </PwaInstallGuard>
  );
};
