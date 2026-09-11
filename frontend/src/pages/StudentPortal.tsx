import React, { useState, useEffect } from 'react';
import { apiRequest } from '../services/api';
import { 
  Calendar, Clock, MapPin, User, PieChart, Home, ChevronRight, X, 
  BookOpen, Camera, CheckCircle, ShieldCheck, AlertTriangle, Sparkles, AlertOctagon, Info 
} from 'lucide-react';
// Lazy-load heavy html5-qrcode scanner modal so students do not download it on initial portal load
const StudentClassScannerModal = React.lazy(() => 
  import('../components/StudentClassScannerModal').then(m => ({ default: m.StudentClassScannerModal }))
);
import { RawSessionAuditModal } from '../components/RawSessionAuditModal';
import { Toast } from '../components/Toast';
import { SmartInstallCard } from '../components/SmartInstallCard';

export const StudentPortal: React.FC = () => {
  const [profile, setProfile] = useState<any>(null);
  const [summary, setSummary] = useState<any>(null);
  const [compliance, setCompliance] = useState<any>(null);
  const [warnings, setWarnings] = useState<any[]>([]);
  const [schedule, setSchedule] = useState<any>(null);
  const [showSubjectModal, setShowSubjectModal] = useState<boolean>(false);
  const [showClassScannerModal, setShowClassScannerModal] = useState<boolean>(false);
  const [isRawAuditOpen, setIsRawAuditOpen] = useState<boolean>(false);
  const [auditCourseId, setAuditCourseId] = useState<number | null>(null);
  const [activeNavTab, setActiveNavTab] = useState<'home' | 'attendance' | 'timetable'>('home');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    fetchStudentData();
    const params = new URLSearchParams(window.location.search);
    if (params.get('scan') === 'true') {
      setShowClassScannerModal(true);
    }
  }, []);

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

  const compAgg = compliance?.aggregate;
  const isInsufficientData = compAgg?.band === 'INSUFFICIENT_DATA' || (compAgg && compAgg.total_effective_sessions < 3);
  const hasConducted = compAgg ? (compAgg.total_effective_sessions > 0) : ((summary?.total_conducted ?? 0) > 0);
  const overallPercent = compAgg?.aggregate_percentage ?? (hasConducted ? (summary?.overall_percentage ?? 0) : 0);
  const displayOverall = isInsufficientData ? '—' : (compAgg?.aggregate_display ?? `${overallPercent}%`);
  const currentBand = isInsufficientData 
    ? 'INSUFFICIENT_DATA' 
    : (compAgg?.band || (overallPercent >= 75 ? 'ELIGIBLE' : (overallPercent >= 65 ? 'CONDONABLE' : 'DETAINED')));
  const presentCount = compAgg?.total_present_sessions ?? (summary?.total_present ?? 0);
  const absentCount = compAgg 
    ? Math.max(0, compAgg.total_effective_sessions - compAgg.total_present_sessions) 
    : (summary?.total_absent ?? 0);
  const myAttendance = schedule?.my_attendance;
  const isMarkedToday = Boolean(myAttendance?.is_marked);

  // Recovery Trajectory computations
  const coursesBelow75 = compliance?.courses?.filter((c: any) => c.band !== 'INSUFFICIENT_DATA' && (c.attendance_percentage ?? 0) < 75) || [];
  const unrecoverableCourse = !isInsufficientData ? compliance?.courses?.find((c: any) => c.band !== 'INSUFFICIENT_DATA' && c.is_recoverable === false) : null;
  const primaryRecoveryCourse = !isInsufficientData ? coursesBelow75.find((c: any) => c.is_recoverable !== false && ((c.classes_needed || 0) > 0 || (c.projected_classes_needed || 0) > 0)) : null;
  const aggClassesNeeded = !isInsufficientData ? (compliance?.aggregate_classes_needed || 0) : 0;
  const isAggRecoverable = compliance?.aggregate_is_recoverable ?? true;

  // Circle SVG calculations (radius = 45, circumference = 2 * pi * 45 = 282.7)
  const strokeDashoffset = isInsufficientData ? 0 : 282.7 - (282.7 * (overallPercent || 0)) / 100;

  return (
    <div className="bg-[#FBFBFD] text-[#1b1b1d] min-h-screen flex flex-col font-sans">
      
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Top Header */}
      <header className="sticky top-0 w-full z-30 flex justify-between items-center px-6 h-16 bg-white/80 backdrop-blur-md border-b border-[#D2D2D7]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-[#001e40] text-white flex items-center justify-center font-bold text-sm">
            {profile?.name ? profile.name.charAt(0) : 'S'}
          </div>
          <div>
            <h2 className="font-bold text-base text-[#001e40] font-geist m-0 leading-tight">SNIST ERP</h2>
            <p className="text-[11px] font-medium text-[#5e5e63]">Academic Portal</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-3 py-1 bg-[#F5F5F7] border border-[#D2D2D7] text-[#001e40] text-xs font-mono font-bold rounded-full">
            {profile?.roll_number || 'STUDENT'}
          </span>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 p-4 sm:p-6 max-w-6xl mx-auto w-full space-y-6 pb-24 md:pb-8">
        
        {/* Greeting */}
        <section className="py-2">
          <p className="text-xs font-bold text-[#5e5e63] uppercase tracking-wider mb-1" id="current-date">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()}
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold text-[#001e40] font-geist">
            Good morning, {profile?.name ? profile.name.split(' ')[0] : 'Student'}
          </h1>
          <p className="text-xs text-[#5e5e63] mt-0.5">
            {profile ? `${profile.department} • ${profile.section} (${profile.year})` : 'Sreenidhi Institute of Science & Technology'}
          </p>
        </section>
 
        {/* Contextual PWA Install Promotion */}
        <SmartInstallCard />

        {/* Early-Warning & Attendance Recovery Banner (Empathetic & Action-Oriented) */}
        {isInsufficientData ? (
          <div className="rounded-2xl p-4 bg-gradient-to-r from-[#001e40] via-[#093268] to-[#15347e] text-white border border-blue-400/30 shadow-md flex items-start gap-3.5">
            <Info className="w-6 h-6 text-blue-300 shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h4 className="font-black text-sm text-white">Semester Underway: Classes in Progress</h4>
                <span className="px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-200 font-mono text-[10px] font-bold border border-blue-400/30">
                  Orientation Phase
                </span>
              </div>
              <p className="text-xs text-blue-100 mt-1 leading-relaxed">
                Only {compAgg?.total_effective_sessions ?? 0} session(s) conducted so far. JNTUH compliance bands and defaulter evaluation activate after 3 sessions to prevent premature detention flags.
              </p>
            </div>
          </div>
        ) : hasConducted && unrecoverableCourse ? (
          <div className="rounded-2xl p-4 bg-gradient-to-r from-rose-950 via-rose-900 to-[#1b1b1d] text-white border border-rose-500/40 shadow-md flex items-start gap-3.5">
            <AlertOctagon className="w-6 h-6 text-rose-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h4 className="font-black text-sm text-white">Detention Risk Alert: {unrecoverableCourse.course_name} ({unrecoverableCourse.course_code})</h4>
                <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 font-mono text-[10px] font-bold border border-rose-500/40">
                  Not Recoverable
                </span>
              </div>
              <p className="text-xs text-rose-100/90 mt-1 leading-relaxed">
                With {unrecoverableCourse.sessions_remaining} classes remaining, your attendance can reach at most {unrecoverableCourse.max_possible_percentage?.toFixed(1) || unrecoverableCourse.projected_percentage?.toFixed(1)}% (below the 75% requirement). Please consult your academic counselor or HOD immediately to initiate the condonation review process.
              </p>
            </div>
          </div>
        ) : hasConducted && primaryRecoveryCourse ? (
          <div className="rounded-2xl p-4 bg-gradient-to-r from-[#001e40] via-[#093268] to-[#15347e] text-white border border-blue-400/30 shadow-md flex items-start gap-3.5">
            <Sparkles className="w-6 h-6 text-amber-300 shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h4 className="font-black text-sm text-white">
                  Attendance Recovery Path: Attend {primaryRecoveryCourse.classes_needed || primaryRecoveryCourse.projected_classes_needed} more consecutive classes in {primaryRecoveryCourse.course_code}
                </h4>
                <span className="px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-300 font-mono text-[10px] font-bold border border-amber-400/30">
                  Target: 75%
                </span>
              </div>
              <p className="text-xs text-blue-100 mt-1 leading-relaxed">
                You are currently at {primaryRecoveryCourse.display_percentage || `${primaryRecoveryCourse.attendance_percentage}%`}. Attending {primaryRecoveryCourse.classes_needed || primaryRecoveryCourse.projected_classes_needed} consecutive upcoming classes will bring you back into the compliant ELIGIBLE band.
              </p>
            </div>
          </div>
        ) : hasConducted && overallPercent < 75 && aggClassesNeeded > 0 && isAggRecoverable ? (
          <div className="rounded-2xl p-4 bg-gradient-to-r from-[#001e40] via-[#093268] to-[#15347e] text-white border border-blue-400/30 shadow-md flex items-start gap-3.5">
            <Sparkles className="w-6 h-6 text-amber-300 shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h4 className="font-black text-sm text-white">
                  Attendance Recovery Path: Attend {aggClassesNeeded} more classes overall
                </h4>
                <span className="px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-300 font-mono text-[10px] font-bold border border-amber-400/30">
                  Target: 75%
                </span>
              </div>
              <p className="text-xs text-blue-100 mt-1 leading-relaxed">
                Your overall semester attendance is currently {displayOverall}. Attending {aggClassesNeeded} more consecutive sessions will restore compliance.
              </p>
            </div>
          </div>
        ) : null}

        {/* Bento Grid Layout */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          
          {/* Next Class Spotlight */}
          <div className="col-span-1 md:col-span-8 bg-[#001e40] text-white rounded-2xl p-6 relative overflow-hidden shadow-sm flex flex-col justify-between min-h-[180px]">
            <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '24px 24px' }}></div>
            
            <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className={`w-2 h-2 rounded-full ${isMarkedToday ? 'bg-emerald-400' : 'bg-emerald-400 animate-pulse'}`}></span>
                  <span className="text-xs font-bold text-[#a7c8ff] uppercase tracking-wider font-mono">
                    {isMarkedToday 
                      ? `✅ Attendance Credited (${myAttendance?.period_count || 4} Periods)` 
                      : (schedule?.active_session?.status || 'Active Session (4 Periods)')}
                  </span>
                </div>
                <h3 className="text-xl sm:text-2xl font-bold font-geist mb-2 text-white">
                  Career Enhancement Training (CET)
                </h3>
                <p className="text-xs text-[#a7c8ff] flex flex-wrap items-center gap-3">
                  <span className="flex items-center gap-1"><User className="w-3.5 h-3.5" /> Mrs. N. Sowjanya</span>
                  <span className="opacity-40">•</span>
                  <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> CSE-CS Projector Lab</span>
                </p>
              </div>

              <div className="flex-shrink-0">
                <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 text-center border border-white/10 min-w-[130px]">
                  <span className="block text-[10px] font-bold text-[#a7c8ff] mb-1">
                    {isMarkedToday ? 'STATUS' : 'SESSION CREDIT'}
                  </span>
                  <span className={`block text-lg font-extrabold font-mono ${isMarkedToday ? 'text-emerald-300' : 'text-amber-300'}`}>
                    {isMarkedToday ? 'PRESENT ✅' : `${myAttendance?.period_count || 4} Periods`}
                  </span>
                </div>
              </div>
            </div>

            {profile && (
              <div className="relative z-10 pt-4 border-t border-white/10 flex items-center justify-between text-xs text-[#a7c8ff]">
                <span>Student ID: <strong className="text-white font-mono">{profile.roll_number}</strong></span>
                <span className="px-2.5 py-0.5 bg-emerald-500/20 text-emerald-300 font-bold rounded-full border border-emerald-500/30">Active Student</span>
              </div>
            )}
          </div>

          {/* Primary Action Card: Scan Classroom Projector QR / Attendance Confirmed */}
          {isMarkedToday ? (
            <div className="col-span-1 md:col-span-4 bg-gradient-to-br from-[#022c22] via-[#064e3b] to-[#047857] text-white rounded-2xl p-6 border border-emerald-500/40 shadow-sm flex flex-col justify-between relative overflow-hidden min-h-[180px]">
              <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-400/10 rounded-full blur-2xl pointer-events-none"></div>

              <div>
                <div className="flex items-center justify-between gap-2 mb-3">
                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-400/20 text-emerald-300 border border-emerald-400/40 text-[10px] font-mono font-bold flex items-center gap-1.5">
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-300" />
                    ATTENDANCE CONFIRMED
                  </span>
                  <span className="text-emerald-200 text-xs font-bold font-mono">
                    {myAttendance?.marked_at || 'IST Recorded'}
                  </span>
                </div>

                <h3 className="text-xl font-bold font-geist mb-1.5 text-white flex items-center gap-2">
                  Marked Present ✅
                </h3>
                <p className="text-xs text-emerald-100/90 leading-relaxed font-medium">
                  Verified for <strong className="text-white">{myAttendance?.subject_name || 'Career Enhancement Training (CET)'}</strong> ({myAttendance?.period_count || 4} Periods Credited).
                </p>
              </div>

              <div className="pt-4 mt-2">
                <button
                  onClick={() => setShowClassScannerModal(true)}
                  className="w-full py-3 px-4 bg-emerald-400 hover:bg-emerald-300 text-[#022c22] font-black text-xs sm:text-sm rounded-xl shadow-xl transition active:scale-98 flex items-center justify-center gap-2"
                >
                  <CheckCircle className="w-4 h-4 text-[#022c22]" /> Verified Present (View Receipt)
                </button>
                <div className="flex items-center justify-center gap-2 mt-2 text-[10px] text-emerald-200/80 font-mono">
                  <span>🔐 Device Locked</span>
                  <span>•</span>
                  <span>⚡ {myAttendance?.period_count || 4} Credits Saved</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="col-span-1 md:col-span-4 bg-gradient-to-br from-[#001e40] via-[#093268] to-[#15347e] text-white rounded-2xl p-6 border border-blue-900/40 shadow-sm flex flex-col justify-between relative overflow-hidden min-h-[180px]">
              <div className="absolute top-0 right-0 w-32 h-32 bg-[#FF9F0A]/10 rounded-full blur-2xl pointer-events-none"></div>

              <div>
                <div className="flex items-center justify-between gap-2 mb-3">
                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-mono font-bold flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    LIVE IN-CLASS
                  </span>
                  <span className="text-amber-300 text-xs font-bold">⚡ 10s Token Sync</span>
                </div>

                <h3 className="text-xl font-bold font-geist mb-1.5 text-white">
                  Class Attendance
                </h3>
                <p className="text-xs text-blue-200 leading-relaxed font-medium">
                  Scan the classroom projector screen to mark attendance for today's active periods.
                </p>
              </div>

              <div className="pt-4 mt-2">
                <button
                  onClick={() => setShowClassScannerModal(true)}
                  className="w-full py-3 px-4 bg-gradient-to-r from-amber-400 via-[#FF9F0A] to-orange-500 hover:from-amber-300 hover:to-orange-400 text-[#001e40] font-black text-xs sm:text-sm rounded-xl shadow-xl transition active:scale-98 flex items-center justify-center gap-2"
                >
                  <Camera className="w-4 h-4 text-[#001e40]" /> Open Camera Scanner
                </button>
                <div className="flex items-center justify-center gap-2 mt-2 text-[10px] text-blue-200/80 font-mono">
                  <span>🔐 Device Bound</span>
                  <span>•</span>
                  <span>⚡ Instant IST Mark</span>
                </div>
              </div>
            </div>
          )}

          {/* Attendance Overview Card */}
          <div className="col-span-1 md:col-span-5 bg-white rounded-2xl p-6 border border-[#D2D2D7] shadow-sm flex flex-col justify-between">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="font-bold text-lg text-[#001e40] font-geist leading-tight">JNTUH R25 Attendance</h3>
                <p className="text-[11px] text-[#5e5e63]">Server-Authoritative Status</p>
              </div>
              {isInsufficientData ? (
                <span className="px-2.5 py-1 bg-blue-50 text-blue-700 text-xs font-black rounded-full border border-blue-200 flex items-center gap-1">
                  ℹ️ INITIAL PHASE
                </span>
              ) : hasConducted ? (
                <span className={`px-2.5 py-1 text-xs font-black rounded-full border flex items-center gap-1 ${
                  currentBand === 'ELIGIBLE'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-300' 
                    : currentBand === 'CONDONABLE'
                    ? 'bg-amber-50 text-amber-700 border-amber-300'
                    : 'bg-rose-50 text-rose-700 border-rose-300'
                }`}>
                  {currentBand === 'ELIGIBLE' ? '✅ ELIGIBLE' : currentBand === 'CONDONABLE' ? '⚠️ CONDONABLE' : '⛔ DETAINED'}
                </span>
              ) : (
                <span className="px-2.5 py-1 bg-blue-50 text-blue-700 text-xs font-bold rounded-full border border-blue-200">
                  Ready for Class
                </span>
              )}
            </div>

            <div className="flex flex-col items-center justify-center py-2">
              <div className="relative w-32 h-32 mb-4">
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="45" fill="none" stroke="#e0dfe4" strokeWidth="8" strokeLinecap="round" />
                  <circle 
                    cx="50" 
                    cy="50" 
                    r="45" 
                    fill="none" 
                    stroke={isInsufficientData ? '#2f53d7' : (currentBand === 'ELIGIBLE' ? '#24A249' : currentBand === 'CONDONABLE' ? '#FF9F0A' : '#E22126')} 
                    strokeWidth="8" 
                    strokeDasharray="282.7" 
                    strokeDashoffset={strokeDashoffset} 
                    strokeLinecap="round" 
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-extrabold text-[#001e40] font-geist">{displayOverall}</span>
                  <span className={`text-[10px] font-black uppercase tracking-wider ${
                    isInsufficientData ? 'text-blue-700' : (currentBand === 'ELIGIBLE' ? 'text-emerald-700' : currentBand === 'CONDONABLE' ? 'text-amber-700' : 'text-rose-700')
                  }`}>
                    {isInsufficientData ? 'Initial Phase' : (hasConducted ? currentBand : 'New Session')}
                  </span>
                </div>
              </div>

              <div className="w-full grid grid-cols-2 gap-3 mt-2">
                <div className="bg-[#F5F5F7] rounded-xl p-3 text-center border border-[#D2D2D7]">
                  <span className="block text-[11px] font-bold text-[#5e5e63] mb-0.5">Present</span>
                  <span className="block text-lg font-bold text-[#24A249]">{presentCount}</span>
                </div>
                <div className="bg-[#F5F5F7] rounded-xl p-3 text-center border border-[#D2D2D7]">
                  <span className="block text-[11px] font-bold text-[#5e5e63] mb-0.5">Absent</span>
                  <span className="block text-lg font-bold text-[#E22126]">{absentCount}</span>
                </div>
              </div>

              {currentBand === 'CONDONABLE' && (
                <div className="w-full mt-2 p-2 rounded-xl bg-amber-50 border border-amber-200 text-center text-xs text-amber-900 font-semibold flex items-center justify-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span>Condonation Fine Status: <b className="uppercase">{compAgg?.condonation_status || 'Pending'}</b></span>
                </div>
              )}

              {!hasConducted && (
                <p className="text-[10px] text-center text-[#5e5e63] mt-2 font-medium">
                  Tracking begins with today's live session
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 mt-4">
              <button 
                onClick={() => setShowSubjectModal(true)}
                className="py-2.5 bg-[#F5F5F7] hover:bg-[#e0dfe4] text-[#001e40] font-bold text-xs rounded-xl transition-colors flex items-center justify-center gap-1.5"
              >
                <BookOpen className="w-3.5 h-3.5 text-[#3a5f94]" />
                Subject Breakdown
              </button>
              <button 
                onClick={() => {
                  setAuditCourseId(null);
                  setIsRawAuditOpen(true);
                }}
                className="py-2.5 bg-[#001e40] hover:bg-[#003366] text-white font-bold text-xs rounded-xl transition-colors flex items-center justify-center gap-1.5 shadow-sm"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-300" />
                Raw Audit Logs
              </button>
            </div>
          </div>

          {/* Today's Schedule List */}
          <div id="timetable-section" className="col-span-1 md:col-span-7 bg-white rounded-2xl p-6 border border-[#D2D2D7] shadow-sm flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-lg text-[#001e40] font-geist">Today's Timetable</h3>
              <button 
                onClick={() => setShowSubjectModal(true)}
                className="text-xs font-bold text-[#3a5f94] hover:underline"
              >
                Subject Overview
              </button>
            </div>

            <div className="space-y-3">
              {summary?.subjects && summary.subjects.length > 0 ? (
                summary.subjects.map((subj: any, sIdx: number) => {
                  const pct = subj.percentage ?? 0;
                  const isGood = pct >= 75;
                  const isWarn = pct >= 65 && pct < 75;
                  return (
                    <div 
                      key={sIdx} 
                      onClick={() => setShowSubjectModal(true)}
                      className="p-4 rounded-xl bg-white border border-[#D2D2D7] flex items-center justify-between hover:bg-[#F5F5F7] transition-colors cursor-pointer"
                    >
                      <div className="flex-1 mr-3">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="px-2 py-0.5 bg-[#d5e3ff] text-[#001b3c] font-bold text-[10px] rounded uppercase font-mono">
                            Period {sIdx + 1}
                          </span>
                          <span className={`px-2 py-0.5 font-bold text-[10px] rounded ${
                            isGood ? 'bg-[#34C759]/10 text-[#34C759]' : isWarn ? 'bg-[#FF9F0A]/10 text-[#FF9F0A]' : 'bg-[#E22126]/10 text-[#E22126]'
                          }`}>
                            {pct}% Attended
                          </span>
                        </div>
                        <h4 className="font-bold text-base text-[#001e40]">{subj.subject_name}</h4>
                        <p className="text-xs text-[#5e5e63] mt-0.5">
                          {subj.present} of {subj.conducted} classes attended
                        </p>
                      </div>
                      <ChevronRight className="w-5 h-5 text-[#737780]" />
                    </div>
                  );
                })
              ) : (
                <div className="p-4 rounded-xl bg-gradient-to-r from-blue-50/70 to-amber-50/40 border border-[#D2D2D7] flex items-center justify-between shadow-sm">
                  <div className="flex-1 mr-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="px-2.5 py-0.5 bg-[#001e40] text-white font-bold text-[10px] rounded uppercase font-mono tracking-wider">
                        {myAttendance?.period_count || 4} Periods Block
                      </span>
                      {isMarkedToday ? (
                        <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 font-bold text-[10px] rounded flex items-center gap-1 font-mono">
                          <CheckCircle className="w-3 h-3 text-emerald-600" />
                          Marked Present ({myAttendance?.period_count || 4} Periods)
                        </span>
                      ) : (
                        <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 font-bold text-[10px] rounded flex items-center gap-1 font-mono">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span>
                          Live In-Class
                        </span>
                      )}
                    </div>
                    <h4 className="font-bold text-base text-[#001e40]">Career Enhancement Training (CET)</h4>
                    <p className="text-xs text-[#5e5e63] mt-1 flex flex-wrap items-center gap-2 font-medium">
                      <span>Faculty: <strong className="text-slate-800">Mrs. N. Sowjanya</strong></span>
                      <span className="opacity-40">•</span>
                      <span>CSE-CS Projector Lab</span>
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className={`px-3 py-1.5 rounded-xl text-xs font-black font-mono block border ${
                      isMarkedToday 
                        ? 'bg-emerald-100 text-emerald-900 border-emerald-300' 
                        : 'bg-amber-400/20 text-amber-900 border-amber-400/30'
                    }`}>
                      {isMarkedToday ? 'Credited' : `${myAttendance?.period_count || 4} Periods`}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Official Attendance Warnings & Notices (Evidence Trail) */}
          {warnings && warnings.length > 0 && (
            <div className="col-span-1 md:col-span-12 bg-white rounded-2xl p-6 border border-[#D2D2D7] shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                <h3 className="font-bold text-base text-[#001e40] flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-600" />
                  Official Attendance Notices & Recovery Guidance ({warnings.length})
                </h3>
                <span className="text-[11px] font-medium text-slate-500">
                  Institutional record preserved at time of notice
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {warnings.map((w: any, wIdx: number) => (
                  <div key={w.id || wIdx} className="p-4 rounded-xl bg-[#F5F5F7] border border-[#D2D2D7] space-y-2.5">
                    <div className="flex justify-between items-start gap-2">
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#001e40] text-white uppercase">
                        {(w.warning_type || 'WARNING').replace(/_/g, ' ')}
                      </span>
                      <span className="text-[11px] font-mono text-slate-500 font-semibold">
                        📅 {w.issued_at ? new Date(w.issued_at).toLocaleDateString('en-IN') : 'Recent'}
                      </span>
                    </div>
                    <div className="text-xs font-bold text-slate-900">
                      Course: {w.course_name || w.course_code || 'Semester Overall'}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="px-2 py-0.5 rounded bg-rose-50 text-rose-800 font-bold border border-rose-200 text-[11px]">
                        Snapshot: {w.percentage_at_issue}% ({w.band_at_issue})
                      </span>
                      <span className="text-slate-700 text-[11px] font-bold">
                        {w.classes_needed_at_issue > 0 
                          ? `Action: Needed ${w.classes_needed_at_issue} consecutive classes`
                          : 'Action: Contact Counselor'}
                      </span>
                    </div>
                    {w.message && (
                      <p className="text-xs text-slate-700 italic bg-white p-2.5 rounded-lg border border-[#D2D2D7] mt-1">
                        "{w.message}"
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>

      </main>



      {/* Detailed Subject Breakdown Modal */}
      {showSubjectModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-lg w-full space-y-4 border border-[#D2D2D7] shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center pb-3 border-b border-[#D2D2D7]">
              <div className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-[#3a5f94]" />
                <h3 className="font-bold text-base text-[#001e40]">Subject Attendance Breakdown</h3>
              </div>
              <button 
                onClick={() => setShowSubjectModal(false)}
                className="text-[#737780] hover:text-[#001e40] p-1 rounded-full hover:bg-[#F5F5F7]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
              {compliance?.courses && compliance.courses.length > 0 ? (
                compliance.courses.map((course: any, idx: number) => {
                  const pct = course.attendance_percentage;
                  const isInsufficient = course.band === 'INSUFFICIENT_DATA';
                  const isEligible = course.band === 'ELIGIBLE';
                  const isCondonable = course.band === 'CONDONABLE';
                  const barColor = isEligible ? 'bg-[#34C759]' : isCondonable ? 'bg-[#FF9F0A]' : isInsufficient ? 'bg-[#2f53d7]' : 'bg-[#E22126]';
                  return (
                    <div 
                      key={idx} 
                      onClick={() => {
                        setAuditCourseId(course.course_id);
                        setIsRawAuditOpen(true);
                      }}
                      className="p-3.5 bg-[#F5F5F7] hover:bg-blue-50/70 transition cursor-pointer rounded-2xl border border-[#D2D2D7] space-y-2 shadow-xs"
                      title="Click to view full session-by-session audit trail"
                    >
                      <div className="flex justify-between items-start gap-2">
                        <div>
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className="px-2 py-0.5 rounded bg-[#001e40] text-white font-mono text-[10px] font-bold">
                              {course.course_code}
                            </span>
                            <span className="text-[10px] font-bold text-slate-500 uppercase">
                              {course.course_type}
                            </span>
                          </div>
                          <h4 className="font-bold text-sm text-[#001e40]">{course.course_name}</h4>
                        </div>
                        <div className="text-right shrink-0">
                          <span className={`font-mono font-black text-xs px-2 py-0.5 rounded block ${
                            isEligible ? 'bg-[#34C759]/10 text-[#34C759]' : isCondonable ? 'bg-[#FF9F0A]/10 text-[#FF9F0A]' : isInsufficient ? 'bg-blue-50 text-blue-700' : 'bg-[#E22126]/10 text-[#E22126]'
                          }`}>
                            {course.display_percentage}
                          </span>
                          <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                            {isInsufficient ? 'Initial Data' : course.band}
                          </span>
                        </div>
                      </div>

                      <div className="w-full bg-[#E5E5EA] h-2 rounded-full overflow-hidden">
                        <div 
                          className={`h-full ${barColor} rounded-full transition-all duration-500`}
                          style={{ width: `${Math.min(pct ?? 0, 100)}%` }}
                        />
                      </div>

                      <div className="flex justify-between items-center text-[11px] text-[#5e5e63]">
                        <span>
                          Attended: <strong>{course.present_sessions}</strong> / {course.effective_sessions} classes
                          {course.approved_absences_count > 0 && ` (${course.approved_absences_count} excused)`}
                        </span>
                        <span className="font-bold text-[#001e40] hover:underline flex items-center gap-1">
                          Audit Sessions &rarr;
                        </span>
                      </div>

                      {!isEligible && !isInsufficient && course.projected_classes_needed > 0 && (
                        <div className="p-2 bg-amber-50 border border-amber-200 rounded-xl text-[11px] font-bold text-amber-900 flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                          <span>Attend {course.projected_classes_needed} more consecutive classes to reach the 75% ELIGIBLE band.</span>
                        </div>
                      )}
                    </div>
                  );
                })
              ) : summary?.subjects && summary.subjects.length > 0 ? (
                summary.subjects.map((subj: any, idx: number) => {
                  const pct = subj.percentage ?? 0;
                  const isGood = pct >= 75;
                  const isWarn = pct >= 65 && pct < 75;
                  const barColor = isGood ? 'bg-[#34C759]' : isWarn ? 'bg-[#FF9F0A]' : 'bg-[#E22126]';
                  return (
                    <div key={idx} className="p-3.5 bg-[#F5F5F7] rounded-xl border border-[#D2D2D7]">
                      <div className="flex justify-between items-center mb-1.5">
                        <span className="font-bold text-sm text-[#001e40]">{subj.subject_name}</span>
                        <span className={`font-mono font-bold text-xs px-2 py-0.5 rounded ${
                          isGood ? 'bg-[#34C759]/10 text-[#34C759]' : isWarn ? 'bg-[#FF9F0A]/10 text-[#FF9F0A]' : 'bg-[#E22126]/10 text-[#E22126]'
                        }`}>
                          {pct}%
                        </span>
                      </div>
                      <div className="w-full bg-[#E5E5EA] h-2 rounded-full overflow-hidden mb-1.5">
                        <div 
                          className={`h-full ${barColor} rounded-full transition-all duration-500`}
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[11px] text-[#5e5e63]">
                        <span>Attended: <strong>{subj.present}</strong> / {subj.conducted}</span>
                        <span>{isGood ? 'Eligible for Exams' : `${75 - pct > 0 ? (75 - pct).toFixed(1) : 0}% short`}</span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="text-center py-6 text-[#5e5e63] text-sm">
                  No subject records found.
                </div>
              )}
            </div>

            <div className="pt-2 flex gap-2">
              <button 
                onClick={() => {
                  setShowSubjectModal(false);
                  setIsRawAuditOpen(true);
                }}
                className="flex-1 py-2.5 bg-[#001e40] text-white font-bold text-xs rounded-xl hover:bg-[#003366] transition-colors flex items-center justify-center gap-1.5"
              >
                <ShieldCheck className="w-4 h-4 text-emerald-300" /> Full Audit Register
              </button>
              <button 
                onClick={() => setShowSubjectModal(false)}
                className="px-4 py-2.5 bg-[#F5F5F7] text-slate-700 font-bold text-xs rounded-xl hover:bg-slate-200 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Bottom Navigation */}
      <nav className="fixed bottom-0 w-full z-50 flex justify-around items-center px-4 py-2 bg-white/95 backdrop-blur-lg md:hidden border-t border-[#D2D2D7] shadow-lg">
        <button 
          onClick={() => {
            setActiveNavTab('home');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }} 
          className={`flex flex-col items-center px-3 py-1 font-bold ${activeNavTab === 'home' ? 'text-[#001e40]' : 'text-[#5e5e63]'}`}
        >
          <Home className="w-5 h-5" />
          <span className="text-[10px] mt-0.5">Home</span>
        </button>
        <button 
          onClick={() => {
            setActiveNavTab('attendance');
            setShowSubjectModal(true);
          }} 
          className={`flex flex-col items-center px-3 py-1 hover:text-[#001e40] ${activeNavTab === 'attendance' ? 'text-[#001e40] font-bold' : 'text-[#5e5e63]'}`}
        >
          <PieChart className="w-5 h-5" />
          <span className="text-[10px] mt-0.5">Attendance</span>
        </button>
        <button 
          onClick={() => setShowClassScannerModal(true)} 
          className="flex flex-col items-center justify-center -mt-5 bg-gradient-to-r from-amber-400 via-[#FF9F0A] to-orange-500 text-[#001e40] w-14 h-14 rounded-full shadow-lg border-4 border-white transition active:scale-95"
          title="Scan Classroom Projector"
        >
          <Camera className="w-6 h-6" />
          <span className="sr-only">Scan</span>
        </button>
        <button 
          onClick={() => {
            setActiveNavTab('timetable');
            document.getElementById('timetable-section')?.scrollIntoView({ behavior: 'smooth' });
          }} 
          className={`flex flex-col items-center px-3 py-1 hover:text-[#001e40] ${activeNavTab === 'timetable' ? 'text-[#001e40] font-bold' : 'text-[#5e5e63]'}`}
        >
          <Calendar className="w-5 h-5" />
          <span className="text-[10px] mt-0.5">Timetable</span>
        </button>
      </nav>

      {/* Student Classroom Camera Scanner Modal */}
      {showClassScannerModal && (
        <React.Suspense fallback={null}>
          <StudentClassScannerModal
            onClose={() => setShowClassScannerModal(false)}
            onScanComplete={() => {
              fetchStudentData();
              setToast({ message: 'Attendance recorded successfully!', type: 'success' });
            }}
          />
        </React.Suspense>
      )}

      {/* Raw Session Audit Trail Modal */}
      {profile?.roll_number && (
        <RawSessionAuditModal
          isOpen={isRawAuditOpen}
          onClose={() => setIsRawAuditOpen(false)}
          rollNumber={profile.roll_number}
          initialCourseId={auditCourseId}
        />
      )}

    </div>
  );
};
