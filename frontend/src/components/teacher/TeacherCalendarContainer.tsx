/**
 * SNIST ERP - Teacher Calendar Container
 * Phase 3: Teacher Calendar UI Implementation
 * 
 * Orchestrates Calendar Toolbar, Month/Week/Day/List views, and Selected Class Panel.
 */

import React, { useState, useEffect, useMemo } from 'react';
import type { 
  CalendarViewMode, 
  TeacherClassEvent 
} from '../../types/calendar.ts';
import type { TeacherAssignment } from '../../types/index.ts';
import { 
  parseDateComponents, 
  addDays, 
  isSameDate 
} from '../../utils/dateUtils.ts';
import { TeacherCalendarToolbar } from './TeacherCalendarToolbar.tsx';
import { TeacherMonthGrid } from './TeacherMonthGrid.tsx';
import { TeacherWeekView } from './TeacherWeekView.tsx';
import { TeacherDayView } from './TeacherDayView.tsx';
import { TeacherListView } from './TeacherListView.tsx';
import { CalendarLegend } from './CalendarLegend.tsx';
import { SelectedClassPanel } from './SelectedClassPanel.tsx';
import { CurrentClassHeroCard, type CurrentClassInfo } from './CurrentClassHeroCard.tsx';
import { RefreshCw } from 'lucide-react';

interface TeacherCalendarContainerProps {
  eventsByDate: Record<string, TeacherClassEvent[]>;
  allEvents: TeacherClassEvent[];
  todayIST: string;
  allottedClasses?: TeacherAssignment[];
  isLoading?: boolean;
  currentClassInfo?: CurrentClassInfo | null;
  isStartingSession?: boolean;
  onStartAttendance: (event: TeacherClassEvent) => void;
  onLockSession?: (sessionId: number) => void;
  onOpenProjector?: (sessionId: number) => void;
  onUnlockSession?: (sessionId: number) => void;
  onOpenRosterDetails: (event: TeacherClassEvent) => void;
  onOpenExcelRegister?: () => void;
  onOpenReports?: () => void;
  onViewAssignments?: () => void;
  onTakePreviousClass?: () => void;
  onToggleStudentAttendance?: (rollNumber: string, currentStatus: string, sessionId?: number) => void;
  initialSelectedDate?: string;
  activeSessionId?: number | null;
  onUpdateSessionPeriod?: (sessionId: number, periodCount: number, periodLabel: string) => Promise<void>;
  onDeleteSession?: (sessionId: number) => Promise<void>;
}

export const TeacherCalendarContainer: React.FC<TeacherCalendarContainerProps> = ({
  eventsByDate,
  allEvents,
  todayIST,
  allottedClasses = [],
  isLoading = false,
  currentClassInfo = null,
  isStartingSession = false,
  onStartAttendance,
  onLockSession,
  onOpenProjector,
  onUnlockSession,
  onOpenRosterDetails,
  onOpenExcelRegister,
  onOpenReports,
  onViewAssignments,
  onTakePreviousClass,
  onToggleStudentAttendance,
  initialSelectedDate,
  activeSessionId,
  onUpdateSessionPeriod,
  onDeleteSession
}) => {
  const initialDate = initialSelectedDate || todayIST;
  const initialParsed = parseDateComponents(initialDate);

  const [currentYear, setCurrentYear] = useState<number>(initialParsed.year);
  const [currentMonth, setCurrentMonth] = useState<number>(initialParsed.month); // 1-12
  const [selectedDate, setSelectedDate] = useState<string>(initialDate);
  const [viewMode, setViewMode] = useState<CalendarViewMode>('month');
  const [selectedEvent, setSelectedEvent] = useState<TeacherClassEvent | null>(null);

  // Auto-select relevant class when selectedDate or events change
  useEffect(() => {
    const dayEvents = eventsByDate[selectedDate] || [];
    if (dayEvents.length > 0) {
      // If an active session exists on this date, prioritize it
      const activeEv = activeSessionId 
        ? dayEvents.find(e => e.sessionId === activeSessionId)
        : dayEvents.find(e => e.attendanceState === 'CURRENT');
      
      setSelectedEvent(activeEv || dayEvents[0]);
    } else {
      setSelectedEvent(null);
    }
  }, [selectedDate, eventsByDate, activeSessionId]);

  // Today's classes for the quick mini-list in the side panel
  const todayEvents = useMemo(() => {
    return eventsByDate[todayIST] || [];
  }, [eventsByDate, todayIST]);

  // Total classes visible in the current month
  const totalClassesInMonth = useMemo(() => {
    const prefix = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
    return allEvents.filter(e => e.date.startsWith(prefix)).length;
  }, [allEvents, currentYear, currentMonth]);

  // Navigation handlers
  const handlePrev = () => {
    if (viewMode === 'month') {
      if (currentMonth === 1) {
        setCurrentYear(prev => prev - 1);
        setCurrentMonth(12);
      } else {
        setCurrentMonth(prev => prev - 1);
      }
    } else if (viewMode === 'week') {
      const newDate = addDays(selectedDate, -7);
      setSelectedDate(newDate);
      const p = parseDateComponents(newDate);
      setCurrentYear(p.year);
      setCurrentMonth(p.month);
    } else {
      // day or list view
      const newDate = addDays(selectedDate, -1);
      setSelectedDate(newDate);
      const p = parseDateComponents(newDate);
      setCurrentYear(p.year);
      setCurrentMonth(p.month);
    }
  };

  const handleNext = () => {
    if (viewMode === 'month') {
      if (currentMonth === 12) {
        setCurrentYear(prev => prev + 1);
        setCurrentMonth(1);
      } else {
        setCurrentMonth(prev => prev + 1);
      }
    } else if (viewMode === 'week') {
      const newDate = addDays(selectedDate, 7);
      setSelectedDate(newDate);
      const p = parseDateComponents(newDate);
      setCurrentYear(p.year);
      setCurrentMonth(p.month);
    } else {
      // day or list view
      const newDate = addDays(selectedDate, 1);
      setSelectedDate(newDate);
      const p = parseDateComponents(newDate);
      setCurrentYear(p.year);
      setCurrentMonth(p.month);
    }
  };

  const handleToday = () => {
    setSelectedDate(todayIST);
    const p = parseDateComponents(todayIST);
    setCurrentYear(p.year);
    setCurrentMonth(p.month);
  };

  const handleSelectDate = (date: string) => {
    setSelectedDate(date);
    const p = parseDateComponents(date);
    setCurrentYear(p.year);
    setCurrentMonth(p.month);
  };

  const handleSelectEvent = (event: TeacherClassEvent) => {
    setSelectedEvent(event);
    if (!isSameDate(event.date, selectedDate)) {
      handleSelectDate(event.date);
    }
  };

  const handleTakePreviousClassInternal = () => {
    const pastEvents = allEvents
      .filter(e => e.date < todayIST)
      .sort((a, b) => b.date.localeCompare(a.date));

    if (pastEvents.length > 0) {
      handleSelectDate(pastEvents[0].date);
      setSelectedEvent(pastEvents[0]);
    } else {
      const yesterday = addDays(todayIST, -1);
      handleSelectDate(yesterday);
    }
  };

  // Match active class event from today's normalized events
  const matchedLiveEvent = useMemo(() => {
    if (!currentClassInfo || !currentClassInfo.is_class_active || !currentClassInfo.assignment) {
      return null;
    }
    const asgn = currentClassInfo.assignment;
    const todayList = eventsByDate[todayIST] || [];
    return (
      todayList.find(e => 
        e.subjectId === asgn.subject_id && 
        e.sectionId === asgn.section_id && 
        (currentClassInfo.existing_session_id ? e.sessionId === currentClassInfo.existing_session_id : true)
      ) || null
    );
  }, [currentClassInfo, eventsByDate, todayIST]);

  const handleLiveCardStartAttendance = () => {
    if (matchedLiveEvent) {
      handleSelectEvent(matchedLiveEvent);
      onStartAttendance(matchedLiveEvent);
    } else if (currentClassInfo?.assignment) {
      const asgn = currentClassInfo.assignment;
      const synthEvent: TeacherClassEvent = {
        id: `live-${asgn.assignment_id}-${todayIST}`,
        sessionId: currentClassInfo.existing_session_id || null,
        sessionStatus: currentClassInfo.session_status || null,
        subjectId: asgn.subject_id,
        subjectCode: asgn.subject_code,
        subjectName: asgn.subject_name,
        sectionId: asgn.section_id,
        sectionName: asgn.section_name,
        department: '',
        academicYear: '',
        assignmentId: asgn.assignment_id,
        room: `Room ${asgn.section_name}`,
        date: todayIST,
        periodNumber: 1,
        periodLabel: currentClassInfo.detected_period || 'Period 1',
        periodCount: 1,
        startTime: '09:30',
        endTime: '10:20',
        displayTime: currentClassInfo.detected_period || 'Class Time',
        totalStudents: currentClassInfo.total_enrolled,
        presentCount: currentClassInfo.present_count,
        absentCount: Math.max(0, currentClassInfo.total_enrolled - currentClassInfo.present_count),
        attendancePercentage: currentClassInfo.total_enrolled > 0 ? Math.round((currentClassInfo.present_count / currentClassInfo.total_enrolled) * 100) : 0,
        attendanceState: currentClassInfo.session_status === 'LOCKED' ? 'LOCKED' : 'CURRENT',
        isToday: true,
        isCurrent: true,
        isPast: false,
        isUpcoming: false,
        hasSession: Boolean(currentClassInfo.existing_session_id),
        canStartAttendance: currentClassInfo.session_status !== 'LOCKED',
        canViewAttendance: true,
        canEditAttendance: true,
        canLockAttendance: currentClassInfo.session_status === 'OPEN',
        canUnlockAttendance: currentClassInfo.session_status === 'LOCKED'
      };
      handleSelectEvent(synthEvent);
      onStartAttendance(synthEvent);
    }
  };

  const handleLiveCardViewAttendance = () => {
    if (matchedLiveEvent) {
      onOpenRosterDetails(matchedLiveEvent);
    } else if (currentClassInfo?.existing_session_id) {
      onOpenRosterDetails({
        sessionId: currentClassInfo.existing_session_id
      } as any);
    }
  };

  const handleSelectCurrentClass = () => {
    if (matchedLiveEvent) {
      handleSelectEvent(matchedLiveEvent);
    }
  };

  return (
    <div className="space-y-4">
      {/* Prominent Live / Current Class Hero Banner (Section 4 & Section 21) */}
      <CurrentClassHeroCard
        currentClassInfo={currentClassInfo}
        matchedEvent={matchedLiveEvent}
        isStarting={isStartingSession}
        onStartAttendance={handleLiveCardStartAttendance}
        onContinueAttendance={handleLiveCardStartAttendance}
        onOpenProjector={onOpenProjector}
        onLockSession={onLockSession}
        onViewAttendance={handleLiveCardViewAttendance}
        onSelectCurrentClass={handleSelectCurrentClass}
      />

      {/* Calendar Header & View Switcher */}
      <TeacherCalendarToolbar
        currentYear={currentYear}
        currentMonth={currentMonth}
        selectedDate={selectedDate}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onPrev={handlePrev}
        onNext={handleNext}
        onToday={handleToday}
        totalClassesCount={totalClassesInMonth}
        isLoading={isLoading}
      />

      {/* Main Two-Column Layout (Left 68% Calendar, Right 32% Class Details) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Column: Calendar View Matrix */}
        <div className="lg:col-span-8 space-y-3">
          {isLoading && allEvents.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 text-[#2f53d7] animate-spin" />
                  <span className="text-xs font-bold text-slate-600">Loading schedule and attendance matrix...</span>
                </div>
                <div className="h-4 w-20 bg-slate-200 rounded animate-pulse" />
              </div>
              <div className="grid grid-cols-7 gap-2">
                {[...Array(7)].map((_, i) => (
                  <div key={i} className="h-6 bg-slate-100 rounded-md animate-pulse" />
                ))}
              </div>
              <div className="grid grid-cols-7 gap-2">
                {[...Array(28)].map((_, i) => (
                  <div key={i} className="h-20 bg-slate-50 border border-slate-100 rounded-xl p-2 flex flex-col justify-between animate-pulse">
                    <div className="h-3 w-5 bg-slate-200 rounded-full" />
                    {i % 3 === 0 && <div className="h-4 w-full bg-blue-100/70 rounded-md" />}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
              {viewMode === 'month' && (
                <TeacherMonthGrid
                  year={currentYear}
                  month={currentMonth}
                  selectedDate={selectedDate}
                  selectedEventId={selectedEvent?.id}
                  eventsByDate={eventsByDate}
                  todayIST={todayIST}
                  onSelectDate={handleSelectDate}
                  onSelectEvent={handleSelectEvent}
                />
              )}

              {viewMode === 'week' && (
                <TeacherWeekView
                  selectedDate={selectedDate}
                  selectedEventId={selectedEvent?.id}
                  eventsByDate={eventsByDate}
                  todayIST={todayIST}
                  onSelectDate={handleSelectDate}
                  onSelectEvent={handleSelectEvent}
                />
              )}

              {viewMode === 'day' && (
                <TeacherDayView
                  selectedDate={selectedDate}
                  selectedEventId={selectedEvent?.id}
                  dayEvents={eventsByDate[selectedDate] || []}
                  todayIST={todayIST}
                  onSelectEvent={handleSelectEvent}
                  onStartAttendance={onStartAttendance}
                />
              )}

              {viewMode === 'list' && (
                <TeacherListView
                  allEvents={allEvents}
                  selectedEventId={selectedEvent?.id}
                  onSelectEvent={handleSelectEvent}
                  onStartAttendance={onStartAttendance}
                />
              )}

              <CalendarLegend onViewAssignments={onViewAssignments} />
            </>
          )}
        </div>

        {/* Right Column: Selected Class & Actions Panel */}
        <div className="lg:col-span-4">
          <SelectedClassPanel
            selectedDate={selectedDate}
            selectedEvent={selectedEvent}
            todayEvents={todayEvents}
            todayIST={todayIST}
            allottedClasses={allottedClasses}
            isStartingSession={isStartingSession}
            onPrevDate={() => handleSelectDate(addDays(selectedDate, -1))}
            onNextDate={() => handleSelectDate(addDays(selectedDate, 1))}
            onSelectEvent={handleSelectEvent}
            onStartAttendance={onStartAttendance}
            onLockSession={onLockSession}
            onOpenProjector={onOpenProjector}
            onUnlockSession={onUnlockSession}
            onOpenRosterDetails={onOpenRosterDetails}
            onOpenExcelRegister={onOpenExcelRegister}
            onOpenReports={onOpenReports}
            onTakePreviousClass={onTakePreviousClass || handleTakePreviousClassInternal}
            onToggleStudentAttendance={onToggleStudentAttendance}
            onGoToToday={handleToday}
            onUpdateSessionPeriod={onUpdateSessionPeriod}
            onDeleteSession={onDeleteSession}
          />
        </div>
      </div>
    </div>
  );
};
