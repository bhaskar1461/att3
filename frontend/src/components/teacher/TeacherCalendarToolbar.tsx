/**
 * SNIST ERP - Teacher Calendar Toolbar
 * Phase 3: Teacher Calendar UI Implementation
 */

import React from 'react';
import { 
  ChevronLeft, 
  ChevronRight, 
  Calendar as CalendarIcon, 
  CalendarDays, 
  CalendarRange, 
  ListOrdered 
} from 'lucide-react';
import type { CalendarViewMode } from '../../types/calendar.ts';
import { formatISTMonthYear, formatISTDisplayDate } from '../../utils/dateUtils.ts';

interface TeacherCalendarToolbarProps {
  currentYear: number;
  currentMonth: number; // 1 to 12
  selectedDate: string;
  viewMode: CalendarViewMode;
  onViewModeChange: (mode: CalendarViewMode) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  totalClassesCount?: number;
  isLoading?: boolean;
}

export const TeacherCalendarToolbar: React.FC<TeacherCalendarToolbarProps> = ({
  currentYear,
  currentMonth,
  selectedDate,
  viewMode,
  onViewModeChange,
  onPrev,
  onNext,
  onToday,
  totalClassesCount = 0,
  isLoading = false
}) => {
  const titleText = viewMode === 'day'
    ? formatISTDisplayDate(selectedDate)
    : formatISTMonthYear(currentYear, currentMonth);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm space-y-3 sm:space-y-0 sm:flex sm:items-center sm:justify-between transition-all">
      {/* Left: Navigation Controls & Month/Year Title */}
      <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
        <button
          onClick={onToday}
          className="px-3.5 py-1.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-white text-[#001e40] font-extrabold text-xs shadow-sm hover:border-[#2f53d7] active:scale-95 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f53d7] focus-visible:ring-offset-1"
          title="Jump to Today's date"
          aria-label="Jump to Today's date"
        >
          Today
        </button>

        <div className="flex items-center bg-slate-100 p-0.5 rounded-xl border border-slate-200" role="group" aria-label="Date navigation">
          <button
            onClick={onPrev}
            className="p-1.5 rounded-lg hover:bg-white text-slate-700 hover:text-[#001e40] transition active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f53d7]"
            title="Previous period"
            aria-label="Previous period"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={onNext}
            className="p-1.5 rounded-lg hover:bg-white text-slate-700 hover:text-[#001e40] transition active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f53d7]"
            title="Next period"
            aria-label="Next period"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <h2 className="text-base sm:text-lg font-black text-[#001e40] font-heading flex items-center gap-2" aria-live="polite">
          <span>{titleText}</span>
          {totalClassesCount > 0 && (
            <span className="hidden md:inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-[#2f53d7] border border-blue-100">
              {totalClassesCount} {totalClassesCount === 1 ? 'class' : 'classes'}
            </span>
          )}
          {isLoading && (
            <span 
              className="w-2 h-2 rounded-full bg-[#2f53d7] motion-safe:animate-ping" 
              title="Updating schedule..."
              aria-label="Updating schedule"
            />
          )}
        </h2>
      </div>

      {/* Right: View Mode Toggle Pills (Month / Week / Day / List) */}
      <div 
        className="flex items-center bg-slate-100/90 p-1 rounded-xl border border-slate-200 self-start sm:self-auto"
        role="tablist"
        aria-label="Calendar view switcher"
      >
        <button
          onClick={() => onViewModeChange('month')}
          role="tab"
          aria-selected={viewMode === 'month'}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f53d7] ${
            viewMode === 'month'
              ? 'bg-[#2f53d7] text-white shadow-sm font-extrabold'
              : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
          }`}
          title="Month calendar view"
        >
          <CalendarIcon className="w-3.5 h-3.5" />
          <span>Month</span>
        </button>

        <button
          onClick={() => onViewModeChange('week')}
          role="tab"
          aria-selected={viewMode === 'week'}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f53d7] ${
            viewMode === 'week'
              ? 'bg-[#2f53d7] text-white shadow-sm font-extrabold'
              : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
          }`}
          title="Week timetable view"
        >
          <CalendarRange className="w-3.5 h-3.5" />
          <span>Week</span>
        </button>

        <button
          onClick={() => onViewModeChange('day')}
          role="tab"
          aria-selected={viewMode === 'day'}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f53d7] ${
            viewMode === 'day'
              ? 'bg-[#2f53d7] text-white shadow-sm font-extrabold'
              : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
          }`}
          title="Daily period schedule view"
        >
          <CalendarDays className="w-3.5 h-3.5" />
          <span>Day</span>
        </button>

        <button
          onClick={() => onViewModeChange('list')}
          role="tab"
          aria-selected={viewMode === 'list'}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f53d7] ${
            viewMode === 'list'
              ? 'bg-[#2f53d7] text-white shadow-sm font-extrabold'
              : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
          }`}
          title="Chronological class list view"
        >
          <ListOrdered className="w-3.5 h-3.5" />
          <span>List</span>
        </button>
      </div>
    </div>
  );
};
