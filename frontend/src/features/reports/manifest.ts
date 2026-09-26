import React from 'react';
import { FeatureManifest } from '../../core/types';
import { CheckinSourcesCard } from './widgets/CheckinSourcesCard';

export const manifest: FeatureManifest = {
  name: 'reports',
  nav: [
    {
      id: 'reports-page',
      label: 'Reports',
      icon: 'FileSpreadsheet',
      path: '/reports',
      section: 'DASHBOARD',
      roles: ['admin', 'teacher'],
      order: 20,
    },
  ],
  routes: [
    {
      path: '/reports',
      title: 'Reports',
      roles: ['admin', 'teacher'],
      component: React.lazy(() => import('./ReportsPage')),
    },
  ],
  widgets: [
    {
      id: 'reports.checkin_sources',
      zone: 'side',
      order: 20,
      roles: ['admin', 'teacher'],
      grid: { cols: 12, rows: 1 },
      component: CheckinSourcesCard,
    },
  ],
  permissions: ['reports.read', 'reports.export'],
};

export default manifest;
