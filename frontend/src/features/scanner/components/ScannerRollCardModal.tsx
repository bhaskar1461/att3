import React from 'react';
import { X, User, CheckCircle2 } from 'lucide-react';

interface ScannerRollCardModalProps {
  isOpen: boolean;
  studentInfo: { roll_number: string; name: string; section: string };
  studentRoll?: string;
  onClose: () => void;
}

export const ScannerRollCardModal: React.FC<ScannerRollCardModalProps> = ({
  isOpen,
  studentInfo,
  studentRoll,
  onClose,
}) => {
  if (!isOpen) return null;

  const displayRoll = studentInfo.roll_number || studentRoll || 'STUDENT';
  const displayName = studentInfo.name || 'Student';
  const displaySection = studentInfo.section || 'Class Section';

  return (
    <div className="fixed inset-0 z-[120] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl p-6 text-center space-y-4 border border-slate-100">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <User className="w-5 h-5 text-indigo-600" />
            <h3 className="font-bold text-sm text-slate-900">Student Roll Card</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="py-4 space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-indigo-50 border border-indigo-200 text-indigo-700 font-extrabold flex items-center justify-center mx-auto text-xl shadow-inner">
            {displayRoll.slice(-3)}
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block">
              Official University Roll Number
            </span>
            <div className="text-3xl font-black text-[#001e40] tracking-tight font-mono select-all">
              {displayRoll}
            </div>
          </div>
          <div className="text-sm font-semibold text-slate-700">
            {displayName}
          </div>
          <div className="inline-block px-3 py-1 bg-slate-100 rounded-full text-xs font-medium text-slate-600">
            {displaySection}
          </div>
        </div>

        <div className="bg-emerald-50 rounded-2xl p-3 border border-emerald-200/80 text-left text-xs space-y-1 text-emerald-900">
          <div className="flex items-center gap-1.5 font-bold">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            <span>Show this to your faculty</span>
          </div>
          <p className="text-[11px] text-emerald-800 leading-relaxed">
            If your camera or network has issues, faculty can verify this card and mark you present in the classroom register.
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="w-full py-3 bg-[#001e40] hover:bg-[#002f6c] text-white font-bold text-xs rounded-xl shadow-md transition active:scale-98 cursor-pointer"
        >
          Back to Scanner
        </button>
      </div>
    </div>
  );
};
