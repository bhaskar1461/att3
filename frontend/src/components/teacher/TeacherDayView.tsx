/**
 * SNIST ERP - Teacher Day Period Schedule View
 * Phase 3: Teacher Calendar UI Implementation
 */

import React from 'react';
import type { TeacherClassEvent } from '../../types/calendar.ts';
import { STANDARD_PERIODS, formatISTDisplayDate } from '../../utils/dateUtils.ts';
import { 
  Clock, 
  Users, 
  CheckCircle2, 
  Lock, 
  AlertCircle, 
  Radio, 
  Play, 
  Eye 
} from 'lucide-react';

interface TeacherDayViewProps {
  selectedDate: string;
  selectedEventId?: string | null;
  dayEvents: TeacherClassEvent[];
  todayIST: string;
  onSelectEvent: (event: TeacherClassEvent) => void;
  onStartAttendance?: (event: TeacherClassEvent) => void;
}

export const TeacherDayView: React.FC<TeacherDayViewProps> = ({
  selectedDate,
  selectedEventId,
  dayEvents,
  todayIST,
  onSelectEvent,
  onStartAttendance
}) => {
  // Map dayEvents by periodNumber for quick lookup
  const periodMap = new Map<number, TeacherClassEvent>();
  for (const e of dayEvents) {
    periodMap.set(e.periodNumber, e);
  }

  const dateHeading = formatISTDisplayDate(selectedDate);
  const isToday = selectedDate === todayIST;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
      {/* Header */}
      <div className="p-4 sm:p-5 border-b border-slate-100 bg-slate-50/70 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-heading text-base sm:text-lg font-black text-[#001e40] flex items-center gap-2">
            <span>{dateHeading}</span>
            {isToday && (
              <span className="px-2 py-0.5 rounded-full text-xs font-black uppercase bg-blue-100 text-[#2f53d7]">
                Today
              </span>
            )}
          </h3>
          <p className="text-xs text-slate-500 font-semibold mt-0.5">
            Institutional Period Timeline & Attendance Ledger
          </p>
        </div>

        <span className="text-xs font-extrabold px-3 py-1 rounded-xl bg-white border border-slate-200 text-[#001e40]">
          {dayEvents.length} {dayEvents.length === 1 ? 'Class Scheduled' : 'Classes Scheduled'}
        </span>
      </div>

      {/* Period Timeline */}
      <div className="divide-y divide-slate-100">
        {STANDARD_PERIODS.map((period) => {
          const classEvent = periodMap.get(period.num);
          const isSelected = classEvent && classEvent.id === selectedEventId;

          return (
            <React.Fragment key={period.num}>
              {/* Institutional Morning Short Break (11:10 - 11:20) */}
              {period.num === 3 && (
                <div className="px-5 py-2.5 bg-amber-50/60 border-y border-amber-100/80 flex items-center justify-between text-xs font-bold text-amber-900">
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    <span>Morning Short Break (11:10 AM – 11:20 AM)</span>
                  </div>
                  <span className="text-[10px] uppercase tracking-wider font-extrabold text-amber-700">
                    10 min Interval
                  </span>
                </div>
              )}

              {/* Institutional Lunch Break (01:00 PM - 01:40 PM) */}
              {period.num === 5 && (
                <div className="px-5 py-2.5 bg-amber-50/60 border-y border-amber-100/80 flex items-center justify-between text-xs font-bold text-amber-900">
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    <span>Lunch Break (01:00 PM – 01:40 PM)</span>
                  </div>
                  <span className="text-[10px] uppercase tracking-wider font-extrabold text-amber-700">
                    40 min Interval
                  </span>
                </div>
              )}

              <div
                onClick={() => classEvent && onSelectEvent(classEvent)}
                onKeyDown={(e) => {
                  if (classEvent && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    onSelectEvent(classEvent);
                  }
                }}
                role={classEvent ? 'button' : undefined}
                tabIndex={classEvent ? 0 : undefined}
                aria-label={classEvent ? `${classEvent.subjectName}, Section ${classEvent.sectionName}, ${period.label}` : undefined}
                className={`p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2f53d7] ${
                  classEvent
                    ? isSelected
                      ? 'bg-blue-50/50 border-l-4 border-l-[#2f53d7]'
                      : 'hover:bg-slate-50/70 cursor-pointer'
                    : 'bg-slate-50/30'
                }`}
              >
                {/* Left: Time & Period Label */}
                <div className="flex items-center gap-3 sm:w-48 shrink-0">
                  <div className="p-2.5 rounded-xl bg-slate-100 text-[#001e40] shrink-0">
                    <Clock className="w-4 h-4 text-slate-600" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-500">{period.label}</div>
                    <div className="text-sm font-extrabold text-[#001e40]">{period.displayTime}</div>
                  </div>
                </div>

                {/* Middle: Class Details or Free Slot */}
                <div className="flex-1 min-w-0">
                  {classEvent ? (
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-base font-black text-[#001e40] hover:text-[#2f53d7] transition-colors">
                          {classEvent.subjectName}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded font-extrabold bg-blue-100/70 text-[#2f53d7]">
                          {classEvent.sectionName}
                        </span>
                        <span className="text-xs text-slate-400 font-semibold">
                          ({classEvent.department})
                        </span>
                      </div>

                      <div className="flex items-center gap-4 text-xs text-slate-500 flex-wrap">
                        <span>Room: {classEvent.room || classEvent.sectionName}</span>
                        {classEvent.totalStudents > 0 && (
                          <span className="flex items-center gap-1 font-semibold text-slate-700">
                            <Users className="w-3.5 h-3.5 text-slate-400" />
                            <span>{classEvent.totalStudents} enrolled</span>
                          </span>
                        )}
                        {classEvent.presentCount > 0 && (
                          <span className="font-extrabold text-emerald-700">
                            {classEvent.presentCount} present ({classEvent.attendancePercentage}%)
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs font-semibold text-slate-400 italic">
                      Free Period • No class scheduled
                    </div>
                  )}
                </div>

                {/* Right: Status Badge & Quick Action */}
                <div className="shrink-0 flex items-center gap-2 self-end sm:self-auto">
                  {classEvent && (
                    <>
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold ${
                          classEvent.attendanceState === 'CURRENT'
                            ? 'bg-rose-50 text-rose-700 border border-rose-200'
                            : classEvent.attendanceState === 'COMPLETED' || classEvent.attendanceState === 'ATTENDANCE_TAKEN'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : classEvent.attendanceState === 'LOCKED'
                            ? 'bg-slate-100 text-slate-700 border border-slate-200'
                            : classEvent.attendanceState === 'NO_ATTENDANCE'
                            ? 'bg-amber-50 text-amber-700 border border-amber-200'
                            : 'bg-blue-50 text-blue-700 border border-blue-200'
                        }`}
                      >
                        {classEvent.attendanceState === 'CURRENT' ? (
                          <>
                            <Radio className="w-3 h-3 text-rose-600 motion-safe:animate-pulse" /> Live Now
                          </>
                        ) : classEvent.attendanceState === 'COMPLETED' || classEvent.attendanceState === 'ATTENDANCE_TAKEN' ? (
                          <>
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Completed
                          </>
                        ) : classEvent.attendanceState === 'LOCKED' ? (
                          <>
                            <Lock className="w-3 h-3 text-slate-500" /> Locked
                          </>
                        ) : classEvent.attendanceState === 'NO_ATTENDANCE' ? (
                          <>
                            <AlertCircle className="w-3 h-3 text-amber-600" /> Not Taken
                          </>
                        ) : (
                          'Upcoming'
                        )}
                      </span>

                      {onStartAttendance && classEvent.canStartAttendance && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onStartAttendance(classEvent);
                          }}
                          className="px-3 py-1.5 rounded-lg bg-[#2f53d7] hover:bg-[#203db0] text-white text-xs font-bold flex items-center gap-1 shadow-sm active:scale-95 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f53d7] focus-visible:ring-offset-1"
                          title={classEvent.hasSession && classEvent.sessionStatus === 'OPEN' ? 'Continue active session' : 'Start attendance session'}
                        >
                          <Play className="w-3 h-3 fill-current" />
                          <span>{classEvent.hasSession && classEvent.sessionStatus === 'OPEN' ? 'Continue' : 'Start'}</span>
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};
