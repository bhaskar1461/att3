import React, { useState } from 'react';
import {
  Clock,
  FileText,
  Unlock,
  Trash2,
  AlertTriangle,
  RefreshCw,
  Play,
  Tv,
  Lock,
  Sun,
  Moon,
  TrendingUp,
  AlertCircle
} from 'lucide-react';
import type { TeacherClassEvent } from '../../types/calendar.ts';

interface ClassActionToolbarProps {
  selectedEvent: TeacherClassEvent;
  selectedDate: string;
  todayIST: string;
  isFarFuture: boolean;
  isStartingSession: boolean;
  selectedShift: 'AM' | 'PM';
  setSelectedShift: (shift: 'AM' | 'PM') => void;
  customPeriodCount: number;
  setCustomPeriodCount: (cnt: number) => void;
  formatPeriodLabel: (start: number, count: number) => string;
  onStartAttendance: (event: TeacherClassEvent) => void;
  onOpenRosterDetails: (event: TeacherClassEvent) => void;
  onOpenProjector?: (sessionId: number) => void;
  onLockSession?: (sessionId: number) => void;
  onUnlockSession?: (sessionId: number) => void;
  onDeleteSession?: (sessionId: number) => Promise<void>;
}

export const ClassActionToolbar: React.FC<ClassActionToolbarProps> = ({
  selectedEvent,
  selectedDate,
  todayIST,
  isFarFuture,
  isStartingSession,
  selectedShift,
  setSelectedShift,
  customPeriodCount,
  setCustomPeriodCount,
  formatPeriodLabel,
  onStartAttendance,
  onOpenRosterDetails,
  onOpenProjector,
  onLockSession,
  onUnlockSession,
  onDeleteSession
}) => {
  const [confirmLockSession, setConfirmLockSession] = useState<TeacherClassEvent | null>(null);
  const [isLocking, setIsLocking] = useState<boolean>(false);
  const [confirmDelete, setConfirmDelete] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  return (
    <>
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
              className="w-full py-3 bg-[#001e40] hover:bg-[#003366] text-white font-extrabold rounded-xl text-sm flex items-center justify-center gap-2 shadow-sm transition active:scale-95 cursor-pointer"
              aria-label="View attendance roster"
            >
              <FileText className="w-4 h-4" /> View Attendance
            </button>

            {onUnlockSession && selectedEvent.sessionId && (
              <button
                onClick={() => onUnlockSession(selectedEvent.sessionId!)}
                className="w-full py-2.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition active:scale-95 cursor-pointer"
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
                    className="w-full py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 hover:border-rose-300 font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition active:scale-95 cursor-pointer"
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
                        className="flex-1 py-1.5 bg-white border border-slate-300 rounded-lg text-slate-700 font-bold hover:bg-slate-50 transition cursor-pointer"
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
                          } finally {
                            setIsDeleting(false);
                          }
                        }}
                        disabled={isDeleting}
                        className="flex-1 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-lg shadow-sm transition disabled:opacity-60 flex items-center justify-center gap-1 cursor-pointer"
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
              className="w-full py-3 bg-gradient-to-r from-[#2f53d7] to-[#1e3bb3] hover:from-[#203db0] hover:to-[#172e8f] disabled:opacity-60 text-white font-black rounded-xl text-sm flex items-center justify-center gap-2 shadow-md shadow-[#2f53d7]/20 transition active:scale-95 cursor-pointer"
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
                    className="py-2.5 px-3 bg-gradient-to-r from-[#001e40] to-[#15347e] hover:from-[#0b2853] hover:to-[#203db0] text-white font-extrabold rounded-xl text-xs flex items-center justify-center gap-1.5 shadow transition active:scale-95 cursor-pointer"
                    title="Launch Projector 10s Rotating QR"
                  >
                    <Tv className="w-3.5 h-3.5 text-amber-400" />
                    <span>Projector QR</span>
                  </button>
                )}
                {onLockSession && (
                  <button
                    onClick={() => setConfirmLockSession(selectedEvent)}
                    className="py-2.5 px-3 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-extrabold rounded-xl text-xs flex items-center justify-center gap-1.5 transition active:scale-95 cursor-pointer"
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
                    className="w-full py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 hover:border-rose-300 font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition active:scale-95 cursor-pointer"
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
                        className="flex-1 py-1.5 bg-white border border-slate-300 rounded-lg text-slate-700 font-bold hover:bg-slate-50 transition cursor-pointer"
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
                          } finally {
                            setIsDeleting(false);
                          }
                        }}
                        disabled={isDeleting}
                        className="flex-1 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-lg shadow-sm transition disabled:opacity-60 flex items-center justify-center gap-1 cursor-pointer"
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

              {/* AM / PM Presets */}
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedShift('AM');
                    setCustomPeriodCount(4);
                  }}
                  className={`py-2 px-2.5 rounded-xl text-xs font-black transition flex items-center justify-center gap-1.5 border cursor-pointer ${
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
                  className={`py-2 px-2.5 rounded-xl text-xs font-black transition flex items-center justify-center gap-1.5 border cursor-pointer ${
                    selectedShift === 'PM' && customPeriodCount === 4
                      ? 'bg-[#2f53d7] text-white border-[#2f53d7] shadow-sm ring-1 ring-[#2f53d7]'
                      : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
                  }`}
                >
                  <Moon className={`w-3.5 h-3.5 ${selectedShift === 'PM' && customPeriodCount === 4 ? 'text-indigo-200' : 'text-indigo-600'}`} />
                  <span>PM (4 Periods • P5-8)</span>
                </button>
              </div>

              {/* Period Number Buttons 1..8 */}
              <div className="grid grid-cols-8 gap-1 pt-1">
                {[1, 2, 3, 4, 5, 6, 7, 8].map(cnt => (
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

            <button
              onClick={() => onStartAttendance(selectedEvent)}
              disabled={isStartingSession}
              className="w-full py-3.5 bg-gradient-to-r from-[#2f53d7] to-[#1e3bb3] hover:from-[#203db0] hover:to-[#172e8f] disabled:opacity-60 text-white font-black rounded-xl text-sm flex items-center justify-center gap-2 shadow-lg shadow-[#2f53d7]/20 transition active:scale-95 cursor-pointer"
            >
              {isStartingSession ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Starting Attendance...</span>
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
        )}

        {/* Secondary Action Buttons */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            onClick={() => onOpenRosterDetails(selectedEvent)}
            className="py-2 px-3 bg-slate-50 hover:bg-slate-100 text-[#001e40] font-bold rounded-xl text-xs border border-slate-200 flex items-center justify-center gap-1.5 transition active:scale-95 cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5 text-slate-500" />
            <span>Full Console</span>
          </button>

          <button
            onClick={() => onOpenRosterDetails(selectedEvent)}
            className="py-2 px-3 bg-slate-50 hover:bg-slate-100 text-[#001e40] font-bold rounded-xl text-xs border border-slate-200 flex items-center justify-center gap-1.5 transition active:scale-95 cursor-pointer"
          >
            <TrendingUp className="w-3.5 h-3.5 text-slate-500" />
            <span>Session History</span>
          </button>
        </div>
      </div>

      {/* Lock Confirmation Modal */}
      {confirmLockSession && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in"
        >
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl space-y-4 border border-slate-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-extrabold text-sm text-[#001e40]">Lock Attendance Session?</h4>
                <p className="text-xs text-slate-500">Commits attendance and closes QR scanning</p>
              </div>
            </div>

            <div className="bg-slate-50 rounded-xl p-3 text-xs space-y-1.5 border border-slate-200">
              <div className="flex justify-between">
                <span className="text-slate-500">Subject:</span>
                <span className="font-bold text-slate-700">{confirmLockSession.subjectName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Section:</span>
                <span className="font-bold text-slate-700">{confirmLockSession.sectionName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Present Count:</span>
                <span className="font-bold text-emerald-600">
                  {confirmLockSession.presentCount}/{confirmLockSession.totalStudents} ({confirmLockSession.attendancePercentage}%)
                </span>
              </div>
            </div>

            <p className="text-xs text-slate-500 leading-relaxed">
              Once locked, students cannot scan to mark attendance. You can unlock later from the dashboard if needed.
            </p>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmLockSession(null)}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isLocking}
                onClick={async () => {
                  if (confirmLockSession.sessionId && onLockSession) {
                    setIsLocking(true);
                    try {
                      await onLockSession(confirmLockSession.sessionId);
                      setConfirmLockSession(null);
                    } finally {
                      setIsLocking(false);
                    }
                  }
                }}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-xs transition shadow-sm disabled:opacity-60 flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {isLocking ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
                <span>{isLocking ? 'Locking...' : 'Lock Session'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
