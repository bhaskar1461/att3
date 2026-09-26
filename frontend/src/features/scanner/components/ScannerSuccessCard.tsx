import React from 'react';
import { CheckCircle, Camera } from 'lucide-react';

interface ScannerSuccessCardProps {
  successResult: any;
  studentInfo: { roll_number: string; name: string; section: string };
  studentRoll?: string;
  selfieAttendanceId: number | null;
  selfieSessionId: number | null;
  selfieCompleted: boolean;
  onOpenSelfie: () => void;
  onDone: () => void;
}

export const ScannerSuccessCard: React.FC<ScannerSuccessCardProps> = ({
  successResult,
  studentInfo,
  studentRoll,
  selfieAttendanceId,
  selfieSessionId,
  selfieCompleted,
  onOpenSelfie,
  onDone,
}) => {
  return (
    <div className="p-6 sm:p-8 flex flex-col items-center justify-center text-center space-y-5 animate-in fade-in zoom-in-95 duration-300 w-full">
      {/* Checkmark Circle */}
      <div className="w-20 h-20 rounded-full bg-emerald-50 border-2 border-emerald-200 text-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/10">
        <CheckCircle className="w-10 h-10 animate-in zoom-in-75 duration-300 text-emerald-600" />
      </div>

      <div className="space-y-1.5">
        <span
          className={`inline-block px-3 py-1 rounded-full text-xs font-bold tracking-wide uppercase ${
            successResult.status === 'ALREADY_MARKED'
              ? 'bg-amber-100 text-amber-800'
              : 'bg-emerald-100 text-emerald-800'
          }`}
        >
          {successResult.status === 'ALREADY_MARKED' ? 'Already Marked' : 'Attendance Marked'}
        </span>
        <h2 className="text-2xl font-black text-[#001e40] tracking-tight">
          {successResult.status === 'ALREADY_MARKED' ? 'Already Present' : 'Present!'}
        </h2>
        <p className="text-sm text-slate-600 font-medium">
          Present for{' '}
          <span className="font-bold text-slate-900">
            {successResult.subject_name || 'Class Attendance Session'}
          </span>
        </p>
      </div>

      {/* Clean Student & Session Card */}
      <div className="w-full bg-slate-50 rounded-2xl p-4 border border-slate-200/80 text-left space-y-2 text-xs">
        <div className="flex justify-between items-center py-0.5">
          <span className="text-slate-500 font-medium">Student</span>
          <span className="font-bold text-slate-800">
            {studentInfo.name || 'Student'} ({studentInfo.roll_number || studentRoll})
          </span>
        </div>
        <div className="flex justify-between items-center py-0.5 border-t border-slate-200/50 pt-1.5">
          <span className="text-slate-500 font-medium">Time</span>
          <span className="font-semibold text-slate-700">
            {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • Today
          </span>
        </div>
      </div>

      {/* Institutional Selfie CTA if required */}
      {(selfieAttendanceId || selfieSessionId) && (
        <div className="w-full p-4 bg-indigo-50 border border-indigo-200 rounded-2xl text-left space-y-2 animate-in fade-in">
          <div className="flex items-center gap-2 text-indigo-900 font-bold text-xs">
            <Camera className="w-4 h-4 text-indigo-600" />
            <span>{selfieCompleted ? 'Photo Record Attached' : 'Quick Photo Verification'}</span>
          </div>
          <p className="text-xs text-indigo-700 leading-relaxed">
            {selfieCompleted
              ? 'Institutional selfie has been recorded and verified for this session.'
              : 'Attendance recorded! Take a quick front-camera selfie to verify institutional photo records.'}
          </p>
          <button
            type="button"
            onClick={onOpenSelfie}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl transition flex items-center justify-center gap-1.5 shadow-sm active:scale-98 cursor-pointer"
          >
            <Camera className="w-3.5 h-3.5" />
            <span>{selfieCompleted ? 'Retake Selfie' : 'Take Selfie'}</span>
          </button>
        </div>
      )}

      {/* Done Button */}
      <button
        type="button"
        onClick={onDone}
        className="w-full py-3.5 bg-[#001e40] hover:bg-[#002f6c] text-white font-bold text-sm rounded-2xl shadow-lg transition active:scale-98 cursor-pointer"
      >
        Done
      </button>
    </div>
  );
};
