/**
 * SNIST ERP - Selected Class Side Panel
 * Phase 6 & Phase 4: Modular Class Details & Attendance Workspace
 */

import React, { useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Radio,
  BookOpen
} from 'lucide-react';
import type { TeacherClassEvent } from '../../types/calendar.ts';
import type { TeacherAssignment } from '../../types/index.ts';
import { formatISTDisplayDate, extractPeriodCount } from '../../utils/dateUtils.ts';
import { ClassDetailRoster } from './ClassDetailRoster.tsx';
import { ClassSessionHeader } from './ClassSessionHeader.tsx';
import { ClassAttendanceMetrics } from './ClassAttendanceMetrics.tsx';
import { ClassActionToolbar } from './ClassActionToolbar.tsx';
import { UnscheduledClassPicker } from './UnscheduledClassPicker.tsx';
import { ClassPanelQuickActions } from './ClassPanelQuickActions.tsx';

interface SelectedClassPanelProps {
  selectedDate: string;
  selectedEvent: TeacherClassEvent | null;
  todayEvents: TeacherClassEvent[];
  todayIST: string;
  allottedClasses?: TeacherAssignment[];
  isStartingSession?: boolean;
  onPrevDate: () => void;
  onNextDate: () => void;
  onSelectEvent: (event: TeacherClassEvent) => void;
  onStartAttendance: (event: TeacherClassEvent) => void;
  onLockSession?: (sessionId: number) => void;
  onOpenProjector?: (sessionId: number) => void;
  onUnlockSession?: (sessionId: number) => void;
  onOpenRosterDetails: (event: TeacherClassEvent) => void;
  onOpenExcelRegister?: () => void;
  onOpenReports?: () => void;
  onTakePreviousClass?: () => void;
  onToggleStudentAttendance?: (rollNumber: string, currentStatus: string, sessionId?: number) => void;
  onGoToToday?: () => void;
  onUpdateSessionPeriod?: (sessionId: number, periodCount: number, periodLabel: string) => Promise<void>;
  onDeleteSession?: (sessionId: number) => Promise<void>;
}

export const SelectedClassPanel: React.FC<SelectedClassPanelProps> = ({
  selectedDate,
  selectedEvent,
  todayEvents,
  todayIST,
  allottedClasses = [],
  isStartingSession = false,
  onPrevDate,
  onNextDate,
  onSelectEvent,
  onStartAttendance,
  onLockSession,
  onOpenProjector,
  onUnlockSession,
  onOpenRosterDetails,
  onOpenExcelRegister,
  onOpenReports,
  onToggleStudentAttendance,
  onGoToToday,
  onUpdateSessionPeriod,
  onDeleteSession
}) => {
  const [customPeriodCount, setCustomPeriodCount] = useState<number>(4);
  const [selectedShift, setSelectedShift] = useState<'AM' | 'PM'>('AM');
  const [selectedAllottedClassId, setSelectedAllottedClassId] = useState<number | null>(null);
  const [isPeriodEditOpen, setIsPeriodEditOpen] = useState(false);
  const [editPeriodCount, setEditPeriodCount] = useState<number>(1);
  const [isUpdatingPeriod, setIsUpdatingPeriod] = useState(false);

  // Auto-select first allotted class if none selected
  React.useEffect(() => {
    if (allottedClasses && allottedClasses.length > 0) {
      if (selectedAllottedClassId === null || !allottedClasses.some(c => c.assignment_id === selectedAllottedClassId)) {
        setSelectedAllottedClassId(allottedClasses[0].assignment_id);
      }
    }
  }, [allottedClasses, selectedAllottedClassId]);

  // Synchronize duration count when selectedEvent changes
  React.useEffect(() => {
    if (selectedEvent) {
      const pCount = selectedEvent.periodCount || extractPeriodCount(selectedEvent.periodLabel) || 1;
      setCustomPeriodCount(pCount);
      setEditPeriodCount(pCount);
      setIsPeriodEditOpen(false);
    }
  }, [selectedEvent]);

  const isToday = selectedDate === todayIST;
  const isFuture = selectedDate > todayIST;
  const isFarFuture = (() => {
    try {
      const diffMs = new Date(selectedDate).getTime() - new Date(todayIST).getTime();
      return diffMs > 7 * 24 * 60 * 60 * 1000;
    } catch {
      return false;
    }
  })();

  const displayDate = formatISTDisplayDate(selectedDate);

  const formatPeriodLabel = (start: number, count: number): string => {
    if (count <= 1) return `Period ${start}`;
    return `Periods ${start}-${start + count - 1}`;
  };

  const handleApplyPeriodChange = async () => {
    if (!selectedEvent?.sessionId || !onUpdateSessionPeriod) return;
    setIsUpdatingPeriod(true);
    try {
      const newLabel = formatPeriodLabel(selectedEvent.periodNumber, editPeriodCount);
      await onUpdateSessionPeriod(selectedEvent.sessionId, editPeriodCount, newLabel);
      setIsPeriodEditOpen(false);
    } finally {
      setIsUpdatingPeriod(false);
    }
  };

  const handleStartAllottedAttendance = () => {
    const cls = allottedClasses?.find(c => c.assignment_id === selectedAllottedClassId) || allottedClasses?.[0];
    if (!cls) return;

    const pCount = Math.max(1, Math.min(8, customPeriodCount || 4));
    const startNum = selectedShift === 'AM'
      ? 1
      : Math.max(1, Math.min(5, 8 - pCount + 1));
    const endNum = Math.min(8, startNum + pCount - 1);
    const pLabel = pCount === 1
      ? `Period ${startNum}`
      : `Period ${startNum}-${endNum} (${pCount} Periods)`;

    const syntheticEvent: TeacherClassEvent = {
      id: `allotted-${cls.subject_id}-${cls.section_id}-${selectedDate}-${startNum}`,
      sessionId: null,
      sessionStatus: null,
      subjectId: cls.subject_id,
      subjectName: cls.subject_name,
      subjectCode: cls.subject_code,
      sectionId: cls.section_id,
      sectionName: cls.section_name,
      department: cls.department,
      academicYear: cls.year || '2025-26',
      assignmentId: cls.assignment_id,
      date: selectedDate,
      startTime: selectedShift === 'AM' ? '09:30' : '13:40',
      endTime: selectedShift === 'AM' ? '13:00' : '17:00',
      displayTime: selectedShift === 'AM' ? '09:30 AM - 01:00 PM' : '01:40 PM - 05:00 PM',
      periodNumber: startNum,
      periodLabel: pLabel,
      periodCount: pCount,
      totalStudents: 0,
      presentCount: 0,
      absentCount: 0,
      attendancePercentage: 0,
      attendanceState: selectedDate < todayIST ? 'NO_ATTENDANCE' : 'UPCOMING',
      isToday: selectedDate === todayIST,
      isCurrent: false,
      isPast: selectedDate < todayIST,
      isUpcoming: selectedDate > todayIST,
      hasSession: false,
      canStartAttendance: true,
      canViewAttendance: false,
      canEditAttendance: false,
      canLockAttendance: false,
      canUnlockAttendance: false
    };

    onStartAttendance(syntheticEvent);
  };

  const actualDurationCount = selectedEvent?.periodCount || extractPeriodCount(selectedEvent?.periodLabel) || 1;

  return (
    <div className="space-y-4">
      {/* Date Header & Jump Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex items-center justify-between">
        <div>
          <h3 className="text-sm font-black text-[#001e40] font-heading flex items-center gap-2">
            <span>{displayDate}</span>
            {isToday ? (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-extrabold uppercase bg-blue-100 text-[#2f53d7]">
                Today
              </span>
            ) : isFuture ? (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-extrabold uppercase bg-indigo-50 text-indigo-700 border border-indigo-200">
                Future Date
              </span>
            ) : (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-extrabold uppercase bg-slate-100 text-slate-600 border border-slate-200">
                Past Date
              </span>
            )}
          </h3>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[11px] font-semibold text-slate-500">
              Class Attendance Workspace
            </span>
            {!isToday && onGoToToday && (
              <button
                onClick={onGoToToday}
                className="text-[11px] font-bold text-[#2f53d7] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f53d7] rounded px-1 cursor-pointer"
                title="Return to Today's date"
              >
                Jump to Today
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center bg-slate-100 p-0.5 rounded-xl border border-slate-200" role="group" aria-label="Date navigation">
          <button
            onClick={onPrevDate}
            className="p-1.5 rounded-lg hover:bg-white text-slate-700 hover:text-[#001e40] transition active:scale-90 cursor-pointer"
            title="Previous Day"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={onNextDate}
            className="p-1.5 rounded-lg hover:bg-white text-slate-700 hover:text-[#001e40] transition active:scale-90 cursor-pointer"
            title="Next Day"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Primary Selected Class Card */}
      {selectedEvent ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
          <ClassSessionHeader
            selectedEvent={selectedEvent}
            isPeriodEditOpen={isPeriodEditOpen}
            setIsPeriodEditOpen={setIsPeriodEditOpen}
            editPeriodCount={editPeriodCount}
            setEditPeriodCount={setEditPeriodCount}
            isUpdatingPeriod={isUpdatingPeriod}
            onApplyPeriodChange={handleApplyPeriodChange}
            formatPeriodLabel={formatPeriodLabel}
            onUpdateSessionPeriod={onUpdateSessionPeriod}
          />

          <ClassAttendanceMetrics
            selectedEvent={selectedEvent}
            isFuture={isFuture}
            actualDurationCount={actualDurationCount}
          />

          <ClassActionToolbar
            selectedEvent={selectedEvent}
            selectedDate={selectedDate}
            todayIST={todayIST}
            isFarFuture={isFarFuture}
            isStartingSession={isStartingSession}
            selectedShift={selectedShift}
            setSelectedShift={setSelectedShift}
            customPeriodCount={customPeriodCount}
            setCustomPeriodCount={setCustomPeriodCount}
            formatPeriodLabel={formatPeriodLabel}
            onStartAttendance={onStartAttendance}
            onOpenRosterDetails={onOpenRosterDetails}
            onOpenProjector={onOpenProjector}
            onLockSession={onLockSession}
            onUnlockSession={onUnlockSession}
            onDeleteSession={onDeleteSession}
          />
        </div>
      ) : (
        <UnscheduledClassPicker
          displayDate={displayDate}
          selectedDate={selectedDate}
          todayIST={todayIST}
          allottedClasses={allottedClasses}
          selectedAllottedClassId={selectedAllottedClassId}
          setSelectedAllottedClassId={setSelectedAllottedClassId}
          selectedShift={selectedShift}
          setSelectedShift={setSelectedShift}
          customPeriodCount={customPeriodCount}
          setCustomPeriodCount={setCustomPeriodCount}
          isStartingSession={isStartingSession}
          onStartAllottedAttendance={handleStartAllottedAttendance}
        />
      )}

      {/* Expandable Student Roster */}
      {selectedEvent && selectedEvent.hasSession && selectedEvent.sessionId && (
        <ClassDetailRoster
          sessionId={selectedEvent.sessionId}
          sessionStatus={selectedEvent.sessionStatus}
          canEdit={selectedEvent.canEditAttendance}
          onToggleAttendance={(roll, currentStatus) => {
            if (onToggleStudentAttendance && selectedEvent.sessionId) {
              onToggleStudentAttendance(roll, currentStatus, selectedEvent.sessionId);
            }
          }}
        />
      )}

      {/* Quick Actions Card */}
      <ClassPanelQuickActions
        onOpenExcelRegister={onOpenExcelRegister}
        onOpenReports={onOpenReports}
      />
    </div>
  );
};
