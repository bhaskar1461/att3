/**
 * SNIST ERP - Teacher Chronological Class List View
 * Phase 3: Teacher Calendar UI Implementation
 */

import React, { useState, useMemo } from 'react';
import type { TeacherClassEvent } from '../../types/calendar.ts';
import { formatISTDisplayDate } from '../../utils/dateUtils.ts';
import { 
  Search, 
  Calendar as CalendarIcon, 
  Users, 
  CheckCircle2, 
  Lock, 
  AlertCircle, 
  Play, 
  ChevronRight,
  Radio
} from 'lucide-react';

interface TeacherListViewProps {
  allEvents: TeacherClassEvent[];
  selectedEventId?: string | null;
  onSelectEvent: (event: TeacherClassEvent) => void;
  onStartAttendance?: (event: TeacherClassEvent) => void;
}

export const TeacherListView: React.FC<TeacherListViewProps> = ({
  allEvents,
  selectedEventId,
  onSelectEvent,
  onStartAttendance
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterState, setFilterState] = useState<'ALL' | 'COMPLETED' | 'PENDING'>('ALL');

  // Filter & sort events
  const filteredEvents = useMemo(() => {
    return allEvents
      .filter((e) => {
        const matchesQuery = 
          e.subjectName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          e.subjectCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
          e.sectionName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          e.date.includes(searchQuery);

        if (!matchesQuery) return false;

        if (filterState === 'COMPLETED') {
          return e.attendanceState === 'COMPLETED' || e.attendanceState === 'ATTENDANCE_TAKEN';
        }
        if (filterState === 'PENDING') {
          return e.attendanceState === 'UPCOMING' || e.attendanceState === 'NO_ATTENDANCE' || e.attendanceState === 'CURRENT';
        }
        return true;
      })
      .sort((a, b) => {
        if (a.date !== b.date) {
          return b.date.localeCompare(a.date); // newest date first
        }
        return a.periodNumber - b.periodNumber;
      });
  }, [allEvents, searchQuery, filterState]);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col space-y-4 p-4 sm:p-5">
      {/* Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Filter by subject, section, date..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#2f53d7] focus:bg-white transition"
          />
        </div>

        <div className="flex items-center gap-1.5 self-start sm:self-auto bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-bold">
          <button
            onClick={() => setFilterState('ALL')}
            className={`px-3 py-1 rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f53d7] ${
              filterState === 'ALL' ? 'bg-white text-[#001e40] shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            All ({allEvents.length})
          </button>
          <button
            onClick={() => setFilterState('COMPLETED')}
            className={`px-3 py-1 rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
              filterState === 'COMPLETED' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Marked
          </button>
          <button
            onClick={() => setFilterState('PENDING')}
            className={`px-3 py-1 rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f53d7] ${
              filterState === 'PENDING' ? 'bg-white text-[#2f53d7] shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Pending
          </button>
        </div>
      </div>

      {/* Class Items List */}
      <div className="divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden">
        {filteredEvents.length > 0 ? (
          filteredEvents.map((event) => {
            const isSelected = event.id === selectedEventId;

            return (
              <div
                key={event.id}
                onClick={() => onSelectEvent(event)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectEvent(event);
                  }
                }}
                role="button"
                tabIndex={0}
                aria-label={`${event.subjectName}, Section ${event.sectionName}, ${event.date}`}
                className={`p-3.5 sm:p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 cursor-pointer transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2f53d7] ${
                  isSelected
                    ? 'bg-blue-50/50 border-l-4 border-l-[#2f53d7]'
                    : 'hover:bg-slate-50'
                }`}
              >
                {/* Left: Date & Time Pill */}
                <div className="flex items-center gap-3 sm:w-48 shrink-0">
                  <div className="p-2 rounded-xl bg-slate-100 text-[#001e40]">
                    <CalendarIcon className="w-4 h-4 text-slate-600" />
                  </div>
                  <div>
                    <div className="text-xs font-extrabold text-[#001e40]">
                      {formatISTDisplayDate(event.date).split(',')[0]}
                    </div>
                    <div className="text-[11px] font-semibold text-slate-500">
                      {event.date} • {event.startTime}
                    </div>
                  </div>
                </div>

                {/* Middle: Subject & Section */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-extrabold text-[#001e40]">
                      {event.subjectName}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded font-bold bg-blue-100/70 text-[#2f53d7]">
                      {event.sectionName}
                    </span>
                    <span className="text-xs text-slate-400 font-semibold">
                      {event.periodLabel}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-3">
                    <span>{event.department}</span>
                    {event.totalStudents > 0 && (
                      <span className="flex items-center gap-1 font-semibold text-slate-600">
                        <Users className="w-3.5 h-3.5 text-slate-400" />
                        <span>
                          {event.presentCount} / {event.totalStudents} present ({event.attendancePercentage}%)
                        </span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Right: Status Pill & Action */}
                <div className="shrink-0 flex items-center gap-2 self-end sm:self-auto">
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold ${
                      event.attendanceState === 'CURRENT'
                        ? 'bg-rose-50 text-rose-700 border border-rose-200'
                        : event.attendanceState === 'COMPLETED' || event.attendanceState === 'ATTENDANCE_TAKEN'
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : event.attendanceState === 'LOCKED'
                        ? 'bg-slate-100 text-slate-700 border border-slate-200'
                        : event.attendanceState === 'NO_ATTENDANCE'
                        ? 'bg-amber-50 text-amber-700 border border-amber-200'
                        : 'bg-blue-50 text-blue-700 border border-blue-200'
                    }`}
                  >
                    {event.attendanceState === 'CURRENT' ? (
                      <>
                        <Radio className="w-3 h-3 text-rose-600 motion-safe:animate-pulse" /> Live Now
                      </>
                    ) : event.attendanceState === 'COMPLETED' || event.attendanceState === 'ATTENDANCE_TAKEN' ? (
                      <>
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Marked
                      </>
                    ) : event.attendanceState === 'LOCKED' ? (
                      <>
                        <Lock className="w-3 h-3 text-slate-500" /> Locked
                      </>
                    ) : event.attendanceState === 'NO_ATTENDANCE' ? (
                      <>
                        <AlertCircle className="w-3 h-3 text-amber-600" /> Not Taken
                      </>
                    ) : (
                      'Upcoming'
                    )}
                  </span>

                    {onStartAttendance && event.canStartAttendance && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onStartAttendance(event);
                        }}
                        className="px-3 py-1 rounded-lg bg-[#2f53d7] hover:bg-[#203db0] text-white text-xs font-bold flex items-center gap-1 active:scale-95 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f53d7] focus-visible:ring-offset-1"
                        title={event.hasSession && event.sessionStatus === 'OPEN' ? 'Continue active attendance session' : 'Start attendance session'}
                      >
                        <Play className="w-3 h-3 fill-current" />
                        <span>{event.hasSession && event.sessionStatus === 'OPEN' ? 'Continue' : 'Start'}</span>
                      </button>
                    )}

                  <ChevronRight className="w-4 h-4 text-slate-400" />
                </div>
              </div>
            );
          })
        ) : (
          <div className="p-8 text-center text-slate-500 space-y-2">
            <p className="text-sm font-semibold">No classes match your filter criteria.</p>
            {(searchQuery || filterState !== 'ALL') && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setFilterState('ALL');
                }}
                className="text-xs font-bold text-[#2f53d7] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f53d7] rounded px-1.5 py-0.5"
              >
                Reset Filters
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
