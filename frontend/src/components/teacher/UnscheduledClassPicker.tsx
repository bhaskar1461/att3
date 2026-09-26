import React from 'react';
import {
  GraduationCap,
  Clock,
  Sun,
  Moon,
  Check,
  Play,
  RefreshCw,
  Calendar as CalendarIcon
} from 'lucide-react';
import type { TeacherAssignment } from '../../types/index.ts';

interface UnscheduledClassPickerProps {
  displayDate: string;
  selectedDate: string;
  todayIST: string;
  allottedClasses: TeacherAssignment[];
  selectedAllottedClassId: number | null;
  setSelectedAllottedClassId: (id: number) => void;
  selectedShift: 'AM' | 'PM';
  setSelectedShift: (shift: 'AM' | 'PM') => void;
  customPeriodCount: number;
  setCustomPeriodCount: (cnt: number) => void;
  isStartingSession: boolean;
  onStartAllottedAttendance: () => void;
}

export const UnscheduledClassPicker: React.FC<UnscheduledClassPickerProps> = ({
  displayDate,
  selectedDate,
  todayIST,
  allottedClasses,
  selectedAllottedClassId,
  setSelectedAllottedClassId,
  selectedShift,
  setSelectedShift,
  customPeriodCount,
  setCustomPeriodCount,
  isStartingSession,
  onStartAllottedAttendance
}) => {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <div>
          <h4 className="text-sm font-black text-[#001e40] flex items-center gap-2">
            <GraduationCap className="w-4 h-4 text-[#2f53d7]" />
            <span>Allotted Classes</span>
          </h4>
          <p className="text-[11px] text-slate-500 font-medium mt-0.5">
            Select an allotted class to launch attendance for {displayDate}
          </p>
        </div>
        <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-blue-50 text-[#2f53d7] border border-blue-200">
          {allottedClasses?.length || 0} Allotted
        </span>
      </div>

      {allottedClasses && allottedClasses.length > 0 ? (
        <div className="space-y-3">
          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
            {allottedClasses.map((cls) => {
              const isSelected = selectedAllottedClassId === cls.assignment_id;
              return (
                <div
                  key={cls.assignment_id}
                  onClick={() => setSelectedAllottedClassId(cls.assignment_id)}
                  className={`p-3 rounded-xl border transition-all cursor-pointer text-left ${
                    isSelected
                      ? 'bg-blue-50/80 border-[#2f53d7] ring-1 ring-[#2f53d7] shadow-sm'
                      : 'bg-white hover:bg-slate-50/80 border-slate-200 text-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h5 className="text-xs font-bold text-[#001e40] truncate leading-tight">
                        {cls.subject_name}
                      </h5>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-blue-100 text-[#15347e]">
                          {cls.section_name}
                        </span>
                        {cls.subject_code && (
                          <span className="text-[10px] text-slate-500 font-semibold">
                            {cls.subject_code}
                          </span>
                        )}
                        {cls.department && (
                          <span className="text-[10px] text-slate-400">
                            • {cls.department}
                          </span>
                        )}
                      </div>
                    </div>
                    <div
                      className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 mt-0.5 ${
                        isSelected
                          ? 'border-[#2f53d7] bg-[#2f53d7] text-white'
                          : 'border-slate-300 bg-white'
                      }`}
                    >
                      {isSelected && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* AM & PM 4-Period Shift Selectors */}
          <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-extrabold text-slate-700 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-[#2f53d7]" /> Select Attendance Shift:
              </span>
              <span className="px-2 py-0.5 rounded-full bg-blue-100 text-[#15347e] text-[10px] font-black">
                {selectedShift === 'AM' ? 'Period 1-4 (4 Periods)' : 'Period 5-8 (4 Periods)'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setSelectedShift('AM');
                  setCustomPeriodCount(4);
                }}
                className={`py-2 px-2.5 rounded-xl text-left border transition-all cursor-pointer ${
                  selectedShift === 'AM'
                    ? 'bg-[#2f53d7] text-white border-[#2f53d7] shadow-md shadow-[#2f53d7]/20 ring-1 ring-[#2f53d7]'
                    : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black flex items-center gap-1">
                    <Sun className={`w-3.5 h-3.5 ${selectedShift === 'AM' ? 'text-amber-300' : 'text-amber-500'}`} />
                    AM Shift
                  </span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-black ${
                      selectedShift === 'AM' ? 'bg-white/20 text-white' : 'bg-blue-100 text-[#15347e]'
                    }`}
                  >
                    4 Periods
                  </span>
                </div>
                <div className={`text-[10px] mt-1 font-medium ${selectedShift === 'AM' ? 'text-blue-100' : 'text-slate-500'}`}>
                  Periods 1–4 (09:30 AM – 01:00 PM)
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setSelectedShift('PM');
                  setCustomPeriodCount(4);
                }}
                className={`py-2 px-2.5 rounded-xl text-left border transition-all cursor-pointer ${
                  selectedShift === 'PM'
                    ? 'bg-[#2f53d7] text-white border-[#2f53d7] shadow-md shadow-[#2f53d7]/20 ring-1 ring-[#2f53d7]'
                    : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black flex items-center gap-1">
                    <Moon className={`w-3.5 h-3.5 ${selectedShift === 'PM' ? 'text-indigo-200' : 'text-indigo-600'}`} />
                    PM Shift
                  </span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-black ${
                      selectedShift === 'PM' ? 'bg-white/20 text-white' : 'bg-blue-100 text-[#15347e]'
                    }`}
                  >
                    4 Periods
                  </span>
                </div>
                <div className={`text-[10px] mt-1 font-medium ${selectedShift === 'PM' ? 'text-blue-100' : 'text-slate-500'}`}>
                  Periods 5–8 (01:40 PM – 05:00 PM)
                </div>
              </button>
            </div>

            {/* Custom Period Count Adjuster (1 to 8) */}
            <div className="pt-2 flex flex-col gap-1.5 border-t border-slate-200/60">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-500">Custom Period Count:</span>
                <span className="text-[10px] font-black text-[#2f53d7]">
                  {customPeriodCount} {customPeriodCount === 1 ? 'Period' : 'Periods'}
                </span>
              </div>
              <div className="grid grid-cols-8 gap-1">
                {[1, 2, 3, 4, 5, 6, 7, 8].map((cnt) => (
                  <button
                    key={cnt}
                    type="button"
                    onClick={() => setCustomPeriodCount(cnt)}
                    className={`py-1.5 rounded-lg text-xs font-black transition text-center cursor-pointer ${
                      customPeriodCount === cnt
                        ? 'bg-[#001e40] text-white shadow-sm ring-1 ring-[#001e40]'
                        : 'bg-white hover:bg-slate-200 text-slate-700 border border-slate-200'
                    }`}
                    title={`${cnt} ${cnt === 1 ? 'Period' : 'Periods'}`}
                  >
                    {cnt}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Action Button */}
          <button
            type="button"
            onClick={onStartAllottedAttendance}
            disabled={isStartingSession || !selectedAllottedClassId}
            className="w-full py-3.5 bg-gradient-to-r from-[#2f53d7] to-[#1e3bb3] hover:from-[#203db0] hover:to-[#172e8f] disabled:opacity-50 text-white font-black rounded-xl text-sm flex items-center justify-center gap-2 shadow-md shadow-[#2f53d7]/20 transition active:scale-95 cursor-pointer"
          >
            {isStartingSession ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Launching Attendance Session...</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-current" />
                <span>
                  {selectedDate < todayIST ? 'Take Past Attendance' : 'Start Attendance'} ({customPeriodCount} Periods • {selectedShift})
                </span>
              </>
            )}
          </button>
        </div>
      ) : (
        <div className="text-center py-6 space-y-2">
          <CalendarIcon className="w-8 h-8 text-slate-300 mx-auto stroke-[1.5]" />
          <h4 className="text-sm font-bold text-slate-700">No Allotted Classes Found</h4>
          <p className="text-xs text-slate-400">
            You do not have any subject assignments assigned in the institutional database.
          </p>
        </div>
      )}
    </div>
  );
};
