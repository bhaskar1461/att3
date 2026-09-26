import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { scannerTelemetry } from '../../../services/scannerTelemetry';
import { FailureErrorType, DisplayType } from '../../../types/telemetry';

export interface UseCameraStreamProps {
  displayType?: DisplayType;
  onFrameReady?: () => void;
}

export function useCameraStream({
  displayType = 'projector',
  onFrameReady
}: UseCameraStreamProps = {}) {
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [cameraStarting, setCameraStarting] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isCameraInUse, setIsCameraInUse] = useState<boolean>(false);
  const [permissionState, setPermissionState] = useState<'prompt' | 'granted' | 'denied' | 'insecure_origin' | 'unknown'>('unknown');
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');

  // Dynamic Camera Capabilities
  const [hasZoomCapability, setHasZoomCapability] = useState<boolean>(false);
  const [zoomRange, setZoomRange] = useState<{ min: number; max: number; step: number }>({ min: 1, max: 1, step: 0.1 });
  const [currentZoom, setCurrentZoom] = useState<number>(1);
  const [autoZoomEnabled, setAutoZoomEnabled] = useState<boolean>(true);
  const [hasTorchCapability, setHasTorchCapability] = useState<boolean>(false);
  const [torchActive, setTorchActive] = useState<boolean>(false);

  // Video and Stream Refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const isMountedRef = useRef<boolean>(true);
  const permStatusRef = useRef<PermissionStatus | null>(null);
  const wakeLockRef = useRef<any>(null);
  const barcodeDetectorRef = useRef<any>(null);

  // Timing and Telemetry Refs
  const permissionReqTimeRef = useRef<number>(0);
  const cameraOpenTimeRef = useRef<number>(0);
  const lastTapTimeRef = useRef<number>(0);
  const pinchStartDistanceRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef<number>(1);

  // iOS & Specific Browser Detection for Context-Aware Permission Rescue
  const browserInfo = useMemo(() => {
    if (typeof navigator === 'undefined') return { isIOS: false, name: 'Browser', isBrave: false, isSafari: true };
    const ua = navigator.userAgent || '';
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isBrave = !!(navigator as any).brave?.isBrave || /Brave/i.test(ua);
    const isChromeIOS = /CriOS/i.test(ua);
    const isFirefoxIOS = /FxiOS/i.test(ua);
    const isEdgeIOS = /EdgiOS/i.test(ua);
    const isSafari = isIOS && !isBrave && !isChromeIOS && !isFirefoxIOS && !isEdgeIOS;

    let name = 'Safari';
    if (isBrave) name = 'Brave';
    else if (isChromeIOS) name = 'Chrome';
    else if (isFirefoxIOS) name = 'Firefox';
    else if (isEdgeIOS) name = 'Edge';
    else if (!isIOS) name = 'Browser';

    return { isIOS, name, isBrave, isChromeIOS, isFirefoxIOS, isSafari };
  }, []);

  const [copiedSafariLink, setCopiedSafariLink] = useState<boolean>(false);
  const handleCopySafariLink = useCallback(() => {
    try {
      navigator.clipboard.writeText(window.location.href);
      setCopiedSafariLink(true);
      setTimeout(() => setCopiedSafariLink(false), 3000);
    } catch {
      // fallback
    }
  }, []);

  // getUserMedia Constraint Ladder Rungs
  const CAMERA_LADDER_RUNGS: MediaStreamConstraints[] = useMemo(() => [
    // Rung 1: Ideal 720p landscape environment camera (no min framerate constraint to prevent Safari OverconstrainedError)
    {
      audio: false,
      video: {
        facingMode: { ideal: facingMode },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    },
    // Rung 2: Basic environment camera without dimension constraints
    {
      audio: false,
      video: {
        facingMode: { ideal: facingMode }
      }
    },
    // Rung 3: Absolute fallback: any available video device
    {
      audio: false,
      video: true
    }
  ], [facingMode]);

  // Robust Video Stream Setup & Playback for iOS Safari & Android
  const playVideoStream = useCallback(async (video: HTMLVideoElement, stream: MediaStream): Promise<void> => {
    console.log('[Scanner] video element found');
    try {
      video.setAttribute('autoplay', 'true');
      video.setAttribute('muted', 'true');
      video.setAttribute('playsinline', 'true');
      video.setAttribute('webkit-playsinline', 'true');
      video.playsInline = true;
      video.autoplay = true;
      video.muted = true;

      if (video.srcObject !== stream) {
        video.srcObject = stream;
        console.log('[Scanner] stream attached');
      }

      await new Promise<void>((resolve) => {
        if (video.readyState >= 1 && video.videoWidth > 0 && video.videoHeight > 0) {
          console.log('[Scanner] metadata loaded');
          console.log(`[Scanner] video dimensions: ${video.videoWidth}x${video.videoHeight}`);
          resolve();
          return;
        }

        let resolved = false;
        const onLoaded = () => {
          if (!resolved) {
            resolved = true;
            video.removeEventListener('loadedmetadata', onLoaded);
            video.removeEventListener('canplay', onLoaded);
            console.log('[Scanner] metadata loaded');
            console.log(`[Scanner] video dimensions: ${video.videoWidth}x${video.videoHeight}`);
            resolve();
          }
        };

        video.addEventListener('loadedmetadata', onLoaded, { once: true });
        video.addEventListener('canplay', onLoaded, { once: true });

        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            video.removeEventListener('loadedmetadata', onLoaded);
            video.removeEventListener('canplay', onLoaded);
            console.log('[Scanner] metadata loaded (timeout fallback)');
            console.log(`[Scanner] video dimensions: ${video.videoWidth}x${video.videoHeight}`);
            resolve();
          }
        }, 2000);
      });

      try {
        await video.play();
        console.log('[Scanner] video playing');
      } catch (playErr) {
        console.warn('[Scanner] video.play() caught:', playErr);
        const onUserInteraction = () => {
          if (videoRef.current) {
            videoRef.current.play()
              .then(() => console.log('[Scanner] video playing (touch resumed)'))
              .catch(() => {});
          }
          window.removeEventListener('touchstart', onUserInteraction);
          window.removeEventListener('click', onUserInteraction);
        };
        window.addEventListener('touchstart', onUserInteraction, { once: true });
        window.addEventListener('click', onUserInteraction, { once: true });
      }

      console.log(`[Scanner] video dimensions: ${video.videoWidth}x${video.videoHeight}, readyState=${video.readyState}`);
    } catch (e) {
      console.warn('[Scanner] playVideoStream error:', e);
    }
  }, []);

  const attachVideoRef = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    if (node && mediaStreamRef.current) {
      playVideoStream(node, mediaStreamRef.current);
    }
  }, [playVideoStream]);

  const getUserMediaWithTimeout = useCallback((constraints: MediaStreamConstraints, timeoutMs: number = 8000): Promise<MediaStream> => {
    return new Promise((resolve, reject) => {
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        const err = new Error('CAMERA_OPEN_TIMEOUT');
        err.name = 'CameraOpenTimeoutError';
        reject(err);
      }, timeoutMs);

      navigator.mediaDevices.getUserMedia(constraints)
        .then((stream) => {
          if (!timedOut) {
            clearTimeout(timer);
            resolve(stream);
          } else {
            stream.getTracks().forEach((t) => {
              try { t.stop(); } catch {}
            });
          }
        })
        .catch((err) => {
          if (!timedOut) {
            clearTimeout(timer);
            reject(err);
          }
        });
    });
  }, []);

  const applyZoom = useCallback(async (zoomVal: number) => {
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
  }, [zoomRange]);

  const toggleTorch = useCallback(async () => {
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
  }, [torchActive]);

  const triggerAutoZoomIfNeeded = useCallback((boxFraction: number) => {
    if (!autoZoomEnabled || !hasZoomCapability || zoomRange.max <= 1) return;

    if (boxFraction > 0.02 && boxFraction < 0.22) {
      const idealZoom = Math.min(zoomRange.max, currentZoom * (0.42 / boxFraction));
      if (idealZoom > currentZoom + 0.3) {
        applyZoom(idealZoom);
      }
    }
  }, [autoZoomEnabled, hasZoomCapability, zoomRange, currentZoom, applyZoom]);

  const stopCamera = useCallback(() => {
    console.log('[Scanner] stopCamera invoked');
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
          console.log(`[Scanner] track ${track.label} stopped`);
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
    setTorchActive(false);
    setCurrentZoom(1);
    setCameraActive(false);
  }, []);

  const startCamera = useCallback(async (targetRung: number = 1) => {
    try {
      setCameraStarting(true);
      setCameraError(null);
      setIsCameraInUse(false);
      stopCamera();

      if (typeof window !== 'undefined' && !window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        setPermissionState('insecure_origin');
        setCameraStarting(false);
        setCameraError('Camera access requires HTTPS or localhost. Current origin is not secure.');
        scannerTelemetry.recordFailure('insecure_origin', 'camera_permission_requested', '', { origin: window.location.origin }, displayType);
        return;
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraStarting(false);
        setCameraError('Browser does not support mediaDevices.getUserMedia. Please open in Chrome or Safari.');
        scannerTelemetry.recordFailure('camera_unavailable', 'camera_permission_requested', '', { reason: 'mediaDevices_missing' }, displayType);
        return;
      }

      if ('BarcodeDetector' in window) {
        try {
          const supportedFormats = await (window as any).BarcodeDetector.getSupportedFormats();
          if (supportedFormats.includes('qr_code')) {
            barcodeDetectorRef.current = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
            console.log('[Scanner] QR decoder initialized (native BarcodeDetector)');
          }
        } catch {
          barcodeDetectorRef.current = null;
        }
      } else {
        barcodeDetectorRef.current = null;
        console.log('[Scanner] QR decoder initialized (WASM / jsQR)');
      }

      permissionReqTimeRef.current = performance.now();
      console.log('[Scanner] requesting camera');
      scannerTelemetry.recordStage('camera_permission_requested', undefined, '', undefined, displayType);

      let stream: MediaStream | null = null;
      let usedRung = targetRung;
      for (let r = targetRung; r <= 3; r++) {
        usedRung = r;
        try {
          stream = await getUserMediaWithTimeout(CAMERA_LADDER_RUNGS[r - 1], 8000);
          if (!isMountedRef.current) {
            if (stream) {
              stream.getTracks().forEach((t) => {
                try { t.stop(); } catch {}
              });
            }
            return;
          }
          if (stream) break;
        } catch (rungErr: any) {
          console.warn(`[Scanner] Camera ladder constraint rung ${r} failed:`, rungErr?.name || rungErr);
          if (rungErr?.name === 'CameraOpenTimeoutError') {
            scannerTelemetry.recordCameraOpenTimeout(r, '');
          }
          if (rungErr?.name === 'NotAllowedError' || rungErr?.name === 'PermissionDeniedError') {
            throw rungErr;
          }
          if (rungErr?.name === 'NotReadableError' || rungErr?.name === 'TrackStartError') {
            setIsCameraInUse(true);
            throw rungErr;
          }
          if (r === 3) throw rungErr;
        }
      }

      if (!isMountedRef.current) {
        if (stream) {
          stream.getTracks().forEach((t) => {
            try { t.stop(); } catch {}
          });
        }
        return;
      }

      if (!stream) {
        throw new Error('Unable to initialize device camera stream.');
      }

      const permDuration = performance.now() - permissionReqTimeRef.current;
      console.log('[Scanner] permission result: GRANTED');
      scannerTelemetry.recordStage('camera_permission_result', permDuration, '', { granted: true, constraint_ladder_rung: usedRung }, displayType);
      setPermissionState('granted');

      const vTracks = stream.getVideoTracks();
      console.log(`[Scanner] stream acquired (${vTracks.length} video tracks, active=${stream.active})`);

      mediaStreamRef.current = stream;

      if (videoRef.current) {
        await playVideoStream(videoRef.current, stream);
      }

      cameraOpenTimeRef.current = performance.now();
      const camMs = cameraOpenTimeRef.current - permissionReqTimeRef.current;
      scannerTelemetry.recordStage('camera_opened', camMs, '', { constraint_ladder_rung: usedRung }, displayType);

      const track = stream.getVideoTracks()[0];
      if (track) {
        track.onended = () => {
          console.warn('[Camera] Track ended unexpectedly.');
          setCameraActive(false);
          setCameraError('Camera stream disconnected. Please tap Retry.');
        };

        if ('getCapabilities' in track) {
          const capabilities: any = track.getCapabilities();

          if (capabilities.focusMode && capabilities.focusMode.includes('continuous')) {
            try {
              await track.applyConstraints({
                advanced: [{ focusMode: 'continuous' } as any]
              });
            } catch {}
          }

          if (capabilities.zoom) {
            setHasZoomCapability(true);
            const minZ = capabilities.zoom.min || 1;
            const maxZ = capabilities.zoom.max || 1;
            const stepZ = capabilities.zoom.step || 0.1;
            setZoomRange({ min: minZ, max: maxZ, step: stepZ });
            const startZoom = Math.max(1.0, minZ);
            setCurrentZoom(startZoom);
            try {
              await track.applyConstraints({
                advanced: [{ zoom: startZoom } as any]
              });
            } catch {}
          } else {
            setHasZoomCapability(false);
          }

          if (capabilities.torch) {
            setHasTorchCapability(true);
          } else {
            setHasTorchCapability(false);
          }
        }
      }

      if ('wakeLock' in navigator) {
        try {
          wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        } catch {}
      }

      setCameraStarting(false);
      setCameraActive(true);
      console.log('[Scanner] scanning started');
      if (onFrameReady) {
        onFrameReady();
      }
    } catch (err: any) {
      setCameraStarting(false);
      setCameraActive(false);
      console.error('[Scanner] Camera initialization error:', err);
      const permDuration = permissionReqTimeRef.current > 0 ? (performance.now() - permissionReqTimeRef.current) : 0;
      const isDenied = err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError';
      const isReadable = err.name === 'NotReadableError' || err.name === 'TrackStartError';
      const failType: FailureErrorType = isDenied 
        ? 'permission_denied' 
        : isReadable 
          ? 'camera_in_use' 
          : 'camera_unavailable';

      if (isDenied) {
        console.log('[Scanner] permission result: DENIED');
        setPermissionState('denied');
      }
      scannerTelemetry.recordStage('camera_permission_result', permDuration, '', { granted: false }, displayType);
      scannerTelemetry.recordFailure(failType, 'camera_permission_requested', '', { error: err.name || err.message }, displayType);

      if (isDenied) {
        if (browserInfo.isBrave && browserInfo.isIOS) {
          setCameraError('Camera blocked by Brave Shields. Lower Shields for this site (lion icon in address bar) and tap Reload Page, or open in Safari.');
        } else if (browserInfo.isIOS && !browserInfo.isSafari) {
          setCameraError(`Camera blocked in ${browserInfo.name}. Enable camera in iOS Settings → ${browserInfo.name} → Camera and tap Reload Page, or open in Safari.`);
        } else if (browserInfo.isSafari) {
          setCameraError('Camera access blocked. Enable camera access in iOS Settings → Safari → Camera and tap Reload Page.');
        } else {
          setCameraError('Camera access blocked. Please allow camera access in your browser settings and reload the page.');
        }
      } else if (isReadable) {
        setCameraError('Camera is in use by another app. Please close other camera apps (WhatsApp, Camera, Instagram) and retry.');
      } else {
        setCameraError('Camera unavailable. Allow camera access to scan the classroom QR.');
      }
    }
  }, [CAMERA_LADDER_RUNGS, browserInfo, displayType, getUserMediaWithTimeout, onFrameReady, playVideoStream, stopCamera]);

  useEffect(() => {
    isMountedRef.current = true;

    if (typeof window !== 'undefined' && !window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      setPermissionState('insecure_origin');
      setCameraError('Camera access requires HTTPS or localhost. Current origin is not secure.');
      return;
    }

    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'camera' as any })
        .then((status) => {
          if (!isMountedRef.current) return;
          permStatusRef.current = status;
          setPermissionState(status.state as any);
          if (status.state === 'denied') {
            setCameraError('Camera access blocked. Enable camera access in browser settings and try again.');
          } else {
            startCamera(1);
          }
          status.onchange = () => {
            if (!isMountedRef.current) return;
            setPermissionState(status.state as any);
            if (status.state !== 'denied' && !mediaStreamRef.current) {
              startCamera(1);
            }
          };
        })
        .catch(() => {
          if (!isMountedRef.current) return;
          setPermissionState('unknown');
          startCamera(1);
        });
    } else {
      setPermissionState('unknown');
      startCamera(1);
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (mediaStreamRef.current) {
          stopCamera();
          (window as any).__snist_resume_camera_after_vis__ = true;
        }
      } else if (document.visibilityState === 'visible') {
        if ((window as any).__snist_resume_camera_after_vis__) {
          (window as any).__snist_resume_camera_after_vis__ = false;
          startCamera(1);
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isMountedRef.current = false;
      if (permStatusRef.current) {
        try {
          permStatusRef.current.onchange = null;
        } catch {}
        permStatusRef.current = null;
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      stopCamera();
    };
  }, [facingMode, startCamera, stopCamera]);

  const toggleFacingMode = useCallback(() => {
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.stopPropagation();
    if (e.touches.length === 2 && hasZoomCapability) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      pinchStartDistanceRef.current = dist;
      pinchStartZoomRef.current = currentZoom;
    }
  }, [currentZoom, hasZoomCapability]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.stopPropagation();
    if (e.touches.length === 2 && pinchStartDistanceRef.current !== null && hasZoomCapability) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const factor = dist / pinchStartDistanceRef.current;
      const targetZ = pinchStartZoomRef.current * factor;
      setAutoZoomEnabled(false);
      applyZoom(targetZ);
    }
  }, [applyZoom, hasZoomCapability]);

  const handleDoubleTap = useCallback(() => {
    if (!hasZoomCapability) return;
    const target = currentZoom > 1.5 ? 1 : Math.min(zoomRange.max, 2);
    setAutoZoomEnabled(false);
    applyZoom(target);
  }, [applyZoom, currentZoom, hasZoomCapability, zoomRange.max]);

  const handleTouchEnd = useCallback((e?: React.TouchEvent) => {
    if (e) e.stopPropagation();
    const now = Date.now();
    if (now - lastTapTimeRef.current < 300) {
      handleDoubleTap();
    }
    lastTapTimeRef.current = now;
    pinchStartDistanceRef.current = null;
  }, [handleDoubleTap]);

  return {
    videoRef,
    mediaStreamRef,
    cameraActive,
    cameraStarting,
    cameraError,
    isCameraInUse,
    permissionState,
    facingMode,
    toggleFacingMode,
    hasZoomCapability,
    zoomRange,
    currentZoom,
    autoZoomEnabled,
    setAutoZoomEnabled,
    hasTorchCapability,
    torchActive,
    toggleTorch,
    applyZoom,
    triggerAutoZoomIfNeeded,
    startCamera,
    stopCamera,
    attachVideoRef,
    browserInfo,
    copiedSafariLink,
    handleCopySafariLink,
    handleTouchStart,
    handleTouchMove,
    handleDoubleTap,
    handleTouchEnd,
    barcodeDetectorRef
  };
}
