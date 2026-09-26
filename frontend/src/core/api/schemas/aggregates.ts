import { z } from 'zod';

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
export type OverviewStatsRollup = z.infer<typeof OverviewStatsRollupSchema>;

export const HourlyHeatmapCellSchema = z.object({
  day: z.string(),
  hour: z.number(),
  count: z.number(),
  rate: z.number(),
});
export type HourlyHeatmapCell = z.infer<typeof HourlyHeatmapCellSchema>;

export const HourlyHeatmapSchema = z.array(HourlyHeatmapCellSchema);
export type HourlyHeatmap = z.infer<typeof HourlyHeatmapSchema>;

export const CheckInSourceItemSchema = z.object({
  source: z.enum(['qr', 'face', 'manual', 'offline']),
  count: z.number(),
  percentage: z.number(),
});
export type CheckInSourceItem = z.infer<typeof CheckInSourceItemSchema>;

export const CheckInSourcesBreakdownSchema = z.array(CheckInSourceItemSchema);
export type CheckInSourcesBreakdown = z.infer<typeof CheckInSourcesBreakdownSchema>;

export const AttendanceTrendItemSchema = z.object({
  date: z.string(),
  present: z.number(),
  absent: z.number(),
  percentage: z.number(),
});
export type AttendanceTrendItem = z.infer<typeof AttendanceTrendItemSchema>;

export const AttendanceTrendsRollupSchema = z.array(AttendanceTrendItemSchema);
export type AttendanceTrendsRollup = z.infer<typeof AttendanceTrendsRollupSchema>;

