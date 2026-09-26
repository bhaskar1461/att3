import React from 'react';
import { CheckCircle, ChevronRight } from 'lucide-react';

interface StudentTimetableCardProps {
  schedule: any;
  summary: any;
  isMarkedToday: boolean;
  isLiveSession: boolean;
  primarySubject: string;
  primaryTeacher: string;
  primaryRoom: string;
  periodCount: number;
  onOpenSubjectModal: () => void;
}

export const StudentTimetableCard: React.FC<StudentTimetableCardProps> = ({
  schedule,
  summary,
  isMarkedToday,
  isLiveSession,
  primarySubject,
  primaryTeacher,
  primaryRoom,
  periodCount,
  onOpenSubjectModal,
}) => {
  return (
    <div id="timetable-section" className="col-span-1 md:col-span-7 bg-white rounded-2xl p-6 border border-[#D2D2D7] shadow-sm flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-bold text-lg text-[#001e40] font-geist">Today's Timetable</h3>
        <button 
          onClick={onOpenSubjectModal}
          className="text-xs font-bold text-[#3a5f94] hover:underline"
        >
          Subject Overview
        </button>
      </div>

      <div className="space-y-3">
        {schedule?.schedule && schedule.schedule.length > 0 ? (
          schedule.schedule.map((item: any, sIdx: number) => {
            const isItemMarked = (item.session_id && item.is_marked) || (isMarkedToday && item.session_id === schedule?.my_attendance?.session_id);
            const isItemLive = Boolean(item.is_live);
            return (
              <div 
                key={item.session_id || sIdx} 
                onClick={onOpenSubjectModal}
                className={`p-4 rounded-xl border transition-colors cursor-pointer flex items-center justify-between ${
                  isItemLive 
                    ? 'bg-emerald-50/60 border-emerald-300 shadow-sm' 
                    : isItemMarked 
                    ? 'bg-[#F0FDF4] border-emerald-200' 
                    : 'bg-white border-[#D2D2D7] hover:bg-[#F5F5F7]'
                }`}
              >
                <div className="flex-1 mr-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-2 py-0.5 bg-[#d5e3ff] text-[#001b3c] font-bold text-[10px] rounded uppercase font-mono">
                      {item.period || `Period ${sIdx + 1}`}
                    </span>
                    {isItemMarked ? (
                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-bold text-[10px] rounded flex items-center gap-1 font-mono">
                        <CheckCircle className="w-3 h-3 text-emerald-600" />
                        Marked Present
                      </span>
                    ) : isItemLive ? (
                      <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-700 font-bold text-[10px] rounded flex items-center gap-1 font-mono border border-emerald-300">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                        Live In-Class
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 bg-slate-100 text-slate-700 font-bold text-[10px] rounded font-mono">
                        Scheduled
                      </span>
                    )}
                  </div>
                  <h4 className="font-bold text-base text-[#001e40]">{item.subject_name}</h4>
                  <p className="text-xs text-[#5e5e63] mt-1 flex flex-wrap items-center gap-2 font-medium">
                    <span>Faculty: <strong className="text-slate-800">{item.teacher_name}</strong></span>
                    <span className="opacity-40">•</span>
                    <span>{item.room || primaryRoom}</span>
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <span className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold border ${
                    isItemMarked 
                      ? 'bg-emerald-100 text-emerald-900 border-emerald-300' 
                      : isItemLive 
                      ? 'bg-amber-100 text-amber-900 border-amber-300' 
                      : 'bg-slate-100 text-slate-700 border-slate-200'
                  }`}>
                    {item.period_count || 1} {(item.period_count || 1) === 1 ? 'Period' : 'Periods'}
                  </span>
                </div>
              </div>
            );
          })
        ) : summary?.subjects && summary.subjects.length > 0 ? (
          summary.subjects.map((subj: any, sIdx: number) => {
            const pct = subj.percentage ?? 0;
            const isGood = pct >= 75;
            const isWarn = pct >= 65 && pct < 75;
            return (
              <div 
                key={sIdx} 
                onClick={onOpenSubjectModal}
                className="p-4 rounded-xl bg-white border border-[#D2D2D7] flex items-center justify-between hover:bg-[#F5F5F7] transition-colors cursor-pointer"
              >
                <div className="flex-1 mr-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-2 py-0.5 bg-[#d5e3ff] text-[#001b3c] font-bold text-[10px] rounded uppercase font-mono">
                      Period {sIdx + 1}
                    </span>
                    <span className={`px-2 py-0.5 font-bold text-[10px] rounded ${
                      isGood ? 'bg-[#34C759]/10 text-[#34C759]' : isWarn ? 'bg-[#FF9F0A]/10 text-[#FF9F0A]' : 'bg-[#E22126]/10 text-[#E22126]'
                    }`}>
                      {pct}% Attended
                    </span>
                  </div>
                  <h4 className="font-bold text-base text-[#001e40]">{subj.subject_name}</h4>
                  <p className="text-xs text-[#5e5e63] mt-0.5">
                    {subj.present} of {subj.conducted} classes attended
                  </p>
                </div>
                <ChevronRight className="w-5 h-5 text-[#737780]" />
              </div>
            );
          })
        ) : (
          <div className="p-4 rounded-xl bg-gradient-to-r from-blue-50/70 to-amber-50/40 border border-[#D2D2D7] flex items-center justify-between shadow-sm">
            <div className="flex-1 mr-3">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="px-2.5 py-0.5 bg-[#001e40] text-white font-bold text-[10px] rounded uppercase font-mono tracking-wider">
                  {periodCount} {periodCount === 1 ? 'Period' : 'Periods'}
                </span>
                {isMarkedToday ? (
                  <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 font-bold text-[10px] rounded flex items-center gap-1 font-mono">
                    <CheckCircle className="w-3 h-3 text-emerald-600" />
                    Marked Present ({periodCount} {periodCount === 1 ? 'Period' : 'Periods'})
                  </span>
                ) : isLiveSession ? (
                  <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 font-bold text-[10px] rounded flex items-center gap-1 font-mono">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                    Live In-Class
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 bg-slate-100 text-slate-700 font-bold text-[10px] rounded flex items-center gap-1 font-mono">
                    Scheduled
                  </span>
                )}
              </div>
              <h4 className="font-bold text-base text-[#001e40]">{primarySubject}</h4>
              <p className="text-xs text-[#5e5e63] mt-1 flex flex-wrap items-center gap-2 font-medium">
                <span>Faculty: <strong className="text-slate-800">{primaryTeacher}</strong></span>
                <span className="opacity-40">•</span>
                <span>{primaryRoom}</span>
              </p>
            </div>
            <div className="text-right shrink-0">
              <span className={`px-3 py-1.5 rounded-xl text-xs font-black font-mono block border ${
                isMarkedToday 
                  ? 'bg-emerald-100 text-emerald-900 border-emerald-300' 
                  : 'bg-amber-400/20 text-amber-900 border-amber-400/30'
              }`}>
                {isMarkedToday ? 'Credited' : `${periodCount} ${periodCount === 1 ? 'Period' : 'Periods'}`}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
