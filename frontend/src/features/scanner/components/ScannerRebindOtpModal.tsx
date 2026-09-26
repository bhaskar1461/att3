import React from 'react';
import { X, ShieldCheck, AlertTriangle, RefreshCw } from 'lucide-react';

interface ScannerRebindOtpModalProps {
  isOpen: boolean;
  rebindOtpValue: string;
  rebindMaskedEmail: string;
  rebindOtpError: string | null;
  isSubmittingRebindOtp: boolean;
  onOtpChange: (val: string) => void;
  onConfirm: () => void;
  onResend: () => void;
  onClose: () => void;
}

export const ScannerRebindOtpModal: React.FC<ScannerRebindOtpModalProps> = ({
  isOpen,
  rebindOtpValue,
  rebindMaskedEmail,
  rebindOtpError,
  isSubmittingRebindOtp,
  onOtpChange,
  onConfirm,
  onResend,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl p-6 text-center space-y-4 border border-slate-100">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-indigo-600" />
            <h3 className="font-bold text-sm text-slate-900">Verify Device Link</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3 pt-1">
          <p className="text-xs text-slate-600 leading-relaxed text-left">
            We sent a 6-digit security code to{' '}
            <span className="font-bold text-slate-900">{rebindMaskedEmail}</span>. Enter it below to link this device.
          </p>

          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={rebindOtpValue}
            onChange={(e) => onOtpChange(e.target.value.replace(/\D/g, ''))}
            placeholder="• • • • • •"
            autoFocus
            className="w-full text-center text-3xl font-mono font-bold tracking-[0.3em] py-3.5 px-4 bg-slate-50 border-2 border-slate-200 focus:border-indigo-600 focus:bg-white rounded-2xl outline-none transition"
          />

          {rebindOtpError && (
            <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2 text-left">
              <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
              <span>{rebindOtpError}</span>
            </div>
          )}

          <div className="flex items-center justify-between text-xs pt-1 px-1">
            <span className="text-slate-400">Didn't receive code?</span>
            <button
              type="button"
              onClick={onResend}
              className="font-bold text-indigo-600 hover:text-indigo-700 transition cursor-pointer"
            >
              Resend Code
            </button>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isSubmittingRebindOtp || rebindOtpValue.length !== 6}
              onClick={onConfirm}
              className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md transition flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              {isSubmittingRebindOtp ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Verifying…</span>
                </>
              ) : (
                <span>Confirm Link</span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
