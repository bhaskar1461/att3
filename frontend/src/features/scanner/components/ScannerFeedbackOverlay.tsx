import React from 'react';
import { Camera, RefreshCw, AlertTriangle, Clock, ShieldCheck, User, Copy, Mail, Smartphone, HelpCircle } from 'lucide-react';
import { ScannerFlowState } from '../hooks/useAttendanceSubmission';
import { SubmittingStage, ScannerErrorInfo, ErrorCode } from '../state/scannerFSM';

export interface ScannerFeedbackOverlayProps {
  flowState: ScannerFlowState;
  submittingStage?: SubmittingStage;
  errorInfo?: ScannerErrorInfo | null;
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
  upgradeTicket?: string | null;
  isInlineEnrolling: boolean;
  rebindMaskedEmail: string;
  onCancelSubmitting: () => void;
  onResetAfterTimeoutOrStale: () => void;
  onInlineEnroll: () => void;
  onRetrySubmit?: () => void;
  onRetryCamera?: () => void;
  onCopySafariLink: () => void;
  onShowRollCard: () => void;
  onClose: () => void;
}

import { useRenderCounter } from '../../../dev/diagnostics';

export const ScannerFeedbackOverlay: React.FC<ScannerFeedbackOverlayProps> = ({
  flowState,
  submittingStage = 'validating_token',
  errorInfo,
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
  upgradeTicket,
  isInlineEnrolling,
  rebindMaskedEmail,
  onCancelSubmitting,
  onResetAfterTimeoutOrStale,
  onInlineEnroll,
  onRetrySubmit,
  onRetryCamera,
  onCopySafariLink,
  onShowRollCard,
  onClose
}) => {
  useRenderCounter('ScannerFeedbackOverlay');
  return (
    <>
      {/* 1. Submitting Staged Progress Overlay */}
      {flowState === 'SUBMITTING' && (
        <div
          className="absolute inset-0 bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center gap-3.5 text-white animate-in fade-in duration-150 px-6 text-center"
          style={{ zIndex: 40 }}
        >
          <div className="w-12 h-12 rounded-full border-3 border-emerald-400 border-t-transparent animate-spin" />
          
          <div className="space-y-1">
            <h4 className="text-sm font-bold tracking-wide">
              {submittingStage === 'validating_token' && 'Validating Security Token…'}
              {submittingStage === 'signing' && 'Signing Cryptographic Proof…'}
              {submittingStage === 'submitting' && 'Recording Attendance…'}
              {submittingStage === 'confirming' && 'Confirming Attendance Record…'}
              {!submittingStage && 'Marking Attendance…'}
            </h4>
            <p className="text-xs text-white/70 max-w-xs leading-relaxed">
              {submittingStage === 'validating_token' && 'Verifying active session and token signature'}
              {submittingStage === 'signing' && 'Hardware proof-of-possession verification'}
              {submittingStage === 'submitting' && 'Server-authoritative database registration'}
              {submittingStage === 'confirming' && 'Awaiting asynchronous commit confirmation'}
              {!submittingStage && 'Contacting attendance server securely…'}
            </p>
          </div>

          <div className="w-48 bg-white/20 rounded-full h-1.5 overflow-hidden mt-1">
            <div
              className="bg-emerald-400 h-1.5 rounded-full transition-all duration-300"
              style={{
                width:
                  submittingStage === 'validating_token' ? '25%' :
                  submittingStage === 'signing' ? '50%' :
                  submittingStage === 'submitting' ? '75%' :
                  submittingStage === 'confirming' ? '95%' : '50%'
              }}
            />
          </div>

          <button
            type="button"
            onClick={onCancelSubmitting}
            className="mt-2 px-3.5 py-1.5 bg-white/15 hover:bg-white/25 text-white/90 text-[11px] font-semibold rounded-full border border-white/20 transition active:scale-95 cursor-pointer"
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
                    ? 'Turn OFF Brave Shields (lion icon in address bar) and tap Retry, or open in Safari.'
                    : `Enable camera access in ${browserInfo.name} settings and tap Retry.`
                  : 'Allow camera access to scan the classroom QR.')}
            </p>
          </div>

          <div className="flex flex-col gap-2 w-full max-w-xs pt-1">
            <button
              type="button"
              onClick={onRetryCamera || onResetAfterTimeoutOrStale}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-lg transition flex items-center justify-center gap-2 cursor-pointer active:scale-95"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry Camera Permission</span>
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
  submittingStage?: SubmittingStage;
  errorInfo?: ScannerErrorInfo | null;
  guideText: string;
  cameraError: string | null;
  permissionState: string;
  isCameraInUse: boolean;
  browserInfo: { isIOS: boolean; name: string; isBrave: boolean; isSafari: boolean };
  copiedSafariLink: boolean;
  rateLimitSecondsLeft: number;
  scanError: string | null;
  scanErrorCode: string | null;
  upgradeTicket?: string | null;
  isInlineEnrolling: boolean;
  rebindMaskedEmail: string;
  onResetAfterTimeoutOrStale: () => void;
  onInlineEnroll: () => void;
  onRetrySubmit?: () => void;
  onRetryCamera?: () => void;
  onCopySafariLink: () => void;
  onShowRollCard: () => void;
  onClose: () => void;
}

export type ScanErrorCode = ErrorCode | 'unknown';

export interface CardCtx {
  ticket?: string | null;
  requestId?: string;
  retryAfterSeconds?: number;
  message?: string;
  isInlineEnrolling?: boolean;
  onEnroll: () => void;
  onLater: () => void;
  onRescan: () => void;
  onRetrySubmit?: () => void;
  onRetryCamera?: () => void;
  onReLogin?: () => void;
  onContactSupport?: () => void;
}

export const UpgradeRequiredCard: React.FC<CardCtx> = ({ onEnroll, onLater, isInlineEnrolling }) => (
  <div className="w-full p-2.5 rounded-xl text-xs font-medium bg-indigo-50 border border-indigo-200 text-indigo-900 space-y-2 animate-in fade-in">
    <div className="flex items-center justify-center gap-1.5">
      <ShieldCheck className="w-4 h-4 text-indigo-600 shrink-0" />
      <span>One-time device security upgrade</span>
    </div>
    <div className="flex gap-2">
      <button
        type="button"
        onClick={onEnroll}
        disabled={isInlineEnrolling}
        className="flex-1 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
      >
        <ShieldCheck className="w-3.5 h-3.5" />
        <span>{isInlineEnrolling ? 'Enrolling…' : 'Enroll now'}</span>
      </button>
      <button
        type="button"
        onClick={onLater}
        className="px-3 py-1.5 bg-indigo-100 hover:bg-indigo-200 text-indigo-800 rounded-lg text-xs font-bold transition cursor-pointer"
      >
        <span>Later</span>
      </button>
    </div>
  </div>
);

export const NoActiveBindingCard: React.FC<CardCtx> = ({ onEnroll, onLater, isInlineEnrolling }) => (
  <div className="w-full p-2.5 rounded-xl text-xs font-medium bg-cyan-50 border border-cyan-200 text-cyan-900 space-y-2 animate-in fade-in">
    <div className="flex items-center justify-center gap-1.5">
      <Smartphone className="w-4 h-4 text-cyan-600 shrink-0" />
      <span>Device not enrolled — enroll to mark attendance</span>
    </div>
    <p className="text-[10px] text-cyan-700 leading-relaxed">
      This device hasn't been linked to your account yet. Tap "Enroll now" to register it (takes ~3 seconds).
    </p>
    <div className="flex gap-2">
      <button
        type="button"
        onClick={onEnroll}
        disabled={isInlineEnrolling}
        className="flex-1 py-1.5 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
      >
        <Smartphone className="w-3.5 h-3.5" />
        <span>{isInlineEnrolling ? 'Enrolling…' : 'Enroll now'}</span>
      </button>
      <button
        type="button"
        onClick={onLater}
        className="px-3 py-1.5 bg-cyan-100 hover:bg-cyan-200 text-cyan-800 rounded-lg text-xs font-bold transition cursor-pointer"
      >
        <span>Later</span>
      </button>
    </div>
  </div>
);

export const QrExpiredCard: React.FC<CardCtx> = ({ onRescan }) => (
  <div className="w-full p-2.5 rounded-xl text-xs font-medium bg-blue-50 border border-blue-200 text-blue-800 space-y-2 animate-in fade-in">
    <div className="flex items-center justify-center gap-1.5">
      <RefreshCw className="w-3.5 h-3.5 text-blue-600 shrink-0 animate-spin" />
      <span>QR expired — rescan</span>
    </div>
    <button
      type="button"
      onClick={onRescan}
      className="w-full py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 shadow-sm"
    >
      <RefreshCw className="w-3 h-3" />
      <span>Rescan</span>
    </button>
  </div>
);

export const ClientAbortCard: React.FC<CardCtx> = ({ onRetrySubmit, onRescan }) => (
  <div className="w-full p-2.5 rounded-xl text-xs font-medium bg-amber-50 border border-amber-300 text-amber-900 space-y-2 animate-in fade-in">
    <div className="flex items-center justify-center gap-1.5">
      <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
      <span>Taking longer than usual</span>
    </div>
    <div className="flex gap-2">
      <button
        type="button"
        onClick={onRetrySubmit || onRescan}
        className="flex-1 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
      >
        <RefreshCw className="w-3 h-3" />
        <span>Retry submit</span>
      </button>
      <button
        type="button"
        onClick={onRescan}
        className="flex-1 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
      >
        <span>Rescan QR</span>
      </button>
    </div>
  </div>
);

export const ServerTokenExpiredCard: React.FC<CardCtx> = ({ onReLogin }) => (
  <div className="w-full p-2.5 rounded-xl text-xs font-medium bg-rose-50 border border-rose-200 text-rose-800 space-y-2 animate-in fade-in">
    <div className="flex items-center justify-center gap-1.5">
      <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
      <span>Session expired — sign in again</span>
    </div>
    <button
      type="button"
      onClick={onReLogin || (() => { window.location.href = '/login?reason=token_expired'; })}
      className="w-full py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
    >
      <span>Re-login</span>
    </button>
  </div>
);

export const BindingRevokedCard: React.FC<CardCtx> = ({ onEnroll, onContactSupport, requestId }) => (
  <div className="w-full p-2.5 rounded-xl text-xs font-medium bg-rose-50 border border-rose-300 text-rose-900 space-y-2 animate-in fade-in">
    <div className="flex items-center justify-center gap-1.5">
      <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
      <span>This device must be re-enrolled</span>
    </div>
    {requestId && (
      <p className="text-[10px] text-rose-700 font-mono">Request ID: {requestId}</p>
    )}
    <div className="flex gap-2">
      <button
        type="button"
        onClick={onEnroll}
        className="flex-1 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition cursor-pointer active:scale-95"
      >
        <span>Re-enroll</span>
      </button>
      <button
        type="button"
        onClick={onContactSupport}
        className="flex-1 py-1.5 bg-rose-100 hover:bg-rose-200 text-rose-800 rounded-lg text-xs font-bold transition cursor-pointer"
      >
        <span>Contact support</span>
      </button>
    </div>
  </div>
);

export const QrTypeInvalidCard: React.FC<CardCtx> = ({ onRescan }) => (
  <div className="w-full p-2.5 rounded-xl text-xs font-medium bg-amber-50 border border-amber-200 text-amber-900 space-y-2 animate-in fade-in">
    <div className="flex items-center justify-center gap-1.5">
      <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
      <span>Wrong QR — scan the live session QR</span>
    </div>
    <button
      type="button"
      onClick={onRescan}
      className="w-full py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
    >
      <RefreshCw className="w-3 h-3" />
      <span>Rescan</span>
    </button>
  </div>
);

export const SessionNotActiveCard: React.FC<CardCtx> = ({ onRescan }) => (
  <div className="w-full p-2.5 rounded-xl text-xs font-medium bg-amber-50 border border-amber-200 text-amber-900 space-y-2 animate-in fade-in">
    <div className="flex items-center justify-center gap-1.5">
      <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
      <span>Session ended server-side</span>
    </div>
    <button
      type="button"
      onClick={onRescan}
      className="w-full py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
    >
      <RefreshCw className="w-3 h-3" />
      <span>Rescan</span>
    </button>
  </div>
);

export const OtpCooldownCard: React.FC<CardCtx> = ({ retryAfterSeconds }) => (
  <div className="w-full p-2.5 rounded-xl text-xs font-medium bg-amber-50 border border-amber-300 text-amber-900 space-y-2 animate-in fade-in">
    <div className="flex items-center justify-center gap-1.5">
      <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0 animate-pulse" />
      <span>Resend too soon; please wait {retryAfterSeconds || 30}s</span>
    </div>
  </div>
);

export const OtpDeliveryFailedCard: React.FC<CardCtx> = ({ onEnroll, onContactSupport }) => (
  <div className="w-full p-2.5 rounded-xl text-xs font-medium bg-rose-50 border border-rose-200 text-rose-800 space-y-2 animate-in fade-in">
    <div className="flex items-center justify-center gap-1.5">
      <Mail className="w-3.5 h-3.5 text-rose-600 shrink-0" />
      <span>Code not delivered</span>
    </div>
    <div className="flex gap-2">
      <button
        type="button"
        onClick={onEnroll}
        className="flex-1 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition cursor-pointer active:scale-95"
      >
        <span>Resend email</span>
      </button>
      <button
        type="button"
        onClick={onContactSupport}
        className="flex-1 py-1.5 bg-rose-100 hover:bg-rose-200 text-rose-800 rounded-lg text-xs font-bold transition cursor-pointer"
      >
        <span>Send SMS</span>
      </button>
    </div>
  </div>
);

export const SelfieStoreFailedCard: React.FC<CardCtx> = ({ onRescan }) => (
  <div className="w-full p-2.5 rounded-xl text-xs font-medium bg-rose-50 border border-rose-200 text-rose-800 space-y-2 animate-in fade-in">
    <div className="flex items-center justify-center gap-1.5">
      <Camera className="w-3.5 h-3.5 text-rose-600 shrink-0" />
      <span>Photo didn't save</span>
    </div>
    <button
      type="button"
      onClick={onRescan}
      className="w-full py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
    >
      <RefreshCw className="w-3 h-3" />
      <span>Retry upload</span>
    </button>
  </div>
);

export const JobNotFoundCard: React.FC<CardCtx> = ({ onRescan }) => (
  <div className="w-full p-2.5 rounded-xl text-xs font-medium bg-amber-50 border border-amber-200 text-amber-900 space-y-2 animate-in fade-in">
    <div className="flex items-center justify-center gap-1.5">
      <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
      <span>Attendance verification expired</span>
    </div>
    <button
      type="button"
      onClick={onRescan}
      className="w-full py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
    >
      <RefreshCw className="w-3 h-3" />
      <span>Rescan QR</span>
    </button>
  </div>
);

export const NetworkErrorCard: React.FC<CardCtx> = ({ onRescan }) => (
  <div className="w-full p-2.5 rounded-xl text-xs font-medium bg-rose-50 border border-rose-200 text-rose-700 space-y-2 animate-in fade-in">
    <div className="flex items-center justify-center gap-1.5">
      <AlertTriangle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
      <span>No connection</span>
    </div>
    <button
      type="button"
      onClick={onRescan}
      className="w-full py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
    >
      <RefreshCw className="w-3 h-3" />
      <span>Retry</span>
    </button>
  </div>
);

export const CameraErrorCard: React.FC<CardCtx> = ({ onRetryCamera, onRescan }) => (
  <div className="w-full p-2.5 rounded-xl text-xs font-medium bg-rose-50 border border-rose-200 text-rose-700 space-y-2 animate-in fade-in">
    <div className="flex items-center justify-center gap-1.5">
      <Camera className="w-3.5 h-3.5 text-rose-500 shrink-0" />
      <span>Camera unavailable</span>
    </div>
    <button
      type="button"
      onClick={onRetryCamera || onRescan}
      className="w-full py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
    >
      <RefreshCw className="w-3 h-3" />
      <span>Retry</span>
    </button>
  </div>
);

export const GenericErrorCard: React.FC<CardCtx> = ({ message, onRescan }) => (
  <div className="w-full p-2.5 rounded-xl text-xs font-medium bg-rose-50 border border-rose-200 text-rose-700 space-y-2 animate-in fade-in">
    <div className="flex items-center justify-center gap-1.5">
      <AlertTriangle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
      <span>{message || 'An error occurred during scanning'}</span>
    </div>
    <button
      type="button"
      onClick={onRescan}
      className="w-full py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
    >
      <RefreshCw className="w-3 h-3" />
      <span>Retry</span>
    </button>
  </div>
);

export const UnknownCard: React.FC<CardCtx> = ({ message, onRescan }) => (
  <div className="w-full p-2.5 rounded-xl text-xs font-medium bg-rose-50 border border-rose-200 text-rose-700 space-y-2 animate-in fade-in">
    <div className="flex items-center justify-center gap-1.5">
      <AlertTriangle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
      <span>{message || 'Something went wrong'}</span>
    </div>
    <button
      type="button"
      onClick={onRescan}
      className="w-full py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
    >
      <RefreshCw className="w-3 h-3" />
      <span>Retry</span>
    </button>
  </div>
);

// Compiler-enforced totality: Adding a code to ScanErrorCode without adding it here = red build!
export const ERROR_CARDS: Record<ScanErrorCode, (ctx: CardCtx) => JSX.Element> = {
  binding_upgrade_required: (ctx) => <UpgradeRequiredCard {...ctx} />,
  no_active_binding: (ctx) => <NoActiveBindingCard {...ctx} />,
  qr_expired: (ctx) => <QrExpiredCard {...ctx} />,
  client_abort: (ctx) => <ClientAbortCard {...ctx} />,
  server_token_expired: (ctx) => <ServerTokenExpiredCard {...ctx} />,
  binding_revoked_post_grace: (ctx) => <BindingRevokedCard {...ctx} />,
  qr_type_invalid: (ctx) => <QrTypeInvalidCard {...ctx} />,
  session_not_active: (ctx) => <SessionNotActiveCard {...ctx} />,
  otp_cooldown: (ctx) => <OtpCooldownCard {...ctx} />,
  otp_delivery_failed: (ctx) => <OtpDeliveryFailedCard {...ctx} />,
  selfie_store_failed: (ctx) => <SelfieStoreFailedCard {...ctx} />,
  job_not_found: (ctx) => <JobNotFoundCard {...ctx} />,
  network_error: (ctx) => <NetworkErrorCard {...ctx} />,
  camera_error: (ctx) => <CameraErrorCard {...ctx} />,
  generic_error: (ctx) => <GenericErrorCard {...ctx} />,
  unknown: (ctx) => <UnknownCard {...ctx} />,
};

export const ScannerBottomPanel: React.FC<ScannerBottomPanelProps> = ({
  flowState,
  submittingStage = 'validating_token',
  errorInfo,
  guideText,
  cameraError,
  permissionState,
  isCameraInUse,
  browserInfo,
  copiedSafariLink,
  rateLimitSecondsLeft,
  scanError,
  scanErrorCode,
  upgradeTicket,
  isInlineEnrolling,
  rebindMaskedEmail,
  onResetAfterTimeoutOrStale,
  onInlineEnroll,
  onRetrySubmit,
  onRetryCamera,
  onCopySafariLink,
  onShowRollCard,
  onClose
}) => {
  const isCameraBlocked = !!cameraError || permissionState === 'denied';

  // Section 3.1 Taxonomy resolution
  const effectiveCode: ScanErrorCode = (
    (scanErrorCode as ScanErrorCode) ||
    (errorInfo?.code as ScanErrorCode) ||
    (flowState === 'BLOCKED' ? (scanErrorCode === 'no_active_binding' ? 'no_active_binding' : 'binding_upgrade_required') :
     flowState === 'TIMEOUT' ? 'client_abort' :
     flowState === 'STALE_QR' ? 'qr_expired' :
     flowState === 'ERROR' ? 'generic_error' :
     undefined)
  ) || 'unknown';

  const cardCtx: CardCtx = {
    ticket: upgradeTicket,
    requestId: errorInfo?.requestId,
    retryAfterSeconds: errorInfo?.retryAfterSeconds || rateLimitSecondsLeft,
    message: scanError || errorInfo?.message,
    isInlineEnrolling,
    onEnroll: onInlineEnroll,
    onLater: onResetAfterTimeoutOrStale,
    onRescan: onResetAfterTimeoutOrStale,
    onRetrySubmit,
    onRetryCamera,
    onContactSupport: onShowRollCard,
  };

  return (
    <div 
      className="w-full bg-white px-4 pt-3 pb-4 flex flex-col items-center text-center space-y-2 border-t border-slate-100 flex-shrink-0"
      style={{
        paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))',
        minHeight: '190px'
      }}
    >
      {isCameraBlocked ? (
        <div className="w-full space-y-2">
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-2xl text-left">
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
                ? 'Turn OFF Brave Shields (lion icon in address bar) and tap Retry, or switch to Safari.'
                : permissionState === 'denied'
                ? `Please enable camera in your ${browserInfo.name} settings and retry.`
                : isCameraInUse
                ? 'Another application is using your camera. Please close it and retry.'
                : cameraError || 'Could not connect to camera.'}
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 pt-1">
            <button
              type="button"
              onClick={onRetryCamera || onResetAfterTimeoutOrStale}
              className="flex-1 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-sm active:scale-95 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry Permission</span>
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
          <h3 className="font-extrabold text-sm text-[#001e40] leading-snug">
            {flowState === 'SUBMITTING' && (
              submittingStage === 'validating_token' ? 'Validating Token…' :
              submittingStage === 'signing' ? 'Signing Proof of Possession…' :
              submittingStage === 'submitting' ? 'Submitting Attendance…' :
              submittingStage === 'confirming' ? 'Confirming Attendance…' :
              'Submitting Attendance…'
            )}
            {flowState === 'TIMEOUT' && 'Submission Timed Out'}
            {flowState === 'STALE_QR' && 'Expired QR Code'}
            {flowState === 'RATE_LIMITED' && 'Scan Cooldown Active'}
            {flowState === 'BLOCKED' && 'One-Time Device Upgrade'}
            {flowState === 'ENROLLING' && 'Enrolling Device…'}
            {flowState === 'REBIND_OTP' && 'Verify New Device'}
            {(flowState === 'IDLE_SCANNING' || flowState === 'INITIALIZING' || flowState === 'DECODED' || flowState === 'ERROR') && guideText}
          </h3>

          <p className="text-xs text-slate-400 font-medium">
            {flowState === 'SUBMITTING' && (
              submittingStage === 'validating_token' ? 'Verifying live session token and validity' :
              submittingStage === 'signing' ? 'Generating cryptographic device proof' :
              submittingStage === 'submitting' ? 'Transmitting attendance to college server' :
              submittingStage === 'confirming' ? 'Awaiting commit verification' :
              'Contacting attendance server securely...'
            )}
            {flowState === 'TIMEOUT' && 'Taking longer than usual. You can retry or scan again.'}
            {flowState === 'STALE_QR' && 'QR expired. Waiting for projector rotation.'}
            {flowState === 'RATE_LIMITED' && `Please wait ${rateLimitSecondsLeft}s before scanning again.`}
            {flowState === 'BLOCKED' && 'This device needs a one-time security upgrade.'}
            {flowState === 'ENROLLING' && 'Registering cryptographic keys with the college server...'}
            {flowState === 'REBIND_OTP' && `Enter 6-digit code sent to ${rebindMaskedEmail}`}
            {(flowState === 'IDLE_SCANNING' || flowState === 'INITIALIZING' || flowState === 'DECODED' || flowState === 'ERROR') && 'Point your camera at the QR displayed by your faculty'}
          </p>

          {/* PERMANENTLY RESERVED SLOT (FIX-9: Stable Height Across All States) */}
          <div className="w-full min-h-[88px] flex flex-col justify-center">
            {flowState === 'RATE_LIMITED' ? (
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
            ) : flowState === 'ENROLLING' ? (
              <div className="w-full p-3 rounded-xl text-xs font-medium bg-cyan-50 border border-cyan-200 text-cyan-900 flex items-center justify-center gap-2 animate-in fade-in">
                <RefreshCw className="w-4 h-4 animate-spin text-cyan-600 shrink-0" />
                <span>Registering device keys with server…</span>
              </div>
            ) : (flowState === 'ERROR' || flowState === 'BLOCKED' || flowState === 'TIMEOUT' || flowState === 'STALE_QR') && effectiveCode ? (
              (ERROR_CARDS[effectiveCode] ?? ERROR_CARDS.unknown)(cardCtx)
            ) : (
              <div className="w-full h-[62px] invisible pointer-events-none select-none" aria-hidden="true" />
            )}
          </div>

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

