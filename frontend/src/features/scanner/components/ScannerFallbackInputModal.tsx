import React from 'react';
import { X, KeyRound, AlertTriangle, RefreshCw } from 'lucide-react';

interface ScannerFallbackInputModalProps {
  isOpen: boolean;
  fallbackCode: string;
  fallbackSubmitting: boolean;
  fallbackError: string | null;
  onCodeChange: (val: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}

export const ScannerFallbackInputModal: React.FC<ScannerFallbackInputModalProps> = ({
  isOpen,
  fallbackCode,
  fallbackSubmitting,
  fallbackError,
  onCodeChange,
  onSubmit,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl p-6 text-center space-y-4 border border-slate-100">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-indigo-600" />
            <h3 className="font-bold text-sm text-slate-900">Manual Code Entry</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-4 pt-2">
          <p className="text-xs text-slate-500 leading-relaxed text-left">
            Enter the 6-character short code displayed on the classroom screen below the rotating QR code:
          </p>

          <input
            type="text"
            maxLength={16}
            value={fallbackCode}
            onChange={(e) => onCodeChange(e.target.value.toUpperCase())}
            placeholder="e.g. A3F8K9"
            autoFocus
            className="w-full text-center text-2xl font-mono font-bold tracking-widest uppercase py-3.5 px-4 bg-slate-50 border-2 border-slate-200 focus:border-indigo-600 focus:bg-white rounded-2xl outline-none transition"
          />

          {fallbackError && (
            <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2 text-left">
              <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
              <span>{fallbackError}</span>
            </div>
          )}

          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={fallbackSubmitting || !fallbackCode.trim()}
              className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md transition flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              {fallbackSubmitting ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Verifying…</span>
                </>
              ) : (
                <span>Submit Code</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
