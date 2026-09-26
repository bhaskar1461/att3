import React from 'react';
import {
  Clock,
  Building2,
  Hash,
  Edit3,
  BookOpen,
  CheckCircle2,
  Lock,
  AlertCircle,
  RefreshCw
} from 'lucide-react';
import type { TeacherClassEvent } from '../../types/calendar.ts';

interface ClassSessionHeaderProps {
  selectedEvent: TeacherClassEvent;
  isPeriodEditOpen: boolean;
  setIsPeriodEditOpen: (open: boolean) => void;
  editPeriodCount: number;
  setEditPeriodCount: (count: number) => void;
  isUpdatingPeriod: boolean;
  onApplyPeriodChange: () => Promise<void>;
  formatPeriodLabel: (start: number, count: number) => string;
  onUpdateSessionPeriod?: (sessionId: number, periodCount: number, periodLabel: string) => Promise<void>;
}

export const ClassSessionHeader: React.FC<ClassSessionHeaderProps> = ({
  selectedEvent,
  isPeriodEditOpen,
  setIsPeriodEditOpen,
  editPeriodCount,
  setEditPeriodCount,
  isUpdatingPeriod,
  onApplyPeriodChange,
  formatPeriodLabel,
  onUpdateSessionPeriod
}) => {
  return (
    <div className="space-y-2">
      {/* Status Badge Row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-extrabold text-slate-600">
          <Clock className="w-3.5 h-3.5 text-slate-400" />
          <span>{selectedEvent.displayTime}</span>
        </div>

        <span
          className={`text-[10px] px-2.5 py-0.5 rounded-full font-black uppercase tracking-wider flex items-center gap-1 ${
            selectedEvent.attendanceState === 'CURRENT'
              ? 'bg-rose-100 text-rose-700 border border-rose-200'
              : selectedEvent.attendanceState === 'COMPLETED' || selectedEvent.attendanceState === 'ATTENDANCE_TAKEN'
              ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
              : selectedEvent.attendanceState === 'LOCKED'
              ? 'bg-slate-100 text-slate-700 border border-slate-200'
              : selectedEvent.attendanceState === 'NO_ATTENDANCE'
              ? 'bg-amber-100 text-amber-800 border border-amber-200'
              : 'bg-blue-100 text-blue-800 border border-blue-200'
          }`}
        >
          {selectedEvent.attendanceState === 'CURRENT' ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-rose-600 motion-safe:animate-pulse" />
              Live Now
            </>
          ) : selectedEvent.attendanceState === 'COMPLETED' || selectedEvent.attendanceState === 'ATTENDANCE_TAKEN' ? (
            <>
              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
              Attendance Recorded
            </>
          ) : selectedEvent.attendanceState === 'LOCKED' ? (
            <>
              <Lock className="w-3 h-3 text-slate-500" />
              Session Locked
            </>
          ) : selectedEvent.attendanceState === 'NO_ATTENDANCE' ? (
            <>
              <AlertCircle className="w-3 h-3 text-amber-600" />
              Not Taken
            </>
          ) : (
            'Upcoming'
          )}
        </span>
      </div>

      {/* Subject Title */}
      <h4 className="text-lg font-black text-[#001e40] font-heading leading-snug">
        {selectedEvent.subjectName}
      </h4>

      {/* Meta Row: Section, Period, Room */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-bold text-slate-500">
        <span className="inline-flex items-center gap-1 text-[#2f53d7]">
          <Building2 className="w-3 h-3" />
          {selectedEvent.sectionName}
        </span>
        <span className="text-slate-300">•</span>
        <span className="inline-flex items-center gap-1">
          <Hash className="w-3 h-3 text-slate-400" />
          {selectedEvent.periodLabel}
        </span>
        {selectedEvent.hasSession && onUpdateSessionPeriod && selectedEvent.sessionId && (
          <button
            type="button"
            onClick={() => setIsPeriodEditOpen(!isPeriodEditOpen)}
            className="px-2 py-0.5 rounded text-[11px] font-extrabold bg-blue-50 hover:bg-blue-100 text-[#2f53d7] transition border border-blue-200 flex items-center gap-1 cursor-pointer"
            title="Change Period Count"
          >
            <Edit3 className="w-3 h-3" />
            <span>{isPeriodEditOpen ? 'Close' : 'Change Periods'}</span>
          </button>
        )}
        {selectedEvent.room && (
          <>
            <span className="text-slate-300">•</span>
            <span>{selectedEvent.room}</span>
          </>
        )}
      </div>

      {/* Inline Duration / Period Edit Drawer */}
      {isPeriodEditOpen && selectedEvent.hasSession && (
        <div className="bg-blue-50/70 rounded-xl p-3 border border-blue-200/80 space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-extrabold text-[#15347e]">Update Session Duration:</span>
            <span className="font-black text-[#2f53d7]">
              {editPeriodCount} Period{editPeriodCount > 1 ? 's' : ''} ({formatPeriodLabel(selectedEvent.periodNumber, editPeriodCount)})
            </span>
          </div>
          <div className="grid grid-cols-8 gap-1">
            {[1, 2, 3, 4, 5, 6, 7, 8].map(cnt => (
              <button
                key={cnt}
                type="button"
                onClick={() => setEditPeriodCount(cnt)}
                className={`py-1.5 rounded-lg text-xs font-black transition text-center cursor-pointer ${
                  editPeriodCount === cnt
                    ? 'bg-[#2f53d7] text-white shadow-sm ring-1 ring-[#2f53d7]'
                    : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200'
                }`}
                title={`${cnt} ${cnt === 1 ? 'Period' : 'Periods'}`}
              >
                {cnt}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onApplyPeriodChange}
            disabled={isUpdatingPeriod}
            className="w-full py-2 bg-[#2f53d7] hover:bg-[#203db0] text-white text-xs font-black rounded-lg shadow-sm transition flex items-center justify-center gap-1.5 disabled:opacity-60 cursor-pointer"
          >
            {isUpdatingPeriod ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            <span>Apply & Update All Student Records ({editPeriodCount} Periods)</span>
          </button>
        </div>
      )}

      {/* Subject Code & Department */}
      {selectedEvent.subjectCode && (
        <div className="text-[11px] text-slate-400 font-semibold flex items-center gap-1.5">
          <BookOpen className="w-3 h-3" />
          <span>Code: {selectedEvent.subjectCode}</span>
          {selectedEvent.department && (
            <>
              <span className="text-slate-300">•</span>
              <span>Dept: {selectedEvent.department}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
};
