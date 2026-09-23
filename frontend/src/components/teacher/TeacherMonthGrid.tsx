/**
 * SNIST ERP - Teacher Month Grid View
 * Phase 3: Teacher Calendar UI Implementation
 */

import React, { useMemo } from 'react';
import type { TeacherClassEvent } from '../../types/calendar.ts';
import { getMonthGridDays, isSameDate } from '../../utils/dateUtils.ts';
import { ClassEventPill } from './ClassEventPill.tsx';

const DAY_HEADER_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface TeacherMonthGridProps {
  year: number;
  month: number; // 1 to 12
  selectedDate: string;
  selectedEventId?: string | null;
  eventsByDate: Record<string, TeacherClassEvent[]>;
  todayIST: string;
  onSelectDate: (date: string) => void;
  onSelectEvent: (event: TeacherClassEvent) => void;
}

export const TeacherMonthGrid: React.FC<TeacherMonthGridProps> = ({
  year,
  month,
  selectedDate,
  selectedEventId,
  eventsByDate,
  todayIST,
  onSelectDate,
  onSelectEvent
}) => {
  // Memoize grid days generation to keep renders instant
  const gridCells = useMemo(() => {
    return getMonthGridDays(year, month, selectedDate, todayIST);
  }, [year, month, selectedDate, todayIST]);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
      {/* 7 Column Header */}
      <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50/90 text-center">
        {DAY_HEADER_NAMES.map((name, idx) => (
          <div
            key={name}
            className={`py-3 text-[11px] sm:text-xs font-black tracking-wider uppercase ${
              idx === 0 || idx === 6 ? 'text-slate-400' : 'text-[#001e40]'
            }`}
          >
            {name}
          </div>
        ))}
      </div>

      {/* 35 or 42 Calendar Cells Grid */}
      <div className="grid grid-cols-7 divide-x divide-y divide-slate-100 bg-slate-50">
        {gridCells.map((cell) => {
          const dayEvents = eventsByDate[cell.date] || [];
          const isSelected = isSameDate(cell.date, selectedDate);
          const isToday = isSameDate(cell.date, todayIST);

          return (
            <div
              key={cell.date}
              onClick={() => onSelectDate(cell.date)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectDate(cell.date);
                }
              }}
              role="gridcell"
              tabIndex={0}
              aria-selected={isSelected}
              aria-label={`${cell.date}${isToday ? ', Today' : ''}, ${dayEvents.length} class${dayEvents.length === 1 ? '' : 'es'}`}
              className={`min-h-[105px] sm:min-h-[125px] md:min-h-[140px] p-1.5 sm:p-2 transition-all flex flex-col justify-between group cursor-pointer relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2f53d7] ${
                cell.isCurrentMonth
                  ? isSelected
                    ? 'bg-blue-50/40 ring-2 ring-inset ring-[#2f53d7]/60'
                    : 'bg-white hover:bg-slate-50/70'
                  : 'bg-slate-50/60 text-slate-400 hover:bg-slate-100/50'
              }`}
            >
              {/* Day Header Row */}
              <div className="flex items-center justify-between gap-1 w-full mb-1">
                <span
                  className={`inline-flex items-center justify-center text-xs sm:text-sm font-bold w-6 h-6 sm:w-7 sm:h-7 rounded-full transition-colors ${
                    isToday
                      ? 'bg-[#2f53d7] text-white font-black shadow-sm'
                      : isSelected
                      ? 'bg-[#001e40] text-white font-extrabold'
                      : cell.isCurrentMonth
                      ? 'text-[#001e40] group-hover:text-[#2f53d7]'
                      : 'text-slate-400'
                  }`}
                >
                  {cell.dayNumber}
                </span>

                {isToday && (
                  <span className="hidden sm:inline-block text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded-full bg-blue-100 text-[#2f53d7]">
                    Today
                  </span>
                )}

                {dayEvents.length > 0 && (
                  <span className="sm:hidden text-[9px] font-bold px-1 rounded-full bg-blue-50 text-[#2f53d7]">
                    {dayEvents.length}
                  </span>
                )}
              </div>

              {/* Class Events Container */}
              <div className="flex-1 flex flex-col gap-1 overflow-hidden">
                {dayEvents.slice(0, 3).map((event) => (
                  <ClassEventPill
                    key={event.id}
                    event={event}
                    isSelected={event.id === selectedEventId}
                    onSelect={onSelectEvent}
                    compact
                  />
                ))}

                {dayEvents.length > 3 && (
                  <div className="text-[10px] font-bold text-[#2f53d7] text-center pt-0.5 hover:underline">
                    +{dayEvents.length - 3} more
                  </div>
                )}
              </div>

              {/* Bottom Subtle Indicator Dot if classes exist but space is constrained */}
              {dayEvents.length > 0 && (
                <div className="hidden sm:flex items-center justify-center gap-1 pt-1">
                  {dayEvents.slice(0, 4).map((e, idx) => (
                    <span
                      key={idx}
                      className={`w-1 h-1 rounded-full ${
                        e.attendanceState === 'COMPLETED'
                          ? 'bg-emerald-500'
                          : e.attendanceState === 'CURRENT'
                          ? 'bg-rose-500'
                          : e.attendanceState === 'LOCKED'
                          ? 'bg-slate-400'
                          : 'bg-blue-500'
                      }`}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
