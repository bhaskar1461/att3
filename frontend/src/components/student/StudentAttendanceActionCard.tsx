import React from 'react';
import { CheckCircle, Camera } from 'lucide-react';

interface StudentAttendanceActionCardProps {
  isMarkedToday: boolean;
  isLiveSession: boolean;
  myAttendance: any;
  primarySubject: string;
  periodCount: number;
  isDeviceBound: boolean | null;
  onOpenScanner: () => void;
}

export const StudentAttendanceActionCard: React.FC<StudentAttendanceActionCardProps> = ({
  isMarkedToday,
  isLiveSession,
  myAttendance,
  primarySubject,
  periodCount,
  isDeviceBound,
  onOpenScanner,
}) => {
  if (isMarkedToday) {
    return (
      <div className="col-span-1 md:col-span-4 bg-gradient-to-br from-[#022c22] via-[#064e3b] to-[#047857] text-white rounded-2xl p-6 border border-emerald-500/40 shadow-sm flex flex-col justify-between relative overflow-hidden min-h-[180px]">
        <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-400/10 rounded-full blur-2xl pointer-events-none" />

        <div>
          <div className="flex items-center justify-between gap-2 mb-3">
            <span className="px-2.5 py-0.5 rounded-full bg-emerald-400/20 text-emerald-300 border border-emerald-400/40 text-[10px] font-mono font-bold flex items-center gap-1.5">
              <CheckCircle className="w-3.5 h-3.5 text-emerald-300" />
              ATTENDANCE CONFIRMED
            </span>
            <span className="text-emerald-200 text-xs font-bold font-mono">
              {myAttendance?.marked_at || 'IST Recorded'}
            </span>
          </div>

          <h3 className="text-xl font-bold font-geist mb-1.5 text-white flex items-center gap-2">
            Marked Present ✅
          </h3>
          <p className="text-xs text-emerald-100/90 leading-relaxed font-medium">
            Verified for <strong className="text-white">{myAttendance?.subject_name || primarySubject}</strong> ({periodCount} Periods Credited).
          </p>
        </div>

        <div className="pt-4 mt-2">
          <button
            onClick={onOpenScanner}
            className="w-full py-3 px-4 bg-emerald-400 hover:bg-emerald-300 text-[#022c22] font-black text-xs sm:text-sm rounded-xl shadow-xl transition active:scale-98 flex items-center justify-center gap-2"
          >
            <CheckCircle className="w-4 h-4 text-[#022c22]" /> Verified Present (View Receipt)
          </button>
          <div className="flex items-center justify-center gap-2 mt-2 text-[10px] text-emerald-200/80 font-mono">
            <span>🔐 Device Locked</span>
            <span>•</span>
            <span>⚡ {periodCount} Credits Saved</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="col-span-1 md:col-span-4 bg-gradient-to-br from-[#001e40] via-[#093268] to-[#15347e] text-white rounded-2xl p-6 border border-blue-900/40 shadow-sm flex flex-col justify-between relative overflow-hidden min-h-[180px]">
      <div className="absolute top-0 right-0 w-32 h-32 bg-[#FF9F0A]/10 rounded-full blur-2xl pointer-events-none" />

      <div>
        <div className="flex items-center justify-between gap-2 mb-3">
          <span className={`px-2.5 py-0.5 rounded-full ${isLiveSession ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' : 'bg-slate-500/20 text-slate-300 border-slate-500/30'} border text-[10px] font-mono font-bold flex items-center gap-1.5`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isLiveSession ? 'bg-emerald-400 animate-pulse' : 'bg-slate-400'}`} />
            {isLiveSession ? 'LIVE IN-CLASS' : 'SESSION STANDBY'}
          </span>
          <span className="text-amber-300 text-xs font-bold font-mono">{isLiveSession ? '⚡ 10s Token Sync' : 'IST Clock Synced'}</span>
        </div>

        <h3 className="text-xl font-bold font-geist mb-1.5 text-white">
          {isLiveSession ? 'Class Attendance' : 'Awaiting Session'}
        </h3>
        <p className="text-xs text-blue-200 leading-relaxed font-medium">
          {isLiveSession 
            ? "Scan the classroom projector screen to mark attendance for today's active periods."
            : "No active attendance session is currently open. Camera scanner is ready when faculty launches QR."}
        </p>
      </div>

      <div className="pt-4 mt-2">
        <button
          onClick={onOpenScanner}
          className={`w-full py-3 px-4 ${isLiveSession ? 'bg-gradient-to-r from-amber-400 via-[#FF9F0A] to-orange-500 hover:from-amber-300 hover:to-orange-400 text-[#001e40]' : 'bg-white/20 hover:bg-white/30 text-white'} font-black text-xs sm:text-sm rounded-xl shadow-xl transition active:scale-98 flex items-center justify-center gap-2`}
        >
          <Camera className={`w-4 h-4 ${isLiveSession ? 'text-[#001e40]' : 'text-white'}`} /> Open Camera Scanner
        </button>
        <div className="flex items-center justify-center gap-2 mt-2 text-[10px] font-mono">
          {isDeviceBound === true ? (
            <>
              <span className="text-emerald-300 font-bold">🔐 Device Bound</span>
              <span className="text-blue-200/80">•</span>
              <span className="text-blue-200/80">⚡ Instant IST Mark</span>
            </>
          ) : isDeviceBound === false ? (
            <>
              <span className="text-amber-300 font-bold">⚠️ Device Not Linked</span>
              <span className="text-blue-200/80">•</span>
              <button
                type="button"
                onClick={onOpenScanner}
                className="text-amber-200 hover:text-white underline cursor-pointer font-bold"
              >
                Enroll This Device
              </button>
            </>
          ) : (
            <span className="text-blue-200/60">Checking device status…</span>
          )}
        </div>
      </div>
    </div>
  );
};
