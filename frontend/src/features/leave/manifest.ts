import React from 'react';
import { FeatureManifest } from '../../core/types';
import { LeaveWidget } from './widgets/LeaveWidget';

export const manifest: FeatureManifest = {
  name: 'leave',
  permissions: [
    { key: 'leave.act', roles: ['admin'] },
  ],
  nav: [
    {
      id: 'leave-requests',
      label: 'Leave Requests',
      icon: 'CalendarDays',
      path: '/leave',
      section: 'LEAVE',
      roles: ['admin'],
      order: 1,
      badgeId: 'leave-open-count',
    },
  ],
  routes: [
    {
      path: '/leave',
      title: 'Leave Requests',
      roles: ['admin'],
      component: React.lazy(() => import('./LeaveRequestsPage')),
    },
  ],
  widgets: [
    {
      id: 'leave-requests-widget',
      roles: ['admin'],
      zone: 'side',
      order: 5,
      grid: { cols: 12, rows: 1 },
      component: LeaveWidget,
    },
  ],
};

export default manifest;
