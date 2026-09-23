/**
 * SNIST ERP - Current Class Live Attendance Hero Card
 * Phase 5: Live / Today's Attendance Workflow Integration
 * 
 * Provides an authoritative, high-visibility entry point for the teacher's active class.
 * Displays:
 * - ● LIVE NOW status when a period is active
 * - Real-time headcount (marked / enrolled)
 * - Start / Continue / View actions
 * - Direct Projector QR & Lock Attendance controls for OPEN sessions
 * - Server-authoritative break and outside-hours notifications
 */

import React, { useState } from 'react';
import { 
  Radio, 
  Play, 
  Tv, 
  Lock, 
  CheckCircle2, 
  Clock, 
  Users, 
  Coffee, 
  AlertCircle, 
  ChevronRight,
  Zap,
  FileText,
  RefreshCw
} from 'lucide-react';
import type { TeacherClassEvent } from '../../types/calendar.ts';

export interface CurrentClassInfo {
  current_time: string;
  current_date: string;
  detected_period: string | null;
  is_class_active: boolean;
  is_break: boolean;
  break_label: string | null;
  has_assignment: boolean;
  assignment?: {
    assignment_id: number;
    subject_id: number;
    subject_name: string;
    subject_code: string;
    section_id: number;
    section_name: string;
  } | null;
  existing_session_id?: number | null;
  session_status?: 'OPEN' | 'LOCKED' | null;
  total_enrolled: number;
  present_count: number;
}

interface CurrentClassHeroCardProps {
  currentClassInfo: CurrentClassInfo | null;
  matchedEvent?: TeacherClassEvent | null;
  isStarting?: boolean;
  onStartAttendance: () => void;
  onContinueAttendance?: () => void;
  onOpenProjector?: (sessionId: number) => void;
  onLockSession?: (sessionId: number) => void;
  onViewAttendance?: () => void;
  onSelectCurrentClass?: () => void;
}

export const CurrentClassHeroCard: React.FC<CurrentClassHeroCardProps> = ({
  currentClassInfo,
  matchedEvent,
  isStarting = false,
  onStartAttendance,
  onContinueAttendance,
  onOpenProjector,
  onLockSession,
  onViewAttendance,
  onSelectCurrentClass
}) => {
  const [confirmLock, setConfirmLock] = useState(false);
  const [isLocking, setIsLocking] = useState(false);

  // If no info loaded yet
  if (!currentClassInfo) {
    return null;
  }

  // 1. ACTIVE CLASS PERIOD
  if (currentClassInfo.is_class_active && currentClassInfo.has_assignment && currentClassInfo.assignment) {
    const asgn = currentClassInfo.assignment;
    const hasSession = Boolean(currentClassInfo.existing_session_id);
    const isOpen = currentClassInfo.session_status === 'OPEN';
    const isLocked = currentClassInfo.session_status === 'LOCKED';
    const sessionId = currentClassInfo.existing_session_id;

    const enrolled = currentClassInfo.total_enrolled || matchedEvent?.totalStudents || 0;
    const present = currentClassInfo.present_count || matchedEvent?.presentCount || 0;
    const attendancePct = enrolled > 0 && Number.isFinite(present)
      ? Math.min(100, Math.max(0, Math.round((present / enrolled) * 100))) 
      : 0;

    const handlePrimaryClick = () => {
      if (isLocked) {
        if (onViewAttendance) onViewAttendance();
      } else if (isOpen) {
        if (onContinueAttendance) {
          onContinueAttendance();
        } else {
          onStartAttendance();
        }
      } else {
        onStartAttendance();
      }
    };

    const handleConfirmLock = async () => {
      if (!sessionId || !onLockSession || isLocking) return;
      setIsLocking(true);
      try {
        await onLockSession(sessionId);
        setConfirmLock(false);
      } finally {
        setIsLocking(false);
      }
    };

    return (
      <div 
        onClick={onSelectCurrentClass}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelectCurrentClass?.();
          }
        }}
        role="region"
        aria-label="Active Class Live Attendance Hero"
        tabIndex={0}
        className="relative overflow-hidden bg-gradient-to-r from-[#001e40] via-[#0b2853] to-[#15347e] rounded-2xl p-5 sm:p-6 text-white shadow-lg border border-blue-900/60 transition-all hover:border-blue-700/80 cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
      >
        {/* Ambient background glow accent */}
        <div className="absolute -top-12 -right-12 w-48 h-48 bg-[#2f53d7]/20 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-5">
          {/* Left: Live Status & Class Info */}
          <div className="space-y-2 max-w-xl">
            {/* Top Badges */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-sm">
                <span className="w-2 h-2 rounded-full bg-rose-500 motion-safe:animate-ping motion-reduce:hidden" />
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                <span>LIVE NOW</span>
              </span>

              <span className="px-2.5 py-0.5 rounded-full bg-white/10 text-slate-200 text-xs font-mono font-bold">
                IST {currentClassInfo.current_time}
              </span>

              <span className="px-2.5 py-0.5 rounded-full bg-white/10 text-slate-200 text-xs font-semibold">
                {currentClassInfo.detected_period}
              </span>

              {isLocked ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-slate-500/30 text-slate-300 border border-slate-500/40">
                  <Lock className="w-3 h-3" />
                  <span>Locked</span>
                </span>
              ) : isOpen ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>Session Active</span>
                </span>
              ) : null}
            </div>

            {/* Subject and Section Title */}
            <div>
              <h3 className="font-heading text-lg sm:text-xl font-black text-white tracking-tight flex items-center gap-2">
                <span>{asgn.subject_name}</span>
                <span className="text-xs px-2.5 py-0.5 rounded-lg bg-[#2f53d7]/30 text-blue-200 border border-[#2f53d7]/40 font-bold">
                  {asgn.section_name}
                </span>
              </h3>
              <p className="text-xs text-slate-300 font-medium mt-0.5 flex items-center gap-2">
                <span>Subject Code: {asgn.subject_code || '—'}</span>
                <span>•</span>
                <span>{matchedEvent?.displayTime || 'Current Class Period'}</span>
              </p>
            </div>

            {/* Live Headcount Progress */}
            {hasSession && enrolled > 0 ? (
              <div className="flex items-center gap-3 pt-1">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xl font-black text-white">{present}</span>
                  <span className="text-xs font-bold text-slate-300">/ {enrolled} Present</span>
                  <span className="text-xs font-extrabold text-emerald-400 ml-1">({attendancePct}%)</span>
                </div>
                <div className="w-32 bg-white/10 h-2 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-emerald-400 to-[#2f53d7] transition-all duration-500"
                    style={{ width: `${Math.min(100, attendancePct)}%` }}
                  />
                </div>
              </div>
            ) : (
              <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5 pt-1">
                <Users className="w-3.5 h-3.5 text-slate-400" />
                <span>{enrolled > 0 ? `${enrolled} students enrolled` : 'Ready for attendance'}</span>
              </div>
            )}
          </div>

          {/* Right: Quick Action Controls */}
          <div 
            onClick={(e) => e.stopPropagation()} 
            className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 shrink-0"
          >
            {/* Primary Action Button */}
            <button
              onClick={handlePrimaryClick}
              disabled={isStarting}
              className={`px-5 py-3 rounded-xl font-black text-xs sm:text-sm uppercase tracking-wider transition-all shadow-md active:scale-95 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                isLocked
                  ? 'bg-white/15 hover:bg-white/25 text-white border border-white/20'
                  : isOpen
                  ? 'bg-gradient-to-r from-[#2f53d7] to-[#1e3bb3] hover:from-[#203db0] hover:to-[#172e8f] text-white shadow-[#2f53d7]/30'
                  : 'bg-[#FF9F0A] hover:bg-[#e08b05] text-[#001e40] shadow-amber-500/20'
              }`}
            >
              {isStarting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Starting...</span>
                </>
              ) : isLocked ? (
                <>
                  <FileText className="w-4 h-4" />
                  <span>View Attendance</span>
                </>
              ) : isOpen ? (
                <>
                  <Play className="w-4 h-4 fill-current" />
                  <span>Continue Attendance</span>
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4 fill-current" />
                  <span>Start Attendance</span>
                </>
              )}
            </button>

            {/* Secondary Projector & Lock buttons when session is OPEN */}
            {isOpen && sessionId && (
              <div className="flex items-center gap-2">
                {onOpenProjector && (
                  <button
                    onClick={() => onOpenProjector(sessionId)}
                    className="p-3 bg-white/10 hover:bg-white/20 text-amber-300 border border-white/15 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                    title="Launch Projector 10s Rotating QR"
                    aria-label="Launch Projector Rotating QR"
                  >
                    <Tv className="w-4 h-4" />
                    <span className="hidden sm:inline">Projector QR</span>
                  </button>
                )}

                {onLockSession && (
                  <button
                    onClick={() => setConfirmLock(true)}
                    className="p-3 bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/40 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                    title="Lock attendance session"
                    aria-label="Lock attendance session"
                  >
                    <Lock className="w-4 h-4" />
                    <span className="hidden sm:inline">Lock</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Lock Confirmation Dialog */}
        {confirmLock && sessionId && onLockSession && (
          <div 
            onClick={(e) => e.stopPropagation()}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fade-in text-slate-900"
          >
            <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
              <div className="flex items-center gap-3 text-rose-600">
                <div className="p-2.5 rounded-xl bg-rose-100">
                  <Lock className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#001e40]">
                    Lock Attendance for {asgn.subject_name}?
                  </h3>
                  <p className="text-xs text-slate-500 font-semibold">
                    Section {asgn.section_name} • {currentClassInfo.detected_period}
                  </p>
                </div>
              </div>

              <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-200">
                Students will no longer be able to submit attendance through this session. Attendance records will be permanently committed to the institutional database.
              </p>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  onClick={() => setConfirmLock(false)}
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
  }

  // 2. BREAK PERIOD (Section 23: Do NOT show LIVE during breaks)
  if (currentClassInfo.is_break) {
    return (
      <div className="bg-amber-50/90 border border-amber-200/90 rounded-2xl p-4 sm:p-5 text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
        <div className="flex items-center gap-3.5">
          <div className="p-3 rounded-xl bg-amber-100 text-amber-800 shrink-0">
            <Coffee className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="font-heading font-black text-sm sm:text-base text-amber-950">
                {currentClassInfo.break_label || 'Institutional Break Time'}
              </h4>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-200/80 text-amber-900">
                IST {currentClassInfo.current_time}
              </span>
            </div>
            <p className="text-xs text-amber-800 font-medium mt-0.5">
              No class currently in session. Attendance opens when the next scheduled period begins.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // 3. OUTSIDE SCHEDULED COLLEGE HOURS (Section 48: No class currently in session)
  if (!currentClassInfo.is_class_active) {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 sm:p-5 text-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
        <div className="flex items-center gap-3.5">
          <div className="p-3 rounded-xl bg-slate-200 text-slate-600 shrink-0">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="font-heading font-black text-sm sm:text-base text-[#001e40]">
                No Class Currently in Session
              </h4>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-slate-200 text-slate-700">
                IST {currentClassInfo.current_time}
              </span>
            </div>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Standard college hours are 09:30 AM to 05:00 PM (IST). You can view past sessions or schedule upcoming classes below.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return null;
};
