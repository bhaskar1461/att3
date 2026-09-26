import { useState, useRef, useCallback, useEffect } from 'react';
import jsQR from 'jsqr';
import { decodeFrame, getActiveScannerEngine, syncScannerEngineFromServer, ScannerEngine } from '../../../services/qrEngine';
import { initWasmScanner } from '../../../services/wasmScanner';
import { scannerTelemetry } from '../../../services/scannerTelemetry';
import { DisplayType } from '../../../types/telemetry';

export interface DiagHudState {
  cam: string;
  eng: string;
  qr: string;
  url: string;
  submit: string;
}

export interface UseBarcodeScannerProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isScanningLocked: boolean;
  onScanSuccess: (decodedText: string, engineUsed?: ScannerEngine) => void;
  triggerAutoZoomIfNeeded: (boxFraction: number) => void;
  onMultiQrDetected?: (count: number) => void;
  barcodeDetector?: any;
  displayType?: DisplayType;
  isDebugMode?: boolean;
}

export function useBarcodeScanner({
  videoRef,
  isScanningLocked,
  onScanSuccess,
  triggerAutoZoomIfNeeded,
  onMultiQrDetected,
  barcodeDetector,
  displayType = 'projector',
  isDebugMode = false
}: UseBarcodeScannerProps) {
  const [guideText, setGuideText] = useState<string>('Align the QR inside the frame');
  const [diagHud, setDiagHud] = useState<DiagHudState>({
    cam: 'INIT',
    eng: '-',
    qr: 'SEARCHING',
    url: '-',
    submit: 'IDLE'
  });
  const diagHudRef = useRef<DiagHudState>({
    cam: 'INIT',
    eng: '-',
    qr: 'SEARCHING',
    url: '-',
    submit: 'IDLE'
  });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);
  const isDecodingRef = useRef<boolean>(false);
  const isScanningActiveRef = useRef<boolean>(false);

  // Performance telemetry & Frame budget counters
  const framesCapturedRef = useRef<number>(0);
  const framesDecodedRef = useRef<number>(0);
  const framesSkippedRef = useRef<number>(0);
  const lastDecodeMsRef = useRef<number>(0);
  const totalDecodeMsRef = useRef<number>(0);
  const consecutiveMissesRef = useRef<number>(0);
  const frameAttemptCounterRef = useRef<number>(0);
  const lastDecodeScaleRef = useRef<number>(640);
  const lastDecodeTimeRef = useRef<number>(0);
  const DECODE_INTERVAL_MS = 110; // ~9 fps

  const hasCapturedFirstFrameRef = useRef<boolean>(false);
  const firstFrameTimeRef = useRef<number>(0);
  const activeEngineRef = useRef<ScannerEngine>(getActiveScannerEngine());

  // Prewarm WASM on mount
  useEffect(() => {
    initWasmScanner().catch(() => {});
    syncScannerEngineFromServer()
      .then((eng) => {
        activeEngineRef.current = eng;
      })
      .catch(() => {});
  }, []);

  const processFrame = useCallback(async () => {
    if (!isScanningActiveRef.current) return;
    if (isScanningLocked) return;

    const video = videoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      animationFrameIdRef.current = requestAnimationFrame(processFrame);
      return;
    }

    if (framesCapturedRef.current % 60 === 0 && framesCapturedRef.current > 0) {
      console.log(`[QR] Frame stats: captured=${framesCapturedRef.current}, decoded=${framesDecodedRef.current}, skipped=${framesSkippedRef.current}, avgMs=${framesDecodedRef.current > 0 ? Math.round(totalDecodeMsRef.current / framesDecodedRef.current) : 0}, engine=${activeEngineRef.current}`);
    }

    framesCapturedRef.current += 1;
    frameAttemptCounterRef.current += 1;

    // Back-pressure guard: Drop incoming frame if decoder is still running
    if (isDecodingRef.current) {
      framesSkippedRef.current += 1;
      animationFrameIdRef.current = requestAnimationFrame(processFrame);
      return;
    }

    if (!hasCapturedFirstFrameRef.current) {
      hasCapturedFirstFrameRef.current = true;
      firstFrameTimeRef.current = performance.now();
      scannerTelemetry.recordStage('first_frame_captured', undefined, undefined, undefined, displayType, undefined, undefined, activeEngineRef.current);
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
    const currentEng = getActiveScannerEngine();
    activeEngineRef.current = currentEng;

    if (currentEng === 'wasm') {
      const shouldProbeHigherRes = consecutiveMissesRef.current >= 6 && (frameAttemptCounterRef.current % 3 === 0);
      const MAX_DOWNSCALE_W = shouldProbeHigherRes ? 960 : 640;
      lastDecodeScaleRef.current = MAX_DOWNSCALE_W;

      let canvas = canvasRef.current;
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvasRef.current = canvas;
      }

      // PASS A: Central 50% ROI Crop
      const roiFraction = 0.50;
      const roiSrcW = Math.floor(videoW * roiFraction);
      const roiSrcH = Math.floor(videoH * roiFraction);
      const roiSrcX = Math.floor((videoW - roiSrcW) / 2);
      const roiSrcY = Math.floor((videoH - roiSrcH) / 2);
      const roiTargetW = Math.min(960, roiSrcW);
      const roiScale = roiTargetW / roiSrcW;
      const roiTargetH = Math.round(roiSrcH * roiScale);

      canvas.width = roiTargetW;
      canvas.height = roiTargetH;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      let decodedInRoi = false;
      if (ctx) {
        ctx.drawImage(video, roiSrcX, roiSrcY, roiSrcW, roiSrcH, 0, 0, roiTargetW, roiTargetH);
        const roiImgData = ctx.getImageData(0, 0, roiTargetW, roiTargetH);

        isDecodingRef.current = true;
        try {
          const { result, usedEngine } = await decodeFrame(roiImgData, currentEng);
          activeEngineRef.current = usedEngine;
          framesDecodedRef.current += 1;
          lastDecodeMsRef.current = result.ms_taken;
          totalDecodeMsRef.current += result.ms_taken;

          if (result.candidateCount && result.candidateCount > 1) {
            if (onMultiQrDetected) onMultiQrDetected(result.candidateCount);
            setGuideText('Multiple QRs detected — frame single QR');
            scannerTelemetry.recordFailure('multi_code_detected', 'frame_decoded', undefined, { candidate_count: result.candidateCount, scale: roiTargetW }, displayType, undefined, usedEngine);
            animationFrameIdRef.current = requestAnimationFrame(processFrame);
            return;
          }

          if (result.ok) {
            consecutiveMissesRef.current = 0;
            detectedCandidate = true;
            decodedInRoi = true;
            diagHudRef.current = { ...diagHudRef.current, eng: usedEngine.toUpperCase(), qr: `DETECTED (ROI ${result.text?.length || 0}ch)` };
            if (isDebugMode) setDiagHud({ ...diagHudRef.current });
            if (result.boundingBox && roiTargetW > 0) {
              const approxFraction = result.boundingBox.width / roiTargetW;
              triggerAutoZoomIfNeeded(approxFraction);
            }
            if (result.text) {
              onScanSuccess(result.text, usedEngine);
              return;
            }
          } else {
            consecutiveMissesRef.current += 1;
          }
        } finally {
          isDecodingRef.current = false;
        }
      }

      // PASS B: Full-frame downscaled fallback
      if (!decodedInRoi && ctx) {
        const scale = videoW > MAX_DOWNSCALE_W ? (MAX_DOWNSCALE_W / videoW) : 1.0;
        const targetW = Math.round(videoW * scale);
        const targetH = Math.round(videoH * scale);
        canvas.width = targetW;
        canvas.height = targetH;
        ctx.drawImage(video, 0, 0, targetW, targetH);
        const imgData = ctx.getImageData(0, 0, targetW, targetH);

        isDecodingRef.current = true;
        try {
          const { result, usedEngine } = await decodeFrame(imgData, currentEng);
          activeEngineRef.current = usedEngine;
          framesDecodedRef.current += 1;
          lastDecodeMsRef.current = result.ms_taken;
          totalDecodeMsRef.current += result.ms_taken;

          if (result.candidateCount && result.candidateCount > 1) {
            if (onMultiQrDetected) onMultiQrDetected(result.candidateCount);
            setGuideText('Multiple QRs detected — frame single QR');
            scannerTelemetry.recordFailure('multi_code_detected', 'frame_decoded', undefined, { candidate_count: result.candidateCount, scale: targetW }, displayType, undefined, usedEngine);
            animationFrameIdRef.current = requestAnimationFrame(processFrame);
            return;
          }

          if (result.ok) {
            consecutiveMissesRef.current = 0;
            detectedCandidate = true;
            diagHudRef.current = { ...diagHudRef.current, eng: usedEngine.toUpperCase(), qr: `DETECTED (FULL ${result.text?.length || 0}ch)` };
            if (isDebugMode) setDiagHud({ ...diagHudRef.current });
            if (result.boundingBox && targetW > 0) {
              const approxFraction = result.boundingBox.width / targetW;
              triggerAutoZoomIfNeeded(approxFraction);
            }
            if (result.text) {
              onScanSuccess(result.text, usedEngine);
              return;
            }
          } else {
            consecutiveMissesRef.current += 1;
          }
        } finally {
          isDecodingRef.current = false;
        }
      }

      if (!detectedCandidate) {
        diagHudRef.current = { ...diagHudRef.current, qr: 'SEARCHING' };
        if (isDebugMode && consecutiveMissesRef.current % 15 === 0) {
          setDiagHud({ ...diagHudRef.current });
        }
      }
    } else {
      // jsQR / Native BarcodeDetector Engine
      if (barcodeDetector) {
        try {
          const barcodes = await barcodeDetector.detect(video);
          if (barcodes && barcodes.length > 0) {
            if (barcodes.length > 1) {
              if (onMultiQrDetected) onMultiQrDetected(barcodes.length);
              setGuideText('Multiple QRs detected — frame single QR');
              scannerTelemetry.recordFailure('multi_code_detected', 'frame_decoded', undefined, { candidate_count: barcodes.length }, displayType, undefined, 'jsqr');
              animationFrameIdRef.current = requestAnimationFrame(processFrame);
              return;
            }
            detectedCandidate = true;
            for (const b of barcodes) {
              if (b.boundingBox && videoW > 0) {
                const fraction = b.boundingBox.width / videoW;
                triggerAutoZoomIfNeeded(fraction);
              }
              if (b.rawValue) {
                animationFrameIdRef.current = requestAnimationFrame(processFrame);
                onScanSuccess(b.rawValue, 'jsqr');
                return;
              }
            }
          }
        } catch {
          // Fall through to jsQR
        }
      }

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

        isDecodingRef.current = true;
        const decodeStart = performance.now();
        try {
          const fullImgData = ctx.getImageData(0, 0, videoW, videoH);
          const codeFull = jsQR(fullImgData.data, videoW, videoH, { inversionAttempts: 'dontInvert' });
          const msTaken = Math.max(0.1, performance.now() - decodeStart);
          framesDecodedRef.current += 1;
          lastDecodeMsRef.current = msTaken;
          totalDecodeMsRef.current += msTaken;

          if (codeFull) {
            detectedCandidate = true;
            if (codeFull.location && videoW > 0) {
              const approxWidth = Math.abs(codeFull.location.topRightCorner.x - codeFull.location.topLeftCorner.x);
              triggerAutoZoomIfNeeded(approxWidth / videoW);
            }
            if (codeFull.data) {
              onScanSuccess(codeFull.data, 'jsqr');
              return;
            }
          }

          // Central 45% ROI Adaptive Crop
          const roiW = Math.floor(videoW * 0.45);
          const roiH = Math.floor(videoH * 0.45);
          const roiX = Math.floor((videoW - roiW) / 2);
          const roiY = Math.floor((videoH - roiH) / 2);

          const roiImgData = ctx.getImageData(roiX, roiY, roiW, roiH);
          const codeRoi = jsQR(roiImgData.data, roiW, roiH, { inversionAttempts: 'dontInvert' });

          if (codeRoi) {
            detectedCandidate = true;
            if (codeRoi.data) {
              onScanSuccess(codeRoi.data, 'jsqr');
              return;
            }
          }
        } finally {
          isDecodingRef.current = false;
        }
      }
    }

    if (detectedCandidate) {
      setGuideText((prev) => (prev !== 'QR detected — hold steady…' ? 'QR detected — hold steady…' : prev));
    } else {
      setGuideText((prev) => (prev !== 'Align the QR inside the frame' ? 'Align the QR inside the frame' : prev));
    }

    animationFrameIdRef.current = requestAnimationFrame(processFrame);
  }, [
    barcodeDetector,
    displayType,
    isDebugMode,
    isScanningLocked,
    onMultiQrDetected,
    onScanSuccess,
    triggerAutoZoomIfNeeded,
    videoRef
  ]);

  const startScanning = useCallback(() => {
    isScanningActiveRef.current = true;
    if (animationFrameIdRef.current) cancelAnimationFrame(animationFrameIdRef.current);
    animationFrameIdRef.current = requestAnimationFrame(processFrame);
  }, [processFrame]);

  const stopScanning = useCallback(() => {
    isScanningActiveRef.current = false;
    if (animationFrameIdRef.current) {
      cancelAnimationFrame(animationFrameIdRef.current);
      animationFrameIdRef.current = null;
    }
  }, []);

  const triggerNextFrame = useCallback(() => {
    if (isScanningActiveRef.current && !isScanningLocked) {
      if (animationFrameIdRef.current) cancelAnimationFrame(animationFrameIdRef.current);
      animationFrameIdRef.current = requestAnimationFrame(processFrame);
    }
  }, [isScanningLocked, processFrame]);

  useEffect(() => {
    return () => {
      stopScanning();
    };
  }, [stopScanning]);

  return {
    guideText,
    setGuideText,
    diagHud,
    setDiagHud,
    diagHudRef,
    startScanning,
    stopScanning,
    triggerNextFrame,
    processFrame,
    activeEngine: activeEngineRef.current,
    canvasRef
  };
}
