import { useState, useEffect } from 'react';
import { apiRequest } from '../../services/api';
import { getBindingState } from '../../services/binding';

export function useStudentPortalData() {
  const [profile, setProfile] = useState<any>(null);
  const [summary, setSummary] = useState<any>(null);
  const [compliance, setCompliance] = useState<any>(null);
  const [warnings, setWarnings] = useState<any[]>([]);
  const [schedule, setSchedule] = useState<any>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [isDeviceBound, setIsDeviceBound] = useState<boolean | null>(null);

  const fetchStudentData = async () => {
    try {
      const [profileRes, summaryRes, scheduleRes] = await Promise.allSettled([
        apiRequest<any>('/student/profile'),
        apiRequest<any>('/student/attendance-summary'),
        apiRequest<any>('/student/today-schedule')
      ]);

      if (profileRes.status === 'fulfilled') {
        const prof = profileRes.value;
        setProfile(prof);
        if (prof?.roll_number) {
          try {
            const comp = await apiRequest<any>(`/compliance/student/${prof.roll_number}`);
            setCompliance(comp);
          } catch (cErr) {
            console.warn('Compliance analytics fetch skipped:', cErr);
          }

          try {
            const warnData = await apiRequest<any>('/student/warnings');
            if (warnData?.warnings) {
              setWarnings(warnData.warnings);
            }
          } catch (wErr) {
            console.warn('Student warnings fetch skipped:', wErr);
          }
        }
      }
      if (summaryRes.status === 'fulfilled') {
        setSummary(summaryRes.value);
      }
      if (scheduleRes.status === 'fulfilled') {
        setSchedule(scheduleRes.value);
      }

      if (profileRes.status === 'rejected') {
        const errObj: any = profileRes.reason;
        setToast({ message: errObj?.message || 'Could not connect to attendance server. Please ensure backend is running.', type: 'error' });
      }
    } catch (err: any) {
      setToast({ message: err.message || 'Error loading student profile', type: 'error' });
    }
  };

  useEffect(() => {
    // Pre-warm WASM scanner runtime in background so scanning starts instantly on modal open
    import('../../services/wasmScanner').then(m => m.initWasmScanner()).catch(() => {});
    fetchStudentData();
  }, []);

  const checkDeviceBinding = async () => {
    try {
      const storedUser = localStorage.getItem('user');
      const roll = profile?.roll_number || (storedUser ? JSON.parse(storedUser).roll_number : undefined);
      const serverBoundKeyId = profile?.bound_device_key_id ?? (profile?.has_active_binding === false ? null : undefined);
      const state = await getBindingState(roll, {
        verifyWithServer: true,
        serverBoundKeyId
      });
      setIsDeviceBound(state === 'enrolled');
    } catch {
      setIsDeviceBound(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const storedUser = localStorage.getItem('user');
        const roll = profile?.roll_number || (storedUser ? JSON.parse(storedUser).roll_number : undefined);
        const serverBoundKeyId = profile?.bound_device_key_id ?? (profile?.has_active_binding === false ? null : undefined);
        const state = await getBindingState(roll, {
          verifyWithServer: true,
          serverBoundKeyId
        });
        if (!cancelled) {
          setIsDeviceBound(state === 'enrolled');
        }
      } catch {
        if (!cancelled) setIsDeviceBound(false);
      }
    })();
    return () => { cancelled = true; };
  }, [profile?.roll_number, profile?.has_active_binding, profile?.bound_device_key_id]);

  // Derived metrics calculations
  const compAgg = compliance?.aggregate;
  const rawTotalSessions = 
    (typeof compAgg?.total_effective_sessions === 'number' && !Number.isNaN(compAgg.total_effective_sessions)) ? compAgg.total_effective_sessions :
    (typeof compAgg?.total_conducted_sessions === 'number' && !Number.isNaN(compAgg.total_conducted_sessions)) ? compAgg.total_conducted_sessions :
    (typeof summary?.total_conducted === 'number' && !Number.isNaN(summary.total_conducted)) ? summary.total_conducted :
    null;

  const presentCount = 
    (typeof compAgg?.total_present_sessions === 'number' && !Number.isNaN(compAgg.total_present_sessions)) ? compAgg.total_present_sessions :
    (typeof summary?.total_present === 'number' && !Number.isNaN(summary.total_present)) ? summary.total_present :
    0;

  const hasValidDenominator = rawTotalSessions !== null && rawTotalSessions >= 0;
  
  let absentCount: number | null = null;
  let displayAbsent: string | number = '—';

  if (hasValidDenominator) {
    absentCount = Math.max(0, rawTotalSessions - presentCount);
    displayAbsent = absentCount;
  } else {
    displayAbsent = '—';
  }

  const effectiveTotal = hasValidDenominator ? rawTotalSessions : presentCount;
  const hasConducted = effectiveTotal > 0;

  const computedPercent = hasConducted && effectiveTotal > 0 ? Math.round((presentCount / effectiveTotal) * 100) : 0;
  const overallPercent = 
    (typeof compAgg?.aggregate_percentage === 'number' && !Number.isNaN(compAgg.aggregate_percentage))
      ? compAgg.aggregate_percentage
      : (typeof summary?.overall_percentage === 'number' && !Number.isNaN(summary.overall_percentage)
          ? summary.overall_percentage
          : computedPercent);

  const isInsufficientData = compAgg?.band === 'INSUFFICIENT_DATA' || (!hasConducted);
  const displayOverall = compAgg?.aggregate_display || `${overallPercent}%`;
  const currentBand = isInsufficientData 
    ? 'INSUFFICIENT_DATA' 
    : (compAgg?.band || (overallPercent >= 75 ? 'ELIGIBLE' : (overallPercent >= 65 ? 'CONDONABLE' : 'DETAINED')));
  const myAttendance = schedule?.my_attendance;
  const isMarkedToday = Boolean(myAttendance?.is_marked);

  // Recovery Trajectory computations
  const coursesBelow75 = compliance?.courses?.filter((c: any) => c.band !== 'INSUFFICIENT_DATA' && (c.attendance_percentage ?? 0) < 75) || [];
  const unrecoverableCourse = !isInsufficientData ? compliance?.courses?.find((c: any) => c.band !== 'INSUFFICIENT_DATA' && c.is_recoverable === false) : null;
  const primaryRecoveryCourse = !isInsufficientData ? coursesBelow75.find((c: any) => c.is_recoverable !== false && ((c.classes_needed || 0) > 0 || (c.projected_classes_needed || 0) > 0)) : null;
  const aggClassesNeeded = !isInsufficientData ? (compliance?.aggregate_classes_needed || 0) : 0;
  const isAggRecoverable = compliance?.aggregate_is_recoverable ?? true;

  // Circle SVG calculations (radius = 45, circumference = 2 * pi * 45 = 282.7)
  const strokeDashoffset = 282.7 - (282.7 * Math.min(100, Math.max(0, overallPercent || 0))) / 100;

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const activeSession = schedule?.active_session;
  const isLiveSession = Boolean(activeSession?.session_id && (activeSession?.status === 'LIVE IN-CLASS' || activeSession?.status?.includes('Live')));
  const primarySubject = activeSession?.subject_name || schedule?.schedule?.[0]?.subject_name || (isLiveSession ? 'Active Class Session' : 'No Active Class Session');
  const primaryTeacher = activeSession?.teacher_name || schedule?.schedule?.[0]?.teacher_name || (isLiveSession ? 'Class Faculty' : 'Faculty Standby');
  const primaryRoom = activeSession?.room || schedule?.schedule?.[0]?.room || (profile?.section ? `${profile.section} Classroom` : 'Classroom');
  const periodCount = myAttendance?.period_count || activeSession?.period_count || schedule?.schedule?.[0]?.period_count || 4;

  const handleScanComplete = (scanResult?: any) => {
    fetchStudentData();
    if (scanResult) {
      setSchedule((prev: any) => ({
        ...prev,
        my_attendance: {
          ...prev?.my_attendance,
          is_marked: true,
          marked_at: scanResult.session_date || 'Today',
          subject_name: scanResult.subject_name || prev?.my_attendance?.subject_name || primarySubject,
          period_count: scanResult.period_count || prev?.my_attendance?.period_count || 4,
        }
      }));
      const addedCount = scanResult.status === 'SUCCESS' ? 1 : 0;
      setSummary((prev: any) => {
        if (!prev) return prev;
        const newPresent = (prev.total_present ?? 0) + addedCount;
        const newConducted = Math.max(prev.total_conducted ?? 0, newPresent);
        return {
          ...prev,
          total_present: newPresent,
          total_conducted: newConducted,
          total_absent: Math.max(0, newConducted - newPresent),
          overall_percentage: newConducted > 0 ? Math.round((newPresent / newConducted) * 100) : 100
        };
      });
      setCompliance((prev: any) => {
        if (!prev?.aggregate) return prev;
        const newPresent = (prev.aggregate.total_present_sessions ?? 0) + addedCount;
        const newEffective = Math.max(prev.aggregate.total_effective_sessions ?? prev.aggregate.total_conducted_sessions ?? 0, newPresent);
        const newPct = newEffective > 0 ? Math.round((newPresent / newEffective) * 100) : 100;
        return {
          ...prev,
          aggregate: {
            ...prev.aggregate,
            total_present_sessions: newPresent,
            total_effective_sessions: newEffective,
            total_conducted_sessions: newEffective,
            aggregate_percentage: newPct,
            aggregate_display: `${newPct}%`,
            band: newPct >= 75 ? 'ELIGIBLE' : (newPct >= 65 ? 'CONDONABLE' : 'DETAINED')
          }
        };
      });
    }
    fetchStudentData();
    setToast({ message: 'Attendance recorded successfully!', type: 'success' });
  };

  return {
    profile,
    summary,
    compliance,
    warnings,
    schedule,
    toast,
    setToast,
    isDeviceBound,
    checkDeviceBinding,
    fetchStudentData,
    compAgg,
    presentCount,
    displayAbsent,
    hasConducted,
    isInsufficientData,
    displayOverall,
    currentBand,
    myAttendance,
    isMarkedToday,
    unrecoverableCourse,
    primaryRecoveryCourse,
    aggClassesNeeded,
    isAggRecoverable,
    strokeDashoffset,
    getGreeting,
    isLiveSession,
    primarySubject,
    primaryTeacher,
    primaryRoom,
    periodCount,
    handleScanComplete,
  };
}
