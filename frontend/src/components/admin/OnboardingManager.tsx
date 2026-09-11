import React, { useState, useEffect, useRef } from 'react';
import { apiRequest } from '../../services/api';
import { 
  Upload, Send, RefreshCw, Search, ChevronDown, AlertCircle, CheckCircle2, Clock, 
  Loader2, Eye, RotateCcw, Shield, Mail, KeyRound, Copy, Calendar, Check, X, 
  Users, UserCheck, UserX, Sparkles 
} from 'lucide-react';
import { WeeklyCalendarBar, WeekDayInfo } from './WeeklyCalendarBar';

interface OnboardingStudent {
  id: number;
  roll_number: string;
  name: string;
  email: string;
  department: string;
  section: string;
  state: string;
  link_sent_at: string | null;
  activated_at: string | null;
  otp_verified: boolean;
  pin_set: boolean;
  device_uuid: string | null;
  rebind_count: number;
  batch_ref: string;
}

interface ImportResult {
  status: string;
  batch_ref: string;
  created?: number;
  skipped?: number;
  teacher_notified?: string | null;
  total_parsed?: number;
  errors?: any[];
  preview?: any[];
}

interface DailyStudent {
  student_id: number;
  roll_number: string;
  name: string;
  email: string;
  status: 'PRESENT' | 'ABSENT' | 'UNMARKED';
  period_count: number;
  scan_mode: string | null;
  scanned_at: string | null;
}

const STATE_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  PENDING_ONBOARDING: { bg: 'bg-slate-100', text: 'text-slate-600', label: 'Pending' },
  LINK_SENT: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Link Sent' },
  LINK_OPENED: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'In Progress' },
  ACTIVATED: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Activated' },
  EXPIRED: { bg: 'bg-red-100', text: 'text-red-600', label: 'Expired' },
  SUSPENDED: { bg: 'bg-red-200', text: 'text-red-800', label: 'Suspended' },
};

export const OnboardingManager: React.FC = () => {
  // Top-level Mode Switch: Weekly Attendance Register vs Onboarding & Credentials
  const [viewMode, setViewMode] = useState<'attendance' | 'onboarding'>('attendance');

  // ==========================================
  // WEEKLY CALENDAR & ATTENDANCE REGISTER STATE
  // ==========================================
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    return new Date().toISOString().split('T')[0];
  });
  const [selectedSectionId, setSelectedSectionId] = useState<number>(1);
  const [sections, setSections] = useState<Array<{ id: number; name: string }>>([]);
  const [weekDays, setWeekDays] = useState<WeekDayInfo[]>([]);
  const [dailyStudents, setDailyStudents] = useState<DailyStudent[]>([]);
  const [dailySummary, setDailySummary] = useState({ total: 0, present: 0, absent: 0, unmarked: 0 });
  const [selectedPeriods, setSelectedPeriods] = useState<number>(4);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [batchLoading, setBatchLoading] = useState(false);
  const [markingRoll, setMarkingRoll] = useState<string | null>(null);
  const [attendanceSearch, setAttendanceSearch] = useState('');

  // ==========================================
  // ONBOARDING & CREDENTIALS STATE
  // ==========================================
  const [students, setStudents] = useState<OnboardingStudent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [stateFilter, setStateFilter] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [searchRoll, setSearchRoll] = useState('');

  // Import modal state
  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importDeptCode, setImportDeptCode] = useState('CSE-CS');
  const [importDeptId, setImportDeptId] = useState('1');
  const [importYearId, setImportYearId] = useState('3');
  const [importYearName, setImportYearName] = useState('III - I');
  const [importSectionId, setImportSectionId] = useState('1');
  const [importEmailPattern, setImportEmailPattern] = useState('{roll}@cs.sreenidhi.edu.in');
  const [importInchargeEmail, setImportInchargeEmail] = useState('sowjanya.n@sreenidhi.edu.in');
  const [importDryRun, setImportDryRun] = useState(true);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importLoading, setImportLoading] = useState(false);

  // Dispatch state
  const [dispatchLoading, setDispatchLoading] = useState(false);
  const [dispatchResult, setDispatchResult] = useState<any>(null);

  // Per-student action states
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionToast, setActionToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  // Auto-dismiss feedback toast
  useEffect(() => {
    if (actionToast) {
      const timer = setTimeout(() => setActionToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [actionToast]);

  // Load available sections for dropdown
  useEffect(() => {
    apiRequest<any[]>('/admin/sections')
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setSections(data);
          if (!selectedSectionId) setSelectedSectionId(data[0].id);
        }
      })
      .catch((err) => console.error('Failed to load sections:', err));
  }, []);

  // Fetch Daily Sheet whenever date or section changes (when in attendance view)
  useEffect(() => {
    if (viewMode === 'attendance') {
      fetchDailySheet();
    }
  }, [selectedDate, selectedSectionId, viewMode]);

  // Fetch Onboarding records when page or filter changes
  useEffect(() => {
    if (viewMode === 'onboarding') {
      fetchOnboarding();
    }
  }, [page, stateFilter, viewMode]);

  // ----------------------------------------------------
  // ATTENDANCE METHODS
  // ----------------------------------------------------
  const fetchDailySheet = async () => {
    setDailyLoading(true);
    try {
      const params = new URLSearchParams({
        date: selectedDate,
        section_id: String(selectedSectionId)
      });
      const data: any = await apiRequest(`/attendance/admin/daily-sheet?${params}`);
      if (data) {
        setDailyStudents(data.students || []);
        setDailySummary({
          total: data.total_students || 0,
          present: data.present_count || 0,
          absent: data.absent_count || 0,
          unmarked: data.unmarked_count || 0
        });
        setWeekDays(data.week_days || []);
      }
    } catch (err: any) {
      console.error('Failed to fetch daily attendance sheet:', err);
    } finally {
      setDailyLoading(false);
    }
  };

  const changeWeek = (offsetDays: number) => {
    try {
      const [y, m, d] = selectedDate.split('-').map(Number);
      const curr = new Date(y, m - 1, d);
      curr.setDate(curr.getDate() + offsetDays);
      const newY = curr.getFullYear();
      const newM = String(curr.getMonth() + 1).padStart(2, '0');
      const newD = String(curr.getDate()).padStart(2, '0');
      setSelectedDate(`${newY}-${newM}-${newD}`);
    } catch (e) {
      console.error(e);
    }
  };

  const jumpToToday = () => {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    setSelectedDate(`${y}-${m}-${d}`);
  };

  const handleMarkStudent = async (roll: string, newStatus: 'PRESENT' | 'ABSENT' | 'UNMARKED', periodCount?: number) => {
    const effPeriods = periodCount !== undefined ? periodCount : selectedPeriods;
    setMarkingRoll(roll);

    // Optimistic UI update
    setDailyStudents((prev) =>
      prev.map((s) => {
        if (s.roll_number.toUpperCase() === roll.toUpperCase()) {
          return {
            ...s,
            status: newStatus,
            period_count: newStatus === 'PRESENT' ? effPeriods : 0,
            scan_mode: 'ADMIN_CALENDAR'
          };
        }
        return s;
      })
    );

    try {
      const res: any = await apiRequest('/attendance/admin/mark-daily', {
        method: 'POST',
        body: JSON.stringify({
          date: selectedDate,
          section_id: selectedSectionId,
          roll_number: roll,
          status: newStatus,
          period_count: effPeriods
        })
      });
      setActionToast({
        message: `${roll}: Marked ${newStatus === 'PRESENT' ? `PRESENT (${effPeriods} Periods)` : newStatus}`,
        type: 'success'
      });
      fetchDailySheet();
    } catch (err: any) {
      setActionToast({ message: `Mark failed: ${err.message}`, type: 'error' });
      fetchDailySheet();
    } finally {
      setMarkingRoll(null);
    }
  };

  const handleBatchMark = async (status: 'PRESENT' | 'ABSENT') => {
    setBatchLoading(true);
    try {
      const res: any = await apiRequest('/attendance/admin/batch-mark-daily', {
        method: 'POST',
        body: JSON.stringify({
          date: selectedDate,
          section_id: selectedSectionId,
          status,
          period_count: selectedPeriods
        })
      });
      setActionToast({
        message: `All students marked as ${status} (${status === 'PRESENT' ? `${selectedPeriods} Periods` : '0'})`,
        type: 'success'
      });
      fetchDailySheet();
    } catch (err: any) {
      setActionToast({ message: `Batch mark failed: ${err.message}`, type: 'error' });
    } finally {
      setBatchLoading(false);
    }
  };

  // ----------------------------------------------------
  // ONBOARDING METHODS
  // ----------------------------------------------------
  const fetchOnboarding = async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: '25' });
      if (stateFilter) params.set('state', stateFilter);
      const res: any = await apiRequest(`/admin/onboard/status?${params}`);
      setStudents(res.students || []);
      setTotal(res.total || 0);
    } catch (err: any) {
      console.error('Fetch onboarding error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleImport = async () => {
    if (!importFile) return;
    setImportLoading(true);
    setImportResult(null);
    try {
      const form = new FormData();
      form.append('file', importFile);
      form.append('department_code', importDeptCode);
      form.append('department_id', importDeptId);
      form.append('academic_year_id', importYearId);
      form.append('academic_year_name', importYearName);
      form.append('section_id', importSectionId);
      form.append('email_pattern', importEmailPattern);
      form.append('class_incharge_email', importInchargeEmail);
      form.append('dry_run', String(importDryRun));

      const token = localStorage.getItem('token');
      const res = await fetch('/api/v1/admin/onboard/import-excel', {
        method: 'POST',
        headers: { ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        let errorMsg = 'Import failed';
        if (Array.isArray(data.detail)) {
          errorMsg = data.detail.map((d: any) => {
            const field = d.loc ? d.loc.filter((x: any) => x !== 'body').join('.') : '';
            return field ? `${field}: ${d.msg || d.error || JSON.stringify(d)}` : (d.msg || d.error || JSON.stringify(d));
          }).join(', ');
        } else if (typeof data.detail === 'string') {
          errorMsg = data.detail;
        } else if (data.detail && typeof data.detail === 'object') {
          errorMsg = JSON.stringify(data.detail);
        } else if (data.message) {
          errorMsg = typeof data.message === 'string' ? data.message : JSON.stringify(data.message);
        }
        throw new Error(errorMsg);
      }
      setImportResult(data);
      if (data.status === 'success') {
        fetchOnboarding();
      }
    } catch (err: any) {
      setImportResult({ status: 'error', batch_ref: '', errors: [{ error: err.message || 'Unknown import error' }] });
    } finally {
      setImportLoading(false);
    }
  };

  const dispatchLinks = async () => {
    setDispatchLoading(true);
    try {
      const res: any = await apiRequest('/admin/onboard/dispatch-links', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setDispatchResult(res);
      fetchOnboarding();
    } catch (err: any) {
      setDispatchResult({ status: 'error', error: err.message });
    } finally {
      setDispatchLoading(false);
    }
  };

  const handleResend = async (roll: string) => {
    setActionLoading(`resend-${roll}`);
    try {
      await apiRequest(`/admin/onboard/resend/${roll}`, { method: 'POST', body: JSON.stringify({}) });
      setActionToast({ message: `Welcome email resent successfully to ${roll}`, type: 'success' });
      fetchOnboarding();
    } catch (err: any) {
      setActionToast({ message: `Resend failed: ${err.message}`, type: 'error' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleResetPin = async (roll: string) => {
    if (!window.confirm(`Reset PIN for student ${roll}?\n\nA new 6-digit PIN will be generated, emailed to the student, and any device lockout will be cleared immediately.`)) {
      return;
    }
    setActionLoading(`reset-${roll}`);
    try {
      const res: any = await apiRequest(`/admin/onboard/reset-pin/${roll}`, { method: 'POST', body: JSON.stringify({}) });
      setActionToast({ message: `PIN reset for ${roll}! New PIN: ${res.pin} (also emailed to student)`, type: 'success' });
      fetchOnboarding();
    } catch (err: any) {
      setActionToast({ message: `PIN reset failed: ${err.message}`, type: 'error' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleCopyLink = async (roll: string) => {
    setActionLoading(`copy-${roll}`);
    try {
      const res: any = await apiRequest(`/admin/onboard/login-link/${roll}`, { method: 'GET' });
      const link = res.login_url || `${window.location.origin}/login?roll=${encodeURIComponent(roll)}`;
      await navigator.clipboard.writeText(link);
      setActionToast({ message: `Permanent login link for ${roll} copied to clipboard!`, type: 'success' });
    } catch (err: any) {
      const fallbackLink = `${window.location.origin}/login?roll=${encodeURIComponent(roll)}`;
      try {
        await navigator.clipboard.writeText(fallbackLink);
        setActionToast({ message: `Permanent login link for ${roll} copied to clipboard!`, type: 'success' });
      } catch (clipErr) {
        setActionToast({ message: `Failed to copy: ${err.message}`, type: 'error' });
      }
    } finally {
      setActionLoading(null);
    }
  };

  // Filtered lists
  const filteredDailyStudents = dailyStudents.filter(
    (s) =>
      s.roll_number.toLowerCase().includes(attendanceSearch.toLowerCase()) ||
      s.name.toLowerCase().includes(attendanceSearch.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* View Mode Switcher Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-2.5 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setViewMode('attendance')}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all ${
              viewMode === 'attendance'
                ? 'bg-[#2f53d7] text-white shadow-md shadow-[#2f53d7]/20'
                : 'text-slate-600 hover:text-[#15347e] hover:bg-slate-100'
            }`}
          >
            <Calendar className="w-4 h-4" /> Weekly Attendance Register
          </button>
          <button
            onClick={() => setViewMode('onboarding')}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all ${
              viewMode === 'onboarding'
                ? 'bg-[#2f53d7] text-white shadow-md shadow-[#2f53d7]/20'
                : 'text-slate-600 hover:text-[#15347e] hover:bg-slate-100'
            }`}
          >
            <Users className="w-4 h-4" /> Onboarding &amp; Credentials
          </button>
        </div>

        <div className="text-xs text-slate-500 font-medium px-2">
          {viewMode === 'attendance' ? (
            <span>Selected Date: <strong className="text-[#15347e]">{selectedDate}</strong></span>
          ) : (
            <span>Total Enrolled: <strong className="text-[#15347e]">{total}</strong></span>
          )}
        </div>
      </div>

      {/* Global Action Toast */}
      {actionToast && (
        <div
          className={`p-3 rounded-xl text-xs font-semibold flex items-center justify-between shadow-sm transition-all ${
            actionToast.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          <span>{actionToast.type === 'success' ? '✓ ' : '✗ '}{actionToast.message}</span>
          <button onClick={() => setActionToast(null)} className="text-slate-400 hover:text-slate-600 font-bold ml-2">
            ✕
          </button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW MODE 1: WEEKLY ATTENDANCE REGISTER */}
      {/* ========================================================================= */}
      {viewMode === 'attendance' && (
        <div className="space-y-6">
          {/* Weekly Calendar Bar (Monday through Saturday) */}
          <WeeklyCalendarBar
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            weekDays={weekDays}
            onPrevWeek={() => changeWeek(-7)}
            onNextWeek={() => changeWeek(7)}
            onToday={jumpToToday}
            sections={sections}
            selectedSectionId={selectedSectionId}
            onSelectSection={setSelectedSectionId}
            isLoading={dailyLoading}
          />

          {/* Daily Action Toolbar */}
          <div className="snist-card p-4 sm:p-5 space-y-4 border-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-4">
              {/* Summary KPIs */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-[#15347e] uppercase tracking-wide">
                  Attendance Summary:
                </span>
                <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">
                  Total: {dailySummary.total}
                </span>
                <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  ✓ Present: {dailySummary.present}
                </span>
                <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-red-50 text-red-700 border border-red-200">
                  ✗ Absent: {dailySummary.absent}
                </span>
                <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
                  — Unmarked: {dailySummary.unmarked}
                </span>
              </div>

              {/* Period Count Selector */}
              <div className="flex items-center gap-1.5 bg-slate-50 p-1.5 rounded-xl border border-slate-200">
                <span className="text-[11px] font-bold text-slate-500 uppercase px-1">Periods:</span>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((num) => (
                  <button
                    key={num}
                    onClick={() => setSelectedPeriods(num)}
                    className={`w-7 h-7 rounded-lg text-xs font-extrabold transition-all ${
                      selectedPeriods === num
                        ? 'bg-[#2f53d7] text-white shadow-sm'
                        : 'text-slate-600 hover:bg-slate-200'
                    }`}
                    title={`Mark with ${num} Periods`}
                  >
                    {num}
                  </button>
                ))}
              </div>
            </div>

            {/* Batch Actions & Search Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  onClick={() => handleBatchMark('PRESENT')}
                  disabled={batchLoading || dailyLoading}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs flex items-center gap-2 shadow-sm transition active:scale-95 disabled:opacity-50"
                  title={`Mark all students present with ${selectedPeriods} periods for ${selectedDate}`}
                >
                  {batchLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  Mark All Present ({selectedPeriods} Periods)
                </button>

                <button
                  onClick={() => handleBatchMark('ABSENT')}
                  disabled={batchLoading || dailyLoading}
                  className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl text-xs flex items-center gap-2 shadow-sm transition active:scale-95 disabled:opacity-50"
                  title={`Mark all students absent for ${selectedDate}`}
                >
                  {batchLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                  Mark All Absent
                </button>

                <button
                  onClick={fetchDailySheet}
                  disabled={dailyLoading}
                  className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-300 transition text-slate-600"
                  title="Refresh attendance sheet"
                >
                  <RefreshCw className={`w-4 h-4 ${dailyLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>

              {/* Student Search */}
              <div className="relative min-w-[240px]">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={attendanceSearch}
                  onChange={(e) => setAttendanceSearch(e.target.value)}
                  placeholder="Filter student or roll no..."
                  className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#2f53d7]"
                />
              </div>
            </div>
          </div>

          {/* Daily Attendance Student Table */}
          <div className="overflow-x-auto bg-white rounded-2xl border border-slate-200 shadow-sm">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 text-[#17233c] font-bold uppercase border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Roll Number</th>
                  <th className="py-3 px-4">Name</th>
                  <th className="py-3 px-4">Email / Section</th>
                  <th className="py-3 px-4">Daily Status</th>
                  <th className="py-3 px-4">Periods</th>
                  <th className="py-3 px-4">Log Details</th>
                  <th className="py-3 px-4 text-right">Quick Mark</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {dailyLoading ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center">
                      <Loader2 className="w-6 h-6 animate-spin mx-auto text-[#2f53d7]" />
                      <p className="text-xs text-slate-500 mt-2">Loading attendance sheet for {selectedDate}...</p>
                    </td>
                  </tr>
                ) : filteredDailyStudents.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500">
                      No students found matching your search.
                    </td>
                  </tr>
                ) : (
                  filteredDailyStudents.map((s) => {
                    const isPresent = s.status === 'PRESENT';
                    const isAbsent = s.status === 'ABSENT';
                    const isUnmarked = s.status === 'UNMARKED';
                    const isMarking = markingRoll === s.roll_number;

                    return (
                      <tr key={s.student_id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-3 px-4 font-mono font-bold text-[#15347e]">
                          {s.roll_number}
                        </td>
                        <td className="py-3 px-4 font-medium text-slate-800">
                          {s.name}
                        </td>
                        <td className="py-3 px-4 text-slate-500 font-mono text-[11px]">
                          {s.email}
                        </td>
                        <td className="py-3 px-4">
                          {isPresent && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Present
                            </span>
                          )}
                          {isAbsent && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-red-100 text-red-700">
                              <X className="w-3.5 h-3.5" /> Absent
                            </span>
                          )}
                          {isUnmarked && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-500">
                              — Not Marked
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          {isPresent ? (
                            <span className="px-2 py-0.5 rounded-lg bg-blue-50 text-[#2f53d7] font-bold font-mono text-[11px] border border-blue-200">
                              {s.period_count} Periods
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-[11px] font-mono text-slate-500">
                          {s.scan_mode ? (
                            <span>
                              {s.scan_mode} {s.scanned_at ? `(${s.scanned_at})` : ''}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                            <button
                              onClick={() => handleMarkStudent(s.roll_number, 'PRESENT', selectedPeriods)}
                              disabled={isMarking}
                              className={`px-3 py-1 rounded-xl text-xs font-bold transition-all flex items-center gap-1 active:scale-95 ${
                                isPresent
                                  ? 'bg-emerald-600 text-white shadow-sm'
                                  : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
                              }`}
                              title={`Mark ${s.roll_number} Present (${selectedPeriods} periods)`}
                            >
                              {isMarking ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                              Present
                            </button>

                            <button
                              onClick={() => handleMarkStudent(s.roll_number, 'ABSENT', 0)}
                              disabled={isMarking}
                              className={`px-3 py-1 rounded-xl text-xs font-bold transition-all flex items-center gap-1 active:scale-95 ${
                                isAbsent
                                  ? 'bg-red-600 text-white shadow-sm'
                                  : 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200'
                              }`}
                              title={`Mark ${s.roll_number} Absent`}
                            >
                              {isMarking ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                              Absent
                            </button>

                            {!isUnmarked && (
                              <button
                                onClick={() => handleMarkStudent(s.roll_number, 'UNMARKED', 0)}
                                disabled={isMarking}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
                                title="Clear status"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW MODE 2: ONBOARDING & CREDENTIALS MANAGEMENT */}
      {/* ========================================================================= */}
      {viewMode === 'onboarding' && (
        <div className="space-y-6">
          {/* Controls */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => setShowImport(!showImport)}
              className="px-4 py-2.5 bg-[#2f53d7] text-white font-bold rounded-xl text-xs flex items-center gap-2 shadow-md transition active:scale-95"
            >
              <Upload className="w-4 h-4" /> Import Excel
            </button>
            <button
              onClick={dispatchLinks}
              disabled={dispatchLoading}
              className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs flex items-center gap-2 shadow-md transition active:scale-95 disabled:opacity-50"
            >
              {dispatchLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Dispatch Login Links
            </button>
            <select
              value={stateFilter}
              onChange={(e) => {
                setStateFilter(e.target.value);
                setPage(1);
              }}
              className="px-3 py-2 border border-slate-300 rounded-xl text-xs font-medium bg-white"
            >
              <option value="">All States</option>
              <option value="PENDING_ONBOARDING">Pending</option>
              <option value="LINK_SENT">Link Sent</option>
              <option value="LINK_OPENED">In Progress</option>
              <option value="ACTIVATED">Activated</option>
              <option value="EXPIRED">Expired</option>
            </select>
            <button
              onClick={fetchOnboarding}
              className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-300 transition"
            >
              <RefreshCw className="w-4 h-4 text-slate-600" />
            </button>
            <span className="text-xs text-slate-500 ml-auto">{total} students</span>
          </div>

          {/* Dispatch Result */}
          {dispatchResult && (
            <div
              className={`p-4 rounded-xl text-xs font-medium space-y-1 ${
                dispatchResult.status === 'success'
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'bg-red-50 text-red-700 border border-red-200'
              }`}
            >
              <div className="font-bold flex items-center gap-1.5">
                {dispatchResult.status === 'success' ? (
                  <span>
                    ✓ Dispatched {dispatchResult.dispatched} student login links ({dispatchResult.failed} failed)
                  </span>
                ) : (
                  <span>✗ Error: {dispatchResult.error}</span>
                )}
              </div>
              {dispatchResult.status === 'success' &&
                dispatchResult.teacher_notified &&
                dispatchResult.teacher_notified.length > 0 && (
                  <div className="text-emerald-800 flex items-center gap-1 text-[11px] font-semibold">
                    <span>
                      📬 Class In-Charge Timetable &amp; Schedule Notification sent to:{' '}
                      <strong>{dispatchResult.teacher_notified.join(', ')}</strong> (Students dispatched without CC)
                    </span>
                  </div>
                )}
            </div>
          )}

          {/* Import Modal */}
          {showImport && (
            <div className="snist-card p-5 space-y-4 border-[#2f53d7]/20">
              <h3 className="font-heading text-sm font-bold text-[#15347e] flex items-center gap-2">
                <Upload className="w-4 h-4 text-[#2f53d7]" /> Excel Import — Student Onboarding
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-[#6a7894] uppercase">
                    Excel File (CSE-CS Format)
                  </label>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                    className="w-full text-xs mt-1 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-[#2f53d7]/10 file:text-[#2f53d7]"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-[#6a7894] uppercase">Department Code</label>
                  <input
                    value={importDeptCode}
                    onChange={(e) => setImportDeptCode(e.target.value)}
                    placeholder="CSE-CS"
                    className="w-full px-3 py-2 border rounded-xl text-xs mt-1"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-[#6a7894] uppercase">Email Pattern</label>
                  <input
                    value={importEmailPattern}
                    onChange={(e) => setImportEmailPattern(e.target.value)}
                    placeholder="{roll}@cs.sreenidhi.edu.in"
                    className="w-full px-3 py-2 border rounded-xl text-xs mt-1 font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-[#6a7894] uppercase">Class In-charge Email</label>
                  <input
                    value={importInchargeEmail}
                    onChange={(e) => setImportInchargeEmail(e.target.value)}
                    placeholder="incharge@sreenidhi.edu.in"
                    className="w-full px-3 py-2 border rounded-xl text-xs mt-1"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-[#6a7894] uppercase">Year/Semester</label>
                  <input
                    value={importYearName}
                    onChange={(e) => setImportYearName(e.target.value)}
                    className="w-full px-3 py-2 border rounded-xl text-xs mt-1"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-[#6a7894] uppercase">Dry Run (Preview Only)</label>
                  <div className="flex items-center gap-2 mt-2">
                    <input
                      type="checkbox"
                      id="dryRun"
                      checked={importDryRun}
                      onChange={(e) => setImportDryRun(e.target.checked)}
                      className="rounded"
                    />
                    <label htmlFor="dryRun" className="text-xs text-slate-600">
                      Dry run (don't save to database)
                    </label>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={handleImport}
                  disabled={importLoading || !importFile}
                  className="px-5 py-2 bg-[#2f53d7] text-white font-bold rounded-xl text-xs flex items-center gap-2 disabled:opacity-50 transition active:scale-95"
                >
                  {importLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  {importDryRun ? 'Preview Import' : 'Import Students'}
                </button>
                <button
                  onClick={() => setShowImport(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-600 font-bold rounded-xl text-xs hover:bg-slate-200"
                >
                  Cancel
                </button>
              </div>

              {/* Import Results */}
              {importResult && (
                <div
                  className={`p-4 rounded-xl text-xs space-y-2 mt-3 ${
                    importResult.status === 'success' ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'
                  }`}
                >
                  <div className="font-bold flex items-center gap-2">
                    {importResult.status === 'success' ? (
                      <span className="text-emerald-700">
                        ✓ Parsed {importResult.total_parsed} students. Created: {importResult.created}, Skipped:{' '}
                        {importResult.skipped}
                      </span>
                    ) : (
                      <span className="text-red-700">✗ Import Error</span>
                    )}
                  </div>
                  {importResult.errors && importResult.errors.length > 0 && (
                    <div className="text-red-600 max-h-32 overflow-y-auto space-y-1">
                      {importResult.errors.map((e, i) => (
                        <div key={i} className="text-[11px] font-mono">
                          Row {e.row || '?'}: {e.error}
                        </div>
                      ))}
                    </div>
                  )}
                  {importResult.preview && importResult.preview.length > 0 && (
                    <div className="max-h-40 overflow-y-auto border rounded-lg bg-white p-2 space-y-1">
                      <div className="font-bold text-[10px] text-slate-500 uppercase">
                        Preview First {importResult.preview.length} Students:
                      </div>
                      {importResult.preview.map((p, i) => {
                        const rowNum = p.row || i + 1;
                        const name = p.name || 'Unknown Name';
                        const roll = p.roll_number || 'No Roll';
                        const email = p.email || 'No Email';
                        return (
                          <div key={i} className="text-[11px] text-slate-600 flex justify-between">
                            <span>
                              {rowNum}. {name} ({roll})
                            </span>
                            <span className="font-mono text-slate-400">{email}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Onboarding Status Table */}
          <div className="overflow-x-auto bg-white rounded-2xl border border-slate-200 shadow-sm">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 text-[#17233c] font-bold uppercase border-b border-slate-200">
                <tr>
                  <th className="py-3 px-3">Roll Number</th>
                  <th className="py-3 px-3">Name</th>
                  <th className="py-3 px-3">Email</th>
                  <th className="py-3 px-3">State</th>
                  <th className="py-3 px-3">OTP</th>
                  <th className="py-3 px-3">PIN</th>
                  <th className="py-3 px-3">Device</th>
                  <th className="py-3 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {isLoading ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center">
                      <Loader2 className="w-5 h-5 animate-spin mx-auto text-[#2f53d7]" />
                    </td>
                  </tr>
                ) : students.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-500">
                      No onboarding records. Import students to get started.
                    </td>
                  </tr>
                ) : (
                  students.map((s) => {
                    const stateInfo = STATE_COLORS[s.state] || {
                      bg: 'bg-slate-100',
                      text: 'text-slate-600',
                      label: s.state,
                    };
                    return (
                      <tr key={s.id} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3 font-mono font-bold text-[#15347e]">{s.roll_number}</td>
                        <td className="py-2.5 px-3 font-medium">{s.name}</td>
                        <td className="py-2.5 px-3 text-slate-500 font-mono text-[10px]">{s.email}</td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-2 py-1 rounded-full text-[10px] font-bold ${stateInfo.bg} ${stateInfo.text}`}
                          >
                            {stateInfo.label}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          {s.otp_verified ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                          ) : (
                            <Clock className="w-4 h-4 text-slate-300" />
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          {s.pin_set ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                          ) : (
                            <Clock className="w-4 h-4 text-slate-300" />
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-[10px] font-mono text-slate-400">
                          {s.device_uuid || '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                            <button
                              onClick={() => handleResend(s.roll_number)}
                              disabled={actionLoading === `resend-${s.roll_number}`}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-lg bg-blue-50 text-[#2f53d7] hover:bg-blue-100 transition disabled:opacity-50"
                              title="Resend welcome email with permanent login credentials"
                            >
                              {actionLoading === `resend-${s.roll_number}` ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Mail className="w-3 h-3" />
                              )}
                              Resend
                            </button>
                            <button
                              onClick={() => handleResetPin(s.roll_number)}
                              disabled={actionLoading === `reset-${s.roll_number}`}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 transition disabled:opacity-50"
                              title="Generate new 6-digit PIN and clear device lock"
                            >
                              {actionLoading === `reset-${s.roll_number}` ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <KeyRound className="w-3 h-3" />
                              )}
                              Reset PIN
                            </button>
                            <button
                              onClick={() => handleCopyLink(s.roll_number)}
                              disabled={actionLoading === `copy-${s.roll_number}`}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition disabled:opacity-50"
                              title="Copy permanent login link for this student"
                            >
                              {actionLoading === `copy-${s.roll_number}` ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                              Copy Link
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {total > 25 && (
            <div className="flex justify-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1.5 text-xs font-bold bg-slate-100 rounded-lg disabled:opacity-50"
              >
                ← Prev
              </button>
              <span className="px-3 py-1.5 text-xs text-slate-500">
                Page {page} of {Math.ceil(total / 25)}
              </span>
              <button
                disabled={page >= Math.ceil(total / 25)}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1.5 text-xs font-bold bg-slate-100 rounded-lg disabled:opacity-50"
              >
                Next →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
