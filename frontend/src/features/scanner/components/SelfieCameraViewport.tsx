import React from 'react';
import { Camera, Check, RotateCcw, AlertTriangle, Sparkles, RefreshCw } from 'lucide-react';
import { SelfieState } from '../hooks/useSelfieCapture';
import { FaceDetectionResult } from '../../../utils/faceDetector';

interface SelfieCameraViewportProps {
  selfieState: SelfieState;
  guidanceMessage: string;
  errorMessage: string | null;
  countdownRemaining: number;
  detectionMetrics: FaceDetectionResult | null;
  capturedPreview: string | null;
  videoRef: React.RefObject<HTMLVideoElement>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  onManualCapture: () => void;
  onRetake: () => void;
  onRetryCamera: () => void;
}

import { useRenderCounter } from '../../../dev/diagnostics';

export const SelfieCameraViewport: React.FC<SelfieCameraViewportProps> = ({
  selfieState,
  guidanceMessage,
  errorMessage,
  countdownRemaining,
  detectionMetrics,
  capturedPreview,
  videoRef,
  canvasRef,
  onManualCapture,
  onRetake,
  onRetryCamera,
}) => {
  useRenderCounter('SelfieCameraViewport');
  const isLocked = selfieState === 'FACE_DETECTED' || selfieState === 'COUNTDOWN';
  const isMultipleFaces = detectionMetrics && detectionMetrics.faceCount > 1;
  const isCameraPermissionError =
    selfieState === 'CAMERA_PERMISSION_DENIED' ||
    selfieState === 'CAMERA_PERMISSION_PERMANENTLY_DENIED';
  const isUploadFailed = selfieState === 'UPLOAD_FAILED';

  return (
    <div className="relative mt-4 w-full aspect-square max-w-[300px] mx-auto rounded-3xl overflow-hidden bg-black/60 border border-white/10 shadow-inner flex items-center justify-center">
      {/* Hidden processing canvas */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Captured Image Preview */}
      {capturedPreview && (
        <img
          src={capturedPreview}
          alt="Captured selfie"
          className="absolute inset-0 w-full h-full object-cover z-20 animate-in fade-in"
        />
      )}

      {/* Video Feed */}
      <video
        ref={videoRef}
        className={`absolute inset-0 w-full h-full object-cover transform -scale-x-100 ${
          capturedPreview ? 'hidden' : 'block'
        }`}
        playsInline
        muted
        autoPlay
      />

      {/* ── Oval Head Guide Overlay ── */}
      {!capturedPreview && !isCameraPermissionError && (
        <div className="absolute inset-0 pointer-events-none z-10 flex items-center justify-center">
          <div
            className={`w-[56%] h-[74%] rounded-[50%] border-2 transition-all duration-300 relative ${
              isLocked
                ? 'border-emerald-400 shadow-[0_0_24px_rgba(52,211,153,0.5)]'
                : isMultipleFaces
                ? 'border-amber-400 shadow-[0_0_16px_rgba(251,191,36,0.4)]'
                : 'border-cyan-400/80 shadow-[0_0_12px_rgba(34,211,238,0.25)]'
            }`}
          >
            {/* Corner Alignment Crosshairs */}
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-4 h-0.5 bg-white/70" />
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-4 h-0.5 bg-white/70" />
            <div className="absolute -left-1 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-white/70" />
            <div className="absolute -right-1 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-white/70" />

            {/* Scanning line animation when searching */}
            {selfieState === 'FACE_DETECTING' && (
              <div className="absolute inset-x-2 h-0.5 bg-gradient-to-r from-transparent via-cyan-400 to-transparent animate-bounce opacity-70 top-1/3" />
            )}
          </div>
        </div>
      )}

      {/* Countdown Display */}
      {selfieState === 'COUNTDOWN' && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/20 pointer-events-none">
          <div className="w-20 h-20 rounded-full bg-emerald-500/90 text-white font-black text-4xl flex items-center justify-center shadow-2xl animate-ping duration-1000">
            {countdownRemaining}
          </div>
        </div>
      )}

      {/* Camera Initializing Overlay */}
      {selfieState === 'CAMERA_INITIALIZING' && (
        <div className="absolute inset-0 z-30 bg-black/80 flex flex-col items-center justify-center gap-2 text-slate-400">
          <RefreshCw className="w-6 h-6 animate-spin text-cyan-400" />
          <span className="text-xs font-medium">Opening camera…</span>
        </div>
      )}

      {/* Camera Permission Denied Overlay */}
      {isCameraPermissionError && (
        <div className="absolute inset-0 z-30 bg-black/90 p-4 flex flex-col items-center justify-center text-center gap-2 text-xs">
          <AlertTriangle className="w-8 h-8 text-amber-400" />
          <span className="font-semibold text-white">Camera Access Required</span>
          <p className="text-[11px] text-slate-400 leading-relaxed max-w-[200px]">
            {errorMessage || 'Front camera is unavailable.'}
          </p>
          <button
            type="button"
            onClick={onRetryCamera}
            className="mt-2 px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-white font-medium text-xs transition cursor-pointer"
          >
            Retry Camera
          </button>
        </div>
      )}

      {/* Upload Failed Notification Badge Over Preview */}
      {isUploadFailed && capturedPreview && (
        <div className="absolute top-3 inset-x-3 z-30 bg-black/85 backdrop-blur-md border border-emerald-500/40 rounded-2xl p-2.5 text-center text-xs text-white shadow-xl animate-in fade-in">
          <p className="font-bold text-[11px] text-emerald-400 flex items-center justify-center gap-1">
            <Check className="w-3.5 h-3.5" /> Photo Captured Locally
          </p>
          <p className="text-[10px] text-slate-300 mt-0.5">
            Cloud sync queued. Tap <span className="text-emerald-400 font-bold">Done</span> to complete attendance.
          </p>
        </div>
      )}

      {/* Guidance Pill at Bottom of Viewport */}
      {!capturedPreview && (
        <div className="absolute bottom-2.5 inset-x-3 z-20 flex justify-center pointer-events-none">
          <div className="px-3 py-1 bg-black/65 backdrop-blur-md rounded-full border border-white/10 text-[11px] font-medium text-white shadow-md flex items-center gap-1.5 max-w-[90%] truncate">
            {isLocked ? (
              <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            ) : (
              <Sparkles className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            )}
            <span className="truncate">{guidanceMessage}</span>
          </div>
        </div>
      )}
    </div>
  );
};
