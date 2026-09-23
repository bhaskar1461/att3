/**
 * SNIST ERP - Class Event Pill
 * Phase 3: Teacher Calendar UI Implementation
 */

import React from 'react';
import { 
  CheckCircle2, 
  Clock, 
  Lock, 
  AlertCircle, 
  Radio 
} from 'lucide-react';
import type { TeacherClassEvent } from '../../types/calendar.ts';

interface ClassEventPillProps {
  event: TeacherClassEvent;
  isSelected?: boolean;
  onSelect: (event: TeacherClassEvent) => void;
  compact?: boolean;
}

export const ClassEventPill: React.FC<ClassEventPillProps> = ({
  event,
  isSelected = false,
  onSelect,
  compact = false
}) => {
  // Visual state styling matching SNIST institutional aesthetic
  const getStyleTokens = () => {
    switch (event.attendanceState) {
      case 'CURRENT':
        return {
          container: 'bg-gradient-to-r from-blue-50 to-indigo-50 border-[#2f53d7] text-[#001e40] shadow-sm',
          dot: 'bg-rose-500 motion-safe:animate-pulse',
          icon: <Radio className="w-3 h-3 text-rose-600 motion-safe:animate-pulse shrink-0" />,
          statusText: 'Live Now'
        };
      case 'COMPLETED':
      case 'ATTENDANCE_TAKEN':
        return {
          container: 'bg-emerald-50/90 border-emerald-200 text-emerald-900 hover:border-emerald-300',
          dot: 'bg-emerald-500',
          icon: <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />,
          statusText: 'Marked'
        };
      case 'LOCKED':
        return {
          container: 'bg-slate-50 border-slate-200 text-slate-800 hover:border-slate-300',
          dot: 'bg-slate-400',
          icon: <Lock className="w-3 h-3 text-slate-500 shrink-0" />,
          statusText: 'Locked'
        };
      case 'NO_ATTENDANCE':
        return {
          container: 'bg-amber-50/80 border-amber-200 text-amber-900 hover:border-amber-300',
          dot: 'bg-amber-500',
          icon: <AlertCircle className="w-3 h-3 text-amber-600 shrink-0" />,
          statusText: 'Not Taken'
        };
      case 'UPCOMING':
      default:
        return {
          container: 'bg-blue-50/70 border-blue-200 text-blue-900 hover:border-blue-300',
          dot: 'bg-blue-500',
          icon: <Clock className="w-3 h-3 text-blue-600 shrink-0" />,
          statusText: 'Upcoming'
        };
    }
  };

  const style = getStyleTokens();

  if (compact) {
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          onSelect(event);
        }}
        className={`w-full text-left p-1.5 rounded-lg border text-[11px] font-semibold transition-all flex items-center justify-between gap-1 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f53d7] focus-visible:ring-offset-1 ${style.container} ${
          isSelected ? 'ring-2 ring-[#2f53d7] border-[#2f53d7] scale-[1.02] shadow-sm font-bold' : ''
        }`}
        title={`${event.subjectName} (${event.sectionName}) - ${event.displayTime}`}
        aria-label={`${event.subjectName}, Section ${event.sectionName}, ${event.displayTime}, Status: ${style.statusText}`}
      >
        <div className="flex items-center gap-1 min-w-0">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${style.dot}`} />
          <span className="truncate font-bold text-[#001e40]">{event.subjectName}</span>
        </div>
        <span className="text-[10px] text-slate-500 shrink-0">{event.sectionName}</span>
      </button>
    );
  }

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onSelect(event);
      }}
      className={`w-full text-left p-2 sm:p-2.5 rounded-xl border transition-all flex flex-col gap-1 group relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f53d7] focus-visible:ring-offset-1 ${style.container} ${
        isSelected
          ? 'ring-2 ring-[#2f53d7] border-[#2f53d7] shadow-md scale-[1.01]'
          : 'hover:shadow-sm active:scale-[0.99]'
      }`}
      title={`${event.subjectName} (${event.sectionName}) - ${event.displayTime}`}
      aria-label={`${event.subjectName}, Section ${event.sectionName}, ${event.displayTime}, Status: ${style.statusText}`}
    >
      {/* Top row: Time + Status icon */}
      <div className="flex items-center justify-between gap-1 w-full">
        <span className="text-[10px] font-extrabold tracking-tight text-slate-600 flex items-center gap-1">
          {style.icon}
          <span>{event.startTime}</span>
        </span>
        <span className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider bg-white/80 border border-slate-200/60 shrink-0">
          {event.sectionName}
        </span>
      </div>

      {/* Course Title */}
      <div className="font-bold text-xs text-[#001e40] line-clamp-1 group-hover:text-[#2f53d7] transition-colors">
        {event.subjectName}
      </div>

      {/* Bottom meta row: Period & Headcount */}
      <div className="flex items-center justify-between text-[10px] text-slate-500 pt-0.5 border-t border-slate-200/50">
        <span className="font-semibold">{event.periodLabel}</span>
        {event.presentCount > 0 ? (
          <span className="font-bold text-emerald-700">
            {event.presentCount}/{event.totalStudents}
          </span>
        ) : (
          <span className="text-slate-400">
            {event.totalStudents > 0 ? `${event.totalStudents} students` : 'Scheduled'}
          </span>
        )}
      </div>
    </button>
  );
};
