/**
 * SNIST ERP - Teacher Week Timetable View
 * Phase 3: Teacher Calendar UI Implementation
 */

import React, { useMemo } from 'react';
import type { TeacherClassEvent } from '../../types/calendar.ts';
import { getWeekGridDays, isSameDate } from '../../utils/dateUtils.ts';
import { ClassEventPill } from './ClassEventPill.tsx';
import { Calendar as CalendarIcon } from 'lucide-react';

interface TeacherWeekViewProps {
  selectedDate: string;
  selectedEventId?: string | null;
  eventsByDate: Record<string, TeacherClassEvent[]>;
  todayIST: string;
  onSelectDate: (date: string) => void;
  onSelectEvent: (event: TeacherClassEvent) => void;
}

export const TeacherWeekView: React.FC<TeacherWeekViewProps> = ({
  selectedDate,
  selectedEventId,
  eventsByDate,
  todayIST,
  onSelectDate,
  onSelectEvent
}) => {
  const weekDays = useMemo(() => {
    return getWeekGridDays(selectedDate, selectedDate, todayIST);
  }, [selectedDate, todayIST]);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
      {/* 7 Columns Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-7 divide-y sm:divide-y-0 sm:divide-x divide-slate-100 min-h-[480px]">
        {weekDays.map((day) => {
          const dayEvents = eventsByDate[day.date] || [];
          const isSelected = isSameDate(day.date, selectedDate);
          const isToday = isSameDate(day.date, todayIST);

          return (
            <div
              key={day.date}
              onClick={() => onSelectDate(day.date)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectDate(day.date);
                }
              }}
              role="region"
              tabIndex={0}
              aria-label={`${day.dayName} ${day.dayNumber}, ${dayEvents.length} class${dayEvents.length === 1 ? '' : 'es'}`}
              className={`flex flex-col transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2f53d7] ${
                isSelected
                  ? 'bg-blue-50/30 ring-2 ring-inset ring-[#2f53d7]/50'
                  : 'bg-white hover:bg-slate-50/50'
              }`}
            >
              {/* Day Header */}
              <div
                className={`p-3 border-b text-center flex items-center justify-between sm:flex-col sm:justify-center gap-1 ${
                  isSelected
                    ? 'border-[#2f53d7] bg-blue-50/50'
                    : 'border-slate-100 bg-slate-50/60'
                }`}
              >
                <span className="text-[11px] font-black uppercase tracking-wider text-slate-500">
                  {day.dayName}
                </span>

                <div className="flex items-center gap-2 sm:gap-1">
                  <span
                    className={`inline-flex items-center justify-center text-sm font-extrabold w-7 h-7 rounded-full transition-colors ${
                      isToday
                        ? 'bg-[#2f53d7] text-white shadow-sm'
                        : isSelected
                        ? 'bg-[#001e40] text-white'
                        : 'text-[#001e40]'
                    }`}
                  >
                    {day.dayNumber}
                  </span>

                  {isToday && (
                    <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded-full bg-blue-100 text-[#2f53d7]">
                      Today
                    </span>
                  )}
                </div>
              </div>

              {/* Day Events Column */}
              <div className="flex-1 p-2 sm:p-2.5 flex flex-col gap-2 min-h-[140px]">
                {dayEvents.length > 0 ? (
                  dayEvents.map((event) => (
                    <ClassEventPill
                      key={event.id}
                      event={event}
                      isSelected={event.id === selectedEventId}
                      onSelect={onSelectEvent}
                    />
                  ))
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-3 text-slate-400">
                    <CalendarIcon className="w-5 h-5 mb-1 text-slate-300 stroke-[1.5]" />
                    <span className="text-[11px] font-medium">No classes</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
