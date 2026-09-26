import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { QrCode, ScanFace, ArrowLeft, RefreshCw, AlertCircle, Clock } from 'lucide-react';
import { ChartCard } from '../../components/dashboard/ChartCard';
import { Button } from '../../components/ui/button';
import { useAuth } from '../../core/auth/AuthProvider';
import { useDailySheetQuery } from './hooks';

export type StatusFilter = 'all' | 'present' | 'late' | 'absent';

export const TodayRegisterPage: React.FC = () => {
  const navigate = useNavigate();
  const { role } = useAuth();
  const [filter, setFilter] = useState<StatusFilter>('all');
  const todayStr = new Date().toISOString().split('T')[0];

  const query = useDailySheetQuery(todayStr, 1);
  const data = query.data;
  const rawStudents = data?.students || [];

  const filteredStudents = rawStudents.filter((s) => {
    if (filter === 'all') return true;
    const st = s.status.toLowerCase();
    if (filter === 'present') return st === 'present' || st === '4';
    if (filter === 'late') return st === 'late';
    if (filter === 'absent') return st === 'absent';
    return true;
  });

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5">
      {/* Top Navigation & Breadcrumb */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          className="flex items-center gap-1.5 text-xs text-[#9ca3af] hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Overview</span>
        </button>
        <div className="text-xs text-[#9ca3af]">
          <span>Dashboard</span> / <span className="text-white font-medium">Today's Attendance</span>
        </div>
      </div>

      <ChartCard
        title="Today's Attendance Register"
        subtitle={`Live institutional check-in log for ${todayStr} (${data?.section_name || 'All Sections'})`}
        toolbar={
          <div className="flex items-center gap-2">
            {/* Filter Chips */}
            <div className="flex items-center bg-[#141416] p-0.5 rounded-lg border border-[#2a2b31]">
              {(['all', 'present', 'late', 'absent'] as StatusFilter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-md capitalize transition-colors ${
                    filter === f
                      ? 'bg-[#6366f1] text-white shadow-sm'
                      : 'text-[#9ca3af] hover:text-white'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => query.refetch()}
              disabled={query.isFetching}
              className="h-8 px-2.5 text-xs border-[#2a2b31] bg-[#141416] hover:bg-[#2a2b31] text-slate-300"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${query.isFetching ? 'animate-spin text-indigo-400' : ''}`} />
            </Button>
          </div>
        }
      >
        {/* Error State */}
        {query.isError && (
          <div className="p-8 text-center bg-rose-500/10 border border-rose-500/20 rounded-lg">
            <AlertCircle className="w-6 h-6 text-rose-400 mx-auto mb-2" />
            <h4 className="text-sm font-semibold text-rose-200">Unable to load attendance register</h4>
            <p className="text-xs text-rose-300/80 mt-1 max-w-sm mx-auto">
              {(query.error as any)?.message || 'Service offline or network timeout.'}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => query.refetch()}
              className="mt-3 text-xs border-rose-500/30 text-rose-200 hover:bg-rose-500/20"
            >
              Retry Connection
            </Button>
          </div>
        )}

        {/* Loading Skeleton */}
        {query.isLoading && (
          <div className="space-y-2 py-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-10 w-full bg-[#2a2b31]/40 animate-pulse rounded flex items-center justify-between px-4"
              >
                <div className="h-3 w-16 bg-[#2a2b31] rounded" />
                <div className="h-3 w-36 bg-[#2a2b31] rounded" />
                <div className="h-3 w-28 bg-[#2a2b31] rounded" />
                <div className="h-4 w-14 bg-[#2a2b31] rounded-full" />
              </div>
            ))}
          </div>
        )}

        {/* Table */}
        {!query.isLoading && !query.isError && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#2a2b31] text-[#9ca3af] uppercase tracking-wider font-semibold">
                  <th className="py-2.5 px-3">Time</th>
                  <th className="py-2.5 px-3">Student</th>
                  <th className="py-2.5 px-3">Class</th>
                  <th className="py-2.5 px-3">Method</th>
                  <th className="py-2.5 px-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2a2b31]/40 text-slate-200">
                {filteredStudents.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-[#9ca3af]">
                      No check-in records matching "{filter}".
                    </td>
                  </tr>
                ) : (
                  filteredStudents.map((s) => {
                    const st = s.status.toUpperCase();
                    const isPresent = st === 'PRESENT' || st === '4';
                    const isLate = st === 'LATE';
                    const isAbsent = st === 'ABSENT';

                    return (
                      <tr key={s.student_id} className="hover:bg-[#2a2b31]/30 transition-colors">
                        <td className="py-2.5 px-3 font-mono text-[#9ca3af] flex items-center gap-1.5">
                          <Clock className="w-3 h-3 text-slate-500" />
                          <span>{s.scanned_at || '09:15 AM'}</span>
                        </td>
                        <td className="py-2.5 px-3 font-medium text-white">
                          <div>{s.name}</div>
                          <div className="text-[11px] font-mono text-indigo-400">{s.roll_number}</div>
                        </td>
                        <td className="py-2.5 px-3 text-slate-300">
                          {data?.section_name || 'CSE / AIML'}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-1.5 text-[#9ca3af]">
                            {s.scan_mode === 'FACE' ? (
                              <>
                                <ScanFace className="w-3.5 h-3.5 text-violet-400" />
                                <span>Face Verify</span>
                              </>
                            ) : (
                              <>
                                <QrCode className="w-3.5 h-3.5 text-indigo-400" />
                                <span>Dynamic QR</span>
                              </>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                              isPresent
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                : isLate
                                ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                                : isAbsent
                                ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                                : 'bg-slate-500/10 text-slate-400 border-slate-500/20'
                            }`}
                          >
                            {isPresent ? 'Present' : isLate ? 'Late' : isAbsent ? 'Absent' : s.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>

            {/* Footer with counts */}
            <div className="mt-4 pt-3 border-t border-[#2a2b31]/60 flex items-center justify-between text-xs text-[#9ca3af]">
              <div>
                Total Logged: <span className="text-white font-medium">{rawStudents.length}</span> | Filtered:{' '}
                <span className="text-white font-medium">{filteredStudents.length}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-emerald-400">Present: {data?.present_count ?? 0}</span>
                <span className="text-rose-400">Absent: {data?.absent_count ?? 0}</span>
              </div>
            </div>
          </div>
        )}
      </ChartCard>
    </div>
  );
};

export default TodayRegisterPage;
