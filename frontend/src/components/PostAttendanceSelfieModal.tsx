import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Camera, CheckCircle2, AlertCircle, RefreshCw, X, ArrowRight, ShieldCheck, Sparkles } from 'lucide-react';
import { apiRequest } from '../services/api';

interface PostAttendanceSelfieModalProps {
  attendanceId: number;
  rollNumber: string;
  studentName?: string;
  subjectName?: string;
  onComplete: () => void;
  onSkip?: () => void;
}

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
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [isSkipping, setIsSkipping] = useState<boolean>(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<boolean>(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    try {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 640 }
        },
        audio: false
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (err: any) {
      console.warn('[Selfie] Camera acquisition failed:', err);
      setCameraError(
        err.name === 'NotAllowedError'
          ? 'Camera permission denied. You can skip selfie verification without losing attendance.'
          : 'Front camera unavailable. You may skip this step.'
      );
    }
  }, [stream]);

  const stopCamera = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  }, [stream]);

  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
    };
  }, []);

  // Handle capture
  const handleCapture = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 640;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Mirror image for user-facing camera
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    setCapturedImage(dataUrl);
    stopCamera();
  };

  // Auto countdown trigger
  const triggerAutoCountdown = () => {
    setCountdown(3);
    const interval = setInterval(() => {
      setCountdown(prev => {
        if (prev === null || prev <= 1) {
          clearInterval(interval);
          handleCapture();
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleRetake = () => {
    setCapturedImage(null);
    startCamera();
  };

  const handleUpload = async () => {
    if (!capturedImage) return;
    setIsUploading(true);
    try {
      // Convert dataUrl to blob
      const res = await fetch(capturedImage);
      const blob = await res.blob();
      const formData = new FormData();
      formData.append('file', blob, `${rollNumber}_selfie.jpg`);

      const token = localStorage.getItem('token');
      const response = await fetch(`/api/v1/attendance/records/${attendanceId}/selfie`, {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: formData
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.detail || 'Upload failed');
      }

      setUploadSuccess(true);
      setTimeout(() => {
        onComplete();
      }, 1200);
    } catch (err: any) {
      console.error('[Selfie Upload Error]:', err);
      // Even if upload fails, attendance remains valid
      setCameraError(`Upload failed: ${err.message || 'Network error'}. Your attendance is still recorded!`);
    } finally {
      setIsUploading(false);
    }
  };

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

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl p-6 text-center space-y-4 font-sans animate-in zoom-in-95">
        
        {/* Header Badge */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div className="text-left">
              <h3 className="font-extrabold text-sm text-[#001e40]">Attendance Confirmed ✅</h3>
              <p className="text-[11px] text-emerald-700 font-semibold">Marked PRESENT</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleSkip('USER_CLOSED')}
            className="p-1 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer"
            title="Skip and close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Informative Subtext */}
        <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3 text-left space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500 font-medium">Roll Number:</span>
            <span className="font-mono font-bold text-slate-800">{rollNumber}</span>
          </div>
          {subjectName && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500 font-medium">Class:</span>
              <span className="font-bold text-slate-800">{subjectName}</span>
            </div>
          )}
        </div>

        {uploadSuccess ? (
          <div className="py-8 space-y-3 animate-in fade-in zoom-in-95">
            <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
              <ShieldCheck className="w-10 h-10 animate-bounce" />
            </div>
            <h4 className="font-extrabold text-base text-[#001e40]">Selfie Verified & Stored!</h4>
            <p className="text-xs text-slate-500">Thank you. Your attendance verification is complete.</p>
          </div>
        ) : (
          <>
            {/* Viewfinder / Capture Box */}
            <div className="relative w-full aspect-square max-w-[280px] mx-auto rounded-3xl overflow-hidden bg-slate-900 border-4 border-slate-100 shadow-inner flex items-center justify-center">
              {capturedImage ? (
                <img
                  src={capturedImage}
                  alt="Captured Selfie"
                  className="w-full h-full object-cover"
                />
              ) : cameraError ? (
                <div className="p-4 text-center space-y-2 text-rose-200">
                  <AlertCircle className="w-8 h-8 mx-auto text-rose-400" />
                  <p className="text-xs">{cameraError}</p>
                </div>
              ) : (
                <>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover -scale-x-100"
                  />
                  {countdown !== null && (
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center">
                      <span className="font-mono font-black text-6xl text-white animate-ping">
                        {countdown}
                      </span>
                    </div>
                  )}
                  {/* Face outline guide */}
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                    <div className="w-44 h-56 border-2 border-dashed border-white/60 rounded-[50px]" />
                  </div>
                </>
              )}
            </div>

            <canvas ref={canvasRef} className="hidden" />

            {/* Action Buttons */}
            {capturedImage ? (
              <div className="space-y-2 pt-1">
                <button
                  type="button"
                  disabled={isUploading}
                  onClick={handleUpload}
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-2xl shadow-lg transition flex items-center justify-center gap-2 active:scale-98 disabled:opacity-50 cursor-pointer"
                >
                  {isUploading ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  <span>{isUploading ? 'Uploading Selfie...' : 'Confirm & Save Selfie'}</span>
                </button>
                <button
                  type="button"
                  disabled={isUploading}
                  onClick={handleRetake}
                  className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition cursor-pointer"
                >
                  Retake Photo
                </button>
              </div>
            ) : cameraError ? (
              <div className="space-y-2 pt-1">
                <button
                  type="button"
                  onClick={() => startCamera()}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-2xl shadow transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Retry Camera</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSkip('CAMERA_UNAVAILABLE')}
                  className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs rounded-xl transition cursor-pointer"
                >
                  Skip Selfie (Attendance Remains PRESENT)
                </button>
              </div>
            ) : (
              <div className="space-y-2 pt-1">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={countdown !== null}
                    onClick={handleCapture}
                    className="py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-2xl shadow transition flex items-center justify-center gap-1.5 active:scale-98 cursor-pointer"
                  >
                    <Camera className="w-4 h-4" />
                    <span>Take Photo</span>
                  </button>
                  <button
                    type="button"
                    disabled={countdown !== null}
                    onClick={triggerAutoCountdown}
                    className="py-3 bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-200 font-bold text-xs rounded-2xl transition flex items-center justify-center gap-1.5 active:scale-98 cursor-pointer"
                  >
                    <span>⏱ 3s Timer</span>
                  </button>
                </div>
                <button
                  type="button"
                  disabled={isSkipping}
                  onClick={() => handleSkip('USER_SKIPPED')}
                  className="w-full py-2.5 text-slate-400 hover:text-slate-600 font-semibold text-xs transition cursor-pointer"
                >
                  Skip Selfie for Now
                </button>
              </div>
            )}
          </>
        )}

      </div>
    </div>
  );
};
