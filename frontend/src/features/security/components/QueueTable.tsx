import React, { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { X, Smartphone, ShieldAlert, UserCheck, Inbox } from 'lucide-react';
import { Card, CardHeader, CardContent } from '../../../components/ui/card';
import { useAuth } from '../../auth/hooks';
import { can } from '../../../core/roles';
import {
  QueueType,
  NormalizedQueueItem,
  normalizeQueueItem,
} from '../selectors';
import { useOnboardingStatusQuery, useOnboardingRebindRequestsQuery } from '../../onboarding/hooks';
import { useSecurityAuditLogsQuery } from '../hooks';
import { QueueRowActions } from './QueueRowActions';

export const QueueTable: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const queue = searchParams.get('queue') as QueueType | null;

  const { user } = useAuth();
  const role = (user?.role || '').toLowerCase() === 'teacher' ? 'teacher' : 'admin';

  // Can perform actions?
  const canAct =
    queue === 'recoveries'
      ? can(role, 'devices.act')
      : queue === 'spoof'
      ? can(role, 'security.act')
      : queue === 'approvals'
      ? can(role, 'onboarding.act')
      : false;

  // Real Queries
  const approvalsQuery = useOnboardingStatusQuery(1, 100, {
    pollMs: queue === 'approvals' ? 10000 : undefined,
  });
  const spoofQuery = useSecurityAuditLogsQuery(100, {
    pollMs: queue === 'spoof' ? 10000 : undefined,
  });
  const recoveriesQuery = useOnboardingRebindRequestsQuery({
    pollMs: queue === 'recoveries' ? 10000 : undefined,
  });

  const handleClose = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('queue');
      return next;
    });
  };

  const { title, badgeColor, items, isLoading } = useMemo(() => {
    if (queue === 'recoveries') {
      const rawList = recoveriesQuery.data?.requests || [];
      const openRaw = rawList.filter(
        (r: any) => String(r.status || '').toUpperCase() === 'PENDING'
      );
      const normalized = openRaw.map((r: any) => normalizeQueueItem(r, 'recoveries'));
      return {
        title: 'Device Recovery Tickets',
        badgeColor: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
        items: normalized,
        isLoading: recoveriesQuery.isLoading,
      };
    }

    if (queue === 'spoof') {
      const rawData = spoofQuery.data;
      const rawList = Array.isArray(rawData) ? rawData : (rawData as any)?.items || [];
      const openRaw = rawList.filter((item: any) => {
        const act = String(item.action || '').toUpperCase();
        const details = String(item.details || '');
        const isResolved =
          details.includes('[RESOLVED') ||
          details.includes('[ESCALATED') ||
          details.includes('DISMISSED') ||
          Boolean(item.resolved_at);
        return (
          !isResolved &&
          (act === 'ACCOUNT_SWITCH_ATTEMPT' ||
            act === 'PROJECTOR_TOKEN_REJECTED' ||
            act.includes('SPOOF') ||
            act.includes('SECURITY_ALERT'))
        );
      });
      const normalized = openRaw.map((r: any) => normalizeQueueItem(r, 'spoof'));
      return {
        title: 'Security & Spoof Alerts',
        badgeColor: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
        items: normalized,
        isLoading: spoofQuery.isLoading,
      };
    }

    if (queue === 'approvals') {
      const rawList = approvalsQuery.data?.students || [];
      const openRaw = rawList.filter((item: any) => {
        const st = String(item.state || item.onboarding_state || '').toUpperCase();
        return st === 'LINK_SENT' || st === 'PENDING' || st === 'PENDING_ONBOARDING';
      });
      const normalized = openRaw.map((r: any) => normalizeQueueItem(r, 'approvals'));
      return {
        title: 'Onboarding Approvals',
        badgeColor: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
        items: normalized,
        isLoading: approvalsQuery.isLoading,
      };
    }

    return { title: '', badgeColor: '', items: [] as NormalizedQueueItem[], isLoading: false };
  }, [queue, recoveriesQuery.data, recoveriesQuery.isLoading, spoofQuery.data, spoofQuery.isLoading, approvalsQuery.data, approvalsQuery.isLoading]);

  // If ?queue is not set or invalid, render nothing
  if (!queue || !['approvals', 'spoof', 'recoveries'].includes(queue)) {
    return null;
  }

  // Sort since desc (using createdAt timestamp desc)
  const sortedItems = [...items].sort((a, b) => {
    const timeA = new Date(a.createdAt).getTime() || 0;
    const timeB = new Date(b.createdAt).getTime() || 0;
    return timeB - timeA;
  });

  const totalCount = sortedItems.length;
  const displayedItems = sortedItems.slice(0, 50);

  const getSeverityBadge = (severity: NormalizedQueueItem['severity']) => {
    switch (severity) {
      case 'critical':
        return (
          <span className="px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider rounded border bg-rose-500/10 text-rose-400 border-rose-500/30">
            Critical
          </span>
        );
      case 'high':
        return (
          <span className="px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider rounded border bg-orange-500/10 text-orange-400 border-orange-500/30">
            High
          </span>
        );
      case 'medium':
        return (
          <span className="px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider rounded border bg-amber-500/10 text-amber-400 border-amber-500/30">
            Medium
          </span>
        );
      case 'low':
      default:
        return (
          <span className="px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider rounded border bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
            Low
          </span>
        );
    }
  };

  const getTypeIcon = (type: QueueType) => {
    switch (type) {
      case 'recoveries':
        return <Smartphone className="w-4 h-4 text-amber-400" />;
      case 'spoof':
        return <ShieldAlert className="w-4 h-4 text-rose-400" />;
      case 'approvals':
      default:
        return <UserCheck className="w-4 h-4 text-purple-400" />;
    }
  };

  return (
    <Card className="rounded-[12px] bg-[#1e1f24] border border-[#2a2b31] overflow-hidden shadow-2xl">
      <CardHeader className="p-4 sm:p-5 border-b border-[#2a2b31] flex flex-row items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-white/5 border border-white/10">
            {getTypeIcon(queue)}
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h3 className="text-base font-semibold text-white tracking-tight">
                {title}
              </h3>
              <span
                className={`px-2 py-0.5 text-xs font-mono font-medium rounded-full border ${badgeColor}`}
              >
                {totalCount} open
              </span>
            </div>
            <p className="text-xs text-[#9ca3af] mt-0.5">
              Filtered queue items with server-authoritative actions
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleClose}
          aria-label="Close queue table"
          className="p-1.5 rounded-lg text-[#9ca3af] hover:text-white hover:bg-white/10 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </CardHeader>

      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-8 text-center text-xs text-[#9ca3af] space-y-2">
            <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p>Loading queue items...</p>
          </div>
        ) : displayedItems.length === 0 ? (
          <div className="p-12 text-center text-[#9ca3af] space-y-2 flex flex-col items-center justify-center">
            <Inbox className="w-8 h-8 text-slate-500 stroke-[1.5]" />
            <p className="text-sm font-medium text-slate-300">All queues clear</p>
            <p className="text-xs text-[#9ca3af]">No open items in this queue.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#2a2b31] bg-[#17181c] text-[#9ca3af] uppercase tracking-wider font-semibold text-[11px]">
                  <th className="py-3 px-4 w-12 text-center">Type</th>
                  <th className="py-3 px-4">Details</th>
                  <th className="py-3 px-4 w-28">Since</th>
                  <th className="py-3 px-4 w-24">Severity</th>
                  {canAct && <th className="py-3 px-4 w-48 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2a2b31]/40 text-slate-200">
                {displayedItems.map((item) => (
                  <tr
                    key={item.id}
                    className="hover:bg-white/[0.02] transition-colors group"
                  >
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center">
                        {getTypeIcon(item.type)}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-white group-hover:text-indigo-300 transition-colors">
                        {item.title}
                      </div>
                      <div className="text-[#9ca3af] text-[11px] mt-0.5 line-clamp-1">
                        {item.subtitle}
                      </div>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap text-[#9ca3af] font-mono text-[11px]">
                      {item.since}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      {getSeverityBadge(item.severity)}
                    </td>
                    {canAct && (
                      <td className="py-3 px-4 whitespace-nowrap text-right">
                        <div className="flex justify-end">
                          <QueueRowActions item={item} />
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer info & cap note */}
        {totalCount > 0 && (
          <div className="p-3 px-4 border-t border-[#2a2b31] bg-[#17181c]/60 flex items-center justify-between text-[11px] text-[#9ca3af]">
            <span>
              {totalCount > 50
                ? `Showing 50 of ${totalCount} — full page in Phase 8`
                : `Showing all ${totalCount} open items`}
            </span>
            <span className="font-mono text-slate-500">Live Queue Synced</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
