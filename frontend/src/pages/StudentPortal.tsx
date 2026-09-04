import React, { useState, useEffect, useRef } from 'react';
import { apiRequest } from '../services/api';
import { Download, QrCode, Calendar, Clock, MapPin, User, CheckCircle, PieChart, Home, FileText, Settings, Bell, ChevronRight, Zap, X, Award, BookOpen, Radio } from 'lucide-react';
import { StudentProximityModal } from '../components/StudentProximityModal';
import { Toast } from '../components/Toast';

export const StudentPortal: React.FC = () => {
  const [profile, setProfile] = useState<any>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [pureQrCodeUrl, setPureQrCodeUrl] = useState<string | null>(null);
  const [qrViewMode, setQrViewMode] = useState<'pure' | 'card'>('pure');
  const [formattedDate, setFormattedDate] = useState<string>('');
  const [summary, setSummary] = useState<any>(null);
  const [showQRModal, setShowQRModal] = useState<boolean>(false);
  const [showProximityModal, setShowProximityModal] = useState<boolean>(false);
  const [showSubjectModal, setShowSubjectModal] = useState<boolean>(false);
  const [activeNavTab, setActiveNavTab] = useState<'home' | 'attendance' | 'timetable'>('home');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const todayStr = new Date().toISOString().split('T')[0];
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayStr = yesterdayDate.toISOString().split('T')[0];

  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [isMakeup, setIsMakeup] = useState<boolean>(false);
  const [showDatePicker, setShowDatePicker] = useState<boolean>(false);
  const [showModalDatePicker, setShowModalDatePicker] = useState<boolean>(false);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const modalDateInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchStudentData();
  }, []);

  const fetchStudentData = async () => {
    try {
      const [profileRes, qrRes, summaryRes] = await Promise.allSettled([
        apiRequest<any>('/student/profile'),
        apiRequest<any>('/student/qr-code'),
        apiRequest<any>('/student/attendance-summary')
      ]);

      if (profileRes.status === 'fulfilled') {
        setProfile(profileRes.value);
      }
      if (qrRes.status === 'fulfilled') {
        setQrCodeUrl(qrRes.value.qr_code_url);
        setPureQrCodeUrl(qrRes.value.pure_qr_code_url || qrRes.value.qr_code_url);
        setFormattedDate(qrRes.value.formatted_date || '');
        setIsMakeup(!!qrRes.value.is_makeup);
      }
      if (summaryRes.status === 'fulfilled') {
        setSummary(summaryRes.value);
      }

      if (profileRes.status === 'rejected' || qrRes.status === 'rejected') {
        const errObj: any = profileRes.status === 'rejected' ? profileRes.reason : (qrRes as PromiseRejectedResult).reason;
        setToast({ message: errObj?.message || 'Could not connect to attendance server. Please ensure backend is running.', type: 'error' });
      }
    } catch (err: any) {
      setToast({ message: err.message || 'Error loading student profile', type: 'error' });
    }
  };

  const fetchQRForDate = async (targetDate: string) => {
    try {
      setSelectedDate(targetDate);
      const res: any = await apiRequest(`/student/qr-code?date=${targetDate}`);
      setQrCodeUrl(res.qr_code_url);
      setPureQrCodeUrl(res.pure_qr_code_url || res.qr_code_url);
      setFormattedDate(res.formatted_date || '');
      setIsMakeup(!!res.is_makeup);
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to generate QR for selected date', type: 'error' });
    }
  };

  const downloadQR = () => {
    if (!qrCodeUrl || !profile) return;
    const a = document.createElement('a');
    a.href = qrCodeUrl;
    a.download = `QR_${profile.roll_number}.png`;
    a.click();
  };

  const overallPercent = summary?.overall_percentage || 82.4;
  const presentCount = summary?.total_present || 83;
  const absentCount = summary?.total_absent || 18;

  // Circle SVG calculations (radius = 45, circumference = 2 * pi * 45 = 282.7)
  const strokeDashoffset = 282.7 - (282.7 * overallPercent) / 100;

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

        {/* Bento Grid Layout */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          
          {/* Next Class Spotlight */}
          <div className="col-span-1 md:col-span-8 bg-[#001e40] text-white rounded-2xl p-6 relative overflow-hidden shadow-sm flex flex-col justify-between min-h-[180px]">
            <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '24px 24px' }}></div>
            
            <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Clock className="w-4 h-4 text-[#FF9F0A]" />
                  <span className="text-xs font-bold text-[#a7c8ff] uppercase tracking-wider">Starts in 42 mins</span>
                </div>
                <h3 className="text-xl sm:text-2xl font-bold font-geist mb-2 text-white">Data Structures & Algorithms</h3>
                <p className="text-xs text-[#a7c8ff] flex flex-wrap items-center gap-3">
                  <span className="flex items-center gap-1"><User className="w-3.5 h-3.5" /> Prof. K. Sharma</span>
                  <span className="opacity-40">•</span>
                  <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> Room 304, Block B</span>
                </p>
              </div>

              <div className="flex-shrink-0 flex flex-col items-stretch gap-2">
                <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 text-center border border-white/10 min-w-[120px]">
                  <span className="block text-[10px] font-bold text-[#a7c8ff] mb-0.5">SESSION TIME</span>
                  <span className="block text-base font-extrabold font-mono">09:30 AM</span>
                </div>
                <button
                  onClick={() => setShowProximityModal(true)}
                  className="py-2.5 px-3 bg-gradient-to-r from-emerald-400 to-teal-400 hover:from-emerald-300 hover:to-teal-300 text-[#001e40] font-black text-xs uppercase tracking-wider rounded-xl transition shadow flex items-center justify-center gap-1.5 active:scale-98"
                >
                  <Radio className="w-3.5 h-3.5 animate-pulse" />
                  1-Tap Proximity
                </button>
              </div>
            </div>

            {profile && (
              <div className="relative z-10 pt-4 border-t border-white/10 flex items-center justify-between text-xs text-[#a7c8ff]">
                <span>Student ID: <strong className="text-white font-mono">{profile.roll_number}</strong></span>
                <span className="px-2.5 py-0.5 bg-emerald-500/20 text-emerald-300 font-bold rounded-full border border-emerald-500/30">Active Student</span>
              </div>
            )}
          </div>

          {/* Quick Action Date-Bound QR Card */}
          <div className="col-span-1 md:col-span-4 bg-white rounded-2xl p-6 border border-[#D2D2D7] shadow-sm flex flex-col items-center justify-center text-center">
            
            {/* Previous Day / Make-up Date Selector */}
            <div className="flex items-center gap-1 p-1 bg-[#F5F5F7] rounded-xl border border-[#D2D2D7] mb-2.5 w-full max-w-xs shadow-inner">
              <button
                type="button"
                onClick={() => {
                  setShowDatePicker(false);
                  fetchQRForDate(todayStr);
                }}
                className={`flex-1 py-1.5 px-2 text-[11px] font-bold rounded-lg transition-all ${
                  selectedDate === todayStr && !showDatePicker
                    ? 'bg-[#001e40] text-white shadow-sm'
                    : 'text-[#5e5e63] hover:text-[#001e40]'
                }`}
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowDatePicker(false);
                  fetchQRForDate(yesterdayStr);
                }}
                className={`flex-1 py-1.5 px-2 text-[11px] font-bold rounded-lg transition-all ${
                  selectedDate === yesterdayStr && !showDatePicker
                    ? 'bg-[#001e40] text-white shadow-sm'
                    : 'text-[#5e5e63] hover:text-[#001e40]'
                }`}
              >
                Yesterday
              </button>
              <button
                type="button"
                onClick={() => {
                  const nextState = !showDatePicker;
                  setShowDatePicker(nextState);
                  if (nextState) {
                    setTimeout(() => {
                      try {
                        dateInputRef.current?.showPicker?.();
                      } catch (_) {
                        dateInputRef.current?.focus();
                      }
                    }, 50);
                  }
                }}
                className={`flex-1 py-1.5 px-2 text-[11px] font-bold rounded-lg transition-all flex items-center justify-center gap-1 ${
                  (selectedDate !== todayStr && selectedDate !== yesterdayStr) || showDatePicker
                    ? 'bg-[#001e40] text-white shadow-sm'
                    : 'text-[#5e5e63] hover:text-[#001e40]'
                }`}
                title="Select a specific past date"
              >
                <Calendar className="w-3 h-3" />
                <span className="truncate">{selectedDate !== todayStr && selectedDate !== yesterdayStr ? selectedDate : 'Pick Date'}</span>
              </button>
            </div>

            {/* Expanded Interactive Date Picker */}
            {showDatePicker && (
              <div className="flex items-center gap-2 p-2 mb-3 bg-[#EEF2F6] border border-[#CBD5E1] rounded-xl w-full max-w-xs shadow-sm animate-in fade-in zoom-in-95 duration-150">
                <Calendar className="w-4 h-4 text-[#001e40] shrink-0 ml-1" />
                <input
                  ref={dateInputRef}
                  type="date"
                  max={todayStr}
                  value={selectedDate}
                  onChange={(e) => {
                    if (e.target.value) {
                      fetchQRForDate(e.target.value);
                      setShowDatePicker(false);
                    }
                  }}
                  className="flex-1 bg-white border border-[#94A3B8] rounded-lg px-2 py-1 text-xs font-mono font-bold text-[#001e40] shadow-inner focus:outline-none focus:ring-2 focus:ring-[#001e40]"
                />
                <button
                  type="button"
                  onClick={() => setShowDatePicker(false)}
                  className="px-2 py-1 text-[11px] font-bold text-[#64748B] hover:text-[#001e40]"
                >
                  ✕
                </button>
              </div>
            )}

            <div 
              onClick={() => setShowQRModal(true)}
              className="w-56 h-56 sm:w-64 sm:h-64 bg-white rounded-2xl mb-3 flex items-center justify-center border-2 border-[#001e40]/10 shadow-md relative group cursor-pointer overflow-hidden p-3"
            >
              {pureQrCodeUrl ? (
                <img src={qrViewMode === 'pure' ? pureQrCodeUrl : (qrCodeUrl || pureQrCodeUrl)} alt="Attendance QR Code" className="w-full h-full object-contain group-hover:scale-105 transition-transform" />
              ) : (
                <QrCode className="w-16 h-16 text-[#001e40] opacity-60" />
              )}
            </div>

            <h4 className="font-bold text-sm text-[#001e40] mb-1">Date-Bound Attendance QR</h4>
            <div className="flex items-center justify-center gap-2 mb-3">
              <span className={`text-xs font-mono font-bold px-3 py-0.5 rounded-full border ${
                isMakeup 
                  ? 'text-amber-800 bg-amber-50 border-amber-300 shadow-sm' 
                  : 'text-[#24A249] bg-emerald-50 border-emerald-200'
              }`}>
                📅 {formattedDate || 'TODAY'} {isMakeup ? '• Make-up Class' : ''}
              </span>
            </div>

            <button
              onClick={() => setShowProximityModal(true)}
              className="w-full mb-2.5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs rounded-xl transition shadow flex items-center justify-center gap-1.5 active:scale-98"
            >
              <Radio className="w-3.5 h-3.5 text-emerald-200 animate-pulse" />
              1-Tap Proximity Attendance
            </button>

            <div className="flex items-center gap-2 w-full">
              <button 
                onClick={() => setShowQRModal(true)}
                className="flex-1 py-2 bg-[#001e40] hover:bg-[#003366] text-white font-bold text-xs rounded-xl transition-colors flex items-center justify-center gap-1.5"
              >
                <Zap className="w-3.5 h-3.5 text-[#FF9F0A]" /> Instant Scan View
              </button>
              <button 
                onClick={downloadQR}
                className="p-2 bg-[#F5F5F7] hover:bg-[#e0dfe4] text-[#001e40] rounded-xl transition-colors border border-[#D2D2D7]"
                title="Download Poster Pass"
              >
                <Download className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Attendance Overview Card */}
          <div className="col-span-1 md:col-span-5 bg-white rounded-2xl p-6 border border-[#D2D2D7] shadow-sm flex flex-col justify-between">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-lg text-[#001e40] font-geist">Attendance Metrics</h3>
              <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs font-bold rounded-full border border-emerald-200">
                On Track
              </span>
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
                    stroke="#001e40" 
                    strokeWidth="8" 
                    strokeDasharray="282.7" 
                    strokeDashoffset={strokeDashoffset} 
                    strokeLinecap="round" 
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-extrabold text-[#001e40] font-geist">{overallPercent}%</span>
                  <span className="text-[10px] font-bold text-[#5e5e63] uppercase">Overall</span>
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
            </div>

            <button 
              onClick={() => setShowSubjectModal(true)}
              className="w-full mt-4 py-2.5 bg-[#F5F5F7] hover:bg-[#e0dfe4] text-[#001e40] font-bold text-xs rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              <BookOpen className="w-4 h-4 text-[#3a5f94]" />
              Detailed Subject Breakdown
            </button>
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
                <>
                  {/* Default Institutional Schedule */}
                  <div className="p-4 rounded-xl bg-[#F5F5F7] border border-[#D2D2D7] flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="px-2 py-0.5 bg-[#d5e3ff] text-[#001b3c] font-bold text-[10px] rounded uppercase font-mono">09:30 AM - 11:10 AM</span>
                        <span className="px-2 py-0.5 bg-[#FF9F0A]/10 text-[#FF9F0A] font-bold text-[10px] rounded">Upcoming</span>
                      </div>
                      <h4 className="font-bold text-base text-[#001e40]">Data Structures & Algorithms</h4>
                      <p className="text-xs text-[#5e5e63] mt-0.5">Room 304, Block B • Prof. K. Sharma</p>
                    </div>
                    <ChevronRight className="w-5 h-5 text-[#737780]" />
                  </div>

                  <div className="p-4 rounded-xl bg-white border border-[#D2D2D7] flex items-center justify-between hover:bg-[#F5F5F7] transition-colors">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-bold text-[#5e5e63] font-mono">11:20 AM - 12:10 PM</span>
                      </div>
                      <h4 className="font-bold text-base text-[#001e40]">Operating Systems</h4>
                      <p className="text-xs text-[#5e5e63] mt-0.5">Lab 2, Block A • Dr. V. Rao</p>
                    </div>
                    <ChevronRight className="w-5 h-5 text-[#737780]" />
                  </div>

                  <div className="p-4 rounded-xl bg-white border border-[#D2D2D7] flex items-center justify-between hover:bg-[#F5F5F7] transition-colors">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-bold text-[#5e5e63] font-mono">01:00 PM - 02:40 PM</span>
                      </div>
                      <h4 className="font-bold text-base text-[#001e40]">Database Management Systems</h4>
                      <p className="text-xs text-[#5e5e63] mt-0.5">Room 102, Block C • Prof. M. Reddy</p>
                    </div>
                    <ChevronRight className="w-5 h-5 text-[#737780]" />
                  </div>
                </>
              )}
            </div>
          </div>

        </div>

      </main>

      {/* QR Modal Overlay */}
      {showQRModal && (pureQrCodeUrl || qrCodeUrl) && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full space-y-4 border border-[#D2D2D7] text-center shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center pb-2 border-b border-[#D2D2D7]">
              <div className="text-left">
                <h3 className="font-bold text-base text-[#001e40]">Attendance Student QR</h3>
                <p className="text-[10px] text-slate-500 font-medium">{isMakeup ? 'Make-up / Previous Class Session' : 'Regular Daily Attendance'}</p>
              </div>
              <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded-full border ${isMakeup ? 'text-amber-800 bg-amber-50 border-amber-300' : 'text-[#24A249] bg-emerald-50 border-emerald-200'}`}>
                📅 {formattedDate || 'TODAY'}
              </span>
            </div>

            {/* Quick Date Switcher inside Modal */}
            <div className="flex items-center gap-1 p-1 bg-[#F5F5F7] rounded-xl border border-[#D2D2D7]">
              <button
                type="button"
                onClick={() => {
                  setShowModalDatePicker(false);
                  fetchQRForDate(todayStr);
                }}
                className={`flex-1 py-1 px-1.5 text-[11px] font-bold rounded-lg transition-all ${
                  selectedDate === todayStr && !showModalDatePicker ? 'bg-[#001e40] text-white shadow-sm' : 'text-[#5e5e63]'
                }`}
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowModalDatePicker(false);
                  fetchQRForDate(yesterdayStr);
                }}
                className={`flex-1 py-1 px-1.5 text-[11px] font-bold rounded-lg transition-all ${
                  selectedDate === yesterdayStr && !showModalDatePicker ? 'bg-[#001e40] text-white shadow-sm' : 'text-[#5e5e63]'
                }`}
              >
                Yesterday
              </button>
              <button
                type="button"
                onClick={() => {
                  const nextState = !showModalDatePicker;
                  setShowModalDatePicker(nextState);
                  if (nextState) {
                    setTimeout(() => {
                      try {
                        modalDateInputRef.current?.showPicker?.();
                      } catch (_) {
                        modalDateInputRef.current?.focus();
                      }
                    }, 50);
                  }
                }}
                className={`flex-1 py-1 px-1.5 text-[11px] font-bold rounded-lg transition-all flex items-center justify-center gap-1 ${
                  (selectedDate !== todayStr && selectedDate !== yesterdayStr) || showModalDatePicker ? 'bg-[#001e40] text-white shadow-sm' : 'text-[#5e5e63]'
                }`}
              >
                <Calendar className="w-3 h-3" />
                <span className="truncate">{selectedDate !== todayStr && selectedDate !== yesterdayStr ? selectedDate : 'Pick Date'}</span>
              </button>
            </div>

            {/* Expanded Modal Date Picker */}
            {showModalDatePicker && (
              <div className="flex items-center gap-2 p-2 bg-[#EEF2F6] border border-[#CBD5E1] rounded-xl w-full shadow-sm animate-in fade-in zoom-in-95 duration-150">
                <Calendar className="w-4 h-4 text-[#001e40] shrink-0 ml-1" />
                <input
                  ref={modalDateInputRef}
                  type="date"
                  max={todayStr}
                  value={selectedDate}
                  onChange={(e) => {
                    if (e.target.value) {
                      fetchQRForDate(e.target.value);
                      setShowModalDatePicker(false);
                    }
                  }}
                  className="flex-1 bg-white border border-[#94A3B8] rounded-lg px-2 py-1 text-xs font-mono font-bold text-[#001e40] shadow-inner focus:outline-none focus:ring-2 focus:ring-[#001e40]"
                />
                <button
                  type="button"
                  onClick={() => setShowModalDatePicker(false)}
                  className="px-2 py-1 text-[11px] font-bold text-[#64748B] hover:text-[#001e40]"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Toggle View Mode */}
            <div className="flex bg-[#F5F5F7] p-1 rounded-xl border border-[#D2D2D7]">
              <button 
                onClick={() => setQrViewMode('pure')}
                className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1 ${qrViewMode === 'pure' ? 'bg-[#001e40] text-white shadow-sm' : 'text-[#5e5e63] hover:text-[#001e40]'}`}
              >
                <Zap className="w-3.5 h-3.5 text-[#FF9F0A]" /> Pure Camera Mode
              </button>
              <button 
                onClick={() => setQrViewMode('card')}
                className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1 ${qrViewMode === 'card' ? 'bg-[#001e40] text-white shadow-sm' : 'text-[#5e5e63] hover:text-[#001e40]'}`}
              >
                📄 Poster Pass
              </button>
            </div>
            
            <div className="p-4 bg-white border-2 border-[#001e40]/20 rounded-2xl shadow-inner inline-block w-full">
              <img 
                src={qrViewMode === 'pure' ? (pureQrCodeUrl || qrCodeUrl!) : (qrCodeUrl || pureQrCodeUrl!)} 
                alt="Attendance QR Code" 
                className="w-full h-auto aspect-square object-contain mx-auto" 
              />
            </div>

            <p className="text-[11px] text-[#5e5e63] font-medium">
              {qrViewMode === 'pure' ? '⚡ Ultra-fast high-contrast pure QR matrix for 20-50cm distance scanning' : '📄 Full SNIST ERP official pass card'}
            </p>

            <div className="flex gap-3 pt-2">
              <button 
                onClick={downloadQR}
                className="flex-1 py-3 bg-[#001e40] text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 hover:bg-[#003366] transition-colors"
              >
                <Download className="w-4 h-4" /> Download Pass Card
              </button>
              <button 
                onClick={() => setShowQRModal(false)}
                className="py-3 px-4 bg-[#F5F5F7] text-[#1b1b1d] font-bold text-xs rounded-xl border border-[#D2D2D7] hover:bg-[#e0dfe4] transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

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

            <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
              {summary?.subjects && summary.subjects.length > 0 ? (
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

            <button 
              onClick={() => setShowSubjectModal(false)}
              className="w-full py-3 bg-[#001e40] text-white font-bold text-xs rounded-xl hover:bg-[#003366] transition-colors"
            >
              Close Breakdown
            </button>
          </div>
        </div>
      )}

      {/* 1-Tap Proximity Attendance Modal */}
      {showProximityModal && (
        <StudentProximityModal
          onClose={() => setShowProximityModal(false)}
          onSuccess={() => {
            fetchStudentData();
            setToast({ message: 'Attendance verified & confirmed via proximity!', type: 'success' });
          }}
        />
      )}

      {/* Mobile Bottom Navigation */}
      <nav className="fixed bottom-0 w-full z-50 flex justify-around items-center px-4 py-2 bg-white/90 backdrop-blur-lg md:hidden border-t border-[#D2D2D7]">
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
          onClick={() => setShowQRModal(true)} 
          className="flex flex-col items-center text-[#5e5e63] px-3 py-1 hover:text-[#001e40]"
        >
          <QrCode className="w-5 h-5" />
          <span className="text-[10px] mt-0.5">My QR</span>
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

    </div>
  );
};
