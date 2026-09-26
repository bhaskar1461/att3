import { api } from '../client';
import { s } from '../schemas';

export const aggregatesEndpoints = {
  getOverviewRollup: (range: 'today' | 'week' | 'month' = 'today') => {
    return api(
      `/api/v1/admin/overview/rollup?range=${range}`,
      s.OverviewStatsRollupSchema
    );
  },

  getHourlyHeatmap: (range: 'today' | 'week' | 'month' = 'today') => {
    return api(
      `/api/v1/admin/overview/heatmap?range=${range}`,
      s.HourlyHeatmapSchema
    );
  },

  getCheckInSources: (range: 'today' | 'week' | 'month' = 'today') => {
    return api(
      `/api/v1/admin/overview/sources?range=${range}`,
      s.CheckInSourcesBreakdownSchema
    );
  },

  getAttendanceTrends: (range: 'today' | 'week' | 'month' = 'week') => {
    return api(
      `/api/v1/admin/overview/trends?range=${range}`,
      s.AttendanceTrendsRollupSchema
    );
  },
};

