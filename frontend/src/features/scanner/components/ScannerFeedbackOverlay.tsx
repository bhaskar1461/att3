import React from 'react';
import { Camera, RefreshCw, X, AlertTriangle, Clock, ShieldCheck, User, Copy } from 'lucide-react';
import { ScannerFlowState } from '../hooks/useAttendanceSubmission';

export interface ScannerFeedbackOverlayProps {
  flowState: ScannerFlowState;
  guideText: string;
  cameraStarting: boolean;
  cameraError: string | null;
  permissionState: string;
  isCameraInUse: boolean;
  browserInfo: { isIOS: boolean; name: string; isBrave: boolean; isSafari: boolean };
  copiedSafariLink: boolean;
  rateLimitSecondsLeft: number;
  scanError: string | null;
  scanErrorCode: string | null;
  isInlineEnrolling: boolean;
  rebindMaskedEmail: string;
  onCancelSubmitting: () => void;
  onResetAfterTimeoutOrStale: () => void;
  onInlineEnroll: () => void;
  onCopySafariLink: () => void;
  onShowRollCard: () => void;
  onClose: () => void;
}

export const ScannerFeedbackOverlay: React.FC<ScannerFeedbackOverlayProps> = ({
  flowState,
  guideText,
  cameraStarting,
  cameraError,
  permissionState,
  isCameraInUse,
  browserInfo,
  copiedSafariLink,
  rateLimitSecondsLeft,
  scanError,
  scanErrorCode,
  isInlineEnrolling,
  rebindMaskedEmail,
  onCancelSubmitting,
  onResetAfterTimeoutOrStale,
  onInlineEnroll,
  onCopySafariLink,
  onShowRollCard,
  onClose
}) => {
  return (
    <>
      {/* 1. Submitting Overlay */}
      {flowState === 'SUBMITTING' && (
        <div
          className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center gap-3 text-white animate-in fade-in duration-150 px-4 text-center"
          style={{ zIndex: 40 }}
        >
          <div className="w-10 h-10 rounded-full border-3 border-emerald-400 border-t-transparent animate-spin" />
          <span className="text-xs font-bold tracking-wide">Marking Attendance…</span>
          <p className="text-[11px] text-white/70 max-w-xs">Contacting attendance server securely…</p>
          <button
            type="button"
            onClick={onCancelSubmitting}
            className="mt-1 px-3 py-1 bg-white/15 hover:bg-white/25 text-white/90 text-[11px] font-semibold rounded-full border border-white/20 transition active:scale-95 cursor-pointer"
          >
            Cancel
          </button>
        </div>
      )}

      {/* 2. Camera Starting Overlay */}
      {cameraStarting && !cameraError && (
        <div
          className="absolute inset-0 bg-slate-950/90 backdrop-blur-sm flex flex-col items-center justify-center gap-2.5 p-4 text-center"
          style={{ zIndex: 25 }}
        >
          <RefreshCw className="w-7 h-7 text-emerald-400 animate-spin" />
          <p className="text-xs font-bold text-white tracking-wide">Starting camera…</p>
        </div>
      )}

      {/* 3. Camera Blocked / Error In-Viewport State */}
      {(cameraError || permissionState === 'denied') && (
        <div
          className="absolute inset-0 bg-slate-950/95 flex flex-col items-center justify-center p-6 text-center space-y-3.5"
          style={{ zIndex: 25 }}
        >
          <div className="w-12 h-12 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center border border-rose-500/30">
            <Camera className="w-6 h-6 text-rose-400" />
          </div>
          <div className="space-y-1.5 max-w-xs">
            <h3 className="text-sm font-bold text-white">
              {browserInfo.isBrave && browserInfo.isIOS
                ? 'Camera blocked by Brave Shields'
                : permissionState === 'denied'
                ? `Camera blocked in ${browserInfo.name}`
                : 'Camera unavailable'}
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              {cameraError ||
                (permissionState === 'denied'
                  ? browserInfo.isBrave && browserInfo.isIOS
                    ? 'Turn OFF Brave Shields (lion icon in address bar) and tap Reload Page, or open in Safari.'
                    : `Enable camera access in ${browserInfo.name} settings and reload.`
                  : 'Allow camera access to scan the classroom QR.')}
            </p>
          </div>

          <div className="flex flex-col gap-2 w-full max-w-xs pt-1">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-lg transition flex items-center justify-center gap-2 cursor-pointer active:scale-95"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Reload Page (Reset Permission)</span>
            </button>

            {browserInfo.isIOS && !browserInfo.isSafari && (
              <button
                type="button"
                onClick={onCopySafariLink}
                className="w-full py-2 bg-indigo-600/90 hover:bg-indigo-600 text-white font-bold text-xs rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>{copiedSafariLink ? 'Copied! Open Safari & Paste' : 'Open in Safari (Copy Link)'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={onShowRollCard}
              className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <User className="w-3.5 h-3.5 text-amber-400" />
              <span>Show Roll No. for Verification</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export interface ScannerBottomPanelProps {
  flowState: ScannerFlowState;
  guideText: string;
  cameraError: string | null;
  permissionState: string;
  isCameraInUse: boolean;
  browserInfo: { isIOS: boolean; name: string; isBrave: boolean; isSafari: boolean };
  copiedSafariLink: boolean;
  rateLimitSecondsLeft: number;
  scanError: string | null;
  scanErrorCode: string | null;
  isInlineEnrolling: boolean;
  rebindMaskedEmail: string;
  onResetAfterTimeoutOrStale: () => void;
  onInlineEnroll: () => void;
  onCopySafariLink: () => void;
  onShowRollCard: () => void;
  onClose: () => void;
}

export const ScannerBottomPanel: React.FC<ScannerBottomPanelProps> = ({
  flowState,
  guideText,
  cameraError,
  permissionState,
  isCameraInUse,
  browserInfo,
  copiedSafariLink,
  rateLimitSecondsLeft,
  scanError,
  scanErrorCode,
  isInlineEnrolling,
  rebindMaskedEmail,
  onResetAfterTimeoutOrStale,
  onInlineEnroll,
  onCopySafariLink,
  onShowRollCard,
  onClose
}) => {
  return (
    <div className="w-full p-4 sm:p-5 flex flex-col items-center text-center space-y-2 bg-white flex-shrink-0">
      {(cameraError || permissionState === 'denied' || permissionState === 'insecure_origin' || isCameraInUse) ? (
        <div className="w-full p-3.5 bg-rose-50 border border-rose-200 rounded-2xl text-center space-y-2.5 animate-in fade-in">
          <div className="w-8 h-8 bg-rose-100 text-rose-700 rounded-full flex items-center justify-center mx-auto">
            <AlertTriangle className="w-4 h-4 text-rose-600" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-rose-950">
              {browserInfo.isBrave && browserInfo.isIOS
                ? 'Brave Shields Blocking Camera'
                : permissionState === 'denied'
                ? `Camera Blocked in ${browserInfo.name}`
                : isCameraInUse
                ? 'Camera In Use'
                : 'Camera Unavailable'}
            </h4>
            <p className="text-[11px] text-rose-800 mt-0.5 leading-relaxed">
              {browserInfo.isBrave && browserInfo.isIOS
                ? 'Turn OFF Brave Shields (lion icon in address bar) and tap Reload Page, or switch to Safari.'
                : permissionState === 'denied'
                ? `Please enable camera in your ${browserInfo.name} settings and reload.`
                : isCameraInUse
                ? 'Another application is using your camera. Please close it and retry.'
                : cameraError || 'Could not connect to camera.'}
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 pt-1">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="flex-1 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-sm active:scale-95 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Reload Page</span>
            </button>
            {browserInfo.isIOS && !browserInfo.isSafari && (
              <button
                type="button"
                onClick={onCopySafariLink}
                className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-sm active:scale-95 cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>{copiedSafariLink ? 'Copied Link!' : 'Use Safari'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onShowRollCard}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1"
            >
              <User className="w-3 h-3 text-slate-500" />
              <span>Show Roll No.</span>
            </button>
          </div>
        </div>
      ) : (
        <>
          <h3 className="font-extrabold text-sm text-[#001e40]">
            {flowState === 'SUBMITTING' && 'Marking Attendance…'}
            {flowState === 'TIMEOUT' && 'Submission Timed Out'}
            {flowState === 'STALE_QR' && 'Expired QR Code'}
            {flowState === 'RATE_LIMITED' && 'Scan Cooldown Active'}
            {flowState === 'BLOCKED' && 'Device Not Linked'}
            {flowState === 'ENROLLING' && 'Enrolling Device…'}
            {flowState === 'REBIND_OTP' && 'Verify New Device'}
            {(flowState === 'IDLE_SCANNING' || flowState === 'INITIALIZING' || flowState === 'DECODED' || flowState === 'ERROR') && guideText}
          </h3>
          <p className="text-xs text-slate-400 font-medium">
            {flowState === 'SUBMITTING' && 'Contacting attendance server securely...'}
            {flowState === 'TIMEOUT' && 'Network delayed; token expired. Scan the current screen QR.'}
            {flowState === 'STALE_QR' && 'Projector rotated. Point camera at the refreshed classroom QR.'}
            {flowState === 'RATE_LIMITED' && `Please wait ${rateLimitSecondsLeft}s before scanning again.`}
            {flowState === 'BLOCKED' && 'Link this device to record attendance for your roll number.'}
            {flowState === 'ENROLLING' && 'Generating crypto keys and registering with college server...'}
            {flowState === 'REBIND_OTP' && `Enter 6-digit code sent to ${rebindMaskedEmail}`}
            {(flowState === 'IDLE_SCANNING' || flowState === 'INITIALIZING' || flowState === 'DECODED' || flowState === 'ERROR') && 'Point your camera at the QR displayed by your faculty'}
          </p>

          {/* State-specific Alert / Action Banner */}
          {flowState === 'TIMEOUT' && (
            <div className="w-full p-2.5 rounded-xl text-xs font-medium bg-amber-50 border border-amber-300 text-amber-900 space-y-2 animate-in fade-in">
              <div className="flex items-center justify-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span>Attendance request timed out. Discarded stale token.</span>
              </div>
              <button
                type="button"
                onClick={onResetAfterTimeoutOrStale}
                className="w-full py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Scan Current QR</span>
              </button>
            </div>
          )}

          {flowState === 'STALE_QR' && (
            <div className="w-full p-2.5 rounded-xl text-xs font-medium bg-blue-50 border border-blue-200 text-blue-800 space-y-2 animate-in fade-in">
              <div className="flex items-center justify-center gap-1.5">
                <RefreshCw className="w-3.5 h-3.5 text-blue-600 shrink-0 animate-spin" />
                <span>QR rotated on screen. Point camera at the refreshed code.</span>
              </div>
              <button
                type="button"
                onClick={onResetAfterTimeoutOrStale}
                className="w-full py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 shadow-sm"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Tap to Rescan Now</span>
              </button>
            </div>
          )}

          {flowState === 'RATE_LIMITED' && (
            <div className="w-full p-2.5 rounded-xl text-xs font-medium bg-amber-50 border border-amber-300 text-amber-900 space-y-2 animate-in fade-in">
              <div className="flex items-center justify-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0 animate-pulse" />
                <span>Too many scan attempts. Cooldown: {rateLimitSecondsLeft}s</span>
              </div>
              <div className="w-full bg-amber-200/60 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-amber-500 h-1.5 rounded-full transition-all duration-1000"
                  style={{ width: `${Math.min(100, Math.max(0, (rateLimitSecondsLeft / 20) * 100))}%` }}
                />
              </div>
            </div>
          )}

          {flowState === 'BLOCKED' && (
            <div className="w-full p-2.5 rounded-xl text-xs font-medium bg-indigo-50 border border-indigo-200 text-indigo-900 space-y-2 animate-in fade-in">
              <div className="flex items-center justify-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-indigo-600 shrink-0" />
                <span>This device is not linked. Please enroll this device to record attendance.</span>
              </div>
              <button
                type="button"
                onClick={onInlineEnroll}
                disabled={isInlineEnrolling}
                className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-sm active:scale-95 cursor-pointer"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>{isInlineEnrolling ? 'Enrolling Device…' : 'Enroll this device'}</span>
              </button>
            </div>
          )}

          {flowState === 'ERROR' && scanError && (
            <div className="w-full p-2.5 rounded-xl text-xs font-medium bg-rose-50 border border-rose-200 text-rose-700 space-y-2 animate-in fade-in">
              <div className="flex items-center justify-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                <span>{scanError}</span>
              </div>
              {scanErrorCode === 'no_active_binding' && (
                <button
                  type="button"
                  onClick={onInlineEnroll}
                  disabled={isInlineEnrolling}
                  className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-sm active:scale-95 cursor-pointer"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>{isInlineEnrolling ? 'Enrolling Device…' : 'Enroll this device'}</span>
                </button>
              )}
            </div>
          )}

          {/* Actionable Option: Having trouble -> Show Roll Number to Faculty */}
          <div className="pt-2 flex items-center justify-between w-full border-t border-slate-100 mt-1">
            <button
              type="button"
              onClick={onShowRollCard}
              className="text-xs text-slate-500 hover:text-[#001e40] font-semibold transition cursor-pointer flex items-center gap-1"
            >
              <User className="w-3.5 h-3.5 text-slate-400" />
              <span>Can't scan? Show Roll Number</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="text-xs text-slate-400 hover:text-slate-600 font-medium transition cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
};
