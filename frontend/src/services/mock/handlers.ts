import {
  generateOverviewRollup,
  generateHourlyHeatmap,
  generateCheckInSources,
  generateAttendanceTrends,
} from './generators';

export interface MockRoute {
  match: RegExp;
  handler: (init?: RequestInit, url?: string) => Promise<unknown>;
  schemaName: string;
}

export const MOCK_ROUTES: MockRoute[] = [
  {
    match: /\/api\/v1\/admin\/overview\/rollup(?:\?range=(today|week|month))?/,
    handler: async (_init, url) => {
      const match = url?.match(/[?&]range=(today|week|month)/);
      const range = (match?.[1] as 'today' | 'week' | 'month') || 'today';
      return generateOverviewRollup(range);
    },
    schemaName: 'OverviewStatsRollup',
  },
  {
    match: /\/api\/v1\/admin\/overview\/heatmap(?:\?range=(today|week|month))?/,
    handler: async (_init, url) => {
      const match = url?.match(/[?&]range=(today|week|month)/);
      const range = (match?.[1] as 'today' | 'week' | 'month') || 'today';
      return generateHourlyHeatmap(range);
    },
    schemaName: 'HourlyHeatmap',
  },
  {
    match: /\/api\/v1\/admin\/overview\/sources(?:\?range=(today|week|month))?/,
    handler: async (_init, url) => {
      const match = url?.match(/[?&]range=(today|week|month)/);
      const range = (match?.[1] as 'today' | 'week' | 'month') || 'today';
      return generateCheckInSources(range);
    },
    schemaName: 'CheckInSourcesBreakdown',
  },
  {
    match: /\/api\/v1\/admin\/overview\/trends(?:\?range=(today|week|month))?/,
    handler: async (_init, url) => {
      const match = url?.match(/[?&]range=(today|week|month)/);
      const range = (match?.[1] as 'today' | 'week' | 'month') || 'week';
      return generateAttendanceTrends(range);
    },
    schemaName: 'AttendanceTrendsRollup',
  },
];
