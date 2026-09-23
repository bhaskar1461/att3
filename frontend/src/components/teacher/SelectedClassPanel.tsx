/**
 * SNIST ERP - Selected Class Side Panel
 * Phase 6: Class Details & Attendance Workspace
 *
 * Rich, professional class details workspace that answers all teacher questions at a glance:
 * - What class? Subject, section, period, time, room
 * - Attendance status? Counts, percentage, progress bar
 * - Actions? Start, continue, view, lock, unlock — all state-driven
 * - Students? Expandable roster with search, filter, inline toggle
 */

import React, { useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Users,
  CheckCircle2,
  UserX,
  AlertCircle,
  Play,
  FileText,
  Unlock,
  Lock,
  BarChart2,
  FileSpreadsheet,
  Calendar as CalendarIcon,
  Lightbulb,
  History,
  Tv,
  Radio,
  BookOpen,
  Hash,
  Building2,
  TrendingUp,
  RefreshCw,
  Edit3,
  Trash2,
  AlertTriangle,
  Sun,
  Moon,
  GraduationCap,
  Check
} from 'lucide-react';
import type { TeacherClassEvent } from '../../types/calendar.ts';
import type { TeacherAssignment } from '../../types/index.ts';
import { formatISTDisplayDate, extractPeriodCount } from '../../utils/dateUtils.ts';
import { ClassDetailRoster } from './ClassDetailRoster.tsx';

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
  onTakePreviousClass,
  onToggleStudentAttendance,
  onGoToToday,
  onUpdateSessionPeriod,
  onDeleteSession
}) => {
  const [confirmLockSession, setConfirmLockSession] = useState<TeacherClassEvent | null>(null);
  const [isLocking, setIsLocking] = useState(false);
  const [customPeriodCount, setCustomPeriodCount] = useState<number>(4);
  const [selectedShift, setSelectedShift] = useState<'AM' | 'PM'>('AM');
  const [selectedAllottedClassId, setSelectedAllottedClassId] = useState<number | null>(null);
  const [isPeriodEditOpen, setIsPeriodEditOpen] = useState(false);
  const [editPeriodCount, setEditPeriodCount] = useState<number>(1);
  const [isUpdatingPeriod, setIsUpdatingPeriod] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

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
      setConfirmDelete(false);
      if (selectedEvent.periodNumber && selectedEvent.periodNumber >= 5) {
        setSelectedShift('PM');
      } else {
        setSelectedShift('AM');
      }
    } else {
      setCustomPeriodCount(4);
    }
  }, [selectedEvent?.id, selectedEvent?.sessionId]);

  const formatPeriodLabel = (startNum: number, count: number) => {
    const s = Math.max(1, startNum || 1);
    if (count <= 1) return `Period ${s}`;
    return `Period ${s}-${Math.min(8, s + count - 1)} (${count} Periods)`;
  };

  const handleApplyPeriodChange = async () => {
    if (!selectedEvent?.sessionId || !onUpdateSessionPeriod || isUpdatingPeriod) return;
    setIsUpdatingPeriod(true);
    try {
      const startNum = selectedEvent.periodNumber || 1;
      const newLabel = formatPeriodLabel(startNum, editPeriodCount);
      await onUpdateSessionPeriod(selectedEvent.sessionId, editPeriodCount, newLabel);
      setIsPeriodEditOpen(false);
    } finally {
      setIsUpdatingPeriod(false);
    }
  };
  const displayDate = formatISTDisplayDate(selectedDate);
  const isToday = selectedDate === todayIST;
  const isFuture = selectedDate > todayIST;

  const isFarFuture = (() => {
    try {
      const s = new Date(selectedDate);
      const t = new Date(todayIST);
      const diff = Math.round((s.getTime() - t.getTime()) / (1000 * 60 * 60 * 24));
      return diff > 7;
    } catch {
      return false;
    }
  })();

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

  /**
   * Derive color-coded attendance progress bar percentage and color class.
   * Uses server-authoritative data from TeacherClassEvent — never fabricates values.
   */
  const getAttendanceBarConfig = (event: TeacherClassEvent) => {
    if (!event.hasSession || event.totalStudents === 0) {
      return { pct: 0, barColor: 'bg-slate-200', textColor: 'text-slate-500' };
    }
    const pct = Number.isFinite(event.attendancePercentage)
      ? Math.min(100, Math.max(0, Math.round(event.attendancePercentage)))
      : 0;
    if (pct >= 75) return { pct, barColor: 'bg-emerald-500', textColor: 'text-emerald-700' };
    if (pct >= 50) return { pct, barColor: 'bg-amber-500', textColor: 'text-amber-700' };
    return { pct, barColor: 'bg-rose-500', textColor: 'text-rose-700' };
  };

  const handleConfirmLock = async () => {
    if (!confirmLockSession?.sessionId || !onLockSession || isLocking) return;
    setIsLocking(true);
    try {
      await onLockSession(confirmLockSession.sessionId);
      setConfirmLockSession(null);
    } finally {
      setIsLocking(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Date Header Card with Navigation */}
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
                className="text-[11px] font-bold text-[#2f53d7] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f53d7] rounded px-1"
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
            className="p-1.5 rounded-lg hover:bg-white text-slate-700 hover:text-[#001e40] transition active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f53d7]"
            title="Previous Day"
            aria-label="Previous Day"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={onNextDate}
            className="p-1.5 rounded-lg hover:bg-white text-slate-700 hover:text-[#001e40] transition active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f53d7]"
            title="Next Day"
            aria-label="Next Day"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Primary Selected Class Card */}
      {selectedEvent ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
          {/* Section 5: Enhanced Class Header */}
          <div className="space-y-2">
            {/* Status Badge Row */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-extrabold text-slate-600">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span>{selectedEvent.displayTime}</span>
              </div>

              <span
                className={`text-[10px] px-2.5 py-0.5 rounded-full font-black uppercase tracking-wider flex items-center gap-1 ${
                  selectedEvent.attendanceState === 'CURRENT'
                    ? 'bg-rose-100 text-rose-700 border border-rose-200'
                    : selectedEvent.attendanceState === 'COMPLETED' || selectedEvent.attendanceState === 'ATTENDANCE_TAKEN'
                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                    : selectedEvent.attendanceState === 'LOCKED'
                    ? 'bg-slate-100 text-slate-700 border border-slate-200'
                    : selectedEvent.attendanceState === 'NO_ATTENDANCE'
                    ? 'bg-amber-100 text-amber-800 border border-amber-200'
                    : 'bg-blue-100 text-blue-800 border border-blue-200'
                }`}
              >
                {selectedEvent.attendanceState === 'CURRENT' ? (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-600 motion-safe:animate-pulse" />
                    Live Now
                  </>
                ) : selectedEvent.attendanceState === 'COMPLETED' || selectedEvent.attendanceState === 'ATTENDANCE_TAKEN' ? (
                  <>
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                    Attendance Recorded
                  </>
                ) : selectedEvent.attendanceState === 'LOCKED' ? (
                  <>
                    <Lock className="w-3 h-3 text-slate-500" />
                    Session Locked
                  </>
                ) : selectedEvent.attendanceState === 'NO_ATTENDANCE' ? (
                  <>
                    <AlertCircle className="w-3 h-3 text-amber-600" />
                    Not Taken
                  </>
                ) : (
                  'Upcoming'
                )}
              </span>
            </div>

            {/* Subject Title (prominent) */}
            <h4 className="text-lg font-black text-[#001e40] font-heading leading-snug">
              {selectedEvent.subjectName}
            </h4>

            {/* Meta Row: Section, Period, Room */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-bold text-slate-500">
              <span className="inline-flex items-center gap-1 text-[#2f53d7]">
                <Building2 className="w-3 h-3" />
                {selectedEvent.sectionName}
              </span>
              <span className="text-slate-300">•</span>
              <span className="inline-flex items-center gap-1">
                <Hash className="w-3 h-3 text-slate-400" />
                {selectedEvent.periodLabel}
              </span>
              {selectedEvent.hasSession && onUpdateSessionPeriod && selectedEvent.sessionId && (
                <button
                  type="button"
                  onClick={() => setIsPeriodEditOpen(!isPeriodEditOpen)}
                  className="px-2 py-0.5 rounded text-[11px] font-extrabold bg-blue-50 hover:bg-blue-100 text-[#2f53d7] transition border border-blue-200 flex items-center gap-1"
                  title="Change Period Count"
                >
                  <Edit3 className="w-3 h-3" />
                  <span>{isPeriodEditOpen ? 'Close' : 'Change Periods'}</span>
                </button>
              )}
              {selectedEvent.room && (
                <>
                  <span className="text-slate-300">•</span>
                  <span>{selectedEvent.room}</span>
                </>
              )}
            </div>

            {/* Inline Duration / Period Edit Drawer for Existing Session */}
            {isPeriodEditOpen && selectedEvent.hasSession && (
              <div className="bg-blue-50/70 rounded-xl p-3 border border-blue-200/80 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-extrabold text-[#15347e]">Update Session Duration:</span>
                  <span className="font-black text-[#2f53d7]">
                    {editPeriodCount} Period{editPeriodCount > 1 ? 's' : ''} ({formatPeriodLabel(selectedEvent.periodNumber, editPeriodCount)})
                  </span>
                </div>
                <div className="grid grid-cols-8 gap-1">
                  {[1, 2, 3, 4, 5, 6, 7, 8].map(cnt => (
                    <button
                      key={cnt}
                      type="button"
                      onClick={() => setEditPeriodCount(cnt)}
                      className={`py-1.5 rounded-lg text-xs font-black transition text-center ${
                        editPeriodCount === cnt
                          ? 'bg-[#2f53d7] text-white shadow-sm ring-1 ring-[#2f53d7]'
                          : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200'
                      }`}
                      title={`${cnt} ${cnt === 1 ? 'Period' : 'Periods'}`}
                    >
                      {cnt}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={handleApplyPeriodChange}
                  disabled={isUpdatingPeriod}
                  className="w-full py-2 bg-[#2f53d7] hover:bg-[#203db0] text-white text-xs font-black rounded-lg shadow-sm transition flex items-center justify-center gap-1.5 disabled:opacity-60"
                >
                  {isUpdatingPeriod ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  <span>Apply & Update All Student Records ({editPeriodCount} Periods)</span>
                </button>
              </div>
            )}

            {/* Subject Code & Department (secondary) */}
            {selectedEvent.subjectCode && (
              <div className="text-[11px] text-slate-400 font-semibold flex items-center gap-1.5">
                <BookOpen className="w-3 h-3" />
                <span>Code: {selectedEvent.subjectCode}</span>
                {selectedEvent.department && (
                  <>
                    <span className="text-slate-300">•</span>
                    <span>Dept: {selectedEvent.department}</span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Section 7/8: Attendance Summary Card with Progress Bar */}
          <div className="border-t border-slate-100 pt-3 space-y-3">
            {selectedEvent.hasSession && selectedEvent.totalStudents > 0 ? (
              <>
                {/* Large Fraction Display */}
                {(() => {
                  const safePct = Number.isFinite(selectedEvent.attendancePercentage)
                    ? Math.min(100, Math.max(0, Math.round(selectedEvent.attendancePercentage)))
                    : 0;
                  return (
                    <>
                      <div className="flex items-end justify-between gap-2">
                        <div className="flex items-baseline gap-1">
                          <span className={`text-3xl font-black ${getAttendanceBarConfig(selectedEvent).textColor}`}>
                            {selectedEvent.presentCount}
                          </span>
                          <span className="text-lg font-bold text-slate-400">/</span>
                          <span className="text-lg font-bold text-slate-500">
                            {selectedEvent.totalStudents}
                          </span>
                        </div>
                        <div className={`text-xl font-black ${getAttendanceBarConfig(selectedEvent).textColor}`}>
                          {safePct}%
                        </div>
                      </div>

                      {/* Progress Bar */}
                      <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden" role="progressbar" aria-valuenow={safePct} aria-valuemin={0} aria-valuemax={100}>
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${getAttendanceBarConfig(selectedEvent).barColor}`}
                          style={{ width: `${safePct}%` }}
                        />
                      </div>
                    </>
                  );
                })()}

                {/* Breakdown Tiles (compact) */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-slate-50 p-2 rounded-xl text-center border border-slate-100">
                    <div className="text-[10px] font-bold text-slate-500 flex items-center justify-center gap-1">
                      <Users className="w-3 h-3 text-slate-400" />
                      <span>Total</span>
                    </div>
                    <div className="text-sm font-black text-[#001e40] mt-0.5">
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
              /* No session created yet */
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

          {/* Section 14-18: State-Driven Action Buttons */}
          <div className="pt-1 space-y-2">
            {isFarFuture ? (
              <button
                disabled
                className="w-full py-3 bg-slate-100 text-slate-400 font-bold rounded-xl text-xs flex items-center justify-center gap-2 border border-slate-200 cursor-not-allowed"
                title="Attendance cannot be recorded more than 7 days in advance"
              >
                <Clock className="w-4 h-4 text-slate-400" /> Attendance Not Available (&gt;7 Days Ahead)
              </button>
            ) : selectedEvent.attendanceState === 'LOCKED' ? (
              <div className="space-y-2">
                <button
                  onClick={() => onOpenRosterDetails(selectedEvent)}
                  className="w-full py-3 bg-[#001e40] hover:bg-[#003366] text-white font-extrabold rounded-xl text-sm flex items-center justify-center gap-2 shadow-sm transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#001e40]"
                  aria-label="View attendance roster"
                >
                  <FileText className="w-4 h-4" /> View Attendance
                </button>

                {onUnlockSession && selectedEvent.sessionId && (
                  <button
                    onClick={() => onUnlockSession(selectedEvent.sessionId!)}
                    className="w-full py-2.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                  >
                    <Unlock className="w-3.5 h-3.5" /> Unlock Session for Historical Edit
                  </button>
                )}

                {onDeleteSession && selectedEvent.sessionId && (
                  <div className="pt-1">
                    {!confirmDelete ? (
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(true)}
                        className="w-full py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 hover:border-rose-300 font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition active:scale-95"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-rose-600" /> Delete Attendance Session
                      </button>
                    ) : (
                      <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 space-y-2 text-xs">
                        <div className="flex items-center gap-1.5 text-rose-800 font-bold">
                          <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                          <span>Permanently delete this session and its {selectedEvent.presentCount || 0} record(s)?</span>
                        </div>
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => setConfirmDelete(false)}
                            disabled={isDeleting}
                            className="flex-1 py-1.5 bg-white border border-slate-300 rounded-lg text-slate-700 font-bold hover:bg-slate-50 transition"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              if (!selectedEvent.sessionId || !onDeleteSession) return;
                              setIsDeleting(true);
                              try {
                                await onDeleteSession(selectedEvent.sessionId);
                                setConfirmDelete(false);
                              } catch {
                                // Error toast is shown by the parent handler
                              } finally {
                                setIsDeleting(false);
                              }
                            }}
                            disabled={isDeleting}
                            className="flex-1 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-lg shadow-sm transition disabled:opacity-60 flex items-center justify-center gap-1"
                          >
                            {isDeleting ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                            <span>Confirm Delete</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : selectedEvent.hasSession ? (
              <div className="space-y-2">
                <button
                  onClick={() => onStartAttendance(selectedEvent)}
                  disabled={isStartingSession}
                  className="w-full py-3 bg-gradient-to-r from-[#2f53d7] to-[#1e3bb3] hover:from-[#203db0] hover:to-[#172e8f] disabled:opacity-60 text-white font-black rounded-xl text-sm flex items-center justify-center gap-2 shadow-md shadow-[#2f53d7]/20 transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f53d7]"
                >
                  {isStartingSession ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Starting Attendance...</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 fill-current" /> {selectedDate < todayIST ? 'Continue Past Attendance' : 'Continue Live Attendance'}
                    </>
                  )}
                </button>

                {/* Live Classroom Controls for Open Today Session */}
                {selectedDate === todayIST && selectedEvent.sessionStatus === 'OPEN' && selectedEvent.sessionId && (
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    {onOpenProjector && (
                      <button
                        onClick={() => onOpenProjector(selectedEvent.sessionId!)}
                        className="py-2.5 px-3 bg-gradient-to-r from-[#001e40] to-[#15347e] hover:from-[#0b2853] hover:to-[#203db0] text-white font-extrabold rounded-xl text-xs flex items-center justify-center gap-1.5 shadow transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                        title="Launch Projector 10s Rotating QR"
                      >
                        <Tv className="w-3.5 h-3.5 text-amber-400" />
                        <span>Projector QR</span>
                      </button>
                    )}
                    {onLockSession && (
                      <button
                        onClick={() => setConfirmLockSession(selectedEvent)}
                        className="py-2.5 px-3 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-extrabold rounded-xl text-xs flex items-center justify-center gap-1.5 transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                        title="Lock session and commit attendance"
                      >
                        <Lock className="w-3.5 h-3.5" />
                        <span>Lock Attendance</span>
                      </button>
                    )}
                  </div>
                )}

                {onDeleteSession && selectedEvent.sessionId && (
                  <div className="pt-1">
                    {!confirmDelete ? (
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(true)}
                        className="w-full py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 hover:border-rose-300 font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition active:scale-95"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-rose-600" /> Delete Attendance Session
                      </button>
                    ) : (
                      <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 space-y-2 text-xs">
                        <div className="flex items-center gap-1.5 text-rose-800 font-bold">
                          <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                          <span>Permanently delete this session and its {selectedEvent.presentCount || 0} record(s)?</span>
                        </div>
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => setConfirmDelete(false)}
                            disabled={isDeleting}
                            className="flex-1 py-1.5 bg-white border border-slate-300 rounded-lg text-slate-700 font-bold hover:bg-slate-50 transition"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              if (!selectedEvent.sessionId || !onDeleteSession) return;
                              setIsDeleting(true);
                              try {
                                await onDeleteSession(selectedEvent.sessionId);
                                setConfirmDelete(false);
                              } catch {
                                // Error toast is shown by the parent handler
                              } finally {
                                setIsDeleting(false);
                              }
                            }}
                            disabled={isDeleting}
                            className="flex-1 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-lg shadow-sm transition disabled:opacity-60 flex items-center justify-center gap-1"
                          >
                            {isDeleting ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                            <span>Confirm Delete</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {/* Multi-Period Duration Picker for New Attendance Session */}
                <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-extrabold text-slate-700 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-[#2f53d7]" /> Duration & Shift:
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-blue-100 text-[#15347e] text-[11px] font-black">
                      {customPeriodCount} Period{customPeriodCount > 1 ? 's' : ''} ({formatPeriodLabel(selectedShift === 'AM' ? 1 : (selectedShift === 'PM' ? 5 : selectedEvent.periodNumber), customPeriodCount)})
                    </span>
                  </div>

                  {/* 1-Click AM / PM Presets */}
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedShift('AM');
                        setCustomPeriodCount(4);
                      }}
                      className={`py-2 px-2.5 rounded-xl text-xs font-black transition flex items-center justify-center gap-1.5 border ${
                        selectedShift === 'AM' && customPeriodCount === 4
                          ? 'bg-[#2f53d7] text-white border-[#2f53d7] shadow-sm ring-1 ring-[#2f53d7]'
                          : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
                      }`}
                    >
                      <Sun className={`w-3.5 h-3.5 ${selectedShift === 'AM' && customPeriodCount === 4 ? 'text-amber-300' : 'text-amber-500'}`} />
                      <span>AM (4 Periods • P1-4)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedShift('PM');
                        setCustomPeriodCount(4);
                      }}
                      className={`py-2 px-2.5 rounded-xl text-xs font-black transition flex items-center justify-center gap-1.5 border ${
                        selectedShift === 'PM' && customPeriodCount === 4
                          ? 'bg-[#2f53d7] text-white border-[#2f53d7] shadow-sm ring-1 ring-[#2f53d7]'
                          : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
                      }`}
                    >
                      <Moon className={`w-3.5 h-3.5 ${selectedShift === 'PM' && customPeriodCount === 4 ? 'text-indigo-200' : 'text-indigo-600'}`} />
                      <span>PM (4 Periods • P5-8)</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-8 gap-1">
                    {[1, 2, 3, 4, 5, 6, 7, 8].map(cnt => (
                      <button
                        key={cnt}
                        type="button"
                        onClick={() => setCustomPeriodCount(cnt)}
                        className={`py-1.5 rounded-lg text-xs font-black transition text-center ${
                          customPeriodCount === cnt
                            ? 'bg-[#001e40] text-white shadow-sm ring-1 ring-[#001e40]'
                            : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200'
                        }`}
                        title={`${cnt} ${cnt === 1 ? 'Period' : 'Periods'}`}
                      >
                        {cnt}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={() => {
                    const effStart = selectedShift === 'AM'
                      ? 1
                      : (selectedShift === 'PM'
                          ? Math.max(1, Math.min(5, 8 - customPeriodCount + 1))
                          : (selectedEvent.periodNumber || 1));
                    onStartAttendance({
                      ...selectedEvent,
                      periodNumber: effStart,
                      periodCount: customPeriodCount,
                      periodLabel: formatPeriodLabel(effStart, customPeriodCount)
                    });
                  }}
                  disabled={isStartingSession}
                  className="w-full py-3 bg-[#2f53d7] hover:bg-[#203db0] disabled:opacity-60 text-white font-black rounded-xl text-sm flex items-center justify-center gap-2 shadow-md shadow-[#2f53d7]/20 transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f53d7]"
                >
                  {isStartingSession ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Starting Attendance...</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 fill-current" /> {selectedDate < todayIST ? `Take Past Attendance (${customPeriodCount} Periods)` : `Start Attendance (${customPeriodCount} Periods)`}
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Secondary Action Buttons */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                onClick={() => onOpenRosterDetails(selectedEvent)}
                className="py-2 px-3 bg-slate-50 hover:bg-slate-100 text-[#001e40] font-bold rounded-xl text-xs border border-slate-200 flex items-center justify-center gap-1.5 transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f53d7]"
              >
                <FileText className="w-3.5 h-3.5 text-slate-500" />
                <span>Full Console</span>
              </button>

              <button
                onClick={() => onOpenRosterDetails(selectedEvent)}
                className="py-2 px-3 bg-slate-50 hover:bg-slate-100 text-[#001e40] font-bold rounded-xl text-xs border border-slate-200 flex items-center justify-center gap-1.5 transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f53d7]"
              >
                <TrendingUp className="w-3.5 h-3.5 text-slate-500" />
                <span>Session History</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
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

          {/* List of Allotted Classes */}
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
                    className={`py-2 px-2.5 rounded-xl text-left border transition-all ${
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
                    className={`py-2 px-2.5 rounded-xl text-left border transition-all ${
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
                        className={`py-1.5 rounded-lg text-xs font-black transition text-center ${
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
                onClick={handleStartAllottedAttendance}
                disabled={isStartingSession || !selectedAllottedClassId}
                className="w-full py-3 bg-gradient-to-r from-[#2f53d7] to-[#1e3bb3] hover:from-[#203db0] hover:to-[#172e8f] disabled:opacity-50 text-white font-black rounded-xl text-sm flex items-center justify-center gap-2 shadow-md shadow-[#2f53d7]/20 transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f53d7]"
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
      )}

      {/* Section 9-13: Expandable Student Roster (Phase 6) */}
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
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-3">
        <h4 className="text-xs font-black uppercase tracking-wider text-slate-400">
          Quick Actions
        </h4>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onTakePreviousClass}
            className="p-3 bg-purple-50 hover:bg-purple-100/80 rounded-xl text-left border border-purple-100 transition group active:scale-95 flex flex-col justify-between min-h-[75px]"
          >
            <History className="w-4 h-4 text-purple-600 mb-1" />
            <div>
              <div className="text-xs font-bold text-purple-900 leading-tight">
                Take Previous Class
              </div>
              <div className="text-[10px] text-purple-600 font-medium">
                Select past date
              </div>
            </div>
          </button>

          <button
            onClick={onOpenReports}
            className="p-3 bg-emerald-50 hover:bg-emerald-100/80 rounded-xl text-left border border-emerald-100 transition group active:scale-95 flex flex-col justify-between min-h-[75px]"
          >
            <BarChart2 className="w-4 h-4 text-emerald-600 mb-1" />
            <div>
              <div className="text-xs font-bold text-emerald-900 leading-tight">
                View Reports
              </div>
              <div className="text-[10px] text-emerald-600 font-medium">
                Attendance analytics
              </div>
            </div>
          </button>

          <button
            onClick={onOpenExcelRegister}
            className="p-3 bg-amber-50 hover:bg-amber-100/80 rounded-xl text-left border border-amber-100 transition group active:scale-95 flex flex-col justify-between min-h-[75px]"
          >
            <FileSpreadsheet className="w-4 h-4 text-amber-600 mb-1" />
            <div>
              <div className="text-xs font-bold text-amber-900 leading-tight">
                Class Register
              </div>
              <div className="text-[10px] text-amber-600 font-medium">
                Export to Excel
              </div>
            </div>
          </button>

          <button
            onClick={() => todayEvents.length > 0 && onSelectEvent(todayEvents[0])}
            disabled={todayEvents.length === 0}
            className="p-3 bg-blue-50 hover:bg-blue-100/80 disabled:opacity-50 rounded-xl text-left border border-blue-100 transition group active:scale-95 flex flex-col justify-between min-h-[75px]"
          >
            <CalendarIcon className="w-4 h-4 text-[#2f53d7] mb-1" />
            <div>
              <div className="text-xs font-bold text-blue-900 leading-tight">
                Today's Classes
              </div>
              <div className="text-[10px] text-blue-600 font-medium">
                {todayEvents.length} scheduled
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* Today's Schedule Mini-List (Section 20) */}
      {todayEvents.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-400">
              Today's Schedule
            </h4>
            <span className="text-[11px] font-bold text-[#2f53d7]">
              {todayEvents.length} Classes
            </span>
          </div>

          <div className="divide-y divide-slate-100">
            {todayEvents.map((e) => {
              const isCurrent = e.attendanceState === 'CURRENT';
              const isSelected = selectedEvent?.id === e.id;
              const hasAttendance = e.presentCount > 0 && e.totalStudents > 0;

              return (
                <div
                  key={e.id}
                  onClick={() => onSelectEvent(e)}
                  className={`py-2.5 px-2 flex items-center justify-between gap-2 cursor-pointer rounded-xl transition ${
                    isCurrent
                      ? 'bg-rose-50/60 border-l-4 border-l-rose-500 font-bold'
                      : isSelected
                      ? 'bg-blue-50/70 border-l-4 border-l-[#2f53d7] font-bold'
                      : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="text-[11px] font-mono font-extrabold text-slate-600 w-14 shrink-0">
                    {e.startTime}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-[#001e40] truncate">
                      {e.subjectName}
                    </div>
                    <div className="text-[10px] text-slate-500 font-medium">
                      {e.sectionName} • {e.periodLabel}
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-1.5">
                    {isCurrent ? (
                      <span className="text-[10px] font-black px-2 py-0.5 rounded-full uppercase bg-rose-100 text-rose-700 border border-rose-200 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-600 motion-safe:animate-pulse" />
                        Live
                      </span>
                    ) : hasAttendance ? (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                        ✓ {e.presentCount}/{e.totalStudents}
                      </span>
                    ) : e.attendanceState === 'LOCKED' ? (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200 flex items-center gap-1">
                        <Lock className="w-2.5 h-2.5" />
                        Locked
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
                        Upcoming
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Helpful Previous Class Banner */}
      <div className="bg-gradient-to-r from-blue-50/80 to-indigo-50/80 rounded-2xl p-4 border border-blue-100/80 flex items-start gap-3 text-xs text-[#001e40]">
        <div className="p-2 rounded-xl bg-blue-100/70 text-[#2f53d7] shrink-0">
          <Lightbulb className="w-4 h-4" />
        </div>
        <div className="space-y-1">
          <div className="font-extrabold text-blue-950">
            You can take attendance for previous classes
          </div>
          <p className="text-[11px] text-slate-600 leading-relaxed">
            Select any past date from the calendar to inspect attendance or record historical attendance according to institutional governance rules.
          </p>
        </div>
      </div>

      {/* Institutional Attendance Lock Confirmation Modal */}
      {confirmLockSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="p-2.5 rounded-xl bg-rose-100/80">
                <Lock className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#001e40]">
                  Lock Attendance Session?
                </h3>
                <p className="text-xs text-slate-500 font-semibold">
                  {confirmLockSession.subjectName} ({confirmLockSession.sectionName})
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-200">
              Students will no longer be able to submit attendance through the rotating projector QR or scanner. Attendance records will be permanently committed to the institutional database.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setConfirmLockSession(null)}
                disabled={isLocking}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-800 rounded-xl hover:bg-slate-100 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmLock}
                disabled={isLocking}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-black rounded-xl shadow transition active:scale-95 flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
              >
                <Lock className={`w-3.5 h-3.5 ${isLocking ? 'animate-spin' : ''}`} />
                <span>{isLocking ? 'Locking...' : 'Confirm & Lock'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
