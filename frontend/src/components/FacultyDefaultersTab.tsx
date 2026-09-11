import React, { useState, useEffect, useMemo } from 'react';
import { 
  AlertTriangle, CheckCircle, FileSpreadsheet, Send, Search, Filter, 
  RefreshCw, TrendingDown, AlertOctagon, ShieldAlert, X, Info, UserCheck, Calendar
} from 'lucide-react';
import { apiRequest } from '../services/api';
import { TeacherAssignment } from '../types';

interface DefaulterStudent {
  student_id: number;
  roll_number: string;
  name: string;
  course_id: number;
  course_code: string;
  course_name: string;
  current_percentage: number;
  current_band: 'ELIGIBLE' | 'CONDONABLE' | 'DETAINED';
  sessions_held: number;
  sessions_present: number;
  sessions_remaining: number;
  projected_percentage: number;
  max_possible_percentage: number;
  classes_needed: number;
  is_recoverable: boolean;
  recovery_status: 'RECOVERABLE' | 'NOT_RECOVERABLE';
  recovery_message: string;
  rapid_decline: boolean;
  fortnight_percentage?: number | null;
  active_warning_count: number;
  warnings?: Array<{
    id: number;
    warning_type: string;
    percentage_at_issue: number;
    band_at_issue: string;
    classes_needed_at_issue: number;
    issued_at: string;
    message?: string;
  }>;
}

interface FacultyDefaultersTabProps {
  assignments: TeacherAssignment[];
  onToast: (msg: string, type: 'success' | 'error' | 'warning') => void;
}

export const FacultyDefaultersTab: React.FC<FacultyDefaultersTabProps> = ({ assignments, onToast }) => {
  const [selectedCourseId, setSelectedCourseId] = useState<number | ''>(
    assignments.length > 0 ? assignments[0].subject_id : ''
  );
  const [bandFilter, setBandFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [students, setStudents] = useState<DefaulterStudent[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);

  // Warning Modal State
  const [selectedStudentForWarning, setSelectedStudentForWarning] = useState<DefaulterStudent | null>(null);
  const [warningType, setWarningType] = useState<'FIRST_WARNING' | 'FORMAL_WARNING' | 'FINAL_DETENTION_NOTICE'>('FIRST_WARNING');
  const [warningMessage, setWarningMessage] = useState<string>('');
  const [notifyParent, setNotifyParent] = useState<boolean>(false);
  const [isSubmittingWarning, setIsSubmittingWarning] = useState<boolean>(false);

  useEffect(() => {
    if (assignments.length > 0 && selectedCourseId === '') {
      setSelectedCourseId(assignments[0].subject_id);
    }
  }, [assignments]);

  useEffect(() => {
    fetchDefaulters();
  }, [selectedCourseId, bandFilter]);

  const fetchDefaulters = async () => {
    if (!selectedCourseId) return;
    setIsLoading(true);
    try {
      let url = `/faculty/defaulters?course_id=${selectedCourseId}`;
      if (bandFilter !== 'ALL') {
        url += `&band=${bandFilter}`;
      }
      const res = await apiRequest<{ status: string; students?: DefaulterStudent[]; defaulters?: DefaulterStudent[] }>(url);
      setStudents(res.students || res.defaulters || []);
    } catch (err: any) {
      console.error('Error fetching defaulters:', err);
      onToast(err.message || 'Failed to load defaulters roster.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const filteredStudents = useMemo(() => {
    if (!searchQuery.trim()) return students;
    const q = searchQuery.toLowerCase().trim();
    return students.filter(
      s => s.roll_number.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
    );
  }, [students, searchQuery]);

  const stats = useMemo(() => {
    const total = students.length;
    const below75 = students.filter(s => s.current_percentage < 75).length;
    const rapidDecline = students.filter(s => s.rapid_decline).length;
    const notRecoverable = students.filter(s => !s.is_recoverable).length;
    return { total, below75, rapidDecline, notRecoverable };
  }, [students]);

  const handleOpenWarningModal = (s: DefaulterStudent) => {
    setSelectedStudentForWarning(s);
    setWarningType(s.current_percentage < 65 ? 'FORMAL_WARNING' : 'FIRST_WARNING');
    setNotifyParent(false);
    
    // Recovery-framed empathetic prefill
    if (!s.is_recoverable) {
      setWarningMessage(
        `Your current attendance in ${s.course_code} is ${s.current_percentage}% (${s.sessions_present}/${s.sessions_held} classes attended). The remaining ${s.sessions_remaining} classes do not suffice to reach 75%. Please immediately contact your academic counselor/HOD to discuss condonation eligibility and makeup sessions.`
      );
    } else {
      setWarningMessage(
        `Your attendance in ${s.course_code} is currently ${s.current_percentage}%. You need to attend the next ${s.classes_needed} consecutive classes to recover to the compliant 75% JNTUH threshold.`
      );
    }
  };

  const handleIssueWarning = async () => {
    if (!selectedStudentForWarning) return;
    setIsSubmittingWarning(true);
    try {
      const res = await apiRequest<{ status: string; message: string; warning: any }>(
        `/faculty/students/${selectedStudentForWarning.roll_number}/warning`,
        {
          method: 'POST',
          body: JSON.stringify({
            course_id: selectedStudentForWarning.course_id,
            warning_type: warningType,
            custom_message: warningMessage.trim(),
            notify_parent: notifyParent
          })
        }
      );
      onToast(
        `Warning snapshot logged for ${selectedStudentForWarning.roll_number} at ${res.warning?.percentage_at_issue}% (${res.warning?.band_at_issue}).`,
        'success'
      );
      setSelectedStudentForWarning(null);
      fetchDefaulters();
    } catch (err: any) {
      console.error('Failed to issue warning:', err);
      onToast(err.message || 'Could not issue warning.', 'error');
    } finally {
      setIsSubmittingWarning(false);
    }
  };

  const handleExportExcel = async () => {
    if (!selectedCourseId) return;
    setIsExporting(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/v1/defaulters/export?course_id=${selectedCourseId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!response.ok) {
        throw new Error(`Export failed with HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `SNIST_Defaulters_Course_${selectedCourseId}_${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);
      onToast('SNIST Defaulter Register exported successfully.', 'success');
    } catch (err: any) {
      console.error('Export failed:', err);
      onToast(err.message || 'Failed to export defaulter register.', 'error');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Header & Controls Card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h3 className="text-xl font-black text-[#001e40] flex items-center gap-2">
              <ShieldAlert className="w-6 h-6 text-[#2f53d7]" />
              Defaulter Lists & Early-Warning Alerts
            </h3>
            <p className="text-xs text-slate-500 mt-1 font-medium">
              JNTUH R25 compliance engine: Track students below 75%, detect rapid decline trends, and issue immutable warnings.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleExportExcel}
              disabled={isExporting || !selectedCourseId}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-extrabold transition flex items-center gap-2 shadow-sm"
              title="Download official SNIST Defaulter Register in Excel format"
            >
              {isExporting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
              Export Register (Excel)
            </button>

            <button
              onClick={fetchDefaulters}
              disabled={isLoading}
              className="p-2 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 transition"
              title="Refresh roster"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Filters Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-slate-100">
          
          {/* Course Selector */}
          <div>
            <label className="block text-[11px] font-black uppercase tracking-wider text-slate-500 mb-1.5">
              Assigned Course
            </label>
            <select
              value={selectedCourseId}
              onChange={(e) => setSelectedCourseId(e.target.value ? Number(e.target.value) : '')}
              className="w-full text-xs font-bold bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2f53d7]"
            >
              {assignments.map(a => (
                <option key={a.assignment_id} value={a.subject_id}>
                  {a.subject_code} - {a.subject_name} ({a.section_name})
                </option>
              ))}
            </select>
          </div>

          {/* Compliance Band Filter */}
          <div>
            <label className="block text-[11px] font-black uppercase tracking-wider text-slate-500 mb-1.5">
              Filter by Status
            </label>
            <select
              value={bandFilter}
              onChange={(e) => setBandFilter(e.target.value)}
              className="w-full text-xs font-bold bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2f53d7]"
            >
              <option value="ALL">All Students ({stats.total})</option>
              <option value="BELOW_75">Below 75% Defaulters ({stats.below75})</option>
              <option value="CONDONABLE">Condonable (65%–74%)</option>
              <option value="DETAINED">Detained (&lt;65%)</option>
              <option value="RAPID_DECLINE">📉 Rapid Decline Watchlist ({stats.rapidDecline})</option>
              <option value="NOT_RECOVERABLE">⛔ Detention Trajectory ({stats.notRecoverable})</option>
            </select>
          </div>

          {/* Search Input */}
          <div>
            <label className="block text-[11px] font-black uppercase tracking-wider text-slate-500 mb-1.5">
              Search Student
            </label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Roll number or name..."
                className="w-full text-xs font-bold bg-slate-50 border border-slate-300 rounded-xl pl-9 pr-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2f53d7]"
              />
            </div>
          </div>

        </div>

        {/* KPI Summary Tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Enrolled In Course</span>
            <p className="text-xl font-black text-[#001e40] mt-0.5">{stats.total}</p>
          </div>

          <div className="bg-amber-50/60 border border-amber-200 rounded-xl p-3">
            <span className="text-[10px] font-black uppercase tracking-wider text-amber-800">Below 75% Defaulters</span>
            <p className="text-xl font-black text-amber-700 mt-0.5">{stats.below75}</p>
          </div>

          <div className="bg-rose-50/60 border border-rose-200 rounded-xl p-3">
            <span className="text-[10px] font-black uppercase tracking-wider text-rose-800">Rapid Decline Trends</span>
            <p className="text-xl font-black text-rose-700 mt-0.5 flex items-center gap-1.5">
              {stats.rapidDecline}
              {stats.rapidDecline > 0 && <span className="text-xs font-bold text-rose-600 animate-pulse">📉 Alert</span>}
            </p>
          </div>

          <div className="bg-purple-50/60 border border-purple-200 rounded-xl p-3">
            <span className="text-[10px] font-black uppercase tracking-wider text-purple-800">Detention Trajectory</span>
            <p className="text-xl font-black text-purple-700 mt-0.5">{stats.notRecoverable}</p>
          </div>
        </div>

      </div>

      {/* Defaulter Table Card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center flex flex-col items-center justify-center space-y-3">
            <RefreshCw className="w-8 h-8 text-[#2f53d7] animate-spin" />
            <p className="text-xs font-bold text-slate-600">Calculating honest trajectories and rapid decline signals...</p>
          </div>
        ) : filteredStudents.length === 0 ? (
          <div className="p-12 text-center text-slate-500 space-y-2">
            <CheckCircle className="w-8 h-8 text-emerald-500 mx-auto" />
            <p className="text-sm font-bold text-slate-700">No students found matching the selected filter.</p>
            <p className="text-xs text-slate-400">All students in this group are compliant or no records match your search.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-slate-100 text-slate-600 uppercase font-black tracking-wider border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3.5">Student</th>
                  <th className="px-4 py-3.5 text-center">Current %</th>
                  <th className="px-4 py-3.5 text-center">Attended / Held</th>
                  <th className="px-4 py-3.5 text-center">Projected End %</th>
                  <th className="px-4 py-3.5">Recovery Path</th>
                  <th className="px-4 py-3.5 text-center">Trend / Alerts</th>
                  <th className="px-4 py-3.5 text-center">Warnings</th>
                  <th className="px-4 py-3.5 text-center">Intervention</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {filteredStudents.map((s) => {
                  const isEligible = s.current_band === 'ELIGIBLE';
                  const isCondonable = s.current_band === 'CONDONABLE';
                  const isDetained = s.current_band === 'DETAINED';

                  return (
                    <tr key={s.student_id} className="hover:bg-slate-50 transition">
                      
                      {/* Student Info */}
                      <td className="px-4 py-3">
                        <div className="font-mono font-bold text-slate-900 text-xs">{s.roll_number}</div>
                        <div className="text-[11px] text-slate-500 font-semibold">{s.name}</div>
                      </td>

                      {/* Current % & Band */}
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-black border ${
                          isEligible 
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                            : isCondonable
                            ? 'bg-amber-50 text-amber-800 border-amber-300'
                            : 'bg-rose-50 text-rose-700 border-rose-300'
                        }`}>
                          {s.current_percentage.toFixed(1)}%
                        </span>
                      </td>

                      {/* Sessions count */}
                      <td className="px-4 py-3 text-center font-mono font-bold text-slate-700">
                        {s.sessions_present} / {s.sessions_held}
                        <span className="block text-[10px] text-slate-400 font-normal">
                          {s.sessions_remaining} remaining
                        </span>
                      </td>

                      {/* Honest Projected End % */}
                      <td className="px-4 py-3 text-center">
                        <div className="font-mono font-bold text-slate-800 text-xs">
                          {s.projected_percentage.toFixed(1)}%
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Max: {s.max_possible_percentage.toFixed(1)}%
                        </div>
                      </td>

                      {/* Recovery Path */}
                      <td className="px-4 py-3">
                        {!s.is_recoverable ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-black text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-md">
                            <AlertOctagon className="w-3 h-3 text-rose-600" />
                            NOT RECOVERABLE
                          </span>
                        ) : s.classes_needed > 0 ? (
                          <span className="text-[11px] font-bold text-amber-800">
                            Attend <b>{s.classes_needed}</b> more consecutive
                          </span>
                        ) : (
                          <span className="text-[11px] font-bold text-emerald-700">
                            Compliant (&ge;75%)
                          </span>
                        )}
                      </td>

                      {/* Trend Signals */}
                      <td className="px-4 py-3 text-center">
                        {s.rapid_decline ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-100 text-rose-800 border border-rose-300 animate-pulse">
                            <TrendingDown className="w-3 h-3" />
                            RAPID DECLINE
                          </span>
                        ) : (
                          <span className="text-slate-400 text-xs">—</span>
                        )}
                      </td>

                      {/* Warnings Count */}
                      <td className="px-4 py-3 text-center">
                        {s.active_warning_count > 0 ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-800 border border-amber-300">
                            ⚠️ {s.active_warning_count} issued
                          </span>
                        ) : (
                          <span className="text-slate-400 text-xs">None</span>
                        )}
                      </td>

                      {/* Action: Issue Warning */}
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => handleOpenWarningModal(s)}
                          className="px-3 py-1.5 bg-[#001e40] hover:bg-[#2f53d7] text-white rounded-lg font-bold text-xs transition flex items-center gap-1 mx-auto shadow-sm"
                        >
                          <Send className="w-3 h-3" /> Issue Warning
                        </button>
                      </td>

                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Confirmation Modal: Issue Warning */}
      {selectedStudentForWarning && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-5 animate-fadeIn">
            
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center font-bold">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-base font-black text-slate-900">Issue Attendance Warning</h4>
                  <p className="text-[11px] text-slate-500 font-semibold">
                    Sign and store an immutable snapshot for institutional compliance
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedStudentForWarning(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Snapshot Values Card (What the faculty is signing) */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
              <div className="flex justify-between items-center text-xs">
                <span className="font-bold text-slate-500">Student:</span>
                <span className="font-mono font-black text-slate-900">
                  {selectedStudentForWarning.roll_number} — {selectedStudentForWarning.name}
                </span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="font-bold text-slate-500">Course:</span>
                <span className="font-bold text-slate-900">
                  {selectedStudentForWarning.course_code} ({selectedStudentForWarning.course_name})
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-200 text-center">
                <div className="bg-white rounded-lg p-2 border border-slate-200">
                  <span className="text-[10px] text-slate-400 uppercase font-black block">Snapshot %</span>
                  <span className="font-black text-sm text-slate-800">
                    {selectedStudentForWarning.current_percentage.toFixed(1)}%
                  </span>
                </div>
                <div className="bg-white rounded-lg p-2 border border-slate-200">
                  <span className="text-[10px] text-slate-400 uppercase font-black block">Band</span>
                  <span className={`font-black text-xs block mt-0.5 ${
                    selectedStudentForWarning.current_band === 'DETAINED' ? 'text-rose-700' : 'text-amber-700'
                  }`}>
                    {selectedStudentForWarning.current_band}
                  </span>
                </div>
                <div className="bg-white rounded-lg p-2 border border-slate-200">
                  <span className="text-[10px] text-slate-400 uppercase font-black block">Classes Needed</span>
                  <span className="font-black text-sm text-[#2f53d7]">
                    {selectedStudentForWarning.is_recoverable ? selectedStudentForWarning.classes_needed : '⛔ NOT REC'}
                  </span>
                </div>
              </div>
            </div>

            {/* Warning Form */}
            <div className="space-y-4">
              
              {/* Warning Type */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Warning Severity Type
                </label>
                <select
                  value={warningType}
                  onChange={(e: any) => setWarningType(e.target.value)}
                  className="w-full text-xs font-bold bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2f53d7]"
                >
                  <option value="FIRST_WARNING">First Warning (Advisory & Guidance)</option>
                  <option value="FORMAL_WARNING">Formal Warning (Condonable / Serious Shortage)</option>
                  <option value="FINAL_DETENTION_NOTICE">Final Detention Notice (Critical Regulatory Warning)</option>
                </select>
              </div>

              {/* Recovery Guidance Message */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5 flex justify-between">
                  <span>Student Guidance Message (Empathetic & Recovery Framed)</span>
                  <span className="text-[10px] text-slate-400">Visible in Student PWA</span>
                </label>
                <textarea
                  rows={3}
                  value={warningMessage}
                  onChange={(e) => setWarningMessage(e.target.value)}
                  className="w-full text-xs bg-white border border-slate-300 rounded-xl p-3 text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2f53d7]"
                  placeholder="Explain attendance deficit and consecutive classes needed..."
                />
              </div>

              {/* Optional Parent Notice Toggle */}
              <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 flex items-start gap-3">
                <input
                  type="checkbox"
                  id="notifyParentCheck"
                  checked={notifyParent}
                  onChange={(e) => setNotifyParent(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-[#2f53d7] focus:ring-[#2f53d7]"
                />
                <label htmlFor="notifyParentCheck" className="text-xs text-slate-700">
                  <span className="font-bold block">Optional Parent Email Dispatch</span>
                  <span className="text-[11px] text-slate-500">
                    Sends automated notice to registered guardian email (subject to college 150/hr rate cap).
                  </span>
                </label>
              </div>

            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setSelectedStudentForWarning(null)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-800 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleIssueWarning}
                disabled={isSubmittingWarning}
                className="px-5 py-2.5 bg-[#001e40] hover:bg-[#2f53d7] disabled:opacity-50 text-white rounded-xl text-xs font-extrabold transition flex items-center gap-2 shadow-sm"
              >
                {isSubmittingWarning ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                Sign & Issue Warning Snapshot
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};
