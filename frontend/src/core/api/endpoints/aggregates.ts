import { api } from '../client';
import { s } from '../schemas';
// Only permitted mock import: generators for unbuilt aggregate rollups
import {
  generateOverviewRollup,
  generateHourlyHeatmap,
  generateCheckInSources,
  generateAttendanceTrends,
} from '../../../services/mock/generators';

// TODO-REAL: implement GET /api/v1/admin/overview/rollup in FastAPI
export const aggregatesEndpoints = {
  // TODO-REAL: implement GET /api/v1/admin/overview/rollup in FastAPI
  getOverviewRollup: (range: 'today' | 'week' | 'month' = 'today') => {
    return api(
      `/api/v1/admin/overview/rollup?range=${range}`,
      s.OverviewStatsRollupSchema
    ).catch(() => generateOverviewRollup(range));
  },

  // TODO-REAL: implement GET /api/v1/admin/overview/heatmap in FastAPI
  getHourlyHeatmap: (range: 'today' | 'week' | 'month' = 'today') => {
    return api(
      `/api/v1/admin/overview/heatmap?range=${range}`,
      s.HourlyHeatmapSchema
    ).catch(() => generateHourlyHeatmap(range));
  },

  // TODO-REAL: implement GET /api/v1/admin/overview/sources in FastAPI
  getCheckInSources: (range: 'today' | 'week' | 'month' = 'today') => {
    return api(
      `/api/v1/admin/overview/sources?range=${range}`,
      s.CheckInSourcesBreakdownSchema
    ).catch(() => generateCheckInSources(range));
  },

  // TODO-REAL: implement GET /api/v1/admin/overview/trends in FastAPI
  getAttendanceTrends: (range: 'today' | 'week' | 'month' = 'week') => {
    return api(
      `/api/v1/admin/overview/trends?range=${range}`,
      s.AttendanceTrendsRollupSchema
    ).catch(() => generateAttendanceTrends(range));
  },
};
