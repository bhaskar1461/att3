import React from 'react';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Clock } from 'lucide-react';

export interface WeekDayInfo {
  date: string; // YYYY-MM-DD
  day_name: string; // Mon, Tue, Wed, Thu, Fri, Sat
  day_num: string; // e.g. "09 Sep"
  is_selected: boolean;
  present_count: number;
  absent_count: number;
  total_students: number;
  has_session: boolean;
}

interface WeeklyCalendarBarProps {
  selectedDate: string;
  onSelectDate: (date: string) => void;
  weekDays: WeekDayInfo[];
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onToday: () => void;
  sections?: Array<{ id: number; name: string }>;
  selectedSectionId?: number;
  onSelectSection?: (sectionId: number) => void;
  isLoading?: boolean;
}

export const WeeklyCalendarBar: React.FC<WeeklyCalendarBarProps> = ({
  selectedDate,
  onSelectDate,
  weekDays,
  onPrevWeek,
  onNextWeek,
  onToday,
  sections = [],
  selectedSectionId,
  onSelectSection,
  isLoading = false
}) => {
  const todayIso = new Date().toISOString().split('T')[0];

  const firstDay = weekDays[0]?.day_num || '';
  const lastDay = weekDays[weekDays.length - 1]?.day_num || '';

  return (
    <div className="snist-card p-4 sm:p-5 space-y-4 border-[#2f53d7]/20 shadow-sm">
      {/* Top Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-[#2f53d7]/10 text-[#2f53d7]">
            <CalendarIcon className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-heading text-sm font-bold text-[#15347e] flex items-center gap-2">
              Weekly Attendance Register
              <span className="text-[11px] font-semibold text-slate-500 font-sans">
                ({firstDay} — {lastDay})
              </span>
            </h4>
            <p className="text-[11px] text-slate-500">
              Monday to Saturday academic timetable — click any day to inspect and mark attendance
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Section Dropdown */}
          {sections.length > 0 && onSelectSection && (
            <select
              value={selectedSectionId}
              onChange={(e) => onSelectSection(Number(e.target.value))}
              className="px-3 py-1.5 border border-slate-300 rounded-xl text-xs font-bold text-[#15347e] bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-[#2f53d7]"
            >
              {sections.map((sec) => (
                <option key={sec.id} value={sec.id}>
                  Section: {sec.name}
                </option>
              ))}
            </select>
          )}

          {/* Navigation Controls */}
          <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button
              onClick={onPrevWeek}
              className="p-1.5 rounded-lg hover:bg-white text-slate-600 hover:text-[#15347e] transition-colors"
              title="Previous Week"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={onToday}
              className="px-2.5 py-1 text-xs font-bold text-slate-700 hover:text-[#2f53d7] transition-colors"
              title="Jump to Current Week"
            >
              Today
            </button>
            <button
              onClick={onNextWeek}
              className="p-1.5 rounded-lg hover:bg-white text-slate-600 hover:text-[#15347e] transition-colors"
              title="Next Week"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* 6 Day Academic Grid: Monday through Saturday */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2.5">
        {weekDays.map((day) => {
          const isSelected = day.date === selectedDate;
          const isToday = day.date === todayIso;
          const hasData = (day.present_count + day.absent_count) > 0;

          return (
            <button
              key={day.date}
              onClick={() => onSelectDate(day.date)}
              className={`p-3 rounded-2xl text-left transition-all relative border flex flex-col justify-between min-h-[90px] group ${
                isSelected
                  ? 'bg-gradient-to-b from-[#2f53d7] to-[#1e3bb3] text-white border-[#2f53d7] shadow-md shadow-[#2f53d7]/30 scale-[1.02]'
                  : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-700 hover:border-slate-300'
              }`}
            >
              {/* Top Row: Day Name and Today Badge */}
              <div className="flex items-center justify-between w-full">
                <span
                  className={`text-xs font-black tracking-wider uppercase ${
                    isSelected ? 'text-blue-100' : 'text-slate-500'
                  }`}
                >
                  {day.day_name}
                </span>
                {isToday && (
                  <span
                    className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase ${
                      isSelected
                        ? 'bg-white/20 text-white'
                        : 'bg-emerald-100 text-emerald-700'
                    }`}
                  >
                    Today
                  </span>
                )}
              </div>

              {/* Middle: Date Number */}
              <div className="my-1">
                <span
                  className={`text-base font-extrabold font-heading ${
                    isSelected ? 'text-white' : 'text-[#15347e]'
                  }`}
                >
                  {day.day_num}
                </span>
              </div>

              {/* Bottom Row: Attendance Status Pill */}
              <div className="pt-1">
                {hasData ? (
                  <div
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-lg inline-flex items-center gap-1 ${
                      isSelected
                        ? 'bg-white/20 text-white'
                        : 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                    }`}
                  >
                    <span>✓ {day.present_count}</span>
                    <span className="opacity-70">/ {day.total_students}</span>
                  </div>
                ) : (
                  <span
                    className={`text-[10px] font-medium ${
                      isSelected ? 'text-blue-200' : 'text-slate-400'
                    }`}
                  >
                    Not Marked
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
