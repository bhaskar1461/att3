import React, { useState, useRef } from 'react';
import { X, Search, CheckCircle, UserCheck } from 'lucide-react';
import { apiRequest } from '../services/api';
import { StudentAttendanceStatus } from '../types';
import { scannerTelemetry } from '../services/scannerTelemetry';

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

  const handleMark = async (rollNumber: string, targetStatus: 'PRESENT' | 'ABSENT') => {
    setIsSubmitting(true);
    setMsg(null);
    try {
      await apiRequest('/attendance/manual-mark', {
        method: 'POST',
        body: JSON.stringify({
          session_id: sessionId,
          roll_number: rollNumber,
          status: targetStatus,
          period_count: periodCount
        })
      });
      scannerTelemetry.recordManualMark('faculty_manual_override', String(sessionId));
      setMsg(`Updated ${rollNumber} (${targetStatus === 'PRESENT' ? periodCount + ' periods' : 'Absent'})`);
      onMarkSuccess();
    } catch (err: any) {
      setMsg(err.message || 'Failed to update attendance');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMarkAll = async (targetStatus: 'PRESENT' | 'ABSENT') => {
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
          roll_numbers: rolls
        })
      });
      scannerTelemetry.recordManualMark('faculty_batch_mark', String(sessionId));
      setMsg((res as any)?.message || `Marked ${rolls.length} students as ${targetStatus}`);
      onMarkSuccess();
    } catch (err: any) {
      setMsg(err.message || 'Failed to update attendance');
    } finally {
      setIsSubmitting(false);
    }
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
    </div>
  );
};
