import React from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, ArrowRight, CheckCircle2 } from 'lucide-react';
import { WidgetProps } from '../../../core/types';
import { WidgetShell } from '../../../core/components/WidgetShell';
import { ChartCard } from '../../../components/dashboard/ChartCard';
import { SkeletonCard } from '../../../components/dashboard/SkeletonCard';
import { useLeaveRequestsQuery } from '../hooks';

export const LeaveWidget: React.FC<WidgetProps> = () => {
  const query = useLeaveRequestsQuery();

  return (
    <WidgetShell
      query={query}
      skeleton={<SkeletonCard className="p-5 min-h-[160px]" lines={3} />}
      isEmpty={(data) => !data || data.length === 0}
      empty={
        <ChartCard
          title="Leave Requests"
          subtitle="Student leave management"
          toolbar={
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#2a2b31] text-[#9ca3af]">
              0 Open
            </span>
          }
        >
          <div className="py-6 flex flex-col items-center justify-center text-center">
            <CheckCircle2 className="w-8 h-8 text-emerald-400 mb-2" />
            <p className="text-xs text-[#9ca3af]">No active leave requests</p>
          </div>
        </ChartCard>
      }
    >
      {(leaves) => {
        const pending = leaves.filter((l) => l.status === 'pending');
        const pendingCount = pending.length;

        return (
          <ChartCard
            title="Leave Requests"
            subtitle="Student absence & medical notices"
            toolbar={
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                  pendingCount > 0
                    ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                    : 'bg-[#2a2b31] text-[#9ca3af]'
                }`}
              >
                {pendingCount} Open
              </span>
            }
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 rounded-xl bg-[#1e1f24] border border-[#2a2b31]">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                    <CalendarClock className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">
                      {pendingCount} Pending Approval{pendingCount === 1 ? '' : 's'}
                    </div>
                    <div className="text-[11px] text-[#9ca3af]">
                      Requires administrative review
                    </div>
                  </div>
                </div>
                <div className="text-xl font-bold text-amber-400">
                  {pendingCount}
                </div>
              </div>

              {pending.length > 0 && (
                <div className="space-y-2">
                  {pending.slice(0, 2).map((item) => (
                    <div
                      key={item.id}
                      className="p-2.5 rounded-lg bg-[#141416] border border-[#2a2b31]/60 flex items-center justify-between text-xs"
                    >
                      <div className="min-w-0 pr-2">
                        <div className="font-medium text-slate-200 truncate">
                          {item.student_name}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate">
                          {item.reason}
                        </div>
                      </div>
                      <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-semibold border border-amber-500/30">
                        {item.department}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <Link
                to="/leave"
                className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 text-indigo-400 hover:text-indigo-300 text-xs font-semibold transition-colors"
              >
                <span>View All Requests</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </ChartCard>
        );
      }}
    </WidgetShell>
  );
};
