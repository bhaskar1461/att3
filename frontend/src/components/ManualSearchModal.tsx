import React, { useState, useRef } from 'react';
import { X, Search, CheckCircle, UserCheck, AlertTriangle } from 'lucide-react';
import { apiRequest } from '../services/api';
import { StudentAttendanceStatus } from '../types';
import { scannerTelemetry } from '../services/scannerTelemetry';
import { facultyManualMarkQueue } from '../services/offlineSubmissionQueue';

interface ManualSearchModalProps {
  sessionId: number;
  students: StudentAttendanceStatus[];
  initialPeriodCount?: number;
  onClose: () => void;
  onMarkSuccess: () => void;
}

export const ManualSearchModal: React.FC<ManualSearchModalProps> = ({
  sessionId,
  students,
  initialPeriodCount,
  onClose,
  onMarkSuccess
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [periodCount, setPeriodCount] = useState<number>(initialPeriodCount || 4);
  const [selectedReason, setSelectedReason] = useState<'scanner_failed' | 'device_lost' | 'late_join' | 'other'>('scanner_failed');
  const [reasonDetail, setReasonDetail] = useState<string>('');
  const [showConfirmCapModal, setShowConfirmCapModal] = useState<boolean>(false);
  const [pendingAction, setPendingAction] = useState<{ type: 'single' | 'batch'; rollNumber?: string; status: 'PRESENT' | 'ABSENT' } | null>(null);
  const hasSearchedRef = useRef(false);

  const filteredStudents = students.filter(s => 
    s.roll_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSearchChange = (val: string) => {
    setSearchTerm(val);
    const trimmed = val.trim();
    if (trimmed.length >= 2 && !hasSearchedRef.current) {
      hasSearchedRef.current = true;
      const qType: 'roll' | 'name' = /^[0-9A-Za-z]{2,10}$/.test(trimmed) && /\d/.test(trimmed) ? 'roll' : 'name';
      scannerTelemetry.recordManualSearch(qType, String(sessionId));
    } else if (trimmed.length === 0) {
      hasSearchedRef.current = false;
    }
  };

  const handleMark = async (rollNumber: string, targetStatus: 'PRESENT' | 'ABSENT', forceConfirm: boolean = false) => {
    setIsSubmitting(true);
    setMsg(null);
    try {
      await apiRequest('/attendance/manual-mark', {
        method: 'POST',
        body: JSON.stringify({
          session_id: sessionId,
          roll_number: rollNumber,
          status: targetStatus,
          period_count: periodCount,
          reason: selectedReason,
          reason_detail: selectedReason === 'other' ? reasonDetail.trim() : undefined,
          confirm_high_volume: forceConfirm
        })
      });
      scannerTelemetry.recordManualMark('faculty_manual_override', String(sessionId));
      setMsg(`Updated ${rollNumber} [M] (${targetStatus === 'PRESENT' ? periodCount + ' periods' : 'Absent'})`);
      onMarkSuccess();
    } catch (err: any) {
      const errMsg = (err.message || '').toLowerCase();
      if (!navigator.onLine || errMsg.includes('failed to fetch') || errMsg.includes('networkerror') || errMsg.includes('offline')) {
        facultyManualMarkQueue.enqueue({
          client_id: `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          session_id: sessionId,
          roll_number: rollNumber,
          status: targetStatus,
          period_count: periodCount,
          reason: selectedReason,
          reason_detail: selectedReason === 'other' ? reasonDetail.trim() : undefined,
          confirm_high_volume: forceConfirm
        });
        setMsg(`Saved offline: ${rollNumber} marked ${targetStatus} (Will sync when online)`);
        onMarkSuccess();
        return;
      }

      if (err.message && (err.message.includes('428') || err.message.toLowerCase().includes('limit') || err.message.toLowerCase().includes('cap') || err.message.toLowerCase().includes('confirm'))) {
        setPendingAction({ type: 'single', rollNumber, status: targetStatus });
        setShowConfirmCapModal(true);
      } else {
        setMsg(err.message || 'Failed to update attendance');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMarkAll = async (targetStatus: 'PRESENT' | 'ABSENT', forceConfirm: boolean = false) => {
    if (!filteredStudents.length) return;
    setIsSubmitting(true);
    setMsg(null);
    try {
      const rolls = filteredStudents.map(s => s.roll_number);
      const res = await apiRequest(`/attendance/session/${sessionId}/batch-mark`, {
        method: 'POST',
        body: JSON.stringify({
          status: targetStatus,
          period_count: periodCount,
          roll_numbers: rolls,
          reason: selectedReason,
          reason_detail: selectedReason === 'other' ? reasonDetail.trim() : undefined,
          confirm_high_volume: forceConfirm
        })
      });
      scannerTelemetry.recordManualMark('faculty_batch_mark', String(sessionId));
      setMsg((res as any)?.message || `Marked ${rolls.length} students as ${targetStatus} [M]`);
      onMarkSuccess();
    } catch (err: any) {
      if (err.message && (err.message.includes('428') || err.message.toLowerCase().includes('limit') || err.message.toLowerCase().includes('cap') || err.message.toLowerCase().includes('confirm'))) {
        setPendingAction({ type: 'batch', status: targetStatus });
        setShowConfirmCapModal(true);
      } else {
        setMsg(err.message || 'Failed to update attendance');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmAndExecutePendingAction = () => {
    setShowConfirmCapModal(false);
    if (!pendingAction) return;
    if (pendingAction.type === 'single' && pendingAction.rollNumber) {
      handleMark(pendingAction.rollNumber, pendingAction.status, true);
    } else if (pendingAction.type === 'batch') {
      handleMarkAll(pendingAction.status, true);
    }
    setPendingAction(null);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
        
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <UserCheck className="w-5 h-5 text-cyan-400" /> Manual Attendance Search & Roster
          </h2>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search & Period Selector */}
        <div className="p-4 border-b border-slate-800/60 bg-slate-950/40 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-900/80 p-2 rounded-xl border border-slate-800">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider pl-1 shrink-0">Mark Periods:</span>
            <div className="grid grid-cols-8 gap-1 flex-1 px-1">
              {[1, 2, 3, 4, 5, 6, 7, 8].map(n => (
                <button
                  key={n}
                  onClick={() => setPeriodCount(n)}
                  className={`h-8 rounded-lg text-xs font-bold transition-all flex items-center justify-center ${
                    periodCount === n
                      ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20 scale-105 font-extrabold'
                      : 'bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Part C.1: Reason Enum Required 1-Tap Selector */}
          <div className="space-y-1.5 bg-slate-900/60 p-2.5 rounded-xl border border-slate-800/80">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider pl-0.5">
                Manual Reason (Required):
              </span>
              <span className="text-[10px] text-amber-400 font-mono font-bold">
                Audited [M]
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 pt-0.5">
              {[
                { id: 'scanner_failed', label: 'Scanner Failed' },
                { id: 'device_lost', label: 'Device Lost' },
                { id: 'late_join', label: 'Late Join' },
                { id: 'other', label: 'Other Reason' }
              ].map(r => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelectedReason(r.id as any)}
                  className={`py-1.5 px-2 rounded-lg text-xs font-bold transition-all text-center ${
                    selectedReason === r.id
                      ? 'bg-amber-400 text-slate-950 font-black shadow-md shadow-amber-400/20'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700/60'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            {selectedReason === 'other' && (
              <input
                type="text"
                placeholder="Specify reason detail (optional)..."
                value={reasonDetail}
                onChange={(e) => setReasonDetail(e.target.value)}
                className="w-full bg-slate-800/90 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 placeholder-slate-400 focus:outline-none focus:border-amber-400 mt-1"
              />
            )}
          </div>

          <div className="relative">
            <Search className="absolute left-3.5 top-3.5 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search by Roll Number or Name..."
              value={searchTerm}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full bg-slate-800/80 border border-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-100 placeholder-slate-400 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => handleMarkAll('PRESENT')}
              className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl transition shadow-sm disabled:opacity-50"
            >
              ✓ Mark All Present ({periodCount} Periods)
            </button>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => handleMarkAll('ABSENT')}
              className="flex-1 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-xl transition shadow-sm disabled:opacity-50"
            >
              ✗ Mark All Absent
            </button>
          </div>

          {msg && (
            <p className="mt-1 text-xs font-semibold text-cyan-400">{msg}</p>
          )}
        </div>

        {/* Student Roster List */}
        <div className="p-4 overflow-y-auto space-y-2 flex-1">
          {filteredStudents.length === 0 ? (
            <p className="text-center text-sm text-slate-500 py-8">No matching students found.</p>
          ) : (
            filteredStudents.map(student => (
              <div 
                key={student.student_id}
                className="flex items-center justify-between p-3 rounded-xl bg-slate-800/50 border border-slate-700/50 hover:border-slate-600 transition-colors"
              >
                <div>
                  <h4 className="text-sm font-semibold text-slate-200">{student.name}</h4>
                  <p className="text-xs font-mono text-cyan-400">{student.roll_number}</p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    disabled={isSubmitting}
                    onClick={() => handleMark(student.roll_number, 'PRESENT')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                      student.status === 'PRESENT' || student.status === '4'
                        ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                        : 'bg-slate-700 hover:bg-emerald-500/20 text-slate-300 hover:text-emerald-300'
                    }`}
                  >
                    Present
                  </button>

                  <button
                    disabled={isSubmitting}
                    onClick={() => handleMark(student.roll_number, 'ABSENT')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                      student.status === 'ABSENT' || student.status === 'A'
                        ? 'bg-rose-500 text-white shadow-md shadow-rose-500/20'
                        : 'bg-slate-700 hover:bg-rose-500/20 text-slate-300 hover:text-rose-300'
                    }`}
                  >
                    Absent
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

      </div>

      {/* Part C.4: Session Volume Cap Deliberate Confirmation Modal */}
      {showConfirmCapModal && (
        <div className="fixed inset-0 z-60 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-slate-900 border-2 border-amber-500 rounded-3xl w-full max-w-sm p-5 space-y-3.5 text-white text-center shadow-2xl animate-in zoom-in-95">
            <div className="w-12 h-12 bg-amber-500/20 text-amber-400 rounded-2xl flex items-center justify-center mx-auto border border-amber-500/40">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-black text-amber-400 uppercase tracking-wide">
                High-Volume Manual Mark Notice
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                You have reached the per-session manual mark cap (&gt;25 marks).
                All manual marks are human-verified and logged for institutional audit.
                Please confirm this is a deliberate manual mark.
              </p>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setShowConfirmCapModal(false);
                  setPendingAction(null);
                }}
                className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-xl transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmAndExecutePendingAction}
                className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black rounded-xl shadow-lg shadow-amber-500/20 transition active:scale-95"
              >
                Confirm &amp; Proceed
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
