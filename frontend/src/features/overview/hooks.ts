import { useQuery } from '@tanstack/react-query';
import { keys, Range } from '../../core/api/keys';
import { aggregatesEndpoints } from '../../core/api/endpoints/aggregates';
import type {
  OverviewStatsRollup,
  HourlyHeatmap,
  HourlyHeatmapCell,
  CheckInSourcesBreakdown,
  CheckInSourceItem,
} from '../../core/api/schemas/aggregates';

export interface PollingOptions {
  pollMs?: number;
}

export const useOverviewRollupQuery = (range: Range = 'today', opts?: PollingOptions) => {
  return useQuery({
    queryKey: keys.overview.stats(range),
    queryFn: () => aggregatesEndpoints.getOverviewRollup(range),
    refetchInterval: opts?.pollMs,
  });
};

export const useHourlyHeatmapQuery = (range: Range = 'today', opts?: PollingOptions) => {
  return useQuery({
    queryKey: keys.overview.heatmap(range),
    queryFn: () => aggregatesEndpoints.getHourlyHeatmap(range),
    refetchInterval: opts?.pollMs,
  });
};

export const useCheckInSourcesQuery = (range: Range = 'today', opts?: PollingOptions) => {
  return useQuery({
    queryKey: keys.overview.sources(range),
    queryFn: () => aggregatesEndpoints.getCheckInSources(range),
    refetchInterval: opts?.pollMs,
  });
};

export const useAttendanceTrendsQuery = (range: Range = 'week', opts?: PollingOptions) => {
  return useQuery({
    queryKey: keys.overview.trends(range),
    queryFn: () => aggregatesEndpoints.getAttendanceTrends(range),
    refetchInterval: opts?.pollMs,
  });
};

// Pure testable selectors
export const selectPeakHour = (heatmap: HourlyHeatmap): HourlyHeatmapCell | null => {
  if (!heatmap || heatmap.length === 0) return null;
  return heatmap.reduce((max, cell) => (cell.count > max.count ? cell : max), heatmap[0]);
};

export const selectPrimarySource = (sources: CheckInSourcesBreakdown): CheckInSourceItem | null => {
  if (!sources || sources.length === 0) return null;
  return sources.reduce((max, src) => (src.percentage > max.percentage ? src : max), sources[0]);
};

export const selectAttendanceSummaryDelta = (rollup: OverviewStatsRollup): { isPositive: boolean; formatted: string } => {
  const isPositive = rollup.rateDelta >= 0;
  const formatted = `${isPositive ? '+' : ''}${rollup.rateDelta.toFixed(1)}%`;
  return { isPositive, formatted };
};
