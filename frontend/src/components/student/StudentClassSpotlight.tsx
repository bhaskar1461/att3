import React from 'react';
import { User, MapPin } from 'lucide-react';

interface StudentClassSpotlightProps {
  profile: any;
  isMarkedToday: boolean;
  isLiveSession: boolean;
  periodCount: number;
  primarySubject: string;
  primaryTeacher: string;
  primaryRoom: string;
}

export const StudentClassSpotlight: React.FC<StudentClassSpotlightProps> = ({
  profile,
  isMarkedToday,
  isLiveSession,
  periodCount,
  primarySubject,
  primaryTeacher,
  primaryRoom,
}) => {
  return (
    <div className="col-span-1 md:col-span-8 bg-[#001e40] text-white rounded-2xl p-6 relative overflow-hidden shadow-sm flex flex-col justify-between min-h-[180px]">
      <div 
        className="absolute inset-0 opacity-10" 
        style={{ 
          backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', 
          backgroundSize: '24px 24px' 
        }} 
      />
      
      <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className={`w-2 h-2 rounded-full ${isMarkedToday ? 'bg-emerald-400' : isLiveSession ? 'bg-emerald-400 animate-pulse' : 'bg-slate-400'}`} />
            <span className="text-xs font-bold text-[#a7c8ff] uppercase tracking-wider font-mono">
              {isMarkedToday 
                ? `✅ Attendance Credited (${periodCount} Periods)` 
                : isLiveSession
                  ? `• Live Session (${periodCount} Periods)`
                  : `Session Standby (${periodCount} Periods)`}
            </span>
          </div>
          <h3 className="text-xl sm:text-2xl font-bold font-geist mb-2 text-white">
            {primarySubject}
          </h3>
          <p className="text-xs text-[#a7c8ff] flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1"><User className="w-3.5 h-3.5" /> {primaryTeacher}</span>
            <span className="opacity-40">•</span>
            <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {primaryRoom}</span>
          </p>
        </div>

        <div className="flex-shrink-0">
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 text-center border border-white/10 min-w-[130px]">
            <span className="block text-[10px] font-bold text-[#a7c8ff] mb-1">
              {isMarkedToday ? 'STATUS' : 'SESSION CREDIT'}
            </span>
            <span className={`block text-lg font-extrabold font-mono ${isMarkedToday ? 'text-emerald-300' : isLiveSession ? 'text-amber-300' : 'text-slate-300'}`}>
              {isMarkedToday ? 'PRESENT ✅' : isLiveSession ? `${periodCount} Periods` : 'STANDBY'}
            </span>
          </div>
        </div>
      </div>

      {profile && (
        <div className="relative z-10 pt-4 border-t border-white/10 flex items-center justify-between text-xs text-[#a7c8ff]">
          <span>Student ID: <strong className="text-white font-mono">{profile.roll_number}</strong></span>
          <span className="px-2.5 py-0.5 bg-emerald-500/20 text-emerald-300 font-bold rounded-full border border-emerald-500/30">Active Student</span>
        </div>
      )}
    </div>
  );
};
