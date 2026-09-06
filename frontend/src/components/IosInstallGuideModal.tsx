import React from 'react';
import { Share, PlusSquare, ArrowDown, X, Check } from 'lucide-react';

interface IosInstallGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * IosInstallGuideModal
 *
 * Explicit visual guide for iPhone users.
 * Explains that Apple strictly reserves "Add to Home Screen" to Safari's native toolbar
 * and shows exactly where to tap (bottom bar Share icon -> Add to Home Screen -> Add).
 */
export const IosInstallGuideModal: React.FC<IosInstallGuideModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex flex-col justify-end p-4 animate-in fade-in duration-200">
      <div className="bg-white text-slate-900 rounded-3xl w-full max-w-md mx-auto overflow-hidden shadow-2xl border border-slate-200 p-5 space-y-4 font-sans">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#001e40] text-white flex items-center justify-center font-bold text-xs shadow-sm">
              <PlusSquare className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <h3 className="font-extrabold text-sm text-[#001e40]">Add to iPhone Home Screen</h3>
              <p className="text-[11px] text-slate-500 font-medium">Apple requires Safari's built-in toolbar</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Notice */}
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3 text-xs text-blue-900 leading-relaxed font-medium">
          Apple does not allow websites to create shortcuts directly. You must use Safari's own toolbar at the bottom:
        </div>

        {/* 3 Step Visual Guide */}
        <div className="space-y-2.5 text-xs text-slate-700">
          <div className="flex items-start gap-3 bg-slate-50 p-3 rounded-2xl border border-slate-100">
            <div className="w-6 h-6 rounded-full bg-[#001e40] text-white flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
              1
            </div>
            <div>
              <p className="font-bold text-slate-900 flex items-center gap-1.5">
                Tap Safari's Share button <Share className="w-4 h-4 text-[#007AFF] inline" />
              </p>
              <p className="text-slate-500 text-[11px] mt-0.5">
                Look at the <strong>bottom center</strong> of your iPhone screen (the square with an arrow pointing up).
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 bg-slate-50 p-3 rounded-2xl border border-slate-100">
            <div className="w-6 h-6 rounded-full bg-[#001e40] text-white flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
              2
            </div>
            <div>
              <p className="font-bold text-slate-900 flex items-center gap-1.5">
                Scroll down &amp; tap "Add to Home Screen" <PlusSquare className="w-4 h-4 text-slate-700 inline" />
              </p>
              <p className="text-slate-500 text-[11px] mt-0.5">
                In Safari's menu, scroll down until you see the <strong>[➕ Add to Home Screen]</strong> row.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 bg-slate-50 p-3 rounded-2xl border border-slate-100">
            <div className="w-6 h-6 rounded-full bg-[#001e40] text-white flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
              3
            </div>
            <div>
              <p className="font-bold text-slate-900">
                Tap "Add" at the top-right corner
              </p>
              <p className="text-slate-500 text-[11px] mt-0.5">
                The SNIST Attendance app icon will appear on your home screen!
              </p>
            </div>
          </div>
        </div>

        {/* Animated Bouncing Pointer to Safari Toolbar */}
        <div className="pt-1 text-center">
          <div className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-amber-100 text-amber-900 rounded-full text-xs font-black animate-bounce shadow-sm">
            <ArrowDown className="w-4 h-4 text-amber-700" />
            <span>Look down at the Safari toolbar below</span>
            <ArrowDown className="w-4 h-4 text-amber-700" />
          </div>
        </div>

        {/* Action Button */}
        <button
          onClick={onClose}
          className="w-full py-3 px-4 bg-[#001e40] hover:bg-[#002e60] text-white rounded-2xl font-bold text-sm shadow-md transition active:scale-[0.98]"
        >
          Got It, Show Me Safari Toolbar
        </button>

      </div>
    </div>
  );
};
