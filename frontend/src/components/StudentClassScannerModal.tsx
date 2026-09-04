import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { 
  X, Camera, CheckCircle, AlertTriangle, RefreshCw, Zap, 
  Sparkles, Award, BookOpen, Clock, ShieldCheck 
} from 'lucide-react';
import { apiRequest } from '../services/api';
import { getOrCreateDeviceCredentials } from '../services/deviceCredential';

interface StudentClassScannerModalProps {
  onClose: () => void;
  onScanComplete: () => void;
}

export const StudentClassScannerModal: React.FC<StudentClassScannerModalProps> = ({
  onClose,
  onScanComplete
}) => {
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [successResult, setSuccessResult] = useState<any>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');

  const html5QrcodeRef = useRef<Html5Qrcode | null>(null);
  const scannerContainerId = 'student-class-qr-reader';
  const isScanningLockedRef = useRef<boolean>(false);

  // Sound and Haptic feedback
  const triggerFeedback = (isSuccess: boolean) => {
    try {
      if (navigator.vibrate) {
        navigator.vibrate(isSuccess ? [100, 50, 100] : [300]);
      }
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = isSuccess ? 'sine' : 'sawtooth';
      osc.frequency.setValueAtTime(isSuccess ? 880 : 250, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + (isSuccess ? 0.2 : 0.35));
    } catch {}
  };

  const handleScanSuccess = async (decodedText: string) => {
    if (isScanningLockedRef.current || isSubmitting) return;

    const trimmed = decodedText.trim();
    if (!trimmed.startsWith('SNIST-SES|')) {
      // Ignore random non-classroom QR codes quietly
      return;
    }

    isScanningLockedRef.current = true;
    setIsSubmitting(true);
    setScanError(null);

    try {
      const deviceCred = getOrCreateDeviceCredentials();
      const res: any = await apiRequest('/student/scan-session', {
        method: 'POST',
        body: JSON.stringify({
          session_token: trimmed,
          device_uuid: deviceCred?.device_public_id || ''
        })
      });

      triggerFeedback(true);
      setSuccessResult(res);

      // Stop camera once successfully processed
      stopCamera();
    } catch (err: any) {
      triggerFeedback(false);
      const msg = err.message || 'Scan verification failed. Please try again.';
      setScanError(msg);
      // Unlock after 2 seconds to allow rescanning the fresh code
      setTimeout(() => {
        isScanningLockedRef.current = false;
        setIsSubmitting(false);
      }, 2000);
    }
  };

  const startCamera = async () => {
    try {
      setCameraError(null);
      if (html5QrcodeRef.current) {
        try {
          await html5QrcodeRef.current.stop();
        } catch {}
      }

      const scanner = new Html5Qrcode(scannerContainerId);
      html5QrcodeRef.current = scanner;

      await scanner.start(
        { facingMode: facingMode },
        {
          fps: 24,
          qrbox: { width: 260, height: 260 },
          aspectRatio: 1.0
        },
        (decodedText) => {
          handleScanSuccess(decodedText);
        },
        () => {
          // Ignore individual frame non-matches
        }
      );

      setCameraActive(true);
    } catch (err: any) {
      console.error('Camera initialization error:', err);
      setCameraError(err.message || 'Unable to access device camera. Please check camera permissions.');
      setCameraActive(false);
    }
  };

  const stopCamera = async () => {
    if (html5QrcodeRef.current) {
      try {
        await html5QrcodeRef.current.stop();
        html5QrcodeRef.current.clear();
      } catch {}
      html5QrcodeRef.current = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
    };
  }, [facingMode]);

  const toggleFacingMode = () => {
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-white text-slate-900 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col max-h-[90vh] font-sans">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/80">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#001e40] text-white flex items-center justify-center font-bold text-xs">
              <Camera className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-extrabold text-sm text-[#001e40]">Scan Classroom QR</h3>
              <p className="text-[11px] text-slate-500 font-medium">Point your camera at the projector screen</p>
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
        <div className="p-6 flex-1 flex flex-col items-center justify-center">
          {successResult ? (
            /* Celebration Success Screen */
            <div className="text-center space-y-4 py-4 animate-in fade-in zoom-in-95 duration-300">
              <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
                <CheckCircle className="w-12 h-12 animate-bounce" />
              </div>

              <div>
                <span className={`inline-block px-3 py-1 rounded-full text-xs font-black uppercase mb-1 ${
                  successResult.status === 'ALREADY_MARKED'
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-emerald-100 text-emerald-800'
                }`}>
                  {successResult.status === 'ALREADY_MARKED' ? 'Already Recorded' : 'Verified Present'}
                </span>
                <h2 className="text-2xl font-black text-[#001e40]">
                  {successResult.status === 'ALREADY_MARKED' ? 'Attendance Recorded' : 'Marked Present!'}
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
            <div className="w-full flex flex-col items-center space-y-4">
              
              {/* Camera Video Viewfinder */}
              <div className="relative w-full max-w-[280px] h-[280px] rounded-3xl overflow-hidden bg-slate-950 border-4 border-[#001e40] shadow-xl">
                <div id={scannerContainerId} className="w-full h-full" />

                {/* Targeting Crosshair Lines */}
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <div className="w-48 h-48 border-2 border-dashed border-amber-400/70 rounded-2xl animate-pulse" />
                </div>

                {isSubmitting && (
                  <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center gap-2 text-white">
                    <RefreshCw className="w-8 h-8 text-amber-400 animate-spin" />
                    <span className="text-xs font-bold font-mono">Verifying Attendance...</span>
                  </div>
                )}
              </div>

              {/* Status or Error Notifications */}
              {scanError ? (
                <div className="w-full p-3 bg-rose-50 border border-rose-200 rounded-2xl text-xs text-rose-700 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
                  <p className="font-medium">{scanError}</p>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-slate-500 font-medium text-center">
                  <Sparkles className="w-4 h-4 text-amber-500" />
                  <span>Aim camera directly at the 10-second rotating code</span>
                </div>
              )}

              {/* Camera Controls */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={toggleFacingMode}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Flip Camera</span>
                </button>
              </div>

              {cameraError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-2xl text-xs text-rose-600 text-center">
                  {cameraError}
                </div>
              )}

            </div>
          )}
        </div>

      </div>
    </div>
  );
};
