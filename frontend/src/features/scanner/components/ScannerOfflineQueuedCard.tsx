import React from 'react';
import { WifiOff, Clock, RefreshCw } from 'lucide-react';

interface ScannerOfflineQueuedCardProps {
  queuedSessionInfo: any;
  pendingQueueCount: number;
  isRetryingQueue: boolean;
  onRetryQueue: () => void;
  onDone: () => void;
}

export const ScannerOfflineQueuedCard: React.FC<ScannerOfflineQueuedCardProps> = ({
  queuedSessionInfo,
  pendingQueueCount,
  isRetryingQueue,
  onRetryQueue,
  onDone,
}) => {
  return (
    <div className="p-6 sm:p-8 flex flex-col items-center justify-center text-center space-y-5 animate-in fade-in duration-300 w-full">
      <div className="w-16 h-16 rounded-full bg-amber-50 border-2 border-amber-200 text-amber-600 flex items-center justify-center">
        <WifiOff className="w-8 h-8 text-amber-600" />
      </div>

      <div className="space-y-1">
        <span className="inline-block px-3 py-1 rounded-full text-xs font-bold tracking-wide uppercase bg-amber-100 text-amber-800">
          Saved Offline
        </span>
        <h2 className="text-xl font-bold text-slate-800">Attendance Queued</h2>
        <p className="text-xs text-slate-500 max-w-xs leading-relaxed">
          Your attendance has been cryptographically signed and securely saved locally. It will auto-sync once connection restores.
        </p>
      </div>

      <div className="w-full bg-slate-50 rounded-2xl p-4 border border-slate-200/80 text-left space-y-2 text-xs">
        <div className="flex justify-between items-center py-0.5">
          <span className="text-slate-500 font-medium">Session Code</span>
          <span className="font-bold text-slate-800 font-mono">
            {queuedSessionInfo?.code || queuedSessionInfo?.session_token?.slice(0, 8) || 'SAVED'}
          </span>
        </div>
        <div className="flex justify-between items-center py-0.5 border-t border-slate-200/50 pt-1.5">
          <span className="text-slate-500 font-medium">Queued Scans</span>
          <span className="font-semibold text-slate-700">
            {pendingQueueCount > 0 ? `${pendingQueueCount} pending` : 'Saved locally'}
          </span>
        </div>
        <div className="flex justify-between items-center py-0.5 border-t border-slate-200/50 pt-1.5">
          <span className="text-slate-500 font-medium">Saved At</span>
          <span className="font-semibold text-slate-700 flex items-center gap-1">
            <Clock className="w-3 h-3 text-slate-400" />
            <span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </span>
        </div>
      </div>

      <div className="w-full space-y-2 pt-2">
        {navigator.onLine && (
          <button
            type="button"
            disabled={isRetryingQueue}
            onClick={onRetryQueue}
            className="w-full py-3.5 bg-[#001e40] hover:bg-[#002f6c] text-white font-bold text-sm rounded-2xl shadow-lg transition flex items-center justify-center gap-2 active:scale-98 disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${isRetryingQueue ? 'animate-spin' : ''}`} />
            <span>{isRetryingQueue ? 'Submitting to Server…' : 'Sync Now to Server'}</span>
          </button>
        )}

        <button
          type="button"
          onClick={onDone}
          className="w-full py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm rounded-2xl transition active:scale-98 cursor-pointer"
        >
          Done
        </button>
      </div>
    </div>
  );
};
