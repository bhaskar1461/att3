import { z } from 'zod';

// TODO-REAL: implement GET /api/v1/admin/overview/rollup in FastAPI
export const OverviewStatsRollupSchema = z.object({
  range: z.enum(['today', 'week', 'month']),
  totalStudents: z.number(),
  presentCount: z.number(),
  absentCount: z.number(),
  attendanceRate: z.number(),
  rateDelta: z.number(),
  liveSessions: z.number(),
  flaggedDevices: z.number(),
});
// TODO-REAL: implement GET /api/v1/admin/overview/rollup in FastAPI
export type OverviewStatsRollup = z.infer<typeof OverviewStatsRollupSchema>;

// TODO-REAL: implement GET /api/v1/admin/overview/heatmap in FastAPI
export const HourlyHeatmapCellSchema = z.object({
  day: z.string(),
  hour: z.number(),
  count: z.number(),
  rate: z.number(),
});
// TODO-REAL: implement GET /api/v1/admin/overview/heatmap in FastAPI
export type HourlyHeatmapCell = z.infer<typeof HourlyHeatmapCellSchema>;

// TODO-REAL: implement GET /api/v1/admin/overview/heatmap in FastAPI
export const HourlyHeatmapSchema = z.array(HourlyHeatmapCellSchema);
// TODO-REAL: implement GET /api/v1/admin/overview/heatmap in FastAPI
export type HourlyHeatmap = z.infer<typeof HourlyHeatmapSchema>;

// TODO-REAL: implement GET /api/v1/admin/overview/sources in FastAPI
export const CheckInSourceItemSchema = z.object({
  source: z.enum(['qr', 'face', 'manual', 'offline']),
  count: z.number(),
  percentage: z.number(),
});
// TODO-REAL: implement GET /api/v1/admin/overview/sources in FastAPI
export type CheckInSourceItem = z.infer<typeof CheckInSourceItemSchema>;

// TODO-REAL: implement GET /api/v1/admin/overview/sources in FastAPI
export const CheckInSourcesBreakdownSchema = z.array(CheckInSourceItemSchema);
// TODO-REAL: implement GET /api/v1/admin/overview/sources in FastAPI
export type CheckInSourcesBreakdown = z.infer<typeof CheckInSourcesBreakdownSchema>;

// TODO-REAL: implement GET /api/v1/admin/overview/trends in FastAPI
export const AttendanceTrendItemSchema = z.object({
  date: z.string(),
  present: z.number(),
  absent: z.number(),
  percentage: z.number(),
});
// TODO-REAL: implement GET /api/v1/admin/overview/trends in FastAPI
export type AttendanceTrendItem = z.infer<typeof AttendanceTrendItemSchema>;

// TODO-REAL: implement GET /api/v1/admin/overview/trends in FastAPI
export const AttendanceTrendsRollupSchema = z.array(AttendanceTrendItemSchema);
// TODO-REAL: implement GET /api/v1/admin/overview/trends in FastAPI
export type AttendanceTrendsRollup = z.infer<typeof AttendanceTrendsRollupSchema>;
