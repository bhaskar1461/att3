import { FeatureManifest } from '../../core/types';
import { TotalStudentsCard } from './widgets/TotalStudentsCard';
import { PresentTodayCard } from './widgets/PresentTodayCard';
import { AttendanceRateCard } from './widgets/AttendanceRateCard';
import { LiveSessionsCard } from './widgets/LiveSessionsCard';
import { AttendanceHeroCard } from './widgets/AttendanceHeroCard';
import { AttendanceTrendCard } from './widgets/AttendanceTrendCard';
import { ScanHeatmapCard } from './widgets/ScanHeatmapCard';
import { RecentRegistersCard } from './widgets/RecentRegistersCard';
import { FlaggedEventsCard } from './widgets/FlaggedEventsCard';

export const manifest: FeatureManifest = {
  name: 'overview',
  nav: [
    {
      id: 'overview-dashboard',
      label: 'Overview',
      icon: 'LayoutDashboard',
      path: '/overview',
      section: 'DASHBOARD',
      roles: ['admin', 'teacher'],
      order: 10,
    },
  ],
  widgets: [
    {
      id: 'kpi.total_students',
      zone: 'kpi',
      order: 10,
      roles: ['admin', 'teacher'],
      grid: { cols: 3, rows: 1 },
      component: TotalStudentsCard,
    },
    {
      id: 'kpi.present_today',
      zone: 'kpi',
      order: 20,
      roles: ['admin', 'teacher'],
      grid: { cols: 3, rows: 1 },
      component: PresentTodayCard,
    },
    {
      id: 'kpi.attendance_rate',
      zone: 'kpi',
      order: 30,
      roles: ['admin', 'teacher'],
      grid: { cols: 3, rows: 1 },
      component: AttendanceRateCard,
    },
    {
      id: 'kpi.live_sessions',
      zone: 'kpi',
      order: 40,
      roles: ['admin', 'teacher'],
      grid: { cols: 3, rows: 1 },
      component: LiveSessionsCard,
    },
    {
      id: 'overview.trend',
      zone: 'main',
      order: 10,
      roles: ['admin', 'teacher'],
      grid: { cols: 12, rows: 1 },
      component: AttendanceTrendCard,
    },
    {
      id: 'overview.heatmap',
      zone: 'main',
      order: 20,
      roles: ['admin', 'teacher'],
      grid: { cols: 12, rows: 1 },
      component: ScanHeatmapCard,
    },
    {
      id: 'overview.recent_registers',
      zone: 'main',
      order: 30,
      roles: ['admin', 'teacher'],
      grid: { cols: 6, rows: 1 },
      component: RecentRegistersCard,
    },
    {
      id: 'overview.flagged_events',
      zone: 'main',
      order: 40,
      roles: ['admin', 'teacher'],
      grid: { cols: 6, rows: 1 },
      component: FlaggedEventsCard,
    },
    {
      id: 'overview.hero',
      zone: 'side',
      order: 10,
      roles: ['admin', 'teacher'],
      grid: { cols: 12, rows: 2 },
      component: AttendanceHeroCard,
    },
  ],

  permissions: ['reports.read', 'roster.read'],
};

export default manifest;
