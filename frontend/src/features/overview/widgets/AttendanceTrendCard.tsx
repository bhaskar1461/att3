import React, { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { WidgetProps } from '../../../core/types';
import { WidgetShell } from '../../../core/components/WidgetShell';
import { ChartCard } from '../../../components/dashboard/ChartCard';
import { SkeletonCard } from '../../../components/dashboard/SkeletonCard';
import { TrendChart } from '../components/TrendChart';
import { useRecords } from '../../attendance/hooks';
import { useAuth } from '../../auth/hooks';
import { bucketBy } from '../selectors';

const RANGES: Array<{ id: 'today' | 'week' | 'month'; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
];

export const AttendanceTrendCard: React.FC<WidgetProps> = ({ range: propRange }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();

  // Resolve shared URL param ?range (fallback to prop or 'today')
  const urlRange = searchParams.get('range');
  const currentRange: 'today' | 'week' | 'month' =
    urlRange === 'today' || urlRange === 'week' || urlRange === 'month'
      ? urlRange
      : propRange || 'today';

  const scope = user?.role === 'teacher' ? 'mine' : 'all';

  const query = useRecords({
    range: currentRange,
    scope,
  });

  const handleRangeChange = useCallback(
    (newRange: 'today' | 'week' | 'month') => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('range', newRange);
        return next;
      });
    },
    [setSearchParams]
  );

  // Keyboard navigation for segmented radiogroup
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>, currentIdx: number) => {
      let nextIdx = -1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        nextIdx = (currentIdx + 1) % RANGES.length;
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        nextIdx = (currentIdx - 1 + RANGES.length) % RANGES.length;
      }
      if (nextIdx !== -1) {
        handleRangeChange(RANGES[nextIdx].id);
      }
    },
    [handleRangeChange]
  );

  const toolbar = (
    <div
      role="radiogroup"
      aria-label="Attendance trend timeframe"
      className="flex items-center bg-[#141416] p-0.5 rounded-lg border border-[#2a2b31]"
    >
      {RANGES.map((r, idx) => {
        const active = currentRange === r.id;
        return (
          <button
            key={r.id}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => handleRangeChange(r.id)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
              active
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-[#9ca3af] hover:text-white hover:bg-white/5'
            }`}
          >
            {r.label}
          </button>
        );
      })}
    </div>
  );

  return (
    <WidgetShell
      query={query}
      skeleton={<SkeletonCard className="min-h-[340px] p-5" lines={5} />}
    >
      {(records) => {
        const data = bucketBy(records, currentRange);
        return (
          <ChartCard
            title="Attendance Trend"
            subtitle="Distribution across verification statuses"
            toolbar={toolbar}
            className="h-full min-h-[340px] flex flex-col justify-between"
          >
            <TrendChart
              data={data}
              loading={query.isFetching && !query.isLoading}
              range={currentRange}
            />
          </ChartCard>
        );
      }}
    </WidgetShell>
  );
};
