import React from 'react';
import { X, HelpCircle, KeyRound, User, Sun, Maximize2, ShieldCheck, ChevronRight } from 'lucide-react';

interface ScannerHelpSheetModalProps {
  isOpen: boolean;
  onOpenManualCode: () => void;
  onOpenRollCard: () => void;
  onClose: () => void;
}

export const ScannerHelpSheetModal: React.FC<ScannerHelpSheetModalProps> = ({
  isOpen,
  onOpenManualCode,
  onOpenRollCard,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] bg-black/85 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl p-6 space-y-4 border border-slate-100 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <HelpCircle className="w-5 h-5 text-indigo-600" />
            <h3 className="font-bold text-sm text-slate-900">Scanner Assistance</h3>
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
          {/* Option 1: Manual Code Fallback */}
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenManualCode();
            }}
            className="w-full p-3.5 rounded-2xl bg-indigo-50/70 hover:bg-indigo-100/70 border border-indigo-200/80 transition text-left flex items-center justify-between group cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-sm">
                <KeyRound className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs font-bold text-indigo-950">Enter Short Code</div>
                <div className="text-[11px] text-indigo-700/80">Type the 6-character code below the screen QR</div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-indigo-400 group-hover:translate-x-0.5 transition" />
          </button>

          {/* Option 2: Show Roll Card */}
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenRollCard();
            }}
            className="w-full p-3.5 rounded-2xl bg-emerald-50/70 hover:bg-emerald-100/70 border border-emerald-200/80 transition text-left flex items-center justify-between group cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-sm">
                <User className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs font-bold text-emerald-950">Show Roll Number Card</div>
                <div className="text-[11px] text-emerald-700/80">Faculty can mark you present on their screen</div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-emerald-400 group-hover:translate-x-0.5 transition" />
          </button>

          {/* Scanning Troubleshooting Tips */}
          <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200/60 text-left space-y-2.5 text-xs text-slate-600">
            <div className="font-bold text-slate-800 text-[11px] uppercase tracking-wider">Quick Scanning Tips</div>
            <div className="flex items-start gap-2">
              <Sun className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <span>Ensure adequate lighting. Avoid direct ceiling light glare on the phone screen or projector.</span>
            </div>
            <div className="flex items-start gap-2">
              <Maximize2 className="w-4 h-4 text-cyan-600 shrink-0 mt-0.5" />
              <span>Pinch or double-tap the camera screen to zoom in if sitting far from the projector.</span>
            </div>
            <div className="flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
              <span>The QR code rotates every 10 seconds. Keep your camera focused until the checkmark appears.</span>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition cursor-pointer"
        >
          Close
        </button>
      </div>
    </div>
  );
};
