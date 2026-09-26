import React, { useState, useEffect } from 'react';
import {
  Search,
  RefreshCw,
  AlertCircle,
  Inbox,
  ChevronLeft,
  ChevronRight,
  Filter,
} from 'lucide-react';
import { PageHeader } from '../../components/dashboard/PageHeader';
import { ChartCard } from '../../components/dashboard/ChartCard';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import { useOnboardingRebindRequestsQuery } from '../onboarding/hooks';
import { QueueRowActions } from '../security/components/QueueRowActions';
import { normalizeQueueItem, NormalizedQueueItem } from '../security/selectors';
import { setBadge } from '../../core/badges';

export const RecoveriesPage: React.FC = () => {
  const [statusTab, setStatusTab] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [search, setSearch] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const pageSize = 10;

  const query = useOnboardingRebindRequestsQuery();
  const rawRequests = query.data?.requests || [];

  // Update badge count for pending recoveries
  useEffect(() => {
    const pendingCount = rawRequests.filter(
      (r) => !r.status || r.status.toLowerCase() === 'pending'
    ).length;
    setBadge('devices.recoveries', pendingCount);
  }, [rawRequests]);

  // Filter by status tab & search query
  const filteredItems = rawRequests.filter((r) => {
    const s = (r.status || 'pending').toLowerCase();
    if (statusTab === 'pending' && s !== 'pending') return false;
    if (statusTab === 'approved' && s !== 'approved') return false;
    if (statusTab === 'rejected' && s !== 'rejected' && s !== 'denied') return false;

    if (search.trim()) {
      const q = search.toLowerCase();
      const roll = (r.roll_number || '').toLowerCase();
      const name = (r.student_name || '').toLowerCase();
      const reason = (r.reason || '').toLowerCase();
      return roll.includes(q) || name.includes(q) || reason.includes(q);
    }
    return true;
  });

  const total = filteredItems.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const displayedItems = filteredItems.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Device Recovery Queue"
        description="Student hardware rebind requests, replacement approvals, and identity verification"
      />

      {/* Status Filter Tabs */}
      <div className="flex items-center gap-2 border-b border-[#2a2b31] pb-3">
        {(['pending', 'approved', 'rejected'] as const).map((tab) => {
          const isActive = statusTab === tab;
          const count = rawRequests.filter((r) => {
            const s = (r.status || 'pending').toLowerCase();
            if (tab === 'pending') return s === 'pending';
            if (tab === 'approved') return s === 'approved';
            return s === 'rejected' || s === 'denied';
          }).length;

          return (
            <button
              key={tab}
              type="button"
              onClick={() => {
                setStatusTab(tab);
                setPage(1);
              }}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all capitalize flex items-center gap-2 ${
                isActive
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-[#9ca3af] hover:text-white hover:bg-[#1e1f24]'
              }`}
            >
              <span>{tab}</span>
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                  isActive ? 'bg-white/20 text-white' : 'bg-[#2a2b31] text-[#9ca3af]'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <ChartCard
        title={`${statusTab.toUpperCase()} Rebind Requests`}
        subtitle="Manage hardware unbind authorizations for lost, damaged, or upgraded devices"
        toolbar={
          <div className="flex items-center gap-3">
            <div className="relative w-48 sm:w-64">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9ca3af]" />
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Filter by roll, name, reason..."
                className="h-8 pl-8 text-xs bg-[#141416] border-[#2a2b31] text-white focus-visible:ring-indigo-500"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => query.refetch()}
              disabled={query.isFetching}
              className="h-8 px-2.5 text-xs border-[#2a2b31] bg-[#141416] hover:bg-[#2a2b31] text-slate-300"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${query.isFetching ? 'animate-spin text-indigo-400' : ''}`}
              />
            </Button>
          </div>
        }
      >
        {query.isError && (
          <div className="p-8 text-center bg-rose-500/10 border border-rose-500/20 rounded-lg">
            <AlertCircle className="w-6 h-6 text-rose-400 mx-auto mb-2" />
            <h4 className="text-sm font-semibold text-rose-200">Unable to load recovery requests</h4>
            <p className="text-xs text-rose-300/80 mt-1 max-w-sm mx-auto">
              {(query.error as any)?.message || 'Service could not be reached.'}
            </p>
          </div>
        )}

        {query.isLoading && (
          <div className="space-y-2 py-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-10 w-full bg-[#2a2b31]/40 animate-pulse rounded flex items-center justify-between px-4"
              >
                <div className="h-3 w-28 bg-[#2a2b31] rounded" />
                <div className="h-3 w-40 bg-[#2a2b31] rounded" />
                <div className="h-3 w-20 bg-[#2a2b31] rounded" />
              </div>
            ))}
          </div>
        )}

        {!query.isLoading && !query.isError && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#2a2b31] text-[#9ca3af] uppercase tracking-wider font-semibold">
                  <th className="py-2.5 px-3">Student</th>
                  <th className="py-2.5 px-3">Reason / Details</th>
                  <th className="py-2.5 px-3">Requested At</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2a2b31]/40 text-slate-200">
                {displayedItems.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-[#9ca3af]">
                      <div className="flex flex-col items-center justify-center space-y-2">
                        <Inbox className="w-8 h-8 text-slate-500 stroke-[1.5]" />
                        <p className="text-sm font-medium text-slate-300">No {statusTab} requests</p>
                        <p className="text-xs text-[#9ca3af]">Queue is completely up to date.</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  displayedItems.map((r, idx) => {
                    const normItem: NormalizedQueueItem = normalizeQueueItem(r, 'recoveries');
                    const reqId = r.id || r.request_id || idx;
                    const status = (r.status || 'pending').toUpperCase();

                    return (
                      <tr
                        key={reqId}
                        className="hover:bg-[#2a2b31]/30 transition-colors group"
                      >
                        <td className="py-2.5 px-3 font-medium text-white">
                          <div className="font-semibold">{r.student_name || normItem.title}</div>
                          <div className="text-[11px] text-indigo-400 font-mono">
                            {r.roll_number || 'SAP ID'}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-slate-300 max-w-xs truncate">
                          {r.reason || 'Hardware device replacement requested by student'}
                        </td>
                        <td className="py-2.5 px-3 text-[#9ca3af] font-mono text-[11px]">
                          {r.created_at ? r.created_at.slice(0, 16).replace('T', ' ') : 'Recent'}
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                              status === 'APPROVED'
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                : status === 'REJECTED' || status === 'DENIED'
                                ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                                : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                            }`}
                          >
                            {status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <div className="flex justify-end">
                            <QueueRowActions item={normItem} />
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>

            {/* Pagination Controls */}
            {total > 0 && (
              <div className="mt-4 pt-3 border-t border-[#2a2b31]/60 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[#9ca3af]">
                <div>
                  Showing{' '}
                  <span className="text-white font-medium">
                    {displayedItems.length > 0 ? (page - 1) * pageSize + 1 : 0}
                  </span>{' '}
                  to{' '}
                  <span className="text-white font-medium">
                    {Math.min(page * pageSize, total)}
                  </span>{' '}
                  of <span className="text-white font-medium">{total}</span> requests
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1 || query.isFetching}
                    className="h-7 px-2 border-[#2a2b31] bg-[#141416] hover:bg-[#2a2b31] text-xs"
                  >
                    <ChevronLeft className="w-3.5 h-3.5 mr-0.5" /> Prev
                  </Button>
                  <span className="text-slate-300 font-mono px-1">
                    Page {page} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages || query.isFetching}
                    className="h-7 px-2 border-[#2a2b31] bg-[#141416] hover:bg-[#2a2b31] text-xs"
                  >
                    Next <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </ChartCard>
    </div>
  );
};

export default RecoveriesPage;
