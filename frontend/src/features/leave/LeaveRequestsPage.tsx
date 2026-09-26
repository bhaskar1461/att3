import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  CalendarDays,
  CheckCircle,
  XCircle,
  Clock,
  Search,
  Filter,
  AlertCircle,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../auth/hooks';
import { can } from '../../core/roles';
import { normalizeRole } from '../../core/auth/AuthProvider';
import { useLeaveRequestsQuery, useActOnLeaveMutation } from './hooks';
import { LeaveRequest } from './schemas';
import { toast } from 'sonner';

export const LeaveRequestsPage: React.FC = () => {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const openId = searchParams.get('open');

  const role = normalizeRole(user?.role || 'student');
  const canAct = can(role, 'leave.act');

  const { data: leaves = [], isLoading } = useLeaveRequestsQuery();
  const actMutation = useActOnLeaveMutation();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [highlightedId, setHighlightedId] = useState<string | null>(openId);

  useEffect(() => {
    if (openId) {
      setHighlightedId(openId);
      const timer = setTimeout(() => setHighlightedId(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [openId]);

  const handleAction = async (id: string, action: 'approve' | 'reject') => {
    if (!canAct) {
      toast.error('Permission denied: leave.act required');
      return;
    }

    try {
      await actMutation.mutateAsync({ id, action });
      toast.success(`Leave request ${id} ${action === 'approve' ? 'approved' : 'rejected'}`);
    } catch (err: any) {
      toast.error(err?.message || `Failed to ${action} leave request`);
    }
  };

  const filteredLeaves = leaves.filter((l) => {
    const matchesSearch =
      l.student_name.toLowerCase().includes(search.toLowerCase()) ||
      l.roll_number.toLowerCase().includes(search.toLowerCase()) ||
      l.reason.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || l.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <CalendarDays className="w-6 h-6 text-indigo-400" />
            <span>Leave Requests Management</span>
          </h1>
          <p className="text-sm text-[#9ca3af] mt-1">
            Review student absence applications, medical notices, and approval status
          </p>
        </div>

        <div className="flex items-center gap-2">
          {canAct ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Permission: leave.act (Active)</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>View-Only Mode</span>
            </span>
          )}
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="p-4 rounded-xl bg-[#1e1f24] border border-[#2a2b31] flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-[#9ca3af] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by student, roll number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[#141416] border border-[#2a2b31] rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder-[#9ca3af] focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter className="w-3.5 h-3.5 text-[#9ca3af]" />
          <span className="text-xs text-[#9ca3af]">Status:</span>
          {(['all', 'pending', 'approved', 'rejected'] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium capitalize transition-colors ${
                statusFilter === st
                  ? 'bg-indigo-600 text-white'
                  : 'bg-[#141416] text-[#9ca3af] hover:text-white border border-[#2a2b31]'
              }`}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-[#2a2b31] bg-[#1e1f24] overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#141416] text-[#9ca3af] border-b border-[#2a2b31] font-semibold">
              <tr>
                <th className="py-3 px-4">Request ID</th>
                <th className="py-3 px-4">Student</th>
                <th className="py-3 px-4">Dept</th>
                <th className="py-3 px-4">Duration</th>
                <th className="py-3 px-4">Reason</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2a2b31]">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-[#9ca3af]">
                    Loading leave requests...
                  </td>
                </tr>
              ) : filteredLeaves.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-[#9ca3af]">
                    No leave requests found matching filters.
                  </td>
                </tr>
              ) : (
                filteredLeaves.map((req) => {
                  const isHighlighted = highlightedId === req.id;
                  return (
                    <tr
                      key={req.id}
                      className={`hover:bg-[#2a2b31]/40 transition-colors ${
                        isHighlighted ? 'bg-indigo-950/40 ring-1 ring-indigo-500' : ''
                      }`}
                    >
                      <td className="py-3 px-4 font-mono text-slate-300">
                        {req.id}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-white">{req.student_name}</div>
                        <div className="text-[11px] text-[#9ca3af] font-mono">{req.roll_number}</div>
                      </td>
                      <td className="py-3 px-4 text-[#9ca3af]">{req.department}</td>
                      <td className="py-3 px-4 text-[#9ca3af]">
                        {req.start_date} <span className="text-slate-600">to</span> {req.end_date}
                      </td>
                      <td className="py-3 px-4 text-slate-300 max-w-xs truncate" title={req.reason}>
                        {req.reason}
                      </td>
                      <td className="py-3 px-4">
                        {req.status === 'pending' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                            <Clock className="w-3 h-3" />
                            <span>Pending</span>
                          </span>
                        )}
                        {req.status === 'approved' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            <CheckCircle className="w-3 h-3" />
                            <span>Approved</span>
                          </span>
                        )}
                        {req.status === 'rejected' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                            <XCircle className="w-3 h-3" />
                            <span>Rejected</span>
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {req.status === 'pending' ? (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              disabled={!canAct || actMutation.isPending}
                              onClick={() => handleAction(req.id, 'approve')}
                              className="px-2.5 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-400 text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              disabled={!canAct || actMutation.isPending}
                              onClick={() => handleAction(req.id, 'reject')}
                              className="px-2.5 py-1 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/30 text-rose-400 text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                              Reject
                            </button>
                          </div>
                        ) : (
                          <span className="text-[11px] text-[#9ca3af] italic">Completed</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default LeaveRequestsPage;
