import React, { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { WidgetProps } from '../../../core/types';
import { DonutCard, DonutSegment } from '../../../components/dashboard/DonutCard';
import { SkeletonCard } from '../../../components/dashboard/SkeletonCard';
import {
  openCounts,
  resolvedToday,
  QueueType,
} from '../selectors';
import { useOnboardingStatusQuery, useOnboardingRebindRequestsQuery } from '../../onboarding/hooks';
import { useSecurityAuditLogsQuery } from '../hooks';
import { setBadge } from '../../../core/badges';

export const VerificationQueueDonut: React.FC<WidgetProps> = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedQueue = searchParams.get('queue') as QueueType | null;

  // Real Queries (Phase 3)
  const approvalsQuery = useOnboardingStatusQuery(1, 100);
  const spoofQuery = useSecurityAuditLogsQuery(100);
  const recoveriesQuery = useOnboardingRebindRequestsQuery();

  const isLoading =
    approvalsQuery.isLoading || spoofQuery.isLoading || recoveriesQuery.isLoading;

  const isError =
    approvalsQuery.isError && spoofQuery.isError && recoveriesQuery.isError;

  const handleSegmentClick = (id: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (next.get('queue') === id) {
        next.delete('queue');
      } else {
        next.set('queue', id);
      }
      return next;
    });
  };

  const { counts, resolved, segments } = useMemo(() => {
    const rawApprovals = approvalsQuery.data?.students;
    const rawSpoof = Array.isArray(spoofQuery.data)
      ? spoofQuery.data
      : (spoofQuery.data as any)?.items || [];
    const rawRecoveries = recoveriesQuery.data?.requests;

    const computedCounts = openCounts(rawApprovals, rawSpoof, rawRecoveries);
    const resolvedCount = resolvedToday(rawApprovals, rawSpoof, rawRecoveries);

    const segs: DonutSegment[] = [
      {
        id: 'approvals',
        label: 'Onboarding Approvals',
        value: computedCounts.approvals,
        color: '#8b5cf6',
      },
      {
        id: 'spoof',
        label: 'Security & Spoof',
        value: computedCounts.spoof,
        color: '#ef4444',
      },
      {
        id: 'recoveries',
        label: 'Device Recoveries',
        value: computedCounts.recoveries,
        color: '#f59e0b',
      },
    ];

    return {
      counts: computedCounts,
      resolved: resolvedCount,
      segments: segs,
    };
  }, [approvalsQuery.data, spoofQuery.data, recoveriesQuery.data]);

  // Publish live badge counts to core store (Part A & Part E)
  React.useEffect(() => {
    setBadge('devices.recoveries', counts.recoveries);
    setBadge('security.alerts', counts.spoof);
  }, [counts.recoveries, counts.spoof]);

  if (isLoading) {
    return <SkeletonCard chart="donut" className="min-h-[340px] p-5" lines={4} />;
  }

  if (isError) {
    return (
      <div className="rounded-[12px] bg-[#1e1f24] border border-[#2a2b31] p-5 min-h-[340px] flex flex-col justify-between">
        <div>
          <h3 className="text-[15px] font-semibold text-white tracking-tight">
            Verification Queue
          </h3>
          <p className="text-xs text-rose-400 mt-2">
            Failed to load queue telemetry from server.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            approvalsQuery.refetch();
            spoofQuery.refetch();
            recoveriesQuery.refetch();
          }}
          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-semibold self-start"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <DonutCard
      title="Verification Queue"
      centerValue={counts.total}
      centerLabel={counts.total === 0 ? 'All queues clear' : 'Open Items'}
      segments={segments}
      selectedId={selectedQueue || undefined}
      onSegmentClick={handleSegmentClick}
      progressTop={{
        done: resolved,
        total: counts.total + resolved,
        label: `Resolved today ${resolved}`,
      }}
      className="min-h-[340px]"
    />
  );
};
