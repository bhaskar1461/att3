import React, { useState, useEffect, useMemo } from 'react';
import { apiRequest } from '../services/api';
import { TeacherAssignment, AttendanceSession, HistoricalAttendanceSession } from '../types';
import { 
  Camera, Lock, Unlock, RefreshCw, Search, Calendar, History, 
  FileSpreadsheet, ExternalLink, Users, Zap, CheckCircle, X,
  UserCheck, UserX, AlertCircle, Sparkles, ChevronRight, Maximize2, Smartphone
} from 'lucide-react';
// Lazy-load heavy camera scanner and excel register modals
const QRScannerModal = React.lazy(() => import('../components/QRScannerModal').then(m => ({ default: m.QRScannerModal })));
const ClassExcelRegisterModal = React.lazy(() => import('../components/ClassExcelRegisterModal').then(m => ({ default: m.ClassExcelRegisterModal })));
import { ManualSearchModal } from '../components/ManualSearchModal';
import { ProjectorBroadcastModal } from '../components/ProjectorBroadcastModal';
import { Toast } from '../components/Toast';

const PERIOD_LIST = [
  { num: 1, label: 'Period 1', time: '09:10 - 10:00' },
  { num: 2, label: 'Period 2', time: '10:00 - 10:50' },
  { num: 3, label: 'Period 3', time: '10:50 - 11:40' },
  { num: 4, label: 'Period 4', time: '11:40 - 12:30' },
  { num: 5, label: 'Period 5', time: '01:10 - 02:00' },
  { num: 6, label: 'Period 6', time: '02:00 - 02:50' },
  { num: 7, label: 'Period 7', time: '02:50 - 03:40' },
  { num: 8, label: 'Period 8', time: '03:40 - 04:30' },
];

const formatPeriodsString = (periods: number[]): string => {
  if (!periods || periods.length === 0) return 'Period 1';
  const sorted = [...periods].sort((a, b) => a - b);
  if (sorted.length === 1) return `Period ${sorted[0]}`;
  const isConsecutive = sorted.every((val, idx) => idx === 0 || val === sorted[idx - 1] + 1);
  if (isConsecutive) {
    return `Period ${sorted[0]}-${sorted[sorted.length - 1]} (${sorted.length} Periods)`;
  }
  return `Period ${sorted.join(', ')} (${sorted.length} Periods)`;
};

const extractPeriodCount = (periodStr?: string): number => {
  if (!periodStr) return 1;
  const match = periodStr.match(/\((\d+)\s*periods?\)/i);
  if (match) return parseInt(match[1], 10);
  if (periodStr.includes('-')) {
    const parts = periodStr.replace(/periods?/gi, '').split('-');
    if (parts.length >= 2) {
      const p0 = parseInt(parts[0].replace(/\D/g, ''), 10);
      const p1 = parseInt(parts[1].replace(/\D/g, ''), 10);
      if (!isNaN(p0) && !isNaN(p1)) return Math.max(1, p1 - p0 + 1);
    }
  }
  const digits = periodStr.match(/\d+/g);
  if (digits && digits.length > 1) return digits.length;
  if (digits && digits.length === 1) return 1;
  return 1;
};

export const TeacherDashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'today' | 'historical' | 'settings'>('today');
  const [assignments, setAssignments] = useState<TeacherAssignment[]>([]);
  const [selectedAssignment, setSelectedAssignment] = useState<TeacherAssignment | null>(null);
  const [selectedPeriods, setSelectedPeriods] = useState<number[]>([1, 2, 3, 4]); // Defaults to 4-period CET/Lab block
  
  const todayStr = new Date().toISOString().split('T')[0];
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  
  const [activeSession, setActiveSession] = useState<AttendanceSession | null>(null);
  const [historicalSessions, setHistoricalSessions] = useState<HistoricalAttendanceSession[]>([]);
  
  const [teacherProfile, setTeacherProfile] = useState<any>(null);
  const [teacherGSheetId, setTeacherGSheetId] = useState('');
  const [teacherGSheetUrl, setTeacherGSheetUrl] = useState('');

  const [currentClassInfo, setCurrentClassInfo] = useState<any>(null);
  const [unmarkedData, setUnmarkedData] = useState<any>(null);
  const [showUnmarkedModal, setShowUnmarkedModal] = useState(false);

  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isProjectorOpen, setIsProjectorOpen] = useState(false);
  const [isManualOpen, setIsManualOpen] = useState(false);
  const [isExcelRegisterOpen, setIsExcelRegisterOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'warning' } | null>(null);

  // Roster Filter & Search state
  const [rosterSearch, setRosterSearch] = useState('');
  const [rosterFilter, setRosterFilter] = useState<'ALL' | 'PRESENT' | 'ABSENT'>('ALL');
  const [isSyncingRoster, setIsSyncingRoster] = useState(false);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [resetConfirmStudent, setResetConfirmStudent] = useState<any | null>(null);
  const [isResettingDevice, setIsResettingDevice] = useState(false);

  const handleConfirmResetDevice = async () => {
    if (!resetConfirmStudent) return;
    setIsResettingDevice(true);
    try {
      await apiRequest('/devices/reset-student-enrollment', {
        method: 'POST',
        body: JSON.stringify({ roll_number: resetConfirmStudent.roll_number })
      });
      setToast({
        message: `Device unlinked for ${resetConfirmStudent.roll_number}. Student will auto-enroll on next login.`,
        type: 'success'
      });
      setResetConfirmStudent(null);
    } catch (err: any) {
      setToast({
        message: err.message || 'Failed to reset device binding.',
        type: 'error'
      });
    } finally {
      setIsResettingDevice(false);
    }
  };

  useEffect(() => {
    fetchAssignedClasses();
    fetchHistoricalSessions();
    fetchTeacherProfile();
    fetchCurrentClass();
  }, []);

  const fetchTeacherProfile = async () => {
    try {
      const data: any = await apiRequest('/teacher/profile');
      setTeacherProfile(data);
      if (data.google_sheet_id) setTeacherGSheetId(data.google_sheet_id);
      if (data.google_sheet_url) setTeacherGSheetUrl(data.google_sheet_url);
    } catch (err: any) {
      console.error('Failed to load teacher profile:', err);
    }
  };

  const fetchCurrentClass = async () => {
    try {
      const info: any = await apiRequest('/teacher/current-class');
      setCurrentClassInfo(info);
      // Auto-load existing active session if available
      if (info.existing_session_id && !activeSession) {
        fetchSessionDetails(info.existing_session_id);
      }
    } catch (err) {
      console.error('Failed to load current class info:', err);
    }
  };

  const fetchAssignedClasses = async () => {
    try {
      const data: any = await apiRequest('/teacher/assigned-classes');
      setAssignments(data);
      if (data.length > 0 && !selectedAssignment) {
        setSelectedAssignment(data[0]);
      }
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to load assigned classes', type: 'error' });
    }
  };

  const fetchHistoricalSessions = async (dateFilter?: string) => {
    try {
      const url = dateFilter ? `/teacher/historical-sessions?date=${dateFilter}` : '/teacher/historical-sessions';
      const data: any = await apiRequest(url);
      setHistoricalSessions(data);
    } catch (err: any) {
      console.error('Failed to load historical sessions:', err);
    }
  };

  const fetchSessionDetails = async (sessionId: number) => {
    try {
      const data: any = await apiRequest(`/teacher/sessions/${sessionId}`);
      setActiveSession(data);
    } catch (err: any) {
      console.error('Failed to fetch session details:', err);
    }
  };

  const togglePeriod = (num: number) => {
    setSelectedPeriods(prev => {
      if (prev.includes(num)) {
        if (prev.length === 1) return prev; // Keep at least one period selected
        return prev.filter(p => p !== num).sort((a, b) => a - b);
      } else {
        return [...prev, num].sort((a, b) => a - b);
      }
    });
  };

  const setPeriodPreset = (nums: number[]) => {
    setSelectedPeriods([...nums].sort((a, b) => a - b));
  };

  const handleStartSession = async (targetDate?: string) => {
    if (!selectedAssignment) {
      setToast({ message: 'Please select a class first.', type: 'warning' });
      return;
    }
    const sessionDate = targetDate || selectedDate;
    const periodStr = formatPeriodsString(selectedPeriods);
    const periodCount = selectedPeriods.length;

    setIsStartingSession(true);
    try {
      const response: any = await apiRequest('/teacher/sessions/start', {
        method: 'POST',
        body: JSON.stringify({
          subject_id: selectedAssignment.subject_id,
          section_id: selectedAssignment.section_id,
          period: periodStr,
          period_count: periodCount,
          date: sessionDate
        })
      });
      await fetchSessionDetails(response.session_id);
      fetchHistoricalSessions();
      fetchCurrentClass();
      setIsScannerOpen(true);
      setToast({ 
        message: `Session started for ${periodStr}! (${periodCount} Period${periodCount > 1 ? 's' : ''} credit)`, 
        type: 'success' 
      });
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to start session', type: 'error' });
    } finally {
      setIsStartingSession(false);
    }
  };

  const handleOneTapStart = async () => {
    if (!currentClassInfo) return;
    if (currentClassInfo.existing_session_id) {
      await fetchSessionDetails(currentClassInfo.existing_session_id);
      setIsScannerOpen(true);
      return;
    }

    if (!currentClassInfo.assignment) {
      setToast({ message: 'No timetable assignment found for current time.', type: 'warning' });
      return;
    }

    setIsStartingSession(true);
    try {
      const response: any = await apiRequest('/teacher/sessions/start', {
        method: 'POST',
        body: JSON.stringify({
          subject_id: currentClassInfo.assignment.subject_id,
          section_id: currentClassInfo.assignment.section_id,
          period: currentClassInfo.detected_period,
          date: currentClassInfo.current_date
        })
      });
      await fetchSessionDetails(response.session_id);
      fetchHistoricalSessions();
      fetchCurrentClass();
      setIsScannerOpen(true);
      setToast({ message: `Session started for ${currentClassInfo.detected_period}!`, type: 'success' });
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to start session', type: 'error' });
    } finally {
      setIsStartingSession(false);
    }
  };

  const handleLockSession = async () => {
    if (!activeSession) return;
    try {
      const res: any = await apiRequest(`/teacher/sessions/${activeSession.session_id}/lock`, { method: 'POST' });
      if (res?.warning) {
        setToast({ message: res.warning, type: 'warning' });
      } else {
        setToast({ message: 'Attendance session locked successfully!', type: 'success' });
      }
      fetchSessionDetails(activeSession.session_id);
      fetchHistoricalSessions();
    } catch (err: any) {
      setToast({ message: err.message || 'Lock failed', type: 'error' });
    }
  };

  const handleUnlockSession = async (sessionId: number) => {
    try {
      await apiRequest(`/teacher/sessions/${sessionId}/unlock`, { method: 'POST' });
      setToast({ message: 'Session unlocked for editing!', type: 'success' });
      fetchSessionDetails(sessionId);
      fetchHistoricalSessions();
    } catch (err: any) {
      setToast({ message: err.message || 'Unlock failed', type: 'error' });
    }
  };

  const handleFetchUnmarkedStudents = async () => {
    if (!activeSession) return;
    try {
      const data: any = await apiRequest(`/teacher/sessions/${activeSession.session_id}/unmarked-students`);
      setUnmarkedData(data);
      setShowUnmarkedModal(true);
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to fetch unmarked students', type: 'error' });
    }
  };

  const handleQuickMarkUnmarkedPresent = async (studentId: number, rollNumber: string) => {
    if (!activeSession) return;
    const sessionPeriodCount = activeSession.period_count || extractPeriodCount(activeSession.period) || 1;
    try {
      await apiRequest('/attendance/manual-mark', {
        method: 'POST',
        body: JSON.stringify({
          session_id: activeSession.session_id,
          roll_number: rollNumber,
          status: 'PRESENT',
          period_count: sessionPeriodCount
        })
      });
      setUnmarkedData((prev: any) => {
        if (!prev) return null;
        return {
          ...prev,
          total_unmarked: Math.max(0, prev.total_unmarked - 1),
          total_marked: prev.total_marked + 1,
          unmarked_students: prev.unmarked_students.filter((s: any) => s.student_id !== studentId)
        };
      });
      fetchSessionDetails(activeSession.session_id);
      setToast({ message: `Roll ${rollNumber} marked Present (${sessionPeriodCount} Period${sessionPeriodCount > 1 ? 's' : ''})!`, type: 'success' });
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to mark present', type: 'error' });
    }
  };

  const handleToggleStudentAttendance = async (rollNumber: string, currentStatus: string) => {
    if (!activeSession) return;
    const isPresent = ['PRESENT', '1', '2', '3', '4', '5', '6', '7', '8'].includes(currentStatus);
    const nextStatus = isPresent ? 'ABSENT' : 'PRESENT';
    const sessionPeriodCount = activeSession.period_count || extractPeriodCount(activeSession.period) || 1;
    try {
      await apiRequest('/attendance/manual-mark', {
        method: 'POST',
        body: JSON.stringify({
          session_id: activeSession.session_id,
          roll_number: rollNumber,
          status: nextStatus,
          period_count: nextStatus === 'PRESENT' ? sessionPeriodCount : 0
        })
      });
      fetchSessionDetails(activeSession.session_id);
      setToast({ 
        message: `${rollNumber} marked ${nextStatus}${nextStatus === 'PRESENT' ? ` (${sessionPeriodCount} Periods)` : ''}!`, 
        type: nextStatus === 'PRESENT' ? 'success' : 'warning' 
      });
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to update attendance', type: 'error' });
    }
  };

  const handleSaveTeacherGSheet = async () => {
    try {
      const res: any = await apiRequest('/teacher/settings', {
        method: 'PUT',
        body: JSON.stringify({ google_sheet_id: teacherGSheetId })
      });
      setTeacherGSheetId(res.google_sheet_id);
      setTeacherGSheetUrl(res.google_sheet_url);
      setToast({ message: 'Google Sheet configuration saved successfully!', type: 'success' });
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to update Google Sheet ID', type: 'error' });
    }
  };

  const handleSyncSheetRoster = async () => {
    if (!teacherGSheetId) {
      setToast({ message: 'Please enter a Google Sheet URL or ID first.', type: 'warning' });
      return;
    }
    setIsSyncingRoster(true);
    try {
      const res: any = await apiRequest('/teacher/sync-roster-from-sheet', {
        method: 'POST',
        body: JSON.stringify({
          google_sheet_id: teacherGSheetId,
          section_id: selectedAssignment?.section_id
        })
      });
      setToast({ message: res.message || 'Student roster successfully synced from Google Sheet!', type: 'success' });
      await fetchAssignedClasses();
      if (activeSession) {
        fetchSessionDetails(activeSession.session_id);
      }
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to sync students from Google Sheet', type: 'error' });
    } finally {
      setIsSyncingRoster(false);
    }
  };

  // Filtered Roster computation
  const enrolledStudents = activeSession?.students || [];
  const presentCount = activeSession?.present_count ?? enrolledStudents.filter(s => s.status === 'PRESENT' || s.status === '4').length;
  const absentCount = activeSession?.absent_count ?? (enrolledStudents.length - presentCount);
  const attendancePct = enrolledStudents.length > 0 ? Math.round((presentCount / enrolledStudents.length) * 100) : 0;

  const memoizedAssignedSections = useMemo(() => assignments.map(a => ({
    id: a.section_id,
    name: `${a.subject_name} (${a.section_name})`,
    department_name: a.section_name
  })), [assignments]);

  const filteredStudents = enrolledStudents.filter(s => {
    const isPresent = s.status === 'PRESENT' || s.status === '4';
    if (rosterFilter === 'PRESENT' && !isPresent) return false;
    if (rosterFilter === 'ABSENT' && isPresent) return false;
    if (rosterSearch.trim()) {
      const term = rosterSearch.toLowerCase();
      const matchRoll = s.roll_number?.toLowerCase().includes(term);
      const matchName = s.name?.toLowerCase().includes(term);
      if (!matchRoll && !matchName) return false;
    }
    return true;
  });

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Clean Top Header Card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#001e40] to-[#15347e] text-white flex items-center justify-center font-black text-lg shadow-md shrink-0">
            {teacherProfile?.name?.charAt(0) || 'F'}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-heading text-xl font-bold text-[#15347e]">
                {teacherProfile?.name || 'Faculty Attendance Portal'}
              </h2>
              <span className="px-2 py-0.5 bg-[#2f53d7]/10 text-[#2f53d7] border border-[#2f53d7]/20 rounded-full text-[10px] font-extrabold uppercase">
                {teacherProfile?.department || 'Faculty'}
              </span>
            </div>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Empowered attendance tracking with live QR verification & Google Sheets sync
            </p>
          </div>
        </div>

        {/* Global Toolbar Actions */}
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <button
            onClick={() => setIsExcelRegisterOpen(true)}
            className="flex-1 md:flex-initial px-3.5 py-2 bg-[#2f53d7] hover:bg-[#203db0] text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 shadow-sm transition active:scale-95"
            title="Open Excel Register"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-300" /> Class Register
          </button>

          {teacherGSheetUrl && (
            <a
              href={teacherGSheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold rounded-xl text-xs flex items-center gap-1.5 transition shadow-sm"
              title="Open Google Sheet"
            >
              <ExternalLink className="w-3.5 h-3.5" /> Sheet
            </a>
          )}

          <button
            onClick={() => {
              fetchAssignedClasses();
              fetchHistoricalSessions();
              fetchCurrentClass();
              if (activeSession) fetchSessionDetails(activeSession.session_id);
            }}
            className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition border border-slate-300"
            title="Refresh All"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Sleek Navigation Tabs */}
      <div className="flex bg-slate-100/80 p-1 rounded-2xl border border-slate-200 gap-1">
        <button
          onClick={() => setActiveTab('today')}
          className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-extrabold transition-all flex items-center justify-center gap-2 ${
            activeTab === 'today'
              ? 'bg-white text-[#2f53d7] shadow-sm font-black'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Camera className="w-4 h-4" /> Today's Live Attendance
          {activeSession && activeSession.status === 'OPEN' && (
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping ml-1" />
          )}
        </button>

        <button
          onClick={() => {
            setActiveTab('historical');
            fetchHistoricalSessions(selectedDate);
          }}
          className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-extrabold transition-all flex items-center justify-center gap-2 ${
            activeTab === 'historical'
              ? 'bg-white text-[#2f53d7] shadow-sm font-black'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <History className="w-4 h-4" /> Past Sessions & Edits
        </button>

        <button
          onClick={() => setActiveTab('settings')}
          className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-extrabold transition-all flex items-center justify-center gap-2 ${
            activeTab === 'settings'
              ? 'bg-white text-[#2f53d7] shadow-sm font-black'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <FileSpreadsheet className="w-4 h-4 text-emerald-600" /> Google Sheet Settings
        </button>
      </div>

      {/* TAB 1: TODAY'S LIVE ATTENDANCE */}
      {activeTab === 'today' && (
        <div className="space-y-5">
          
          {/* Active Session Controller Card */}
          {activeSession ? (
            <div className="bg-gradient-to-br from-[#001e40] via-[#0b2853] to-[#15347e] rounded-2xl p-6 text-white shadow-xl border border-blue-900/50 space-y-5">
              
              {/* Top Meta Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className={`px-3 py-1 rounded-full text-xs font-black uppercase flex items-center gap-1.5 ${
                    activeSession.status === 'OPEN'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                  }`}>
                    <span className={`w-2 h-2 rounded-full ${activeSession.status === 'OPEN' ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
                    {activeSession.status === 'OPEN' ? 'Live Session Active' : 'Session Locked'}
                  </span>
                  <span className="px-2.5 py-1 rounded-full bg-white/10 text-slate-200 text-xs font-mono font-bold">
                    📅 {activeSession.session_date}
                  </span>
                  <span className="px-2.5 py-1 rounded-full bg-white/10 text-slate-200 text-xs font-mono font-bold">
                    ⏱️ {activeSession.period}
                  </span>
                </div>

                {/* Session Lock Toggle */}
                {activeSession.status === 'OPEN' ? (
                  <button
                    onClick={handleLockSession}
                    className="px-3 py-1.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/40 rounded-xl text-xs font-bold transition flex items-center gap-1.5"
                  >
                    <Lock className="w-3.5 h-3.5" /> Lock Attendance
                  </button>
                ) : (
                  <button
                    onClick={() => handleUnlockSession(activeSession.session_id)}
                    className="px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 rounded-xl text-xs font-bold transition flex items-center gap-1.5"
                  >
                    <Unlock className="w-3.5 h-3.5" /> Unlock Session
                  </button>
                )}
              </div>

              {/* Subject & Section Title */}
              <div>
                <h3 className="text-2xl font-black text-white tracking-tight">
                  {activeSession.subject_name}
                </h3>
                <p className="text-blue-200 text-sm font-semibold mt-0.5 flex items-center gap-2">
                  <span className="px-2.5 py-0.5 bg-white/15 rounded-md text-white font-mono font-bold text-xs">
                    {activeSession.section_name}
                  </span>
                  <span>SNIST Academic Roster</span>
                </p>
              </div>

              {/* Progress & Live Stat Counters */}
              <div className="space-y-2 bg-white/5 rounded-xl p-4 border border-white/10">
                <div className="flex items-center justify-between text-xs font-bold">
                  <span className="text-slate-300">Attendance Rate</span>
                  <span className="text-emerald-300 font-mono text-sm">{attendancePct}% ({presentCount} of {enrolledStudents.length})</span>
                </div>
                <div className="w-full h-3 bg-black/30 rounded-full overflow-hidden p-0.5">
                  <div 
                    className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-500"
                    style={{ width: `${attendancePct}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs text-slate-300 font-mono pt-1">
                  <span className="text-emerald-400 font-bold">✅ Present: {presentCount}</span>
                  <span className="text-rose-400 font-bold">❌ Absent: {absentCount}</span>
                  <span className="text-slate-400 font-bold">👥 Total: {enrolledStudents.length}</span>
                </div>
              </div>

              {/* Action Buttons Bar */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
                <button
                  onClick={() => setIsProjectorOpen(true)}
                  disabled={activeSession.status !== 'OPEN'}
                  className="py-3.5 px-4 bg-gradient-to-r from-amber-400 via-[#FF9F0A] to-orange-500 hover:from-amber-300 hover:to-orange-400 disabled:opacity-50 text-[#001e40] font-black text-sm rounded-xl transition shadow-xl ring-2 ring-amber-400/40 flex items-center justify-center gap-2 active:scale-98"
                >
                  <Maximize2 className="w-5 h-5 text-[#001e40]" /> Projector QR (Broadcast)
                </button>

                <button
                  onClick={() => setIsScannerOpen(true)}
                  disabled={activeSession.status !== 'OPEN'}
                  className="py-3.5 px-4 bg-white/10 hover:bg-white/20 disabled:opacity-50 text-slate-200 font-bold text-xs rounded-xl border border-white/20 transition flex items-center justify-center gap-2 active:scale-98"
                  title="Legacy webcam scanner for scanning student pass"
                >
                  <Camera className="w-4 h-4 text-slate-300" /> Webcam Scanner (Backup)
                </button>

                <button
                  onClick={handleFetchUnmarkedStudents}
                  className="py-3.5 px-4 bg-white/10 hover:bg-white/20 text-white font-bold text-xs rounded-xl border border-white/20 transition flex items-center justify-center gap-2"
                >
                  <Users className="w-4 h-4 text-amber-300" /> Absence Callout
                </button>

                <button
                  onClick={() => setIsManualOpen(true)}
                  className="py-3.5 px-4 bg-white/10 hover:bg-white/20 text-white font-bold text-xs rounded-xl border border-white/20 transition flex items-center justify-center gap-2"
                >
                  <Search className="w-4 h-4 text-cyan-300" /> Manual Search / Mark
                </button>
              </div>

              {/* Class Switcher for Multiple Assignments */}
              {assignments.length > 1 && (
                <div className="pt-2 border-t border-white/10 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <span className="text-slate-300 font-medium">Switch to another assigned class:</span>
                  <div className="flex items-center gap-2">
                    <select
                      value={selectedAssignment?.assignment_id || ''}
                      onChange={(e) => {
                        const found = assignments.find(a => a.assignment_id === Number(e.target.value));
                        if (found) setSelectedAssignment(found);
                      }}
                      className="bg-white/10 border border-white/20 rounded-xl px-3 py-1.5 text-xs font-bold text-white focus:outline-none"
                    >
                      {assignments.map(a => (
                        <option key={a.assignment_id} value={a.assignment_id} className="text-slate-900">
                          {a.subject_name} ({a.section_name})
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => handleStartSession(todayStr)}
                      disabled={isStartingSession}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs transition"
                    >
                      Start
                    </button>
                  </div>
                </div>
              )}

            </div>
          ) : (
            /* Start New Attendance Session Card (When Idle) */
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-5">
              
              {/* Timetable One-Tap Recommendation if detected */}
              {currentClassInfo && currentClassInfo.has_assignment && (
                <div className="bg-gradient-to-r from-[#001e40] to-[#15347e] rounded-xl p-4 text-white flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-md">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-blue-400/20 text-blue-200 font-mono text-[11px] font-bold">
                        IST {currentClassInfo.current_time} • {currentClassInfo.detected_period}
                      </span>
                      <span className="text-xs text-amber-300 font-bold flex items-center gap-1">
                        <Sparkles className="w-3.5 h-3.5" /> Scheduled Now
                      </span>
                    </div>
                    <h4 className="font-bold text-base text-white">
                      {currentClassInfo.assignment.subject_name} ({currentClassInfo.assignment.section_name})
                    </h4>
                  </div>
                  <button
                    onClick={handleOneTapStart}
                    disabled={isStartingSession}
                    className="px-5 py-2.5 bg-[#FF9F0A] hover:bg-[#e08b05] text-[#001e40] font-black text-xs uppercase tracking-wider rounded-xl transition shadow flex items-center gap-1.5 shrink-0"
                  >
                    <Zap className="w-4 h-4" /> 1-Tap Start Attendance
                  </button>
                </div>
              )}

              <div>
                <h3 className="font-heading text-lg font-bold text-[#15347e]">
                  Start Today's Attendance Session
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Choose your assigned class and class period to begin live attendance scanning.
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Assigned Class / Subject</label>
                  <select
                    value={selectedAssignment?.assignment_id || ''}
                    onChange={(e) => {
                      const found = assignments.find(a => a.assignment_id === Number(e.target.value));
                      if (found) setSelectedAssignment(found);
                    }}
                    className="snist-input w-full font-semibold"
                  >
                    {assignments.map(a => (
                      <option key={a.assignment_id} value={a.assignment_id}>
                        {a.subject_name} ({a.section_name} - {a.department})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Multi-Select Period Interface */}
                <div className="space-y-2.5 p-4 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <span>Select Class Periods</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-[#15347e] font-extrabold border border-blue-200">
                          Multi-Select
                        </span>
                      </label>
                      <p className="text-[11px] text-slate-500">
                        Choose multiple periods to award simultaneous attendance credit with one scan.
                      </p>
                    </div>

                    {/* Active Selection Summary Badge */}
                    <span className="px-3 py-1 bg-gradient-to-r from-[#001e40] to-[#15347e] text-white rounded-lg text-xs font-bold font-mono shadow-sm flex items-center gap-1.5">
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                      {selectedPeriods.length} Period{selectedPeriods.length > 1 ? 's' : ''} ({formatPeriodsString(selectedPeriods)})
                    </span>
                  </div>

                  {/* Fast Presets */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-1">Presets:</span>
                    <button
                      type="button"
                      onClick={() => setPeriodPreset([1, 2, 3, 4])}
                      className={`px-2.5 py-1 text-[11px] font-bold rounded-lg border transition ${
                        selectedPeriods.length === 4 && [1, 2, 3, 4].every(p => selectedPeriods.includes(p))
                          ? 'bg-[#15347e] text-white border-[#15347e] shadow-sm'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      ⚡ 4-Period Block (P1–P4)
                    </button>
                    <button
                      type="button"
                      onClick={() => setPeriodPreset([1, 2])}
                      className={`px-2.5 py-1 text-[11px] font-bold rounded-lg border transition ${
                        selectedPeriods.length === 2 && [1, 2].every(p => selectedPeriods.includes(p))
                          ? 'bg-[#15347e] text-white border-[#15347e] shadow-sm'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      ⚡ Double (P1–P2)
                    </button>
                    <button
                      type="button"
                      onClick={() => setPeriodPreset([3, 4])}
                      className={`px-2.5 py-1 text-[11px] font-bold rounded-lg border transition ${
                        selectedPeriods.length === 2 && [3, 4].every(p => selectedPeriods.includes(p))
                          ? 'bg-[#15347e] text-white border-[#15347e] shadow-sm'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      ⚡ Double (P3–P4)
                    </button>
                    <button
                      type="button"
                      onClick={() => setPeriodPreset([5, 6, 7])}
                      className={`px-2.5 py-1 text-[11px] font-bold rounded-lg border transition ${
                        selectedPeriods.length === 3 && [5, 6, 7].every(p => selectedPeriods.includes(p))
                          ? 'bg-[#15347e] text-white border-[#15347e] shadow-sm'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      ⚡ Afternoon Lab (P5–P7)
                    </button>
                    <button
                      type="button"
                      onClick={() => setPeriodPreset([1])}
                      className={`px-2 py-1 text-[11px] font-bold rounded-lg border transition ${
                        selectedPeriods.length === 1 && selectedPeriods[0] === 1
                          ? 'bg-[#15347e] text-white border-[#15347e] shadow-sm'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      Single (P1)
                    </button>
                    <button
                      type="button"
                      onClick={() => setPeriodPreset([1, 2, 3, 4, 5, 6, 7, 8])}
                      className="px-2 py-1 text-[11px] font-semibold text-blue-600 hover:underline ml-auto"
                    >
                      Select All 8
                    </button>
                  </div>

                  {/* Interactive Period Chips Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 pt-1">
                    {PERIOD_LIST.map((item) => {
                      const isSelected = selectedPeriods.includes(item.num);
                      return (
                        <button
                          key={item.num}
                          type="button"
                          onClick={() => togglePeriod(item.num)}
                          className={`relative p-2.5 rounded-xl border text-center transition-all duration-150 flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
                            isSelected
                              ? 'bg-gradient-to-b from-[#15347e] to-[#001e40] text-white border-[#001e40] shadow-md ring-2 ring-blue-500/30 font-bold'
                              : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:bg-slate-50 shadow-sm'
                          }`}
                        >
                          <div className="flex items-center gap-1">
                            <span className="font-extrabold text-sm tracking-tight">{item.label}</span>
                            {isSelected && <CheckCircle className="w-3 h-3 text-emerald-400 shrink-0" />}
                          </div>
                          <span className={`text-[10px] font-mono ${isSelected ? 'text-blue-200' : 'text-slate-400'}`}>
                            {item.time}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <button
                onClick={() => handleStartSession(todayStr)}
                disabled={isStartingSession}
                className="w-full py-3.5 snist-btn-primary font-bold text-sm flex items-center justify-center gap-2 shadow-md transition active:scale-98"
              >
                <Camera className="w-5 h-5" /> 
                {isStartingSession ? 'Starting Session...' : 'Start Attendance Session & Launch Scanner'}
              </button>
            </div>
          )}

          {/* Student Roster Section (When Active Session is Present) */}
          {activeSession && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
              
              {/* Roster Controls Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                <div>
                  <h4 className="font-heading text-base font-bold text-[#15347e]">
                    Class Attendance Roster
                  </h4>
                  <p className="text-xs text-slate-500 font-medium">
                    Showing {filteredStudents.length} of {enrolledStudents.length} students
                  </p>
                </div>

                {/* Filter Chips */}
                <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-bold">
                  <button
                    onClick={() => setRosterFilter('ALL')}
                    className={`px-3 py-1.5 rounded-lg transition ${
                      rosterFilter === 'ALL' ? 'bg-[#2f53d7] text-white shadow-sm font-extrabold' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    All ({enrolledStudents.length})
                  </button>
                  <button
                    onClick={() => setRosterFilter('PRESENT')}
                    className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1 ${
                      rosterFilter === 'PRESENT' ? 'bg-emerald-600 text-white shadow-sm font-extrabold' : 'text-emerald-700 hover:text-emerald-900'
                    }`}
                  >
                    <UserCheck className="w-3.5 h-3.5" /> Present ({presentCount})
                  </button>
                  <button
                    onClick={() => setRosterFilter('ABSENT')}
                    className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1 ${
                      rosterFilter === 'ABSENT' ? 'bg-rose-600 text-white shadow-sm font-extrabold' : 'text-rose-700 hover:text-rose-900'
                    }`}
                  >
                    <UserX className="w-3.5 h-3.5" /> Absent ({absentCount})
                  </button>
                </div>
              </div>

              {/* Search Bar */}
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search student roll number or name..."
                  value={rosterSearch}
                  onChange={(e) => setRosterSearch(e.target.value)}
                  className="snist-input w-full pl-10 text-xs font-medium"
                />
              </div>

              {/* Roster Grid */}
              {filteredStudents.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 rounded-xl text-slate-500 text-xs border border-slate-200">
                  No students match your filter or search criteria.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[480px] overflow-y-auto pr-1">
                  {filteredStudents.map(s => {
                    const isPresent = s.status === 'PRESENT' || s.status === '4';
                    return (
                      <div
                        key={s.student_id}
                        className={`p-3 rounded-xl border flex items-center justify-between transition-all ${
                          isPresent
                            ? 'bg-emerald-50/50 border-emerald-200'
                            : 'bg-white border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div className="min-w-0 pr-2">
                          <h5 className="text-xs font-bold text-slate-900 truncate">{s.name}</h5>
                          <p className="text-[11px] font-mono text-[#2f53d7] font-bold">{s.roll_number}</p>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => setResetConfirmStudent(s)}
                            className="p-1.5 rounded-lg bg-slate-100 hover:bg-amber-100 text-slate-500 hover:text-amber-800 transition"
                            title="Reset Device Binding (phone replacement)"
                          >
                            <Smartphone className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleToggleStudentAttendance(s.roll_number, s.status)}
                            disabled={activeSession.status !== 'OPEN'}
                            className={`px-3 py-1 rounded-lg text-xs font-black transition-colors ${
                              isPresent
                                ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm'
                                : 'bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200'
                            }`}
                            title={`Click to mark ${isPresent ? 'Absent' : 'Present'}`}
                          >
                            {isPresent ? 'PRESENT' : 'ABSENT'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

            </div>
          )}

          {/* Teacher Device Reset Confirmation Modal */}
          {resetConfirmStudent && (
            <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 space-y-4 font-sans">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold shrink-0">
                    <Smartphone className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm text-slate-900">Reset Device Binding</h4>
                    <p className="text-xs text-slate-500">{resetConfirmStudent.name} ({resetConfirmStudent.roll_number})</p>
                  </div>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  This will unbind the student's registered phone. Their next login will automatically enroll their new device.
                </p>
                <div className="flex items-center gap-2 pt-2">
                  <button
                    onClick={() => setResetConfirmStudent(null)}
                    disabled={isResettingDevice}
                    className="flex-1 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleConfirmResetDevice}
                    disabled={isResettingDevice}
                    className="flex-1 py-2 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white shadow transition"
                  >
                    {isResettingDevice ? 'Resetting...' : 'Confirm Reset'}
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>
      )}

      {/* TAB 2: PAST SESSIONS & HISTORICAL EDITS */}
      {activeTab === 'historical' && (
        <div className="space-y-5">
          
          {/* Date Picker & Selector Card */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <h3 className="font-heading text-lg font-bold text-[#15347e]">
                  Past Attendance Sessions
                </h3>
                <p className="text-xs text-slate-500 font-medium">
                  Review historical attendance or unlock prior sessions for authorized edits.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-[#2f53d7]" />
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => {
                    setSelectedDate(e.target.value);
                    fetchHistoricalSessions(e.target.value);
                  }}
                  className="snist-input font-mono font-bold text-xs"
                />
              </div>
            </div>

            {/* Quick Session Launcher for Past Date */}
            <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs">
              <span className="text-slate-600 font-medium">Need to record attendance for {selectedDate}?</span>
              <button
                onClick={() => handleStartSession(selectedDate)}
                className="px-4 py-2 snist-btn-primary font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-sm"
              >
                <Camera className="w-3.5 h-3.5" /> Start / Unlock Session for {selectedDate}
              </button>
            </div>
          </div>

          {/* Historical Sessions List */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-heading text-sm font-bold text-[#15347e]">
                Recorded Sessions for {selectedDate}
              </h4>
              <span className="text-xs font-bold text-[#2f53d7]">
                {historicalSessions.length} session(s) found
              </span>
            </div>

            {historicalSessions.length === 0 ? (
              <div className="p-8 text-center bg-slate-50 border border-slate-200 rounded-2xl text-slate-500 text-xs">
                No sessions recorded for {selectedDate}. Use the button above to record attendance for this date.
              </div>
            ) : (
              <div className="space-y-3">
                {historicalSessions.map((hs) => (
                  <div 
                    key={hs.session_id} 
                    className="p-4 bg-slate-50 hover:bg-slate-100/80 border border-slate-200 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-[#15347e]">{hs.subject_name}</span>
                        <span className="px-2 py-0.5 bg-white border border-slate-300 text-slate-800 text-[11px] font-bold rounded-lg">{hs.section_name}</span>
                        <span className={`px-2 py-0.5 rounded-lg text-[10px] font-extrabold uppercase ${
                          hs.status === 'OPEN' ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : 'bg-rose-100 text-rose-800 border border-rose-300'
                        }`}>
                          {hs.status}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1 flex items-center gap-3 font-medium">
                        <span>📅 {hs.session_date}</span>
                        <span>⏱️ {hs.period}</span>
                        <span>👥 <strong className="text-emerald-700">{hs.present_count}</strong>/{hs.total_students} Present</span>
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      {hs.status === 'LOCKED' ? (
                        <button
                          onClick={() => handleUnlockSession(hs.session_id)}
                          className="px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 transition shadow-sm"
                        >
                          <Unlock className="w-3.5 h-3.5" /> Unlock / Edit
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => {
                              fetchSessionDetails(hs.session_id);
                              setIsScannerOpen(true);
                            }}
                            className="px-3.5 py-2 snist-btn-primary text-xs font-bold flex items-center gap-1.5"
                          >
                            <Camera className="w-3.5 h-3.5" /> Scan QR
                          </button>
                          <button
                            onClick={() => {
                              fetchSessionDetails(hs.session_id);
                              setIsManualOpen(true);
                            }}
                            className="px-3 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold rounded-xl flex items-center gap-1 transition"
                          >
                            <Search className="w-3.5 h-3.5" /> Roster
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      )}

      {/* TAB 3: GOOGLE SHEET SETTINGS */}
      {activeTab === 'settings' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-5">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h3 className="font-heading text-lg font-bold text-[#15347e] flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-emerald-600" /> Individual Google Sheet Configuration
              </h3>
              <p className="text-xs text-[#6a7894] mt-1">
                Configure your personal Google Sheet URL. Attendance marked in your sessions will automatically update your Google Sheet in real-time.
              </p>
            </div>
            {teacherGSheetUrl && (
              <a
                href={teacherGSheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3.5 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold text-xs rounded-xl border border-emerald-200 flex items-center gap-1.5 transition shrink-0 shadow-sm"
              >
                <ExternalLink className="w-4 h-4" /> Open My Live Sheet
              </a>
            )}
          </div>

          <div className="space-y-4 pt-2">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Google Sheet URL or Spreadsheet ID
              </label>
              <input
                type="text"
                value={teacherGSheetId}
                onChange={(e) => setTeacherGSheetId(e.target.value)}
                placeholder="e.g. https://docs.google.com/spreadsheets/d/18oBSsQd9CvzpVsQvtMul2CHXWWUWuue-I50-9hzK3wg/edit"
                className="snist-input w-full text-xs font-mono"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Tip: Paste the complete Google Sheet browser URL. The system will automatically extract and save the Spreadsheet ID.
              </p>
            </div>

            {teacherGSheetId && (
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-2 text-xs">
                <div>
                  <span className="font-bold text-slate-500">Configured ID: </span>
                  <span className="font-mono font-bold text-[#2f53d7]">{teacherGSheetId}</span>
                </div>
                <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-extrabold text-[10px]">
                  ACTIVE
                </span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                onClick={handleSaveTeacherGSheet}
                className="px-6 py-2.5 snist-btn-primary font-bold text-xs flex items-center gap-2 shadow-sm"
              >
                <FileSpreadsheet className="w-4 h-4" /> Save Sheet Configuration
              </button>

              <button
                onClick={handleSyncSheetRoster}
                disabled={isSyncingRoster}
                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl flex items-center gap-2 shadow-sm transition disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${isSyncingRoster ? 'animate-spin' : ''}`} /> 
                {isSyncingRoster ? 'Syncing Students from Sheet...' : 'Sync Students from This Sheet'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QR Camera Modal */}
      {isScannerOpen && activeSession && (
        <React.Suspense fallback={null}>
          <QRScannerModal
            sessionId={activeSession.session_id}
            sessionDate={activeSession.session_date}
            periodText={activeSession.period}
            subjectName={activeSession.subject_name}
            sectionName={activeSession.section_name}
            initialPeriodCount={parseInt(activeSession.period?.replace(/\D/g, '') || '4') || 4}
            onClose={() => {
              setIsScannerOpen(false);
              fetchSessionDetails(activeSession.session_id);
            }}
            onScanSuccess={() => {
              fetchSessionDetails(activeSession.session_id);
            }}
            onOpenManualSearch={() => {
              setIsScannerOpen(false);
              setIsManualOpen(true);
            }}
          />
        </React.Suspense>
      )}

      {/* Manual Search Modal */}
      {isManualOpen && activeSession && (
        <ManualSearchModal
          sessionId={activeSession.session_id}
          students={activeSession.students}
          initialPeriodCount={parseInt(activeSession.period?.replace(/\D/g, '') || '4') || 4}
          onClose={() => setIsManualOpen(false)}
          onMarkSuccess={() => fetchSessionDetails(activeSession.session_id)}
        />
      )}

      {/* Class Register Excel Grid Modal */}
      {isExcelRegisterOpen && (
        <React.Suspense fallback={null}>
          <ClassExcelRegisterModal
            isOpen={isExcelRegisterOpen}
            onClose={() => setIsExcelRegisterOpen(false)}
            defaultSectionId={activeSession?.section_id || selectedAssignment?.section_id}
            assignedSections={memoizedAssignedSections}
          />
        </React.Suspense>
      )}

      {/* Absence Callout Modal */}
      {showUnmarkedModal && unmarkedData && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full space-y-4 border border-[#D2D2D7] shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-amber-600" />
                <div>
                  <h3 className="font-bold text-base text-[#15347e]">Absence Callout</h3>
                  <p className="text-[11px] text-slate-500 font-medium">
                    {unmarkedData.total_unmarked} of {unmarkedData.total_enrolled} students unmarked
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setShowUnmarkedModal(false)}
                className="text-slate-400 hover:text-slate-700 p-1.5 rounded-full hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {unmarkedData.unmarked_students && unmarkedData.unmarked_students.length > 0 ? (
                unmarkedData.unmarked_students.map((st: any) => (
                  <div key={st.student_id} className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between hover:bg-slate-100 transition">
                    <div>
                      <span className="font-mono font-bold text-sm text-[#15347e] block">{st.roll_number}</span>
                      <span className="text-xs text-slate-600 font-medium">{st.name}</span>
                    </div>
                    <button
                      onClick={() => handleQuickMarkUnmarkedPresent(st.student_id, st.roll_number)}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg flex items-center gap-1 shadow-sm transition"
                    >
                      <CheckCircle className="w-3.5 h-3.5" /> Mark Present
                    </button>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-emerald-600 font-bold text-sm flex flex-col items-center gap-2">
                  <CheckCircle className="w-8 h-8 text-emerald-500" />
                  All enrolled students in this section are marked present!
                </div>
              )}
            </div>

            <button 
              onClick={() => setShowUnmarkedModal(false)}
              className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition"
            >
              Done Calling Out
            </button>
          </div>
        </div>
      )}

      {/* Projector 10s Rotating Broadcast Modal */}
      {isProjectorOpen && activeSession && (
        <ProjectorBroadcastModal
          sessionId={activeSession.session_id}
          initialPeriodCount={parseInt(activeSession.period?.replace(/\D/g, '') || '1') || 1}
          onClose={() => {
            setIsProjectorOpen(false);
            fetchSessionDetails(activeSession.session_id);
          }}
          onLockSession={handleLockSession}
        />
      )}

    </div>
  );
};
