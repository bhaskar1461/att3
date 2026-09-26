import React from 'react';
import {
  CheckCircle2,
  X,
  Sparkles,
  Camera,
  RotateCcw,
  ChevronRight,
  ShieldCheck,
} from 'lucide-react';
import { useSelfieCapture, SelfieState } from '../features/scanner/hooks/useSelfieCapture';
import { SelfieCameraViewport } from '../features/scanner/components/SelfieCameraViewport';

export type { SelfieState };

interface PostAttendanceSelfieModalProps {
  attendanceId: number;
  sessionId?: number;
  rollNumber: string;
  studentName?: string;
  subjectName?: string;
  onComplete: () => void;
  onSkip?: () => void;
}

export const PostAttendanceSelfieModal: React.FC<PostAttendanceSelfieModalProps> = ({
  attendanceId,
  sessionId,
  rollNumber,
  studentName,
  subjectName,
  onComplete,
  onSkip,
}) => {
  const {
    selfieState,
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
    executeCapture,
    handleSkip,
  } = useSelfieCapture({
    attendanceId,
    sessionId,
    rollNumber,
    onComplete,
    onSkip,
  });

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
            <span className="font-mono font-bold text-white text-xs">{rollNumber}</span>
            {studentName && (
              <span className="text-[11px] text-slate-400 ml-1.5 font-medium">({studentName})</span>
            )}
          </div>
          {subjectName && (
            <div className="text-right max-w-[140px] truncate">
              <span className="text-[9px] uppercase font-bold tracking-wider text-slate-400 block">
                Class
              </span>
              <span className="text-[11px] text-slate-300 font-medium truncate block">
                {subjectName}
              </span>
            </div>
          )}
        </div>

        {/* ── Camera Viewport Subcomponent ── */}
        <SelfieCameraViewport
          selfieState={selfieState}
          guidanceMessage={guidanceMessage}
          errorMessage={errorMessage}
          countdownRemaining={countdownRemaining}
          detectionMetrics={detectionMetrics}
          capturedPreview={capturedPreview}
          videoRef={videoRef}
          canvasRef={canvasRef}
          onManualCapture={executeCapture}
          onRetake={startCamera}
          onRetryCamera={startCamera}
        />

        {/* ── Bottom Controls Bar ── */}
        <div className="mt-4 space-y-2">
          {capturedPreview ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={startCamera}
                disabled={selfieState === 'UPLOAD_PENDING'}
                className="flex-1 py-3 bg-white/10 hover:bg-white/15 text-white font-bold text-xs rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Retake</span>
              </button>
              <button
                type="button"
                onClick={() => handleSkip('USER_CONFIRMED')}
                className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl transition flex items-center justify-center gap-1.5 shadow-md shadow-emerald-500/20 cursor-pointer"
              >
                <span>Done</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleSkip('USER_SKIPPED')}
                disabled={isSkipping}
                className="py-3 px-4 bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white font-medium text-xs rounded-xl transition cursor-pointer"
              >
                {isSkipping ? 'Skipping…' : 'Skip'}
              </button>
              <button
                type="button"
                onClick={executeCapture}
                disabled={selfieState === 'CAMERA_INITIALIZING' || selfieState === 'CAPTURING'}
                className="flex-1 py-3 bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-bold text-xs rounded-xl transition flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/20 active:scale-98 disabled:opacity-50 cursor-pointer"
              >
                <Camera className="w-4 h-4" />
                <span>Capture Photo</span>
              </button>
            </div>
          )}

          <div className="flex items-center justify-center gap-1.5 text-[10px] text-slate-400 pt-1">
            <ShieldCheck className="w-3 h-3 text-cyan-400" />
            <span>Encrypted institutional verification. Never shared externally.</span>
          </div>
        </div>
      </div>
    </div>
  );
};
