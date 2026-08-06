import React, { useState, useEffect } from 'react';
import { apiRequest } from '../services/api';
import { TeacherAssignment, AttendanceSession } from '../types';
import { Camera, Lock, RefreshCw, Search } from 'lucide-react';
import { QRScannerModal } from '../components/QRScannerModal';
import { ManualSearchModal } from '../components/ManualSearchModal';
import { Toast } from '../components/Toast';

export const TeacherDashboard: React.FC = () => {
  const [assignments, setAssignments] = useState<TeacherAssignment[]>([]);
  const [selectedAssignment, setSelectedAssignment] = useState<TeacherAssignment | null>(null);
  const [period, setPeriod] = useState('Period 1');
  const [activeSession, setActiveSession] = useState<AttendanceSession | null>(null);
  
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isManualOpen, setIsManualOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'warning' } | null>(null);

  useEffect(() => {
    fetchAssignedClasses();
  }, []);

  const fetchAssignedClasses = async () => {
    try {
      const data: any = await apiRequest('/teacher/assigned-classes');
      setAssignments(data);
      if (data.length > 0) {
        setSelectedAssignment(data[0]);
      }
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to load assigned classes', type: 'error' });
    }
  };

  const handleStartSession = async () => {
    if (!selectedAssignment) return;
    try {
      const response: any = await apiRequest('/teacher/sessions/start', {
        method: 'POST',
        body: JSON.stringify({
          subject_id: selectedAssignment.subject_id,
          section_id: selectedAssignment.section_id,
          period: period
        })
      });
      fetchSessionDetails(response.session_id);
      setIsScannerOpen(true);
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to start session', type: 'error' });
    }
  };

  const fetchSessionDetails = async (sessionId: number) => {
    try {
      const data: any = await apiRequest(`/teacher/sessions/${sessionId}`);
      setActiveSession(data);
    } catch (err: any) {
      console.error(err);
    }
  };

  const handleLockSession = async () => {
    if (!activeSession) return;
    try {
      await apiRequest(`/teacher/sessions/${activeSession.session_id}/lock`, { method: 'POST' });
      setToast({ message: 'Attendance session locked successfully!', type: 'success' });
      fetchSessionDetails(activeSession.session_id);
    } catch (err: any) {
      setToast({ message: err.message || 'Lock failed', type: 'error' });
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Header Banner */}
      <div className="snist-card p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <span className="px-3.5 py-1.5 bg-[#2f53d7]/10 text-[#2f53d7] border border-[#2f53d7]/20 rounded-full text-xs font-extrabold uppercase">
            Faculty Mobile Portal
          </span>
          <h2 className="font-heading text-2xl font-bold text-[#15347e] mt-2">Class Attendance Scanner</h2>
          <p className="text-xs font-medium text-[#6a7894]">Select class, open camera, and scan student QR codes</p>
        </div>

        <button
          onClick={fetchAssignedClasses}
          className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors border border-slate-300"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Class Selection Controls */}
      <div className="snist-card p-6 space-y-4">
        <h3 className="text-xs font-bold text-[#6a7894] uppercase tracking-wider">Select Class & Period</h3>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-[#17233c] mb-1.5">Assigned Class / Subject</label>
            <select
              value={selectedAssignment?.assignment_id || ''}
              onChange={(e) => {
                const found = assignments.find(a => a.assignment_id === Number(e.target.value));
                if (found) setSelectedAssignment(found);
              }}
              className="snist-input w-full"
            >
              {assignments.map(a => (
                <option key={a.assignment_id} value={a.assignment_id}>
                  {a.subject_name} ({a.section_name} - {a.department})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-[#17233c] mb-1.5">Period</label>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="snist-input w-full"
            >
              <option value="Period 1">Period 1 (09:10 - 10:00)</option>
              <option value="Period 2">Period 2 (10:00 - 10:50)</option>
              <option value="Period 3">Period 3 (10:50 - 11:40)</option>
              <option value="Period 4">Period 4 (11:40 - 12:30)</option>
              <option value="Period 5">Period 5 (01:10 - 02:00)</option>
              <option value="Period 6">Period 6 (02:00 - 02:50)</option>
              <option value="Period 7">Period 7 (02:50 - 03:40)</option>
              <option value="Period 8">Period 8 (03:40 - 04:30)</option>
            </select>
          </div>
        </div>

        <div className="pt-2 flex flex-col sm:flex-row gap-3">
          <button
            onClick={handleStartSession}
            className="flex-1 py-3.5 snist-btn-primary font-bold text-sm flex items-center justify-center gap-2"
          >
            <Camera className="w-5 h-5" /> Start Live QR Scanner
          </button>
        </div>
      </div>

      {/* Active Session Live Stats */}
      {activeSession && (
        <div className="space-y-4">
          
          {/* Stat counters */}
          <div className="grid grid-cols-3 gap-3">
            <div className="snist-card p-4 text-center">
              <span className="text-xs font-bold text-[#6a7894]">Total Students</span>
              <p className="font-heading text-2xl font-extrabold text-[#15347e] mt-1">{activeSession.total_students}</p>
            </div>

            <div className="snist-card p-4 border-emerald-200 bg-emerald-50/50 text-center">
              <span className="text-xs font-bold text-emerald-700">Present</span>
              <p className="font-heading text-2xl font-extrabold text-emerald-700 mt-1">{activeSession.present_count}</p>
            </div>

            <div className="snist-card p-4 border-rose-200 bg-rose-50/50 text-center">
              <span className="text-xs font-bold text-rose-700">Absent</span>
              <p className="font-heading text-2xl font-extrabold text-rose-700 mt-1">{activeSession.absent_count}</p>
            </div>
          </div>

          {/* Session Header Controls */}
          <div className="snist-card p-5 flex items-center justify-between">
            <div>
              <h4 className="font-heading text-base font-bold text-[#15347e]">{activeSession.subject_name} — {activeSession.section_name}</h4>
              <p className="text-xs font-medium text-[#6a7894]">{activeSession.period} • {activeSession.session_date}</p>
            </div>

            <div className="flex items-center gap-2">
              {activeSession.status === 'OPEN' ? (
                <>
                  <button
                    onClick={() => setIsScannerOpen(true)}
                    className="px-3.5 py-2 snist-btn-primary text-xs font-bold flex items-center gap-1.5"
                  >
                    <Camera className="w-4 h-4" /> Open Camera
                  </button>

                  <button
                    onClick={handleLockSession}
                    className="px-3.5 py-2 bg-rose-100 hover:bg-rose-200 text-rose-700 border border-rose-300 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
                  >
                    <Lock className="w-4 h-4" /> Lock Session
                  </button>
                </>
              ) : (
                <span className="px-3 py-1 bg-amber-100 text-amber-800 border border-amber-300 rounded-xl text-xs font-bold flex items-center gap-1">
                  <Lock className="w-3.5 h-3.5" /> LOCKED
                </span>
              )}
            </div>
          </div>

          {/* Student Roster Grid */}
          <div className="snist-card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-[#6a7894] uppercase tracking-wider">Live Student Roster</h4>
              <button
                onClick={() => setIsManualOpen(true)}
                className="text-xs text-[#2f53d7] font-bold hover:underline flex items-center gap-1"
              >
                <Search className="w-3.5 h-3.5" /> Manual Search
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-96 overflow-y-auto pr-1">
              {activeSession.students.map(s => (
                <div 
                  key={s.student_id}
                  className={`p-3 rounded-2xl border flex items-center justify-between transition-colors ${
                    s.status === 'PRESENT' || s.status === '4'
                      ? 'bg-emerald-50/60 border-emerald-300'
                      : 'bg-white border-slate-200'
                  }`}
                >
                  <div>
                    <h5 className="text-xs font-bold text-[#17233c]">{s.name}</h5>
                    <p className="text-[11px] font-mono text-[#2f53d7] font-bold">{s.roll_number}</p>
                  </div>

                  <span className={`px-2.5 py-1 rounded-lg text-xs font-extrabold ${
                    s.status === 'PRESENT' || s.status === '4'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-100 text-slate-500 border border-slate-200'
                  }`}>
                    {s.status === 'PRESENT' || s.status === '4' ? 'PRESENT' : 'ABSENT'}
                  </span>
                </div>
              ))}
            </div>
          </div>

        </div>
      )}

      {/* QR Camera Modal */}
      {isScannerOpen && activeSession && (
        <QRScannerModal
          sessionId={activeSession.session_id}
          initialPeriodCount={parseInt(activeSession.period?.replace(/\D/g, '') || '4') || 4}
          onClose={() => {
            setIsScannerOpen(false);
            fetchSessionDetails(activeSession.session_id);
          }}
          onScanSuccess={(res) => {
            fetchSessionDetails(activeSession.session_id);
          }}
          onOpenManualSearch={() => {
            setIsScannerOpen(false);
            setIsManualOpen(true);
          }}
        />
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

    </div>
  );
};
