import type {
  OverviewStatsRollup,
  HourlyHeatmap,
  CheckInSourcesBreakdown,
  AttendanceTrendsRollup,
} from '../../core/api/schemas/aggregates';

/**
 * Seeded PRNG (Mulberry32) for deterministic, stable mock generation.
 */
function createPrng(seed: number) {
  let s = seed >>> 0;
  return function next(): number {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateOverviewRollup(range: 'today' | 'week' | 'month' = 'today'): OverviewStatsRollup {
  const seed = range === 'today' ? 1001 : range === 'week' ? 2002 : 3003;
  const rng = createPrng(seed);

  const totalStudents = 1420;
  const multiplier = range === 'today' ? 1 : range === 'week' ? 5 : 22;
  const attendanceRate = 88.4 + (rng() * 4 - 2); // 86.4 - 90.4%
  const presentCount = Math.round((totalStudents * multiplier * attendanceRate) / 100);
  const absentCount = totalStudents * multiplier - presentCount;

  return {
    range,
    totalStudents,
    presentCount,
    absentCount,
    attendanceRate: Math.round(attendanceRate * 10) / 10,
    rateDelta: range === 'today' ? 2.4 : range === 'week' ? 1.1 : -0.8,
    liveSessions: 14,
    flaggedDevices: 3,
  };
}

export function generateHourlyHeatmap(_range: 'today' | 'week' | 'month' = 'today'): HourlyHeatmap {
  const rng = createPrng(4004);
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hours = [9, 10, 11, 12, 13, 14, 15, 16];

  const cells: HourlyHeatmap = [];
  for (const day of days) {
    for (const hour of hours) {
      // Peak morning periods (9-11) have higher density
      const isPeak = hour >= 9 && hour <= 11;
      const baseRate = isPeak ? 92 : 84;
      const rate = Math.round(baseRate + (rng() * 10 - 5));
      const count = Math.round((rate / 100) * (180 + rng() * 40));
      cells.push({
        day,
        hour,
        count,
        rate: Math.min(100, Math.max(0, rate)),
      });
    }
  }
  return cells;
}

export function generateCheckInSources(_range: 'today' | 'week' | 'month' = 'today'): CheckInSourcesBreakdown {
  return [
    { source: 'qr', count: 1184, percentage: 83.4 },
    { source: 'face', count: 148, percentage: 10.4 },
    { source: 'manual', count: 58, percentage: 4.1 },
    { source: 'offline', count: 30, percentage: 2.1 },
  ];
}

export function generateAttendanceTrends(range: 'today' | 'week' | 'month' = 'week'): AttendanceTrendsRollup {
  const count = range === 'today' ? 8 : range === 'week' ? 7 : 30;
  const rng = createPrng(5005);
  const items: AttendanceTrendsRollup = [];

  for (let i = 0; i < count; i++) {
    const rate = Math.round(82 + rng() * 14);
    const present = Math.round(1200 * (rate / 100));
    const absent = 1200 - present;
    const date = range === 'today' ? `${9 + i}:00` : `Day ${i + 1}`;
    items.push({
      date,
      present,
      absent,
      percentage: rate,
    });
  }
  return items;
}
