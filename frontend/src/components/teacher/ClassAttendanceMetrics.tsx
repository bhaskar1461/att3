import React from 'react';
import { Users, CheckCircle2, UserX, AlertCircle } from 'lucide-react';
import type { TeacherClassEvent } from '../../types/calendar.ts';

interface ClassAttendanceMetricsProps {
  selectedEvent: TeacherClassEvent;
  isFuture: boolean;
  actualDurationCount: number;
}

export const ClassAttendanceMetrics: React.FC<ClassAttendanceMetricsProps> = ({
  selectedEvent,
  isFuture,
  actualDurationCount
}) => {
  return (
    <div className="border-t border-slate-100 pt-3 space-y-3">
      {selectedEvent.hasSession && selectedEvent.totalStudents > 0 ? (
        <>
          {/* Large Fraction Display */}
          {(() => {
            const safePct = Number.isFinite(selectedEvent.attendancePercentage)
              ? Math.min(100, Math.max(0, Math.round(selectedEvent.attendancePercentage)))
              : 0;
            return (
              <div className="flex items-baseline justify-between">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-3xl font-black text-[#001e40] font-heading">
                    {selectedEvent.presentCount}
                  </span>
                  <span className="text-lg font-bold text-slate-400">
                    /{selectedEvent.totalStudents}
                  </span>
                  <span className="text-xs font-bold text-slate-500 ml-1">
                    Present
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  {actualDurationCount > 1 && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-black bg-purple-100 text-purple-800 border border-purple-200">
                      ×{actualDurationCount} Multiplier Active
                    </span>
                  )}
                  <span
                    className={`text-xs px-2.5 py-1 rounded-full font-black ${
                      safePct >= 75
                        ? 'bg-emerald-100 text-emerald-800'
                        : safePct >= 65
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-rose-100 text-rose-800'
                    }`}
                  >
                    {safePct}%
                  </span>
                </div>
              </div>
            );
          })()}

          {/* Progress Bar */}
          <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                (selectedEvent.attendancePercentage || 0) >= 75
                  ? 'bg-emerald-500'
                  : (selectedEvent.attendancePercentage || 0) >= 65
                  ? 'bg-amber-500'
                  : 'bg-rose-500'
              }`}
              style={{
                width: `${Math.min(100, Math.max(0, selectedEvent.attendancePercentage || 0))}%`
              }}
            />
          </div>

          {/* Counts Grid */}
          <div className="grid grid-cols-3 gap-2 pt-1">
            <div className="bg-slate-50 p-2 rounded-xl text-center border border-slate-100">
              <div className="text-[10px] font-bold text-slate-500 flex items-center justify-center gap-1">
                <Users className="w-3 h-3 text-slate-400" />
                <span>Total</span>
              </div>
              <div className="text-sm font-black text-slate-700 mt-0.5">
                {selectedEvent.totalStudents}
              </div>
            </div>

            <div className="bg-emerald-50/70 p-2 rounded-xl text-center border border-emerald-100">
              <div className="text-[10px] font-bold text-emerald-700 flex items-center justify-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                <span>Present</span>
              </div>
              <div className="text-sm font-black text-emerald-800 mt-0.5">
                {selectedEvent.presentCount}
              </div>
            </div>

            <div className="bg-rose-50/70 p-2 rounded-xl text-center border border-rose-100">
              <div className="text-[10px] font-bold text-rose-700 flex items-center justify-center gap-1">
                <UserX className="w-3 h-3 text-rose-600" />
                <span>Absent</span>
              </div>
              <div className="text-sm font-black text-rose-800 mt-0.5">
                {selectedEvent.absentCount}
              </div>
            </div>
          </div>
        </>
      ) : selectedEvent.hasSession && selectedEvent.totalStudents === 0 ? (
        <div className="bg-slate-50 rounded-xl p-4 text-center border border-slate-100">
          <Users className="w-6 h-6 text-slate-300 mx-auto mb-1" />
          <p className="text-xs font-bold text-slate-500">No enrollment data available</p>
          <p className="text-[10px] text-slate-400 mt-0.5">Section enrollment may not be configured.</p>
        </div>
      ) : (
        <div className="bg-amber-50/60 rounded-xl p-4 text-center border border-amber-100">
          <AlertCircle className="w-6 h-6 text-amber-400 mx-auto mb-1" />
          <p className="text-xs font-bold text-amber-800">Attendance Not Taken</p>
          <p className="text-[10px] text-amber-600 mt-0.5">
            {isFuture
              ? 'This class has not occurred yet.'
              : 'Start attendance to record student presence.'}
          </p>
        </div>
      )}
    </div>
  );
};
