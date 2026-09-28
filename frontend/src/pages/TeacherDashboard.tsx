import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../services/api';
import { TeacherAssignment, AttendanceSession, HistoricalAttendanceSession } from '../types';
import { 
  Camera, Lock, Unlock, RefreshCw, Search, Calendar, History, 
  FileSpreadsheet, ExternalLink, Users, Zap, CheckCircle, CheckCircle2, X, Download,
  UserCheck, UserX, AlertCircle, Sparkles, ChevronRight, Maximize2, Smartphone, ShieldAlert, AlertTriangle,
  Clock, Tv, Trash2, Layers, UserPlus, ArrowDownCircle, ArrowUpCircle, Mail
} from 'lucide-react';
// Lazy-load heavy camera scanner and excel register modals
const QRScannerModal = React.lazy(() => import('../components/QRScannerModal').then(m => ({ default: m.QRScannerModal })));
const ClassExcelRegisterModal = React.lazy(() => import('../components/ClassExcelRegisterModal').then(m => ({ default: m.ClassExcelRegisterModal })));
import { ManualSearchModal } from '../components/ManualSearchModal';
import { ProjectorBroadcastModal } from '../components/ProjectorBroadcastModal';
import { Toast } from '../components/Toast';
import { FacultyDefaultersTab } from '../components/FacultyDefaultersTab';
import { TeacherCalendarContainer } from '../components/teacher/TeacherCalendarContainer.tsx';
import { adaptSessionsToCalendarEvents, groupEventsByDate } from '../services/calendarAdapter.ts';
import { clearCalendarSummaryCache } from '../services/calendarService.ts';
import { getTodayIST } from '../utils/dateUtils.ts';
import type { TeacherClassEvent } from '../types/calendar.ts';
import { useRenderCounter } from '../dev/diagnostics.ts';

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

const getInstitutionalErrorMessage = (err: any, fallback: string): string => {
  if (!err) return fallback;
  const msg = typeof err === 'string' ? err : err.message || '';
  if (/failed to fetch|network|load failed/i.test(msg)) {
    return 'Network connection issue. Please check your connection and retry.';
  }
  if (/401|unauthorized|token|session expired/i.test(msg)) {
    return 'Your login session has expired. Please refresh and log in again.';
  }
  if (/403|forbidden|not authorized|permission/i.test(msg)) {
    return 'You are not authorized to modify attendance for this class section.';
  }
  if (/locked/i.test(msg)) {
    return 'This attendance session has been locked and cannot be edited without unlocking.';
  }
  if (/500|internal server|sql|traceback|syntaxerror/i.test(msg)) {
    return 'An unexpected institutional server error occurred. Please retry in a moment.';
  }
  return msg || fallback;
};

export const TeacherDashboard: React.FC = () => {
  useRenderCounter('TeacherDashboard');
  const [activeTab, setActiveTab] = useState<'calendar' | 'today' | 'historical' | 'defaulters' | 'settings'>('calendar');
  const [academicYear, setAcademicYear] = useState<string>('2025-26');
  const [globalSearch, setGlobalSearch] = useState<string>('');
  const [assignments, setAssignments] = useState<TeacherAssignment[]>([]);
  const [selectedAssignment, setSelectedAssignment] = useState<TeacherAssignment | null>(null);
  const [selectedPeriods, setSelectedPeriods] = useState<number[]>([1]); // Defaults to single period [1]
  const [displayType, setDisplayType] = useState<'projector' | 'phone_screen' | 'laptop'>('projector');
  
  const todayStr = getTodayIST();
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  
  const [activeSession, setActiveSession] = useState<AttendanceSession | null>(null);
  const [allHistoricalSessions, setAllHistoricalSessions] = useState<HistoricalAttendanceSession[]>([]);
  const historicalSessions = allHistoricalSessions; // backward-compatibility alias
  const [pastSessionsDateFilter, setPastSessionsDateFilter] = useState<string>(''); // '' = all dates
  
  const [teacherProfile, setTeacherProfile] = useState<any>(null);
  const [teacherGSheetId, setTeacherGSheetId] = useState('');
  const [teacherGSheetUrl, setTeacherGSheetUrl] = useState('');
  const [classSheetInputs, setClassSheetInputs] = useState<Record<number, string>>({});
  const [savingAssignmentId, setSavingAssignmentId] = useState<number | null>(null);
  const [syncingAssignmentId, setSyncingAssignmentId] = useState<number | null>(null);

  const [currentClassInfo, setCurrentClassInfo] = useState<any>(null);
  const [unmarkedData, setUnmarkedData] = useState<any>(null);
  const [showUnmarkedModal, setShowUnmarkedModal] = useState(false);

  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isProjectorOpen, setIsProjectorOpen] = useState(false);
  const [isManualOpen, setIsManualOpen] = useState(false);
  const [isExcelRegisterOpen, setIsExcelRegisterOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'warning' } | null>(null);
  const [isLoadingInitial, setIsLoadingInitial] = useState(true);

  // Roster Filter & Search state
  const [rosterSearch, setRosterSearch] = useState('');
  const [rosterFilter, setRosterFilter] = useState<'ALL' | 'PRESENT' | 'ABSENT'>('ALL');
  const [isSyncingRoster, setIsSyncingRoster] = useState(false);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [resetConfirmStudent, setResetConfirmStudent] = useState<any | null>(null);
  const [isResettingDevice, setIsResettingDevice] = useState(false);
  const [confirmDeleteSession, setConfirmDeleteSession] = useState<HistoricalAttendanceSession | null>(null);
  const [isDeletingSession, setIsDeletingSession] = useState(false);
  const [reconciliationModalData, setReconciliationModalData] = useState<any>(null);

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
    const init = async () => {
      setIsLoadingInitial(true);
      try {
        await Promise.allSettled([
          fetchAssignedClasses(),
          fetchHistoricalSessions(),
          fetchTeacherProfile(),
          fetchCurrentClass()
        ]);
      } finally {
        setIsLoadingInitial(false);
      }
    };
    init();
  }, []);

  // Synchronize selectedAssignment with activeSession so switcher dropdown always reflects active class
  useEffect(() => {
    if (activeSession && assignments.length > 0) {
      const match = assignments.find(
        a => a.subject_id === activeSession.subject_id && a.section_id === activeSession.section_id
      );
      if (match && (!selectedAssignment || selectedAssignment.assignment_id !== match.assignment_id)) {
        setSelectedAssignment(match);
      }
    }
  }, [activeSession?.subject_id, activeSession?.section_id, assignments]);

  // Phase 5: Period transitions, background sync & tab visibility synchronization
  useEffect(() => {
    // 1. Period transition detector: Every 60 seconds check server-authoritative current period
    const periodCheckTimer = setInterval(() => {
      fetchCurrentClass();
    }, 60000);

    // 2. Tab visibility listener: Re-sync current class and historical sessions upon refocus
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchCurrentClass();
        fetchHistoricalSessions();
        if (activeSession?.session_id && activeSession.status === 'OPEN') {
          fetchSessionDetails(activeSession.session_id);
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // 3. Lightweight attendance headcount sync: Every 15 seconds if an open session exists and modal is not open
    const liveCountTimer = setInterval(() => {
      if (activeSession?.session_id && activeSession.status === 'OPEN' && !isProjectorOpen) {
        fetchSessionDetails(activeSession.session_id);
        fetchHistoricalSessions();
      }
    }, 15000);

    return () => {
      clearInterval(periodCheckTimer);
      clearInterval(liveCountTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [activeSession?.session_id, activeSession?.status, isProjectorOpen]);

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
      setAssignments(data || []);
      const inputs: Record<number, string> = {};
      (data || []).forEach((a: TeacherAssignment) => {
        inputs[a.assignment_id] = a.google_sheet_id || '';
      });
      setClassSheetInputs(prev => ({ ...inputs, ...prev }));
      if (data && data.length > 0) {
        if (!selectedAssignment || !data.some((a: any) => a.assignment_id === selectedAssignment.assignment_id)) {
          setSelectedAssignment(data[0]);
        }
      } else {
        setSelectedAssignment(null);
      }
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to load assigned classes', type: 'error' });
    }
  };

  const handleDownloadMyClassRegister = async (assignmentId?: number, fileName?: string) => {
    const targetId = assignmentId || selectedAssignment?.assignment_id;
    if (!targetId) return;
    const token = localStorage.getItem('token');
    try {
      setToast({ message: 'Generating and downloading class attendance register...', type: 'success' });
      const url = `/api/v1/teacher/assignments/${targetId}/download-register`;
      const response = await fetch(url, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (!response.ok) {
        throw new Error(`Download failed with status ${response.status}`);
      }
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = fileName || selectedAssignment?.excel_file_name || `Register_${targetId}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);
      setToast({ message: 'Class register downloaded successfully!', type: 'success' });
    } catch (err: any) {
      setToast({ message: err.message || 'Download failed', type: 'error' });
    }
  };

  const fetchHistoricalSessions = async () => {
    try {
      clearCalendarSummaryCache();
      const data: any = await apiRequest('/teacher/historical-sessions?limit=500');
      if (Array.isArray(data)) {
        setAllHistoricalSessions(data);
      }
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

  const getFacultyGeolocation = async (): Promise<{ latitude?: number; longitude?: number; accuracy_m?: number }> => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      return {};
    }
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          resolve({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy_m: pos.coords.accuracy
          });
        },
        (err) => {
          console.warn('[Geolocation] Faculty GPS unavailable:', err.message);
          resolve({});
        },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 15000 }
      );
    });
  };

  const setPeriodPreset = (nums: number[]) => {
    setSelectedPeriods([...nums].sort((a, b) => a - b));
  };

  const handleStartSession = async (targetDate?: string) => {
    let currentAsgn = selectedAssignment;
    if (!currentAsgn) {
      if (assignments && assignments.length > 0) {
        currentAsgn = assignments[0];
        setSelectedAssignment(assignments[0]);
      } else {
        setToast({ 
          message: 'No classes are currently assigned to your faculty profile. Please contact the administrator or assign a class in the Admin Setup Hub.', 
          type: 'warning' 
        });
        return;
      }
    }
    const sessionDate = targetDate || selectedDate;
    const periodStr = formatPeriodsString(selectedPeriods);
    const periodCount = selectedPeriods.length;

    setIsStartingSession(true);
    try {
      const geo = await getFacultyGeolocation();
      const response: any = await apiRequest('/teacher/sessions/start', {
        method: 'POST',
        body: JSON.stringify({
          subject_id: currentAsgn.subject_id,
          section_id: currentAsgn.section_id,
          period: periodStr,
          period_count: periodCount,
          date: sessionDate,
          display_type: displayType,
          latitude: geo.latitude,
          longitude: geo.longitude,
          accuracy_m: geo.accuracy_m,
          geofence_radius_m: 100.0
        })
      });
      await fetchSessionDetails(response.session_id);
      fetchHistoricalSessions();
      fetchCurrentClass();
      setIsProjectorOpen(true);
      setToast({ 
        message: `Session started for ${periodStr}! (${periodCount} Period${periodCount > 1 ? 's' : ''} credit)`, 
        type: 'success' 
      });
    } catch (err: any) {
      setToast({ message: getInstitutionalErrorMessage(err, 'Failed to start session'), type: 'error' });
    } finally {
      setIsStartingSession(false);
    }
  };

  const handleSwitchAssignedClass = async (targetAsgn: TeacherAssignment) => {
    if (!targetAsgn) return;
    setSelectedAssignment(targetAsgn);

    // If active session is already for this exact subject & section, no reload needed
    if (
      activeSession &&
      activeSession.subject_id === targetAsgn.subject_id &&
      activeSession.section_id === targetAsgn.section_id
    ) {
      return;
    }

    setIsStartingSession(true);
    setIsProjectorOpen(false);
    setIsManualOpen(false);
    setRosterSearch('');
    setRosterFilter('ALL');

    try {
      // 1. Look for an existing session in allHistoricalSessions for this class today
      const todayDate = todayStr;
      const todayClassSessions = allHistoricalSessions.filter(
        s => s.subject_id === targetAsgn.subject_id &&
             s.section_id === targetAsgn.section_id &&
             s.session_date === todayDate
      );

      let sessionToLoad = todayClassSessions.find(s => s.status === 'OPEN') || todayClassSessions[0];

      // Fallback: any open session for this class regardless of date
      if (!sessionToLoad) {
        sessionToLoad = allHistoricalSessions.find(
          s => s.subject_id === targetAsgn.subject_id &&
               s.section_id === targetAsgn.section_id &&
               s.status === 'OPEN'
        );
      }

      let targetSessionId = sessionToLoad?.session_id;

      // 2. If no existing session found for today, automatically start / resume via backend
      if (!targetSessionId) {
        const geo = await getFacultyGeolocation();
        const periodStr = formatPeriodsString(selectedPeriods);
        const periodCount = selectedPeriods.length;

        const response: any = await apiRequest('/teacher/sessions/start', {
          method: 'POST',
          body: JSON.stringify({
            subject_id: targetAsgn.subject_id,
            section_id: targetAsgn.section_id,
            period: periodStr,
            period_count: periodCount,
            date: todayDate,
            display_type: displayType,
            latitude: geo.latitude,
            longitude: geo.longitude,
            accuracy_m: geo.accuracy_m,
            geofence_radius_m: 100.0
          })
        });
        targetSessionId = response.session_id;
      }

      // 3. Eagerly load full session details & roster
      if (targetSessionId) {
        await fetchSessionDetails(targetSessionId);
        await fetchHistoricalSessions();
        await fetchCurrentClass();
        setToast({
          message: `Switched to ${targetAsgn.subject_name} (${targetAsgn.section_name})`,
          type: 'success'
        });
      }
    } catch (err: any) {
      console.error('Failed to switch class session:', err);
      setToast({
        message: getInstitutionalErrorMessage(err, 'Failed to switch class session'),
        type: 'error'
      });
    } finally {
      setIsStartingSession(false);
    }
  };

  const handleOpenProjector = async (sessionId: number) => {
    await fetchSessionDetails(sessionId);
    setIsProjectorOpen(true);
  };

  const handleLockSessionFromPanel = async (sessionId: number) => {
    try {
      const res: any = await apiRequest(`/teacher/sessions/${sessionId}/lock`, { method: 'POST' });
      if (res?.warning) {
        setToast({ message: res.warning, type: 'warning' });
      } else {
        setToast({ message: 'Attendance session locked successfully and records committed.', type: 'success' });
      }
      await fetchSessionDetails(sessionId);
      await fetchHistoricalSessions();
      await fetchCurrentClass();
    } catch (err: any) {
      setToast({ message: getInstitutionalErrorMessage(err, 'Lock failed'), type: 'error' });
    }
  };

  const handleOneTapStart = async () => {
    if (!currentClassInfo) return;
    if (currentClassInfo.existing_session_id) {
      await fetchSessionDetails(currentClassInfo.existing_session_id);
      if (currentClassInfo.session_status === 'OPEN') {
        setIsProjectorOpen(true);
      } else {
        setActiveTab('today');
        setToast({ message: `Session #${currentClassInfo.existing_session_id} is locked. Unlock it to edit.`, type: 'warning' });
      }
      return;
    }

    if (!currentClassInfo.assignment) {
      setToast({ message: 'No timetable assignment found for current time.', type: 'warning' });
      return;
    }

    setIsStartingSession(true);
    try {
      const geo = await getFacultyGeolocation();
      const periodLabel = currentClassInfo.detected_period || 'Period 1';
      const response: any = await apiRequest('/teacher/sessions/start', {
        method: 'POST',
        body: JSON.stringify({
          subject_id: currentClassInfo.assignment.subject_id,
          section_id: currentClassInfo.assignment.section_id,
          period: periodLabel,
          date: currentClassInfo.current_date,
          display_type: displayType,
          latitude: geo.latitude,
          longitude: geo.longitude,
          accuracy_m: geo.accuracy_m,
          geofence_radius_m: 100.0
        })
      });
      await fetchSessionDetails(response.session_id);
      fetchHistoricalSessions();
      fetchCurrentClass();
      setIsProjectorOpen(true);
      setToast({ message: `Session started for ${periodLabel}!`, type: 'success' });
    } catch (err: any) {
      setToast({ message: getInstitutionalErrorMessage(err, 'Failed to start session'), type: 'error' });
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
      await fetchSessionDetails(activeSession.session_id);
      await fetchHistoricalSessions();
      await fetchCurrentClass();
    } catch (err: any) {
      setToast({ message: getInstitutionalErrorMessage(err, 'Lock failed'), type: 'error' });
    }
  };

  const handleUnlockSession = async (sessionId: number) => {
    try {
      await apiRequest(`/teacher/sessions/${sessionId}/unlock`, { method: 'POST' });
      setToast({ message: 'Session unlocked for editing!', type: 'success' });
      fetchSessionDetails(sessionId);
      fetchHistoricalSessions();
    } catch (err: any) {
      setToast({ message: getInstitutionalErrorMessage(err, 'Unlock failed'), type: 'error' });
    }
  };

  const handleFetchUnmarkedStudents = async () => {
    if (!activeSession) return;
    try {
      const data: any = await apiRequest(`/teacher/sessions/${activeSession.session_id}/unmarked-students`);
      setUnmarkedData(data);
      setShowUnmarkedModal(true);
    } catch (err: any) {
      setToast({ message: getInstitutionalErrorMessage(err, 'Failed to fetch unmarked students'), type: 'error' });
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
          period_count: sessionPeriodCount,
          reason: 'scanner_failed',
          confirm_high_volume: true
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
      setToast({ message: getInstitutionalErrorMessage(err, 'Failed to mark present'), type: 'error' });
    }
  };

  const handleToggleStudentAttendance = async (rollNumber: string, currentStatus: string, targetSessionId?: number) => {
    const sessionToUse = targetSessionId 
      ? (activeSession?.session_id === targetSessionId ? activeSession : null) 
      : activeSession;
    const effectiveSessionId = targetSessionId || activeSession?.session_id;
    if (!effectiveSessionId) return;

    const isPresent = ['PRESENT', '1', '2', '3', '4', '5', '6', '7', '8'].includes(currentStatus);
    const nextStatus = isPresent ? 'ABSENT' : 'PRESENT';
    const sessionPeriodCount = sessionToUse?.period_count || (sessionToUse ? extractPeriodCount(sessionToUse.period) : 1);

    try {
      await apiRequest('/attendance/manual-mark', {
        method: 'POST',
        body: JSON.stringify({
          session_id: effectiveSessionId,
          roll_number: rollNumber,
          status: nextStatus,
          period_count: nextStatus === 'PRESENT' ? sessionPeriodCount : 0,
          reason: 'scanner_failed',
          confirm_high_volume: true
        })
      });
      fetchSessionDetails(effectiveSessionId);
      fetchHistoricalSessions();
      setToast({ 
        message: `${rollNumber} marked ${nextStatus}${nextStatus === 'PRESENT' ? ` (${sessionPeriodCount} Periods)` : ''}!`, 
        type: nextStatus === 'PRESENT' ? 'success' : 'warning' 
      });
    } catch (err: any) {
      setToast({ message: getInstitutionalErrorMessage(err, 'Failed to update attendance'), type: 'error' });
    }
  };

  const handleUpdateSessionPeriod = async (sessionId: number, periodCount: number, periodLabel: string) => {
    try {
      await apiRequest(`/teacher/sessions/${sessionId}/period`, {
        method: 'PUT',
        body: JSON.stringify({
          period: periodLabel,
          period_count: periodCount
        })
      });
      await fetchSessionDetails(sessionId);
      await fetchHistoricalSessions();
      setToast({
        message: `Session period updated to ${periodLabel}! All student attendance records updated to ${periodCount} periods credit.`,
        type: 'success'
      });
    } catch (err: any) {
      setToast({ message: getInstitutionalErrorMessage(err, 'Failed to update session period'), type: 'error' });
    }
  };

  const handleDeleteSession = (session: HistoricalAttendanceSession) => {
    setConfirmDeleteSession(session);
  };

  const handleCalendarDeleteSession = async (sessionId: number) => {
    try {
      const res: any = await apiRequest(`/teacher/sessions/${sessionId}`, { method: 'DELETE' });
      setToast({ message: res?.message || 'Attendance session deleted successfully!', type: 'success' });
      if (activeSession?.session_id === sessionId) {
        setActiveSession(null);
        setIsProjectorOpen(false);
        setIsManualOpen(false);
      }
      await fetchHistoricalSessions();
      await fetchCurrentClass();
      await fetchAssignedClasses();
    } catch (err: any) {
      setToast({ message: getInstitutionalErrorMessage(err, 'Failed to delete session'), type: 'error' });
    }
  };

  const handleExecuteDeleteSession = async () => {
    if (!confirmDeleteSession || isDeletingSession) return;
    setIsDeletingSession(true);
    try {
      const res: any = await apiRequest(`/teacher/sessions/${confirmDeleteSession.session_id}`, { method: 'DELETE' });
      setToast({ message: res?.message || 'Session deleted successfully!', type: 'success' });
      const deletedId = confirmDeleteSession.session_id;
      setConfirmDeleteSession(null);
      if (activeSession?.session_id === deletedId) {
        setActiveSession(null);
        setIsProjectorOpen(false);
        setIsManualOpen(false);
      }
      await fetchHistoricalSessions();
      await fetchCurrentClass();
      await fetchAssignedClasses();
    } catch (err: any) {
      setToast({ message: getInstitutionalErrorMessage(err, 'Failed to delete session'), type: 'error' });
    } finally {
      setIsDeletingSession(false);
    }
  };

  const handleSaveClassSheet = async (asgn: TeacherAssignment) => {
    const rawVal = classSheetInputs[asgn.assignment_id] ?? (asgn.google_sheet_id || '');
    setSavingAssignmentId(asgn.assignment_id);
    try {
      const res: any = await apiRequest(`/teacher/assignments/${asgn.assignment_id}/sheet`, {
        method: 'PUT',
        body: JSON.stringify({ google_sheet_id: rawVal })
      });
      setAssignments(prev => prev.map(a => 
        a.assignment_id === asgn.assignment_id 
          ? { ...a, google_sheet_id: res.google_sheet_id, google_sheet_url: res.google_sheet_url } 
          : a
      ));
      setClassSheetInputs(prev => ({ ...prev, [asgn.assignment_id]: res.google_sheet_id }));
      setToast({ 
        message: res.message || `Google Sheet saved for ${asgn.subject_name} (${asgn.section_name})!`, 
        type: 'success' 
      });
      if (selectedAssignment?.assignment_id === asgn.assignment_id) {
        setSelectedAssignment(prev => prev ? { ...prev, google_sheet_id: res.google_sheet_id, google_sheet_url: res.google_sheet_url } : null);
      }
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to save Google Sheet ID', type: 'error' });
    } finally {
      setSavingAssignmentId(null);
    }
  };

  const handleSyncClassSheetRoster = async (asgn: TeacherAssignment) => {
    const sheetId = classSheetInputs[asgn.assignment_id] || asgn.google_sheet_id;
    if (!sheetId) {
      setToast({ message: `Please enter a Google Sheet URL or ID for ${asgn.section_name} first.`, type: 'warning' });
      return;
    }
    setSyncingAssignmentId(asgn.assignment_id);
    try {
      const res: any = await apiRequest('/teacher/sync-roster-from-sheet', {
        method: 'POST',
        body: JSON.stringify({
          assignment_id: asgn.assignment_id,
          section_id: asgn.section_id,
          google_sheet_id: sheetId
        })
      });
      setReconciliationModalData(res);
      setToast({ message: res.message || `Reconciliation & sync completed for ${asgn.section_name}!`, type: 'success' });
      await fetchAssignedClasses();
      if (activeSession && activeSession.section_id === asgn.section_id) {
        fetchSessionDetails(activeSession.session_id);
      }
    } catch (err: any) {
      setToast({ message: err.message || `Failed to reconcile & sync students for ${asgn.section_name}`, type: 'error' });
    } finally {
      setSyncingAssignmentId(null);
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
      setReconciliationModalData(res);
      setToast({ message: res.message || 'Student roster & attendance successfully reconciled from Google Sheet!', type: 'success' });
      await fetchAssignedClasses();
      if (activeSession) {
        fetchSessionDetails(activeSession.session_id);
      }
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to reconcile students from Google Sheet', type: 'error' });
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

  // Server-authoritative today IST
  const serverToday = useMemo(() => currentClassInfo?.current_date || getTodayIST(), [currentClassInfo]);

  // Normalized calendar events derived deterministically from backend data + synthesized active session
  const calendarAllEvents = useMemo(() => {
    const sessionMap = new Map<number, HistoricalAttendanceSession>();
    for (const s of allHistoricalSessions) {
      if (s && s.session_id) {
        sessionMap.set(s.session_id, s);
      }
    }
    if (activeSession && activeSession.session_id) {
      const existing = sessionMap.get(activeSession.session_id);
      sessionMap.set(activeSession.session_id, {
        session_id: activeSession.session_id,
        subject_id: activeSession.subject_id,
        subject_name: activeSession.subject_name || existing?.subject_name || '',
        subject_code: activeSession.subject_code || existing?.subject_code || '',
        section_id: activeSession.section_id,
        section_name: activeSession.section_name || existing?.section_name || '',
        period: activeSession.period || existing?.period || 'Period 1',
        period_count: activeSession.period_count || existing?.period_count || 1,
        session_date: activeSession.session_date || existing?.session_date || serverToday,
        status: activeSession.status || existing?.status || 'OPEN',
        total_students: activeSession.total_students ?? existing?.total_students ?? enrolledStudents.length,
        present_count: activeSession.present_count ?? existing?.present_count ?? 0,
        manual_count: activeSession.manual_count ?? existing?.manual_count ?? 0,
        manual_pct: activeSession.manual_pct ?? existing?.manual_pct ?? 0,
        absent_count: activeSession.absent_count ?? existing?.absent_count ?? 0,
        created_at: activeSession.created_at || existing?.created_at || new Date().toISOString()
      });
    }
    const combinedSessions = Array.from(sessionMap.values());

    return adaptSessionsToCalendarEvents(
      combinedSessions,
      assignments,
      serverToday,
      currentClassInfo?.current_time || '10:00'
    );
  }, [allHistoricalSessions, activeSession, enrolledStudents.length, assignments, serverToday, currentClassInfo]);

  const calendarEventsByDate = useMemo(() => {
    return groupEventsByDate(calendarAllEvents);
  }, [calendarAllEvents]);

  // Combined past sessions for Tab 2 (with optional date filtering)
  const displayedPastSessions = useMemo(() => {
    const sessionMap = new Map<number, HistoricalAttendanceSession>();
    for (const s of allHistoricalSessions) {
      if (s && s.session_id) {
        sessionMap.set(s.session_id, s);
      }
    }
    if (activeSession && activeSession.session_id) {
      const existing = sessionMap.get(activeSession.session_id);
      sessionMap.set(activeSession.session_id, {
        session_id: activeSession.session_id,
        subject_id: activeSession.subject_id,
        subject_name: activeSession.subject_name || existing?.subject_name || '',
        subject_code: activeSession.subject_code || existing?.subject_code || '',
        section_id: activeSession.section_id,
        section_name: activeSession.section_name || existing?.section_name || '',
        period: activeSession.period || existing?.period || 'Period 1',
        period_count: activeSession.period_count || existing?.period_count || 1,
        session_date: activeSession.session_date || existing?.session_date || serverToday,
        status: activeSession.status || existing?.status || 'OPEN',
        total_students: activeSession.total_students ?? existing?.total_students ?? enrolledStudents.length,
        present_count: activeSession.present_count ?? existing?.present_count ?? 0,
        manual_count: activeSession.manual_count ?? existing?.manual_count ?? 0,
        manual_pct: activeSession.manual_pct ?? existing?.manual_pct ?? 0,
        absent_count: activeSession.absent_count ?? existing?.absent_count ?? 0,
        created_at: activeSession.created_at || existing?.created_at || new Date().toISOString()
      });
    }
    let list = Array.from(sessionMap.values());
    if (pastSessionsDateFilter && pastSessionsDateFilter.trim()) {
      const cleanFilter = pastSessionsDateFilter.trim();
      list = list.filter(s => s.session_date?.trim() === cleanFilter);
    }
    return list.sort((a, b) => {
      if (a.session_date !== b.session_date) {
        return (b.session_date || '').localeCompare(a.session_date || '');
      }
      return (b.created_at || '').localeCompare(a.created_at || '');
    });
  }, [allHistoricalSessions, activeSession, enrolledStudents.length, pastSessionsDateFilter, serverToday]);

  // Calendar Action Handlers
  const handleCalendarStartAttendance = async (event: TeacherClassEvent) => {
    if (isStartingSession) return;
    const isPast = event.date < serverToday;

    if (event.sessionId) {
      await fetchSessionDetails(event.sessionId);
      if (event.sessionStatus === 'OPEN') {
        if (isPast) {
          // Rule 30: Past classes open the attendance roster console directly without projector QR
          setActiveTab('today');
          setToast({ 
            message: `Opened past attendance session for ${event.date} (${event.periodLabel}).`, 
            type: 'success' 
          });
        } else {
          setIsProjectorOpen(true);
        }
      } else {
        setActiveTab('today');
        setToast({ message: `Session #${event.sessionId} is locked. Unlock it below to modify attendance.`, type: 'warning' });
      }
      return;
    }

    const asgn = assignments.find(a => a.subject_id === event.subjectId && a.section_id === event.sectionId);
    if (asgn) {
      setSelectedAssignment(asgn);
      setSelectedPeriods([event.periodNumber]);
      setSelectedDate(event.date);
      
      setIsStartingSession(true);
      try {
        const geo = await getFacultyGeolocation();
        const response: any = await apiRequest('/teacher/sessions/start', {
          method: 'POST',
          body: JSON.stringify({
            subject_id: asgn.subject_id,
            section_id: asgn.section_id,
            period: event.periodLabel || `Period ${event.periodNumber}`,
            period_count: event.periodCount || 1,
            date: event.date,
            display_type: isPast ? 'laptop' : displayType,
            latitude: geo.latitude,
            longitude: geo.longitude,
            accuracy_m: geo.accuracy_m,
            geofence_radius_m: 100.0
          })
        });
        await fetchSessionDetails(response.session_id);
        fetchHistoricalSessions();
        fetchCurrentClass();

        if (isPast) {
          setActiveTab('today');
          setToast({ 
            message: `Past attendance session initialized for ${event.date} (${event.periodLabel}). You may now record attendance.`, 
            type: 'success' 
          });
        } else {
          setIsProjectorOpen(true);
          setToast({ 
            message: `Attendance session launched for ${event.subjectName} (${event.sectionName})!`, 
            type: 'success' 
          });
        }
      } catch (err: any) {
        setToast({ message: getInstitutionalErrorMessage(err, 'Failed to start session'), type: 'error' });
      } finally {
        setIsStartingSession(false);
      }
    } else {
      setToast({ message: 'No matching faculty assignment found for this class.', type: 'warning' });
    }
  };

  const handleCalendarOpenRosterDetails = async (event: TeacherClassEvent) => {
    if (event.sessionId) {
      await fetchSessionDetails(event.sessionId);
      setActiveTab('today');
    } else {
      setToast({ 
        message: event.date < serverToday 
          ? 'Attendance has not been recorded for this class yet. Click "Take Past Attendance" to begin.'
          : 'Attendance has not been initiated for this class yet. Click "Start Attendance" to launch.', 
        type: 'warning' 
      });
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f7f9fe] to-[#ecf1fb] text-[#17233c] -m-0 pb-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">
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

        {/* Global Toolbar Actions & Academic Year Selection */}
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <select
            value={academicYear}
            onChange={(e) => setAcademicYear(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-extrabold text-[#001e40] focus:outline-none focus:ring-2 focus:ring-[#2f53d7] shadow-sm"
          >
            <option value="2025-26">Academic Year 2025–26</option>
            <option value="2024-25">Academic Year 2024–25</option>
          </select>

          <button
            onClick={() => setIsExcelRegisterOpen(true)}
            className="px-3.5 py-2 bg-[#2f53d7] hover:bg-[#203db0] text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 shadow-sm transition active:scale-95"
            title="Open Excel Register"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-300" /> Class Register
          </button>

          {(selectedAssignment?.google_sheet_url || teacherGSheetUrl) && (
            <a
              href={selectedAssignment?.google_sheet_url || teacherGSheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold rounded-xl text-xs flex items-center gap-1.5 transition shadow-sm"
              title={selectedAssignment?.google_sheet_url ? `Open Google Sheet for ${selectedAssignment.subject_code} (${selectedAssignment.section_name})` : "Open Google Sheet"}
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
      <div className="flex bg-slate-100/80 p-1 rounded-2xl border border-slate-200 gap-1 overflow-x-auto scrollbar-none">
        <button
          onClick={() => setActiveTab('calendar')}
          className={`flex-1 py-2.5 px-3 rounded-xl text-xs font-extrabold transition-all flex items-center justify-center gap-2 shrink-0 ${
            activeTab === 'calendar'
              ? 'bg-white text-[#2f53d7] shadow-sm font-black'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Calendar className="w-4 h-4" /> My Classes (Calendar)
        </button>

        <button
          onClick={() => setActiveTab('today')}
          className={`flex-1 py-2.5 px-3 rounded-xl text-xs font-extrabold transition-all flex items-center justify-center gap-2 shrink-0 ${
            activeTab === 'today'
              ? 'bg-white text-[#2f53d7] shadow-sm font-black'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Camera className="w-4 h-4" /> Live Session Console
          {activeSession && activeSession.status === 'OPEN' && (
            <span className="w-2 h-2 rounded-full bg-emerald-500 motion-safe:animate-ping motion-reduce:hidden ml-1" />
          )}
        </button>

        <button
          onClick={() => {
            setActiveTab('historical');
            fetchHistoricalSessions();
          }}
          className={`flex-1 py-2.5 px-3 rounded-xl text-xs font-extrabold transition-all flex items-center justify-center gap-2 shrink-0 ${
            activeTab === 'historical'
              ? 'bg-white text-[#2f53d7] shadow-sm font-black'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <History className="w-4 h-4" /> Past Sessions & Edits
          {allHistoricalSessions.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-blue-100 text-[#2f53d7] text-[10px] font-bold">
              {allHistoricalSessions.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('defaulters')}
          className={`flex-1 py-2.5 px-3 rounded-xl text-xs font-extrabold transition-all flex items-center justify-center gap-2 shrink-0 ${
            activeTab === 'defaulters'
              ? 'bg-white text-[#2f53d7] shadow-sm font-black'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <ShieldAlert className="w-4 h-4 text-amber-600" /> Defaulter Lists & Alerts
        </button>

        <button
          onClick={() => setActiveTab('settings')}
          className={`flex-1 py-2.5 px-3 rounded-xl text-xs font-extrabold transition-all flex items-center justify-center gap-2 shrink-0 ${
            activeTab === 'settings'
              ? 'bg-white text-[#2f53d7] shadow-sm font-black'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <FileSpreadsheet className="w-4 h-4 text-emerald-600" /> Google Sheet Settings
        </button>
      </div>

      {/* TAB 0: MY CLASSES (CALENDAR WORKSPACE) */}
      {activeTab === 'calendar' && (
        <TeacherCalendarContainer
          eventsByDate={calendarEventsByDate}
          allEvents={calendarAllEvents}
          todayIST={serverToday}
          allottedClasses={assignments}
          isLoading={isLoadingInitial}
          currentClassInfo={currentClassInfo}
          isStartingSession={isStartingSession}
          onStartAttendance={handleCalendarStartAttendance}
          onLockSession={handleLockSessionFromPanel}
          onOpenProjector={handleOpenProjector}
          onUnlockSession={handleUnlockSession}
          onOpenRosterDetails={handleCalendarOpenRosterDetails}
          onOpenExcelRegister={() => setIsExcelRegisterOpen(true)}
          onOpenReports={() => window.location.href = '/reports'}
          onViewAssignments={() => setActiveTab('today')}
          onTakePreviousClass={() => setActiveTab('historical')}
          onToggleStudentAttendance={handleToggleStudentAttendance}
          initialSelectedDate={selectedDate}
          activeSessionId={activeSession?.session_id}
          onUpdateSessionPeriod={handleUpdateSessionPeriod}
          onDeleteSession={handleCalendarDeleteSession}
        />
      )}

      {/* TAB 1: TODAY'S LIVE ATTENDANCE */}
      {activeTab === 'today' && (
        isLoadingInitial ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-sm flex flex-col items-center justify-center space-y-3">
            <RefreshCw className="w-8 h-8 text-[#15347e] animate-spin" />
            <p className="text-sm font-bold text-slate-700">Loading attendance status...</p>
          </div>
        ) : (
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

                {/* Session Actions: Start New / Change Periods & Lock Toggle */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setActiveSession(null)}
                    className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-slate-200 border border-white/20 rounded-xl text-xs font-bold transition flex items-center gap-1.5"
                    title="Change class or select different periods"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Select Periods / New
                  </button>

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

              {/* Manual Attendance Anomaly Alert Banner (15% Amber, 30% Red) */}
              {(activeSession.manual_pct ?? 0) >= 15 && (
                <div className={`p-3.5 rounded-xl border flex items-start gap-3 shadow-lg ${
                  (activeSession.manual_pct ?? 0) >= 30
                    ? 'bg-rose-500/20 border-rose-500/50 text-rose-100 ring-1 ring-rose-500/40'
                    : 'bg-amber-500/20 border-amber-500/50 text-amber-100 ring-1 ring-amber-500/40'
                }`}>
                  <AlertTriangle className={`w-5 h-5 shrink-0 mt-0.5 ${
                    (activeSession.manual_pct ?? 0) >= 30 ? 'text-rose-400' : 'text-amber-400'
                  }`} />
                  <div className="text-xs space-y-1">
                    <div className="font-black text-sm flex items-center gap-2">
                      <span>{(activeSession.manual_pct ?? 0) >= 30 ? 'CRITICAL: High Manual Attendance (>30%)' : 'High Manual Attendance Flag (≥15%)'}</span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-black/30 font-bold">
                        {activeSession.manual_count || 0} marked manually ({activeSession.manual_pct}%)
                      </span>
                    </div>
                    <p className="text-slate-200">
                      {(activeSession.manual_pct ?? 0) >= 30
                        ? 'Excessive manual marks exceed institutional tolerance. This session has been tagged RED for administrative and HOD audit.'
                        : 'Manual attendance exceeds 15% of present students. Please verify student physical attendance in room.'}
                    </p>
                  </div>
                </div>
              )}

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
                  {(activeSession.manual_count ?? 0) > 0 && (
                    <span className={`font-bold ${
                      (activeSession.manual_pct ?? 0) >= 30
                        ? 'text-rose-400'
                        : (activeSession.manual_pct ?? 0) >= 15
                        ? 'text-amber-400'
                        : 'text-blue-300'
                    }`}>
                      📝 Manual (M): {activeSession.manual_count} ({activeSession.manual_pct}%)
                    </span>
                  )}
                  <span className="text-rose-400 font-bold">❌ Absent: {absentCount}</span>
                  <span className="text-slate-400 font-bold">👥 Total: {enrolledStudents.length}</span>
                </div>
              </div>

              {/* Action Buttons Bar: Projector QR, Manual Search, Absence Callout */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                <button
                  onClick={() => setIsProjectorOpen(true)}
                  disabled={activeSession.status !== 'OPEN'}
                  className="py-3.5 px-4 bg-gradient-to-r from-amber-400 via-[#FF9F0A] to-orange-500 hover:from-amber-300 hover:to-orange-400 disabled:opacity-50 text-[#001e40] font-black text-sm rounded-xl transition shadow-xl ring-2 ring-amber-400/40 flex items-center justify-center gap-2 active:scale-98"
                >
                  <Maximize2 className="w-5 h-5 text-[#001e40]" /> Projector QR (Broadcast)
                </button>

                <button
                  onClick={() => setIsManualOpen(true)}
                  className="py-3.5 px-4 bg-white/10 hover:bg-white/20 text-white font-bold text-xs rounded-xl border border-white/20 transition flex items-center justify-center gap-2"
                >
                  <Search className="w-4 h-4 text-cyan-300" /> Manual Search / Mark
                </button>

                <button
                  onClick={handleFetchUnmarkedStudents}
                  className="py-3.5 px-4 bg-white/10 hover:bg-white/20 text-white font-bold text-xs rounded-xl border border-white/20 transition flex items-center justify-center gap-2"
                >
                  <Users className="w-4 h-4 text-amber-300" /> Absence Callout
                </button>

                <Link
                  to="/qr-size-test"
                  className="py-2.5 px-3 bg-purple-500/15 hover:bg-purple-500/25 text-purple-200 border border-purple-500/30 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 sm:col-span-3"
                  title="Test and calibrate minimum effective QR display size for your classroom"
                >
                  <Sparkles className="w-4 h-4 text-purple-300" />
                  <span>Calibrate Classroom QR Size & Readability (Back-Row Room Test)</span>
                </Link>
              </div>

              {/* Class Switcher for Multiple Assignments */}
              {assignments.length > 1 && (
                <div className="pt-2 border-t border-white/10 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <span className="text-slate-300 font-medium">Switch to another assigned class:</span>
                  <div className="flex items-center gap-2">
                    <select
                      value={selectedAssignment?.assignment_id || ''}
                      onChange={async (e) => {
                        const targetId = Number(e.target.value);
                        const found = assignments.find(a => a.assignment_id === targetId);
                        if (found) {
                          await handleSwitchAssignedClass(found);
                        }
                      }}
                      disabled={isStartingSession}
                      className="bg-white/10 border border-white/20 rounded-xl px-3 py-1.5 text-xs font-bold text-white focus:outline-none cursor-pointer disabled:opacity-50"
                    >
                      {assignments.map(a => (
                        <option key={a.assignment_id} value={a.assignment_id} className="text-slate-900">
                          {a.subject_name} ({a.section_name})
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => {
                        if (selectedAssignment) {
                          handleSwitchAssignedClass(selectedAssignment);
                        }
                      }}
                      disabled={isStartingSession}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs transition disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {isStartingSession ? (
                        <>
                          <RefreshCw className="w-3 h-3 animate-spin" />
                          <span>Switching...</span>
                        </>
                      ) : (
                        <span>Switch</span>
                      )}
                    </button>
                  </div>
                </div>
              )}

            </div>
          ) : (
            /* Start New Attendance Session Card (When Idle) */
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-5">
              
              {/* Timetable Recommendation or Bell Schedule Status */}
              {currentClassInfo && currentClassInfo.is_class_active && currentClassInfo.has_assignment ? (
                <div className="bg-gradient-to-r from-[#001e40] to-[#15347e] rounded-xl p-4 text-white flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-md">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-blue-400/20 text-blue-200 font-mono text-[11px] font-bold flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                        IST {currentClassInfo.current_time} • {currentClassInfo.detected_period}
                      </span>
                      <span className="text-xs text-amber-300 font-bold flex items-center gap-1">
                        ● LIVE NOW
                      </span>
                    </div>
                    <h4 className="font-bold text-base text-white">
                      {currentClassInfo.assignment.subject_name} ({currentClassInfo.assignment.section_name})
                    </h4>
                    {currentClassInfo.existing_session_id && (
                      <div className="text-xs text-slate-300 font-medium flex items-center gap-2">
                        <span>Session #{currentClassInfo.existing_session_id} ({currentClassInfo.session_status})</span>
                        {currentClassInfo.total_enrolled > 0 && (
                          <span className="text-emerald-300 font-bold">
                            • {currentClassInfo.present_count} / {currentClassInfo.total_enrolled} Marked
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={handleOneTapStart}
                    disabled={isStartingSession}
                    className="px-5 py-2.5 bg-[#FF9F0A] hover:bg-[#e08b05] text-[#001e40] font-black text-xs uppercase tracking-wider rounded-xl transition shadow flex items-center gap-1.5 shrink-0"
                  >
                    <Zap className="w-4 h-4" /> {currentClassInfo.existing_session_id ? 'Continue Live Attendance' : '1-Tap Start Attendance'}
                  </button>
                </div>
              ) : currentClassInfo && currentClassInfo.is_break ? (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-900 flex items-center gap-3 shadow-sm">
                  <div className="p-2 rounded-xl bg-amber-100 text-amber-700">
                    <Clock className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm text-amber-950">
                      {currentClassInfo.break_label || 'Break Time'} (IST {currentClassInfo.current_time})
                    </h4>
                    <p className="text-xs text-amber-800">
                      No active class in session during bell break. Attendance starts when the next class period begins.
                    </p>
                  </div>
                </div>
              ) : currentClassInfo && !currentClassInfo.is_class_active && (
                <div className="bg-slate-100 border border-slate-200 rounded-xl p-4 text-slate-700 flex items-center gap-3 shadow-sm">
                  <div className="p-2 rounded-xl bg-slate-200 text-slate-600">
                    <Clock className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm text-[#001e40]">
                      Outside Scheduled Class Hours (IST {currentClassInfo.current_time})
                    </h4>
                    <p className="text-xs text-slate-500">
                      College hours are 09:30 AM to 05:00 PM. No class is currently in session.
                    </p>
                  </div>
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
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-bold text-slate-700">Assigned Class / Subject</label>
                    <button
                      type="button"
                      onClick={fetchAssignedClasses}
                      className="text-[11px] text-[#2f53d7] hover:underline font-bold flex items-center gap-1"
                      title="Reload assigned classes from institutional server"
                    >
                      <RefreshCw className="w-3 h-3" /> Refresh Classes
                    </button>
                  </div>

                  {assignments.length === 0 ? (
                    <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-2">
                      <div className="flex items-center gap-2 font-bold text-amber-800">
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                        <span>No classes currently assigned to your faculty profile</span>
                      </div>
                      <p className="text-slate-600">
                        Attendance sessions require at least one assigned class. Ask your Administrator to assign your subject & section in the Admin System Setup Hub, or refresh if an assignment was just created.
                      </p>
                      <button
                        type="button"
                        onClick={fetchAssignedClasses}
                        className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-xs flex items-center gap-1.5 transition shadow-xs"
                      >
                        <RefreshCw className="w-3.5 h-3.5" /> Refresh Assigned Classes
                      </button>
                    </div>
                  ) : (
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
                  )}
                </div>

                {selectedAssignment && (
                  <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-blue-50/80 border border-blue-100 text-xs">
                    <div className="flex items-center gap-2">
                      <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
                      <div>
                        <span className="font-bold text-[#15347e]">Dedicated Class Register: </span>
                        <span className="font-mono text-[11px] text-slate-700">{selectedAssignment.excel_file_name || `Register_${selectedAssignment.assignment_id}.xlsx`}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleDownloadMyClassRegister(selectedAssignment.assignment_id, selectedAssignment.excel_file_name)}
                        className="px-3 py-1.5 bg-white hover:bg-emerald-50 text-emerald-700 font-bold rounded-lg border border-emerald-200 text-xs flex items-center gap-1.5 shadow-xs transition"
                        title="Download official live Excel attendance register for this class"
                      >
                        <Download className="w-3.5 h-3.5" /> Download Register (.xlsx)
                      </button>
                      {selectedAssignment.google_sheet_url && (
                        <a
                          href={selectedAssignment.google_sheet_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1.5 bg-white hover:bg-blue-50 text-[#2f53d7] font-bold rounded-lg border border-blue-200 text-xs flex items-center gap-1.5 shadow-xs transition"
                        >
                          <ExternalLink className="w-3.5 h-3.5" /> Class Google Sheet
                        </a>
                      )}
                    </div>
                  </div>
                )}

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

                {/* Part A.5: Display Medium Selector (Projector | Phone Screen | Laptop) */}
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                  <label className="text-xs font-bold text-slate-800 flex items-center justify-between">
                    <span>Display Medium (QR Target)</span>
                    <span className="text-[10px] text-slate-500 font-semibold">Telemetry Display Tag</span>
                  </label>
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    {[
                      { id: 'projector', label: '📽️ Projector', desc: 'Classroom Wall' },
                      { id: 'phone_screen', label: '📱 Phone Screen', desc: 'Mobile Screen' },
                      { id: 'laptop', label: '💻 Laptop', desc: 'Desk / Podium' }
                    ].map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setDisplayType(m.id as any)}
                        className={`p-2 rounded-xl border text-center transition cursor-pointer ${
                          displayType === m.id
                            ? 'bg-[#15347e] text-white border-[#15347e] shadow-sm font-bold'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        <div className="text-xs font-bold">{m.label}</div>
                        <div className={`text-[10px] ${displayType === m.id ? 'text-blue-200' : 'text-slate-400'}`}>
                          {m.desc}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <button
                onClick={() => handleStartSession(todayStr)}
                disabled={isStartingSession}
                className="w-full py-3.5 snist-btn-primary font-bold text-sm flex items-center justify-center gap-2 shadow-md transition active:scale-98"
              >
                <Maximize2 className="w-5 h-5" /> 
                {isStartingSession ? 'Starting Session...' : 'Start Attendance Session & Launch Projector QR'}
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
                          <div className="flex items-center gap-1.5">
                            <h5 className="text-xs font-bold text-slate-900 truncate">{s.name}</h5>
                            {s.is_manual && (
                              <span 
                                className="px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 text-[10px] font-mono font-black border border-amber-300 shrink-0"
                                title={`Manually marked: ${s.manual_reason || 'scanner_failed'}`}
                              >
                                (M)
                              </span>
                            )}
                          </div>
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
        )
      )}

      {/* TAB 2: PAST SESSIONS & HISTORICAL EDITS */}
      {activeTab === 'historical' && (
        <div className="space-y-5">
          
          {/* Date Picker & Selector Card */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <h3 className="font-heading text-lg font-bold text-[#15347e]">
                  Past & Recorded Sessions
                </h3>
                <p className="text-xs text-slate-500 font-medium">
                  Review historical attendance or unlock prior sessions for authorized edits.
                </p>
              </div>

              {/* View Mode Controls: All Sessions vs Date Filter */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPastSessionsDateFilter('')}
                  className={`px-3 py-1.5 text-xs font-bold rounded-xl transition ${
                    !pastSessionsDateFilter
                      ? 'bg-[#15347e] text-white shadow-sm'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  All Recorded ({allHistoricalSessions.length})
                </button>

                <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1">
                  <Calendar className="w-3.5 h-3.5 text-[#2f53d7]" />
                  <input
                    type="date"
                    value={pastSessionsDateFilter}
                    onChange={(e) => setPastSessionsDateFilter(e.target.value)}
                    className="bg-transparent font-mono font-bold text-xs text-slate-800 outline-none"
                    placeholder="Filter date..."
                  />
                  {pastSessionsDateFilter && (
                    <button
                      type="button"
                      onClick={() => setPastSessionsDateFilter('')}
                      className="text-slate-400 hover:text-slate-700 p-0.5"
                      title="Clear date filter"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={fetchHistoricalSessions}
                  className="p-1.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 transition"
                  title="Reload sessions from institutional server"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Quick Session Launcher for Past Date */}
            <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs">
              <span className="text-slate-600 font-medium">
                Need to record attendance for {pastSessionsDateFilter || selectedDate || serverToday}?
              </span>
              <button
                onClick={() => handleStartSession(pastSessionsDateFilter || selectedDate || serverToday)}
                className="px-4 py-2 snist-btn-primary font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-sm"
              >
                <Camera className="w-3.5 h-3.5" /> Start / Unlock Session for {pastSessionsDateFilter || selectedDate || serverToday}
              </button>
            </div>
          </div>

          {/* Historical Sessions List */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-heading text-sm font-bold text-[#15347e] flex items-center gap-2">
                <span>{pastSessionsDateFilter ? `Recorded Sessions for ${pastSessionsDateFilter}` : 'All Recorded Sessions'}</span>
                {pastSessionsDateFilter && (
                  <button
                    type="button"
                    onClick={() => setPastSessionsDateFilter('')}
                    className="text-[11px] font-bold text-[#2f53d7] hover:underline"
                  >
                    (Show All)
                  </button>
                )}
              </h4>
              <span className="text-xs font-bold text-[#2f53d7]">
                {displayedPastSessions.length} session(s) {pastSessionsDateFilter ? `found on ${pastSessionsDateFilter}` : 'total'}
              </span>
            </div>

            {displayedPastSessions.length === 0 ? (
              <div className="p-8 text-center bg-slate-50 border border-slate-200 rounded-2xl text-slate-500 text-xs space-y-2">
                <p>No sessions recorded {pastSessionsDateFilter ? `for ${pastSessionsDateFilter}` : 'yet'}. Use the button above to record attendance.</p>
                {pastSessionsDateFilter && (
                  <button
                    type="button"
                    onClick={() => setPastSessionsDateFilter('')}
                    className="px-3 py-1.5 bg-blue-50 text-[#2f53d7] font-bold rounded-lg text-xs hover:bg-blue-100 transition"
                  >
                    View All {allHistoricalSessions.length} Recorded Sessions
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {displayedPastSessions.map((hs) => {
                  const pct = hs.total_students > 0 ? Math.round(((hs.present_count || 0) / hs.total_students) * 100) : 0;
                  return (
                    <div 
                      key={hs.session_id} 
                      className="p-4 bg-slate-50 hover:bg-slate-100/80 border border-slate-200 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-[#15347e]">{hs.subject_name}</span>
                          {hs.subject_code && (
                            <span className="font-mono text-xs text-slate-500 font-bold">({hs.subject_code})</span>
                          )}
                          <span className="px-2 py-0.5 bg-white border border-slate-300 text-slate-800 text-[11px] font-bold rounded-lg">{hs.section_name}</span>
                          <span className={`px-2 py-0.5 rounded-lg text-[10px] font-extrabold uppercase flex items-center gap-1 ${
                            hs.status === 'OPEN'
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                              : 'bg-slate-200 text-slate-800 border border-slate-300'
                          }`}>
                            {hs.status === 'OPEN' ? (
                              <>
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                <span>OPEN</span>
                              </>
                            ) : (
                              <>
                                <Lock className="w-3 h-3 text-slate-600" />
                                <span>LOCKED</span>
                              </>
                            )}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-1 flex flex-wrap items-center gap-3 font-medium">
                          <span>📅 <strong>{hs.session_date}</strong></span>
                          <span>⏱️ <strong>{hs.period}</strong></span>
                          <span>👥 <strong className="text-emerald-700">{hs.present_count}</strong>/{hs.total_students} Present ({pct}%)</span>
                          {(hs.manual_count ?? 0) > 0 && (
                            <span className="text-amber-700 font-bold">📝 {hs.manual_count} Manual ({hs.manual_pct}%)</span>
                          )}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {hs.status === 'LOCKED' ? (
                          <>
                            <button
                              onClick={() => handleUnlockSession(hs.session_id)}
                              className="px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 transition shadow-sm"
                            >
                              <Unlock className="w-3.5 h-3.5" /> Unlock / Edit
                            </button>
                            <button
                              onClick={async () => {
                                await fetchSessionDetails(hs.session_id);
                                setActiveTab('today');
                              }}
                              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 text-xs font-bold rounded-xl flex items-center gap-1 transition"
                            >
                              <Search className="w-3.5 h-3.5" /> View Roster
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => handleLockSessionFromPanel(hs.session_id)}
                              className="px-3.5 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 transition shadow-sm"
                            >
                              <Lock className="w-3.5 h-3.5" /> Lock Attendance
                            </button>
                            <button
                              onClick={() => {
                                fetchSessionDetails(hs.session_id);
                                setIsProjectorOpen(true);
                              }}
                              className="px-3.5 py-2 snist-btn-primary text-xs font-bold flex items-center gap-1.5"
                            >
                              <Maximize2 className="w-3.5 h-3.5" /> Projector QR
                            </button>
                            <button
                              onClick={async () => {
                                await fetchSessionDetails(hs.session_id);
                                setActiveTab('today');
                              }}
                              className="px-3 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold rounded-xl flex items-center gap-1 transition"
                            >
                              <Search className="w-3.5 h-3.5" /> Roster
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => handleDeleteSession(hs)}
                          className="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 hover:border-rose-300 text-xs font-bold rounded-xl flex items-center gap-1.5 transition shadow-sm active:scale-95"
                          title="Delete this attendance session"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                          <span>Delete</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>
      )}

      {/* TAB 3: GOOGLE SHEET SETTINGS */}
      {activeTab === 'settings' && (
        <div className="space-y-6">
          {/* Top Banner */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h3 className="font-heading text-lg font-bold text-[#15347e] flex items-center gap-2">
                  <FileSpreadsheet className="w-5 h-5 text-emerald-600" /> Class-Wise Google Sheet Management
                </h3>
                <span className="px-2.5 py-0.5 rounded-full bg-blue-50 text-[#2f53d7] font-extrabold text-xs border border-blue-200 flex items-center gap-1">
                  <Layers className="w-3 h-3" />
                  {assignments.length} Assigned Class{assignments.length === 1 ? '' : 'es'}
                </span>
              </div>
              <p className="text-xs text-[#6a7894] mt-1.5 max-w-2xl">
                Configure dedicated Google Sheets for each assigned class section. Attendance marked in your sessions will automatically update each class's respective Google Sheet in real-time.
              </p>
            </div>
            {assignments.some(a => a.google_sheet_url) && (
              <span className="px-3 py-1.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl font-bold text-xs flex items-center gap-1.5 shrink-0 shadow-sm">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Multi-Class Sync Active
              </span>
            )}
          </div>

          {/* Class-Wise Google Sheets Cards */}
          {assignments.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500 text-sm">
              <FileSpreadsheet className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <p className="font-bold text-slate-700">No classes assigned yet</p>
              <p className="text-xs text-slate-500 mt-1">
                Contact your administrator or configure your class allotments in the Admin Operations Center to attach Google Sheets to your classes.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {assignments.map((asgn) => {
                const rawVal = classSheetInputs[asgn.assignment_id] ?? (asgn.google_sheet_id || '');
                const isConfigured = Boolean(asgn.google_sheet_id);
                const isSaving = savingAssignmentId === asgn.assignment_id;
                const isSyncing = syncingAssignmentId === asgn.assignment_id;

                return (
                  <div 
                    key={asgn.assignment_id}
                    className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4 hover:border-slate-300 transition"
                  >
                    {/* Class Info Header */}
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-[#2f53d7] font-bold shrink-0">
                          <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="font-heading text-sm font-bold text-[#15347e]">
                              {asgn.subject_name}
                            </h4>
                            <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-extrabold text-[11px] font-mono">
                              {asgn.subject_code}
                            </span>
                            <span className="px-2 py-0.5 rounded-md bg-blue-100 text-[#2f53d7] font-extrabold text-[11px]">
                              Section {asgn.section_name}
                            </span>
                          </div>
                          <p className="text-[11px] text-[#6a7894] mt-0.5">
                            {asgn.year || '3rd Year'} • Dept: {asgn.department || 'CSE'}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {isConfigured ? (
                          <>
                            <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg font-extrabold text-[10px] flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                              LIVE LINKED
                            </span>
                            {asgn.google_sheet_url && (
                              <a
                                href={asgn.google_sheet_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 transition shadow-sm"
                              >
                                <ExternalLink className="w-3.5 h-3.5" /> Open Live Sheet
                              </a>
                            )}
                          </>
                        ) : (
                          <span className="px-2.5 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg font-extrabold text-[10px] flex items-center gap-1">
                            <AlertCircle className="w-3 h-3 text-amber-500" />
                            NOT LINKED
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Sheet URL or ID Input */}
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Google Sheet URL or Spreadsheet ID for {asgn.subject_name} ({asgn.section_name})
                      </label>
                      <input
                        type="text"
                        value={rawVal}
                        onChange={(e) => setClassSheetInputs(prev => ({ ...prev, [asgn.assignment_id]: e.target.value }))}
                        placeholder={`e.g. https://docs.google.com/spreadsheets/d/.../edit or Spreadsheet ID for ${asgn.section_name}`}
                        className="snist-input w-full text-xs font-mono"
                      />
                      <p className="text-[11px] text-slate-500 mt-1">
                        Paste the browser URL for this class's Google Sheet. Attendance for <strong>{asgn.section_name}</strong> will automatically write into this sheet.
                      </p>
                    </div>

                    {/* Configured Tag */}
                    {asgn.google_sheet_id && (
                      <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-2 text-xs">
                        <div className="truncate">
                          <span className="font-bold text-slate-500">Configured ID: </span>
                          <span className="font-mono font-bold text-[#2f53d7]">{asgn.google_sheet_id}</span>
                        </div>
                        <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-extrabold text-[10px] shrink-0">
                          ACTIVE
                        </span>
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex flex-wrap items-center gap-3 pt-1">
                      <button
                        onClick={() => handleSaveClassSheet(asgn)}
                        disabled={isSaving}
                        className="px-5 py-2.5 snist-btn-primary font-bold text-xs flex items-center gap-2 shadow-sm transition disabled:opacity-50"
                      >
                        <FileSpreadsheet className={`w-4 h-4 ${isSaving ? 'animate-spin' : ''}`} />
                        {isSaving ? 'Saving...' : `Save Sheet for ${asgn.section_name}`}
                      </button>

                      <button
                        onClick={() => handleSyncClassSheetRoster(asgn)}
                        disabled={isSyncing}
                        title="Bi-directional reconciliation: auto-provisions missing students, emails credentials, backfills app attendance, and repairs missing marks in sheet"
                        className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl flex items-center gap-2 shadow-sm transition disabled:opacity-50"
                      >
                        <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                        {isSyncing ? `Reconciling Attendance & Roster...` : `Reconcile Attendance & Sync Sheet`}
                      </button>

                      {asgn.has_excel_register && (
                        <button
                          onClick={() => handleDownloadMyClassRegister(asgn.assignment_id, asgn.excel_file_name)}
                          className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl flex items-center gap-2 transition border border-slate-200 ml-auto"
                          title="Download Class Excel Register"
                        >
                          <Download className="w-3.5 h-3.5 text-slate-500" />
                          <span>Download Excel Register</span>
                        </button>
                      )}
                    </div>

                    {/* Reconciliation Explanation Banner */}
                    <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50/60 border border-emerald-100 rounded-xl text-[11px] text-emerald-800">
                      <Sparkles className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>
                        <strong>Smart Reconciliation Engine:</strong> If a student is in your Google Sheet but missing from the app, they are automatically enrolled and emailed credentials. Past attendance is synchronized bi-directionally without overwriting data.
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Section 2: General Faculty Fallback Sheet */}
          <div className="bg-slate-50/80 rounded-2xl border border-slate-200 p-5 space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <h4 className="font-heading text-sm font-bold text-slate-800 flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-slate-500" /> Faculty Default Fallback Sheet (Optional)
                </h4>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Used as a fallback for any attendance sessions that do not have a class-specific sheet configured above.
                </p>
              </div>
              {teacherGSheetUrl && (
                <a
                  href={teacherGSheetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs rounded-xl flex items-center gap-1.5 transition shrink-0"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Open Default Sheet
                </a>
              )}
            </div>

            <div className="space-y-3">
              <input
                type="text"
                value={teacherGSheetId}
                onChange={(e) => setTeacherGSheetId(e.target.value)}
                placeholder="e.g. Default faculty spreadsheet URL or ID"
                className="snist-input w-full text-xs font-mono bg-white"
              />
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={handleSaveTeacherGSheet}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white font-bold text-xs rounded-xl flex items-center gap-2 shadow-sm transition"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" /> Save Fallback Sheet
                </button>
                {teacherGSheetId && (
                  <span className="text-xs text-slate-500 font-mono">
                    Active Fallback: <strong className="text-slate-700">{teacherGSheetId}</strong>
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: DEFAULTER LISTS & EARLY-WARNING INTERVENTIONS */}
      {activeTab === 'defaulters' && (
        <FacultyDefaultersTab 
          assignments={assignments} 
          onToast={(msg, type) => setToast({ message: msg, type: type === 'warning' ? 'error' : type })} 
        />
      )}



      {/* Manual Search Modal */}
      {isManualOpen && activeSession && (
        <ManualSearchModal
          sessionId={activeSession.session_id}
          students={activeSession.students}
          initialPeriodCount={activeSession.period_count || extractPeriodCount(activeSession.period) || 4}
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
          initialPeriodCount={activeSession.period_count || extractPeriodCount(activeSession.period) || 1}
          onClose={() => {
            setIsProjectorOpen(false);
            fetchSessionDetails(activeSession.session_id);
            fetchCurrentClass();
            fetchHistoricalSessions();
          }}
          onLockSession={handleLockSession}
        />
      )}

      {/* Delete Session Confirmation Modal (Global) */}
      {confirmDeleteSession && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-rose-100 flex items-center justify-center text-rose-600 shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-heading text-base font-black text-[#001e40]">Delete Attendance Session?</h4>
                <p className="text-xs text-slate-500 font-medium">This will permanently remove this session and all its records.</p>
              </div>
            </div>

            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Subject:</span>
                <span className="font-bold text-slate-800">{confirmDeleteSession.subject_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Section:</span>
                <span className="font-bold text-slate-800">{confirmDeleteSession.section_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Date & Period:</span>
                <span className="font-bold text-slate-800">{confirmDeleteSession.session_date} — {confirmDeleteSession.period}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Status:</span>
                <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${
                  confirmDeleteSession.status === 'OPEN' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                }`}>
                  {confirmDeleteSession.status}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Records Affected:</span>
                <span className="font-black text-rose-600">{confirmDeleteSession.present_count} student(s) marked present</span>
              </div>
            </div>

            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 text-xs text-rose-700">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>Warning: This action cannot be undone. All scans and records for this session will be permanently deleted.</span>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteSession(null)}
                disabled={isDeletingSession}
                className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 text-xs font-bold hover:bg-slate-100 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteDeleteSession}
                disabled={isDeletingSession}
                className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition flex items-center gap-1.5 shadow-md shadow-rose-600/20 disabled:opacity-50"
              >
                {isDeletingSession ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Confirm Delete</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Attendance & Roster Reconciliation Summary Modal */}
      {reconciliationModalData && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 space-y-5 animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-start justify-between pb-3 border-b border-slate-100 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-emerald-100 flex items-center justify-center text-emerald-700 shrink-0">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-heading text-lg font-bold text-slate-900">
                    Attendance & Roster Reconciliation Report
                  </h3>
                  <p className="text-xs text-slate-500 font-medium">
                    Section: <strong className="text-slate-800">{reconciliationModalData.section_name || 'Class Section'}</strong> • Google Sheet Reconciled
                  </p>
                </div>
              </div>
              <button
                onClick={() => setReconciliationModalData(null)}
                className="text-slate-400 hover:text-slate-700 p-1.5 rounded-full hover:bg-slate-100 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Body */}
            <div className="space-y-4 overflow-y-auto pr-1 flex-1">
              {/* Stat Cards Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3.5 text-center">
                  <div className="flex items-center justify-center text-slate-500 mb-1">
                    <Users className="w-4 h-4" />
                  </div>
                  <div className="text-2xl font-black text-slate-800">{reconciliationModalData.total_roster ?? 0}</div>
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mt-0.5">Sheet Roster</div>
                </div>

                <div className="bg-emerald-50 border border-emerald-200/80 rounded-2xl p-3.5 text-center">
                  <div className="flex items-center justify-center text-emerald-600 mb-1">
                    <UserPlus className="w-4 h-4" />
                  </div>
                  <div className="text-2xl font-black text-emerald-700">{reconciliationModalData.new_students_provisioned ?? 0}</div>
                  <div className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider mt-0.5">Provisioned & Emailed</div>
                </div>

                <div className="bg-blue-50 border border-blue-200/80 rounded-2xl p-3.5 text-center">
                  <div className="flex items-center justify-center text-blue-600 mb-1">
                    <ArrowDownCircle className="w-4 h-4" />
                  </div>
                  <div className="text-2xl font-black text-blue-700">{reconciliationModalData.attendance_sheet_to_app_backfilled ?? 0}</div>
                  <div className="text-[10px] font-bold text-blue-800 uppercase tracking-wider mt-0.5">Sheet ➔ App Marks</div>
                </div>

                <div className="bg-purple-50 border border-purple-200/80 rounded-2xl p-3.5 text-center">
                  <div className="flex items-center justify-center text-purple-600 mb-1">
                    <ArrowUpCircle className="w-4 h-4" />
                  </div>
                  <div className="text-2xl font-black text-purple-700">{reconciliationModalData.attendance_app_to_sheet_repaired ?? 0}</div>
                  <div className="text-[10px] font-bold text-purple-800 uppercase tracking-wider mt-0.5">App ➔ Sheet Marks</div>
                </div>
              </div>

              {/* Status Banner */}
              <div className="p-3.5 bg-emerald-50/70 border border-emerald-200 rounded-2xl flex items-start gap-3">
                <Sparkles className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                <div className="text-xs text-emerald-900 leading-relaxed">
                  <strong>Verification Invariant Satisfied:</strong> All sheet discrepancies have been reconciled. Newly provisioned students have been assigned canonical SAP IDs, sent their magic onboarding credentials, and are active to attend future classes immediately.
                </div>
              </div>

              {/* Newly Provisioned Students Section */}
              {reconciliationModalData.provisioned_students_details && reconciliationModalData.provisioned_students_details.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="font-heading text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                      <UserPlus className="w-3.5 h-3.5 text-emerald-600" /> Newly Added & Notified Students ({reconciliationModalData.provisioned_students_details.length})
                    </h4>
                    <span className="text-[10px] text-emerald-700 bg-emerald-100 font-bold px-2 py-0.5 rounded-full">
                      Credentials Dispatched
                    </span>
                  </div>
                  <div className="border border-slate-200 rounded-xl overflow-hidden max-h-40 overflow-y-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-100/80 text-slate-600 font-bold text-[11px] sticky top-0">
                        <tr>
                          <th className="py-2 px-3">Roll Number</th>
                          <th className="py-2 px-3">Full Name</th>
                          <th className="py-2 px-3">Institutional Email</th>
                          <th className="py-2 px-3 text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {reconciliationModalData.provisioned_students_details.map((st: any, idx: number) => (
                          <tr key={idx} className="hover:bg-slate-50 transition">
                            <td className="py-2 px-3 font-mono font-bold text-[#15347e]">{st.roll_number}</td>
                            <td className="py-2 px-3 text-slate-800 font-medium">{st.name}</td>
                            <td className="py-2 px-3 font-mono text-slate-500 text-[11px]">{st.email}</td>
                            <td className="py-2 px-3 text-right">
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                                <Mail className="w-3 h-3" /> Active & Sent
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Reconciled Dates Tags */}
              {reconciliationModalData.reconciled_dates && reconciliationModalData.reconciled_dates.length > 0 && (
                <div className="space-y-1.5">
                  <h4 className="font-heading text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-blue-600" /> Dates Cross-Checked ({reconciliationModalData.reconciled_dates.length})
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {reconciliationModalData.reconciled_dates.map((dt: string, i: number) => (
                      <span key={i} className="px-2 py-0.5 bg-slate-100 text-slate-700 font-mono text-[10px] font-bold rounded border border-slate-200">
                        {dt}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Detailed Action Audit Log */}
              {reconciliationModalData.reconciliation_log && reconciliationModalData.reconciliation_log.length > 0 && (
                <div className="space-y-1.5">
                  <h4 className="font-heading text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5 text-slate-500" /> Action Audit Trail ({reconciliationModalData.reconciliation_log.length} actions)
                  </h4>
                  <div className="p-3 bg-slate-900 text-slate-200 rounded-xl font-mono text-[11px] max-h-36 overflow-y-auto space-y-1">
                    {reconciliationModalData.reconciliation_log.map((log: string, idx: number) => (
                      <div key={idx} className="flex items-start gap-2">
                        <span className="text-emerald-400 select-none">✓</span>
                        <span className="leading-tight">{log}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="pt-3 border-t border-slate-100 flex items-center justify-between shrink-0">
              <span className="text-xs text-slate-500">
                Ready for next session. Students can take attendance normally.
              </span>
              <button
                type="button"
                onClick={() => setReconciliationModalData(null)}
                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-xl transition shadow-sm"
              >
                Close Report
              </button>
            </div>
          </div>
        </div>
      )}

      </div>
    </div>
  );
};
