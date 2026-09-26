import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  UserPlus,
  Search,
  RefreshCw,
  AlertCircle,
  Send,
  UserX,
  Mail,
  CheckCircle2,
  Clock,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '../../components/dashboard/PageHeader';
import { ChartCard } from '../../components/dashboard/ChartCard';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
  useOnboardingStatusQuery,
  useOnboardingResendLinkMutation,
  useOnboardingRejectMutation,
  useOnboardingDispatchLinksMutation,
} from './hooks';
import { OnboardingStudent } from '../../core/api/schemas/onboarding';

export const OnboardingRequestsPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const openId = searchParams.get('open');
  const [page, setPage] = useState<number>(1);
  const [search, setSearch] = useState<string>('');
  const pageSize = 15;

  const query = useOnboardingStatusQuery(page, pageSize);
  const resendMutation = useOnboardingResendLinkMutation();
  const rejectMutation = useOnboardingRejectMutation();
  const dispatchMutation = useOnboardingDispatchLinksMutation();

  const students: OnboardingStudent[] = query.data?.students || [];
  const total = query.data?.total || students.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const filteredStudents = students.filter((s) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      s.roll_number.toLowerCase().includes(q) ||
      (s.email || '').toLowerCase().includes(q) ||
      (s.department || '').toLowerCase().includes(q)
    );
  });

  const handleResend = async (roll: string) => {
    try {
      await resendMutation.mutateAsync(roll);
      toast.success(`Magic link re-dispatched to ${roll}`);
      query.refetch();
    } catch (err: any) {
      toast.error(err.message || 'Failed to dispatch magic link');
    }
  };

  const handleReject = async (roll: string) => {
    if (!confirm(`Are you sure you want to revoke the onboarding request for ${roll}?`)) return;
    try {
      await rejectMutation.mutateAsync(roll);
      toast.success(`Onboarding request revoked for ${roll}`);
      query.refetch();
    } catch (err: any) {
      toast.error(err.message || 'Failed to revoke onboarding request');
    }
  };

  const handleDispatchAll = async () => {
    try {
      await dispatchMutation.mutateAsync({ force_resend: false });
      toast.success('Batch onboarding links dispatched successfully');
      query.refetch();
    } catch (err: any) {
      toast.error(err.message || 'Failed to dispatch batch links');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Student Onboarding Requests"
        description="Magic link onboarding dispatch, student email credential issuance, and hardware enrollment state"
        actions={
          <Button
            onClick={handleDispatchAll}
            disabled={dispatchMutation.isPending}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow-sm transition-colors"
          >
            <Send className="w-4 h-4" />
            <span>{dispatchMutation.isPending ? 'Dispatching...' : 'Dispatch Pending Links'}</span>
          </Button>
        }
      />

      <ChartCard
        title="Onboarding Roster"
        subtitle={`${total} total student onboarding accounts tracked`}
        toolbar={
          <div className="flex items-center gap-3">
            <div className="relative w-48 sm:w-64">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9ca3af]" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, roll, email..."
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
            <h4 className="text-sm font-semibold text-rose-200">Unable to load onboarding records</h4>
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

        {!query.isLoading && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#2a2b31] text-[#9ca3af] uppercase tracking-wider font-semibold">
                  <th className="py-2.5 px-3">Student Name</th>
                  <th className="py-2.5 px-3">Email Address</th>
                  <th className="py-2.5 px-3">Requested / Enrolled</th>
                  <th className="py-2.5 px-3">Link Sent At</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2a2b31]/40 text-slate-200">
                {filteredStudents.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-[#9ca3af]">
                      No onboarding requests match "{search}".
                    </td>
                  </tr>
                ) : (
                  filteredStudents.map((s) => {
                    const isActivated = s.onboarding_state === 'ACTIVATED' || Boolean(s.activated_at);
                    const isDispatched = Boolean(s.magic_link_sent_at);
                    const isMatch = Boolean(
                      openId &&
                        (String(s.student_id) === openId ||
                          s.roll_number.toLowerCase() === openId.toLowerCase())
                    );

                    return (
                      <tr
                        key={s.student_id || s.roll_number}
                        className={`hover:bg-[#2a2b31]/30 transition-all group ${
                          isMatch ? 'bg-indigo-500/20 ring-1 ring-indigo-500/50 animate-pulse' : ''
                        }`}
                      >
                        <td className="py-2.5 px-3 font-medium text-white">
                          <div className="font-semibold">{s.name}</div>
                          <div className="text-[11px] text-indigo-400 font-mono">
                            {s.roll_number} · {s.department || 'AIML'}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-slate-300 font-mono text-[11px]">
                          {s.email || (
                            <span className="text-slate-500 italic">No email recorded</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-[#9ca3af] font-mono text-[11px]">
                          {s.activated_at || 'Enrolled 2024'}
                        </td>
                        <td className="py-2.5 px-3 text-[#9ca3af] font-mono text-[11px]">
                          {s.magic_link_sent_at ? (
                            <span className="text-slate-300">{s.magic_link_sent_at.slice(0, 16).replace('T', ' ')}</span>
                          ) : (
                            <span className="text-slate-500 italic">Pending dispatch</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                              isActivated
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                : isDispatched
                                ? 'bg-sky-500/10 text-sky-400 border-sky-500/20'
                                : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                            }`}
                          >
                            {isActivated ? 'Activated' : isDispatched ? 'Link Sent' : 'Pending'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleResend(s.roll_number)}
                              disabled={resendMutation.isPending}
                              className="h-7 px-2 text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 text-xs inline-flex items-center gap-1"
                            >
                              <Send className="w-3 h-3" />
                              <span>Resend</span>
                            </Button>

                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleReject(s.roll_number)}
                              disabled={rejectMutation.isPending}
                              className="h-7 px-2 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 text-xs inline-flex items-center gap-1"
                            >
                              <UserX className="w-3 h-3" />
                              <span>Revoke</span>
                            </Button>
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
                    {filteredStudents.length > 0 ? (page - 1) * pageSize + 1 : 0}
                  </span>{' '}
                  to{' '}
                  <span className="text-white font-medium">
                    {Math.min(page * pageSize, total)}
                  </span>{' '}
                  of <span className="text-white font-medium">{total}</span> onboarding records
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

export default OnboardingRequestsPage;
