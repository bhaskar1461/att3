import React from 'react';
import { AlertCircle, CheckCircle, RefreshCw } from 'lucide-react';

interface ProjectorHeaderAlertsProps {
  showResyncedToast: boolean;
  wakeLockActive: boolean;
  isSessionEnded: boolean;
  showControls: boolean;
  isStale: boolean;
  onRetry: () => void;
}

export const ProjectorHeaderAlerts: React.FC<ProjectorHeaderAlertsProps> = ({
  showResyncedToast,
  wakeLockActive,
  isSessionEnded,
  showControls,
  isStale,
  onRetry,
}) => {
  return (
    <>
      {/* Transient Re-synced Toast from Watchdog */}
      {showResyncedToast && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 bg-emerald-600 text-white px-5 py-2.5 rounded-full shadow-2xl flex items-center gap-2 text-xs sm:text-sm font-bold animate-bounce border border-emerald-400">
          <CheckCircle className="w-4 h-4 text-emerald-200" />
          <span>Re-synced with Server Time</span>
        </div>
      )}

      {/* Wake Lock Inactive Hint Banner */}
      {!wakeLockActive && !isSessionEnded && showControls && (
        <div className="z-40 bg-amber-500/20 text-amber-200 border-b border-amber-500/30 px-4 py-1.5 text-center text-xs flex items-center justify-center gap-2 font-medium">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
          <span>Keep this window open & screen awake to ensure uninterrupted classroom scanning.</span>
        </div>
      )}

      {/* Red STALE Banner: Displayed if token refresh fails or network stalled */}
      {isStale && !isSessionEnded && (
        <div className="z-50 bg-rose-600 text-white px-6 py-2.5 flex items-center justify-between shadow-2xl font-sans border-b border-rose-400 animate-pulse">
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-5 h-5 text-amber-200 shrink-0" />
            <div>
              <span className="font-black tracking-wide uppercase text-xs sm:text-sm bg-rose-800/80 px-2 py-0.5 rounded mr-2">
                STALE - refresh failed
              </span>
              <span className="text-xs sm:text-sm font-medium text-rose-100">
                The projected QR code is expired. Retrying connection...
              </span>
            </div>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRetry();
            }}
            className="px-3.5 py-1 bg-white hover:bg-rose-50 text-rose-800 rounded-lg text-xs font-black shadow-md transition flex items-center gap-1.5 shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5 text-rose-700" />
            <span>Retry Now</span>
          </button>
        </div>
      )}
    </>
  );
};
