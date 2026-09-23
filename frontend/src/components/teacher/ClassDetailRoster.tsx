/**
 * SNIST ERP - Class Detail Roster
 * Phase 6: Expandable Student Attendance Roster within Selected Class Panel
 *
 * Fetches student roster on-demand from /teacher/sessions/{id}.
 * Provides client-side search, filter (All/Present/Absent), and inline status toggle.
 * Does NOT load roster until the teacher explicitly expands the accordion.
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Search,
  CheckCircle2,
  XCircle,
  Users,
  RefreshCw,
  AlertCircle,
  ToggleLeft,
  ToggleRight
} from 'lucide-react';
import { apiRequest } from '../../services/api';

interface StudentRow {
  student_id: number;
  roll_number: string;
  name: string;
  status: string;
  is_scanned: boolean;
  is_manual?: boolean;
  manual_reason?: string;
  binding_status?: string;
}

interface SessionDetailResponse {
  session_id: number;
  subject_name: string;
  section_name: string;
  period: string;
  period_count: number;
  session_date: string;
  status: string;
  total_students: number;
  present_count: number;
  absent_count: number;
  students: StudentRow[];
}

type RosterFilter = 'ALL' | 'PRESENT' | 'ABSENT';

interface ClassDetailRosterProps {
  sessionId: number;
  sessionStatus: string | null;
  canEdit: boolean;
  onToggleAttendance?: (rollNumber: string, currentStatus: string, sessionId?: number) => void;
  onRosterLoaded?: (data: { presentCount: number; absentCount: number; totalStudents: number }) => void;
}

export const ClassDetailRoster: React.FC<ClassDetailRosterProps> = ({
  sessionId,
  sessionStatus,
  canEdit,
  onToggleAttendance,
  onRosterLoaded
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [sessionData, setSessionData] = useState<SessionDetailResponse | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState<RosterFilter>('ALL');
  const [loadedSessionId, setLoadedSessionId] = useState<number | null>(null);

  // Fetch roster when expanded and session changes
  useEffect(() => {
    if (isExpanded && sessionId && sessionId !== loadedSessionId) {
      fetchRoster();
    }
  }, [isExpanded, sessionId]);

  const fetchRoster = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiRequest<SessionDetailResponse>(`/teacher/sessions/${sessionId}`);
      setSessionData(data);
      setStudents(data.students || []);
      setLoadedSessionId(sessionId);
      if (onRosterLoaded) {
        onRosterLoaded({
          presentCount: data.present_count,
          absentCount: data.absent_count,
          totalStudents: data.total_students
        });
      }
    } catch (err: any) {
      const cleanMsg = err?.message || '';
      if (/failed to fetch|network/i.test(cleanMsg)) {
        setError('Unable to reach institutional server. Please verify your connection.');
      } else if (/404|not found/i.test(cleanMsg)) {
        setError('Session record not found or has been archived.');
      } else {
        setError('Unable to load attendance roster at this moment. Please retry.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggle = () => {
    setIsExpanded(prev => !prev);
  };

  const handleRefresh = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setLoadedSessionId(null); // Force refetch
    await fetchRoster();
  };

  const isPresent = (status: string): boolean => {
    return ['PRESENT', '1', '2', '3', '4', '5', '6', '7', '8'].includes(status);
  };

  const presentCount = useMemo(() => students.filter(s => isPresent(s.status)).length, [students]);
  const absentCount = useMemo(() => students.filter(s => !isPresent(s.status)).length, [students]);

  const filteredStudents = useMemo(() => {
    return students.filter(s => {
      // Filter
      if (filter === 'PRESENT' && !isPresent(s.status)) return false;
      if (filter === 'ABSENT' && isPresent(s.status)) return false;

      // Search
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        const matchRoll = s.roll_number?.toLowerCase().includes(term);
        const matchName = s.name?.toLowerCase().includes(term);
        if (!matchRoll && !matchName) return false;
      }
      return true;
    });
  }, [students, filter, searchTerm]);

  const handleStatusToggle = (rollNumber: string, currentStatus: string) => {
    if (!canEdit || !onToggleAttendance) return;
    onToggleAttendance(rollNumber, currentStatus, sessionId);

    // Optimistic local update
    setStudents(prev =>
      prev.map(s => {
        if (s.roll_number === rollNumber) {
          const wasPresent = isPresent(currentStatus);
          return { ...s, status: wasPresent ? 'ABSENT' : 'PRESENT' };
        }
        return s;
      })
    );
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Accordion Header */}
      <button
        onClick={handleToggle}
        className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-slate-50 transition group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f53d7] focus-visible:ring-inset"
        aria-expanded={isExpanded}
        aria-label="Toggle student attendance roster"
      >
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-[#2f53d7]" />
          <span className="text-xs font-black text-[#001e40] uppercase tracking-wider">
            Student Attendance
          </span>
          {students.length > 0 && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
              {students.length} students
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isExpanded && !isLoading && (
            <button
              onClick={handleRefresh}
              className="p-1 rounded-lg hover:bg-slate-200 text-slate-500 transition"
              title="Refresh roster"
              aria-label="Refresh student roster"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          )}
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-slate-400 group-hover:text-slate-600 transition" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-400 group-hover:text-slate-600 transition" />
          )}
        </div>
      </button>

      {/* Expanded Roster Content */}
      {isExpanded && (
        <div className="border-t border-slate-100">
          {isLoading ? (
            /* Loading Skeleton */
            <div className="p-4 space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center gap-3 animate-pulse">
                  <div className="w-8 h-8 rounded-full bg-slate-200" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 bg-slate-200 rounded w-3/4" />
                    <div className="h-2.5 bg-slate-100 rounded w-1/2" />
                  </div>
                  <div className="w-16 h-6 bg-slate-200 rounded-full" />
                </div>
              ))}
            </div>
          ) : error ? (
            /* Error State */
            <div className="p-6 text-center space-y-3">
              <AlertCircle className="w-8 h-8 text-rose-400 mx-auto" />
              <p className="text-xs font-bold text-slate-700">Unable to load attendance</p>
              <p className="text-[11px] text-slate-500">{error}</p>
              <button
                onClick={handleRefresh}
                className="px-4 py-2 bg-[#2f53d7] hover:bg-[#203db0] text-white text-xs font-bold rounded-xl transition"
              >
                Retry
              </button>
            </div>
          ) : students.length === 0 ? (
            /* Empty State */
            <div className="p-6 text-center space-y-2">
              <Users className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="text-xs font-bold text-slate-700">No students found for this class.</p>
              <p className="text-[11px] text-slate-400">
                The section may have no enrolled students, or the session data is unavailable.
              </p>
            </div>
          ) : (
            <>
              {/* Search & Filter Bar */}
              <div className="px-4 pt-3 pb-2 space-y-2">
                {/* Search Input */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    placeholder="Search by name or roll number..."
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2f53d7]/30 focus:border-[#2f53d7]"
                    aria-label="Search students"
                  />
                </div>

                {/* Filter Chips */}
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setFilter('ALL')}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f53d7] ${
                      filter === 'ALL'
                        ? 'bg-[#001e40] text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                    aria-pressed={filter === 'ALL'}
                  >
                    All {students.length}
                  </button>
                  <button
                    onClick={() => setFilter('PRESENT')}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                      filter === 'PRESENT'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                    }`}
                    aria-pressed={filter === 'PRESENT'}
                  >
                    Present {presentCount}
                  </button>
                  <button
                    onClick={() => setFilter('ABSENT')}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 ${
                      filter === 'ABSENT'
                        ? 'bg-rose-600 text-white'
                        : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
                    }`}
                    aria-pressed={filter === 'ABSENT'}
                  >
                    Absent {absentCount}
                  </button>
                </div>
              </div>

              {/* Student List */}
              <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-100">
                {filteredStudents.length === 0 ? (
                  <div className="p-4 text-center">
                    <p className="text-xs text-slate-400 font-semibold">
                      No students match your search or filter.
                    </p>
                  </div>
                ) : (
                  filteredStudents.map(student => {
                    const studentPresent = isPresent(student.status);
                    const canToggle = canEdit && sessionStatus === 'OPEN' && onToggleAttendance;

                    return (
                      <div
                        key={student.student_id}
                        className={`flex items-center justify-between gap-3 px-4 py-2.5 transition ${
                          canToggle ? 'hover:bg-slate-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2f53d7]' : ''
                        }`}
                        onClick={() => canToggle && handleStatusToggle(student.roll_number, student.status)}
                        role={canToggle ? 'button' : undefined}
                        tabIndex={canToggle ? 0 : undefined}
                        onKeyDown={e => {
                          if (canToggle && (e.key === 'Enter' || e.key === ' ')) {
                            e.preventDefault();
                            handleStatusToggle(student.roll_number, student.status);
                          }
                        }}
                        aria-label={canToggle
                          ? `Toggle ${student.name} (${student.roll_number}) attendance. Currently ${studentPresent ? 'present' : 'absent'}`
                          : `${student.name} (${student.roll_number}) — ${studentPresent ? 'Present' : 'Absent'}`
                        }
                      >
                        {/* Student Info */}
                        <div className="flex items-center gap-2.5 flex-1 min-w-0">
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 ${
                            studentPresent
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-rose-100 text-rose-700'
                          }`}>
                            {student.name?.charAt(0)?.toUpperCase() || '?'}
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-[#001e40] truncate">
                              {student.name}
                            </div>
                            <div className="text-[10px] text-slate-400 font-semibold font-mono flex items-center gap-1">
                              {student.roll_number}
                              {student.is_manual && (
                                <span className="text-amber-500" title={`Manual: ${student.manual_reason || 'N/A'}`}>
                                  ⚡
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Status Badge or Toggle */}
                        {canToggle ? (
                          <div className="shrink-0 flex items-center gap-1.5">
                            {studentPresent ? (
                              <ToggleRight className="w-5 h-5 text-emerald-600" />
                            ) : (
                              <ToggleLeft className="w-5 h-5 text-slate-400" />
                            )}
                            <span className={`text-[10px] font-bold ${
                              studentPresent ? 'text-emerald-700' : 'text-slate-500'
                            }`}>
                              {studentPresent ? 'P' : 'A'}
                            </span>
                          </div>
                        ) : (
                          <span className={`shrink-0 text-[10px] font-bold px-2 py-1 rounded-full flex items-center gap-1 ${
                            studentPresent
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                              : 'bg-rose-100 text-rose-800 border border-rose-200'
                          }`}>
                            {studentPresent ? (
                              <><CheckCircle2 className="w-3 h-3" /> Present</>
                            ) : (
                              <><XCircle className="w-3 h-3" /> Absent</>
                            )}
                          </span>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Footer summary */}
              {filteredStudents.length > 0 && (
                <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-slate-400">
                    Showing {filteredStudents.length} of {students.length} students
                  </span>
                  {canEdit && sessionStatus === 'OPEN' && (
                    <span className="text-[10px] font-semibold text-[#2f53d7]">
                      Tap a student to toggle attendance
                    </span>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
